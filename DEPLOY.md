# Deploying ZTOPUP to ztopup.az (cPanel)

This app has **two processes that share one folder, one `.env`, one PostgreSQL DB, and one `uploads/` directory**:

- **Main site + API** — Node.js (`server.js`) → served on `https://ztopup.az`
- **Admin panel** — PHP (`admin/`) → served on `https://admin.ztopup.az`

> Why a subdomain for admin? cPanel runs Node through Passenger, which takes over the
> domain it's attached to and will **not** execute `.php` files. PHP must live on a
> separate Apache vhost. Because `admin/config.php` reads `../.env` and
> `../uploads/receipts`, the `admin/` folder **must remain a subfolder of the app root**.

```
/home/dqkxfqmx/ztopup/            <-- Node "Application Root" (OUTSIDE public_html)
├── server.js                     <-- Node startup file
├── package.json
├── .env                          <-- shared by Node AND PHP admin
├── uploads/receipts/             <-- written by Node, read by PHP admin
├── assets/ ...                   <-- static files (logo, pubg-uc.png, etc.)
├── *.html                        <-- main site pages
└── admin/                        <-- PHP admin  (admin.ztopup.az docroot points here)
```

---

## Step 1 — Upload the files
1. Zip the project locally (exclude `node_modules`):
   ```bash
   zip -r ztopup.zip . -x "node_modules/*" ".git/*"
   ```
2. In cPanel **File Manager**, create folder `/home/<cpaneluser>/ztopup`, upload `ztopup.zip` there, and **Extract**.

## Step 2 — Create the database (if not already)
1. cPanel → **PostgreSQL Databases** → confirm DB `dqkxfqmx_ztopup_user_database` and user `dqkxfqmx_zelix` exist, user is added to the DB with **All Privileges**.
2. Tables are auto-created on first run (both Node `dbEnsureSchema()` and PHP `ensure_schema()` create them). No manual SQL needed. (Optional: run `migrations/2026_deposit_system.sql` via phpPgAdmin.)

## Step 3 — Create the server `.env`
In `/home/<cpaneluser>/ztopup/.env` put (see `.env.production.example`):
```
DB_HOST=localhost          # <-- localhost on the server, NOT ztopup.az
DB_PORT=5432
DB_USER=dqkxfqmx_zelix
DB_PASSWORD=your_real_password
DB_NAME=dqkxfqmx_ztopup_user_database
PGSSLMODE=disable
PGCONNECT_TIMEOUT=5
JWT_SECRET=<long random string>
```
Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Step 4 — Set up the Node app
1. cPanel → **Setup Node.js App** → **Create Application**:
   - **Node version**: 18 or higher
   - **Application mode**: Production
   - **Application root**: `ztopup`
   - **Application URL**: `ztopup.az`
   - **Application startup file**: `server.js`
2. Click **Create**, then **Run NPM Install** (installs `pg`, `dotenv`, `jsonwebtoken`).
3. Click **Restart**. Open the log; you want to see `PostgreSQL connection successful.`

## Step 5 — Set up the PHP admin subdomain
1. cPanel → **Domains / Subdomains** → create `admin.ztopup.az`
   - **Document Root**: `/home/<cpaneluser>/ztopup/admin`
2. Visit `https://admin.ztopup.az/login.php` — it should load (PHP runs under Apache here and reads the shared `../.env`).

## Step 6 — Create the admin account
Run once via cPanel **Terminal**:
```bash
cd ~/ztopup
ADMIN_USERNAME=admin ADMIN_EMAIL=you@ztopup.az ADMIN_PASSWORD='StrongPass!' php admin/seed_admin.php
```
(or set `ADMIN_SETUP_TOKEN` in `.env` and open `admin.ztopup.az/seed_admin.php?token=...`)

## Step 7 — Permissions for receipt uploads
```bash
mkdir -p ~/ztopup/uploads/receipts
chmod -R 755 ~/ztopup/uploads
```
Node writes receipts here; the customer site serves them at `/uploads/receipts/...`;
the admin reads them securely via `admin/receipt.php`.

## Step 8 — Force HTTPS
Enable **AutoSSL** for `ztopup.az` and `admin.ztopup.az`, then redirect HTTP→HTTPS
(cPanel → Domains → toggle "Force HTTPS Redirect").

---

## After deploy: verify
- `https://ztopup.az` loads the store; register a test account.
- `https://admin.ztopup.az/login.php` → log in → see the user and the deposit queue.
- Upload a receipt on the site → it appears in admin → approve → balance updates.

## Updating later
Upload changed files, then in **Setup Node.js App** click **Restart** (PHP changes are live immediately).
