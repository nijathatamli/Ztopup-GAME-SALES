const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcryptjs');
const { auditLog: sharedAuditLog, extractClientIp } = require('./lib/audit');

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ADMIN_SESSION_MAX_AGE_SECONDS = ADMIN_SESSION_MAX_AGE_MS / 1000;

// Convenience wrapper that injects the pool and request context for admin actions.
function auditLog(pool, action, payload = {}) {
  const { req, admin, ...rest } = payload;
  const meta = Object.keys(rest).length ? rest : null;
  sharedAuditLog(pool, {
    action,
    admin,
    req,
    targetType: payload.targetType || null,
    targetId: payload.targetId || null,
    oldValue: payload.oldValue || null,
    newValue: payload.newValue || null,
    meta
  });
}
let ssePushState = () => {}; // injected by server.js
function setSsePush(fn){ ssePushState = fn; }
let recalcMembership = () => {}; // injected by server.js
function setMembershipRecalc(fn){ recalcMembership = fn; }

const STYLE = `body{margin:0;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
a{color:#c9c9d1;text-decoration:none;margin-right:14px}
.wrap{padding:18px}
.card{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);padding:16px;margin-bottom:16px}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px;vertical-align:top}
input,button,select,textarea{background:#141427;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:8px 10px;font-family:inherit}
button{cursor:pointer}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}
.b-pending{background:rgba(255,193,7,.12);color:#ffd24d;border:1px solid rgba(255,193,7,.3)}
.b-approved{background:rgba(0,255,127,.12);color:#a3ffcf;border:1px solid rgba(0,255,127,.3)}
.b-rejected{background:rgba(255,99,71,.12);color:#ffb3a7;border:1px solid rgba(255,99,71,.3)}
.btn-approve{background:#1f8b4c;border-color:#27ae60}
.btn-reject{background:#8b2e2e;border-color:#c0392b}
.actions{display:flex;gap:6px;flex-wrap:wrap}
dialog{background:#12121d;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:18px;width:min(420px,92vw)}
dialog::backdrop{background:rgba(0,0,0,.6)}
dialog h3{margin:0 0 12px;font-family:Orbitron,sans-serif}
dialog label{display:block;font-size:13px;color:#c9c9d1;margin:10px 0 6px}
dialog input,dialog textarea{width:100%;box-sizing:border-box}
.row-end{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.thumb{width:84px;height:84px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.12);cursor:zoom-in}
.stat{font-family:Orbitron,sans-serif;font-size:28px;font-weight:800}
.grid{display:grid;gap:14px;padding:18px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.flash-ok{border-color:rgba(0,255,127,.25)!important;color:#a3ffcf!important}
.flash-bad{border-color:rgba(255,99,71,.35)!important;color:#ffb3a7!important}
@media(max-width:760px){
  .wrap{padding:12px}
  .card{padding:12px;border-radius:12px;margin-bottom:12px}
  header{flex-wrap:wrap;gap:10px;padding:12px 14px}
  header nav{display:flex;flex-wrap:wrap;gap:4px 0;width:100%}
  a{margin-right:12px;font-size:14px;line-height:2}
  table{display:block;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch}
  th,td{font-size:13px;padding:7px 8px}
  input,select,textarea,button{font-size:16px;min-height:44px;box-sizing:border-box}
  .actions{flex-direction:column;align-items:stretch}
  .actions button,.actions a{width:100%}
  .thumb{width:60px;height:60px}
  .field-row{grid-template-columns:1fr 1fr!important}
  .stat{font-size:24px}
}`;

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function page(title, navHtml, content, flash) {
  const fh = flash ? `<div class="card ${flash.type==='bad'?'flash-bad':'flash-ok'}">${esc(flash.msg)}</div>` : '';
  return `<!doctype html><html lang="az"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} • ZTOPUP Admin</title>
<link rel="icon" type="image/svg+xml" href="/assets/zelix-generated-logo.svg">
<link rel="alternate icon" href="/assets/zelix-logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Rajdhani:wght@500;700&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body>
<header><div style="font-family:Orbitron,sans-serif;font-weight:800;letter-spacing:.12em">ZTOPUP • ADMIN</div><nav>${navHtml}</nav></header>
<div class="wrap">${fh}${content}</div></body></html>`;
}

function nav(cur) {
  const items = [
    {u:'/admin/',l:'Panel'},
    {u:'/admin/users',l:'İstifadəçilər'},
    {u:'/admin/orders',l:'Sifarişlər'},
    {u:'/admin/products',l:'Məhsullar'},
    {u:'/admin/categories',l:'Kateqoriyalar'},
    {u:'/admin/campaigns',l:'Kampaniyalar'},
    {u:'/admin/messages',l:'Mesajlar'},
    {u:'/admin/announcements',l:'Elanlar'},
    {u:'/admin/audit-logs',l:'Audit Log'},
    {u:'/admin/balance-requests',l:'Balans'},
    {u:'/admin/deposits',l:'Depozitlər'},
    {u:'/admin/avatars',l:'Avatar'},
    {u:'/admin/logout',l:'Çıxış'}
  ];
  return items.map(i=>`<a href="${i.u}"${i.u===cur?' style="color:#fff;font-weight:700"':''}>${i.l}</a>`).join('');
}

