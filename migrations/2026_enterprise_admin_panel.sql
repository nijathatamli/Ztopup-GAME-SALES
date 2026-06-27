-- ============================================================
-- Enterprise Admin Panel Upgrade Migration
-- PostgreSQL, idempotent, backward-compatible.
-- ============================================================

-- ============================================================
-- 1. USERS: soft-delete, status, last login, IP, updated_at
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(45) NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);

-- ============================================================
-- 2. MEMBERSHIP TIERS: dynamic pricing/discounts
-- ============================================================
CREATE TABLE IF NOT EXISTS membership_tiers (
    id          VARCHAR(36) PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    code        TEXT NOT NULL UNIQUE,
    discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    priority    INTEGER NOT NULL DEFAULT 0,
    color       TEXT NULL,
    benefits    TEXT[] NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_membership_tiers_active ON membership_tiers(active, priority);

INSERT INTO membership_tiers (id, name, code, discount_percent, priority, color, benefits)
VALUES
  ('standard-tier', 'Standard', 'standard', 0, 1, '#9b59b6', NULL),
  ('vip-tier', 'VIP', 'vip', 5, 2, '#3498db', ARRAY['Xüsusi endirimlər', 'Prioritet dəstək']),
  ('premium-tier', 'Premium', 'premium', 10, 3, '#f1c40f', ARRAY['Maksimum endirim', 'VIP xidmət', 'Öncəlikli sifariş'])
ON CONFLICT (code) DO NOTHING;

ALTER TABLE users
  ADD CONSTRAINT IF NOT EXISTS fk_users_membership_tier
  FOREIGN KEY (membership_level) REFERENCES membership_tiers(code)
  ON UPDATE CASCADE ON DELETE SET DEFAULT;

-- ============================================================
-- 3. AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id           VARCHAR(36) PRIMARY KEY,
    admin_id     VARCHAR(36) NULL,
    admin_username TEXT NULL,
    action       TEXT NOT NULL,
    target_type  TEXT NULL,
    target_id    TEXT NULL,
    old_value    JSONB NULL,
    new_value    JSONB NULL,
    ip_address   VARCHAR(45) NULL,
    user_agent   TEXT NULL,
    browser      TEXT NULL,
    os           TEXT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================
-- 4. CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
    id              VARCHAR(36) PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL, -- percentage | fixed
    value           NUMERIC(10,2) NOT NULL,
    start_date      TIMESTAMP NULL,
    end_date        TIMESTAMP NULL,
    target_type     TEXT NOT NULL DEFAULT 'all', -- all | categories | products | membership
    target_ids      JSONB NULL DEFAULT '[]'::jsonb,
    vip_only        BOOLEAN NOT NULL DEFAULT false,
    premium_only    BOOLEAN NOT NULL DEFAULT false,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_campaigns_target ON campaigns(target_type);

-- ============================================================
-- 5. MESSAGES (admin -> users)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
    id            VARCHAR(36) PRIMARY KEY,
    sender_id     VARCHAR(36) NULL, -- admin id
    recipient_id  VARCHAR(36) NULL, -- user id; NULL = broadcast
    title         TEXT NOT NULL,
    content       TEXT NOT NULL,
    priority      TEXT NOT NULL DEFAULT 'normal', -- low | normal | high | urgent
    status        TEXT NOT NULL DEFAULT 'unread', -- unread | read | deleted
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    read_at       TIMESTAMP NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- ============================================================
-- 6. ANNOUNCEMENTS / GLOBAL NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS announcements (
    id              VARCHAR(36) PRIMARY KEY,
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'info', -- info | warning | maintenance | campaign | emergency
    target_audience TEXT NOT NULL DEFAULT 'all', -- all | vip | premium | selected
    target_user_ids JSONB NULL DEFAULT '[]'::jsonb,
    active          BOOLEAN NOT NULL DEFAULT true,
    start_date      TIMESTAMP NULL,
    end_date        TIMESTAMP NULL,
    created_by      VARCHAR(36) NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(active, start_date, end_date);

-- ============================================================
-- 7. PRODUCT ENHANCEMENTS
-- ============================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS updated_by TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured, featured_at) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_products_hidden ON products(hidden);

-- ============================================================
-- 8. ORDER ENHANCEMENTS
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT NULL,
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status_code, created_at DESC);

-- ============================================================
-- 9. COUPON ENHANCEMENTS: target categories/products
-- ============================================================
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS target_categories JSONB NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS target_products JSONB NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS vip_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_by TEXT NULL;

-- ============================================================
-- 10. SESSIONS: track last activity for online users
-- ============================================================
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at);

-- ============================================================
-- 11. ADMIN ENHANCEMENTS
-- ============================================================
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(45) NULL;

CREATE INDEX IF NOT EXISTS idx_admins_role ON admins(role);

-- ============================================================
-- 12. FOREIGN KEY FIXUPS
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_user'
    ) THEN
        ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_product'
    ) THEN
        ALTER TABLE orders ADD CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_category'
    ) THEN
        ALTER TABLE products ADD CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_deposit_requests_user'
    ) THEN
        ALTER TABLE deposit_requests ADD CONSTRAINT fk_deposit_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_balance_requests_user'
    ) THEN
        ALTER TABLE balance_requests ADD CONSTRAINT fk_balance_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_avatar_requests_user'
    ) THEN
        ALTER TABLE avatar_requests ADD CONSTRAINT fk_avatar_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_notifications_user'
    ) THEN
        ALTER TABLE notifications ADD CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_order_items_order'
    ) THEN
        ALTER TABLE order_items ADD CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_order_items_product'
    ) THEN
        ALTER TABLE order_items ADD CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_user'
    ) THEN
        ALTER TABLE transactions ADD CONSTRAINT fk_transactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_coupons_user'
    ) THEN
        ALTER TABLE user_coupons ADD CONSTRAINT fk_user_coupons_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_coupons_coupon'
    ) THEN
        ALTER TABLE user_coupons ADD CONSTRAINT fk_user_coupons_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_coupons_order'
    ) THEN
        ALTER TABLE orders ADD CONSTRAINT fk_coupons_order FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL;
    END IF;
END $$;
