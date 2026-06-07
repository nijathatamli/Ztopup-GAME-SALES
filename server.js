const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
// Allow injecting DATABASE_URL at runtime via process.env.__INJECT_DATABASE_URL
if (process.env.__INJECT_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.__INJECT_DATABASE_URL;
  if (!process.env.PGSSLMODE) process.env.PGSSLMODE = 'require';
}

// ==========================================
// TRANSACTIONS AND AVATAR REQUESTS (NEW)
// ==========================================

async function dbCreateTransaction(userId, amount, type, status = 'approved', ref = null) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO transactions (id, user_id, amount, type, status, ref) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, userId, Number(amount), String(type), String(status), ref ? String(ref) : null]
  );
  return id;
}

async function submitAvatarRequest(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const imageUrl = String(body.imageUrl || body.image_url || '').trim();
  if (!imageUrl) return sendJson(response, 400, { message: 'Şəkil linki tələb olunur.' });
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO avatar_requests (id, user_id, image_url, status) VALUES ($1,$2,$3,$4)', [id, user.id, imageUrl, 'pending']);
  sendJson(response, 201, { message: 'Avatar yoxlama üçün göndərildi.', requestId: id });
}

async function listMyAvatarRequests(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const { rows } = await pool.query('SELECT * FROM avatar_requests WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);
  sendJson(response, 200, { requests: rows });
}

async function adminListAvatarRequests(request, response) {
  const admin = await requireAdmin(request, response); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const status = (url.searchParams.get('status') || '').trim().toLowerCase();
  let sql = 'SELECT * FROM avatar_requests';
  const params = [];
  if (status) { sql += ' WHERE LOWER(status) = $1'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await pool.query(sql, params);
  sendJson(response, 200, { requests: rows });
}

async function adminApproveAvatar(request, response) {
  const admin = await requireAdmin(request, response); if (!admin) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const requestId = String(body.requestId || body.id || '').trim();
  const approve = body.approve !== false; // default approve
  if (!requestId) return sendJson(response, 400, { message: 'requestId tələb olunur' });
  const { rows } = await pool.query('SELECT * FROM avatar_requests WHERE id = $1 LIMIT 1', [requestId]);
  if (rows.length === 0) return sendJson(response, 404, { message: 'Sorğu tapılmadı' });
  const ar = rows[0];
  const newStatus = approve ? 'approved' : 'rejected';
  await pool.query('UPDATE avatar_requests SET status=$1, approved_by=$2, approved_at=CURRENT_TIMESTAMP WHERE id=$3', [newStatus, admin.id, requestId]);
  if (approve) {
    await pool.query('UPDATE users SET profile_image_url = $1 WHERE id = $2', [ar.image_url, ar.user_id]);
  }
  sendJson(response, 200, { message: approve ? 'Təsdiqləndi' : 'Rədd edildi' });
}

async function adminAdjustBalance(request, response) {
  const admin = await requireAdmin(request, response); if (!admin) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const userId = String(body.userId || body.user_id || '').trim();
  const amount = Number(body.amount || 0);
  const reason = String(body.reason || 'Admin adjustment');
  if (!userId || !Number.isFinite(amount) || amount === 0) return sendJson(response, 400, { message: 'userId və düzgün amount tələb olunur' });
  const usr = await dbFindUserById(userId);
  if (!usr) return sendJson(response, 404, { message: 'İstifadəçi tapılmadı' });
  await dbUpdateBalance(userId, amount);
  await dbCreateTransaction(userId, Math.abs(amount), amount > 0 ? 'credit' : 'debit', 'approved', reason);
  const updated = await dbFindUserById(userId);
  sendJson(response, 200, { message: 'Balans yeniləndi', user: sanitizeUser(updated) });
}
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 8091;
const ROOT = __dirname;
const JWT_SECRET = process.env.JWT_SECRET || 'zelix-dev-secret-change';

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
    ssl: (process.env.DB_SSL === 'true' || process.env.PGSSLMODE === 'require') ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });
}