function parseCookies(r){const raw=r.headers.cookie||'',c={};raw.split(';').forEach(p=>{const[k,...rest]=p.trim().split('=');if(k)c[k]=decodeURIComponent(rest.join('='));});return c;}
function setCookie(r,name,val,age=1800){r.appendHeader('Set-Cookie',`${name}=${encodeURIComponent(val)}; HttpOnly; Path=/; Max-Age=${age}; SameSite=Lax`);}
function clearCookie(r,name){r.appendHeader('Set-Cookie',`${name}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);}
function csrfToken(){return crypto.randomBytes(32).toString('hex');}
async function createNotification(pool, userId, title, message, type='system'){
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO notifications(id,user_id,title,message,type)VALUES($1,$2,$3,$4,$5)',[id,userId,title,message,type]);
}

async function findAdmin(pool, identifier){
  const id = String(identifier||'').trim().toLowerCase();
  const { rows } = await pool.query('SELECT * FROM admins WHERE active=true AND (LOWER(username)=$1 OR LOWER(email)=$1) LIMIT 1',[id]);
  return rows[0] || null;
}
async function findAdminById(pool, adminId){
  const { rows } = await pool.query('SELECT * FROM admins WHERE id=$1 LIMIT 1',[String(adminId)]);
  return rows[0] || null;
}

function hashPw(pw){return bcrypt.hashSync(pw,10);}
function verifyPw(pw,stored){if(!stored)return false;if(/^\$2[ayb]\$/.test(stored))return bcrypt.compareSync(pw,stored.replace(/^\$2y\$/,'$2a$'));const[salt,oh]=stored.split(':');if(!salt||!oh)return false;const h=crypto.scryptSync(pw,salt,64);const o=Buffer.from(oh,'hex');return o.length===h.length&&crypto.timingSafeEqual(o,h);}
async function sendHtml(res,code,html){res.writeHead(code,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}
async function readBody(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>1_000_000){req.destroy();reject(new Error('Too large'));}});req.on('end',()=>{try{resolve(JSON.parse(b));}catch{const o={};b.split('&').forEach(p=>{const[k,v]=p.split('=');if(k)o[decodeURIComponent(k.replace(/\+/g,' '))]=decodeURIComponent((v||'').replace(/\+/g,' '));});resolve(o);}});req.on('error',reject);});}

async function getAdmin(req,pool){
  const c=parseCookies(req);
  const tok=c.admin_token||'';
  if(!tok)return null;
  try{
    const payload=jwt.verify(tok,JWT_SECRET);
    const adminId=payload.sub;
    const jti=payload.jti;
    if(!adminId||!jti)return null;
    // Ensure session is still active in DB (revocable sessions)
    const { rows }=await pool.query('SELECT * FROM admin_sessions WHERE token=$1 AND admin_id=$2 AND expires_at>NOW() LIMIT 1',[jti,adminId]);
    if(!rows.length)return null;
    const session=rows[0];
    // Extend session expiry on activity
    await pool.query('UPDATE admin_sessions SET expires_at=NOW() + $1::interval WHERE token=$2',[ADMIN_SESSION_MAX_AGE_SECONDS + ' seconds',jti]);
    const a=await findAdminById(pool,adminId);
    if(!a||a.active===false)return null;
    return {id:a.id,username:a.username,email:a.email,role:a.role||'admin',active:a.active!==false,csrfToken:session.csrf_token||c.admin_csrf||''};
  }catch{return null;}
}
async function requireAdmin(req,res,pool){const a=await getAdmin(req,pool);if(!a){res.writeHead(302,{Location:'/admin/login'});res.end();return null;}return a;}

async function getAdminRolePermissions(pool, role){
  if (!role) return [];
  const { rows } = await pool.query('SELECT permission FROM admin_permissions WHERE role=$1', [role]);
  return rows.map(r => r.permission);
}
async function hasAdminPermission(pool, admin, permission){
  if (!admin || !admin.role) return false;
  if (admin.role === 'super_admin') return true;
  const perms = await getAdminRolePermissions(pool, admin.role);
  return perms.includes(permission) || perms.includes('*');
}
async function requireAdminPermission(req,res,pool,permission){
  const a = await requireAdmin(req,res,pool);
  if (!a) return null;
  if (a.role === 'super_admin') return a;
  const ok = await hasAdminPermission(pool,a,permission);
  if (!ok) { res.writeHead(302,{Location:'/admin/'}); res.end(); return null; }
  return a;
}
async function sendForbidden(res, message='İcazə yoxdur'){return sendHtml(res,403,`<!doctype html><html lang="az"><head><meta charset="utf-8"/><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b12;color:#fff;font-family:system-ui}</style></head><body><h1>${esc(message)}</h1></body></html>`);}

async function ensureAdminSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    role TEXT NOT NULL DEFAULT 'admin',
    last_login_at TIMESTAMP NULL,
    last_login_ip VARCHAR(45) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT \'admin\'');
  await pool.query('ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL');
  await pool.query('ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(45) NULL');
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_roles (
    role TEXT PRIMARY KEY,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('ALTER TABLE admin_roles ADD COLUMN IF NOT EXISTS role TEXT');
  await pool.query("UPDATE admin_roles SET role = COALESCE(role, name, 'role_' || COALESCE(id::text, 'legacy')) WHERE role IS NULL");
  await pool.query("UPDATE admin_roles SET name = COALESCE(name, role, 'Legacy Role') WHERE name IS NULL");
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS admin_roles_role_key ON admin_roles(role)');

  await pool.query(`CREATE TABLE IF NOT EXISTS admin_permissions (
    role TEXT NOT NULL REFERENCES admin_roles(role) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role, permission)
  )`);
  await pool.query('ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS role TEXT');
  await pool.query(`UPDATE admin_permissions ap
    SET role = ar.role
    FROM admin_roles ar
    WHERE ap.role IS NULL AND ap.role_id IS NOT NULL AND ar.id = ap.role_id`);
  await pool.query("UPDATE admin_permissions SET role = COALESCE(role, 'admin') WHERE role IS NULL");
  await pool.query('ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await pool.query(`UPDATE admin_permissions ap
    SET role_id = ar.id
    FROM admin_roles ar
    WHERE ap.role_id IS NULL AND ap.role = ar.role`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS admin_permissions_role_permission_key ON admin_permissions(role, permission)');
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_sessions (
    id VARCHAR(36) PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    refresh_token_hash TEXT NOT NULL,
    csrf_token VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS refresh_token_hash TEXT');
  await pool.query("UPDATE admin_sessions SET refresh_token_hash = COALESCE(refresh_token_hash, token, 'legacy_refresh_token') WHERE refresh_token_hash IS NULL OR refresh_token_hash = ''");
  await pool.query('ALTER TABLE admin_sessions ALTER COLUMN refresh_token_hash SET NOT NULL');
  await pool.query("ALTER TABLE admin_sessions ALTER COLUMN refresh_token_hash SET DEFAULT ''");
  await pool.query('ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS csrf_token VARCHAR(255)');
  await pool.query('ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)');
  await pool.query('ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT');
  await pool.query('ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)');
  // Seed default roles and permissions (idempotent)
  const roles = [
    { role: 'super_admin', description: 'Full system access' },
    { role: 'admin', description: 'Standard admin access' },
    { role: 'moderator', description: 'Order and user management' },
    { role: 'support', description: 'Customer support access' }
  ];
  for (const r of roles) {
    await pool.query(
      'INSERT INTO admin_roles(role, name, description) VALUES ($1, $2, $3) ON CONFLICT (role) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description',
      [r.role, r.role, r.description]
    );
  }
  const permissions = [
    // super_admin gets everything implicitly
    { role: 'admin', permission: 'dashboard' },
    { role: 'admin', permission: 'users.view' }, { role: 'admin', permission: 'users.manage' }, { role: 'admin', permission: 'users.balance' },
    { role: 'admin', permission: 'orders.view' }, { role: 'admin', permission: 'orders.manage' },
    { role: 'admin', permission: 'products.view' }, { role: 'admin', permission: 'products.manage' },
    { role: 'admin', permission: 'categories.view' }, { role: 'admin', permission: 'categories.manage' },
    { role: 'admin', permission: 'campaigns.view' }, { role: 'admin', permission: 'campaigns.manage' },
    { role: 'admin', permission: 'announcements.view' }, { role: 'admin', permission: 'announcements.manage' },
    { role: 'admin', permission: 'messages.view' }, { role: 'admin', permission: 'messages.manage' },
    { role: 'admin', permission: 'balance.view' }, { role: 'admin', permission: 'balance.manage' },
    { role: 'admin', permission: 'deposits.view' }, { role: 'admin', permission: 'deposits.manage' },
    { role: 'admin', permission: 'audit_logs.view' },
    { role: 'admin', permission: 'avatars.view' }, { role: 'admin', permission: 'avatars.manage' },
    { role: 'admin', permission: 'coupons.view' }, { role: 'admin', permission: 'coupons.manage' },
    { role: 'admin', permission: 'settings.view' }, { role: 'admin', permission: 'settings.manage' },
    { role: 'moderator', permission: 'dashboard' },
    { role: 'moderator', permission: 'users.view' }, { role: 'moderator', permission: 'users.manage' },
    { role: 'moderator', permission: 'orders.view' }, { role: 'moderator', permission: 'orders.manage' },
    { role: 'moderator', permission: 'products.view' },
    { role: 'moderator', permission: 'categories.view' },
    { role: 'moderator', permission: 'messages.view' }, { role: 'moderator', permission: 'messages.manage' },
    { role: 'moderator', permission: 'balance.view' }, { role: 'moderator', permission: 'balance.manage' },
    { role: 'moderator', permission: 'deposits.view' }, { role: 'moderator', permission: 'deposits.manage' },
    { role: 'moderator', permission: 'avatars.view' },
    { role: 'support', permission: 'dashboard' },
    { role: 'support', permission: 'users.view' },
    { role: 'support', permission: 'orders.view' },
    { role: 'support', permission: 'messages.view' }, { role: 'support', permission: 'messages.manage' },
    { role: 'support', permission: 'deposits.view' },
    { role: 'support', permission: 'balance.view' }
  ];
  for (const p of permissions) {
    const { rows: roleRows } = await pool.query('SELECT id FROM admin_roles WHERE role = $1 LIMIT 1', [p.role]);
    const roleId = roleRows.length ? roleRows[0].id : null;
    await pool.query(
      `INSERT INTO admin_permissions(role, role_id, permission, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (role, permission) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [p.role, roleId, p.permission]
    );
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS balance_requests (id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,amount DECIMAL(10,2) NOT NULL,image_url TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'pending',reviewed_by TEXT NULL,reviewed_at TIMESTAMP NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_balance_user ON balance_requests(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_balance_status ON balance_requests(status)');
  // Seed/repair default admin credentials from admin-credentials.json on every boot
  try{
    const fs = require('fs');
    const adminFile = path.join(__dirname, 'admin-credentials.json');
    let defaultAdmins = [];
    if(fs.existsSync(adminFile)){
      const data = JSON.parse(fs.readFileSync(adminFile,'utf8'));
      if(Array.isArray(data.admins)) defaultAdmins = data.admins;
    }
    for(const a of defaultAdmins){
      const id = String(a.id || crypto.randomUUID());
      const username = (a.username || 'admin').trim();
      const email = (a.email || 'admin@ztopup.az').trim().toLowerCase();
      const passwordHash = a.password_hash || '';
      const active = a.active !== false;
      const role = a.role || 'admin';

      await pool.query(
        `INSERT INTO admins(id, username, email, password_hash, active, role, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET
           username = EXCLUDED.username,
           email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           active = EXCLUDED.active,
           role = EXCLUDED.role,
           updated_at = NOW()`,
        [id, username, email, passwordHash, active, role]
      );

      await pool.query(
        `UPDATE admins SET
           username = $2,
           email = $3,
           password_hash = $4,
           active = $5,
           role = $6,
           updated_at = NOW()
         WHERE id <> $1 AND (LOWER(username) = LOWER($2) OR LOWER(email) = LOWER($3))`,
        [id, username, email, passwordHash, active, role]
      );
    }
  }catch(e){ console.error('[Admin] Migration warning:', e.message); }
  const { rows: adminCount } = await pool.query('SELECT COUNT(*)::int AS c FROM admins');
  console.log(`[Admin] ${adminCount[0].c} admin(s) in database`);
}

const loginAttempts = new Map();
function checkLoginLimit(ip){
  const now = Date.now();
  const key = ip;
  const attempts = loginAttempts.get(key);
  if (!attempts || now > attempts.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (attempts.count >= 10) return false;
  attempts.count += 1;
  return true;
}

async function rLogin(req,res,pool){
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  if(req.method==='GET'){
    const currentAdmin = await getAdmin(req,pool);
    if (currentAdmin) { res.writeHead(302,{Location:'/admin/'}); res.end(); return; }
    if (!checkLoginLimit(clientIp)) return sendHtml(res,429,'<h1>Çox sayda cəhdi. Bir az gözləyin.</h1>');
    const t=csrfToken();setCookie(res,'admin_csrf',t,3600);const html=`<!doctype html><html lang="az"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Admin Giriş</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}.card{width:100%;max-width:420px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:24px}h1{font-size:22px;margin:0 0 16px}label{display:block;font-size:13px;color:#c9c9d1;margin:10px 0 6px}input{width:100%;background:#141427;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:10px 12px;outline:none;box-sizing:border-box}button{width:100%;margin-top:16px;background:#6c4df4;border:none;color:#fff;padding:12px 14px;border-radius:12px;font-weight:800;cursor:pointer}.error{margin-top:10px;background:rgba(255,99,71,.1);border:1px solid rgba(255,99,71,.3);padding:10px;border-radius:10px;color:#ffb3a7}</style></head><body><div class="card"><h1>Admin Giriş</h1><form method="post" autocomplete="on"><input type="hidden" name="csrf" value="${esc(t)}"/><label>Email və ya İstifadəçi Adı</label><input type="text" name="identifier" required/><label>Şifrə</label><input type="password" name="password" required/><button type="submit">Daxil ol</button></form></div></body></html>`;return sendHtml(res,200,html);}
    if(req.method==='POST'){if(!checkLoginLimit(clientIp))return sendHtml(res,429,'<h1>Çox sayda cəhdi. Bir az gözləyin.</h1>');try{const body=await readBody(req);const id=String(body.identifier||'').trim().toLowerCase();const pw=String(body.password||'');const a=await findAdmin(pool,id);if(!a||!verifyPw(pw,a.password_hash)){auditLog(pool,'admin_login_failed',{admin:{id:'unknown',username:'unknown'},req,targetId:id,meta:{identifier:id}});const t=csrfToken();setCookie(res,'admin_csrf',t,3600);const html=`<!doctype html><html lang="az"><head><meta charset="utf-8"/><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}.card{width:100%;max-width:420px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:24px}h1{font-size:22px;margin:0 0 16px}label{display:block;font-size:13px;color:#c9c9d1;margin:10px 0 6px}input{width:100%;background:#141427;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:10px 12px;outline:none;box-sizing:border-box}button{width:100%;margin-top:16px;background:#6c4df4;border:none;color:#fff;padding:12px 14px;border-radius:12px;font-weight:800;cursor:pointer}.error{margin-top:10px;background:rgba(255,99,71,.1);border:1px solid rgba(255,99,71,.3);padding:10px;border-radius:10px;color:#ffb3a7}</style></head><body><div class="card"><h1>Admin Girişi</h1><div class="error">Giriş məlumatları səhvdir</div><form method="post"><input type="hidden" name="csrf" value="${esc(t)}"/><label>Email və ya İstifadəçi Adı</label><input type="text" name="identifier" required value="${esc(id)}"/><label>Şifrə</label><input type="password" name="password" required/><button type="submit">Daxil ol</button></form></div></body></html>`;return sendHtml(res,200,html);}
    const jti=crypto.randomUUID();
    const csrf=csrfToken();
    const sessionId=crypto.randomUUID();
    const refreshToken=crypto.randomBytes(32).toString('hex');
    const refreshHash=crypto.createHash('sha256').update(refreshToken).digest('hex');
    const token=jwt.sign({sub:String(a.id),jti},JWT_SECRET,{expiresIn:ADMIN_SESSION_MAX_AGE_SECONDS});
    const ua=String(req.headers['user-agent']||'unknown').slice(0,255);
    const expiresInterval=ADMIN_SESSION_MAX_AGE_SECONDS + ' seconds';
    await pool.query(
      `INSERT INTO admin_sessions(id,admin_id,token,refresh_token_hash,csrf_token,ip_address,user_agent,expires_at,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,NOW() + $8::interval,NOW())`,
      [sessionId,String(a.id),jti,refreshHash,csrf,clientIp,ua,expiresInterval]
    );
    await pool.query('UPDATE admins SET last_login_at=NOW(), last_login_ip=$1 WHERE id=$2',[clientIp,String(a.id)]);
    setCookie(res,'admin_token',token,ADMIN_SESSION_MAX_AGE_SECONDS);
    setCookie(res,'admin_refresh_token',refreshToken,ADMIN_SESSION_MAX_AGE_SECONDS);
    setCookie(res,'admin_csrf',csrf, ADMIN_SESSION_MAX_AGE_SECONDS);
    auditLog(pool,'admin_login_success',{admin:a,req,targetId:a.id,meta:{adminId:a.id,username:a.username}});
    res.writeHead(302,{Location:'/admin/'});res.end();}catch(e){console.error('[Admin Login Error]',e);return sendHtml(res,500,'<h1>Server xətası: '+esc(e.message)+'</h1>');}}
}

async function rLogout(req,res,pool){
  const c=parseCookies(req);
  if(c.admin_token){
    try{
      const payload=jwt.verify(c.admin_token,JWT_SECRET);
      if(payload.jti) await pool.query('DELETE FROM admin_sessions WHERE token=$1',[payload.jti]);
    }catch{}
  }
  clearCookie(res,'admin_token');
  clearCookie(res,'admin_refresh_token');
  clearCookie(res,'admin_csrf');
  res.writeHead(302,{Location:'/admin/login'});
  res.end();
}

async function rDashboard(req,res,pool){const a=await requireAdminPermission(req,res,pool,'dashboard');if(!a)return;const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);
  const content=`<main class="wrap">
  <div class="toolbar" style="display:flex;gap:10px;align-items:center;margin-bottom:18px;flex-wrap:wrap">
    <h2 style="margin:0;font-family:Orbitron,sans-serif;font-size:22px">Dashboard</h2>
    <select id="range" onchange="loadAll()">
      <option value="today">Bugün</option>
      <option value="7days">Son 7 gün</option>
      <option value="30days">Son 30 gün</option>
      <option value="year">Bu il</option>
    </select>
  </div>
  <div id="dashError" class="card" style="display:none;color:#ffb3a7;border-color:rgba(255,99,71,.35)"></div>
  <div class="grid" id="statGrid"></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(420px,1fr))">
    <div class="card"><h3 style="font-family:Orbitron,sans-serif;margin:0 0 12px">Günlük satışlar</h3><div id="dailyChartWrap" style="height:180px"><canvas id="dailyChart"></canvas></div></div>
    <div class="card"><h3 style="font-family:Orbitron,sans-serif;margin:0 0 12px">Status paylanması</h3><div id="statusChartWrap" style="height:180px"><canvas id="statusChart"></canvas></div></div>
    <div class="card"><h3 style="font-family:Orbitron,sans-serif;margin:0 0 12px">Yeni istifadəçilər</h3><div id="usersChartWrap" style="height:180px"><canvas id="usersChart"></canvas></div></div>
    <div class="card"><h3 style="font-family:Orbitron,sans-serif;margin:0 0 12px">Ən çox satılan kateqoriyalar</h3><div id="topCategories" style="max-height:220px;overflow:auto"></div></div>
  </div>
</main>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
let charts={};
function showError(msg){const el=document.getElementById('dashError');if(el){el.textContent=msg;el.style.display='block';}console.error(msg);}
function showEmpty(id,msg){const el=document.getElementById(id);if(el)el.innerHTML='<div style="color:#9a9aa6;padding:20px 0">'+(msg||'Məlumat yoxdur')+'</div>';}
async function api(url,opts={}){opts.headers=opts.headers||{};opts.headers['X-CSRF-Token']='${esc(cs)}';if(opts.body&&typeof opts.body==='object'){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(opts.body);}const r=await fetch(url,opts);if(!r.ok){const text=await r.text();throw new Error(text.slice(0,200));}return r.json();}
async function loadStats(){try{const range=document.getElementById('range').value;const data=await api('/api/admin/dashboard/stats?range='+range);const s=data.stats;const cards=[['Bugünkü gəlir','₼ '+Number(s.todayRevenue||0).toFixed(2)],['Həftəlik gəlir','₼ '+Number(s.weeklyRevenue||0).toFixed(2)],['Aylıq gəlir','₼ '+Number(s.monthlyRevenue||0).toFixed(2)],['Ümumi gəlir','₼ '+Number(s.totalRevenue||0).toFixed(2)],['Bugünkü sifariş',s.todayOrders||0],['Gözləmədə',s.pendingOrders||0],['Emalda',s.processingOrders||0],['Tamamlanmış',s.completedOrders||0],['Rədd edilmiş',s.rejectedOrders||0],['Ümumi istifadəçi',s.totalUsers||0],['Yeni istifadəçi (bugün)',s.newUsersToday||0],['Yeni istifadəçi (həftə)',s.newUsersWeekly||0],['Yeni istifadəçi (ay)',s.newUsersMonthly||0],['Onlayn',s.onlineUsers||0],['Gözləyən balans',s.pendingBalance||0],['Gözləyən depozit',s.pendingDeposits||0]];document.getElementById('statGrid').innerHTML=cards.map(([l,v])=>\`<div class="card"><div style="color:#c9c9d1;font-size:13px">\${l}</div><div class="stat">\${v}</div></div>\`).join('');}catch(e){showError('Statistikalar yüklənmədi: '+e.message);showEmpty('statGrid','Məlumat yoxdur');}}
async function loadCharts(){try{const range=document.getElementById('range').value;const data=await api('/api/admin/dashboard/charts?range='+range);const labels=data.dailySales.map(d=>d.day);const dailyRevenue=data.dailySales.map(d=>Number(d.revenue||0));const dailyOrders=data.dailySales.map(d=>Number(d.orders||0));const newUsers=data.newUsers.map(d=>Number(d.users||0));const statusLabels=data.orderStatusDistribution.map(d=>d.status_code);const statusValues=data.orderStatusDistribution.map(d=>Number(d.count||0));if(charts.daily)charts.daily.destroy();charts.daily=new Chart(document.getElementById('dailyChart'),{type:'bar',data:{labels,datasets:[{label:'Gəlir (₼)',data:dailyRevenue,backgroundColor:'#f1c40f'},{label:'Sifariş',data:dailyOrders,backgroundColor:'#6c4df4'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}},plugins:{legend:{labels:{color:'#fff'}}}}});
if(charts.status)charts.status.destroy();charts.status=new Chart(document.getElementById('statusChart'),{type:'doughnut',data:{labels:statusLabels,datasets:[{data:statusValues,backgroundColor:['#f1c40f','#6c4df4','#27ae60','#e74c3c']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#fff'}}}}});
if(charts.users)charts.users.destroy();charts.users=new Chart(document.getElementById('usersChart'),{type:'line',data:{labels,datasets:[{label:'Yeni istifadəçilər',data:newUsers,borderColor:'#3498db',tension:0.3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#fff'}}},scales:{y:{beginAtZero:true}}}});
if(data.topCategories&&data.topCategories.length){document.getElementById('topCategories').innerHTML=data.topCategories.map((c,i)=>\`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)"><span>#\${i+1} \${c.name||'Digər'}</span><span style="color:#f1c40f">₼ \${Number(c.revenue||0).toFixed(2)}</span></div>\`).join('');}else{showEmpty('topCategories','Hələ satış edilməyib');}}catch(e){showError('Qrafiklər yüklənmədi: '+e.message);showEmpty('dailyChartWrap','Məlumat yoxdur');showEmpty('statusChartWrap','Məlumat yoxdur');showEmpty('usersChartWrap','Məlumat yoxdur');showEmpty('topCategories','Məlumat yoxdur');}}
async function loadAll(){await loadStats();await loadCharts();}
loadAll();
</script>`;
  sendHtml(res,200,page('Admin Panel',nav('/admin/'),content));
}

async function rDeposits(req,res,pool){
  const a=await requireAdminPermission(req,res,pool,'deposits.view');if(!a)return;
  let flash=null;const url=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==='POST'){const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==a.csrfToken)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const id=String(body.id||''),action=String(body.action||''),note=String(body.note||'').trim();if(id&&(action==='approve'||action==='reject')){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT*FROM deposit_requests WHERE id=$1 LIMIT 1 FOR UPDATE',[id]);const row=r.rows[0];if(!row)throw new Error('Sorğu tapılmadı');if(String(row.status).toLowerCase()!=='pending')throw new Error('Bu sorğu artıq emal edilib');if(action==='approve'){const amt=parseFloat(body.amount||0);if(!isFinite(amt)||amt<=0)throw new Error('Düzgün məbləğ daxil edin');await client.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[amt,row.user_id]);await client.query("UPDATE deposit_requests SET status='approved',approved_at=NOW(),admin_note=$1 WHERE id=$2",[note||null,id]);const tid=crypto.randomBytes(16).toString('hex');await client.query('INSERT INTO transactions(id,user_id,amount,type,status,ref)VALUES($1,$2,$3,$4,$5,$6)',[tid,row.user_id,amt,'credit','approved','Deposit approved by admin (request '+row.id+')']);await createNotification(client,row.user_id,'Balans artırıldı','Hesabınıza '+amt.toFixed(2)+' ₼ əlavə olundu.','balance');ssePushState(row.user_id);recalcMembership(row.user_id);flash={type:'ok',msg:'Depozit təsdiqləndi və '+amt.toFixed(2)+' ₼ balansa əlavə olundu'};auditLog(pool,'admin_deposit_approved',{admin:a,req,targetType:'deposit_request',targetId:id,oldValue:{status:'pending'},newValue:{status:'approved',amount:amt},meta:{userId:row.user_id}});}else{await client.query("UPDATE deposit_requests SET status='rejected',approved_at=NOW(),admin_note=$1 WHERE id=$2",[note||null,id]);flash={type:'ok',msg:'Depozit sorğusu rədd edildi'};auditLog(pool,'admin_deposit_rejected',{admin:a,req,targetType:'deposit_request',targetId:id,oldValue:{status:'pending'},newValue:{status:'rejected'},meta:{userId:row.user_id}});}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK').catch(()=>{});flash={type:'bad',msg:'Xəta: '+e.message};}finally{client.release();}}}
  const status=url.searchParams.get('status')||'pending';let sql='SELECT d.*,u.username,u.email FROM deposit_requests d LEFT JOIN users u ON u.id=d.user_id',params=[];if(status){sql+=' WHERE LOWER(d.status)=LOWER($1)';params.push(status);}sql+=' ORDER BY d.created_at DESC LIMIT 300';const{rows}=await pool.query(sql,params);
  const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);
  let tr='';if(!rows.length)tr=`<tr><td colspan="9" style="color:#9a9aa6">Sorğu yoxdur.</td></tr>`;
  for(const r of rows){const st=String(r.status).toLowerCase();const img='/admin/receipt?file='+encodeURIComponent(r.receipt_image);const acts=st==='pending'?`<div class="actions"><button class="btn-approve" onclick="openApprove('${esc(r.id)}','${esc(r.username||'')}','${esc(parseFloat(r.requested_amount||0).toFixed(2))}')">Təsdiqlə</button><button class="btn-reject" onclick="openReject('${esc(r.id)}')">Rədd et</button></div>`:`<span style="color:#9a9aa6">—</span>`;tr+=`<tr><td style="font-size:12px;color:#9a9aa6">${esc((r.id||'').slice(0,8))}</td><td>${esc(r.username||'—')}</td><td>${esc(r.email||'—')}</td><td><img class="thumb" src="${esc(img)}" onclick="viewImg('${esc(img)}')"/></td><td>₼ ${parseFloat(r.requested_amount||0).toFixed(2)}</td><td><span class="badge ${st==='approved'?'b-approved':(st==='rejected'?'b-rejected':'b-pending')}">${esc(r.status)}</span></td><td style="font-size:12px">${esc(String(r.created_at).slice(0,19))}</td><td style="max-width:180px;font-size:12px;color:#c9c9d1">${esc(r.admin_note||'')}</td><td>${acts}</td></tr>`;}
  const content=`<form method="get" class="card" style="display:flex;gap:10px;align-items:center"><label>Status:</label><select name="status"><option value="" ${status===''?'selected':''}>Hamısı</option><option value="pending" ${status==='pending'?'selected':''}>Gözləmədə</option><option value="approved" ${status==='approved'?'selected':''}>Təsdiqlənmiş</option><option value="rejected" ${status==='rejected'?'selected':''}>Rədd edilmiş</option></select><button type="submit">Filtrlə</button></form><div class="card"><table><thead><tr><th>ID</th><th>İstifadəçi</th><th>Email</th><th>Qəbz</th><th>İstənilən Məbləğ</th><th>Status</th><th>Tarix</th><th>Qeyd</th><th>Əməliyyat</th></tr></thead><tbody>${tr}</tbody></table></div>
<dialog id="am"><form method="post"><h3>Depoziti Təsdiqlə</h3><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="action" value="approve"/><input type="hidden" name="id" id="aid"/><div style="font-size:13px;color:#9a9aa6">İstifadəçi: <span id="au"></span></div><label>Balansa əlavə olunacaq məbləğ (₼)</label><input type="number" step="0.01" min="0.01" name="amount" id="aa" required/><label>Qeyd</label><textarea name="note" rows="2"></textarea><div class="row-end"><button type="button" onclick="document.getElementById('am').close()">Ləğv et</button><button class="btn-approve" type="submit">Təsdiqlə</button></div></form></dialog>
<dialog id="rm"><form method="post"><h3>Depoziti Rədd et</h3><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="action" value="reject"/><input type="hidden" name="id" id="rid"/><label>Rədd səbəbi</label><textarea name="note" rows="3"></textarea><div class="row-end"><button type="button" onclick="document.getElementById('rm').close()">Ləğv et</button><button class="btn-reject" type="submit">Rədd et</button></div></form></dialog>
<dialog id="im"><img id="is" src="" style="max-width:100%;max-height:70vh;border-radius:10px"/><div class="row-end"><button type="button" onclick="document.getElementById('im').close()">Bağla</button></div></dialog>
<script>function openApprove(id,user,amt){document.getElementById('aid').value=id;document.getElementById('au').textContent=user||'—';document.getElementById('aa').value=(amt&&parseFloat(amt)>0)?amt:'';document.getElementById('am').showModal();}function openReject(id){document.getElementById('rid').value=id;document.getElementById('rm').showModal();}function viewImg(src){document.getElementById('is').src=src;document.getElementById('im').showModal();}</script>`;
  sendHtml(res,200,page('Depozit Sorğuları',nav('/admin/deposits'),content,flash));
}

