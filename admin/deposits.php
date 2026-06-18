<?php
require __DIR__ . '/_auth.php';
require_admin();

$flash = '';
$flashType = 'ok';

if (is_post()) {
    csrf_check();
    $id = (string)($_POST['id'] ?? '');
    $action = (string)($_POST['action'] ?? '');
    $note = trim((string)($_POST['note'] ?? ''));

    if ($id !== '' && in_array($action, ['approve', 'reject'], true)) {
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('SELECT * FROM deposit_requests WHERE id = :id LIMIT 1 FOR UPDATE');
            $stmt->execute([':id' => $id]);
            $req = $stmt->fetch();

            if (!$req) {
                throw new RuntimeException('Sorğu tapılmadı');
            }
            if (strtolower((string)$req['status']) !== 'pending') {
                throw new RuntimeException('Bu sorğu artıq emal edilib');
            }

            if ($action === 'approve') {
                $amount = round((float)($_POST['amount'] ?? 0), 2);
                if (!is_finite($amount) || $amount <= 0) {
                    throw new RuntimeException('Düzgün məbləğ daxil edin');
                }

                // Increase user's balance
                $pdo->prepare('UPDATE users SET balance = balance + :amt WHERE id = :uid')
                    ->execute([':amt' => $amount, ':uid' => $req['user_id']]);

                // Update deposit request
                $pdo->prepare("UPDATE deposit_requests SET status='approved', approved_at=NOW(), admin_note=:note WHERE id=:id")
                    ->execute([':note' => ($note !== '' ? $note : null), ':id' => $id]);

                // Log a transaction
                $tid = bin2hex(random_bytes(16));
                $pdo->prepare('INSERT INTO transactions (id, user_id, amount, type, status, ref) VALUES (:id,:uid,:amt,:type,:status,:ref)')
                    ->execute([
                        ':id' => $tid,
                        ':uid' => $req['user_id'],
                        ':amt' => $amount,
                        ':type' => 'credit',
                        ':status' => 'approved',
                        ':ref' => 'Deposit approved by admin (request ' . $req['id'] . ')',
                    ]);

                $flash = 'Depozit təsdiqləndi və ' . number_format($amount, 2) . ' ₼ balansa əlavə olundu';
            } else { // reject
                $pdo->prepare("UPDATE deposit_requests SET status='rejected', approved_at=NOW(), admin_note=:note WHERE id=:id")
                    ->execute([':note' => ($note !== '' ? $note : null), ':id' => $id]);
                $flash = 'Depozit sorğusu rədd edildi';
            }

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            $flashType = 'bad';
            $flash = 'Xəta: ' . $e->getMessage();
        }
    }
}

