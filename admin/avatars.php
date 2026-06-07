<?php
require __DIR__ . '/_auth.php';
require_admin();

$flash = '';
if (is_post()) {
    $id = $_POST['id'] ?? '';
    $action = $_POST['action'] ?? '';
    if ($id && in_array($action, ['approve','reject'], true)) {
        $stmt = $pdo->prepare('SELECT * FROM avatar_requests WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $req = $stmt->fetch();
        if ($req) {
            if ($action === 'approve' && strtolower($req['status']) === 'pending') {
                $pdo->prepare("UPDATE avatar_requests SET status='approved', approved_by=:admin, approved_at=NOW() WHERE id=:id")
                    ->execute([':admin' => (string)($_SESSION['admin_id'] ?? ''), ':id' => $id]);
                $pdo->prepare('UPDATE users SET profile_image_url = :img WHERE id = :uid')
                    ->execute([':img' => $req['image_url'], ':uid' => $req['user_id']]);
                $flash = 'Təsdiqləndi';
            } elseif ($action === 'reject' && strtolower($req['status']) === 'pending') {
                $pdo->prepare("UPDATE avatar_requests SET status='rejected', approved_by=:admin, approved_at=NOW() WHERE id=:id")
                    ->execute([':admin' => (string)($_SESSION['admin_id'] ?? ''), ':id' => $id]);
                $flash = 'Rədd edildi';
            }
        }
    }
}

$params = [];
$status = trim($_GET['status'] ?? 'pending');
$sql = 'SELECT * FROM avatar_requests';
if ($status) { $sql .= ' WHERE LOWER(status)=LOWER(:s)'; $params[':s'] = $status; }
$sql .= ' ORDER BY created_at DESC LIMIT 300';
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();
?>
<!doctype html>
<html lang="az">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Avatar Sorğuları • Admin</title>
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
    <div>Admin • Avatar Sorğuları</div>
    <nav>
      <a href="/admin/index.php">Panel</a>
      <a href="/admin/users.php">İstifadəçilər</a>
      <a href="/admin/orders.php">Sifarişlər</a>
      <a href="/admin/products.php">Məhsullar</a>
      <a href="/admin/balance-requests.php">Balans</a>
      <a href="/admin/logout.php">Çıxış</a>
    </nav>
  </header>
  <div class="wrap">
    <?php if ($flash): ?><div class="card" style="border-color:rgba(0,255,127,.25);color:#a3ffcf"><?= htmlspecialchars($flash, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>

    <form method="get" class="card" style="display:flex;gap:10px;align-items:center">
      <label>Status:</label>
      <select name="status">
        <option value="pending" <?= $status==='pending'?'selected':'' ?>>Gözləmədə</option>
        <option value="approved" <?= $status==='approved'?'selected':'' ?>>Təsdiqlənmiş</option>
        <option value="rejected" <?= $status==='rejected'?'selected':'' ?>>Rədd</option>
      </select>
      <button type="submit">Filtrlə</button>
    </form>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>İstifadəçi</th>
            <th>Şəkil</th>
            <th>Status</th>
            <th>Əməliyyat</th>
          </tr>
        </thead>
        <tbody>
          <?php foreach ($rows as $r): ?>
            <tr>
              <td><?= htmlspecialchars($r['id'], ENT_QUOTES, 'UTF-8') ?></td>
              <td><?= htmlspecialchars($r['user_id'], ENT_QUOTES, 'UTF-8') ?></td>
              <td><a href="<?= htmlspecialchars($r['image_url'], ENT_QUOTES, 'UTF-8') ?>" target="_blank">Bax</a></td>
              <td><?= htmlspecialchars($r['status'], ENT_QUOTES, 'UTF-8') ?></td>
              <td>
                <?php if (strtolower($r['status'])==='pending'): ?>
                <form method="post" style="display:flex;gap:6px;align-items:center">
                  <input type="hidden" name="id" value="<?= htmlspecialchars($r['id'], ENT_QUOTES, 'UTF-8') ?>" />
                  <button name="action" value="approve" type="submit">Təsdiq</button>
                  <button name="action" value="reject" type="submit">Rədd</button>
                </form>
                <?php else: ?>
                  —
                <?php endif; ?>
              </td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>