// Additional schema (base tables + products, order_status, extra order fields)
async function dbEnsureSchema() {
  // Base tables (mirrors schema.sql) to support remote DBs without init scripts
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    first_name VARCHAR(80) NOT NULL,
    last_name VARCHAR(80) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT');

  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');

  await pool.query(`CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    user_email VARCHAR(190) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id)');

  await pool.query(`CREATE TABLE IF NOT EXISTS favorites (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    game_name VARCHAR(120) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_fav UNIQUE (user_id, game_name)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id)');

  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    user_email VARCHAR(190) NOT NULL,
    game VARCHAR(120) NOT NULL,
    package VARCHAR(120) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    player_id VARCHAR(120) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Tamamlandı',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)');

  // Transactions for balance history
  await pool.query(`CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(10) NOT NULL, -- credit | debit
    status VARCHAR(20) NOT NULL DEFAULT 'approved',
    ref VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)');

  // Avatar upload requests
  await pool.query(`CREATE TABLE IF NOT EXISTS avatar_requests (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    image_url TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    approved_by VARCHAR(36),
    approved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_avatar_user_id ON avatar_requests(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_avatar_status ON avatar_requests(status)');

  // Admins table (in addition to users.is_admin flag)
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (
    user_id VARCHAR(36) PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // Additional tables and columns for new features
  await pool.query(`CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(36) PRIMARY KEY,
    game VARCHAR(120) NOT NULL,
    title VARCHAR(160) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    image_url TEXT,
    available BOOLEAN NOT NULL DEFAULT true,
    delivery_minutes INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS order_status (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    label VARCHAR(80) NOT NULL
  )`);
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_id VARCHAR(36)');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_id INTEGER');

  // Seed order statuses
  const { rows: st } = await pool.query('SELECT COUNT(*)::int AS c FROM order_status');
  if (!st[0] || st[0].c === 0) {
    await pool.query(`INSERT INTO order_status (code, label) VALUES
      ('pending','Gözləmədə'),
      ('processing','Emal edilir'),
      ('completed','Tamamlandı'),
      ('failed','Uğursuz')`);
  }

  // Seed PUBG products if empty
  const { rows: pc } = await pool.query("SELECT COUNT(*)::int AS c FROM products WHERE LOWER(game)='pubg mobile' OR LOWER(game)='pubg'");
  if (!pc[0] || pc[0].c === 0) {
    const pid1 = crypto.randomUUID();
    const pid2 = crypto.randomUUID();
    const pid3 = crypto.randomUUID();
    await pool.query(
      'INSERT INTO products (id, game, title, price, image_url, available, delivery_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14),($15,$16,$17,$18,$19,$20,$21)',
      [
        pid1,'PUBG Mobile','60 UC',2.99,'https://i.imgur.com/1qfQbVZ.png',true,5,
        pid2,'PUBG Mobile','325 UC',14.49,'https://i.imgur.com/1qfQbVZ.png',true,5,
        pid3,'PUBG Mobile','660 UC',27.99,'https://i.imgur.com/1qfQbVZ.png',true,5
      ]
    );
  }
}

async function products(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const game = (url.searchParams.get('game') || '').trim().toLowerCase();
  let sql = 'SELECT * FROM products';
  const params = [];
  if (game) { sql += ' WHERE LOWER(game) = $1 OR LOWER(game) = $2'; params.push(game, game + ' mobile'); }
  const { rows } = await pool.query(sql, params);
  sendJson(response, 200, { products: rows });
}

async function adminCreateProduct(request, response) {
  const admin = await requireAdmin(request, response); if (!admin) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const id = crypto.randomUUID();
  const { game = 'PUBG Mobile', title = 'Package', price = 1.0, imageUrl = '', available = true, deliveryMinutes = 5 } = body;
  await pool.query('INSERT INTO products (id, game, title, price, image_url, available, delivery_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, String(game), String(title), Number(price), String(imageUrl), Boolean(available), Number(deliveryMinutes)]);
  const { rows } = await pool.query('SELECT * FROM products WHERE id=$1', [id]);
  sendJson(response, 201, { product: rows[0] });
}

async function adminUpdateProduct(request, response) {
  const admin = await requireAdmin(request, response); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const id = url.searchParams.get('id') || '';
  if (!id) return sendJson(response, 400, { message: 'id tələb olunur' });
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const map = { game: 'game', title: 'title', price: 'price', imageUrl: 'image_url', available: 'available', deliveryMinutes: 'delivery_minutes' };
  const sets = [];
  const values = [];
  for (const key in map) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const col = map[key];
      const val = key === 'price' ? Number(body[key]) : key === 'available' ? Boolean(body[key]) : key === 'deliveryMinutes' ? Number(body[key]) : String(body[key]);
      sets.push(`${col} = $${sets.length + 1}`);
      values.push(val);
    }
  }
  if (sets.length === 0) return sendJson(response, 400, { message: 'Heç bir dəyişiklik yoxdur' });
  values.push(id);
  await pool.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  const { rows } = await pool.query('SELECT * FROM products WHERE id=$1', [id]);
  sendJson(response, 200, { product: rows[0] });
}

async function adminDeleteProduct(request, response) {
  const admin = await requireAdmin(request, response); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const id = url.searchParams.get('id') || '';
  if (!id) return sendJson(response, 400, { message: 'id tələb olunur' });
  await pool.query('DELETE FROM products WHERE id = $1', [id]);
  sendJson(response, 200, { message: 'Silindi' });
}

async function createOrder(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const productId = String(body.productId || '').trim();
  const quantity = Number(body.quantity || 1);
  const playerId = String(body.playerId || '').trim();
  const contactEmail = String(body.email || user.email).trim().toLowerCase();
  if (!productId || quantity <= 0 || !playerId) return sendJson(response, 400, { message: 'Məlumatlar tam deyil.' });
  const { rows: pr } = await pool.query('SELECT * FROM products WHERE id = $1 LIMIT 1', [productId]);
  if (pr.length === 0) return sendJson(response, 404, { message: 'Məhsul tapılmadı.' });
  const prod = pr[0];
  if (!prod.available) return sendJson(response, 400, { message: 'Məhsul hazırda mövcud deyil.' });
  const priceTotal = Number(prod.price) * quantity;
  const { rows: st } = await pool.query("SELECT id FROM order_status WHERE code='pending' LIMIT 1");
  const statusId = st[0]?.id || null;
  const orderId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO orders (id, user_id, user_email, game, package, price, player_id, status, product_id, quantity, status_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [orderId, user.id, contactEmail, prod.game, prod.title, priceTotal, playerId, 'Gözləmədə', productId, quantity, statusId]
  );
  sendJson(response, 201, { message: 'Sifariş yaradıldı.', order: { id: orderId, status: 'Gözləmədə', price: priceTotal } });
}

async function listMyOrders(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const { rows } = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC NULLS LAST', [user.id]);
  sendJson(response, 200, { orders: rows });
}

async function adminListOrders(request, response) {
  const admin = await requireAdmin(request, response); if (!admin) return;
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC NULLS LAST');
  sendJson(response, 200, { orders: rows });
}

async function adminListUsers(request, response) {
  const admin = await requireAdmin(request, response); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (q) {
    const like = `%${q}%`;
    const { rows } = await pool.query(
      'SELECT id, username, name, first_name, last_name, email, balance, created_at, is_admin FROM users WHERE LOWER(username) LIKE $1 OR LOWER(email) LIKE $1 OR LOWER(name) LIKE $1 ORDER BY created_at DESC',
      [like]
    );
    return sendJson(response, 200, { users: rows });
  } else {
    const { rows } = await pool.query('SELECT id, username, name, first_name, last_name, email, balance, created_at, is_admin FROM users ORDER BY created_at DESC');
    return sendJson(response, 200, { users: rows });
  }
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
  let userId = null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      userId = payload.sub;
    } catch {}
  }
  if (!userId) {
    userId = await dbGetSessionUserId(token);
  }
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
  let userId = null;
  if (token) {
    try { userId = jwt.verify(token, JWT_SECRET).sub; } catch {}
  }
  if (!userId) userId = await dbGetSessionUserId(token);
  if (!userId) return sendJson(response, 401, { message: 'Sessiya aktiv deyil.' });

  const user = await dbFindUserById(userId);
  if (!user) return sendJson(response, 401, { message: 'İstifadəçi tapılmadı.' });
  sendJson(response, 200, { user: sanitizeUser(user) });
}