async function rUsers(req,res,pool){
  const a=await requireAdminPermission(req,res,pool,'users.view');if(!a)return;
  let flash=null;const url=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==='POST'){const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==a.csrfToken)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const uid=String(body.user_id||''),amt=parseFloat(body.amount||0),reason=String(body.reason||'Admin adjustment').trim();if(uid&&amt!==0){const client=await pool.connect();try{await client.query('BEGIN');await client.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[amt,uid]);const tid=crypto.randomBytes(16).toString('hex');await client.query('INSERT INTO transactions(id,user_id,amount,type,status,ref,description)VALUES($1,$2,$3,$4,$5,$6,$7)',[tid,uid,Math.abs(amt),amt>0?'credit':'debit','approved',reason,reason]);await createNotification(client,uid,(amt>0?'Balans artırıldı':'Balans azaldıldı'),'Hesabınız '+Math.abs(amt).toFixed(2)+' ₼ '+(amt>0?'əlavə edildi':'azaldıldı')+'.','balance');ssePushState(uid);auditLog(pool,'admin_balance_adjustment',{admin:a,req,targetType:'user',targetId:uid,oldValue:{balanceChange:0},newValue:{balanceChange:amt,reason},meta:{userId:uid}});await client.query('COMMIT');flash={type:'ok',msg:'Balans yeniləndi'};}catch(e){await client.query('ROLLBACK').catch(()=>{});flash={type:'bad',msg:'Xəta: '+e.message};}finally{client.release();}}}
  const q=String(url.searchParams.get('q')||'').trim();const pageNum=Math.max(1,parseInt(url.searchParams.get('page')||'1',10));const limit=50;const offset=(pageNum-1)*limit;
  let sql='SELECT id,username,email,first_name,last_name,balance,status,membership_level,created_at FROM users WHERE deleted_at IS NULL',params=[],conds=[];if(q){conds.push('(LOWER(username) LIKE $1 OR LOWER(email) LIKE $1 OR id::text=$2)');params.push('%'+q.toLowerCase()+'%',q);}if(conds.length)sql+=' AND '+conds.join(' AND ');sql+=' ORDER BY created_at DESC LIMIT $'+(params.length+1)+' OFFSET $'+(params.length+2);params.push(limit,offset);
  const{rows:users}=await pool.query(sql,params);
  const countRes=await pool.query('SELECT COUNT(*)::int AS c FROM users WHERE deleted_at IS NULL'+(q?' AND (LOWER(username) LIKE $1 OR LOWER(email) LIKE $1 OR id::text=$2)':''),q?['%'+q.toLowerCase()+'%',q]:[]);
  const total=countRes.rows[0].c;const pages=Math.ceil(total/limit);
  const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);
  let tr='';for(const u of users){tr+=`<tr><td>${esc(u.id)}</td><td>${esc(u.username)}</td><td>${esc(u.email)}</td><td>${esc((u.first_name||'')+' '+(u.last_name||''))}</td><td>₼ ${parseFloat(u.balance||0).toFixed(2)}</td><td>${esc(u.membership_level||'standard')}</td><td>${esc(u.status||'active')}</td><td>${esc(u.created_at)}</td><td style="white-space:nowrap"><button onclick="viewUser('${esc(u.id)}')">Profil</button><form method="post" style="display:inline-flex;gap:6px;align-items:center;margin-left:6px"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="user_id" value="${esc(u.id)}"/><input type="number" step="0.01" name="amount" placeholder="+/-" style="width:80px"/><input type="text" name="reason" placeholder="Qeyd" style="width:90px"/><button type="submit">Balans</button></form></td></tr>`;}
  let pagination='';if(pages>1){const prev=pageNum>1?`<a href="?q=${esc(q)}&page=${pageNum-1}" class="btn">← Əvvəlki</a>`:'';const next=pageNum<pages?`<a href="?q=${esc(q)}&page=${pageNum+1}" class="btn">Sonrakı →</a>`:'';pagination=`<div class="card" style="display:flex;justify-content:space-between;align-items:center">${prev}<span>Səhifə ${pageNum} / ${pages} (cəmi ${total})</span>${next}</div>`;}
  const content=`<form method="get" class="card"><input type="text" name="q" value="${esc(q)}" placeholder="Axtarış: username, email və ya ID" style="width:100%"/></form><div class="card"><table><thead><tr><th>ID</th><th>Username</th><th>Email</th><th>Ad</th><th>Balans</th><th>Üzvlük</th><th>Status</th><th>Tarix</th><th>Əməliyyat</th></tr></thead><tbody>${tr}</tbody></table></div>${pagination}
<dialog id="um" style="width:min(600px,96vw)"><div id="ucontent">Yüklənir...</div><div class="row-end"><button type="button" onclick="document.getElementById('um').close()">Bağla</button></div></dialog>
<script>
async function api(u,o){o.headers=o.headers||{};o.headers['X-CSRF-Token']='${esc(cs)}';if(o.body&&typeof o.body==='object'){o.headers['Content-Type']='application/json';o.body=JSON.stringify(o.body);}const r=await fetch(u,o);if(!r.ok)throw new Error((await r.text()).slice(0,200));return r.json();}
async function viewUser(id){document.getElementById('um').showModal();const j=await api('/api/admin/users/'+id,{});const u=j.user,s=j.stats||{};const oRows=(j.orders||[]).map(o=>\`<tr><td>\${o.id.slice(0,8)}</td><td>\${o.game}</td><td>₼ \${Number(o.total_amount||o.price||0).toFixed(2)}</td><td>\${o.status_code}</td><td>\${new Date(o.created_at).toLocaleDateString('az')}</td></tr>\`).join('');const couponRows=(j.coupons||[]).map(c=>\`<li style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08)" data-id="\${c.id}">\${c.code} — \${c.discount_value}\${c.discount_type==='percentage'?'%':'₼'} — qalıq: \${c.uses_left}</li>\`).join('');document.getElementById('ucontent').innerHTML=\`
<div><h3>\${u.username}</h3><p>\${u.email}</p><p>Balans: ₼ \${Number(u.balance).toFixed(2)} | Üzvlük: \${u.membership_level||'standard'} | Status: \${u.status||'active'}</p></div>
<div class="grid" style="grid-template-columns:repeat(4,1fr);margin:12px 0"><div class="card"><div class="stat">\${s.total_orders||0}</div><div>Ümumi sifariş</div></div><div class="card"><div class="stat">\${s.completed_orders||0}</div><div>Tamamlanmış</div></div><div class="card"><div class="stat">\${s.rejected_orders||0}</div><div>Rədd</div></div><div class="card"><div class="stat">₼ \${Number(s.total_deposits||0).toFixed(2)}</div><div>Ümumi depozit</div></div></div>
<h4>Son sifarişlər</h4><table><thead><tr><th>ID</th><th>Oyun</th><th>Məbləğ</th><th>Status</th><th>Tarix</th></tr></thead><tbody>\${oRows||'<tr><td colspan="5">Sifariş yoxdur</td></tr>'}</tbody></table>
<h4>Mesaj göndər</h4><form id="msgForm" style="display:grid;gap:8px"><input type="hidden" name="userId" value="\${u.id}"/><input name="title" placeholder="Başlıq" required/><textarea name="content" placeholder="Məzmun" rows="3" required></textarea><select name="priority"><option value="normal">Normal</option><option value="high">Yüksək</option></select><button type="submit">Göndər</button></form>
<h4>Kupon təyin et</h4><form id="couponForm" style="display:flex;gap:8px"><input type="hidden" name="userId" value="\${u.id}"/><select id="couponSelect" name="couponId" required><option value="">Kupon seç</option></select><button type="submit">Təyin et</button></form>
<h4>Kuponlar</h4><ul id="couponList" style="list-style:none;padding:0;margin:0">\${couponRows||'<li style="color:#9a9aa6">Kupon yoxdur</li>'}</ul>
<form id="editUser" style="margin-top:12px;display:grid;gap:8px;grid-template-columns:1fr 1fr">
<input type="hidden" name="userId" value="\${u.id}"/>
<select name="status"><option value="active" \${u.status==='active'?'selected':''}>Aktiv</option><option value="suspended" \${u.status==='suspended'?'selected':''}>Dayandırılmış</option></select>
<select name="membership_level"><option value="standard" \${(u.membership_level||'standard')==='standard'?'selected':''}>Standard</option><option value="vip" \${u.membership_level==='vip'?'selected':''}>VIP</option><option value="premium" \${u.membership_level==='premium'?'selected':''}>Premium</option></select>
<button type="submit">Yadda saxla</button></form>
\`;
async function loadCoupons(){const c=await api('/api/admin/coupons',{});document.getElementById('couponSelect').innerHTML='<option value="">Kupon seç</option>'+(c.coupons||[]).map(x=>\`<option value="\${x.id}">\${x.code} — \${x.discount_value}\${x.discount_type==='percentage'?'%':'₼'}</option>\`).join('');}loadCoupons();
document.getElementById('msgForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);await api('/api/admin/messages',{method:'POST',body:{userId:fd.get('userId'),title:fd.get('title'),content:fd.get('content'),priority:fd.get('priority')}});alert('Mesaj göndərildi');e.target.reset();});
document.getElementById('couponForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);await api('/api/admin/coupons/assign',{method:'POST',body:{userId:fd.get('userId'),couponId:fd.get('couponId')}});alert('Kupon təyin edildi');loadCoupons();viewUser(fd.get('userId'));});
document.getElementById('editUser').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);const body={status:fd.get('status'),membership_level:fd.get('membership_level')};await api('/api/admin/users/'+fd.get('userId'),{method:'PUT',body});alert('Yeniləndi');location.reload();});}
</script>`;
  sendHtml(res,200,page('İstifadəçilər',nav('/admin/users'),content,flash));
}

