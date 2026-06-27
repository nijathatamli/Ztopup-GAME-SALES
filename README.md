# ZELIX TOPUP

Enterprise-grade gaming top-up marketplace with admin panel, user dashboard, real-time notifications, and PostgreSQL backend.

## Project structure

- `server.js` — Main Node.js application (public API, admin API, admin panel, SSE).
- `admin-routes.js` — Admin panel HTML routes and helpers.
- `lib/audit.js` — Audit logging helpers.
- `server/` — Express-based authentication microservice (optional, port 3000).
- `migrations/` — Idempotent SQL migrations.
- `main.py` — **Deprecated** FastAPI/SQLite stub, not used by the active application.

## Quick start (local)

```bash
# Install main dependencies
npm install

# Copy and fill environment variables
cp .env.example .env
# Required: DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
# Required: JWT_SECRET

# Run migrations
npm run migrate

# Start main server
npm start
```

Main app: http://localhost:8091

## Auth microservice (optional)

```bash
cd server
cp .env.example .env
# Required: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET
npm install
npm start
```

Auth server: http://localhost:3000

## Verification

```bash
# Syntax checks
npm run check

# Health check
npm run health

# Or directly
curl -s http://localhost:8091/api/health
```

## Migrations

Run in order:

```bash
psql $DATABASE_URL -f migrations/2026_deposit_system.sql
psql $DATABASE_URL -f migrations/2026_profile_dashboard_membership.sql
psql $DATABASE_URL -f migrations/2026_enterprise_admin_panel.sql
psql $DATABASE_URL -f migrations/2026_schema_audit_fix.sql
```

`migrations/2026_schema_audit_fix.sql` is idempotent and ensures every column referenced by the application exists.

## Environment variables

Main app:

- `DATABASE_URL` — PostgreSQL connection string (preferred on Render).
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — Local discrete credentials.
- `JWT_SECRET` — Long random string (required; server exits if missing).
- `PORT` — Server port (default 8091).
- `DB_SSL` — Set to `false` to disable SSL; enabled automatically for non-local hosts.

Auth server (`server/.env`):

- `PORT` — Default 3000.
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`.
- `JWT_SECRET` — Required; server exits if missing.

## Key features

- PostgreSQL-backed schema with full migrations.
- JWT authentication with CSRF protection.
- Real-time updates via Server-Sent Events (SSE).
- Enterprise admin panel with audit logs, campaigns, messages, announcements, coupons, memberships.
- Product and category management with image uploads, custom fields, and bulk operations.
- In-memory TTL cache for public category list with automatic invalidation.

## Reports

- `SECURITY_AUDIT_REPORT.md` — Security fixes, hardening, and verification commands.
- `SCHEMA_AUDIT_REPORT.md` — Database schema audit results and Render synchronization steps.
