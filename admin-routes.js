const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcryptjs');

const adminSessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;

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
.flash-bad{border-color:rgba(255,99,71,.35)!important;color:#ffb3a7!important}`;

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function page(title, navHtml, content, flash) {
  const fh = flash ? `<div class="card ${flash.type==='bad'?'flash-bad':'flash-ok'}">${esc(flash.msg)}</div>` : '';
  return `<!doctype html><html lang="az"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} • ZTOPUP Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Rajdhani:wght@500;700&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body>
<header><div style="font-family:Orbitron,sans-serif;font-weight:800;letter-spacing:.12em">ZTOPUP • ADMIN</div><nav>${navHtml}</nav></header>
<div class="wrap">${fh}${content}</div></body></html>`;
}

function nav(cur) {
  const items = [{u:'/admin/',l:'Panel'},{u:'/admin/users',l:'İstifadəçilər'},{u:'/admin/orders',l:'Sifarişlər'},{u:'/admin/products',l:'Məhsullar'},{u:'/admin/balance-requests',l:'Balans'},{u:'/admin/deposits',l:'Depozitlər'},{u:'/admin/avatars',l:'Avatar'},{u:'/admin/logout',l:'Çıxış'}];
  return items.map(i=>`<a href="${i.u}"${i.u===cur?' style="color:#fff;font-weight:700"':''}>${i.l}</a>`).join('');
}

function parseCookies(r){const raw=r.headers.cookie||'',c={};raw.split(';').forEach(p=>{const[k,...rest]=p.trim().split('=');if(k)c[k]=decodeURIComponent(rest.join('='));});return c;}
function setCookie(r,name,val,age=1800){r.setHeader('Set-Cookie',`${name}=${encodeURIComponent(val)}; HttpOnly; Path=/admin; Max-Age=${age}; SameSite=Lax`);}
function clearCookie(r,name){r.setHeader('Set-Cookie',`${name}=; HttpOnly; Path=/admin; Max-Age=0; SameSite=Lax`);}
function csrfToken(){return crypto.randomBytes(32).toString('hex');}
function hashPw(pw){return bcrypt.hashSync(pw,10);}
function verifyPw(pw,stored){if(!stored)return false;if(/^\$2[ayb]\$/.test(stored))return bcrypt.compareSync(pw,stored.replace(/^\$2y\$/,'$2a$'));const[salt,oh]=stored.split(':');if(!salt||!oh)return false;const h=crypto.scryptSync(pw,salt,64);const o=Buffer.from(oh,'hex');return o.length===h.length&&crypto.timingSafeEqual(o,h);}
async function sendHtml(res,code,html){res.writeHead(code,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}
async function readBody(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>1_000_000){req.destroy();reject(new Error('Too large'));}});req.on('end',()=>{try{resolve(JSON.parse(b));}catch{const o={};b.split('&').forEach(p=>{const[k,v]=p.split('=');if(k)o[decodeURIComponent(k)]=decodeURIComponent(v||'');});resolve(o);}});req.on('error',reject);});}

async function getAdmin(req,pool){const c=parseCookies(req);const tok=c.admin_token||'';if(!tok)return null;const s=adminSessions.get(tok);if(!s)return null;if(Date.now()-s.createdAt>SESSION_TIMEOUT){adminSessions.delete(tok);return null;}s.createdAt=Date.now();const{rows}=await pool.query('SELECT id,username,email,active FROM admins WHERE id=$1 LIMIT 1',[s.adminId]);return rows[0]||null;}
async function requireAdmin(req,res,pool){const a=await getAdmin(req,pool);if(!a){res.writeHead(302,{Location:'/admin/login'});res.end();return null;}return a;}

async function ensureAdminSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY,username TEXT UNIQUE NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,last_login_at TIMESTAMP NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS balance_requests (id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,amount DECIMAL(10,2) NOT NULL,image_url TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'pending',reviewed_by TEXT NULL,reviewed_at TIMESTAMP NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_balance_user ON balance_requests(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_balance_status ON balance_requests(status)');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0');
  const{rows}=await pool.query('SELECT COUNT(*)::int AS c FROM admins');
  if(!rows[0]||rows[0].c===0){await pool.query('INSERT INTO admins(username,email,password_hash)VALUES($1,$2,$3)',['admin','admin@ztopup.az',hashPw('admin123')]);console.log('[Admin] Default admin created: admin / admin123');}
}