async function rCategories(req,res,pool){
  const a=await requireAdminPermission(req,res,pool,'categories.view');if(!a)return;
  const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);
  const statusBadge = (s)=>{
    const m={active:'b-approved',hidden:'b-pending',draft:'b-pending',archived:'b-rejected'};
    return `<span class="badge ${m[s]||'b-pending'}">${esc(s||'draft').toUpperCase()}</span>`;
  };
  const content=`<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
    <div style="font-family:Orbitron,sans-serif;font-size:18px;font-weight:800">Kateqoriya İdarəetməsi</div>
    <div style="display:flex;gap:8px">
      <select id="statusFilter" onchange="loadCategories()" style="min-width:130px"><option value="">Bütün statuslar</option><option value="active">Aktiv</option><option value="hidden">Gizli</option><option value="draft">Qaralama</option><option value="archived">Arxiv</option></select>
      <input id="q" placeholder="Axtar..." oninput="loadCategories()" style="min-width:180px"/>
      <button onclick="openCategory()" style="background:#6c4df4;border-color:#6c4df4">+ Yeni kateqoriya</button>
    </div>
  </div>
  <div id="catGrid" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))"></div>
</div>

<dialog id="catDialog" style="width:min(960px,96vw);max-height:92vh;overflow:auto">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <h3 id="catDialogTitle" style="margin:0;font-family:Orbitron,sans-serif">Yeni kateqoriya</h3>
    <button type="button" onclick="document.getElementById('catDialog').close()">Bağla</button>
  </div>
  <div class="tabs" style="display:flex;gap:8px;border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:14px">
    <button class="tab-btn active" data-tab="general" onclick="switchTab('general')">Əsas</button>
    <button class="tab-btn" data-tab="seo" onclick="switchTab('seo')">SEO</button>
    <button class="tab-btn" data-tab="fields" onclick="switchTab('fields')">Xüsusi sahələr</button>
    <button class="tab-btn" data-tab="preview" onclick="switchTab('preview')">Canlı önizləmə</button>
  </div>
  <form id="catForm" onsubmit="return false">
    <input type="hidden" id="catId"/>
    <div id="tab-general" class="tab-panel">
      <div class="form-grid">
        <label>Ad<input id="catName" required oninput="updatePreview()"></label>
        <label>Slug<input id="catSlug" placeholder="avtomatik ad əsasında" oninput="manualSlug=true;updatePreview()"></label>
        <label>Sıra nömrəsi<input type="number" id="catOrder" value="0"></label>
        <label>Status<select id="catStatus"><option value="active">Aktiv</option><option value="hidden">Gizli</option><option value="draft">Qaralama</option><option value="archived">Arxiv</option></select></label>
        <label style="grid-column:1/-1">Açıqlama<textarea id="catDesc" rows="2" oninput="updatePreview()"></textarea></label>
        <label style="grid-column:1/-1">Thumbnail (homepage)<div class="img-drop" id="dropThumb" onclick="document.getElementById('thumbInput').click()">Sürüklə & burax və ya kliklə</div><input type="file" id="thumbInput" accept="image/*" hidden onchange="handleImage(this,'thumb')"><img id="thumbPreview" class="img-preview" style="display:none"><input id="catImage" placeholder="və ya link daxil et" oninput="updatePreview()"></label>
        <label style="grid-column:1/-1">Banner (kateqoriya səhifəsi)<div class="img-drop" id="dropBanner" onclick="document.getElementById('bannerInput').click()">Sürüklə & burax və ya kliklə</div><input type="file" id="bannerInput" accept="image/*" hidden onchange="handleImage(this,'banner')"><img id="bannerPreview" class="img-preview" style="display:none"><input id="catBanner" placeholder="və ya link daxil et" oninput="updatePreview()"></label>
        <label class="chk"><input type="checkbox" id="catFeatured" onchange="updatePreview()"> Featured</label>
        <label class="chk"><input type="checkbox" id="catPopular" onchange="updatePreview()"> Popular</label>
      </div>
    </div>
    <div id="tab-seo" class="tab-panel" style="display:none">
      <div class="form-grid">
        <label>SEO Title<input id="catSeoTitle"></label>
        <label>SEO Description<textarea id="catSeoDesc" rows="3"></textarea></label>
        <label>OG Image<input id="catOgImage"></label>
      </div>
    </div>
    <div id="tab-fields" class="tab-panel" style="display:none">
      <div id="fieldsList" style="display:flex;flex-direction:column;gap:10px"></div>
      <button type="button" onclick="addField()" style="margin-top:10px">+ Saha əlavə et</button>
    </div>
    <div id="tab-preview" class="tab-panel" style="display:none">
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
        <div class="preview-card" id="cardPreview"></div>
        <div class="preview-banner" id="bannerPreviewBox"></div>
      </div>
    </div>
  </form>
  <div class="row-end">
    <button type="button" onclick="document.getElementById('catDialog').close()">Ləğv et</button>
    <button type="button" onclick="saveCategory()" style="background:#6c4df4;border-color:#6c4df4">Saxla</button>
  </div>
</dialog>

<style>
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.form-grid label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#c9c9d1}
.form-grid input,.form-grid select,.form-grid textarea{font-size:14px}
.form-grid .chk{flex-direction:row;align-items:center}
.img-drop{border:2px dashed rgba(255,255,255,.18);border-radius:10px;padding:14px;text-align:center;color:#9a9aa6;cursor:pointer;transition:.2s}
.img-drop:hover,.img-drop.drag-over{border-color:#6c4df4;color:#fff;background:rgba(108,77,244,.1)}
.img-preview{max-width:180px;max-height:120px;border-radius:8px;margin-top:8px;border:1px solid rgba(255,255,255,.12)}
.tabs button{background:transparent;border:none;color:#9a9aa6;padding:8px 14px;cursor:pointer;font-weight:700}
.tabs button.active{color:#fff;border-bottom:2px solid #6c4df4}
.field-row{display:grid;grid-template-columns:1fr 1fr 80px 80px 80px 40px;gap:8px;align-items:center;background:rgba(255,255,255,.04);padding:10px;border-radius:10px}
.field-row input,.field-row select{font-size:12px;padding:6px}
.preview-card{width:220px;border:1px solid rgba(255,255,255,.12);border-radius:14px;overflow:hidden;background:#0d0d16}
.preview-card img{width:100%;height:120px;object-fit:cover}
.preview-card .body{padding:12px}
.preview-card .title{font-family:Orbitron;font-weight:800;font-size:15px}
.preview-card .badge-row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.preview-card .badge{font-size:11px;padding:2px 8px}
.preview-banner{width:min(420px,100%);height:160px;border-radius:14px;overflow:hidden;background:#0d0d16;border:1px solid rgba(255,255,255,.12);position:relative}
.preview-banner img{width:100%;height:100%;object-fit:cover}
.preview-banner .label{position:absolute;bottom:0;left:0;right:0;padding:10px;background:linear-gradient(transparent,rgba(0,0,0,.8));font-family:Orbitron;font-weight:800}
.cat-card{display:flex;gap:12px;align-items:center;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px;transition:.2s}
.cat-card:hover{border-color:rgba(108,77,244,.5)}
.cat-card img{width:64px;height:64px;object-fit:cover;border-radius:10px;flex-shrink:0}
.cat-card .meta{flex:1;min-width:0}
.cat-card .title{font-family:Orbitron;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cat-card .stats{display:flex;gap:10px;font-size:12px;color:#9a9aa6;margin-top:4px}
.cat-card .acts{display:flex;gap:6px;flex-wrap:wrap}
</style>

<script>
const csrf='${esc(cs)}';
let categories=[];
let manualSlug=false;

function slugify(str){return String(str).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
async function api(url,opts={}){
  opts.headers=opts.headers||{};
  opts.headers['X-CSRF-Token']=csrf;
  if(opts.body&&typeof opts.body==='object'){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(opts.body);}
  const r=await fetch(url,opts);
  if(!r.ok){const t=await r.text();try{const j=JSON.parse(t);throw new Error(j.message||t)}catch(e){throw e}}
  return r.json();
}
async function loadCategories(){
  const q=document.getElementById('q').value;
  const status=document.getElementById('statusFilter').value;
  const url='/api/admin/categories'+(q?'?q='+encodeURIComponent(q):'');
  const data=await api(url);
  categories=data.categories||[];
  if(status)categories=categories.filter(c=>c.status===status);
  const grid=document.getElementById('catGrid');
  grid.innerHTML=categories.map(c=>\`
    <div class="cat-card">
      <img src="\${c.image_url||'/assets/zelix-generated-logo.svg'}" alt="">
      <div class="meta">
        <div class="title">\${esc(c.name)} <span class="badge \${c.status==='active'?'b-approved':(c.status==='archived'?'b-rejected':'b-pending')}">\${c.status}</span>\${c.featured?' <span class="badge b-approved">FEATURED</span>':''}\${c.popular?' <span class="badge b-pending">POPULAR</span>':''}</div>
        <div class="stats">
          <span>Sıra: #\${c.display_order}</span>
          <span>Məhsul: \${c.product_count||0}</span>
          <span>Sifariş: \${c.order_count||0}</span>
          <span>Gəlir: ₼\${c.revenue||'0.00'}</span>
          <span>Slug: /\${c.slug}</span>
        </div>
      </div>
      <div class="acts">
        <button onclick="editCategory('\${c.id}')">Redaktə</button>
        <button onclick="viewProducts('\${c.id}')">Məhsullar</button>
        <button onclick="viewPage('\${c.slug}')">Səhifə</button>
        <button onclick="dupCategory('\${c.id}')">Kopyala</button>
        <button onclick="archiveCategory('\${c.id}')" style="background:#5a3a1a;border-color:#8b5a2b">Arxiv</button>
        <button onclick="delCategory('\${c.id}')" style="background:#8b2e2e;border-color:#c0392b">Sil</button>
      </div>
    </div>
  \`).join('')||'<div style="color:#9a9aa6">Kateqoriya yoxdur.</div>';
}
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function switchTab(t){document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));document.querySelectorAll('.tab-panel').forEach(p=>p.style.display=p.id==='tab-'+t?'block':'none');if(t==='preview')updatePreview();}
function openCategory(){manualSlug=false;document.getElementById('catForm').reset();document.getElementById('catId').value='';document.getElementById('catDialogTitle').textContent='Yeni kateqoriya';document.getElementById('fieldsList').innerHTML='';document.getElementById('thumbPreview').style.display='none';document.getElementById('bannerPreview').style.display='none';switchTab('general');document.getElementById('catDialog').showModal();}
async function editCategory(id){manualSlug=true;const c=categories.find(x=>x.id===id);if(!c)return;document.getElementById('catId').value=c.id;document.getElementById('catName').value=c.name;document.getElementById('catSlug').value=c.slug;document.getElementById('catOrder').value=c.display_order;document.getElementById('catStatus').value=c.status;document.getElementById('catDesc').value=c.description||'';document.getElementById('catImage').value=c.image_url||'';document.getElementById('catBanner').value=c.banner_image_url||'';document.getElementById('catFeatured').checked=c.featured;document.getElementById('catPopular').checked=c.popular;document.getElementById('catSeoTitle').value=c.seo_title||'';document.getElementById('catSeoDesc').value=c.seo_description||'';document.getElementById('catOgImage').value=c.og_image_url||'';document.getElementById('catDialogTitle').textContent='Kateqoriya redaktə';document.getElementById('thumbPreview').src=c.image_url||'';document.getElementById('thumbPreview').style.display=c.image_url?'block':'none';document.getElementById('bannerPreview').src=c.banner_image_url||'';document.getElementById('bannerPreview').style.display=c.banner_image_url?'block':'none';document.getElementById('fieldsList').innerHTML='';(c.fields||[]).forEach(f=>addField(f));switchTab('general');document.getElementById('catDialog').showModal();}
function viewProducts(id){location.href='/admin/products?category='+id;}
function viewPage(slug){window.open('/category/'+slug,'_blank');}
async function dupCategory(id){await api('/api/admin/categories/duplicate?id='+id,{method:'POST'});loadCategories();}
async function archiveCategory(id){const c=categories.find(x=>x.id===id);if(!c)return;await api('/api/admin/categories?id='+id,{method:'PUT',body:{status:c.status==='archived'?'active':'archived',isActive:c.status!=='archived'}});loadCategories();}
async function delCategory(id){if(!confirm('Silinsin?'))return;await api('/api/admin/categories?id='+id,{method:'DELETE'});loadCategories();}

function handleImage(input,type){
  const file=input.files ? input.files[0] : input;
  if(!file)return;
  const reader=new FileReader();
  reader.onload=async()=>{
    const data=reader.result;
    try{
      const res=await api('/api/admin/upload',{method:'POST',body:{image:data,folder:type==='thumb'?'categories':'banners'}});
      if(type==='thumb'){document.getElementById('catImage').value=res.url;document.getElementById('thumbPreview').src=res.url;document.getElementById('thumbPreview').style.display='block';}
      else{document.getElementById('catBanner').value=res.url;document.getElementById('bannerPreview').src=res.url;document.getElementById('bannerPreview').style.display='block';}
      updatePreview();
    }catch(e){alert(e.message)}
  };
  reader.readAsDataURL(file);
}
function setupDrops(){
  [['dropThumb','thumb'],['dropBanner','banner']].forEach(([id,type])=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drag-over');});
    el.addEventListener('dragleave',e=>{el.classList.remove('drag-over');});
    el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drag-over');const f=e.dataTransfer.files[0];if(f)handleImage(f,type);});
  });
}
setupDrops();
function addField(f={}){
  const div=document.createElement('div');div.className='field-row';
  div.innerHTML=\`<input placeholder="ad" value="\${f.name||''}" class="f-name"><input placeholder="etiket" value="\${f.label||''}" class="f-label"><select class="f-type"><option value="text" \${f.type==='text'?'selected':''}>Text</option><option value="number" \${f.type==='number'?'selected':''}>Number</option><option value="dropdown" \${f.type==='dropdown'?'selected':''}>Dropdown</option><option value="checkbox" \${f.type==='checkbox'?'selected':''}>Checkbox</option></select><label style="display:flex;align-items:center;gap:4px;color:#fff"><input type="checkbox" class="f-req" \${f.required?'checked':''}> Tələb</label><input type="number" class="f-order" value="\${f.sort_order||0}" placeholder="sıra"><button type="button" onclick="this.parentElement.remove()" style="background:#8b2e2e">×</button>\`;
  document.getElementById('fieldsList').appendChild(div);
}
function collectFields(){
  return Array.from(document.querySelectorAll('.field-row')).map((row,i)=>{
    const name=row.querySelector('.f-name').value.trim();
    if(!name)return null;
    return {name,label:row.querySelector('.f-label').value.trim(),type:row.querySelector('.f-type').value,required:row.querySelector('.f-req').checked,sortOrder:Number(row.querySelector('.f-order').value)||i,isActive:true};
  }).filter(Boolean);
}
async function saveCategory(){
  const id=document.getElementById('catId').value;
  const name=document.getElementById('catName').value.trim();
  if(!name){alert('Ad daxil edin');return;}
  const slug=manualSlug?document.getElementById('catSlug').value.trim():slugify(name);
  const body={
    name,slug,imageUrl:document.getElementById('catImage').value.trim(),bannerImageUrl:document.getElementById('catBanner').value.trim(),
    description:document.getElementById('catDesc').value.trim(),status:document.getElementById('catStatus').value,
    displayOrder:Number(document.getElementById('catOrder').value)||0,featured:document.getElementById('catFeatured').checked,popular:document.getElementById('catPopular').checked,
    seoTitle:document.getElementById('catSeoTitle').value.trim(),seoDescription:document.getElementById('catSeoDesc').value.trim(),ogImageUrl:document.getElementById('catOgImage').value.trim(),
    fields:collectFields()
  };
  try{
    if(id){await api('/api/admin/categories?id='+id,{method:'PUT',body});}
    else{await api('/api/admin/categories',{method:'POST',body});}
    document.getElementById('catDialog').close();
    loadCategories();
  }catch(e){alert(e.message)}
}
function updatePreview(){
  const name=document.getElementById('catName').value||'Kateqoriya adı';
  const img=document.getElementById('catImage').value||'/assets/zelix-generated-logo.svg';
  const banner=document.getElementById('catBanner').value||img;
  const featured=document.getElementById('catFeatured').checked;
  const popular=document.getElementById('catPopular').checked;
  document.getElementById('cardPreview').innerHTML=\`<img src="\${img}"><div class="body"><div class="title">\${esc(name)}</div><div class="badge-row">\${featured?'<span class="badge b-approved">FEATURED</span>':''}\${popular?'<span class="badge b-pending">🔥 POPULAR</span>':''}<span class="badge b-pending">oyun</span></div></div>\`;
  document.getElementById('bannerPreviewBox').innerHTML=\`<img src="\${banner}"><div class="label">\${esc(name)}</div>\`;
}
loadCategories();
</script>`;
  sendHtml(res,200,page('Kateqoriyalar',nav('/admin/categories'),content));
}

