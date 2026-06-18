-- ============================================================
-- Deposit Receipt System migration (PostgreSQL)
-- Safe to run multiple times (idempotent).
-- NOTE: This project uses PostgreSQL, not MySQL. user ids are
--       VARCHAR(36) to match the existing users.id column.
-- ============================================================

-- Deposit (receipt upload) requests
CREATE TABLE IF NOT EXISTS deposit_requests (
    id               VARCHAR(36)    PRIMARY KEY,
    user_id          VARCHAR(36)    NOT NULL,
    receipt_image    VARCHAR(255)   NOT NULL,
    requested_amount NUMERIC(10,2)  NOT NULL DEFAULT 0,
    status           TEXT           NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    admin_note       TEXT           NULL,
    created_at       TIMESTAMP      NOT NULL DEFAULT NOW(),
    approved_at      TIMESTAMP      NULL
);

CREATE INDEX IF NOT EXISTS idx_deposit_user   ON deposit_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_status ON deposit_requests(status);

-- Foreign key (wrapped so re-runs do not error if it already exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_deposit_user'
    ) THEN
        ALTER TABLE deposit_requests
            ADD CONSTRAINT fk_deposit_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Transactions table already exists in this project with columns:
--   id VARCHAR(36), user_id VARCHAR(36), amount NUMERIC(10,2),
--   type TEXT, status TEXT, ref TEXT, created_at TIMESTAMP
-- Deposit approvals insert a 'credit' row into it. Ensure it exists:
CREATE TABLE IF NOT EXISTS transactions (
    id         VARCHAR(36)   PRIMARY KEY,
    user_id    VARCHAR(36)   NOT NULL,
    amount     NUMERIC(10,2) NOT NULL,
    type       TEXT          NOT NULL, -- credit | debit
    status     TEXT          NOT NULL DEFAULT 'approved',
    ref        TEXT          NULL,
    created_at TIMESTAMP     NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_user_id ON transactions(user_id);