// JWT-based auth endpoints (new)
async function authRegister(request, response) {
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const username = String(body.username || '').trim().toLowerCase();
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const name = `${firstName} ${lastName}`.trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!/^[a-z0-9_]{3,24}$/.test(username)) return sendJson(response, 400, { message: 'Username 3-24 simvol olmalı və yalnız hərf, rəqəm, _ qəbul edir.' });
  if (firstName.length < 2) return sendJson(response, 400, { message: 'Ad ən az 2 simvol olmalıdır.' });
  if (lastName.length < 2) return sendJson(response, 400, { message: 'Soyad ən az 2 simvol olmalıdır.' });
  if (!/\S+@\S+\.\S+/.test(email)) return sendJson(response, 400, { message: 'Düzgün email daxil edin.' });
  if (password.length < 6) return sendJson(response, 400, { message: 'Şifrə ən az 6 simvol olmalıdır.' });

  const exists = await dbCheckUserExists(email, username);
  if (exists) return sendJson(response, 409, { message: 'Bu email və ya istifadəçi adı artıq qeydiyyatdan keçib.' });

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
  const token = signJwt(user.id, true);
  sendJson(response, 201, { message: 'Qeydiyyat uğurludur.', token, user: sanitizeUser(user) });
}

async function authLogin(request, response) {
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const remember = Boolean(body.remember ?? true);
  const user = await dbFindUserByIdentifier(identifier);
  if (!user || !verifyPassword(password, user.password_hash)) return sendJson(response, 401, { message: 'Email və ya şifrə yanlışdır.' });
  const token = signJwt(user.id, remember);
  sendJson(response, 200, { message: 'Giriş uğurludur.', token, user: sanitizeUser(user) });
}

