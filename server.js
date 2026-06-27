const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const admin = require('./admin-routes');
const { auditLog: dbAuditLog, extractClientIp } = require('./lib/audit');
// Allow injecting DATABASE_URL at runtime via process.env.__INJECT_DATABASE_URL
if (process.env.__INJECT_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.__INJECT_DATABASE_URL;
  if (!process.env.PGSSLMODE) process.env.PGSSLMODE = 'require';
}

// ==========================================
// SIMPLE IN-MEMORY CACHE (TTL)
// ==========================================
const cache = new Map();
function cacheGet(key, ttlMs = 30000) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) { cache.delete(key); return null; }
  return entry.value;
}
function cacheSet(key, value) { cache.set(key, { value, ts: Date.now() }); }
function cacheInvalidate(pattern) {
  for (const key of cache.keys()) { if (key.includes(pattern)) cache.delete(key); }
}

// ==========================================
// HEALTH CHECK
// ==========================================
async function healthCheck(request, response) {
  try {
    const { rows: dbTime } = await pool.query('SELECT NOW() AS t');
    const requiredColumns = [
      { table: 'users', columns: ['status', 'membership_level', 'deleted_at', 'updated_at'] },
      { table: 'admins', columns: ['active', 'updated_at', 'role'] },
      { table: 'products', columns: ['is_active', 'hidden', 'updated_by', 'updated_at'] },
      { table: 'orders', columns: ['status_code', 'total_amount', 'rejection_reason', 'refunded_amount'] },
      { table: 'coupons', columns: ['active', 'vip_only', 'premium_only'] },
      { table: 'categories', columns: ['status', 'is_active', 'display_order', 'featured', 'popular'] }
    ];
    const missing = [];
    for (const { table, columns } of requiredColumns) {
      const { rows } = await pool.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = ANY($3)',
        ['public', table, columns]
      );
      const found = new Set(rows.map(r => r.column_name));
      for (const col of columns) {
        if (!found.has(col)) missing.push(`${table}.${col}`);
      }
    }
    if (missing.length) {
      return sendJson(response, 503, { success: false, status: 'unhealthy', database: 'connected', missingColumns: missing });
    }
    sendJson(response, 200, { success: true, status: 'healthy', database: 'connected', time: dbTime[0].t });
  } catch (e) {
    sendJson(response, 503, { success: false, status: 'unhealthy', database: 'error', error: e.message });
  }
}

// ==========================================
// AUDIT LOGGER
// ==========================================
function auditLog(event, payload = {}) {
  const { req, ...rest } = payload;
  dbAuditLog(pool, {
    action: event,
    admin: payload.admin || null,
    req,
    targetType: payload.targetType || null,
    targetId: payload.targetId || null,
    oldValue: payload.oldValue || null,
    newValue: payload.newValue || null,
    meta: Object.keys(rest).length ? rest : null
  });
}

// ==========================================
// TRANSACTIONS AND AVATAR REQUESTS (NEW)
// ==========================================

async function dbCreateTransaction(userId, amount, type, status = 'approved', ref = null, category = null, description = null) {
  const id = crypto.randomUUID();
  // Derive a sensible category if not provided (deposit/purchase/refund/admin_adjustment)
  const cat = category || (type === 'credit' ? 'deposit' : type === 'debit' ? 'purchase' : 'admin_adjustment');
  await pool.query(
    'INSERT INTO transactions (id, user_id, amount, type, status, ref, category, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, userId, Number(amount), String(type), String(status), ref ? String(ref) : null, String(cat), description ? String(description) : (ref ? String(ref) : null)]
  );
  return id;
}

async function dbCreateNotification(userId, title, message, type = 'system') {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO notifications (id, user_id, title, message, type) VALUES ($1,$2,$3,$4,$5)',
    [id, userId, String(title), String(message), String(type)]
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
  const admin = await requireAdminApi(request, response, 'avatars.view'); if (!admin) return;
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
  const admin = await requireAdminApi(request, response, 'avatars.manage'); if (!admin) return;
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
  const admin = await requireAdminApi(request, response, 'users.balance'); if (!admin) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const userId = String(body.userId || body.user_id || '').trim();
  const amount = Number(body.amount || 0);
  const reason = String(body.reason || 'Admin adjustment');
  if (!userId || !Number.isFinite(amount) || amount === 0) return sendJson(response, 400, { message: 'userId və düzgün amount tələb olunur' });
  const usr = await dbFindUserById(userId);
  if (!usr) return sendJson(response, 404, { message: 'İstifadəçi tapılmadı' });
  await dbUpdateBalance(userId, amount);
  await dbCreateTransaction(userId, Math.abs(amount), amount > 0 ? 'credit' : 'debit', 'approved', reason, 'balance', reason);
  await dbCreateNotification(userId, amount > 0 ? 'Balans artırıldı' : 'Balans azaldıldı', 'Hesabınız ' + Math.abs(amount).toFixed(2) + ' ₼ ' + (amount > 0 ? 'əlavə edildi' : 'azaldıldı') + '.', 'balance');
  ssePushState(userId);
  if (amount > 0) recalcMembership(userId).catch(() => {});
  const updated = await dbFindUserById(userId);
  sendJson(response, 200, { message: 'Balans yeniləndi', user: sanitizeUser(updated) });
}
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 8091;
const ROOT = __dirname;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Set a long random secret (e.g. node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))") and restart the server.');
  process.exit(1);
}

