<?php
require __DIR__ . '/_auth.php';
require_admin();

$flash = '';
if (is_post()) {
    csrf_check();
    $action = $_POST['action'] ?? '';
    try {
        if ($action === 'create') {
            $id = bin2hex(random_bytes(16));
            $stmt = $pdo->prepare('INSERT INTO products (id, game, title, price, image_url, available, delivery_minutes, stock) VALUES (:id,:game,:title,:price,:image,:avail,:min,:stock)');
            $stmt->execute([
                ':id' => $id,
                ':game' => trim($_POST['game'] ?? ''),
                ':title' => trim($_POST['title'] ?? ''),
                ':price' => (float)($_POST['price'] ?? '0'),
                ':image' => trim($_POST['image_url'] ?? ''),
                ':avail' => isset($_POST['available']) ? true : false,
                ':min' => (int)($_POST['delivery_minutes'] ?? '5'),
                ':stock' => (int)($_POST['stock'] ?? '0')
            ]);
            $flash = 'Məhsul əlavə edildi';
        } elseif ($action === 'update') {
            $id = $_POST['id'] ?? '';
            $stmt = $pdo->prepare('UPDATE products SET game=:game, title=:title, price=:price, image_url=:image, available=:avail, delivery_minutes=:min, stock=:stock WHERE id=:id');
            $stmt->execute([
                ':id' => $id,
                ':game' => trim($_POST['game'] ?? ''),
                ':title' => trim($_POST['title'] ?? ''),
                ':price' => (float)($_POST['price'] ?? '0'),
                ':image' => trim($_POST['image_url'] ?? ''),
                ':avail' => isset($_POST['available']) ? true : false,
                ':min' => (int)($_POST['delivery_minutes'] ?? '5'),
                ':stock' => (int)($_POST['stock'] ?? '0')
            ]);
            $flash = 'Məhsul yeniləndi';
        } elseif ($action === 'delete') {
            $id = $_POST['id'] ?? '';
            $pdo->prepare('DELETE FROM products WHERE id=:id')->execute([':id' => $id]);
            $flash = 'Məhsul silindi';
        }
    } catch (Throwable $e) {
        $flash = 'Xəta: ' . $e->getMessage();
    }
}

$rows = $pdo->query('SELECT * FROM products ORDER BY created_at DESC')->fetchAll();
?>
<!doctype html>
<html lang="az">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Məhsullar • Admin</title>
  <style>
    body{margin:0;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}
    header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
    a{color:#c9c9d1;text-decoration:none;margin-right:14px}
    .wrap{padding:18px}
    .card{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);padding:16px;margin-bottom:16px}
    input,button{background:#141427;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:8px 10px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px}
  </style>
</head>
<body>
  <header>
    <div>Admin • Məhsullar</div>
    <nav>
      <a href="/admin/index.php">Panel</a>
      <a href="/admin/users.php">İstifadəçilər</a>
      <a href="/admin/orders.php">Sifarişlər</a>
      <a href="/admin/balance-requests.php">Balans</a>
      <a href="/admin/avatars.php">Avatar</a>
      <a href="/admin/logout.php">Çıxış</a>
    </nav>
  </header>
  <div class="wrap">
    <?php if ($flash): ?><div class="card" style="border-color:rgba(0,255,127,.25);color:#a3ffcf"><?= htmlspecialchars($flash, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>

    <div class="card">
      <form method="post" style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="create" />
        <input type="text" name="game" placeholder="Oyun" required />
        <input type="text" name="title" placeholder="Başlıq" required />
        <input type="number" step="0.01" name="price" placeholder="Qiymət" required />
        <input type="text" name="image_url" placeholder="Şəkil linki" />
        <label><input type="checkbox" name="available" checked /> Mövcud</label>
        <input type="number" name="delivery_minutes" placeholder="Çatdırılma (dəq)" value="5" />
        <input type="number" name="stock" placeholder="Anbar say" value="0" />
        <button type="submit">Yeni məhsul</button>
      </form>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Oyun</th>
            <th>Başlıq</th>
            <th>Qiymət</th>
            <th>Mövcud</th>
            <th>Anbar</th>
            <th>Əməliyyat</th>
          </tr>
        </thead>
        <tbody>
          <?php foreach ($rows as $r): ?>
          <tr>
            <td><?= htmlspecialchars($r['id'], ENT_QUOTES, 'UTF-8') ?></td>
            <td><?= htmlspecialchars($r['game'], ENT_QUOTES, 'UTF-8') ?></td>
            <td><?= htmlspecialchars($r['title'], ENT_QUOTES, 'UTF-8') ?></td>
            <td>₼ <?= number_format((float)$r['price'], 2) ?></td>
            <td><?= $r['available'] ? 'Bəli' : 'Xeyr' ?></td>
            <td><?= (int)($r['stock'] ?? 0) ?></td>
            <td>
              <form method="post" style="display:flex;gap:6px;flex-wrap:wrap">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="update" />
                <input type="hidden" name="id" value="<?= htmlspecialchars($r['id'], ENT_QUOTES, 'UTF-8') ?>" />
                <input type="text" name="game" value="<?= htmlspecialchars($r['game'], ENT_QUOTES, 'UTF-8') ?>" />
                <input type="text" name="title" value="<?= htmlspecialchars($r['title'], ENT_QUOTES, 'UTF-8') ?>" />
                <input type="number" step="0.01" name="price" value="<?= htmlspecialchars((string)$r['price'], ENT_QUOTES, 'UTF-8') ?>" />
                <input type="text" name="image_url" value="<?= htmlspecialchars($r['image_url'] ?? '', ENT_QUOTES, 'UTF-8') ?>" />
                <label><input type="checkbox" name="available" <?= $r['available'] ? 'checked' : '' ?> /> Mövcud</label>
                <input type="number" name="delivery_minutes" value="<?= (int)($r['delivery_minutes'] ?? 5) ?>" />
                <input type="number" name="stock" value="<?= (int)($r['stock'] ?? 0) ?>" />
                <button type="submit">Saxla</button>
              </form>
              <form method="post" onsubmit="return confirm('Silinsin?')">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="delete" />
                <input type="hidden" name="id" value="<?= htmlspecialchars($r['id'], ENT_QUOTES, 'UTF-8') ?>" />
                <button type="submit">Sil</button>
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