async function rProducts(req, res, pool) {
  const a = await requireAdminPermission(req, res, pool, 'products.view'); if (!a) return;
  let flash = null;
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST') {
    const body = await readBody(req);
    const c = parseCookies(req);
    if (!body.csrf || body.csrf !== a.csrfToken) return sendHtml(res, 419, '<h1>Etibarsız CSRF tokeni.</h1>');
    const action = String(body.action || '');
    try {
      if (action === 'create') {
        const id = crypto.randomUUID();
        const badges = (body.badges || '').split(',').map(s => s.trim()).filter(Boolean);
        await pool.query(
          'INSERT INTO products(id,category_id,game,title,price,old_price,discount_percent,stock_quantity,image_url,description,available,is_active,is_featured,delivery_minutes,sort_order,badges,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())',
          [id, String(body.category_id || '').trim() || null, String(body.game || '').trim(), String(body.title || '').trim(), parseFloat(body.price || 0), body.old_price ? parseFloat(body.old_price) : null, parseFloat(body.discount_percent || 0), parseInt(body.stock_quantity || 0), String(body.image_url || '').trim(), String(body.description || '').trim(), !!body.available, !!body.is_active, !!body.is_featured, parseInt(body.delivery_minutes || 5), parseInt(body.sort_order || 0), JSON.stringify(badges)]
        );
        flash = { type: 'ok', msg: 'Məhsul əlavə edildi' };
      } else if (action === 'update') {
        const id = String(body.id || '');
        const badges = (body.badges || '').split(',').map(s => s.trim()).filter(Boolean);
        await pool.query(
          'UPDATE products SET category_id=$1,game=$2,title=$3,price=$4,old_price=$5,discount_percent=$6,stock_quantity=$7,image_url=$8,description=$9,available=$10,is_active=$11,is_featured=$12,delivery_minutes=$13,sort_order=$14,badges=$15,updated_at=NOW(),updated_by=$16 WHERE id=$17',
          [String(body.category_id || '').trim() || null, String(body.game || '').trim(), String(body.title || '').trim(), parseFloat(body.price || 0), body.old_price ? parseFloat(body.old_price) : null, parseFloat(body.discount_percent || 0), parseInt(body.stock_quantity || 0), String(body.image_url || '').trim(), String(body.description || '').trim(), !!body.available, !!body.is_active, !!body.is_featured, parseInt(body.delivery_minutes || 5), parseInt(body.sort_order || 0), JSON.stringify(badges), String(a.id), id]
        );
        flash = { type: 'ok', msg: 'Məhsul yeniləndi' };
      } else if (action === 'delete') {
        const id = String(body.id || '');
        await pool.query('DELETE FROM order_items WHERE product_id=$1', [id]);
        await pool.query('DELETE FROM products WHERE id=$1', [id]);
        flash = { type: 'ok', msg: 'Məhsul silindi' };
      } else if (action === 'duplicate') {
        const id = String(body.id || '');
        const r = await pool.query('SELECT * FROM products WHERE id=$1 LIMIT 1', [id]);
        if (r.rows.length) {
          const p = r.rows[0];
          const newId = crypto.randomUUID();
          await pool.query(
            'INSERT INTO products(id,category_id,game,title,price,old_price,discount_percent,stock_quantity,image_url,description,available,is_active,is_featured,delivery_minutes,sort_order,badges,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())',
            [newId, p.category_id, p.game, p.title + ' (copy)', p.price, p.old_price, p.discount_percent, p.stock_quantity, p.image_url, p.description, p.available, p.is_active, p.is_featured, p.delivery_minutes, p.sort_order, JSON.stringify(p.badges)]
          );
          flash = { type: 'ok', msg: 'Məhsul kopyalandı' };
        }
      }
    } catch (e) {
      flash = { type: 'bad', msg: 'Xəta: ' + e.message };
    }
  }

  const q = String(url.searchParams.get('q') || '').trim();
  const cat = String(url.searchParams.get('category') || '');
  let sql = 'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id';
  const params = [], conds = [];
  if (q) { conds.push('(LOWER(p.title) LIKE $' + (params.length + 1) + ' OR LOWER(p.game) LIKE $' + (params.length + 1) + ')'); params.push('%' + q.toLowerCase() + '%'); }
  if (cat) { conds.push('p.category_id=$' + (params.length + 1)); params.push(cat); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY p.sort_order ASC, p.created_at DESC';
  const { rows } = await pool.query(sql, params);
  const cats = (await pool.query('SELECT id,name FROM categories ORDER BY name ASC')).rows;
  const catOptions = '<option value="">Bütün kateqoriyalar</option>' + cats.map(c => `<option value="${esc(c.id)}" ${cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const cs = a.csrfToken;
  setCookie(res, 'admin_csrf', cs, ADMIN_SESSION_MAX_AGE_SECONDS);

  let tr = '';
  for (const r of rows) {
    tr += `<tr><td><input type="checkbox" class="pchk" value="${esc(r.id)}"/></td><td>${esc(r.id)}</td><td>${esc(r.category_name || '—')}</td><td>${esc(r.game)}</td><td><img src="${esc(r.image_url || '/assets/zelix-generated-logo.svg')}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,.12)"></td><td>${esc(r.title)}</td><td>₼ ${parseFloat(r.price || 0).toFixed(2)}</td><td><span class="badge ${r.available ? 'b-approved' : 'b-rejected'}">${r.available ? 'Bəli' : 'Xeyr'}</span></td><td><span class="badge ${r.is_active ? 'b-approved' : 'b-rejected'}">${r.is_active ? 'Aktiv' : 'Deaktiv'}</span></td><td style="font-size:12px">${esc(String(r.updated_at || r.created_at).slice(0, 19))}</td><td><form method="post" style="display:flex;gap:6px;flex-wrap:wrap"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="action" value="update"/><input type="hidden" name="id" value="${esc(r.id)}"/><select name="category_id"><option value="">Kateqoriya</option>${cats.map(c => `<option value="${esc(c.id)}" ${r.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><input type="text" name="game" value="${esc(r.game)}" required/><input type="text" name="title" value="${esc(r.title)}" required/><input type="number" step="0.01" name="price" value="${esc(String(r.price))}" required/><input type="number" step="0.01" name="old_price" value="${esc(String(r.old_price || ''))}" placeholder="Köhnə qiymət"/><input type="number" name="discount_percent" value="${esc(String(r.discount_percent || 0))}" placeholder="Endirim %"/><input type="number" name="stock_quantity" value="${esc(String(r.stock_quantity || 0))}" placeholder="Stok sayı"/><input type="text" name="badges" value="${esc(Array.isArray(r.badges) ? r.badges.join(',') : '')}" placeholder="Nişanlar (vergüllə)"/><label><input type="checkbox" name="is_featured" ${r.is_featured ? 'checked' : ''}/> Featured</label><input type="text" name="image_url" value="${esc(r.image_url || '')}" placeholder="Şəkil linki"/><input type="text" name="description" value="${esc(r.description || '')}" placeholder="Açıqlama"/><label><input type="checkbox" name="available" ${r.available ? 'checked' : ''}/> Mövcud</label><label><input type="checkbox" name="is_active" ${r.is_active ? 'checked' : ''}/> Aktiv</label><input type="number" name="delivery_minutes" value="${esc(String(r.delivery_minutes || 5))}" placeholder="Çatdırılma"/><input type="number" name="sort_order" value="${esc(String(r.sort_order || 0))}" placeholder="Sıra"/><button type="submit">Yenilə</button></form><form method="post" style="display:inline"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="action" value="duplicate"/><input type="hidden" name="id" value="${esc(r.id)}"/><button type="submit">Kopyala</button></form><form method="post" style="display:inline"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="action" value="delete"/><input type="hidden" name="id" value="${esc(r.id)}"/><button type="submit" style="background:#e74c3c">Sil</button></form></td></tr>`;
  }

  const content = `<div class="card"><form method="post" style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="action" value="create"/><select name="category_id"><option value="">Kateqoriya</option>${cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select><input type="text" name="game" placeholder="Oyun" required/><input type="text" name="title" placeholder="Başlıq" required/><input type="number" step="0.01" name="price" placeholder="Qiymət" required/><input type="number" step="0.01" name="old_price" placeholder="Köhnə qiymət"/><input type="number" name="discount_percent" placeholder="Endirim %" value="0"/><input type="number" name="stock_quantity" placeholder="Stok sayı" value="0"/><input type="text" name="badges" placeholder="Nişanlar (vergüllə)"/><label><input type="checkbox" name="is_featured"/> Featured</label><input type="text" name="image_url" placeholder="Şəkil linki"/><input type="text" name="description" placeholder="Açıqlama"/><label><input type="checkbox" name="available" checked/> Mövcud</label><label><input type="checkbox" name="is_active" checked/> Aktiv</label><input type="number" name="delivery_minutes" placeholder="Çatdırılma (dəq)" value="5"/><input type="number" name="sort_order" placeholder="Sıra" value="0"/><button type="submit">Yeni məhsul</button></form></div><form method="get" class="card" style="display:flex;gap:10px;align-items:center"><input type="text" name="q" value="${esc(q)}" placeholder="Axtar: başlıq və ya oyun" style="flex:1"/><select name="category">${catOptions}</select><button type="submit">Axtar</button></form><div class="card"><div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><label><input type="checkbox" id="sa"/> Hamısını seç</label><select id="bulk"><option value="">Toplu əməliyyat</option><option value="hide">Gizlət</option><option value="unhide">Göstər</option><option value="feature">Featured</option><option value="unfeature">Unfeatured</option></select><button onclick="runBulk()">Tətbiq et</button></div><table><thead><tr><th><input type="checkbox" id="sa"/></th><th>ID</th><th>Kateqoriya</th><th>Oyun</th><th>Şəkil</th><th>Başlıq</th><th>Qiymət</th><th>Mövcud</th><th>Status</th><th>Yenilənmə</th><th>Əməliyyat</th></tr></thead><tbody>${tr || '<tr><td colspan="11" style="color:#9a9aa6">Məhsul yoxdur.</td></tr>'}</tbody></table></div>
<script>async function api(u,o){o.headers=o.headers||{};o.headers['X-CSRF-Token']='${esc(cs)}';if(o.body&&typeof o.body==='object'){o.headers['Content-Type']='application/json';o.body=JSON.stringify(o.body);}const r=await fetch(u,o);if(!r.ok)throw new Error((await r.text()).slice(0,200));return r.json();}
document.getElementById('sa').addEventListener('change',e=>{document.querySelectorAll('.pchk').forEach(c=>c.checked=e.target.checked);});
async function runBulk(){const ids=[...document.querySelectorAll('.pchk:checked')].map(c=>c.value);const action=document.getElementById('bulk').value;if(!ids.length||!action){alert('Məhsul və əməliyyat seçin');return;}if(!confirm(ids.length+' məhsula '+action+' tətbiq edilsin?'))return;await api('/api/admin/products/bulk',{method:'POST',body:{ids,action}});location.reload();}
</script>`;
  sendHtml(res, 200, page('Məhsullar', nav('/admin/products'), content, flash));
}


async function rOrders(req,res,pool){
  const a=await requireAdminPermission(req,res,pool,'orders.view');if(!a)return;
  let flash=null;const url=new URL(req.url,`http://${req.headers.host}`);
  const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);
  const q=String(url.searchParams.get('q')||'').trim(),status=String(url.searchParams.get('status')||'');
  let sql='SELECT o.*, os.label AS status_label FROM orders o LEFT JOIN order_status os ON os.code=o.status_code',params=[],conds=[];
  if(q){conds.push('(LOWER(o.user_email) LIKE $'+(params.length+1)+' OR LOWER(o.game) LIKE $'+(params.length+1)+' OR o.id::text=$'+(params.length+2)+')');params.push('%'+q.toLowerCase()+'%',q);}
  if(status){conds.push('o.status_code=$'+(params.length+1));params.push(status);}
  if(conds.length)sql+=' WHERE '+conds.join(' AND ');
  sql+=' ORDER BY o.created_at DESC LIMIT 300';const{rows:orders}=await pool.query(sql,params);
  let tr='';for(const o of orders){const items=(await pool.query('SELECT oi.*, p.title, p.game FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=$1 ORDER BY oi.created_at ASC',[o.id])).rows;const itemList=items.map(i=>`${esc(i.title)} x${i.quantity} = ₼${parseFloat(i.total_price||0).toFixed(2)}`).join('<br>');tr+=`<tr><td>${esc(o.id)}</td><td>${esc(o.user_email)}</td><td>${esc(o.game)}</td><td>${itemList}</td><td>₼ ${parseFloat(o.total_amount||o.price||0).toFixed(2)}</td><td>${esc(o.player_id)}</td><td><span class="badge ${o.status_code==='completed'?'b-approved':(o.status_code==='rejected'?'b-rejected':'b-pending')}">${esc(o.status_label||o.status)}</span></td><td style="font-size:12px">${esc(String(o.updated_at||o.created_at).slice(0,19))}</td><td><button onclick="openOrder('${esc(o.id)}','${esc(o.status_code)}')">İdarə et</button></td></tr>`;}
  const content=`<form method="get" class="card" style="display:flex;gap:10px;align-items:center"><input type="text" name="q" value="${esc(q)}" placeholder="Axtar: email, oyun, ID" style="flex:1"/><select name="status"><option value="">Hamısı</option><option value="pending" ${status==='pending'?'selected':''}>Gözləmədə</option><option value="processing" ${status==='processing'?'selected':''}>Emal edilir</option><option value="completed" ${status==='completed'?'selected':''}>Tamamlandı</option><option value="rejected" ${status==='rejected'?'selected':''}>Rədd edildi</option></select><button type="submit">Axtar</button></form><div class="card"><table><thead><tr><th>ID</th><th>Email</th><th>Oyun</th><th>Məhsullar</th><th>Cəmi</th><th>Oyunçu ID</th><th>Status</th><th>Tarix</th><th>Əməliyyat</th></tr></thead><tbody>${tr||'<tr><td colspan="9" style="color:#9a9aa6">Sifariş yoxdur.</td></tr>'}</tbody></table></div>
<dialog id="om" style="width:min(480px,96vw)"><form id="of"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" id="oid"/><h3>Sifariş statusu</h3><label>Status</label><select id="ost" name="status"><option value="pending">Gözləmədə</option><option value="processing">Emal edilir</option><option value="completed">Tamamlandı</option><option value="rejected">Rədd edildi</option></select><div id="rejBox" style="display:none"><label>Rədd səbəbi</label><textarea id="oreason" name="rejectionReason" rows="3"></textarea><label><input type="checkbox" id="orefund" name="refund"/> Balansı qaytar</label></div><label>Admin qeydi</label><textarea id="onotes" name="adminNotes" rows="2"></textarea><div class="row-end"><button type="button" onclick="document.getElementById('om').close()">Ləğv et</button><button type="submit">Saxla</button></div></form></dialog>
<script>
function openOrder(id,status){document.getElementById('oid').value=id;document.getElementById('ost').value=status;document.getElementById('om').showModal();toggleRej();}
document.getElementById('ost').addEventListener('change',toggleRej);
function toggleRej(){document.getElementById('rejBox').style.display=document.getElementById('ost').value==='rejected'?'block':'none';}
document.getElementById('of').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);const body={orderId:document.getElementById('oid').value,status:fd.get('status'),rejectionReason:fd.get('rejectionReason'),adminNotes:fd.get('adminNotes'),refund:fd.get('refund')==='on'};const r=await fetch('/api/admin/orders/status',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':'${esc(cs)}'},body:JSON.stringify(body)});const j=await r.json();alert(j.message);if(r.ok)location.reload();});
</script>`;
  sendHtml(res,200,page('Sifarişlər',nav('/admin/orders'),content,flash));
}

async function rBalanceRequests(req,res,pool){
  const a=await requireAdminPermission(req,res,pool,'balance.view');if(!a)return;
  let flash=null;
  if(req.method==='POST'){const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==a.csrfToken)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const id=String(body.id||''),action=String(body.action||'');if(id&&(action==='approve'||action==='reject')){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT*FROM balance_requests WHERE id=$1 LIMIT 1',[id]);const row=r.rows[0];if(row){if(action==='approve'&&String(row.status).toLowerCase()==='pending'){await client.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[row.amount,row.user_id]);const tid=crypto.randomBytes(16).toString('hex');await client.query('INSERT INTO transactions(id,user_id,amount,type,status,ref)VALUES($1,$2,$3,$4,$5,$6)',[tid,row.user_id,parseFloat(row.amount),'credit','approved','Balance request '+row.id]);await client.query("UPDATE balance_requests SET status='approved',reviewed_by=$1,reviewed_at=NOW() WHERE id=$2",[String(a.id),id]);await createNotification(client,row.user_id,'Balans artırıldı','Hesabınıza '+parseFloat(row.amount).toFixed(2)+' ₼ əlavə olundu.','balance');ssePushState(row.user_id);flash={type:'ok',msg:'Sorğu təsdiqləndi və balans artırıldı'};}else if(action==='reject'&&String(row.status).toLowerCase()==='pending'){await client.query("UPDATE balance_requests SET status='rejected',reviewed_by=$1,reviewed_at=NOW() WHERE id=$2",[String(a.id),id]);flash={type:'ok',msg:'Sorğu rədd edildi'};}}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK').catch(()=>{});flash={type:'bad',msg:'Xəta: '+e.message};}finally{client.release();}}}
  const url=new URL(req.url,`http://${req.headers.host}`);const status=url.searchParams.get('status')||'pending';let sql='SELECT*FROM balance_requests',params=[];if(status){sql+=' WHERE LOWER(status)=LOWER($1)';params.push(status);}sql+=' ORDER BY created_at DESC LIMIT 300';const{rows}=await pool.query(sql,params);
  const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);
  let tr='';for(const r of rows){tr+=`<tr><td>${esc(r.id)}</td><td>${esc(r.user_id)}</td><td>₼ ${parseFloat(r.amount||0).toFixed(2)}</td><td><a href="${esc(r.image_url)}" target="_blank">Bax</a></td><td>${esc(r.status)}</td><td>${String(r.status).toLowerCase()==='pending'?`<form method="post" style="display:flex;gap:6px;align-items:center"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="id" value="${esc(r.id)}"/><button name="action" value="approve" type="submit">Təsdiq</button><button name="action" value="reject" type="submit">Rədd</button></form>`:`—`}</td></tr>`;}
  const content=`<form method="get" class="card" style="display:flex;gap:10px;align-items:center"><label>Status:</label><select name="status"><option value="pending" ${status==='pending'?'selected':''}>Gözləmədə</option><option value="approved" ${status==='approved'?'selected':''}>Təsdiqlənmiş</option><option value="rejected" ${status==='rejected'?'selected':''}>Rədd</option></select><button type="submit">Filtrlə</button></form><div class="card"><table><thead><tr><th>ID</th><th>İstifadəçi</th><th>Məbləğ</th><th>Şəkil</th><th>Status</th><th>Əməliyyat</th></tr></thead><tbody>${tr}</tbody></table></div>`;
  sendHtml(res,200,page('Balans Sorğuları',nav('/admin/balance-requests'),content,flash));
}

