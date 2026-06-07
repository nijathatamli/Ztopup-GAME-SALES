const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const { Pool } = require('pg');

const PORT = process.env.PORT || 8091;
const ROOT = __dirname;

// Prefer DATABASE_URL if provided (e.g., on Render). Fall back to discrete vars locally.
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Many managed Postgres providers (including Render External URL) require SSL.
    // Allow opting out via DB_SSL=false for internal connections.
    ssl: (process.env.DB_SSL === 'true' || process.env.PGSSLMODE === 'require') ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });
} else {
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'zelix_topup',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error('Request body is too large'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  const [salt, originalHash] = storedPassword.split(':');
  const hash = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHash, 'hex');
  return original.length === hash.length && crypto.timingSafeEqual(original, hash);
}

function getAuthToken(request) {
  const auth = request.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    balance: Number(user.balance || 0),
    createdAt: user.created_at
  };
}

// ==========================================
// DATABASE ABSTRACTION LAYER (POSTGRESQL ONLY)
// ==========================================

async function dbFindUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
}

async function dbFindUserByIdentifier(identifier) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $2 LIMIT 1', [identifier, identifier]);
  return rows[0] || null;
}

async function dbCheckUserExists(email, username) {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1 OR username = $2 LIMIT 1', [email, username]);
  return rows.length > 0;
}

async function dbCheckUserExistsExclude(email, username, excludeId) {
  const { rows } = await pool.query('SELECT id FROM users WHERE (email = $1 OR username = $2) AND id <> $3 LIMIT 1', [email, username, excludeId]);
  return rows.length > 0;
}

async function dbInsertUser(user) {
  await pool.query(
    'INSERT INTO users (id, username, name, first_name, last_name, email, password_hash, balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [user.id, user.username, user.name, user.first_name, user.last_name, user.email, user.password_hash, user.balance]
  );
}

async function dbUpdateProfile(id, username, name, firstName, lastName, email) {
  await pool.query(
    'UPDATE users SET username = $1, name = $2, first_name = $3, last_name = $4, email = $5 WHERE id = $6',
    [username, name, firstName, lastName, email, id]
  );
}

async function dbUpdateBalance(id, amount) {
  await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, id]);
}

async function dbUpdatePassword(id, passwordHash) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
}

async function dbCreateSession(token, userId) {
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
}

async function dbGetSessionUserId(token) {
  if (!token) return null;
  const { rows } = await pool.query('SELECT user_id FROM sessions WHERE token = $1 LIMIT 1', [token]);
  return rows[0] ? rows[0].user_id : null;
}