async function rLogin(req,res,pool){
  if(req.method==='GET'){const t=csrfToken();setCookie(res,'admin_csrf',t,3600);const html=`<!doctype html><html lang="az"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Admin Giriş</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}.card{width:100%;max-width:420px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:24px}h1{font-size:22px;margin:0 0 16px}label{display:block;font-size:13px;color:#c9c9d1;margin:10px 0 6px}input{width:100%;background:#141427;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:10px 12px;outline:none;box-sizing:border-box}button{width:100%;margin-top:16px;background:#6c4df4;border:none;color:#fff;padding:12px 14px;border-radius:12px;font-weight:800;cursor:pointer}.error{margin-top:10px;background:rgba(255,99,71,.1);border:1px solid rgba(255,99,71,.3);padding:10px;border-radius:10px;color:#ffb3a7}</style></head><body><div class="card"><h1>Admin Giriş</h1><form method="post" autocomplete="on"><input type="hidden" name="csrf" value="${esc(t)}"/><label>Email və ya İstifadəçi Adı</label><input type="text" name="identifier" required/><label>Şifrə</label><input type="password" name="password" required/><button type="submit">Daxil ol</button></form></div></body></html>`;return sendHtml(res,200,html);}
  if(req.method==='POST'){try{const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==c.admin_csrf)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const id=String(body.identifier||'').trim().toLowerCase();const pw=String(body.password||'');const{rows}=await pool.query('SELECT id,username,email,password_hash FROM admins WHERE (LOWER(email)=LOWER($1) OR LOWER(username)=LOWER($1)) AND active=TRUE LIMIT 1',[id]);const a=rows[0];if(!a||!verifyPw(pw,a.password_hash)){const t=csrfToken();setCookie(res,'admin_csrf',t,3600);const html=`<!doctype html><html lang="az"><head><meta charset="utf-8"/><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}.card{width:100%;max-width:420px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:24px}h1{font-size:22px;margin:0 0 16px}label{display:block;font-size:13px;color:#c9c9d1;margin:10px 0 6px}input{width:100%;background:#141427;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:10px 12px;outline:none;box-sizing:border-box}button{width:100%;margin-top:16px;background:#6c4df4;border:none;color:#fff;padding:12px 14px;border-radius:12px;font-weight:800;cursor:pointer}.error{margin-top:10px;background:rgba(255,99,71,.1);border:1px solid rgba(255,99,71,.3);padding:10px;border-radius:10px;color:#ffb3a7}</style></head><body><div class="card"><h1>Admin Giriş</h1><div class="error">Giriş məlumatları səhvdir</div><form method="post"><input type="hidden" name="csrf" value="${esc(t)}"/><label>Email və ya İstifadəçi Adı</label><input type="text" name="identifier" required value="${esc(id)}"/><label>Şifrə</label><input type="password" name="password" required/><button type="submit">Daxil ol</button></form></div></body></html>`;return sendHtml(res,200,html);}
    const tok=crypto.randomBytes(32).toString('hex');adminSessions.set(tok,{adminId:a.id,username:a.username,createdAt:Date.now()});setCookie(res,'admin_token',tok,1800);await pool.query('UPDATE admins SET last_login_at=NOW() WHERE id=$1',[a.id]);res.writeHead(302,{Location:'/admin/'});res.end();}catch(e){console.error('[Admin Login Error]',e);return sendHtml(res,500,'<h1>Server xətası: '+esc(e.message)+'</h1>');}}
}

async function rLogout(req,res){const c=parseCookies(req);if(c.admin_token)adminSessions.delete(c.admin_token);clearCookie(res,'admin_token');clearCookie(res,'admin_csrf');res.writeHead(302,{Location:'/admin/login'});res.end();}