async function rAvatars(req,res,pool){
  const a=await requireAdminPermission(req,res,pool,'avatars.view');if(!a)return;
  let flash=null;
  if(req.method==='POST'){const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==a.csrfToken)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const id=String(body.id||''),action=String(body.action||'');if(id&&(action==='approve'||action==='reject')){const r=await pool.query('SELECT*FROM avatar_requests WHERE id=$1 LIMIT 1',[id]);const row=r.rows[0];if(row){if(action==='approve'&&String(row.status).toLowerCase()==='pending'){await pool.query("UPDATE avatar_requests SET status='approved',approved_by=$1,approved_at=NOW() WHERE id=$2",[String(a.id),id]);await pool.query('UPDATE users SET profile_image_url=$1 WHERE id=$2',[row.image_url,row.user_id]);flash={type:'ok',msg:'Təsdiqləndi'};}else if(action==='reject'&&String(row.status).toLowerCase()==='pending'){await pool.query("UPDATE avatar_requests SET status='rejected',approved_by=$1,approved_at=NOW() WHERE id=$2",[String(a.id),id]);flash={type:'ok',msg:'Rədd edildi'};}}}}
  const url=new URL(req.url,`http://${req.headers.host}`);const status=url.searchParams.get('status')||'pending';let sql='SELECT*FROM avatar_requests',params=[];if(status){sql+=' WHERE LOWER(status)=LOWER($1)';params.push(status);}sql+=' ORDER BY created_at DESC LIMIT 300';const{rows}=await pool.query(sql,params);
  const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);
  let tr='';for(const r of rows){tr+=`<tr><td>${esc(r.id)}</td><td>${esc(r.user_id)}</td><td><a href="${esc(r.image_url)}" target="_blank">Bax</a></td><td>${esc(r.status)}</td><td>${String(r.status).toLowerCase()==='pending'?`<form method="post" style="display:flex;gap:6px;align-items:center"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="id" value="${esc(r.id)}"/><button name="action" value="approve" type="submit">Təsdiq</button><button name="action" value="reject" type="submit">Rədd</button></form>`:`—`}</td></tr>`;}
  const content=`<form method="get" class="card" style="display:flex;gap:10px;align-items:center"><label>Status:</label><select name="status"><option value="pending" ${status==='pending'?'selected':''}>Gözləmədə</option><option value="approved" ${status==='approved'?'selected':''}>Təsdiqlənmiş</option><option value="rejected" ${status==='rejected'?'selected':''}>Rədd</option></select><button type="submit">Filtrlə</button></form><div class="card"><table><thead><tr><th>ID</th><th>İstifadəçi</th><th>Şəkil</th><th>Status</th><th>Əməliyyat</th></tr></thead><tbody>${tr}</tbody></table></div>`;
  sendHtml(res,200,page('Avatar Sorğuları',nav('/admin/avatars'),content,flash));
}