// Prefer DATABASE_URL if provided (e.g., on Render). Fall back to discrete vars locally.
function buildPoolConfig() {
  const isLocalhost = (host) => !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (process.env.DATABASE_URL) {
    let ssl = undefined;
    // Render (and most managed Postgres providers) require SSL. Enable it automatically
    // unless explicitly disabled with DB_SSL=false. Use rejectUnauthorized:false for providers
    // that use self-signed certificates.
    if (process.env.DB_SSL !== 'false') {
      ssl = { rejectUnauthorized: false };
    }
    return {
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    };
  }
  const host = process.env.DB_HOST || 'localhost';
  const ssl = (!isLocalhost(host) || process.env.DB_SSL === 'true' || process.env.PGSSLMODE === 'require')
    ? { rejectUnauthorized: false }
    : undefined;
  return {
    host,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'zelix_topup',
    ssl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  };
}
const pool = new Pool(buildPoolConfig());

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
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '7 days'
  )`);
  await pool.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP');
  await pool.query("UPDATE sessions SET expires_at = created_at + INTERVAL '7 days' WHERE expires_at IS NULL");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

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

  // Deposit (receipt upload) requests
  await pool.query(`CREATE TABLE IF NOT EXISTS deposit_requests (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    receipt_image VARCHAR(255) NOT NULL,
    requested_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    admin_note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_deposit_user_id ON deposit_requests(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_deposit_status ON deposit_requests(status)');

  // Extend transactions to support richer categories/descriptions (backward compatible)
  await pool.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'admin_adjustment'");
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS description TEXT');

  // Shopping cart items (one active cart per user, keyed by product)
  await pool.query(`CREATE TABLE IF NOT EXISTS cart_items (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_cart_item UNIQUE (user_id, product_id)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cart_user_id ON cart_items(user_id)');

  // User notifications / message center
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    title VARCHAR(160) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'system', -- system | purchase | balance | promotion | support
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read)');

  // Additional tables and columns for new features
  await pool.query(`CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    image_url TEXT,
    banner_image_url TEXT,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    featured BOOLEAN NOT NULL DEFAULT false,
    popular BOOLEAN NOT NULL DEFAULT false,
    seo_title VARCHAR(160),
    seo_description TEXT,
    og_image_url TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS banner_image_url TEXT');
  await pool.query("ALTER TABLE categories ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'");
  await pool.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS popular BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS seo_title VARCHAR(160)');
  await pool.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS seo_description TEXT');
  await pool.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS og_image_url TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_categories_order ON categories(display_order, featured, popular)');

  await pool.query(`CREATE TABLE IF NOT EXISTS category_fields (
    id VARCHAR(36) PRIMARY KEY,
    category_id VARCHAR(36) NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    label VARCHAR(120) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'text',
    required BOOLEAN NOT NULL DEFAULT false,
    options JSONB DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_category_fields_category ON category_fields(category_id, sort_order)');

  await pool.query(`CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(36) PRIMARY KEY,
    category_id VARCHAR(36),
    game VARCHAR(120) NOT NULL,
    title VARCHAR(160) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    old_price DECIMAL(10,2),
    discount_percent INTEGER NOT NULL DEFAULT 0,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    image_url TEXT,
    description TEXT,
    available BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_featured BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    delivery_minutes INTEGER NOT NULL DEFAULT 5,
    badges JSONB DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id VARCHAR(36)');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS old_price DECIMAL(10,2)');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_percent INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false');
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS badges JSONB DEFAULT '[]'");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active, available)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_products_sort ON products(category_id, sort_order)');

  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_fields JSONB');
  await pool.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS custom_fields JSONB');

  await pool.query(`CREATE TABLE IF NOT EXISTS order_status (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    label VARCHAR(80) NOT NULL
  )`);
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_id VARCHAR(36)');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_id INTEGER');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_code VARCHAR(40)');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount DECIMAL(10,2)');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_status_code ON orders(status_code)');

  await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id)');

  // Seed order statuses (pending, processing, completed, rejected)
  const { rows: st } = await pool.query('SELECT COUNT(*)::int AS c FROM order_status');
  if (!st[0] || st[0].c === 0) {
    await pool.query(`INSERT INTO order_status (code, label) VALUES
      ('pending','Gözləmədə'),
      ('processing','Emal edilir'),
      ('completed','Tamamlandı'),
      ('rejected','Rədd edildi')`);
  } else {
    await pool.query(`INSERT INTO order_status (code, label) VALUES ('rejected','Rədd edildi')
      ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label`);
  }

  // Profile dashboard membership & coupon schema
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_level TEXT NOT NULL DEFAULT \'standard\'');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_membership ON users(membership_level)');

  await pool.query(`CREATE TABLE IF NOT EXISTS coupons (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(60) NOT NULL UNIQUE,
    discount_type VARCHAR(20) NOT NULL,
    discount_value DECIMAL(10,2) NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 0,
    used_count INTEGER NOT NULL DEFAULT 0,
    min_order_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    public BOOLEAN NOT NULL DEFAULT false,
    assigned_only BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    start_date TIMESTAMP NULL,
    expiry_date TIMESTAMP NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(active, expiry_date)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_coupons_public ON coupons(public, active)');

  await pool.query(`CREATE TABLE IF NOT EXISTS user_coupons (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coupon_id VARCHAR(36) NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    uses_left INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_coupon UNIQUE (user_id, coupon_id)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_coupons_user ON user_coupons(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_coupons_coupon ON user_coupons(coupon_id)');

  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id VARCHAR(36)');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_coupon ON orders(coupon_id)');

  // Migrate legacy orders to order_items (one item per legacy order)
  const { rows: unmigrated } = await pool.query(`
    SELECT o.id, o.product_id, o.quantity, o.price, o.status
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.product_id IS NOT NULL AND oi.id IS NULL
    LIMIT 500
  `);
  for (const o of unmigrated) {
    const itemId = crypto.randomUUID();
    const qty = Number(o.quantity || 1);
    const unit = Number(o.price || 0) / (qty || 1);
    await pool.query(
      'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, total_price) VALUES ($1,$2,$3,$4,$5,$6)',
      [itemId, o.id, o.product_id, qty, unit, o.price]
    );
    const code = (o.status || '').toLowerCase() === 'tamamlandı' ? 'completed' : 'pending';
    await pool.query('UPDATE orders SET status_code = $1 WHERE id = $2', [code, o.id]);
  }

  // Migrate categories from product games and link products
  const { rows: uncategorized } = await pool.query('SELECT DISTINCT game FROM products WHERE category_id IS NULL AND game IS NOT NULL');
  for (const g of uncategorized) {
    const name = g.game;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game-' + crypto.randomUUID().slice(0,8);
    const cid = crypto.randomUUID();
    await pool.query(
      `INSERT INTO categories (id, name, slug, image_url, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [cid, name, slug, '/assets/' + slug + '-banner.jpg', name + ' Top-Up']
    );
    await pool.query('UPDATE products SET category_id = c.id FROM categories c WHERE products.category_id IS NULL AND LOWER(products.game) = LOWER(c.name) AND c.name = $1', [name]);
  }

  // Seed PUBG products if empty
  const { rows: pc } = await pool.query("SELECT COUNT(*)::int AS c FROM products WHERE LOWER(game)='pubg mobile' OR LOWER(game)='pubg'");
  if (!pc[0] || pc[0].c === 0) {
    let pubgCat = await pool.query("SELECT id FROM categories WHERE slug = 'pubg-mobile' LIMIT 1");
    let cid = pubgCat.rows[0]?.id;
    if (!cid) {
      cid = crypto.randomUUID();
      await pool.query('INSERT INTO categories (id, name, slug, image_url, description, is_active) VALUES ($1,$2,$3,$4,$5,true)', [cid, 'PUBG Mobile', 'pubg-mobile', '/assets/pubg-banner.jpg', 'PUBG Mobile UC Top-Up']);
    }
    const pid1 = crypto.randomUUID();
    const pid2 = crypto.randomUUID();
    const pid3 = crypto.randomUUID();
    const pid4 = crypto.randomUUID();
    await pool.query(
      'INSERT INTO products (id, category_id, game, title, price, image_url, available, delivery_minutes, is_active, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10),($11,$12,$13,$14,$15,$16,$17,$18,$19,$20),($21,$22,$23,$24,$25,$26,$27,$28,$29,$30),($31,$32,$33,$34,$35,$36,$37,$38,$39,$40)',
      [
        pid1, cid, 'PUBG Mobile', '60 UC', 2.99, '/assets/pubg-uc.png', true, 5, true, 1,
        pid2, cid, 'PUBG Mobile', '325 UC', 14.49, '/assets/pubg-uc.png', true, 5, true, 2,
        pid3, cid, 'PUBG Mobile', '660 UC', 27.99, '/assets/pubg-uc.png', true, 5, true, 3,
        pid4, cid, 'PUBG Mobile', '1800 UC', 69.99, '/assets/pubg-uc.png', true, 5, true, 4
      ]
    );
  }
}

async function products(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const game = (url.searchParams.get('game') || '').trim().toLowerCase();
  const categoryId = (url.searchParams.get('categoryId') || '').trim();
  const categorySlug = (url.searchParams.get('categorySlug') || '').trim().toLowerCase();
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  let sql = `SELECT p.*, c.name AS category_name, c.slug AS category_slug
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id`;
  const params = [];
  const conds = [];
  if (game) { conds.push('(LOWER(p.game) = $' + (params.length + 1) + ' OR LOWER(p.game) = $' + (params.length + 2) + ')'); params.push(game, game + ' mobile'); }
  if (categoryId) { conds.push('p.category_id = $' + (params.length + 1)); params.push(categoryId); }
  if (categorySlug) { conds.push('c.slug = $' + (params.length + 1)); params.push(categorySlug); }
  if (q) { conds.push('(LOWER(p.title) LIKE $' + (params.length + 1) + ' OR LOWER(p.game) LIKE $' + (params.length + 1) + ')'); params.push('%' + q + '%'); }
  // Public APIs only show active/available products
  conds.push('p.is_active = true');
  conds.push('p.available = true');
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY p.sort_order ASC, p.created_at DESC';
  const { rows } = await pool.query(sql, params);
  sendJson(response, 200, { products: rows });
}

async function productGet(request, response, productId) {
  const { rows } = await pool.query(`SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = $1 AND p.is_active = true LIMIT 1`, [productId]);
  if (!rows.length) return sendJson(response, 404, { message: 'Məhsul tapılmadı.' });
  sendJson(response, 200, { product: rows[0] });
}

async function categoriesList(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const slug = (url.searchParams.get('slug') || '').trim().toLowerCase();
  const featured = url.searchParams.get('featured') === 'true';
  const popular = url.searchParams.get('popular') === 'true';
  const cacheKey = `categories:${slug}:${featured}:${popular}`;
  const cached = cacheGet(cacheKey, 30000);
  if (cached) return sendJson(response, 200, cached);
  let sql = 'SELECT * FROM categories';
  const params = [];
  const conds = [];
  if (slug) { conds.push('slug = $1'); params.push(slug); }
  else { conds.push("is_active = true AND status = 'active'"); }
  if (featured) { conds.push('featured = true'); }
  if (popular) { conds.push('popular = true'); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY display_order ASC, featured DESC, popular DESC, name ASC';
  const { rows } = await pool.query(sql, params);
  const result = { categories: rows };
  cacheSet(cacheKey, result);
  sendJson(response, 200, result);
}

async function categoryGet(request, response, slug) {
  const { rows } = await pool.query("SELECT * FROM categories WHERE slug = $1 AND is_active = true AND status = 'active' LIMIT 1", [slug]);
  if (!rows.length) return sendJson(response, 404, { message: 'Kateqoriya tapılmadı.' });
  const category = rows[0];
  const { rows: fields } = await pool.query('SELECT id, name, label, type, required, options, sort_order FROM category_fields WHERE category_id = $1 AND is_active = true ORDER BY sort_order ASC', [category.id]);
  category.fields = fields;
  sendJson(response, 200, { category });
}

async function categoryProducts(request, response, slug) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const { rows: catRows } = await pool.query("SELECT * FROM categories WHERE slug = $1 AND is_active = true AND status = 'active' LIMIT 1", [slug]);
  if (!catRows.length) return sendJson(response, 404, { message: 'Kateqoriya tapılmadı.' });
  const category = catRows[0];
  const { rows: fields } = await pool.query('SELECT id, name, label, type, required, options, sort_order FROM category_fields WHERE category_id = $1 AND is_active = true ORDER BY sort_order ASC', [category.id]);
  category.fields = fields;
  let sql = `SELECT p.* FROM products p WHERE p.category_id = $1 AND p.is_active = true AND p.available = true`;
  const params = [category.id];
  if (q) { sql += ' AND (LOWER(p.title) LIKE $' + (params.length + 1) + ' OR LOWER(p.game) LIKE $' + (params.length + 1) + ')'; params.push('%' + q + '%'); }
  sql += ' ORDER BY p.sort_order ASC, p.created_at DESC';
  const { rows } = await pool.query(sql, params);
  sendJson(response, 200, { category, products: rows });
}

async function adminCreateProduct(request, response) {
  const admin = await requireAdminApi(request, response, 'products.manage'); if (!admin) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const id = crypto.randomUUID();
  const {
    categoryId = null, game = 'PUBG Mobile', title = 'Package', price = 1.0,
    oldPrice = null, discountPercent = 0, stockQuantity = 0,
    imageUrl = '', description = '', available = true, isActive = true, isFeatured = false,
    deliveryMinutes = 5, sortOrder = 0, badges = []
  } = body;
  await pool.query(
    `INSERT INTO products (id, category_id, game, title, price, old_price, discount_percent, stock_quantity, image_url, description, available, is_active, is_featured, delivery_minutes, sort_order, badges, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())`,
    [id, categoryId || null, String(game), String(title), Number(price), oldPrice ? Number(oldPrice) : null, Number(discountPercent), Number(stockQuantity),
     String(imageUrl), String(description), Boolean(available), Boolean(isActive), Boolean(isFeatured),
     Number(deliveryMinutes), Number(sortOrder), JSON.stringify(badges)]
  );
  const { rows } = await pool.query('SELECT * FROM products WHERE id=$1', [id]);
  sendJson(response, 201, { product: rows[0] });
}

async function adminUpdateProduct(request, response) {
  const admin = await requireAdminApi(request, response, 'products.manage'); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const id = url.searchParams.get('id') || '';
  if (!id) return sendJson(response, 400, { message: 'id tələb olunur' });
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const map = {
    categoryId: 'category_id', game: 'game', title: 'title', price: 'price', oldPrice: 'old_price',
    discountPercent: 'discount_percent', stockQuantity: 'stock_quantity',
    imageUrl: 'image_url', description: 'description', available: 'available',
    isActive: 'is_active', isFeatured: 'is_featured', deliveryMinutes: 'delivery_minutes', sortOrder: 'sort_order'
  };
  const sets = ['updated_at = NOW()'];
  const values = [];
  for (const key in map) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const col = map[key];
      let val;
      if (['price','oldPrice'].includes(key)) val = body[key] ? Number(body[key]) : null;
      else if (key === 'available' || key === 'isActive' || key === 'isFeatured') val = Boolean(body[key]);
      else if (['discountPercent','stockQuantity','deliveryMinutes','sortOrder'].includes(key)) val = Number(body[key] || 0);
      else val = String(body[key] || '');
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (Array.isArray(body.badges)) {
    values.push(JSON.stringify(body.badges));
    sets.push(`badges = $${values.length}`);
  }
  if (sets.length === 1) return sendJson(response, 400, { message: 'Heç bir dəyişiklik yoxdur' });
  values.push(id);
  await pool.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  const { rows } = await pool.query('SELECT * FROM products WHERE id=$1', [id]);
  sendJson(response, 200, { product: rows[0] });
}

async function adminDeleteProduct(request, response) {
  const admin = await requireAdminApi(request, response, 'products.manage'); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const id = url.searchParams.get('id') || '';
  if (!id) return sendJson(response, 400, { message: 'id tələb olunur' });
  await pool.query('DELETE FROM products WHERE id = $1', [id]);
  sendJson(response, 200, { message: 'Silindi' });
}

async function adminProductsList(request, response) {
  const admin = await requireAdminApi(request, response, 'products.view'); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const cat = (url.searchParams.get('category') || '').trim();
  let sql = `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id`;
  const params = [];
  const conds = [];
  if (q) { conds.push('(LOWER(p.title) LIKE $' + (params.length + 1) + ' OR LOWER(p.game) LIKE $' + (params.length + 1) + ')'); params.push('%' + q + '%'); }
  if (cat) { conds.push('p.category_id = $' + (params.length + 1)); params.push(cat); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY p.sort_order ASC, p.created_at DESC';
  const { rows } = await pool.query(sql, params);
  sendJson(response, 200, { products: rows });
}

async function adminCategoriesList(request, response) {
  const admin = await requireAdminApi(request, response, 'categories.view'); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  let sql = `SELECT c.*,
    (SELECT COUNT(*)::int FROM products WHERE category_id = c.id) AS product_count,
    (SELECT COUNT(*)::int FROM orders WHERE game = c.name OR game IN (SELECT game FROM products WHERE category_id = c.id)) AS order_count,
    (SELECT COALESCE(SUM(total_amount),0)::numeric FROM orders WHERE game = c.name OR game IN (SELECT game FROM products WHERE category_id = c.id)) AS revenue
    FROM categories c`;
  const params = [];
  if (q) { sql += ' WHERE LOWER(c.name) LIKE $1 OR LOWER(c.slug) LIKE $1'; params.push('%' + q + '%'); }
  sql += ' ORDER BY c.display_order ASC, c.featured DESC, c.popular DESC, c.name ASC';
  const { rows } = await pool.query(sql, params);
  const cats = [];
  for (const c of rows) {
    const { rows: fields } = await pool.query('SELECT * FROM category_fields WHERE category_id = $1 ORDER BY sort_order', [c.id]);
    cats.push({ ...c, fields });
  }
  sendJson(response, 200, { categories: cats });
}

async function adminCreateCategory(request, response) {
  const admin = await requireAdminApi(request, response, 'categories.manage'); if (!admin) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const name = String(body.name || '').trim();
  if (!name) return sendJson(response, 400, { message: 'Ad tələb olunur.' });
  const slug = String(body.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = crypto.randomUUID();
  const status = ['active','hidden','draft','archived'].includes(String(body.status || '').toLowerCase()) ? String(body.status).toLowerCase() : 'active';
  try {
    await pool.query(
      `INSERT INTO categories (id, name, slug, image_url, banner_image_url, description, status, is_active, display_order, featured, popular, seo_title, seo_description, og_image_url, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())`,
      [id, name, slug, String(body.imageUrl || ''), String(body.bannerImageUrl || ''), String(body.description || ''),
       status, status === 'active', Number(body.displayOrder || 0), Boolean(body.featured), Boolean(body.popular),
       String(body.seoTitle || ''), String(body.seoDescription || ''), String(body.ogImageUrl || '')]
    );
    if (Array.isArray(body.fields)) {
      for (let i = 0; i < body.fields.length; i++) {
        const f = body.fields[i];
        await pool.query(
          `INSERT INTO category_fields (id, category_id, name, label, type, required, options, sort_order, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [crypto.randomUUID(), id, String(f.name || ''), String(f.label || ''), String(f.type || 'text'), Boolean(f.required),
           JSON.stringify(f.options || []), Number(f.sortOrder || i), f.isActive !== false]
        );
      }
    }
  } catch (e) {
    if (e.code === '23505') return sendJson(response, 409, { message: 'Bu slug artıq istifadə edilir.' });
    throw e;
  }
  const { rows } = await pool.query('SELECT * FROM categories WHERE id=$1', [id]);
  const { rows: fields } = await pool.query('SELECT * FROM category_fields WHERE category_id = $1 ORDER BY sort_order', [id]);
  cacheInvalidate('categories:');
  sendJson(response, 201, { category: { ...rows[0], fields } });
}