$status = trim((string)($_GET['status'] ?? 'pending'));
$params = [];
$sql = 'SELECT d.*, u.username, u.email FROM deposit_requests d LEFT JOIN users u ON u.id = d.user_id';
if ($status !== '') {
    $sql .= ' WHERE LOWER(d.status) = LOWER(:s)';
    $params[':s'] = $status;
}
$sql .= ' ORDER BY d.created_at DESC LIMIT 300';
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();
?>
<!doctype html>
<html lang="az">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Depozit Sorğuları • Admin</title>
  <style>
    body{margin:0;background:#0b0b12;color:#fff;font-family:Rajdhani,system-ui}
    header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
    a{color:#c9c9d1;text-decoration:none;margin-right:14px}
    .wrap{padding:18px}
    .card{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);padding:16px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px;vertical-align:top}
    input,button,select,textarea{background:#141427;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:10px;padding:8px 10px;font-family:inherit}
    button{cursor:pointer}
    .thumb{width:84px;height:84px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.12);cursor:zoom-in}
    .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}
    .b-pending{background:rgba(255,193,7,.12);color:#ffd24d;border:1px solid rgba(255,193,7,.3)}
    .b-approved{background:rgba(0,255,127,.12);color:#a3ffcf;border:1px solid rgba(0,255,127,.3)}
    .b-rejected{background:rgba(255,99,71,.12);color:#ffb3a7;border:1px solid rgba(255,99,71,.3)}
    .btn-approve{background:#1f8b4c;border-color:#27ae60}
    .btn-reject{background:#8b2e2e;border-color:#c0392b}
    .actions{display:flex;gap:6px;flex-wrap:wrap}
    dialog{background:#12121d;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:18px;width:min(420px,92vw)}
    dialog::backdrop{background:rgba(0,0,0,.6)}
    dialog h3{margin:0 0 12px;font-family:Orbitron,sans-serif}
    dialog label{display:block;font-size:13px;color:#c9c9d1;margin:10px 0 6px}
    dialog input,dialog textarea{width:100%;box-sizing:border-box}
    .row-end{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
    #imgModal img{max-width:100%;max-height:70vh;border-radius:10px}
  </style>
</head>
<body>
  <header>
    <div>Admin • Depozit Sorğuları</div>
    <nav>
      <a href="/admin/index.php">Panel</a>
      <a href="/admin/users.php">İstifadəçilər</a>
      <a href="/admin/orders.php">Sifarişlər</a>
      <a href="/admin/products.php">Məhsullar</a>
      <a href="/admin/balance-requests.php">Balans</a>
      <a href="/admin/avatars.php">Avatar</a>
      <a href="/admin/logout.php">Çıxış</a>
    </nav>
  </header>
  <div class="wrap">
    <?php if ($flash): ?>
      <div class="card" style="border-color:<?= $flashType==='bad'?'rgba(255,99,71,.35)':'rgba(0,255,127,.25)' ?>;color:<?= $flashType==='bad'?'#ffb3a7':'#a3ffcf' ?>"><?= e($flash) ?></div>
    <?php endif; ?>

    <form method="get" class="card" style="display:flex;gap:10px;align-items:center">
      <label>Status:</label>
      <select name="status">
        <option value="" <?= $status===''?'selected':'' ?>>Hamısı</option>
        <option value="pending" <?= $status==='pending'?'selected':'' ?>>Gözləmədə</option>
        <option value="approved" <?= $status==='approved'?'selected':'' ?>>Təsdiqlənmiş</option>
        <option value="rejected" <?= $status==='rejected'?'selected':'' ?>>Rədd edilmiş</option>
      </select>
      <button type="submit">Filtrlə</button>
    </form>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>İstifadəçi</th>
            <th>Email</th>
            <th>Qəbz</th>
            <th>İstənilən Məbləğ</th>
            <th>Status</th>
            <th>Tarix</th>
            <th>Qeyd</th>
            <th>Əməliyyat</th>
          </tr>
        </thead>
        <tbody>
          <?php if (!$rows): ?>
            <tr><td colspan="9" style="color:#9a9aa6">Sorğu yoxdur.</td></tr>
          <?php endif; ?>
          <?php foreach ($rows as $r): ?>
            <?php $st = strtolower((string)$r['status']); $imgSrc = '/admin/receipt.php?file=' . rawurlencode((string)$r['receipt_image']); ?>
            <tr>
              <td style="font-size:12px;color:#9a9aa6"><?= e(substr((string)$r['id'], 0, 8)) ?></td>
              <td><?= e((string)($r['username'] ?? '—')) ?></td>
              <td><?= e((string)($r['email'] ?? '—')) ?></td>
              <td><img class="thumb" src="<?= e($imgSrc) ?>" alt="qəbz" onclick="viewImg('<?= e($imgSrc) ?>')" /></td>
              <td>₼ <?= number_format((float)$r['requested_amount'], 2) ?></td>
              <td>
                <span class="badge <?= $st==='approved'?'b-approved':($st==='rejected'?'b-rejected':'b-pending') ?>"><?= e((string)$r['status']) ?></span>
              </td>
              <td style="font-size:12px"><?= e(substr((string)$r['created_at'], 0, 19)) ?></td>
              <td style="max-width:180px;font-size:12px;color:#c9c9d1"><?= e((string)($r['admin_note'] ?? '')) ?></td>
              <td>
                <?php if ($st === 'pending'): ?>
                  <div class="actions">
                    <button class="btn-approve" type="button"
                      onclick="openApprove('<?= e((string)$r['id']) ?>', '<?= e((string)($r['username'] ?? '')) ?>', '<?= e(number_format((float)$r['requested_amount'], 2, '.', '')) ?>')">Təsdiqlə</button>
                    <button class="btn-reject" type="button"
                      onclick="openReject('<?= e((string)$r['id']) ?>')">Rədd et</button>
                  </div>
                <?php else: ?>
                  <span style="color:#9a9aa6">—</span>
                <?php endif; ?>
              </td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Approve modal -->
  <dialog id="approveModal">
    <form method="post">
      <h3>Depoziti Təsdiqlə</h3>
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="approve" />
      <input type="hidden" name="id" id="approveId" />
      <div style="font-size:13px;color:#9a9aa6">İstifadəçi: <span id="approveUser"></span></div>
      <label>Balansa əlavə olunacaq məbləğ (₼)</label>
      <input type="number" step="0.01" min="0.01" name="amount" id="approveAmount" required />
      <label>Qeyd (istəyə bağlı)</label>
      <textarea name="note" rows="2" placeholder="Admin qeydi"></textarea>
      <div class="row-end">
        <button type="button" onclick="document.getElementById('approveModal').close()">Ləğv et</button>
        <button class="btn-approve" type="submit">Təsdiqlə</button>
      </div>
    </form>
  </dialog>

  <!-- Reject modal -->
  <dialog id="rejectModal">
    <form method="post">
      <h3>Depoziti Rədd et</h3>
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="reject" />
      <input type="hidden" name="id" id="rejectId" />
      <label>Rədd səbəbi (istəyə bağlı)</label>
      <textarea name="note" rows="3" placeholder="Müştəri bu səbəbi profilində görəcək"></textarea>
      <div class="row-end">
        <button type="button" onclick="document.getElementById('rejectModal').close()">Ləğv et</button>
        <button class="btn-reject" type="submit">Rədd et</button>
      </div>
    </form>
  </dialog>

  <!-- Image viewer -->
  <dialog id="imgModal">
    <img id="imgModalSrc" src="" alt="qəbz" />
    <div class="row-end"><button type="button" onclick="document.getElementById('imgModal').close()">Bağla</button></div>
  </dialog>

  <script>
    function openApprove(id, user, amount){
      document.getElementById('approveId').value = id;
      document.getElementById('approveUser').textContent = user || '—';
      var a = document.getElementById('approveAmount');
      a.value = (amount && parseFloat(amount) > 0) ? amount : '';
      document.getElementById('approveModal').showModal();
    }
    function openReject(id){
      document.getElementById('rejectId').value = id;
      document.getElementById('rejectModal').showModal();
    }
    function viewImg(src){
      document.getElementById('imgModalSrc').src = src;
      document.getElementById('imgModal').showModal();
    }
  </script>
</body>
</html>