async function dbDeleteSession(token) {
  if (!token) return;
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

// ==========================================
// ROUTE LOGIC
// ==========================================

async function requireUser(request, response) {
  const token = getAuthToken(request);
  const userId = await dbGetSessionUserId(token);
  if (!userId) {
    sendJson(response, 401, { message: 'Sessiya aktiv deyil. Zəhmət olmasa daxil olun.' });
    return null;
  }

  const user = await dbFindUserById(userId);
  if (!user) {
    sendJson(response, 401, { message: 'İstifadəçi tapılmadı.' });
    return null;
  }
  return user;
}

function buildProfile(user) {
  const safeUser = sanitizeUser(user);
  return {
    user: safeUser,
    profile: {
      username: safeUser.username || 'ZelixPlayer',
      firstName: safeUser.firstName || 'Elvin',
      lastName: safeUser.lastName || 'Əliyev',
      email: safeUser.email || 'elvin.aliyev@example.com',
      phone: '+994 50 123 45 67',
      memberId: `#ZLX${String(user.id || '').slice(0, 5).toUpperCase() || '10023'}`,
      vip: true,
      title: 'Zelix ailəsinin fəal üzvü',
      joinedAt: '15.03.2025',
      level: 25,
      xp: 12450,
      nextXp: 20000,
      zelixBalance: Number(user.balance || 0),
      mapBalance: 5600
    },
    stats: {
      activeDays: 45,
      completedOrders: 28,
      protection: 100
    }
  };
}

async function register(request, response) {
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const username = String(body.username || body.userName || '').trim().toLowerCase();
  const firstName = String(body.firstName || body.first_name || body.firstname || body.name || '').trim();
  const lastName = String(body.lastName || body.last_name || body.lastname || body.surname || '').trim();
  const name = `${firstName} ${lastName}`.trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const confirmPassword = String(body.confirmPassword || '');
  const terms = Boolean(body.terms);

  if (!/^[a-z0-9_]{3,24}$/.test(username)) return sendJson(response, 400, { message: 'Username 3-24 simvol olmalı və yalnız hərf, rəqəm, _ qəbul edir.' });
  if (firstName.length < 2) return sendJson(response, 400, { message: 'Ad ən az 2 simvol olmalıdır.' });
  if (lastName.length < 2) return sendJson(response, 400, { message: 'Soyad ən az 2 simvol olmalıdır.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return sendJson(response, 400, { message: 'Düzgün email daxil edin.' });
  if (password.length < 6) return sendJson(response, 400, { message: 'Şifrə ən az 6 simvol olmalıdır.' });
  if (password !== confirmPassword) return sendJson(response, 400, { message: 'Şifrələr uyğun deyil.' });
  if (!terms) return sendJson(response, 400, { message: 'Üzvlük müqaviləsi və məlumatlandırma mətnini qəbul etməlisiniz.' });

  const exists = await dbCheckUserExists(email, username);
  if (exists) {
    return sendJson(response, 409, { message: 'Bu email və ya istifadəçi adı artıq qeydiyyatdan keçib.' });
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    name,
    first_name: firstName,
    last_name: lastName,
    email,
    password_hash: hashPassword(password),
    balance: 0,
    created_at: new Date().toISOString()
  };

  await dbInsertUser(user);

  const token = crypto.randomBytes(32).toString('hex');
  await dbCreateSession(token, user.id);
  sendJson(response, 201, { message: 'Qeydiyyat uğurludur.', token, user: sanitizeUser(user) });
}

async function login(request, response) {
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const user = await dbFindUserByIdentifier(identifier);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return sendJson(response, 401, { message: 'Email və ya şifrə yanlışdır.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  await dbCreateSession(token, user.id);
  sendJson(response, 200, { message: 'Giriş uğurludur.', token, user: sanitizeUser(user) });
}

async function currentUser(request, response) {
  const token = getAuthToken(request);
  const userId = await dbGetSessionUserId(token);
  if (!userId) return sendJson(response, 401, { message: 'Sessiya aktiv deyil.' });

  const user = await dbFindUserById(userId);
  if (!user) return sendJson(response, 401, { message: 'İstifadəçi tapılmadı.' });
  sendJson(response, 200, { user: sanitizeUser(user) });
}

async function logout(request, response) {
  const token = getAuthToken(request);
  if (token) await dbDeleteSession(token);
  sendJson(response, 200, { message: 'Çıxış edildi.' });
}

async function profile(request, response) {
  const user = await requireUser(request, response);
  if (!user) return;
  sendJson(response, 200, buildProfile(user));
}

async function updateProfile(request, response) {
  const user = await requireUser(request, response);
  if (!user) return;

  const body = JSON.parse(await readRequestBody(request) || '{}');
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const username = String(body.username || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();

  if (firstName.length < 2) return sendJson(response, 400, { message: 'Ad ən az 2 simvol olmalıdır.' });
  if (lastName.length < 2) return sendJson(response, 400, { message: 'Soyad ən az 2 simvol olmalıdır.' });
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return sendJson(response, 400, { message: 'Username 3-24 simvol olmalı və yalnız hərf, rəqəm, _ qəbul edir.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return sendJson(response, 400, { message: 'Düzgün email daxil edin.' });

  const exists = await dbCheckUserExistsExclude(email, username, user.id);
  if (exists) return sendJson(response, 409, { message: 'Bu email və ya username artıq istifadə olunur.' });

  const name = `${firstName} ${lastName}`.trim();
  await dbUpdateProfile(user.id, username, name, firstName, lastName, email);
  const updatedUser = await dbFindUserById(user.id);
  sendJson(response, 200, { message: 'Dəyişikliklər yadda saxlandı.', ...buildProfile(updatedUser) });
}

async function topup(request, response) {
  const user = await requireUser(request, response);
  if (!user) return;

  const body = JSON.parse(await readRequestBody(request) || '{}');
  const amount = Number(body.amount || 100);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) return sendJson(response, 400, { message: 'Topup məbləği düzgün deyil.' });

  await dbUpdateBalance(user.id, amount);
  const updatedUser = await dbFindUserById(user.id);
  sendJson(response, 200, { message: `${amount} ZELIX balansınıza əlavə edildi.`, ...buildProfile(updatedUser) });
}

async function updatePassword(request, response) {
  const user = await requireUser(request, response);
  if (!user) return;

  const body = JSON.parse(await readRequestBody(request) || '{}');
  const password = String(body.password || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (password.length < 6) return sendJson(response, 400, { message: 'Şifrə ən az 6 simvol olmalıdır.' });
  if (password !== confirmPassword) return sendJson(response, 400, { message: 'Şifrələr uyğun deyil.' });

  await dbUpdatePassword(user.id, hashPassword(password));
  sendJson(response, 200, { message: 'Şifrə uğurla yeniləndi.' });
}

async function support(request, response) {
  const user = await requireUser(request, response);
  if (!user) return;

  const body = JSON.parse(await readRequestBody(request) || '{}');
  const subject = String(body.subject || 'Dəstək Sorğusu').trim();
  const msg = String(body.message || 'Kö̀mək tələb olunur').trim();

  const ticketId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO tickets (id, user_id, user_email, subject, message) VALUES ($1, $2, $3, $4, $5)',
    [ticketId, user.id, user.email, subject, msg]
  );

  sendJson(response, 200, { message: 'Dəstək sorğunuz qəbul edildi. Komandamız tezliklə əlaqə saxlayacaq.' });
}

async function toggleFavorite(request, response) {
  const user = await requireUser(request, response);
  if (!user) return;

  const body = JSON.parse(await readRequestBody(request) || '{}');
  const gameName = String(body.game || 'General').trim();

  const { rows } = await pool.query('SELECT id FROM favorites WHERE user_id = $1 AND game_name = $2 LIMIT 1', [user.id, gameName]);
  let isFavorite = false;
  if (rows.length > 0) {
    await pool.query('DELETE FROM favorites WHERE user_id = $1 AND game_name = $2', [user.id, gameName]);
  } else {
    await pool.query('INSERT INTO favorites (user_id, game_name) VALUES ($1, $2)', [user.id, gameName]);
    isFavorite = true;
  }

  sendJson(response, 200, {
    message: isFavorite ? `${gameName} seçilmişlərə əlavə edildi.` : `${gameName} seçilmişlərdən çıxarıldı.`,
    favorite: isFavorite
  });
}

// ==========================================
// VOUCHER SIMULATED PURCHASE ENDPOINT (NEW)
// ==========================================

async function buyProduct(request, response) {
  const user = await requireUser(request, response);
  if (!user) return;

  const body = JSON.parse(await readRequestBody(request) || '{}');
  const game = String(body.game || '').trim();
  const packageName = String(body.package || '').trim();
  const price = Number(body.price || 0);
  const playerId = String(body.playerId || '').trim();

  if (!game || !packageName || price <= 0 || !playerId) {
    return sendJson(response, 400, { message: 'Sifariş məlumatları tam deyil.' });
  }

  if (Number(user.balance) < price) {
    return sendJson(response, 400, { message: 'Balansınız kifayət deyil. Zəhmət olmasa balansı artırın.' });
  }

  // Deduct user balance
  await dbUpdateBalance(user.id, -price);

  // Save order
  const orderId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO orders (id, user_id, user_email, game, package, price, player_id, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [orderId, user.id, user.email, game, packageName, price, playerId, 'Tamamlandı']
  );

  const updatedUser = await dbFindUserById(user.id);
  sendJson(response, 200, {
    message: `Təbriklər! ${packageName} (${price} ZELIX) hesabınıza yükləndi. Oyunçu ID: ${playerId}`,
    ...buildProfile(updatedUser)
  });
}

// ==========================================
// STATIC FILE SERVER
// ==========================================

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    response.end(file);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

// ==========================================
// SERVER INITIALIZATION
// ==========================================

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'POST' && request.url === '/api/register') return await register(request, response);
    if (request.method === 'POST' && request.url === '/api/login') return await login(request, response);
    if (request.method === 'POST' && request.url === '/api/logout') return await logout(request, response);
    if (request.method === 'GET' && request.url === '/api/me') return await currentUser(request, response);
    if (request.method === 'GET' && request.url === '/api/profile') return await profile(request, response);
    if (request.method === 'POST' && request.url === '/api/profile') return await updateProfile(request, response);
    if (request.method === 'POST' && request.url === '/api/topup') return await topup(request, response);
    if (request.method === 'POST' && request.url === '/api/password') return await updatePassword(request, response);
    if (request.method === 'POST' && request.url === '/api/support') return await support(request, response);
    if (request.method === 'POST' && request.url === '/api/favorites/toggle') return await toggleFavorite(request, response);
    if (request.method === 'POST' && request.url === '/api/buy') return await buyProduct(request, response);
    if (request.method === 'GET') return await serveStatic(request, response);

    response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'Method not allowed' }));
  } catch (error) {
    sendJson(response, 500, { message: 'Server xətası baş verdi.' });
  }
});

// Try connecting to PostgreSQL
pool.query('SELECT NOW()').then(() => {
  console.log('PostgreSQL connection successful.');
  server.listen(PORT, () => {
    console.log(`ZELIX TOPUP running at http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error(`[Fatal] PostgreSQL connection failed. Details: ${error.message}`);
  console.error('Please ensure PostgreSQL is running and credentials are correct in .env');
  process.exit(1);
});