async function adminUpdateCategory(request, response) {
  const admin = await requireAdminApi(request, response, 'categories.manage'); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const id = url.searchParams.get('id') || '';
  if (!id) return sendJson(response, 400, { message: 'id tələb olunur' });
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const map = {
    name: 'name', slug: 'slug', imageUrl: 'image_url', bannerImageUrl: 'banner_image_url', description: 'description',
    status: 'status', isActive: 'is_active', displayOrder: 'display_order', featured: 'featured', popular: 'popular',
    seoTitle: 'seo_title', seoDescription: 'seo_description', ogImageUrl: 'og_image_url'
  };
  const sets = ['updated_at = NOW()'];
  const values = [];
  for (const key in map) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const col = map[key];
      let val;
      if (key === 'isActive') val = Boolean(body[key]);
      else if (key === 'featured' || key === 'popular') val = Boolean(body[key]);
      else if (key === 'displayOrder') val = Number(body[key] || 0);
      else if (key === 'status') val = ['active','hidden','draft','archived'].includes(String(body[key]).toLowerCase()) ? String(body[key]).toLowerCase() : 'active';
      else if (key === 'slug') val = String(body[key] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      else val = String(body[key] || '');
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (sets.length > 1) {
    values.push(id);
    try {
      await pool.query(`UPDATE categories SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    } catch (e) {
      if (e.code === '23505') return sendJson(response, 409, { message: 'Bu slug artıq istifadə edilir.' });
      throw e;
    }
  }
  // Replace category fields if provided
  if (Array.isArray(body.fields)) {
    await pool.query('DELETE FROM category_fields WHERE category_id = $1', [id]);
    for (let i = 0; i < body.fields.length; i++) {
      const f = body.fields[i];
      await pool.query(
        `INSERT INTO category_fields (id, category_id, name, label, type, required, options, sort_order, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [crypto.randomUUID(), id, String(f.name || ''), String(f.label || ''), String(f.type || 'text'), Boolean(f.required),
         JSON.stringify(f.options || []), Number(f.sortOrder || i), f.isActive !== false]
      );
    }
  }
  const { rows } = await pool.query('SELECT * FROM categories WHERE id=$1', [id]);
  const { rows: fields } = await pool.query('SELECT * FROM category_fields WHERE category_id = $1 ORDER BY sort_order', [id]);
  cacheInvalidate('categories:');
  sendJson(response, 200, { category: { ...rows[0], fields } });
}

async function adminDeleteCategory(request, response) {
  const admin = await requireAdminApi(request, response, 'categories.manage'); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const id = url.searchParams.get('id') || '';
  if (!id) return sendJson(response, 400, { message: 'id tələb olunur' });
  await pool.query('DELETE FROM category_fields WHERE category_id = $1', [id]);
  await pool.query('UPDATE products SET category_id = NULL WHERE category_id = $1', [id]);
  await pool.query('DELETE FROM categories WHERE id = $1', [id]);
  cacheInvalidate('categories:');
  sendJson(response, 200, { message: 'Silindi' });
}

async function adminUploadImage(request, response) {
  const admin = await requireAdminApi(request, response, 'products.manage'); if (!admin) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const dataUrl = String(body.image || '');
  const folder = String(body.folder || 'images').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!dataUrl.startsWith('data:image/')) return sendJson(response, 400, { message: 'Şəkil formatı düzgün deyil.' });
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,/i);
  if (!match) return sendJson(response, 400, { message: 'Dəstəklənməyən şəkil formatı.' });
  const ext = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
  const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > 5 * 1024 * 1024) return sendJson(response, 400, { message: 'Şəkil həcmi 5MB-dan çox olmamalıdır.' });
  const fileName = crypto.randomUUID() + '.' + ext;
  const uploadDir = path.join(__dirname, 'uploads', folder);
  await fs.mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, fileName);
  await fs.writeFile(filePath, buf);
  const publicUrl = '/uploads/' + folder + '/' + fileName;
  sendJson(response, 200, { url: publicUrl, fileName });
}

async function adminDuplicateCategory(request, response) {
  const admin = await requireAdminApi(request, response, 'categories.manage'); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const id = url.searchParams.get('id') || '';
  if (!id) return sendJson(response, 400, { message: 'id tələb olunur' });
  const { rows: srcRows } = await pool.query('SELECT * FROM categories WHERE id = $1 LIMIT 1', [id]);
  if (!srcRows.length) return sendJson(response, 404, { message: 'Kateqoriya tapılmadı.' });
  const src = srcRows[0];
  const newId = crypto.randomUUID();
  let slug = src.slug + '-copy';
  for (let i = 2; ; i++) {
    const { rows } = await pool.query('SELECT 1 FROM categories WHERE slug = $1 LIMIT 1', [slug]);
    if (!rows.length) break;
    slug = src.slug + '-copy-' + i;
  }
  await pool.query(
    `INSERT INTO categories (id, name, slug, image_url, banner_image_url, description, status, is_active, display_order, featured, popular, seo_title, seo_description, og_image_url, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())`,
    [newId, src.name + ' (Kopya)', slug, src.image_url, src.banner_image_url, src.description, 'draft', false, 0, false, false,
     src.seo_title, src.seo_description, src.og_image_url]
  );
  const { rows: srcFields } = await pool.query('SELECT * FROM category_fields WHERE category_id = $1 ORDER BY sort_order', [id]);
  for (const f of srcFields) {
    await pool.query(
      `INSERT INTO category_fields (id, category_id, name, label, type, required, options, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [crypto.randomUUID(), newId, f.name, f.label, f.type, f.required, JSON.stringify(f.options || []), f.sort_order, f.is_active]
    );
  }
  const { rows } = await pool.query('SELECT * FROM categories WHERE id=$1', [newId]);
  const { rows: fields } = await pool.query('SELECT * FROM category_fields WHERE category_id = $1 ORDER BY sort_order', [newId]);
  cacheInvalidate('categories:');
  sendJson(response, 201, { category: { ...rows[0], fields } });
}

async function createOrder(request, response) {
  // Reuse checkout logic for single-product buy
  const user = await requireUser(request, response); if (!user) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const productId = String(body.productId || '').trim();
  const quantity = Number(body.quantity || 1);
  const playerId = String(body.playerId || '').trim();
  const contactEmail = String(body.email || user.email).trim().toLowerCase();
  const customFields = typeof body.customFields === 'object' && body.customFields !== null ? body.customFields : {};
  if (!productId || quantity <= 0 || !playerId) return sendJson(response, 400, { message: 'Məlumatlar tam deyil.' });
  const result = await createOrderInternal({ user, items: [{ productId, quantity }], playerId, contactEmail, customFields });
  if (!result.ok) return sendJson(response, result.status || 400, { message: result.message });
  sendJson(response, 201, { message: 'Sifariş yaradıldı.', order: result.order });
}

async function createOrderInternal({ user, items, playerId, contactEmail, customFields = {} }) {
  // items: [{ productId, quantity }]
  if (!Array.isArray(items) || items.length === 0) return { ok: false, message: 'Səbət boşdur.' };
  const orderId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Fetch products with lock
    const productIds = items.map(it => it.productId);
    const { rows: products } = await client.query(
      'SELECT id, game, title, price, image_url, available, is_active FROM products WHERE id = ANY($1) FOR UPDATE',
      [productIds]
    );
    const productMap = new Map(products.map(p => [p.id, p]));
    let subtotal = 0;
    const orderItems = [];
    for (const it of items) {
      const prod = productMap.get(it.productId);
      if (!prod) { await client.query('ROLLBACK'); return { ok: false, message: 'Məhsul tapılmadı.' }; }
      if (!prod.available || !prod.is_active) { await client.query('ROLLBACK'); return { ok: false, message: `${prod.title} hazırda mövcud deyil.` }; }
      const qty = Math.max(1, Math.min(99, Number(it.quantity || 1)));
      const lineTotal = Math.round(Number(prod.price) * qty * 100) / 100;
      subtotal += lineTotal;
      orderItems.push({ productId: prod.id, game: prod.game, title: prod.title, quantity: qty, unitPrice: Number(prod.price), totalPrice: lineTotal, imageUrl: prod.image_url });
    }
    const { rows: st } = await client.query("SELECT id FROM order_status WHERE code='pending' LIMIT 1");
    const statusId = st[0]?.id || null;

    // Check user balance
    const { rows: uRows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    const currentBalance = Number(uRows[0].balance || 0);
    if (currentBalance < subtotal) { await client.query('ROLLBACK'); return { ok: false, status: 400, message: 'Balansınız kifayət etmir. Balansınızı artırın.' }; }

    // Deduct balance
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [subtotal, user.id]);
    // Create order
    await client.query(
      'INSERT INTO orders (id, user_id, user_email, game, package, price, player_id, status, status_id, status_code, total_amount, custom_fields, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())',
      [orderId, user.id, contactEmail, orderItems[0].game, orderItems[0].title, subtotal, playerId, 'Gözləmədə', statusId, 'pending', subtotal, JSON.stringify(customFields)]
    );
    // Create order items
    for (const it of orderItems) {
      await client.query(
        'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, total_price, custom_fields) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [crypto.randomUUID(), orderId, it.productId, it.quantity, it.unitPrice, it.totalPrice, JSON.stringify(customFields)]
      );
    }
    // Transaction record
    await client.query(
      'INSERT INTO transactions (id, user_id, amount, type, status, ref, category, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [crypto.randomUUID(), user.id, subtotal, 'debit', 'approved', orderId, 'purchase', `Sifariş: ${orderItems.map(i => i.title + ' x' + i.quantity).join(', ')}`]
    );
    // Clear cart
    await client.query('DELETE FROM cart_items WHERE user_id = $1', [user.id]);
    // Notification
    await client.query(
      'INSERT INTO notifications (id, user_id, title, message, type) VALUES ($1,$2,$3,$4,$5)',
      [crypto.randomUUID(), user.id, 'Sifariş yaradıldı', `${orderItems[0].title} (${subtotal.toFixed(2)} AZN) sifarişiniz qəbul edildi.`, 'purchase']
    );
    auditLog('order_created', { orderId, userId: user.id, amount: subtotal, items: orderItems.map(i => ({ productId: i.productId, title: i.title, quantity: i.quantity, total: i.totalPrice })) });
    await client.query('COMMIT');
    ssePushState(user.id);
    return { ok: true, order: { id: orderId, status: 'pending', statusCode: 'pending', totalAmount: subtotal, items: orderItems } };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('createOrderInternal error:', e);
    return { ok: false, status: 500, message: 'Sifariş yaradılarkən xəta baş verdi.' };
  } finally {
    client.release();
  }
}

async function cartCheckout(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const playerId = String(body.playerId || '').trim();
  const contactEmail = String(body.email || user.email).trim().toLowerCase();
  const customFields = typeof body.customFields === 'object' && body.customFields !== null ? body.customFields : {};
  if (!playerId) return sendJson(response, 400, { message: 'Oyunçu ID tələb olunur.' });
  // Load cart
  const cart = await dbCartSummary(user.id);
  if (!cart.items.length) return sendJson(response, 400, { message: 'Səbət boşdur.' });
  const items = cart.items.map(it => ({ productId: it.productId, quantity: it.quantity }));
  const result = await createOrderInternal({ user, items, playerId, contactEmail, customFields });
  if (!result.ok) return sendJson(response, result.status || 400, { message: result.message });
  sendJson(response, 200, { message: 'Sifariş uğurla tamamlandı.', order: result.order });
}

async function orderWithItems(orderId) {
  const { rows: orders } = await pool.query('SELECT o.*, os.label AS status_label FROM orders o LEFT JOIN order_status os ON os.code = o.status_code WHERE o.id = $1 LIMIT 1', [orderId]);
  if (!orders.length) return null;
  const order = orders[0];
  const { rows: items } = await pool.query(
    `SELECT oi.*, p.title, p.game, p.image_url
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1 ORDER BY oi.created_at ASC`,
    [orderId]
  );
  order.items = items;
  return order;
}

async function listMyOrders(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const status = (url.searchParams.get('status') || '').trim().toLowerCase();
  let sql = 'SELECT id FROM orders WHERE user_id = $1';
  const params = [user.id];
  if (status) { sql += ' AND status_code = $2'; params.push(status); }
  sql += ' ORDER BY created_at DESC NULLS LAST';
  const { rows } = await pool.query(sql, params);
  const orders = [];
  for (const r of rows) {
    const o = await orderWithItems(r.id);
    if (o) orders.push(o);
  }
  sendJson(response, 200, { orders });
}

async function adminListOrders(request, response) {
  const admin = await requireAdminApi(request, response, 'orders.view'); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const status = (url.searchParams.get('status') || '').trim().toLowerCase();
  let sql = 'SELECT id FROM orders';
  const params = [];
  const conds = [];
  if (q) {
    conds.push('(LOWER(user_email) LIKE $' + (params.length + 1) + ' OR LOWER(game) LIKE $' + (params.length + 1) + ' OR id::text = $' + (params.length + 2) + ')');
    params.push('%' + q + '%', q);
  }
  if (status) { conds.push('status_code = $' + (params.length + 1)); params.push(status); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY created_at DESC NULLS LAST LIMIT 300';
  const { rows } = await pool.query(sql, params);
  const orders = [];
  for (const r of rows) {
    const o = await orderWithItems(r.id);
    if (o) orders.push(o);
  }
  sendJson(response, 200, { orders });
}

async function adminUpdateOrderStatus(request, response) {
  const admin = await requireAdminApi(request, response, 'orders.manage'); if (!admin) return;
  if (!verifyAdminCsrf(request)) return sendJson(response, 403, { success: false, message: 'CSRF token etibarsızdır.' });
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const orderId = String(body.orderId || '').trim();
  const newStatus = String(body.status || '').trim().toLowerCase();
  const rejectionReason = String(body.rejectionReason || '').trim();
  const refund = Boolean(body.refund);
  const adminNotes = String(body.adminNotes || '').trim();
  const allowed = ['pending', 'processing', 'completed', 'rejected'];
  if (!orderId || !allowed.includes(newStatus)) return sendJson(response, 400, { message: 'Yanlış status.' });
  if (newStatus === 'rejected' && !rejectionReason) return sendJson(response, 400, { message: 'Rədd səbəbi tələb olunur.' });
  const { rows: st } = await pool.query('SELECT id, label FROM order_status WHERE code = $1 LIMIT 1', [newStatus]);
  if (!st.length) return sendJson(response, 400, { message: 'Status tapılmadı.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: orderRows } = await client.query('SELECT * FROM orders WHERE id = $1 LIMIT 1 FOR UPDATE', [orderId]);
    if (!orderRows.length) throw new Error('Sifariş tapılmadı.');
    const order = orderRows[0];
    const oldStatus = order.status_code;
    const userId = order.user_id;
    const totalAmount = Number(order.total_amount || 0);
    let refundedAmount = 0;
    if (newStatus === 'rejected' && refund && totalAmount > 0) {
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [totalAmount, userId]);
      await client.query(
        'INSERT INTO transactions (id, user_id, amount, type, status, ref, category, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [crypto.randomUUID(), userId, totalAmount, 'credit', 'approved', orderId, 'refund', 'Sifariş rədd edildi, balans qaytarıldı']
      );
      refundedAmount = totalAmount;
    }
    await client.query(
      'UPDATE orders SET status_code = $1, status_id = $2, status = $3, rejection_reason = $4, admin_notes = $5, refunded_amount = $6, processed_by = $7, processed_at = NOW(), updated_at = NOW() WHERE id = $8',
      [newStatus, st[0].id, st[0].label, rejectionReason || null, adminNotes || null, refundedAmount, admin.id, orderId]
    );
    await client.query('COMMIT');

    const statusMessages = {
      pending: 'Sifarişiniz qəbul edildi.',
      processing: 'Sifarişiniz emal olunur.',
      completed: 'Sifarişiniz tamamlandı.',
      rejected: 'Sifarişiniz rədd edildi. Səbəb: ' + (rejectionReason || 'qeyd edilməyib')
    };
    await dbCreateNotification(userId, statusMessages[newStatus] || 'Sifariş statusu yeniləndi.', `Sifariş #${orderId} statusu: ${st[0].label}.`, 'purchase');
    auditLog('order_status_updated', { admin, req: request, targetType: 'order', targetId: orderId, oldValue: { status: oldStatus }, newValue: { status: newStatus, rejectionReason, refund, refundedAmount, adminNotes } });
    if (refund) recalcMembership(userId).catch(() => {});
    const freshOrder = await orderWithItems(orderId);
    sseSend(userId, 'order', { order: freshOrder });
    ssePushState(userId);
    sendJson(response, 200, { success: true, message: 'Status yeniləndi.', order: freshOrder });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    sendJson(response, 400, { success: false, message: e.message });
  } finally {
    client.release();
  }
}

async function adminListCoupons(request, response) {
  const admin = await requireAdminApi(request, response, 'coupons.view'); if (!admin) return;
  const { rows } = await pool.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM user_coupons WHERE coupon_id = c.id) AS assigned_count
     FROM coupons c ORDER BY c.created_at DESC`
  );
  sendJson(response, 200, { coupons: rows });
}

async function adminCreateCoupon(request, response) {
  const admin = await requireAdminApi(request, response, 'coupons.manage'); if (!admin) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const code = String(body.code || '').trim().toUpperCase();
  const discountType = String(body.discountType || body.discount_type || '').trim().toLowerCase();
  const discountValue = Number(body.discountValue || body.discount_value || 0);
  const maxUses = parseInt(body.maxUses || body.max_uses || 0, 10) || 0;
  const minOrderAmount = Number(body.minOrderAmount || body.min_order_amount || 0) || 0;
  const publicFlag = Boolean(body.public || body.is_public || false);
  const assignedOnly = Boolean(body.assignedOnly || body.assigned_only || false);
  const active = body.active !== undefined ? Boolean(body.active) : true;
  const expiryDate = body.expiryDate || body.expiry_date || null;
  const description = String(body.description || '').trim();
  const userIds = Array.isArray(body.userIds) ? body.userIds : [];

  if (!code) return sendJson(response, 400, { message: 'Kupon kodu tələb olunur.' });
  if (!['fixed', 'percentage'].includes(discountType)) return sendJson(response, 400, { message: 'Endirim tipi fixed və ya percentage olmalıdır.' });
  if (!Number.isFinite(discountValue) || discountValue <= 0) return sendJson(response, 400, { message: 'Endirim dəyəri düzgün deyil.' });
  if (discountType === 'percentage' && discountValue > 100) return sendJson(response, 400, { message: 'Faiz endirim 100% -dən çox ola bilməz.' });

  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO coupons (id, code, discount_type, discount_value, max_uses, min_order_amount, public, assigned_only, active, expiry_date, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, code, discountType, discountValue, maxUses, minOrderAmount, publicFlag, assignedOnly, active, expiryDate || null, description || null]
    );
    for (const uid of userIds) {
      if (!uid) continue;
      const ucId = crypto.randomUUID();
      const uses = Number.isFinite(body.usesPerUser) ? parseInt(body.usesPerUser, 10) : 1;
      await pool.query(
        `INSERT INTO user_coupons (id, user_id, coupon_id, uses_left) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, coupon_id) DO UPDATE SET uses_left = user_coupons.uses_left + EXCLUDED.uses_left`,
        [ucId, uid, id, uses]
      ).catch(() => {});
    }
    const { rows } = await pool.query('SELECT * FROM coupons WHERE id = $1 LIMIT 1', [id]);
    sendJson(response, 201, { coupon: rows[0] });
  } catch (e) {
    if (e.constraint === 'coupons_code_key') return sendJson(response, 409, { message: 'Bu kupon kodu artıq mövcuddur.' });
    console.error('[adminCreateCoupon]', e);
    sendJson(response, 500, { message: 'Kupon yaradılarkən xəta baş verdi.' });
  }
}

async function adminAssignCoupon(request, response) {
  const admin = await requireAdminApi(request, response, 'coupons.manage'); if (!admin) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const couponId = String(body.couponId || body.coupon_id || '').trim();
  const userIds = Array.isArray(body.userIds) ? body.userIds : [];
  const usesLeft = Number.isFinite(body.usesLeft) ? parseInt(body.usesLeft, 10) : 1;
  if (!couponId || userIds.length === 0) return sendJson(response, 400, { message: 'couponId və userIds tələb olunur.' });
  const { rows: cp } = await pool.query('SELECT id FROM coupons WHERE id = $1 LIMIT 1', [couponId]);
  if (!cp.length) return sendJson(response, 404, { message: 'Kupon tapılmadı.' });
  let assigned = 0;
  for (const uid of userIds) {
    if (!uid) continue;
    const ucId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO user_coupons (id, user_id, coupon_id, uses_left) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, coupon_id) DO UPDATE SET uses_left = user_coupons.uses_left + EXCLUDED.uses_left`,
      [ucId, uid, couponId, usesLeft]
    ).then(() => assigned++).catch(() => {});
  }
  sendJson(response, 200, { message: `${assigned} istifadəçiyə kupon təyin edildi.`, assigned });
}

