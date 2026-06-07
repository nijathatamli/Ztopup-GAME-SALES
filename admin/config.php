<?php
declare(strict_types=1);

// Simple config + PDO bootstrap for PostgreSQL (PDO pgsql)
// Reads credentials from environment variables.
// Never hardcode secrets here; set them in your shell or .env (not committed).

// Optional: light .env loader (only key=value, no quotes) if file exists
$envPath = dirname(__DIR__) . '/.env';
if (is_readable($envPath)) {
    $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (str_starts_with(trim($line), '#')) continue;
        $pos = strpos($line, '=');
        if ($pos === false) continue;
        $k = trim(substr($line, 0, $pos));
        $v = trim(substr($line, $pos + 1));
        if ($k !== '' && getenv($k) === false) {
            putenv($k . '=' . $v);
            $_ENV[$k] = $v;
            $_SERVER[$k] = $v;
        }
    }
}

$DB_HOST = getenv('DB_HOST') ?: 'localhost';
$DB_PORT = (int) (getenv('DB_PORT') ?: 5432);
$DB_NAME = getenv('DB_NAME') ?: '';
$DB_USER = getenv('DB_USER') ?: '';
$DB_PASSWORD = getenv('DB_PASSWORD') ?: '';
$SSL_MODE = getenv('PGSSLMODE') ?: '';

$sslDsn = ($SSL_MODE && strtolower($SSL_MODE) === 'require') ? ';sslmode=require' : '';
$dsn = "pgsql:host={$DB_HOST};port={$DB_PORT};dbname={$DB_NAME}{$sslDsn}";

try {
    $pdo = new PDO($dsn, $DB_USER, $DB_PASSWORD, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo "<h1>Database connection failed</h1>\n";
    echo "<pre>" . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . "</pre>";
    exit;
}

function ensure_schema(PDO $pdo): void {
    // Users (matches Node.js schema types)
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(36) PRIMARY KEY,
            username VARCHAR(80) UNIQUE NOT NULL,
            name VARCHAR(120) NOT NULL,
            first_name VARCHAR(80) NOT NULL,
            last_name VARCHAR(80) NOT NULL,
            email VARCHAR(190) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            balance NUMERIC(10,2) NOT NULL DEFAULT 0.00,
            is_admin BOOLEAN NOT NULL DEFAULT FALSE,
            profile_image_url TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    SQL);

    // Create admins table (separate admin auth)
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS admins (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            last_login_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    SQL);

    // Transactions (balance history)
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS transactions (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,
            amount NUMERIC(10,2) NOT NULL,
            type TEXT NOT NULL, -- credit | debit
            status TEXT NOT NULL DEFAULT 'approved',
            ref TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    SQL);
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_tx_user_id ON transactions(user_id)");
    // FK: transactions.user_id -> users.id
    try { $pdo->exec("ALTER TABLE transactions ADD CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"); } catch (Throwable $e) {}

    // Avatar requests (profile image approvals)
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS avatar_requests (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,
            image_url TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
            approved_by TEXT NULL,
            approved_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    SQL);
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_avatar_user ON avatar_requests(user_id)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_avatar_status ON avatar_requests(status)");
    // FK: avatar_requests.user_id -> users.id
    try { $pdo->exec("ALTER TABLE avatar_requests ADD CONSTRAINT fk_avatar_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"); } catch (Throwable $e) {}

    // Balance requests (payment proof uploads)
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS balance_requests (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,
            amount NUMERIC(10,2) NOT NULL,
            image_url TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
            reviewed_by TEXT NULL,
            reviewed_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    SQL);
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_balance_user ON balance_requests(user_id)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_balance_status ON balance_requests(status)");
    // FK: balance_requests.user_id -> users.id
    try { $pdo->exec("ALTER TABLE balance_requests ADD CONSTRAINT fk_balance_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"); } catch (Throwable $e) {}

    // Products
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS products (
            id VARCHAR(36) PRIMARY KEY,
            game TEXT NOT NULL,
            title TEXT NOT NULL,
            price NUMERIC(10,2) NOT NULL,
            image_url TEXT NULL,
            available BOOLEAN NOT NULL DEFAULT TRUE,
            delivery_minutes INTEGER NOT NULL DEFAULT 5,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    SQL);
    // Add stock column if missing
    try { $pdo->exec("ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0"); } catch (Throwable $e) {}

    // Orders
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS orders (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,
            user_email TEXT NOT NULL,
            game TEXT NOT NULL,
            package TEXT NOT NULL,
            price NUMERIC(10,2) NOT NULL,
            player_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Tamamlandı',
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    SQL);
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)");
}

ensure_schema($pdo);

// Session settings
session_name('zelix_admin');
session_start();

const SESSION_TIMEOUT = 1800; // 30 minutes

function is_post(): bool { return ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST'; }
function redirect(string $path): never { header('Location: ' . $path); exit; }
function e(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
