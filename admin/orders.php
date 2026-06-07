<?php
require __DIR__ . '/_auth.php';
require_admin();

$q = trim($_GET['q'] ?? '');
$status = trim($_GET['status'] ?? '');
$params = [];
$sql = 'SELECT * FROM orders';
$conds = [];
if ($q !== '') { $conds[] = '(LOWER(user_email) LIKE :q OR LOWER(game) LIKE :q OR LOWER(package) LIKE :q OR id::text = :idq)'; $params[':q'] = '%' . strtolower($q) . '%'; $params[':idq'] = $q; }
if ($status !== '') { $conds[] = 'LOWER(status)=LOWER(:s)'; $params[':s'] = $status; }
if ($conds) { $sql .= ' WHERE ' . implode(' AND ', $conds); }
$sql .= ' ORDER BY created_at DESC LIMIT 300';
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();

$flash = '';
if (is_post()) {
    $id = $_POST['id'] ?? '';
    $newStatus = $_POST['status'] ?? '';
    if ($id && in_array($newStatus, ['pending','processing','completed','failed'], true)) {
        $pdo->prepare('UPDATE orders SET status = :s WHERE id = :id')->execute([':s' => $newStatus, ':id' => $id]);
        $flash = 'Status yeniləndi';
    }
}
?>
<!doctype html>
<html lang="az">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sifarişlər • Admin</title>
  <style>
    body{margin:0;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}
    header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
    a{color:#c9c9d1;text-decoration:none;margin-right:14px}
    .wrap{padding:18px}
    .card{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);padding:16px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px}
    input,button,select{background:#141427;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:8px 10px}
  </style>
</head>
<body>
  <header>
    <div>Admin • Sifarişlər</div>
    <nav>
      <a href="/admin/index.php">Panel</a>
      <a href="/admin/users.php">İstifadəçilər</a>
      <a href="/admin/products.php">Məhsullar</a>
      <a href="/admin/balance-requests.php">Balans</a>
      <a href="/admin/avatars.php">Avatar</a>
      <a href="/admin/logout.php">Çıxış</a>
    </nav>
  </header>
  <div class="wrap">
    <?php if ($flash): ?><div class="card" style="border-color:rgba(0,255,127,.25);color:#a3ffcf"><?= htmlspecialchars($flash, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>

    <form method="get" class="card" style="display:flex;gap:10px;align-items:center">
      <input type="text" name="q" value="<?= htmlspecialchars($q, ENT_QUOTES, 'UTF-8') ?>" placeholder="Axtar: email, oyun, paket, ID" style="flex:1" />
      <select name="status">
        <option value="">Hamısı</option>
        <?php foreach (['pending','processing','completed','failed'] as $s): ?>
          <option value="<?= $s ?>" <?= $status===$s?'selected':'' ?>><?= $s ?></option>
        <?php endforeach; ?>
      </select>
      <button type="submit">Axtar</button>
    </form>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Email</th>
            <th>Oyun</th>
            <th>Paket</th>
            <th>Qiymət</th>
            <th>Oyunçu ID</th>
            <th>Status</th>
            <th>Yenilə</th>
          </tr>
        </thead>
        <tbody>
          <?php foreach ($rows as $r): ?>
          <tr>
            <td><?= htmlspecialchars($r['id'], ENT_QUOTES, 'UTF-8') ?></td>
            <td><?= htmlspecialchars($r['user_email'], ENT_QUOTES, 'UTF-8') ?></td>
            <td><?= htmlspecialchars($r['game'], ENT_QUOTES, 'UTF-8') ?></td>
            <td><?= htmlspecialchars($r['package'], ENT_QUOTES, 'UTF-8') ?></td>
            <td>₼ <?= number_format((float)$r['price'], 2) ?></td>
            <td><?= htmlspecialchars($r['player_id'], ENT_QUOTES, 'UTF-8') ?></td>
            <td><?= htmlspecialchars($r['status'], ENT_QUOTES, 'UTF-8') ?></td>
            <td>
              <form method="post" style="display:flex;gap:6px;align-items:center">
                <input type="hidden" name="id" value="<?= htmlspecialchars($r['id'], ENT_QUOTES, 'UTF-8') ?>" />
                <select name="status">
                  <?php foreach (['pending','processing','completed','failed'] as $s): ?>
                    <option value="<?= $s ?>" <?= strtolower($r['status'])===$s?'selected':'' ?>><?= $s ?></option>
                  <?php endforeach; ?>
                </select>
                <button type="submit">Saxla</button>
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