async function adminDeleteCoupon(request, response, id) {
  const admin = await requireAdminApi(request, response, 'coupons.manage'); if (!admin) return;
  if (!id) return sendJson(response, 400, { message: 'Kupon ID tələb olunur.' });
  await pool.query('DELETE FROM coupons WHERE id = $1', [id]);
  sendJson(response, 200, { message: 'Kupon silindi.' });
}

async function adminListUsers(request, response) {
  const admin = await requireAdminApi(request, response, 'users.view'); if (!admin) return;
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
// ==========================================
// ENTERPRISE ADMIN PANEL APIs
// ==========================================

function parseDateRange(request) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const range = url.searchParams.get('range') || 'today'; // today | 7days | 30days | year | custom
  const now = new Date();
  let start, end;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  end = new Date(today);
  end.setHours(23, 59, 59, 999);
  if (range === 'today') {
    start = new Date(today);
  } else if (range === '7days') {
    start = new Date(today); start.setDate(start.getDate() - 6);
  } else if (range === '30days') {
    start = new Date(today); start.setDate(start.getDate() - 29);
  } else if (range === 'year') {
    start = new Date(today); start.setMonth(0); start.setDate(1);
  } else {
    const s = url.searchParams.get('start');
    const e = url.searchParams.get('end');
    start = s ? new Date(s) : new Date(today);
    end = e ? new Date(new Date(e).setHours(23, 59, 59, 999)) : new Date(end);
  }
  return { start, end, range };
}

async function adminDashboardStats(request, response) {
  const admin = await requireAdminApi(request, response, 'dashboard'); if (!admin) return;
  const { start, end } = parseDateRange(request);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const queries = {
    totalUsers: `SELECT COUNT(*)::int AS c FROM users WHERE deleted_at IS NULL`,
    newUsersToday: `SELECT COUNT(*)::int AS c FROM users WHERE created_at >= $1 AND created_at <= $2`,
    newUsersWeekly: `SELECT COUNT(*)::int AS c FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`,
    newUsersMonthly: `SELECT COUNT(*)::int AS c FROM users WHERE created_at >= NOW() - INTERVAL '30 days'`,
    onlineUsers: `SELECT COUNT(DISTINCT user_id)::int AS c FROM sessions WHERE last_active_at >= NOW() - INTERVAL '15 minutes'`,
    totalOrders: `SELECT COUNT(*)::int AS c FROM orders`,
    todayOrders: `SELECT COUNT(*)::int AS c FROM orders WHERE created_at >= $1 AND created_at <= $2`,
    pendingOrders: `SELECT COUNT(*)::int AS c FROM orders WHERE status_code = 'pending'`,
    processingOrders: `SELECT COUNT(*)::int AS c FROM orders WHERE status_code = 'processing'`,
    completedOrders: `SELECT COUNT(*)::int AS c FROM orders WHERE status_code = 'completed'`,
    rejectedOrders: `SELECT COUNT(*)::int AS c FROM orders WHERE status_code = 'rejected'`,
    todayRevenue: `SELECT COALESCE(SUM(total_amount),0)::numeric AS c FROM orders WHERE status_code = 'completed' AND created_at >= $1 AND created_at <= $2`,
    weeklyRevenue: `SELECT COALESCE(SUM(total_amount),0)::numeric AS c FROM orders WHERE status_code = 'completed' AND created_at >= NOW() - INTERVAL '7 days'`,
    monthlyRevenue: `SELECT COALESCE(SUM(total_amount),0)::numeric AS c FROM orders WHERE status_code = 'completed' AND created_at >= NOW() - INTERVAL '30 days'`,
    pendingBalance: `SELECT COUNT(*)::int AS c FROM balance_requests WHERE LOWER(status) = 'pending'`,
    pendingDeposits: `SELECT COUNT(*)::int AS c FROM deposit_requests WHERE LOWER(status) = 'pending'`,
    totalRevenue: `SELECT COALESCE(SUM(total_amount),0)::numeric AS c FROM orders WHERE status_code = 'completed'`
  };

  const params = [startIso, endIso];
  const result = {};
  for (const [key, sql] of Object.entries(queries)) {
    const needsDate = sql.includes('$1');
    const { rows } = await pool.query(sql, needsDate ? params : []);
    result[key] = rows[0].c;
  }

  sendJson(response, 200, { success: true, stats: result, range: { start: startIso, end: endIso } });
}

async function adminDashboardCharts(request, response) {
  const admin = await requireAdminApi(request, response, 'dashboard'); if (!admin) return;
  const { start, end } = parseDateRange(request);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const dailySales = await pool.query(
    `SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS orders, COALESCE(SUM(total_amount),0)::numeric AS revenue
     FROM orders WHERE created_at >= $1 AND created_at <= $2
     GROUP BY DATE(created_at) ORDER BY day`,
    [startIso, endIso]
  );

  const monthlyRevenue = await pool.query(
    `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month, COALESCE(SUM(total_amount),0)::numeric AS revenue
     FROM orders WHERE status_code = 'completed' AND created_at >= $1 AND created_at <= $2
     GROUP BY DATE_TRUNC('month', created_at) ORDER BY month`,
    [startIso, endIso]
  );

  const newUsers = await pool.query(
    `SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS users
     FROM users WHERE created_at >= $1 AND created_at <= $2
     GROUP BY DATE(created_at) ORDER BY day`,
    [startIso, endIso]
  );

  const orderStatusDist = await pool.query(
    `SELECT status_code, COUNT(*)::int AS count FROM orders
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY status_code`,
    [startIso, endIso]
  );

  const topCategories = await pool.query(
    `SELECT COALESCE(c.name, o.game, 'Digər') AS name, COUNT(*)::int AS orders, COALESCE(SUM(o.total_amount),0)::numeric AS revenue
     FROM orders o LEFT JOIN categories c ON c.name = o.game
     WHERE o.status_code = 'completed' AND o.created_at >= $1 AND o.created_at <= $2
     GROUP BY c.name, o.game ORDER BY revenue DESC LIMIT 10`,
    [startIso, endIso]
  );

  sendJson(response, 200, {
    success: true,
    dailySales: dailySales.rows,
    monthlyRevenue: monthlyRevenue.rows,
    newUsers: newUsers.rows,
    orderStatusDistribution: orderStatusDist.rows,
    topCategories: topCategories.rows,
    range: { start: startIso, end: endIso }
  });
}

async function adminAuditLogs(request, response) {
  const admin = await requireAdminApi(request, response, 'audit_logs.view'); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));
  const action = (url.searchParams.get('action') || '').trim();
  const targetType = (url.searchParams.get('targetType') || '').trim();

  let sql = 'SELECT * FROM audit_logs';
  const params = [];
  const conds = [];
  if (action) { conds.push('action = $' + (params.length + 1)); params.push(action); }
  if (targetType) { conds.push('target_type = $' + (params.length + 1)); params.push(targetType); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit, offset);

  const { rows } = await pool.query(sql, params);
  const countSql = 'SELECT COUNT(*)::int AS c FROM audit_logs' + (conds.length ? ' WHERE ' + conds.map((c, i) => c.replace(/\$\d+/, '$' + (i + 1))).join(' AND ') : '');
  const { rows: countRows } = await pool.query(countSql, params.slice(0, -2));
  sendJson(response, 200, { success: true, logs: rows, total: countRows[0].c, limit, offset });
}