async function rDashboard(req,res,pool){const a=await requireAdmin(req,res,pool);if(!a)return;const stats={u:0,o:0,pb:0,pa:0,pd:0,rev:'0.00'};try{stats.u=(await pool.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c;stats.o=(await pool.query('SELECT COUNT(*)::int AS c FROM orders')).rows[0].c;stats.pb=(await pool.query("SELECT COUNT(*)::int AS c FROM balance_requests WHERE LOWER(status)='pending'")).rows[0].c;stats.pa=(await pool.query("SELECT COUNT(*)::int AS c FROM avatar_requests WHERE LOWER(status)='pending'")).rows[0].c;stats.pd=(await pool.query("SELECT COUNT(*)::int AS c FROM deposit_requests WHERE LOWER(status)='pending'")).rows[0].c;stats.rev=(await pool.query("SELECT COALESCE(TO_CHAR(SUM(CASE WHEN LOWER(type)='credit' THEN amount ELSE 0 END),'FM999999990.00'),'0.00') AS r FROM transactions")).rows[0].r;}catch(e){}
  const content=`<main class="grid"><div class="card"><div>İstifadəçilər</div><div class="stat">${stats.u}</div></div><div class="card"><div>Sifarişlər</div><div class="stat">${stats.o}</div></div><div class="card"><div>Gözləyən Balans</div><div class="stat">${stats.pb}</div></div><div class="card"><div>Gözləyən Avatar</div><div class="stat">${stats.pa}</div></div><div class="card"><div>Gözləyən Depozit</div><div class="stat">${stats.pd}</div></div><div class="card"><div>Gəlir</div><div class="stat">₼ ${stats.rev}</div></div></main>`;
  sendHtml(res,200,page('Admin Panel',nav('/admin/'),content));
}

async function rDeposits(req,res,pool){
  const a=await requireAdmin(req,res,pool);if(!a)return;
  let flash=null;const url=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==='POST'){const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==c.admin_csrf)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const id=String(body.id||''),action=String(body.action||''),note=String(body.note||'').trim();if(id&&(action==='approve'||action==='reject')){try{await pool.query('BEGIN');const r=await pool.query('SELECT*FROM deposit_requests WHERE id=$1 LIMIT 1 FOR UPDATE',[id]);const row=r.rows[0];if(!row)throw new Error('Sorğu tapılmadı');if(String(row.status).toLowerCase()!=='pending')throw new Error('Bu sorğu artıq emal edilib');if(action==='approve'){const amt=parseFloat(body.amount||0);if(!isFinite(amt)||amt<=0)throw new Error('Düzgün məbləğ daxil edin');await pool.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[amt,row.user_id]);await pool.query("UPDATE deposit_requests SET status='approved',approved_at=NOW(),admin_note=$1 WHERE id=$2",[note||null,id]);const tid=crypto.randomBytes(16).toString('hex');await pool.query('INSERT INTO transactions(id,user_id,amount,type,status,ref)VALUES($1,$2,$3,$4,$5,$6)',[tid,row.user_id,amt,'credit','approved','Deposit approved by admin (request '+row.id+')']);flash={type:'ok',msg:'Depozit təsdiqləndi və '+amt.toFixed(2)+' ₼ balansa əlavə olundu'};}else{await pool.query("UPDATE deposit_requests SET status='rejected',approved_at=NOW(),admin_note=$1 WHERE id=$2",[note||null,id]);flash={type:'ok',msg:'Depozit sorğusu rədd edildi'};}await pool.query('COMMIT');}catch(e){await pool.query('ROLLBACK').catch(()=>{});flash={type:'bad',msg:'Xəta: '+e.message};}}}
  const status=url.searchParams.get('status')||'pending';let sql='SELECT d.*,u.username,u.email FROM deposit_requests d LEFT JOIN users u ON u.id=d.user_id',params=[];if(status){sql+=' WHERE LOWER(d.status)=LOWER($1)';params.push(status);}sql+=' ORDER BY d.created_at DESC LIMIT 300';const{rows}=await pool.query(sql,params);
  const cs=csrfToken();setCookie(res,'admin_csrf',cs,3600);
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
  const a=await requireAdmin(req,res,pool);if(!a)return;
  let flash=null;const url=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==='POST'){const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==c.admin_csrf)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const uid=String(body.user_id||''),amt=parseFloat(body.amount||0),reason=String(body.reason||'Admin adjustment').trim();if(uid&&amt!==0){try{await pool.query('BEGIN');await pool.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[amt,uid]);const tid=crypto.randomBytes(16).toString('hex');await pool.query('INSERT INTO transactions(id,user_id,amount,type,status,ref)VALUES($1,$2,$3,$4,$5,$6)',[tid,uid,Math.abs(amt),amt>0?'credit':'debit','approved',reason]);await pool.query('COMMIT');flash={type:'ok',msg:'Balans yeniləndi'};}catch(e){await pool.query('ROLLBACK').catch(()=>{});flash={type:'bad',msg:'Xəta: '+e.message};}}}
  const q=String(url.searchParams.get('q')||'').trim();let sql='SELECT id,username,email,first_name,last_name,balance,created_at FROM users',params=[];if(q){sql+=' WHERE LOWER(username) LIKE $1 OR LOWER(email) LIKE $1 OR id::text=$2';params.push('%'+q.toLowerCase()+'%',q);}sql+=' ORDER BY created_at DESC LIMIT 200';const{rows:users}=await pool.query(sql,params);
  const cs=csrfToken();setCookie(res,'admin_csrf',cs,3600);
  let tr='';for(const u of users){tr+=`<tr><td>${esc(u.id)}</td><td>${esc(u.username)}</td><td>${esc(u.email)}</td><td>${esc((u.first_name||'')+' '+(u.last_name||''))}</td><td>₼ ${parseFloat(u.balance||0).toFixed(2)}</td><td>${esc(u.created_at)}</td><td><form method="post" style="display:flex;gap:8px;align-items:center"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="user_id" value="${esc(u.id)}"/><input type="number" step="0.01" name="amount" placeholder="Məbləğ (+/-)"/><input type="text" name="reason" placeholder="Qeyd"/><button type="submit">Yenilə</button></form></td></tr>`;}
  const content=`<form method="get" class="card"><input type="text" name="q" value="${esc(q)}" placeholder="Axtarış: username, email və ya ID" style="width:100%"/></form><div class="card"><table><thead><tr><th>ID</th><th>Username</th><th>Email</th><th>Ad</th><th>Balans</th><th>Tarix</th><th>Balans Dəyişikliyi</th></tr></thead><tbody>${tr}</tbody></table></div>`;
  sendHtml(res,200,page('İstifadəçilər',nav('/admin/users'),content,flash));
}

