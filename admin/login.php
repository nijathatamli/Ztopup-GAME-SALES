<?php
require __DIR__ . '/config.php';

if (isset($_SESSION['admin_id'])) {
    redirect('/admin/index.php');
}

$error = '';
if (is_post()) {
    csrf_check();
    $identifier = trim($_POST['identifier'] ?? '');
    $password = $_POST['password'] ?? '';

    if ($identifier === '' || $password === '') {
        $error = 'Email və ya istifadəçi adı və şifrə tələb olunur';
    } else {
        $stmt = $pdo->prepare('SELECT id, username, email, password_hash FROM admins WHERE (LOWER(email)=LOWER(:id) OR LOWER(username)=LOWER(:id)) AND active=TRUE LIMIT 1');
        $stmt->execute([':id' => $identifier]);
        $admin = $stmt->fetch();
        if (!$admin || !password_verify($password, $admin['password_hash'])) {
            $error = 'Giriş məlumatları səhvdir';
        } else {
            $_SESSION['admin_id'] = (int)$admin['id'];
            $_SESSION['last_activity'] = time();
            $pdo->prepare('UPDATE admins SET last_login_at = NOW() WHERE id = :id')->execute([':id' => $admin['id']]);
            redirect('/admin/index.php');
        }
    }
}
?>
<!doctype html>
<html lang="az">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Giriş • ZTOPUP</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Rajdhani:wght@500;700&display=swap" rel="stylesheet">
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}
    .card{width:100%;max-width:420px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);padding:24px}
    h1{font-family:Orbitron,sans-serif;font-size:22px;margin:0 0 16px}
    label{display:block;font-size:13px;color:#c9c9d1;margin:10px 0 6px}
    input{width:100%;background:#141427;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:10px 12px;outline:none}
    button{width:100%;margin-top:16px;background:#6c4df4;border:none;color:#fff;padding:12px 14px;border-radius:12px;font-weight:800;letter-spacing:.06em;cursor:pointer}
    .error{margin-top:10px;background:rgba(255,99,71,.1);border:1px solid rgba(255,99,71,.3);padding:10px;border-radius:10px;color:#ffb3a7}
  </style>
</head>
<body>
  <div class="card">
    <h1>Admin Giriş</h1>
    <?php if ($error): ?><div class="error"><?= e($error) ?></div><?php endif; ?>
    <form method="post" autocomplete="on">
      <?= csrf_field() ?>
      <label for="identifier">Email və ya İstifadəçi Adı</label>
      <input type="text" id="identifier" name="identifier" required />

      <label for="password">Şifrə</label>
      <input type="password" id="password" name="password" required />

      <button type="submit">Daxil ol</button>
    </form>
  </div>
</body>
</html>
