/**
 * ZTopUp Global Header Component
 * Include this script on any public page to render the shared header.
 *
 * <script src="/header.js" defer></script>
 */
(function () {
  'use strict';

  /* =====================================================================
     CONFIGURATION
     ===================================================================== */
  const CONFIG = {
    brand: {
      name: 'ZELIX TOPUP',
      home: '/',
    },
    nav: [
      { id: 'home', label: 'Home', icon: '⌂', href: '/' },
      { id: 'profile', label: 'Profile', icon: '👤', href: '/profile.html' },
      { id: 'products', label: 'Products', icon: '▣', href: '/mehsullar.html' },
      { id: 'faq', label: 'FAQ', icon: '◈', href: '/faq.html' },
    ],
    loginPage: '/login-v2.html',
    profilePage: '/profile.html',
  };

  /* =====================================================================
     HEADER STYLES
     ===================================================================== */
  const HEADER_STYLES = `
    .ztopup-header {
      --z-gold: #ffb300;
      --z-purple: #8a2eff;
      --z-blue: #00c8ff;
      --z-black: #050505;
      --z-muted: rgba(255,255,255,0.62);
      --z-line: 1px solid rgba(255,255,255,0.09);
      --z-gold-glow: 0 0 18px rgba(255,179,0,0.45);
      --z-blue-glow: 0 0 26px rgba(0,200,255,0.42);
    }
    .ztopup-header .header {
      position: sticky;
      top: 0;
      z-index: 40;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 22px;
      padding: 18px clamp(18px, 4vw, 64px);
      border-bottom: var(--z-line);
      background: rgba(5,5,5,0.72);
      backdrop-filter: blur(22px);
    }
    .ztopup-header .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: max-content;
      text-decoration: none;
    }
    .ztopup-header .logo-mark {
      width: 46px; height: 46px; border-radius: 15px;
      display: grid; place-items: center;
      position: relative;
      overflow: hidden;
      color: #070400;
      font-family: 'Orbitron', sans-serif;
      font-size: 25px;
      font-weight: 900;
      background: linear-gradient(135deg, #ffe08a 0%, var(--z-gold) 45%, #ff7a00 100%);
      box-shadow: var(--z-gold-glow), 0 0 32px rgba(255,179,0,0.26);
    }
    .ztopup-header .logo-mark img {
      width: 145%; height: 145%;
      object-fit: cover;
      border-radius: inherit;
      display: block;
      filter: drop-shadow(0 0 10px rgba(255,179,0,.55));
    }
    .ztopup-header .logo-mark::after {
      content: "";
      position: absolute;
      inset: -40%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent);
      transform: rotate(35deg) translateX(-70%);
      animation: ztopup-shine 4.8s ease-in-out infinite;
    }
    @keyframes ztopup-shine { 50%, 100% { transform: rotate(35deg) translateX(90%); } }
    .ztopup-header .brand {
      color: var(--z-gold);
      font-size: 19px;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-shadow: 0 0 16px rgba(255,179,0,.4);
      font-family: 'Orbitron', 'Rajdhani', sans-serif;
    }
    .ztopup-header .header-actions {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .ztopup-header .nav {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px;
      border: var(--z-line);
      border-radius: 999px;
      background: rgba(17,17,26,.7);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
    }
    .ztopup-header .navbtn {
      border: 0;
      border-radius: 999px;
      padding: 10px 14px;
      background: transparent;
      color: rgba(255,255,255,.72);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.05em;
      cursor: pointer;
      transition: 0.22s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      font-family: 'Orbitron', 'Rajdhani', sans-serif;
    }
    .ztopup-header .navbtn.active,
    .ztopup-header .navbtn:hover {
      background: linear-gradient(135deg, var(--z-gold), #ff8c00);
      color: #120a00;
      box-shadow: var(--z-gold-glow);
    }
    .ztopup-header .login {
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(255,179,0,.48);
      border-radius: 10px;
      padding: 11px 17px;
      color: var(--z-gold);
      background: linear-gradient(180deg, rgba(255,179,0,.14), rgba(255,179,0,.05));
      box-shadow: 0 0 22px rgba(255,179,0,.12);
      cursor: pointer;
      transition: 0.22s ease;
      font-family: 'Rajdhani', sans-serif;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
    }
    .ztopup-header .login:hover {
      transform: translateY(-1px);
      box-shadow: var(--z-gold-glow);
    }
    .ztopup-header .login svg { width: 17px; height: 17px; }
    .ztopup-header .user-chip {
      display: none;
      align-items: center;
      gap: 10px;
      border: 1px solid rgba(0,200,255,.32);
      border-radius: 999px;
      padding: 7px 10px 7px 7px;
      background: rgba(0,200,255,.08);
      color: #fff;
      font-family: 'Rajdhani', sans-serif;
      font-weight: 800;
      box-shadow: var(--z-blue-glow);
    }
    .ztopup-header .user-avatar {
      width: 30px; height: 30px; border-radius: 50%;
      display: grid; place-items: center;
      background: linear-gradient(135deg, var(--z-blue), var(--z-purple));
      color: #02020a;
      font-size: 13px;
      font-weight: 800;
    }
    .ztopup-header .logout {
      border: 0;
      color: var(--z-gold);
      background: transparent;
      cursor: pointer;
      font-weight: 800;
      font-family: 'Rajdhani', sans-serif;
      font-size: 14px;
    }
    @media (max-width: 980px) {
      .ztopup-header .header { flex-wrap: wrap; }
      .ztopup-header .header-actions { width: 100%; justify-content: space-between; }
    }
    @media (max-width: 620px) {
      .ztopup-header .header { padding: 14px 16px; }
      .ztopup-header .logo-mark { width: 40px; height: 40px; font-size: 22px; border-radius: 13px; }
      .ztopup-header .brand { font-size: 14px; }
      .ztopup-header .header-actions { width: auto; }
      .ztopup-header .login { padding: 9px 12px; font-size: 14px; }
      .ztopup-header .nav {
        position: fixed;
        left: 12px; right: 12px; bottom: 12px;
        z-index: 60;
        justify-content: space-between;
        background: rgba(9,9,14,.86);
        backdrop-filter: blur(20px);
      }
      .ztopup-header .navbtn {
        padding: 10px 9px;
        font-size: 11px;
        min-width: 0;
        flex: 1;
        justify-content: center;
      }
    }
  `;

  /* =====================================================================
     HTML TEMPLATE
     ===================================================================== */
  function buildHeaderHTML() {
    const path = window.location.pathname;
    const navItems = CONFIG.nav
      .map((n) => {
        const isActive = n.href === path || (n.href !== '/' && path.startsWith(n.href));
        return `<a href="${n.href}" class="navbtn ${isActive ? 'active' : ''}"><span>${n.icon}</span> ${n.label}</a>`;
      })
      .join('');

    return `
      <div class="ztopup-header">
        <header class="header">
          <a href="${CONFIG.brand.home}" class="logo">
            <div class="logo-mark"><img src="assets/zelix-generated-logo.svg" alt="ZELIX TOPUP logo"></div>
            <div class="brand">${CONFIG.brand.name}</div>
          </a>
          <div class="header-actions">
            <nav class="nav" aria-label="Əsas naviqasiya">
              ${navItems}
            </nav>
            <a href="${CONFIG.loginPage}" class="login" id="ztopupLoginBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>
              Login
            </a>
            <div class="user-chip" id="ztopupUserChip">
              <span class="user-avatar" id="ztopupUserAvatar">Z</span>
              <span id="ztopupUserName">User</span>
              <button class="logout" id="ztopupLogoutBtn">Çıxış</button>
            </div>
          </div>
        </header>
      </div>
    `;
  }

  /* =====================================================================
     AUTH LOGIC
     ===================================================================== */
  async function restoreSession() {
    const token = localStorage.getItem('zelixToken');
    if (!token) {
      setAuthUser(null);
      return;
    }
    try {
      const response = await fetch('/api/me', {
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Session expired');
      const result = await response.json();
      setAuthUser(result.user);
    } catch {
      localStorage.removeItem('zelixToken');
      localStorage.removeItem('zelixUser');
      setAuthUser(null);
    }
  }

  function setAuthUser(user) {
    const loginBtn = document.getElementById('ztopupLoginBtn');
    const userChip = document.getElementById('ztopupUserChip');
    const userName = document.getElementById('ztopupUserName');
    const userAvatar = document.getElementById('ztopupUserAvatar');
    if (!loginBtn || !userChip) return;

    if (user) {
      loginBtn.style.display = 'none';
      userChip.style.display = 'flex';
      userName.textContent = user.first_name || user.name || user.username || 'User';
      userAvatar.textContent = ((user.first_name || user.name || user.username || 'U').charAt(0)).toUpperCase();
    } else {
      loginBtn.style.display = 'flex';
      userChip.style.display = 'none';
    }
  }

  async function logout() {
    const token = localStorage.getItem('zelixToken');
    try {
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: '{}',
      });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem('zelixToken');
      localStorage.removeItem('zelixUser');
      setAuthUser(null);
    }
  }

  /* =====================================================================
     INJECT HEADER + STYLES
     ===================================================================== */
  function init() {
    if (document.querySelector('.ztopup-header')) return;

    const styleEl = document.createElement('style');
    styleEl.textContent = HEADER_STYLES;
    document.head.appendChild(styleEl);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildHeaderHTML();
    const header = wrapper.firstElementChild;

    // Insert at the very start of <body>, after particles if present
    const particles = document.querySelector('.particles');
    if (particles && particles.nextElementSibling) {
      document.body.insertBefore(header, particles.nextElementSibling);
    } else {
      document.body.insertBefore(header, document.body.firstChild);
    }

    // Bind logout
    const logoutBtn = document.getElementById('ztopupLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
    }

    // Restore session
    restoreSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