async function adminGetUser(request, response, id) {
  const admin = await requireAdminApi(request, response, 'users.view'); if (!admin) return;
  if (!id) return sendJson(response, 400, { success: false, message: 'ID tələb olunur.' });
  const { rows: users } = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  if (!users.length) return sendJson(response, 404, { success: false, message: 'İstifadəçi tapılmadı.' });
  const user = users[0];

  const stats = await pool.query(
    `SELECT
      COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END),0)::numeric AS total_deposits,
      COUNT(DISTINCT o.id)::int AS total_orders,
      COUNT(DISTINCT CASE WHEN o.status_code = 'completed' THEN o.id END)::int AS completed_orders,
      COUNT(DISTINCT CASE WHEN o.status_code = 'rejected' THEN o.id END)::int AS rejected_orders
     FROM users u
     LEFT JOIN transactions t ON t.user_id = u.id AND t.type = 'credit'
     LEFT JOIN orders o ON o.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [id]
  );

  const orders = await pool.query(
    `SELECT id, game, package, total_amount, status, status_code, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [id]
  );

  const coupons = await pool.query(
    `SELECT c.*, uc.uses_left, uc.used_count, uc.assigned_at
     FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
     WHERE uc.user_id = $1 ORDER BY uc.assigned_at DESC`,
    [id]
  );

  sendJson(response, 200, {
    success: true,
    user: sanitizeUser(user),
    stats: stats.rows[0] || { total_deposits: 0, total_orders: 0, completed_orders: 0, rejected_orders: 0 },
    orders: orders.rows,
    coupons: coupons.rows
  });
}

async function adminUpdateUser(request, response, id) {
  const admin = await requireAdminApi(request, response, 'users.manage'); if (!admin) return;
  if (!verifyAdminCsrf(request)) return sendJson(response, 403, { success: false, message: 'CSRF token etibarsızdır.' });
  if (!id) return sendJson(response, 400, { success: false, message: 'ID tələb olunur.' });
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const allowed = ['username', 'email', 'first_name', 'last_name', 'phone', 'status', 'membership_level'];
  const sets = ['updated_at = NOW()'];
  const values = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      values.push(String(body[key]).trim());
      sets.push(`${key} = $${values.length}`);
    }
  }
  if (sets.length === 1) return sendJson(response, 400, { success: false, message: 'Heç bir dəyişiklik yoxdur.' });
  values.push(id);
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  if (!rows.length) return sendJson(response, 404, { success: false, message: 'İstifadəçi tapılmadı.' });
  const oldUser = rows[0];
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  const { rows: updated } = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  auditLog('user_updated', { admin, req: request, targetType: 'user', targetId: id, oldValue: oldUser, newValue: updated[0] });
  sendJson(response, 200, { success: true, user: sanitizeUser(updated[0]) });
}

async function adminAdjustUserBalance(request, response, id) {
  const admin = await requireAdminApi(request, response, 'users.balance'); if (!admin) return;
  if (!verifyAdminCsrf(request)) return sendJson(response, 403, { success: false, message: 'CSRF token etibarsızdır.' });
  if (!id) return sendJson(response, 400, { success: false, message: 'ID tələb olunur.' });
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const amount = Number(body.amount || 0);
  const reason = String(body.reason || 'Admin balance adjustment').trim();
  if (!Number.isFinite(amount) || amount === 0) return sendJson(response, 400, { success: false, message: 'Düzgün məbləğ daxil edin.' });
  const user = await dbFindUserById(id);
  if (!user) return sendJson(response, 404, { success: false, message: 'İstifadəçi tapılmadı.' });
  const oldBalance = Number(user.balance || 0);
  await dbUpdateBalance(id, amount);
  await dbCreateTransaction(id, Math.abs(amount), amount > 0 ? 'credit' : 'debit', 'approved', reason, 'balance', reason);
  await dbCreateNotification(id, amount > 0 ? 'Balans artırıldı' : 'Balans azaldıldı', `Hesabınız ${Math.abs(amount).toFixed(2)} ₼ ${amount > 0 ? 'əlavə edildi' : 'azaldıldı'}.`, 'balance');
  ssePushState(id);
  if (amount > 0) recalcMembership(id).catch(() => {});
  const updated = await dbFindUserById(id);
  auditLog('user_balance_adjusted', { admin, req: request, targetType: 'user', targetId: id, oldValue: { balance: oldBalance }, newValue: { balance: updated.balance, change: amount, reason } });
  sendJson(response, 200, { success: true, user: sanitizeUser(updated) });
}

async function adminSendUserMessage(request, response) {
  const admin = await requireAdminApi(request, response, 'messages.manage'); if (!admin) return;
  if (!verifyAdminCsrf(request)) return sendJson(response, 403, { success: false, message: 'CSRF token etibarsızdır.' });
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const userIds = Array.isArray(body.userIds) ? body.userIds : (body.userId ? [body.userId] : []);
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const priority = String(body.priority || 'normal').trim();
  if (!title || !content) return sendJson(response, 400, { success: false, message: 'Başlıq və məzmun tələb olunur.' });
  let sent = 0;
  for (const uid of userIds) {
    if (!uid) continue;
    await pool.query('INSERT INTO messages (id, sender_id, recipient_id, title, content, priority) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), admin.id, uid, title, content, priority]);
    await dbCreateNotification(uid, title, content, 'message');
    ssePushState(uid);
    sent++;
  }
  auditLog('message_sent', { admin, req: request, targetType: 'message', targetId: null, newValue: { recipients: sent, title, priority } });
  sendJson(response, 200, { success: true, sent });
}

async function adminCreateAnnouncement(request, response) {
  const admin = await requireAdminApi(request, response, 'announcements.manage'); if (!admin) return;
  if (!verifyAdminCsrf(request)) return sendJson(response, 403, { success: false, message: 'CSRF token etibarsızdır.' });
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const type = String(body.type || 'info').trim();
  const targetAudience = String(body.targetAudience || 'all').trim();
  const targetUserIds = Array.isArray(body.targetUserIds) ? body.targetUserIds : [];
  const active = body.active !== false;
  const startDate = body.startDate || null;
  const endDate = body.endDate || null;
  if (!title || !content) return sendJson(response, 400, { success: false, message: 'Başlıq və məzmun tələb olunur.' });

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO announcements (id, title, content, type, target_audience, target_user_ids, active, start_date, end_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, title, content, type, targetAudience, JSON.stringify(targetUserIds), active, startDate, endDate, admin.id]
  );

  // Notify users immediately
  const userQuery = targetAudience === 'vip' ? "WHERE membership_level = 'vip'" :
    targetAudience === 'premium' ? "WHERE membership_level = 'premium'" :
    targetAudience === 'selected' ? `WHERE id = ANY($1)` : '';
  const userParams = targetAudience === 'selected' ? [targetUserIds] : [];
  const { rows: users } = await pool.query(`SELECT id FROM users ${userQuery}`.trim(), userParams);
  for (const u of users) {
    await dbCreateNotification(u.id, title, content, 'announcement');
    ssePushState(u.id);
  }

  auditLog('announcement_created', { admin, req: request, targetType: 'announcement', targetId: id, newValue: { title, type, targetAudience, active } });
  sendJson(response, 201, { success: true, id });
}

async function adminListAnnouncements(request, response) {
  const admin = await requireAdminApi(request, response, 'announcements.view'); if (!admin) return;
  const { rows } = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
  sendJson(response, 200, { success: true, announcements: rows });
}

async function adminCreateCampaign(request, response) {
  const admin = await requireAdminApi(request, response, 'campaigns.manage'); if (!admin) return;
  if (!verifyAdminCsrf(request)) return sendJson(response, 403, { success: false, message: 'CSRF token etibarsızdır.' });
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const name = String(body.name || '').trim();
  const type = String(body.type || '').trim().toLowerCase();
  const value = Number(body.value || 0);
  const startDate = body.startDate || null;
  const endDate = body.endDate || null;
  const targetType = String(body.targetType || 'all').trim().toLowerCase();
  const targetIds = Array.isArray(body.targetIds) ? body.targetIds : [];
  const vipOnly = Boolean(body.vipOnly);
  const premiumOnly = Boolean(body.premiumOnly);
  const active = body.active !== false;

  if (!name) return sendJson(response, 400, { success: false, message: 'Kampaniya adı tələb olunur.' });
  if (!['percentage', 'fixed'].includes(type)) return sendJson(response, 400, { success: false, message: 'Tip percentage və ya fixed olmalıdır.' });
  if (!Number.isFinite(value) || value <= 0) return sendJson(response, 400, { success: false, message: 'Düzgün dəyər daxil edin.' });
  if (type === 'percentage' && value > 100) return sendJson(response, 400, { success: false, message: 'Faiz 100-dən çox ola bilməz.' });

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO campaigns (id, name, type, value, start_date, end_date, target_type, target_ids, vip_only, premium_only, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, name, type, value, startDate, endDate, targetType, JSON.stringify(targetIds), vipOnly, premiumOnly, active]
  );
  auditLog('campaign_created', { admin, req: request, targetType: 'campaign', targetId: id, newValue: { name, type, value, active } });
  sendJson(response, 201, { success: true, id });
}

async function adminListCampaigns(request, response) {
  const admin = await requireAdminApi(request, response, 'campaigns.view'); if (!admin) return;
  const { rows } = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
  sendJson(response, 200, { success: true, campaigns: rows });
}

async function adminListMessages(request, response) {
  const admin = await requireAdminApi(request, response, 'messages.view'); if (!admin) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const userId = (url.searchParams.get('userId') || '').trim();
  let sql = 'SELECT m.*, u.username AS recipient_name FROM messages m LEFT JOIN users u ON u.id = m.recipient_id';
  const params = [];
  if (userId) { sql += ' WHERE m.recipient_id = $1'; params.push(userId); }
  sql += ' ORDER BY m.created_at DESC LIMIT 100';
  const { rows } = await pool.query(sql, params);
  sendJson(response, 200, { success: true, messages: rows });
}

async function adminBulkProductAction(request, response) {
  const admin = await requireAdminApi(request, response, 'products.manage'); if (!admin) return;
  if (!verifyAdminCsrf(request)) return sendJson(response, 403, { success: false, message: 'CSRF token etibarsızdır.' });
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const action = String(body.action || '').trim().toLowerCase();
  if (!ids.length) return sendJson(response, 400, { success: false, message: 'Məhsul ID-ləri tələb olunur.' });
  if (!['hide', 'unhide', 'feature', 'unfeature', 'delete'].includes(action)) return sendJson(response, 400, { success: false, message: 'Düzgün əməliyyat.' });

  const placeholders = ids.map((_, i) => '$' + (i + 1)).join(',');
  if (action === 'delete') {
    await pool.query(`DELETE FROM order_items WHERE product_id IN (${placeholders})`, ids);
    await pool.query(`DELETE FROM products WHERE id IN (${placeholders})`, ids);
  } else {
    const updates = {
      hide: 'hidden = true',
      unhide: 'hidden = false',
      feature: 'is_featured = true, featured_at = NOW()',
      unfeature: 'is_featured = false, featured_at = NULL'
    };
    await pool.query(`UPDATE products SET ${updates[action]}, updated_at = NOW(), updated_by = $${ids.length + 1} WHERE id IN (${placeholders})`, [...ids, admin.id]);
  }
  auditLog('bulk_product_action', { admin, req: request, targetType: 'product', targetId: ids.join(','), newValue: { action, count: ids.length } });
  sendJson(response, 200, { success: true, affected: ids.length });
}

// ==========================================
// DEPOSIT RECEIPT UPLOADS
// ==========================================

const UPLOADS_DIR = path.join(__dirname, 'uploads', 'receipts');
const ALLOWED_RECEIPT_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png' };
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5 MB

function readRequestBuffer(request, maxBytes = MAX_RECEIPT_BYTES + 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { request.destroy(); reject(new Error('Request body is too large')); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function detectImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
    && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
  return null;
}

function parseMultipart(buffer, boundary) {
  const result = { fields: {}, files: {} };
  const delimiter = Buffer.from('--' + boundary);
  const headerSep = Buffer.from('\r\n\r\n');
  let start = buffer.indexOf(delimiter);
  if (start === -1) return result;
  start += delimiter.length;
  while (start < buffer.length) {
    if (buffer[start] === 0x2D && buffer[start + 1] === 0x2D) break; // closing '--'
    if (buffer[start] === 0x0D && buffer[start + 1] === 0x0A) start += 2;
    const next = buffer.indexOf(delimiter, start);
    if (next === -1) break;
    const part = buffer.slice(start, next - 2); // strip trailing CRLF
    const headerEnd = part.indexOf(headerSep);
    if (headerEnd !== -1) {
      const headerStr = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + headerSep.length);
      const nameMatch = /name="([^"]*)"/i.exec(headerStr);
      const filenameMatch = /filename="([^"]*)"/i.exec(headerStr);
      const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerStr);
      const name = nameMatch ? nameMatch[1] : '';
      if (filenameMatch) {
        result.files[name] = { filename: filenameMatch[1], contentType: ctMatch ? ctMatch[1].trim() : '', data: body };
      } else if (name) {
        result.fields[name] = body.toString('utf8');
      }
    }
    start = next + delimiter.length;
  }
  return result;
}

async function submitDeposit(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const contentType = request.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return sendJson(response, 400, { message: 'multipart/form-data tələb olunur.' });
  }
  const bMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = bMatch ? (bMatch[1] || bMatch[2]).trim() : '';
  if (!boundary) return sendJson(response, 400, { message: 'Form sərhədi tapılmadı.' });

  let buffer;
  try {
    buffer = await readRequestBuffer(request);
  } catch {
    return sendJson(response, 413, { message: 'Fayl çox böyükdür (maksimum 5MB).' });
  }

  const parsed = parseMultipart(buffer, boundary);
  const file = parsed.files.receipt || parsed.files.file;
  if (!file || !file.data || file.data.length === 0) {
    return sendJson(response, 400, { message: 'Qəbz şəkli tələb olunur.' });
  }
  if (file.data.length > MAX_RECEIPT_BYTES) {
    return sendJson(response, 413, { message: 'Fayl 5MB-dan böyük ola bilməz.' });
  }
  const detected = detectImageType(file.data);
  if (!detected || !ALLOWED_RECEIPT_TYPES[detected]) {
    return sendJson(response, 415, { message: 'Yalnız JPG və ya PNG faylları qəbul olunur.' });
  }

  let amount = Number(parsed.fields.amount || 0);
  if (!Number.isFinite(amount) || amount < 0) amount = 0;
  amount = Math.round(amount * 100) / 100;

  const ext = ALLOWED_RECEIPT_TYPES[detected];
  const filename = `${crypto.randomUUID()}${ext}`;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, filename), file.data);

  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO deposit_requests (id, user_id, receipt_image, requested_amount, status) VALUES ($1,$2,$3,$4,$5)',
    [id, user.id, filename, amount, 'pending']
  );
  sendJson(response, 201, { message: 'Depozit sorğunuz göndərildi. Admin təsdiqini gözləyin.', requestId: id });
}