function signJwt(userId, remember = true) {
  const expiresIn = remember ? '7d' : '1d';
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn });
}

function isAdmin(user) { return Boolean(user.is_admin); }

async function requireAdmin(request, response) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!isAdmin(user)) { sendJson(response, 403, { message: 'İcazə yoxdur' }); return null; }
  return user;
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
  // record transaction (credit)
  await dbCreateTransaction(user.id, amount, 'credit', 'approved', 'Manual topup');
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
  // record transaction (debit)
  await dbCreateTransaction(user.id, price, 'debit', 'approved', `Purchase: ${packageName}`);

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
  // Map pretty paths like /pubg to /pubg.html, then resolve safely under ROOT
  const pretty = url.pathname === '/' ? 'index.html'
    : (url.pathname === '/pubg' || url.pathname === '/pubg/') ? 'pubg.html'
    : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const relPath = pretty;
  const filePath = path.resolve(ROOT, relPath);

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
    if (request.method === 'POST' && request.url === '/api/auth/register') return await authRegister(request, response);
    if (request.method === 'POST' && request.url === '/api/auth/login') return await authLogin(request, response);
    if (request.method === 'POST' && request.url === '/api/logout') return await logout(request, response);
    if (request.method === 'GET' && request.url === '/api/me') return await currentUser(request, response);
    if (request.method === 'GET' && request.url === '/api/profile') return await profile(request, response);
    if ((request.method === 'POST' || request.method === 'PUT') && request.url === '/api/profile') return await updateProfile(request, response);
    if (request.method === 'POST' && request.url === '/api/topup') return await topup(request, response);
    if (request.method === 'POST' && request.url === '/api/password') return await updatePassword(request, response);
    if (request.method === 'POST' && request.url === '/api/support') return await support(request, response);
    if (request.method === 'POST' && request.url === '/api/favorites/toggle') return await toggleFavorite(request, response);
    if (request.method === 'POST' && request.url === '/api/buy') return await buyProduct(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/products')) return await products(request, response);
    if (request.method === 'POST' && request.url === '/api/orders') return await createOrder(request, response);
    if (request.method === 'GET' && request.url === '/api/orders') return await listMyOrders(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/products') return await adminCreateProduct(request, response);
    if (request.method === 'PUT' && request.url.startsWith('/api/admin/products')) return await adminUpdateProduct(request, response);
    if (request.method === 'DELETE' && request.url.startsWith('/api/admin/products')) return await adminDeleteProduct(request, response);
    if (request.method === 'GET' && request.url === '/api/admin/orders') return await adminListOrders(request, response);
    if (request.method === 'GET' && request.url === '/api/admin/users') return await adminListUsers(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/balance/adjust') return await adminAdjustBalance(request, response);
    if (request.method === 'POST' && request.url === '/api/avatar/requests') return await submitAvatarRequest(request, response);
    if (request.method === 'GET' && request.url === '/api/avatar/requests') return await listMyAvatarRequests(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/avatar/requests')) return await adminListAvatarRequests(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/avatar/approve') return await adminApproveAvatar(request, response);
    if (request.method === 'GET') return await serveStatic(request, response);

    response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'Method not allowed' }));
  } catch (error) {
    sendJson(response, 500, { message: 'Server xətası baş verdi.' });
  }
});

// Try connecting to PostgreSQL, but start HTTP server regardless so static files work
(async () => {
  try {
    await pool.query('SELECT NOW()');
    await dbEnsureSchema();
    console.log('PostgreSQL connection successful.');
  } catch (error) {
    console.error(`[Warn] PostgreSQL connection failed. Details: ${error.message}`);
    console.error('Starting server in static-only mode; APIs may return errors until DB is available.');
  } finally {
    server.listen(PORT, () => {
      console.log(`ZELIX TOPUP running at http://localhost:${PORT}`);
    });
  }
})();
