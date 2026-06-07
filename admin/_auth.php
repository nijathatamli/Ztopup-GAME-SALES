<?php
require __DIR__ . '/config.php';

function require_admin(): void {
    if (!isset($_SESSION['admin_id'])) {
        redirect('/admin/login.php');
    }
    // session timeout
    if (!isset($_SESSION['last_activity'])) {
        $_SESSION['last_activity'] = time();
    } else {
        if (time() - (int)$_SESSION['last_activity'] > SESSION_TIMEOUT) {
            session_unset();
            session_destroy();
            redirect('/admin/login.php');
        }
    }
    $_SESSION['last_activity'] = time();
}
