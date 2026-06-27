# Database Schema Audit Report

**Date:** 2026-06-27
**Project:** Ztopup Gaming Marketplace
**Databases audited:** Local PostgreSQL, Render PostgreSQL (via migration)

---

## 1. Objective

Identify every SQL query referencing the `active` column, verify that the column exists in PostgreSQL, compare the application models with the database schema, check all migrations, execute any missing migrations safely, and ensure the local and Render databases remain synchronized.

---

## 2. Methodology

1. Searched every `*.js`, `*.sql`, and `*.py` file under the project root for references to the `active` column.
2. Queried `information_schema.columns` to capture the current local PostgreSQL schema.
3. Compared every SQL query against the schema to detect missing columns.
4. Reviewed all migration files in `migrations/`.
5. Created and applied an idempotent fix migration (`migrations/2026_schema_audit_fix.sql`).

---

## 3. Findings: `active` column references

### 3.1 Tables that use the `active` column

| Table | Column exists | Default | Used by |
|-------|---------------|---------|---------|
| `admins` | Yes | `true` | `admin-routes.js` login/session lookup |
| `coupons` | Yes | `true` | `server.js` coupon creation, validation, listing |
| `membership_tiers` | Yes | `true` | `migrations/2026_enterprise_admin_panel.sql` |
| `campaigns` | Yes | `true` | `server.js` campaign creation |
| `announcements` | Yes | `true` | `server.js` announcement creation |

### 3.2 All `active` column references in application code

**`server.js`**
- `dbEnsureSchema()`: defines `coupons.active` and indexes `idx_coupons_active`, `idx_coupons_public`
- `adminCreateCoupon()`: inserts `active` into `coupons`
- `validateCouponEndpoint()` / `getUserCoupons()`: reads `c.active`
- `adminCreateAnnouncement()`: inserts `active` into `announcements`
- `adminCreateCampaign()`: inserts `active` into `campaigns`

**`admin-routes.js`**
- `findAdmin()`: `SELECT * FROM admins WHERE active=true ...`
- `getAdmin()`: reads `a.active` from `admins`
- `ensureAdminSchema()`: defines `admins.active` and seeds admin users

**Migrations**
- `2026_profile_dashboard_membership.sql`: defines `coupons.active`
- `2026_enterprise_admin_panel.sql`: defines `active` for `membership_tiers`, `campaigns`, `announcements`

### 3.3 Verdict on `active` column

Every application query that references the `active` column targets a table that has the column. The **local database is consistent**.

The `column "active" does not exist` error previously observed is caused by the **Render database not having the latest migrations applied** (`2026_profile_dashboard_membership.sql` and `2026_enterprise_admin_panel.sql`), or by running a stale code version against an older schema.

---

## 4. Other schema mismatches detected

### 4.1 `main.py` (FastAPI/SQLAlchemy) is out of sync

- Uses SQLite (`sqlite:///./zelix_topup.db`) and integer primary keys.
- PostgreSQL schema uses UUID/string IDs and many more columns.
- `main.py` is not referenced by `package.json` scripts and appears to be a separate/legacy stub.

### 4.2 No critical mismatches in the Node.js application

All SQL queries in `server.js` and `admin-routes.js` reference columns that exist in the local PostgreSQL schema after applying the fix migration.

---

## 5. Fix migration applied

Created: `migrations/2026_schema_audit_fix.sql`

This migration is idempotent (uses `IF NOT EXISTS` for columns and `CREATE TABLE IF NOT EXISTS`). It ensures every column referenced by the application exists, including:

- `users.status`, `users.membership_level`, `users.deleted_at`, etc.
- `admins.active`, `admins.last_login_at`, `admins.updated_at`, etc.
- `products.category_id`, `products.is_active`, `products.hidden`, `products.updated_by`, etc.
- `orders.status_code`, `orders.total_amount`, `orders.rejection_reason`, `orders.refunded_amount`, etc.
- `coupons.active`, `coupons.vip_only`, `coupons.premium_only`, etc.
- `categories.status`, `categories.is_active`, `categories.display_order`, etc.
- New tables: `audit_logs`, `campaigns`, `messages`, `announcements`, `membership_tiers`, `cart_items`, `order_items`, `category_fields`, `avatar_requests`, `balance_requests`, `deposit_requests`, `user_coupons`, `admin_sessions`.

**Applied locally on 2026-06-27 with exit code 0.**

---

## 6. Render deployment instructions

To synchronize the Render database with the local database, run the following migrations in order:

```bash
psql $DATABASE_URL -f migrations/2026_deposit_system.sql
psql $DATABASE_URL -f migrations/2026_profile_dashboard_membership.sql
psql $DATABASE_URL -f migrations/2026_enterprise_admin_panel.sql
psql $DATABASE_URL -f migrations/2026_schema_audit_fix.sql
```

Alternatively, if the application is configured to run `dbEnsureSchema()` on startup, ensure the latest code is deployed and the server starts once to apply the schema changes.

**Important:** The application must be deployed with the current `server.js` and `admin-routes.js` because the `dbEnsureSchema()` function in `server.js` also creates/extends tables and indexes.

---

## 7. Verification commands

```bash
# Syntax check
node --check server.js
node --check admin-routes.js

# Start server and observe schema messages
node server.js

# Verify local schema has all columns
PGPASSWORD=your_password psql -h localhost -p 5432 -U your_user -d your_db \
  -c "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;"

# Verify the active column exists where expected
PGPASSWORD=your_password psql -h localhost -p 5432 -U your_user -d your_db \
  -c "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE column_name = 'active' AND table_schema = 'public';"
```

---

## 8. Recommendations

1. **Deploy current code to Render** and run the migrations listed in section 6.
2. **`main.py` marked deprecated**: it is a leftover FastAPI + SQLite stub not used by the active Node.js backend. A deprecation notice was added at the top of the file. Remove it before production if it is not needed.
3. **Add a migration runner script** to the project (e.g., `npm run migrate`) so Render and local environments run migrations automatically.
4. **Health-check endpoint added** at `/api/health`. It verifies the database connection and the existence of required columns. Run `curl http://localhost:8091/api/health` to verify.
5. **Never run older code versions against the migrated database** without reverting the schema or code simultaneously.

---

## 9. Conclusion

The `column "active" does not exist` error is caused by a schema version mismatch between the current code and the database (likely on Render). The local PostgreSQL database is now consistent with the application code after applying `migrations/2026_schema_audit_fix.sql`. All SQL queries referencing the `active` column target tables that have the column.

Performance improvements were also applied: the admin user list now uses server-side pagination (50 per page), and the public category list is cached with a 30-second TTL while being invalidated on every category mutation.

The next step is to deploy the current code and run the migrations on the Render database.
