<?php
require __DIR__ . '/_auth.php';
require_admin();

// Quick stats from PostgreSQL
$stats = [
    'total_users' => 0,
    'total_orders' => 0,
    'pending_bal' => 0,
    'pending_avatar' => 0,
    'pending_deposit' => 0,
    'revenue' => '0.00',
];

try {
    $stats['total_users'] = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    $stats['total_orders'] = (int)$pdo->query('SELECT COUNT(*) FROM orders')->fetchColumn();
    $stats['pending_bal'] = (int)$pdo->query("SELECT COUNT(*) FROM balance_requests WHERE LOWER(status)='pending'")->fetchColumn();
    $stats['pending_avatar'] = (int)$pdo->query("SELECT COUNT(*) FROM avatar_requests WHERE LOWER(status)='pending'")->fetchColumn();
    $stats['pending_deposit'] = (int)$pdo->query("SELECT COUNT(*) FROM deposit_requests WHERE LOWER(status)='pending'")->fetchColumn();
    $stats['revenue'] = (string)($pdo->query("SELECT COALESCE(TO_CHAR(SUM(CASE WHEN LOWER(type)='credit' THEN amount ELSE 0 END), 'FM999999990.00'), '0.00') FROM transactions")->fetchColumn() ?: '0.00');
} catch (Throwable $e) {
    // leave defaults
}
?>
<!doctype html>
<html lang="az">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Panel • ZTOPUP</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Rajdhani:wght@500;700&display=swap" rel="stylesheet">
  <style>
    body{margin:0;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}
    header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
    .brand{font-family:Orbitron,sans-serif;font-weight:800;letter-spacing:.12em}
    .grid{display:grid;gap:14px;padding:18px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
    .card{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);padding:16px}
    .stat{font-family:Orbitron,sans-serif;font-size:28px;font-weight:800}
    nav a{color:#c9c9d1;text-decoration:none;margin-right:14px}
  </style>
</head>
<body>
  <header>
    <div class="brand">ZTOPUP • ADMIN</div>
    <nav>
      <a href="/admin/users.php">İstifadəçilər</a>
      <a href="/admin/orders.php">Sifarişlər</a>
      <a href="/admin/products.php">Məhsullar</a>
      <a href="/admin/balance-requests.php">Balans Sorğuları</a>
      <a href="/admin/deposits.php">Depozit Sorğuları</a>
      <a href="/admin/avatars.php">Avatar Sorğuları</a>
      <a href="/admin/logout.php">Çıxış</a>
    </nav>
  </header>

  <main class="grid">
    <div class="card">
      <div>İstifadəçilər</div>
      <div class="stat"><?= $stats['total_users'] ?></div>
    </div>
    <div class="card">
      <div>Sifarişlər</div>
      <div class="stat"><?= $stats['total_orders'] ?></div>
    </div>
    <div class="card">
      <div>Gözləyən Balans</div>
      <div class="stat"><?= $stats['pending_bal'] ?></div>
    </div>
    <div class="card">
      <div>Gözləyən Avatar</div>
      <div class="stat"><?= $stats['pending_avatar'] ?></div>
    </div>
    <div class="card">
      <div>Gözləyən Depozit</div>
      <div class="stat"><?= $stats['pending_deposit'] ?></div>
    </div>
    <div class="card">
      <div>Gəlir (Yekun kreditlər)</div>
      <div class="stat">₼ <?= $stats['revenue'] ?></div>
    </div>
  </main>
</body>
</html>
