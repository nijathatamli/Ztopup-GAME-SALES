<?php
require __DIR__ . '/config.php';

// One-time admin seeder.
// Safer to run from CLI with env vars:
//   ADMIN_USERNAME=admin ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=StrongPass php admin/seed_admin.php
// Alternatively via browser with a setup token:
//   /admin/seed_admin.php?token=YOUR_TOKEN
// And define ADMIN_SETUP_TOKEN in environment or .env

$tokenOk = false;
$setupTokenEnv = getenv('ADMIN_SETUP_TOKEN') ?: '';
if (php_sapi_name() === 'cli') {
    $tokenOk = true;
} elseif ($setupTokenEnv !== '' && isset($_GET['token']) && hash_equals($setupTokenEnv, (string)$_GET['token'])) {
    $tokenOk = true;
}
if (!$tokenOk) {
    http_response_code(403);
    echo 'Forbidden';
    exit;
}

$username = getenv('ADMIN_USERNAME') ?: ($_POST['username'] ?? '');
$email = getenv('ADMIN_EMAIL') ?: ($_POST['email'] ?? '');
$password = getenv('ADMIN_PASSWORD') ?: ($_POST['password'] ?? '');

if ($username === '' || $email === '' || $password === '') {
    echo "Provide ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD via env or POST.\n";
    exit;
}

try {
    $stmt = $pdo->prepare('SELECT id FROM admins WHERE LOWER(email)=LOWER(:e) OR LOWER(username)=LOWER(:u) LIMIT 1');
    $stmt->execute([':e' => $email, ':u' => $username]);
    $exists = $stmt->fetch();
    if ($exists) {
        echo "Admin already exists.\n";
        exit;
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare('INSERT INTO admins (username, email, password_hash, active) VALUES (:u,:e,:p,TRUE)');
    $stmt->execute([':u' => $username, ':e' => $email, ':p' => $hash]);
    echo "Admin created successfully.\n";
} catch (Throwable $e) {
    http_response_code(500);
    echo 'Error: ' . $e->getMessage();
}