async function listMyDeposits(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const { rows } = await pool.query(
    'SELECT id, receipt_image, requested_amount, status, admin_note, created_at, approved_at FROM deposit_requests WHERE user_id = $1 ORDER BY created_at DESC',
    [user.id]
  );
  sendJson(response, 200, { deposits: rows });
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

function parseCookies(request) {
  const raw = request.headers.cookie || '';
  const cookies = {};
  raw.split(';').forEach(pair => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function getAuthToken(request) {
  const auth = request.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const cookies = parseCookies(request);
  if (cookies.auth_token) return cookies.auth_token;
  return null;
}

function cookieFlags(request, maxAgeSeconds = 604800) {
  const isHttps = request.headers['x-forwarded-proto'] === 'https';
  return `HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${isHttps ? '; Secure' : ''}`;
}

function setAuthCookie(response, request, token, maxAgeSeconds = 604800) {
  response.setHeader('Set-Cookie', `auth_token=${encodeURIComponent(token)}; ${cookieFlags(request, maxAgeSeconds)}`);
}

function clearAuthCookie(response, request) {
  response.setHeader('Set-Cookie', `auth_token=; ${cookieFlags(request, 0)}`);
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

async function dbCreateSession(token, userId, maxAgeSeconds = 604800) {
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
  await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, userId, expiresAt]);
}

async function dbGetSessionUserId(token) {
  if (!token) return null;
  const { rows } = await pool.query('SELECT user_id FROM sessions WHERE token = $1 AND expires_at > NOW() LIMIT 1', [token]);
  return rows[0] ? rows[0].user_id : null;
}

async function dbDeleteSession(token) {
  if (!token) return;
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

async function dbCleanupSessions() {
  await pool.query("DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '1 day'");
}

// ==========================================================
// PROFILE DASHBOARD SERVICES (membership, coupons, statistics)
// ==========================================================

const MEMBERSHIP_TIERS = {
  standard: { label: 'Standard', discount: 0, threshold: 0, badge: 'Standard', priority: 0 },
  vip:      { label: 'VIP',      discount: 0.10, threshold: 100, badge: 'VIP', priority: 1 },
  premium:  { label: 'Premium',  discount: 0.20, threshold: 500, badge: 'Premium', priority: 2 }
};

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function azeriDateLabel(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('az-AZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysSince(d) {
  if (!d) return 0;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24)));
}

/* Sum successful credit transactions within the current calendar month for membership calculation. */
async function getMonthlyTopupTotal(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total
     FROM transactions
     WHERE user_id = $1 AND type = 'credit' AND status IN ('approved','completed')
       AND created_at >= date_trunc('month', NOW())
       AND created_at <  date_trunc('month', NOW()) + INTERVAL '1 month'`,
    [userId]
  );
  return Number(rows[0].total || 0);
}

async function getUserMembershipLevel(userId) {
  const total = await getMonthlyTopupTotal(userId);
  if (total >= MEMBERSHIP_TIERS.premium.threshold) return 'premium';
  if (total >= MEMBERSHIP_TIERS.vip.threshold) return 'vip';
  return 'standard';
}

async function getCurrentMembership(userId) {
  const [userRow, total] = await Promise.all([
    pool.query('SELECT membership_level FROM users WHERE id = $1 LIMIT 1', [userId]),
    getMonthlyTopupTotal(userId)
  ]);
  const stored = (userRow.rows[0] && userRow.rows[0].membership_level) || 'standard';
  const calculated = await getUserMembershipLevel(userId);
  if (stored !== calculated) {
    await pool.query('UPDATE users SET membership_level = $1 WHERE id = $2', [calculated, userId]);
  }
  const nextLevel = calculated === 'premium' ? null : (calculated === 'vip' ? 'premium' : 'vip');
  const nextThreshold = nextLevel ? MEMBERSHIP_TIERS[nextLevel].threshold : null;
  const progress = nextThreshold ? clamp(total / nextThreshold, 0, 1) : 1;
  return {
    level: calculated,
    label: MEMBERSHIP_TIERS[calculated].label,
    badge: MEMBERSHIP_TIERS[calculated].badge,
    discount: MEMBERSHIP_TIERS[calculated].discount,
    monthlyTopup: total,
    nextLevel,
    nextThreshold,
    progress
  };
}

async function recalcMembership(userId) {
  const newLevel = await getUserMembershipLevel(userId);
  const { rows } = await pool.query('SELECT membership_level FROM users WHERE id = $1 LIMIT 1', [userId]);
  const oldLevel = rows[0] ? rows[0].membership_level : 'standard';
  if (oldLevel !== newLevel) {
    await pool.query('UPDATE users SET membership_level = $1 WHERE id = $2', [newLevel, userId]);
    const tier = MEMBERSHIP_TIERS[newLevel];
    await dbCreateNotification(userId, 'Üzvlük səviyyəniz yeniləndi', `Təbriklər! Artıq ${tier.label} üzvsünüz. ${Math.round(tier.discount * 100)}% endirim qazandınız.`, 'system');
    ssePushState(userId);
  }
  return newLevel;
}

/* Coupon services */
async function findCouponByCode(code) {
  const { rows } = await pool.query(
    `SELECT * FROM coupons WHERE LOWER(code) = LOWER($1) LIMIT 1`,
    [String(code || '').trim()]
  );
  return rows[0] || null;
}

async function isCouponAvailableForUser(userId, coupon) {
  if (!coupon || !coupon.active) return false;
  const now = new Date();
  if (coupon.start_date && new Date(coupon.start_date) > now) return false;
  if (coupon.expiry_date && new Date(coupon.expiry_date) < now) return false;
  if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) return false;
  if (coupon.assigned_only) {
    const { rows } = await pool.query(
      `SELECT uses_left, used_count FROM user_coupons WHERE user_id = $1 AND coupon_id = $2 LIMIT 1`,
      [userId, coupon.id]
    );
    if (!rows.length) return false;
    const uc = rows[0];
    if (uc.uses_left > 0 && uc.used_count >= uc.uses_left) return false;
  }
  return true;
}

async function getUserCoupons(userId, onlyActive = true) {
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `SELECT c.*, uc.id AS user_coupon_id, uc.uses_left, uc.used_count, uc.assigned_at
     FROM user_coupons uc
     JOIN coupons c ON c.id = uc.coupon_id
     WHERE uc.user_id = $1
       ${onlyActive ? `AND c.active = true
       AND (c.start_date IS NULL OR c.start_date <= $2)
       AND (c.expiry_date IS NULL OR c.expiry_date >= $2)
       AND (c.max_uses = 0 OR c.used_count < c.max_uses)
       AND (uc.uses_left = 0 OR uc.used_count < uc.uses_left)` : ''}
     ORDER BY c.created_at DESC`,
    onlyActive ? [userId, now] : [userId]
  );
  return rows;
}

async function validateCoupon(userId, code, orderAmount = 0) {
  const coupon = await findCouponByCode(code);
  if (!coupon) return { valid: false, message: 'Kupon tapılmadı.' };
  const available = await isCouponAvailableForUser(userId, coupon);
  if (!available) return { valid: false, message: 'Bu kupon artıq etibarlı deyil.' };
  if (Number(orderAmount) > 0 && Number(coupon.min_order_amount) > Number(orderAmount)) {
    return { valid: false, message: `Minimum sifariş məbləği ${Number(coupon.min_order_amount).toFixed(2)} ₼ olmalıdır.` };
  }
  const discount = coupon.discount_type === 'percentage'
    ? Number(orderAmount) * (Number(coupon.discount_value) / 100)
    : Number(coupon.discount_value);
  return { valid: true, coupon, discount: Math.min(discount, Number(orderAmount) || discount) };
}

/* Calculate discount for a coupon; does NOT decrement usage (use decrementCouponUse at order creation). */
async function applyCoupon(userId, code, orderAmount) {
  const result = await validateCoupon(userId, code, orderAmount);
  if (!result.valid) return result;
  return { valid: true, coupon: result.coupon, discountAmount: result.discount };
}

async function decrementCouponUse(userId, couponId) {
  await pool.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [couponId]);
  await pool.query(
    `UPDATE user_coupons SET used_count = used_count + 1
     WHERE user_id = $1 AND coupon_id = $2 AND (uses_left = 0 OR used_count < uses_left)`,
    [userId, couponId]
  );
}

/* Statistics aggregation for the dashboard */
async function getUserStatistics(userId) {
  const [userRow, orders, deposits, completed, spent, credits, debits, fav, coupons] = await Promise.all([
    pool.query('SELECT created_at, membership_level FROM users WHERE id = $1 LIMIT 1', [userId]),
    pool.query('SELECT COUNT(*)::int AS c FROM orders WHERE user_id = $1', [userId]),
    pool.query('SELECT COUNT(*)::int AS c FROM deposit_requests WHERE user_id = $1 AND status = $2', [userId, 'approved']),
    pool.query("SELECT COUNT(*)::int AS c FROM orders WHERE user_id = $1 AND status_code = 'completed'", [userId]),
    pool.query("SELECT COALESCE(SUM(total_amount),0) AS total FROM orders WHERE user_id = $1 AND status_code = 'completed'", [userId]),
    pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE user_id = $1 AND type = 'credit' AND status = 'approved'", [userId]),
    pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE user_id = $1 AND type = 'debit' AND status = 'approved'", [userId]),
    pool.query(`SELECT game, COUNT(*)::int AS c FROM orders WHERE user_id = $1 GROUP BY game ORDER BY c DESC LIMIT 1`, [userId]),
    pool.query(`SELECT COALESCE(SUM(c.discount_value),0) AS total
                FROM user_coupons uc
                JOIN coupons c ON c.id = uc.coupon_id
                WHERE uc.user_id = $1 AND uc.used_count > 0`, [userId])
  ]);
  const joinedAt = userRow.rows[0] ? userRow.rows[0].created_at : null;
  const totalOrders = orders.rows[0].c;
  const completedOrders = completed.rows[0].c;
  const totalSpent = Number(spent.rows[0].total || 0);
  const totalDeposits = Number(credits.rows[0].total || 0);
  const avgOrder = totalOrders > 0 ? totalSpent / totalOrders : 0;
  const favoriteGame = fav.rows[0] ? fav.rows[0].game : null;
  const membership = await getCurrentMembership(userId);
  return {
    accountAgeDays: daysSince(joinedAt),
    joinedAt: azeriDateLabel(joinedAt),
    totalOrders,
    completedOrders,
    totalSpent,
    totalDeposits,
    averageOrderValue: avgOrder,
    favoriteGame,
    membershipLevel: membership.level,
    membershipLabel: membership.label,
    monthlyTopup: membership.monthlyTopup,
    nextMembershipLevel: membership.nextLevel,
    nextMembershipThreshold: membership.nextThreshold,
    loyaltyProgress: membership.progress,
    totalSavings: Number(coupons.rows[0].total || 0) + (totalSpent * membership.discount)
  };
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

async function buildProfile(user) {
  const safeUser = sanitizeUser(user);
  const [membership, stats] = await Promise.all([
    getCurrentMembership(user.id),
    getUserStatistics(user.id)
  ]);
  return {
    user: safeUser,
    profile: {
      id: safeUser.id,
      username: safeUser.username,
      firstName: safeUser.firstName || '',
      lastName: safeUser.lastName || '',
      name: safeUser.name || '',
      email: safeUser.email,
      phone: user.phone || '',
      memberId: `#ZLX${String(user.id || '').slice(0, 5).toUpperCase()}`,
      membershipLevel: membership.level,
      membershipLabel: membership.label,
      membershipBadge: membership.badge,
      membershipDiscount: membership.discount,
      monthlyTopup: membership.monthlyTopup,
      nextMembershipLevel: membership.nextLevel,
      nextMembershipThreshold: membership.nextThreshold,
      loyaltyProgress: membership.progress,
      title: `${membership.label} üzv`,
      joinedAt: azeriDateLabel(user.created_at),
      createdAt: user.created_at,
      level: 1,
      xp: stats.completedOrders,
      nextXp: Math.max(stats.completedOrders + 1, 10),
      zelixBalance: Number(user.balance || 0),
      mapBalance: 0
    },
    stats
  };
}

async function register(request, response) {
  if (!rateLimit(rateKey(request, null, 'register'), 5, 60000)) {
    return sendJson(response, 429, { message: 'Çox sayda qeydiyyat cəhdi. Bir az gözləyin.' });
  }
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
  setAuthCookie(response, request, token);
  auditLog('register_success', { userId: user.id, username, email, ip: rateKey(request, null, 'register').split(':').pop() });
  sendJson(response, 201, { message: 'Qeydiyyat uğurludur.', token, user: sanitizeUser(user) });
}