async function rOrders(req,res,pool){
  const a=await requireAdmin(req,res,pool);if(!a)return;
  let flash=null;const url=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==='POST'){const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==c.admin_csrf)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const id=String(body.id||''),st=String(body.status||'');if(id&&['pending','processing','completed','failed'].includes(st)){await pool.query('UPDATE orders SET status=$1 WHERE id=$2',[st,id]);flash={type:'ok',msg:'Status yeniləndi'};}}
  const q=String(url.searchParams.get('q')||'').trim(),status=String(url.searchParams.get('status')||'');let sql='SELECT*FROM orders',params=[],conds=[];if(q){conds.push('(LOWER(user_email) LIKE $'+(params.length+1)+' OR LOWER(game) LIKE $'+(params.length+1)+' OR LOWER(package) LIKE $'+(params.length+1)+' OR id::text=$'+(params.length+2)+')');params.push('%'+q.toLowerCase()+'%',q);}if(status){conds.push('LOWER(status)=LOWER($'+(params.length+1)+')');params.push(status);}if(conds.length)sql+=' WHERE '+conds.join(' AND ');sql+=' ORDER BY created_at DESC LIMIT 300';const{rows}=await pool.query(sql,params);
  const cs=csrfToken();setCookie(res,'admin_csrf',cs,3600);
  let tr='';for(const r of rows){const opts=['pending','processing','completed','failed'].map(s=>`<option value="${s}" ${String(r.status).toLowerCase()===s?'selected':''}>${s}</option>`).join('');tr+=`<tr><td>${esc(r.id)}</td><td>${esc(r.user_email)}</td><td>${esc(r.game)}</td><td>${esc(r.package)}</td><td>₼ ${parseFloat(r.price||0).toFixed(2)}</td><td>${esc(r.player_id)}</td><td>${esc(r.status)}</td><td><form method="post" style="display:flex;gap:6px;align-items:center"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="id" value="${esc(r.id)}"/><select name="status">${opts}</select><button type="submit">Saxla</button></form></td></tr>`;}
  const content=`<form method="get" class="card" style="display:flex;gap:10px;align-items:center"><input type="text" name="q" value="${esc(q)}" placeholder="Axtar: email, oyun, paket, ID" style="flex:1"/><select name="status"><option value="">Hamısı</option><option value="pending" ${status==='pending'?'selected':''}>pending</option><option value="processing" ${status==='processing'?'selected':''}>processing</option><option value="completed" ${status==='completed'?'selected':''}>completed</option><option value="failed" ${status==='failed'?'selected':''}>failed</option></select><button type="submit">Axtar</button></form><div class="card"><table><thead><tr><th>ID</th><th>Email</th><th>Oyun</th><th>Paket</th><th>Qiymət</th><th>Oyunçu ID</th><th>Status</th><th>Yenilə</th></tr></thead><tbody>${tr}</tbody></table></div>`;
  sendHtml(res,200,page('Sifarişlər',nav('/admin/orders'),content,flash));
}

