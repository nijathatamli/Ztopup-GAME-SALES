<?php
require __DIR__ . '/_auth.php';
require_admin();

$q = trim($_GET['q'] ?? '');
$params = [];
$sql = 'SELECT id, username, email, first_name, last_name, balance, created_at FROM users';
if ($q !== '') {
    $sql .= ' WHERE LOWER(username) LIKE :q OR LOWER(email) LIKE :q OR id::text = :idq';
    $params[':q'] = '%' . strtolower($q) . '%';
    $params[':idq'] = $q;
}
$sql .= ' ORDER BY created_at DESC LIMIT 200';
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$users = $stmt->fetchAll();

$flash = '';
if (is_post()) {
    csrf_check();
    $userId = $_POST['user_id'] ?? '';
    $amount = (float)($_POST['amount'] ?? '0');
    $reason = trim($_POST['reason'] ?? 'Admin adjustment');
    if ($userId !== '' && $amount !== 0.0) {
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE users SET balance = balance + :amt WHERE id = :id')->execute([':amt' => $amount, ':id' => $userId]);
            $tid = bin2hex(random_bytes(16));
            $pdo->prepare('INSERT INTO transactions (id, user_id, amount, type, status, ref) VALUES (:id,:uid,:amt,:type,:status,:ref)')->execute([
                ':id' => $tid,
                ':uid' => $userId,
                ':amt' => abs($amount),
                ':type' => $amount > 0 ? 'credit' : 'debit',
                ':status' => 'approved',
                ':ref' => $reason,
            ]);
            $pdo->commit();
            $flash = 'Balans yeniləndi';
        } catch (Throwable $e) {
            $pdo->rollBack();
            $flash = 'Xəta baş verdi: ' . $e->getMessage();
        }
    }
}
?>
<!doctype html>
<html lang="az">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>İstifadəçilər • Admin</title>
  <style>
    body{margin:0;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}
    header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
    a{color:#c9c9d1;text-decoration:none;margin-right:14px}
    .wrap{padding:18px}
    .card{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);padding:16px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px}
    input,button{background:#141427;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:8px 10px}
  </style>
</head>
<body>
  <header>
    <div>Admin • İstifadəçilər</div>
    <nav>
      <a href="/admin/index.php">Panel</a>
      <a href="/admin/orders.php">Sifarişlər</a>
      <a href="/admin/products.php">Məhsullar</a>
      <a href="/admin/balance-requests.php">Balans</a>
      <a href="/admin/deposits.php">Depozitlər</a>
      <a href="/admin/avatars.php">Avatar</a>
      <a href="/admin/logout.php">Çıxış</a>
    </nav>
  </header>
  <div class="wrap">
    <form method="get" class="card">
      <input type="text" name="q" value="<?= e($q) ?>" placeholder="Axtarış: username, email və ya ID" style="width:100%" />
    </form>

    <?php if ($flash): ?><div class="card" style="border-color:rgba(0,255,127,.25);color:#a3ffcf"><?= e($flash) ?></div><?php endif; ?>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Username</th>
            <th>Email</th>
            <th>Ad</th>
            <th>Balans</th>
            <th>Tarix</th>
            <th>Balans Dəyişikliyi</th>
          </tr>
        </thead>
        <tbody>
          <?php foreach ($users as $u): ?>
          <tr>
            <td><?= e($u['id']) ?></td>
            <td><?= e($u['username']) ?></td>
            <td><?= e($u['email']) ?></td>
            <td><?= e(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? '')) ?></td>
            <td>₼ <?= number_format((float)$u['balance'], 2) ?></td>
            <td><?= e($u['created_at']) ?></td>
            <td>
              <form method="post" style="display:flex;gap:8px;align-items:center">
                <?= csrf_field() ?>
                <input type="hidden" name="user_id" value="<?= e($u['id']) ?>" />
                <input type="number" step="0.01" name="amount" placeholder="Məbləğ (+/-)" />
                <input type="text" name="reason" placeholder="Qeyd" />
                <button type="submit">Yenilə</button>
              </form>
            </td>
          </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>
