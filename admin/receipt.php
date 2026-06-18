<?php
require __DIR__ . '/_auth.php';
require_admin();

// Securely stream a receipt image stored outside the admin docroot.
// Only the bare filename is accepted; directory traversal is rejected.
$file = (string)($_GET['file'] ?? '');

// Reject anything that is not a plain filename (no slashes, no traversal)
if ($file === '' || $file !== basename($file) || strpos($file, "\0") !== false) {
    http_response_code(400);
    exit('Etibarsız fayl adı');
}

$baseDir = realpath(UPLOADS_DIR);
$target = realpath($baseDir !== false ? $baseDir . DIRECTORY_SEPARATOR . $file : '');

// Ensure the resolved path is really inside the uploads directory
if ($baseDir === false || $target === false || strncmp($target, $baseDir . DIRECTORY_SEPARATOR, strlen($baseDir) + 1) !== 0) {
    http_response_code(404);
    exit('Tapılmadı');
}

if (!is_file($target)) {
    http_response_code(404);
    exit('Tapılmadı');
}

// Validate the real MIME type, never trust the extension alone
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime = (string)$finfo->file($target);
$allowed = ['image/jpeg' => true, 'image/png' => true];
if (!isset($allowed[$mime])) {
    http_response_code(415);
    exit('Dəstəklənməyən fayl tipi');
}

header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($target));
header('Content-Disposition: inline; filename="' . $file . '"');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=300');
readfile($target);