async function rProducts(req,res,pool){
  const a=await requireAdmin(req,res,pool);if(!a)return;
  let flash=null;
  if(req.method==='POST'){const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==c.admin_csrf)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const action=String(body.action||'');try{if(action==='create'){const id=crypto.randomUUID();await pool.query('INSERT INTO products(id,game,title,price,image_url,available,delivery_minutes,stock)VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,String(body.game||'').trim(),String(body.title||'').trim(),parseFloat(body.price||0),String(body.image_url||'').trim(),!!body.available,parseInt(body.delivery_minutes||5),parseInt(body.stock||0)]);flash={type:'ok',msg:'Məhsul əlavə edildi'};}else if(action==='update'){const id=String(body.id||'');await pool.query('UPDATE products SET game=$1,title=$2,price=$3,image_url=$4,available=$5,delivery_minutes=$6,stock=$7 WHERE id=$8',[String(body.game||'').trim(),String(body.title||'').trim(),parseFloat(body.price||0),String(body.image_url||'').trim(),!!body.available,parseInt(body.delivery_minutes||5),parseInt(body.stock||0),id]);flash={type:'ok',msg:'Məhsul yeniləndi'};}else if(action==='delete'){const id=String(body.id||'');await pool.query('DELETE FROM products WHERE id=$1',[id]);flash={type:'ok',msg:'Məhsul silindi'};}}catch(e){flash={type:'bad',msg:'Xəta: '+e.message};}}
  const{rows}=await pool.query('SELECT*FROM products ORDER BY created_at DESC');
  const cs=csrfToken();setCookie(res,'admin_csrf',cs,3600);
  let tr='';for(const r of rows){tr+=`<tr><td>${esc(r.id)}</td><td>${esc(r.game)}</td><td>${esc(r.title)}</td><td>₼ ${parseFloat(r.price||0).toFixed(2)}</td><td>${r.available?'Bəli':'Xeyr'}</td><td>${parseInt(r.stock||0)}</td><td><form method="post" style="display:flex;gap:6px;flex-wrap:wrap"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="action" value="update"/><input type="hidden" name="id" value="${esc(r.id)}"/><input type="text" name="game" value="${esc(r.game)}"/><input type="text" name="title" value="${esc(r.title)}"/><input type="number" step="0.01" name="price" value="${esc(String(r.price))}"/><input type="text" name="image_url" value="${esc(r.image_url||'')}"/><label><input type="checkbox" name="available" ${r.available?'checked':''}/> Mövcud</label><input type="number" name="delivery_minutes" value="${parseInt(r.delivery_minutes||5)}"/><input type="number" name="stock" value="${parseInt(r.stock||0)}"/><button type="submit">Saxla</button></form><form method="post" onsubmit="return confirm('Silinsin?')"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="action" value="delete"/><input type="hidden" name="id" value="${esc(r.id)}"/><button type="submit">Sil</button></form></td></tr>`;}
  const content=`<div class="card"><form method="post" style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="action" value="create"/><input type="text" name="game" placeholder="Oyun" required/><input type="text" name="title" placeholder="Başlıq" required/><input type="number" step="0.01" name="price" placeholder="Qiymət" required/><input type="text" name="image_url" placeholder="Şəkil linki"/><label><input type="checkbox" name="available" checked/> Mövcud</label><input type="number" name="delivery_minutes" placeholder="Çatdırılma (dəq)" value="5"/><input type="number" name="stock" placeholder="Anbar say" value="0"/><button type="submit">Yeni məhsul</button></form></div><div class="card"><table><thead><tr><th>ID</th><th>Oyun</th><th>Başlıq</th><th>Qiymət</th><th>Mövcud</th><th>Anbar</th><th>Əməliyyat</th></tr></thead><tbody>${tr}</tbody></table></div>`;
  sendHtml(res,200,page('Məhsullar',nav('/admin/products'),content,flash));
}

async function rBalanceRequests(req,res,pool){
  const a=await requireAdmin(req,res,pool);if(!a)return;
  let flash=null;
  if(req.method==='POST'){const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==c.admin_csrf)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const id=String(body.id||''),action=String(body.action||'');if(id&&(action==='approve'||action==='reject')){try{await pool.query('BEGIN');const r=await pool.query('SELECT*FROM balance_requests WHERE id=$1 LIMIT 1',[id]);const row=r.rows[0];if(row){if(action==='approve'&&String(row.status).toLowerCase()==='pending'){await pool.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[row.amount,row.user_id]);const tid=crypto.randomBytes(16).toString('hex');await pool.query('INSERT INTO transactions(id,user_id,amount,type,status,ref)VALUES($1,$2,$3,$4,$5,$6)',[tid,row.user_id,parseFloat(row.amount),'credit','approved','Balance request '+row.id]);await pool.query("UPDATE balance_requests SET status='approved',reviewed_by=$1,reviewed_at=NOW() WHERE id=$2",[String(a.id),id]);flash={type:'ok',msg:'Sorğu təsdiqləndi və balans artırıldı'};}else if(action==='reject'&&String(row.status).toLowerCase()==='pending'){await pool.query("UPDATE balance_requests SET status='rejected',reviewed_by=$1,reviewed_at=NOW() WHERE id=$2",[String(a.id),id]);flash={type:'ok',msg:'Sorğu rədd edildi'};}}await pool.query('COMMIT');}catch(e){await pool.query('ROLLBACK').catch(()=>{});flash={type:'bad',msg:'Xəta: '+e.message};}}}
  const url=new URL(req.url,`http://${req.headers.host}`);const status=url.searchParams.get('status')||'pending';let sql='SELECT*FROM balance_requests',params=[];if(status){sql+=' WHERE LOWER(status)=LOWER($1)';params.push(status);}sql+=' ORDER BY created_at DESC LIMIT 300';const{rows}=await pool.query(sql,params);
  const cs=csrfToken();setCookie(res,'admin_csrf',cs,3600);
  let tr='';for(const r of rows){tr+=`<tr><td>${esc(r.id)}</td><td>${esc(r.user_id)}</td><td>₼ ${parseFloat(r.amount||0).toFixed(2)}</td><td><a href="${esc(r.image_url)}" target="_blank">Bax</a></td><td>${esc(r.status)}</td><td>${String(r.status).toLowerCase()==='pending'?`<form method="post" style="display:flex;gap:6px;align-items:center"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="id" value="${esc(r.id)}"/><button name="action" value="approve" type="submit">Təsdiq</button><button name="action" value="reject" type="submit">Rədd</button></form>`:`—`}</td></tr>`;}
  const content=`<form method="get" class="card" style="display:flex;gap:10px;align-items:center"><label>Status:</label><select name="status"><option value="pending" ${status==='pending'?'selected':''}>Gözləmədə</option><option value="approved" ${status==='approved'?'selected':''}>Təsdiqlənmiş</option><option value="rejected" ${status==='rejected'?'selected':''}>Rədd</option></select><button type="submit">Filtrlə</button></form><div class="card"><table><thead><tr><th>ID</th><th>İstifadəçi</th><th>Məbləğ</th><th>Şəkil</th><th>Status</th><th>Əməliyyat</th></tr></thead><tbody>${tr}</tbody></table></div>`;
  sendHtml(res,200,page('Balans Sorğuları',nav('/admin/balance-requests'),content,flash));
}

async function rAvatars(req,res,pool){
  const a=await requireAdmin(req,res,pool);if(!a)return;
  let flash=null;
  if(req.method==='POST'){const body=await readBody(req);const c=parseCookies(req);if(!body.csrf||body.csrf!==c.admin_csrf)return sendHtml(res,419,'<h1>Etibarsız CSRF tokeni.</h1>');const id=String(body.id||''),action=String(body.action||'');if(id&&(action==='approve'||action==='reject')){const r=await pool.query('SELECT*FROM avatar_requests WHERE id=$1 LIMIT 1',[id]);const row=r.rows[0];if(row){if(action==='approve'&&String(row.status).toLowerCase()==='pending'){await pool.query("UPDATE avatar_requests SET status='approved',approved_by=$1,approved_at=NOW() WHERE id=$2",[String(a.id),id]);await pool.query('UPDATE users SET profile_image_url=$1 WHERE id=$2',[row.image_url,row.user_id]);flash={type:'ok',msg:'Təsdiqləndi'};}else if(action==='reject'&&String(row.status).toLowerCase()==='pending'){await pool.query("UPDATE avatar_requests SET status='rejected',approved_by=$1,approved_at=NOW() WHERE id=$2",[String(a.id),id]);flash={type:'ok',msg:'Rədd edildi'};}}}}
  const url=new URL(req.url,`http://${req.headers.host}`);const status=url.searchParams.get('status')||'pending';let sql='SELECT*FROM avatar_requests',params=[];if(status){sql+=' WHERE LOWER(status)=LOWER($1)';params.push(status);}sql+=' ORDER BY created_at DESC LIMIT 300';const{rows}=await pool.query(sql,params);
  const cs=csrfToken();setCookie(res,'admin_csrf',cs,3600);
  let tr='';for(const r of rows){tr+=`<tr><td>${esc(r.id)}</td><td>${esc(r.user_id)}</td><td><a href="${esc(r.image_url)}" target="_blank">Bax</a></td><td>${esc(r.status)}</td><td>${String(r.status).toLowerCase()==='pending'?`<form method="post" style="display:flex;gap:6px;align-items:center"><input type="hidden" name="csrf" value="${esc(cs)}"/><input type="hidden" name="id" value="${esc(r.id)}"/><button name="action" value="approve" type="submit">Təsdiq</button><button name="action" value="reject" type="submit">Rədd</button></form>`:`—`}</td></tr>`;}
  const content=`<form method="get" class="card" style="display:flex;gap:10px;align-items:center"><label>Status:</label><select name="status"><option value="pending" ${status==='pending'?'selected':''}>Gözləmədə</option><option value="approved" ${status==='approved'?'selected':''}>Təsdiqlənmiş</option><option value="rejected" ${status==='rejected'?'selected':''}>Rədd</option></select><button type="submit">Filtrlə</button></form><div class="card"><table><thead><tr><th>ID</th><th>İstifadəçi</th><th>Şəkil</th><th>Status</th><th>Əməliyyat</th></tr></thead><tbody>${tr}</tbody></table></div>`;
  sendHtml(res,200,page('Avatar Sorğuları',nav('/admin/avatars'),content,flash));
}

async function rReceipt(req,res,pool){
  const a=await requireAdmin(req,res,pool);if(!a)return;
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
  res.writeHead(200,{'Content-Type':mime,'Content-Length':data.length,'Content-Disposition':'inline; filename="'+file+'"','X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=300'});
  res.end(data);
}

module.exports = {
  ensureAdminSchema,
  rLogin,
  rLogout,
  rDashboard,
  rDeposits,
  rUsers,
  rOrders,
  rProducts,
  rBalanceRequests,
  rAvatars,
  rReceipt,
  adminSessions,
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
  requireAdmin
};