async function login(request, response) {
  if (!rateLimit(rateKey(request, null, 'login'), 10, 60000)) {
    return sendJson(response, 429, { message: 'Çox sayda giriş cəhdi. Bir az gözləyin.' });
  }
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const user = await dbFindUserByIdentifier(identifier);
  if (!user || !verifyPassword(password, user.password_hash)) {
    auditLog('login_failed', { identifier, ip: rateKey(request, null, 'login').split(':').pop() });
    return sendJson(response, 401, { message: 'Email və ya şifrə yanlışdır.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  await dbCreateSession(token, user.id);
  setAuthCookie(response, request, token);
  auditLog('login_success', { userId: user.id, ip: rateKey(request, null, 'login').split(':').pop() });
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
  if (!rateLimit(rateKey(request, null, 'register'), 5, 60000)) {
    return sendJson(response, 429, { message: 'Çox sayda qeydiyyat cəhdi. Bir az gözləyin.' });
  }
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
  setAuthCookie(response, request, token);
  auditLog('register_success', { userId: user.id, username, email, ip: rateKey(request, null, 'register').split(':').pop() });
  sendJson(response, 201, { message: 'Qeydiyyat uğurludur.', token, user: sanitizeUser(user) });
}

async function authLogin(request, response) {
  if (!rateLimit(rateKey(request, null, 'login'), 10, 60000)) {
    return sendJson(response, 429, { message: 'Çox sayda giriş cəhdi. Bir az gözləyin.' });
  }
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const remember = Boolean(body.remember ?? true);
  const user = await dbFindUserByIdentifier(identifier);
  if (!user || !verifyPassword(password, user.password_hash)) {
    auditLog('login_failed', { identifier, ip: rateKey(request, null, 'login').split(':').pop() });
    return sendJson(response, 401, { message: 'Email və ya şifrə yanlışdır.' });
  }
  const token = signJwt(user.id, remember);
  const maxAge = remember ? 604800 : 86400;
  setAuthCookie(response, request, token, maxAge);
  auditLog('login_success', { userId: user.id, ip: rateKey(request, null, 'login').split(':').pop() });
  sendJson(response, 200, { message: 'Giriş uğurludur.', token, user: sanitizeUser(user) });
}

function signJwt(userId, remember = true) {
  const expiresIn = remember ? '7d' : '1d';
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn });
}

function isAdmin(user) { return Boolean(user.is_admin); }

async function requireAdmin(request, response) {
  const adminUser = await admin.getAdmin(request, pool);
  if (!adminUser) { sendJson(response, 403, { message: 'İcazə yoxdur', redirect: '/admin/login' }); return null; }
  return adminUser;
}

async function requireAdminApi(request, response, permission) {
  const adminUser = await admin.getAdmin(request, pool);
  if (!adminUser) { sendJson(response, 403, { message: 'İcazə yoxdur', redirect: '/admin/login' }); return null; }
  if (!permission) return adminUser;
  const ok = await admin.hasAdminPermission(pool, adminUser, permission);
  if (!ok) { sendJson(response, 403, { message: 'İcazə yoxdur', permission }); return null; }
  return adminUser;
}

function verifyAdminCsrf(request) {
  const c = (request.headers['x-csrf-token'] || '').trim();
  const cookies = parseCookies(request);
  return c && c === (cookies.admin_csrf || '');
}

async function logout(request, response) {
  try {
    const token = getAuthToken(request);
    // Invalidate opaque session token from DB store (JWTs are stateless).
    if (token) await dbDeleteSession(token);
    // Always clear the auth cookie so the browser session ends.
    clearAuthCookie(response, request);
    return sendJson(response, 200, { success: true, message: 'Çıxış edildi.' });
  } catch (error) {
    // Even on error, clear the cookie to avoid a stuck session.
    try { clearAuthCookie(response, request); } catch {}
    return sendJson(response, 500, { success: false, message: 'Çıxış zamanı xəta baş verdi.' });
  }
}

async function profile(request, response) {
  const user = await requireUser(request, response);
  if (!user) return;
  sendJson(response, 200, await buildProfile(user));
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
  sendJson(response, 200, { message: 'Dəyişikliklər yadda saxlandı.', ...(await buildProfile(updatedUser)) });
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
  sendJson(response, 200, { message: `${amount} ZELIX balansınıza əlavə edildi.`, ...(await buildProfile(updatedUser)) });
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
  await dbCreateTransaction(user.id, price, 'debit', 'completed', `Purchase: ${packageName}`, 'purchase', `${packageName} alındı`);

  // Save order
  const orderId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO orders (id, user_id, user_email, game, package, price, player_id, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [orderId, user.id, user.email, game, packageName, price, playerId, 'Tamamlandı']
  );

  await dbCreateNotification(user.id, 'Sifariş tamamlandı', `${packageName} (${price} AZN) uğurla alındı. Oyunçu ID: ${playerId}`, 'purchase');
  ssePushState(user.id);

  const updatedUser = await dbFindUserById(user.id);
  sendJson(response, 200, {
    message: `Təbriklər! ${packageName} (${price} ZELIX) hesabınıza yükləndi. Oyunçu ID: ${playerId}`,
    ...(await buildProfile(updatedUser))
  });
}

// ==========================================
// REAL-TIME HUB (Server-Sent Events)
// ==========================================

// Map<userId, Set<response>> of active SSE connections
const sseClients = new Map();

function sseAddClient(userId, response) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(response);
}

function sseRemoveClient(userId, response) {
  const set = sseClients.get(userId);
  if (!set) return;
  set.delete(response);
  if (set.size === 0) sseClients.delete(userId);
}

function sseSend(userId, event, data) {
  const set = sseClients.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch {}
  }
}

// Push the latest balance, cart count, and unread notification count to a user
async function ssePushState(userId) {
  try {
    const [u, cart, notif] = await Promise.all([
      pool.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [userId]),
      pool.query('SELECT COALESCE(SUM(quantity),0)::int AS c FROM cart_items WHERE user_id = $1', [userId]),
      pool.query('SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND is_read = false', [userId])
    ]);
    sseSend(userId, 'state', {
      balance: Number(u.rows[0] ? u.rows[0].balance : 0),
      cartCount: cart.rows[0] ? cart.rows[0].c : 0,
      unreadCount: notif.rows[0] ? notif.rows[0].c : 0
    });
  } catch {}
}

async function sseStream(request, response) {
  // EventSource cannot send Authorization headers, so accept token in query string
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token') || getAuthToken(request);
  let userId = null;
  if (token) {
    try { userId = jwt.verify(token, JWT_SECRET).sub; } catch {}
    if (!userId) userId = await dbGetSessionUserId(token);
  }
  if (!userId) {
    response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'Sessiya aktiv deyil.' }));
    return;
  }
  const user = await dbFindUserById(userId);
  if (!user) {
    response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'İstifadəçi tapılmadı.' }));
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  response.write('retry: 5000\n\n');
  sseAddClient(user.id, response);
  // Send initial state immediately
  ssePushState(user.id);
  // Heartbeat to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try { response.write(': ping\n\n'); } catch {}
  }, 25000);
  request.on('close', () => {
    clearInterval(heartbeat);
    sseRemoveClient(user.id, response);
  });
}

// ==========================================
// SIMPLE IN-MEMORY RATE LIMITER
// ==========================================

const rateBuckets = new Map();

// Returns true if the request is allowed, false if the limit is exceeded
function rateLimit(key, limit = 30, windowMs = 60000) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function rateKey(request, user, scope) {
  const ip = (request.headers['x-forwarded-for'] || '').split(',')[0].trim() || request.socket.remoteAddress || 'unknown';
  return `${scope}:${user ? user.id : ip}`;
}
function adminApiLimit(request, action = 'default', limit = 60, windowMs = 60000) {
  const ip = (request.headers['x-forwarded-for'] || '').split(',')[0].trim() || request.socket.remoteAddress || 'unknown';
  return rateLimit(`admin:${action}:${ip}`, limit, windowMs);
}

// ==========================================
// BALANCE API
// ==========================================

async function balanceGet(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const fresh = await dbFindUserById(user.id);
  if (!fresh) return sendJson(response, 404, { message: 'İstifadəçi tapılmadı.' });
  sendJson(response, 200, {
    balance: Number(fresh.balance || 0),
    currency: 'AZN',
    userId: fresh.id
  });
}

async function balanceHistory(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  let limit = parseInt(url.searchParams.get('limit') || '50', 10);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 200) limit = 50;
  // Ownership enforced via user_id filter
  const { rows } = await pool.query(
    `SELECT id, amount, type, status, category, COALESCE(description, ref) AS description, created_at
     FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [user.id, limit]
  );
  sendJson(response, 200, { history: rows });
}

async function balanceTopup(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  if (!rateLimit(rateKey(request, user, 'topup'), 10, 60000)) {
    return sendJson(response, 429, { message: 'Çox sayda sorğu. Bir az gözləyin.' });
  }
  const body = JSON.parse(await readRequestBody(request) || '{}');
  let amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return sendJson(response, 400, { message: 'Düzgün məbləğ daxil edin.' });
  }
  if (amount > 10000) {
    return sendJson(response, 400, { message: 'Maksimum 10000 AZN əlavə edilə bilər.' });
  }
  amount = Math.round(amount * 100) / 100;

  await dbUpdateBalance(user.id, amount);
  await dbCreateTransaction(user.id, amount, 'credit', 'completed', 'Balance top-up', 'deposit', `Balansa ${amount} AZN əlavə edildi`);
  await dbCreateNotification(user.id, 'Balans artırıldı', `Hesabınıza ${amount.toFixed(2)} AZN əlavə olundu.`, 'balance');
  const fresh = await dbFindUserById(user.id);
  ssePushState(user.id);
  recalcMembership(user.id).catch(() => {});
  sendJson(response, 200, {
    message: `${amount.toFixed(2)} AZN balansınıza əlavə edildi.`,
    balance: Number(fresh.balance || 0),
    currency: 'AZN'
  });
}

// ==========================================
// PROFILE DASHBOARD API
// ==========================================

async function membershipInfo(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const membership = await getCurrentMembership(user.id);
  const tiers = Object.fromEntries(
    Object.entries(MEMBERSHIP_TIERS).map(([k, v]) => [k, { label: v.label, discount: v.discount, threshold: v.threshold, badge: v.badge }])
  );
  sendJson(response, 200, { membership, tiers });
}

async function userCoupons(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const all = url.searchParams.get('all') === 'true';
  const coupons = await getUserCoupons(user.id, !all);
  sendJson(response, 200, { coupons });
}

async function validateCouponEndpoint(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const code = String(body.code || '').trim();
  const orderAmount = Number(body.orderAmount || 0);
  if (!code) return sendJson(response, 400, { message: 'Kupon kodu daxil edin.' });
  const result = await validateCoupon(user.id, code, orderAmount);
  if (!result.valid) return sendJson(response, 400, { message: result.message });
  sendJson(response, 200, {
    valid: true,
    discountAmount: Number(result.discount.toFixed(2)),
    coupon: { id: result.coupon.id, code: result.coupon.code, discountType: result.coupon.discount_type, discountValue: Number(result.coupon.discount_value) }
  });
}

async function userStatistics(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const stats = await getUserStatistics(user.id);
  sendJson(response, 200, { statistics: stats });
}

async function recentOrders(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') || '5', 10)));
  const { rows } = await pool.query(
    `SELECT id FROM orders WHERE user_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT $2`,
    [user.id, limit]
  );
  const orders = [];
  for (const r of rows) {
    const o = await orderWithItems(r.id);
    if (o) orders.push(o);
  }
  sendJson(response, 200, { orders });
}

// ==========================================
// CART API
// ==========================================

async function dbCartSummary(userId) {
  const { rows } = await pool.query(
    `SELECT ci.id, ci.product_id, ci.quantity, ci.created_at,
            p.game, p.title, p.price, p.image_url, p.available
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = $1
     ORDER BY ci.created_at DESC`,
    [userId]
  );
  const items = rows.map(r => ({
    id: r.id,
    productId: r.product_id,
    game: r.game,
    title: r.title,
    price: Number(r.price),
    imageUrl: r.image_url,
    available: r.available,
    quantity: r.quantity,
    lineTotal: Math.round(Number(r.price) * r.quantity * 100) / 100
  }));
  const subtotal = Math.round(items.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
  const count = items.reduce((s, i) => s + i.quantity, 0);
  return { items, subtotal, count, currency: 'AZN' };
}

async function cartGet(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  sendJson(response, 200, { cart: await dbCartSummary(user.id) });
}

async function cartAddItem(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  if (!rateLimit(rateKey(request, user, 'cart'), 60, 60000)) {
    return sendJson(response, 429, { message: 'Çox sayda sorğu. Bir az gözləyin.' });
  }
  const body = JSON.parse(await readRequestBody(request) || '{}');
  const productId = String(body.productId || '').trim();
  let quantity = parseInt(body.quantity || 1, 10);
  if (!productId) return sendJson(response, 400, { message: 'productId tələb olunur.' });
  if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;
  if (quantity > 99) quantity = 99;

  const { rows: prod } = await pool.query('SELECT id, available FROM products WHERE id = $1 LIMIT 1', [productId]);
  if (prod.length === 0) return sendJson(response, 404, { message: 'Məhsul tapılmadı.' });
  if (prod[0].available === false) return sendJson(response, 400, { message: 'Bu məhsul mövcud deyil.' });

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO cart_items (id, user_id, product_id, quantity)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, product_id)
     DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, 99), updated_at = CURRENT_TIMESTAMP`,
    [id, user.id, productId, quantity]
  );
  const cart = await dbCartSummary(user.id);
  ssePushState(user.id);
  sendJson(response, 201, { message: 'Səbətə əlavə edildi.', cart });
}