async function rReceipt(req,res,pool){
  const a=await requireAdminPermission(req,res,pool,'deposits.view');if(!a)return;
  const url=new URL(req.url,`http://${req.headers.host}`);
  const file=String(url.searchParams.get('file')||'');
  if(!file||file!==path.basename(file)||file.includes('\0')){res.writeHead(400);res.end('Etibarsız fayl adı');return;}
  const baseDir=path.resolve(path.join(__dirname,'uploads','receipts'));
  const target=path.resolve(path.join(baseDir,file));
  if(!target.startsWith(baseDir+path.sep)){res.writeHead(404);res.end('Tapılmadı');return;}
  try{const stat=await fs.stat(target);if(!stat.isFile())throw new Error();}catch{res.writeHead(404);res.end('Tapılmadı');return;}
  const fd=await fs.open(target,'r');const buf=Buffer.alloc(8192);const n=await fd.read(buf,0,8192,0);await fd.close();
  const head=buf.slice(0,n);
  const isJpg=head[0]===0xFF&&head[1]===0xD8;
  const isPng=head[0]===0x89&&head[1]===0x50&&head[2]===0x4E&&head[3]===0x47;
  if(!isJpg&&!isPng){res.writeHead(415);res.end('Dəstəklənməyən fayl tipi');return;}
  const mime=isJpg?'image/jpeg':'image/png';
  const data=await fs.readFile(target);
  res.writeHead(200,{'Content-Type':mime,'Content-Length':data.length,'Content-Disposition':'inline; filename="'+file+'"','X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age:300'});
  res.end(data);
}

