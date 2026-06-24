-- ============================================================
-- Profile Dashboard + Membership + Coupon System migration
-- PostgreSQL, idempotent, backward-compatible.
-- ============================================================

-- User membership level
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS membership_level TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_users_membership ON users(membership_level);

-- Coupons table (global or user-assigned)
CREATE TABLE IF NOT EXISTS coupons (
    id            VARCHAR(36)    PRIMARY KEY,
    code          VARCHAR(60)    NOT NULL UNIQUE,
    discount_type VARCHAR(20)    NOT NULL, -- 'fixed' | 'percentage'
    discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_uses      INTEGER        NOT NULL DEFAULT 0, -- 0 = unlimited
    used_count    INTEGER        NOT NULL DEFAULT 0,
    min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    public        BOOLEAN        NOT NULL DEFAULT false,
    assigned_only BOOLEAN        NOT NULL DEFAULT false,
    active        BOOLEAN        NOT NULL DEFAULT true,
    start_date    TIMESTAMP      NULL,
    expiry_date   TIMESTAMP      NULL,
    description   TEXT           NULL,
    created_at    TIMESTAMP      NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP      NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coupons_code      ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active    ON coupons(active, expiry_date);
CREATE INDEX IF NOT EXISTS idx_coupons_public    ON coupons(public, active);

-- User-coupon assignments (one per user per coupon, supports uses_left)
CREATE TABLE IF NOT EXISTS user_coupons (
    id          VARCHAR(36) PRIMARY KEY,
    user_id     VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coupon_id   VARCHAR(36) NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    uses_left   INTEGER     NOT NULL DEFAULT 1, -- 0 = unlimited
    used_count  INTEGER     NOT NULL DEFAULT 0,
    assigned_at TIMESTAMP   NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_coupon UNIQUE (user_id, coupon_id)
);
CREATE INDEX IF NOT EXISTS idx_user_coupons_user ON user_coupons(user_id);
CREATE INDEX IF NOT EXISTS idx_user_coupons_coupon ON user_coupons(coupon_id);

-- Extend transactions with a human-readable description for history
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS description TEXT;

-- Add a coupon_id reference to orders when a coupon is used
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id VARCHAR(36);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00;
CREATE INDEX IF NOT EXISTS idx_orders_coupon ON orders(coupon_id);