async function cartUpdateItem(request, response, itemId) {
  const user = await requireUser(request, response); if (!user) return;
  const body = JSON.parse(await readRequestBody(request) || '{}');
  let quantity = parseInt(body.quantity, 10);
  if (!Number.isFinite(quantity) || quantity < 0) return sendJson(response, 400, { message: 'Düzgün miqdar daxil edin.' });
  if (quantity > 99) quantity = 99;

  // Ownership: only update rows that belong to this user
  if (quantity === 0) {
    await pool.query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [itemId, user.id]);
  } else {
    const { rowCount } = await pool.query(
      'UPDATE cart_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3',
      [quantity, itemId, user.id]
    );
    if (rowCount === 0) return sendJson(response, 404, { message: 'Səbət elementi tapılmadı.' });
  }
  const cart = await dbCartSummary(user.id);
  ssePushState(user.id);
  sendJson(response, 200, { message: 'Səbət yeniləndi.', cart });
}

async function cartRemoveItem(request, response, itemId) {
  const user = await requireUser(request, response); if (!user) return;
  const { rowCount } = await pool.query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [itemId, user.id]);
  if (rowCount === 0) return sendJson(response, 404, { message: 'Səbət elementi tapılmadı.' });
  const cart = await dbCartSummary(user.id);
  ssePushState(user.id);
  sendJson(response, 200, { message: 'Səbətdən silindi.', cart });
}

async function cartClear(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  await pool.query('DELETE FROM cart_items WHERE user_id = $1', [user.id]);
  const cart = await dbCartSummary(user.id);
  ssePushState(user.id);
  sendJson(response, 200, { message: 'Səbət təmizləndi.', cart });
}

// ==========================================
// NOTIFICATIONS API
// ==========================================

async function notificationsList(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  const url = new URL(request.url, `http://${request.headers.host}`);
  let limit = parseInt(url.searchParams.get('limit') || '30', 10);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 100) limit = 30;
  const { rows } = await pool.query(
    `SELECT id, title, message, type, is_read, created_at
     FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [user.id, limit]
  );
  const { rows: unread } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND is_read = false', [user.id]
  );
  sendJson(response, 200, { notifications: rows, unreadCount: unread[0] ? unread[0].c : 0 });
}

async function notificationMarkRead(request, response, notifId) {
  const user = await requireUser(request, response); if (!user) return;
  const { rowCount } = await pool.query(
    'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [notifId, user.id]
  );
  if (rowCount === 0) return sendJson(response, 404, { message: 'Bildiriş tapılmadı.' });
  ssePushState(user.id);
  sendJson(response, 200, { message: 'Oxundu olaraq işarələndi.' });
}

async function notificationMarkAllRead(request, response) {
  const user = await requireUser(request, response); if (!user) return;
  await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [user.id]);
  ssePushState(user.id);
  sendJson(response, 200, { message: 'Bütün bildirişlər oxundu.' });
}

async function notificationDelete(request, response, notifId) {
  const user = await requireUser(request, response); if (!user) return;
  const { rowCount } = await pool.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [notifId, user.id]);
  if (rowCount === 0) return sendJson(response, 404, { message: 'Bildiriş tapılmadı.' });
  ssePushState(user.id);
  sendJson(response, 200, { message: 'Bildiriş silindi.' });
}

// ==========================================
// STATIC FILE SERVER
// ==========================================

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  // Map pretty paths like /pubg to /pubg.html, then resolve safely under ROOT
  const pathName = url.pathname;
  const isCat = /^\/category\/[^/]+\/?$/.test(pathName);
  const pretty = pathName === '/' ? 'index.html'
    : (pathName === '/pubg' || pathName === '/pubg/') ? 'pubg.html'
    : (pathName === '/balance/topup' || pathName === '/balance/topup/') ? 'profile.html'
    : (pathName === '/cart' || pathName === '/cart/') ? 'cart.html'
    : isCat ? 'category.html'
    : decodeURIComponent(pathName).replace(/^\/+/, '');
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
    if (request.method === 'GET' && request.url === '/api/health') return await healthCheck(request, response);
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
    if (request.method === 'GET' && /^\/api\/products\/[^/]+$/.test(request.url)) return await productGet(request, response, decodeURIComponent(request.url.split('/').pop()));
    if (request.method === 'GET' && request.url.startsWith('/api/products')) return await products(request, response);
    if (request.method === 'GET' && /^\/api\/categories\/[^/]+$/.test(request.url)) return await categoryGet(request, response, decodeURIComponent(request.url.split('/').pop()));
    if (request.method === 'GET' && request.url.startsWith('/api/categories')) return await categoriesList(request, response);
    if (request.method === 'GET' && /^\/api\/category\/[^/]+\/products$/.test(request.url)) return await categoryProducts(request, response, decodeURIComponent(request.url.split('/')[3]));
    if (request.method === 'POST' && request.url === '/api/orders') return await createOrder(request, response);
    if (request.method === 'GET' && request.url === '/api/orders') return await listMyOrders(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/products') return await adminCreateProduct(request, response);
    if (request.method === 'PUT' && request.url.startsWith('/api/admin/products')) return await adminUpdateProduct(request, response);
    if (request.method === 'DELETE' && request.url.startsWith('/api/admin/products')) return await adminDeleteProduct(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/categories')) return await adminCategoriesList(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/products')) return await adminProductsList(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/categories') return await adminCreateCategory(request, response);
    if (request.method === 'POST' && request.url.startsWith('/api/admin/categories/duplicate')) return await adminDuplicateCategory(request, response);
    if (request.method === 'PUT' && request.url.startsWith('/api/admin/categories')) return await adminUpdateCategory(request, response);
    if (request.method === 'DELETE' && request.url.startsWith('/api/admin/categories')) return await adminDeleteCategory(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/upload') return await adminUploadImage(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/orders')) return await adminListOrders(request, response);
    if (request.method === 'PUT' && request.url === '/api/admin/orders/status') return await adminUpdateOrderStatus(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/users')) return await adminListUsers(request, response);
    if (request.method === 'GET' && /^\/api\/admin\/users\/[^/]+$/.test(request.url)) return await adminGetUser(request, response, decodeURIComponent(request.url.split('/').pop()));
    if (request.method === 'PUT' && /^\/api\/admin\/users\/[^/]+$/.test(request.url)) return await adminUpdateUser(request, response, decodeURIComponent(request.url.split('/').pop()));
    if (request.method === 'POST' && /^\/api\/admin\/users\/[^/]+\/balance$/.test(request.url)) return await adminAdjustUserBalance(request, response, decodeURIComponent(request.url.split('/')[4]));
    if (request.method === 'POST' && request.url === '/api/cart/checkout') return await cartCheckout(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/balance/adjust') return await adminAdjustBalance(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/dashboard/stats')) return await adminDashboardStats(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/dashboard/charts')) return await adminDashboardCharts(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/audit-logs')) return await adminAuditLogs(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/messages') return await adminSendUserMessage(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/messages')) return await adminListMessages(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/announcements') return await adminCreateAnnouncement(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/announcements')) return await adminListAnnouncements(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/campaigns') return await adminCreateCampaign(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/campaigns')) return await adminListCampaigns(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/products/bulk') return await adminBulkProductAction(request, response);
    if (request.method === 'POST' && request.url === '/api/avatar/requests') return await submitAvatarRequest(request, response);
    if (request.method === 'GET' && request.url === '/api/avatar/requests') return await listMyAvatarRequests(request, response);
    if (request.method === 'POST' && request.url === '/api/deposits') return await submitDeposit(request, response);
    if (request.method === 'GET' && request.url === '/api/deposits') return await listMyDeposits(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/admin/avatar/requests')) return await adminListAvatarRequests(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/avatar/approve') return await adminApproveAvatar(request, response);

    // Real-time stream (Server-Sent Events)
    if (request.method === 'GET' && (request.url === '/api/stream' || request.url.startsWith('/api/stream?'))) return await sseStream(request, response);

    // Balance API
    if (request.method === 'GET' && request.url === '/api/balance') return await balanceGet(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/balance/history')) return await balanceHistory(request, response);
    if (request.method === 'POST' && request.url === '/api/balance/topup') return await balanceTopup(request, response);

    // Profile Dashboard API
    if (request.method === 'GET' && request.url === '/api/membership') return await membershipInfo(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/coupons')) return await userCoupons(request, response);
    if (request.method === 'POST' && request.url === '/api/coupons/validate') return await validateCouponEndpoint(request, response);
    if (request.method === 'GET' && request.url === '/api/statistics') return await userStatistics(request, response);
    if (request.method === 'GET' && request.url.startsWith('/api/orders/recent')) return await recentOrders(request, response);

    // Admin coupon management
    if (request.method === 'GET' && request.url.startsWith('/api/admin/coupons')) return await adminListCoupons(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/coupons') return await adminCreateCoupon(request, response);
    if (request.method === 'POST' && request.url === '/api/admin/coupons/assign') return await adminAssignCoupon(request, response);
    if (request.method === 'DELETE' && /^\/api\/admin\/coupons\/[^/]+$/.test(request.url)) return await adminDeleteCoupon(request, response, decodeURIComponent(request.url.split('/').pop()));

    // Cart API
    if (request.method === 'GET' && request.url === '/api/cart') return await cartGet(request, response);
    if (request.method === 'POST' && request.url === '/api/cart/items') return await cartAddItem(request, response);
    if (request.method === 'DELETE' && request.url === '/api/cart/clear') return await cartClear(request, response);
    if (request.method === 'PUT' && /^\/api\/cart\/items\/[^/]+$/.test(request.url)) {
      return await cartUpdateItem(request, response, decodeURIComponent(request.url.split('/').pop()));
    }
    if (request.method === 'DELETE' && /^\/api\/cart\/items\/[^/]+$/.test(request.url)) {
      return await cartRemoveItem(request, response, decodeURIComponent(request.url.split('/').pop()));
    }

    // Notifications API
    if (request.method === 'GET' && request.url.startsWith('/api/notifications')) return await notificationsList(request, response);
    if (request.method === 'PATCH' && request.url === '/api/notifications/read-all') return await notificationMarkAllRead(request, response);
    if (request.method === 'PATCH' && /^\/api\/notifications\/[^/]+\/read$/.test(request.url)) {
      return await notificationMarkRead(request, response, decodeURIComponent(request.url.split('/')[3]));
    }
    if (request.method === 'DELETE' && /^\/api\/notifications\/[^/]+$/.test(request.url)) {
      return await notificationDelete(request, response, decodeURIComponent(request.url.split('/').pop()));
    }

    // Admin panel routes (Node.js replacement for PHP admin)
    if (request.url === '/admin/login' || request.url.startsWith('/admin/login?')) return await admin.rLogin(request, response, pool);
    if (request.url === '/admin/logout') return await admin.rLogout(request, response, pool);
    if (request.url === '/admin/' || request.url === '/admin' || request.url.startsWith('/admin/?')) return await admin.rDashboard(request, response, pool);
    if (request.url === '/admin/users' || request.url.startsWith('/admin/users?')) return await admin.rUsers(request, response, pool);
    if (request.url === '/admin/orders' || request.url.startsWith('/admin/orders?')) return await admin.rOrders(request, response, pool);
    if (request.url === '/admin/categories' || request.url.startsWith('/admin/categories?')) return await admin.rCategories(request, response, pool);
    if (request.url === '/admin/products' || request.url.startsWith('/admin/products?')) return await admin.rProducts(request, response, pool);
    if (request.url === '/admin/balance-requests' || request.url.startsWith('/admin/balance-requests?')) return await admin.rBalanceRequests(request, response, pool);
    if (request.url === '/admin/deposits' || request.url.startsWith('/admin/deposits?')) return await admin.rDeposits(request, response, pool);
    if (request.url === '/admin/avatars' || request.url.startsWith('/admin/avatars?')) return await admin.rAvatars(request, response, pool);
    if (request.url === '/admin/receipt' || request.url.startsWith('/admin/receipt?')) return await admin.rReceipt(request, response, pool);
    if (request.url === '/admin/audit-logs' || request.url.startsWith('/admin/audit-logs?')) return await admin.rAuditLogs(request, response, pool);
    if (request.url === '/admin/campaigns' || request.url.startsWith('/admin/campaigns?')) return await admin.rCampaigns(request, response, pool);
    if (request.url === '/admin/messages' || request.url.startsWith('/admin/messages?')) return await admin.rMessages(request, response, pool);
    if (request.url === '/admin/announcements' || request.url.startsWith('/admin/announcements?')) return await admin.rAnnouncements(request, response, pool);

    if (request.method === 'GET') return await serveStatic(request, response);

    response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'Method not allowed' }));
  } catch (error) {
    console.error('[Server Error]', request.method, request.url, error);
    sendJson(response, 500, { message: 'Server xətası baş verdi.' });
  }
});

// Try connecting to PostgreSQL, but start HTTP server regardless so static files work
(async () => {
  try {
    await pool.query('SELECT NOW()');
    await dbEnsureSchema();
    await admin.ensureAdminSchema(pool);
    // Let admin routes broadcast real-time state updates (e.g. deposit approvals)
    if (admin.setSsePush) admin.setSsePush(ssePushState);
    if (admin.setMembershipRecalc) admin.setMembershipRecalc(recalcMembership);
    console.log('PostgreSQL connection successful.');
  } catch (error) {
    console.error(`[Warn] PostgreSQL connection failed. Details: ${error.message}`);
    console.error('Starting server in static-only mode; APIs may return errors until DB is available.');
  } finally {
    server.listen(PORT, () => {
      console.log(`ZELIX TOPUP running at http://localhost:${PORT}`);
    });
    // Periodically clean up expired sessions (every 1 hour)
    setInterval(() => { dbCleanupSessions().catch(() => {}); }, 60 * 60 * 1000);
    dbCleanupSessions().catch(() => {});
  }
})();