async function rAuditLogs(req,res,pool){const a=await requireAdminPermission(req,res,pool,'audit_logs.view');if(!a)return;const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);const content=`<main class="wrap"><h2 style="font-family:Orbitron,sans-serif">Audit Log</h2><div class="card"><div id="logGrid">Yüklənir...</div></div></main><script>async function load(){const r=await fetch('/api/admin/audit-logs',{headers:{'X-CSRF-Token':'${esc(cs)}'}});const j=await r.json();const rows=(j.logs||[]).map(l=>\`<tr><td>\${new Date(l.created_at).toLocaleString('az')}</td><td>\${l.admin_username||'—'}</td><td>\${l.action}</td><td>\${l.target_type||'—'} \${l.target_id||'—'}</td><td><pre style="margin:0;white-space:pre-wrap;max-width:300px;font-size:11px">\${JSON.stringify(l.new_value||{},null,2)}</pre></td></tr>\`).join('');document.getElementById('logGrid').innerHTML='<table><thead><tr><th>Tarix</th><th>Admin</th><th>Əməliyyat</th><th>Target</th><th>Yeni dəyər</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5" style="color:#9a9aa6">Məlumat yoxdur</td></tr>')+'</tbody></table>';}load();</script>`;sendHtml(res,200,page('Audit Log',nav('/admin/audit-logs'),content));}

async function rCampaigns(req,res,pool){const a=await requireAdminPermission(req,res,pool,'campaigns.view');if(!a)return;const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);const content=`<main class="wrap"><h2 style="font-family:Orbitron,sans-serif">Kampaniyalar</h2><div class="card"><form id="f"><input type="hidden" name="csrf" value="${esc(cs)}"/><label>Ad</label><input name="name" required/><label>Tip</label><select name="type"><option value="percentage">Faiz</option><option value="fixed">Sabit</option></select><label>Dəyər</label><input name="value" type="number" step="0.01" required/><label>Start</label><input name="startDate" type="datetime-local"/><label>End</label><input name="endDate" type="datetime-local"/><label>Target Type</label><select name="targetType"><option value="all">Hamısı</option><option value="categories">Kateqoriyalar</option><option value="products">Məhsullar</option><option value="membership">Üzvlük</option></select><label>VIP Only</label><input name="vipOnly" type="checkbox"/><label>Premium Only</label><input name="premiumOnly" type="checkbox"/><button type="submit">Yarat</button></form></div><div class="card"><div id="list">Yüklənir...</div></div></main><script>async function api(u,o){o.headers=o.headers||{};o.headers['X-CSRF-Token']='${esc(cs)}';if(o.body&&typeof o.body==='object'){o.headers['Content-Type']='application/json';o.body=JSON.stringify(o.body);}const r=await fetch(u,o);return r.json();}async function load(){const j=await api('/api/admin/campaigns',{});document.getElementById('list').innerHTML=(j.campaigns||[]).map(c=>\`<div class="card"><b>\${c.name}</b> — \${c.type} \${c.value} — \${c.active?'Aktiv':'Deaktiv'}</div>\`).join('')||'Kampaniya yoxdur';}document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);const body={};for(const [k,v] of fd.entries()){if(k==='vipOnly'||k==='premiumOnly'){body[k]=v==='on';}else if(k==='value'){body[k]=parseFloat(v);}else{body[k]=v;}}await api('/api/admin/campaigns',{method:'POST',body});e.target.reset();load();});load();</script>`;sendHtml(res,200,page('Kampaniyalar',nav('/admin/campaigns'),content));}

async function rMessages(req,res,pool){const a=await requireAdminPermission(req,res,pool,'messages.view');if(!a)return;const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);const content=`<main class="wrap"><h2 style="font-family:Orbitron,sans-serif">Mesajlar</h2><div class="card"><form id="f"><input type="hidden" name="csrf" value="${esc(cs)}"/><label>User ID</label><input name="userId" placeholder="Boş burax = bütün istifadəçilər"/><label>Başlıq</label><input name="title" required/><label>Məzmun</label><textarea name="content" rows="4" required></textarea><label>Prioritet</label><select name="priority"><option value="normal">Normal</option><option value="high">Yüksək</option><option value="urgent">Təcili</option></select><button type="submit">Göndər</button></form></div></main><script>async function api(u,o){o.headers=o.headers||{};o.headers['X-CSRF-Token']='${esc(cs)}';if(o.body&&typeof o.body==='object'){o.headers['Content-Type']='application/json';o.body=JSON.stringify(o.body);}const r=await fetch(u,o);return r.json();}document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);const body={userId:fd.get('userId')||null,title:fd.get('title'),content:fd.get('content'),priority:fd.get('priority')};if(!body.userId){body.userIds=[];delete body.userId;}else{body.userIds=[body.userId];delete body.userId;}const j=await api('/api/admin/messages',{method:'POST',body});alert(j.sent+' istifadəçiyə göndərildi');e.target.reset();});</script>`;sendHtml(res,200,page('Mesajlar',nav('/admin/messages'),content));}

async function rAnnouncements(req,res,pool){const a=await requireAdminPermission(req,res,pool,'announcements.view');if(!a)return;const cs=a.csrfToken;setCookie(res,'admin_csrf',cs,ADMIN_SESSION_MAX_AGE_SECONDS);const content=`<main class="wrap"><h2 style="font-family:Orbitron,sans-serif">Elanlar</h2><div class="card"><form id="f"><input type="hidden" name="csrf" value="${esc(cs)}"/><label>Başlıq</label><input name="title" required/><label>Məzmun</label><textarea name="content" rows="4" required></textarea><label>Tip</label><select name="type"><option value="info">Info</option><option value="warning">Xəbərdarlıq</option><option value="maintenance">Texniki iş</option><option value="campaign">Kampaniya</option><option value="emergency">Təcili</option></select><label>Hədəflə</label><select name="targetAudience"><option value="all">Hamısı</option><option value="vip">VIP</option><option value="premium">Premium</option></select><button type="submit">Yarat</button></form></div></main><script>async function api(u,o){o.headers=o.headers||{};o.headers['X-CSRF-Token']='${esc(cs)}';if(o.body&&typeof o.body==='object'){o.headers['Content-Type']='application/json';o.body=JSON.stringify(o.body);}const r=await fetch(u,o);return r.json();}document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);const body={};for(const [k,v] of fd.entries())body[k]=v;const j=await api('/api/admin/announcements',{method:'POST',body});alert('Elan yaradıldı');e.target.reset();});</script>`;sendHtml(res,200,page('Elanlar',nav('/admin/announcements'),content));}

module.exports = {
  ensureAdminSchema,
  setSsePush,
  setMembershipRecalc,
  rLogin,
  rLogout,
  rDashboard,
  rDeposits,
  rUsers,
  rOrders,
  rCategories,
  rProducts,
  rBalanceRequests,
  rAvatars,
  rReceipt,
  rAuditLogs,
  rCampaigns,
  rMessages,
  rAnnouncements,
  parseCookies,
  setCookie,
  clearCookie,
  csrfToken,
  readBody,
  sendHtml,
  esc,
  nav,
  page,
  getAdmin,
  requireAdmin,
  getAdminRolePermissions,
  hasAdminPermission,
  requireAdminPermission,
  sendForbidden
};
