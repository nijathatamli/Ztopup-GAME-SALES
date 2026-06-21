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
    brand: { name: 'ZELIX TOPUP', home: '/' },
    nav: [
      { id: 'home', label: 'Home', href: '/' },
      { id: 'products', label: 'Products', href: '/mehsullar.html' },
      { id: 'profile', label: 'Profile', href: '/profile.html' },
      { id: 'faq', label: 'FAQ', href: '/faq.html' },
    ],
    loginPage: '/login-v2.html',
    profilePage: '/profile.html',
    balanceTopup: '/balance/topup',
    cartPage: '/cart',
    authModal: '#authOverlay',
  };

  /* state */
  let currentUser = null;
  let state = { balance: 0, cartCount: 0, unreadCount: 0, loading: true };
  let cart = null; // full cart data
  let notifications = [];
  let sse = null;
  let openDropdown = null; // 'cart' | 'messages' | null
  const currencySymbol = '₼';

  /* =====================================================================
     ICONS (inline SVG strings)
     ===================================================================== */
  const ICONS = {
    wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M21 12h-6a2 2 0 0 0 0 4h6v-4Z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
    cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6h15l-1.5 9h-12z"/><circle cx="9" cy="20" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="20" r="1.5" fill="currentColor" stroke="none"/><path d="M6 6L5 3H2"/></svg>`,
    bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    spinner: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ztopup-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  };

  function h(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  function formatMoney(n) {
    return Number(n || 0).toLocaleString('az-AZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function timeAgo(date) {
    const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (s < 60) return 'indicə';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} dəq`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} saat`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} gün`;
    return String(date).slice(0, 10);
  }

  /* =====================================================================
     API
     ===================================================================== */
  function token() { return localStorage.getItem('zelixToken'); }
  function authHeaders() {
    const t = token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }
  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  }

  /* =====================================================================
     STATE & SSE
     ===================================================================== */
  async function loadState() {
    if (!currentUser) return;
    try {
      const [bal, cartData, nots] = await Promise.all([
        api('/api/balance'),
        api('/api/cart'),
        api('/api/notifications'),
      ]);
      state = {
        balance: bal.balance || 0,
        cartCount: cartData.cart?.count || cartData.cart?.items?.length || 0,
        unreadCount: nots.unreadCount || 0,
        loading: false,
      };
      cart = cartData.cart || { items: [], subtotal: 0, currency: 'AZN' };
      notifications = nots.notifications || [];
    } catch (e) {
      console.error('[Header] loadState error:', e);
      state.loading = false;
    }
    renderHeader();
  }

  function connectSSE() {
    if (sse || !currentUser) return;
    try {
      sse = new EventSource('/api/stream', { withCredentials: true });
      sse.addEventListener('state', (e) => {
        try {
          const data = JSON.parse(e.data);
          state.balance = data.balance ?? state.balance;
          state.cartCount = data.cartCount ?? state.cartCount;
          state.unreadCount = data.unreadCount ?? state.unreadCount;
          state.loading = false;
          renderHeader();
          if (openDropdown === 'cart') loadCart(true);
          if (openDropdown === 'messages') loadNotifications(true);
        } catch (err) { /* ignore */ }
      });
      sse.addEventListener('error', () => {
        sse.close();
        sse = null;
        setTimeout(connectSSE, 5000);
      });
    } catch (e) { console.error('[Header] SSE error:', e); }
  }

  async function loadCart(silent = false) {
    if (!currentUser) return;
    try {
      if (!silent) cart = null; // show skeleton
      const data = await api('/api/cart');
      cart = data.cart || { items: [], subtotal: 0, currency: 'AZN' };
      state.cartCount = cart.count || cart.items.length || 0;
    } catch (e) { console.error('[Header] cart error:', e); }
    renderHeader();
  }

  async function loadNotifications(silent = false) {
    if (!currentUser) return;
    try {
      if (!silent) notifications = null;
      const data = await api('/api/notifications');
      notifications = data.notifications || [];
      state.unreadCount = data.unreadCount || 0;
    } catch (e) { console.error('[Header] notifications error:', e); }
    renderHeader();
  }

  async function removeCartItem(itemId) {
    try {
      await api(`/api/cart/items/${itemId}`, { method: 'DELETE' });
      await loadCart(true);
    } catch (e) { alert(e.message); }
  }
  async function clearCart() {
    try {
      await api('/api/cart/clear', { method: 'DELETE' });
      await loadCart(true);
    } catch (e) { alert(e.message); }
  }
  async function markRead(id) {
    try {
      await api(`/api/notifications/${id}/read`, { method: 'PATCH' });
      await loadNotifications(true);
    } catch (e) { console.error(e); }
  }
  async function markAllRead() {
    try {
      await api('/api/notifications/read-all', { method: 'PATCH' });
      await loadNotifications(true);
    } catch (e) { console.error(e); }
  }
  async function deleteNotification(id) {
    try {
      await api(`/api/notifications/${id}`, { method: 'DELETE' });
      await loadNotifications(true);
    } catch (e) { console.error(e); }
  }

  /* =====================================================================
     TEMPLATES
     ===================================================================== */
  function buildHeaderHTML() {
    const path = window.location.pathname;
    const navItems = CONFIG.nav
      .map((n) => {
        const isActive = n.href === path || (n.href !== '/' && path.startsWith(n.href));
        return `<a href="${n.href}" class="navbtn ${isActive ? 'active' : ''}">${n.label}</a>`;
      })
      .join('');

    const balance = `<div class="z-balance-card ${state.loading ? 'z-loading' : ''}">
      <div class="z-balance-icon">${ICONS.wallet}</div>
      <div class="z-balance-info">
        <div class="z-balance-label">Balans</div>
        <div class="z-balance-amount">${currencySymbol}${formatMoney(state.balance)}</div>
      </div>
      <a href="${CONFIG.balanceTopup}" class="z-balance-plus" aria-label="Balansı artır">${ICONS.plus}</a>
    </div>`;

    const cartBadge = state.cartCount > 0 ? `<span class="z-badge">${state.cartCount > 99 ? '99+' : state.cartCount}</span>` : '';
    const cartDropdown = openDropdown === 'cart' ? renderCartDropdown() : '';
    const cartModule = `<div class="z-action-wrap z-cart-wrap">
      <button class="z-action-btn ${openDropdown === 'cart' ? 'z-open' : ''}" id="ztopupCartBtn" aria-label="Səbətim" aria-expanded="${openDropdown === 'cart' ? 'true' : 'false'}">
        ${ICONS.cart}
        <span class="z-btn-label">Səbət</span>
        ${cartBadge}
      </button>
      ${cartDropdown}
    </div>`;

    const msgBadge = state.unreadCount > 0 ? `<span class="z-badge z-badge-msg">${state.unreadCount > 99 ? '99+' : state.unreadCount}</span>` : '';
    const msgDropdown = openDropdown === 'messages' ? renderMessagesDropdown() : '';
    const msgModule = `<div class="z-action-wrap z-msg-wrap">
      <button class="z-action-btn ${openDropdown === 'messages' ? 'z-open' : ''}" id="ztopupMsgBtn" aria-label="Mesajlar" aria-expanded="${openDropdown === 'messages' ? 'true' : 'false'}">
        ${ICONS.bell}
        <span class="z-btn-label">Mesaj</span>
        ${msgBadge}
      </button>
      ${msgDropdown}
    </div>`;

    const userActionBar = currentUser
      ? `<div class="z-user-bar">${balance}${cartModule}${msgModule}</div>`
      : '';

    return `
      <div class="ztopup-header">
        <header class="header">
          <a href="${CONFIG.brand.home}" class="logo">
            <div class="logo-mark"><img src="assets/zelix-generated-logo.svg" alt="ZELIX TOPUP logo"></div>
            <div class="brand">${CONFIG.brand.name}</div>
          </a>
          <div class="header-actions">
            <nav class="nav" aria-label="Əsas naviqasiya">${navItems}</nav>
            <button class="login ${currentUser ? 'z-hidden' : ''}" id="ztopupLoginBtn" type="button">
              ${ICONS.user}
              <span>Login</span>
            </button>
            <div class="user-chip ${currentUser ? '' : 'z-hidden'}" id="ztopupUserChip">
              <a href="${CONFIG.profilePage}" class="user-avatar-link">
                <span class="user-avatar" id="ztopupUserAvatar">Z</span>
              </a>
              <a href="${CONFIG.profilePage}" class="user-name" id="ztopupUserName">User</a>
              <button class="logout" id="ztopupLogoutBtn">Çıxış</button>
            </div>
            ${userActionBar}
          </div>
        </header>
      </div>
    `;
  }

  function renderCartDropdown() {
    if (cart === null) {
      return `<div class="z-dropdown z-dropdown-cart"><div class="z-dropdown-header"><span>Səbətim</span><button class="z-dd-close" data-close aria-label="Bağla">${ICONS.close}</button></div><div class="z-dropdown-body z-center"><div class="z-spin-wrap">${ICONS.spinner}</div></div></div>`;
    }
    const items = cart.items || [];
    if (items.length === 0) {
      return `<div class="z-dropdown z-dropdown-cart"><div class="z-dropdown-header"><span>Səbətim</span><button class="z-dd-close" data-close aria-label="Bağla">${ICONS.close}</button></div><div class="z-dropdown-body z-center"><div class="z-empty">Səbətiniz boşdur.</div></div><div class="z-dropdown-foot"><a class="z-btn-primary" href="${CONFIG.cartPage}">Məhsullara bax</a></div></div>`;
    }
    const rows = items.map((it) => `
      <div class="z-cart-item">
        <div class="z-cart-thumb" style="${it.imageUrl ? `background-image:url(${it.imageUrl});background-size:cover` : ''}"></div>
        <div class="z-cart-info">
          <div class="z-cart-title">${it.title || it.game || 'Məhsul'}</div>
          <div class="z-cart-meta">${it.quantity || 1} × ${currencySymbol}${formatMoney(it.price || 0)}</div>
        </div>
        <div class="z-cart-right">
          <div class="z-cart-sub">${currencySymbol}${formatMoney((it.quantity || 1) * (it.price || 0))}</div>
          <button class="z-cart-remove" data-remove="${it.id}" aria-label="Sil">${ICONS.trash}</button>
        </div>
      </div>
    `).join('');
    return `<div class="z-dropdown z-dropdown-cart">
      <div class="z-dropdown-header"><span>Səbətim (${items.length})</span><button class="z-dd-close" data-close aria-label="Bağla">${ICONS.close}</button></div>
      <div class="z-dropdown-body">${rows}</div>
      <div class="z-dropdown-foot">
        <div class="z-cart-total"><span>Cəmi</span><span>${currencySymbol}${formatMoney(cart.subtotal || 0)}</span></div>
        <div class="z-cart-actions">
          <button class="z-btn-ghost" data-clear>Səbəti təmizlə</button>
          <a class="z-btn-primary" href="${CONFIG.cartPage}">Sifariş et</a>
        </div>
      </div>
    </div>`;
  }

  function renderMessagesDropdown() {
    if (notifications === null) {
      return `<div class="z-dropdown z-dropdown-msg"><div class="z-dropdown-header"><span>Mesajlar</span><button class="z-dd-close" data-close aria-label="Bağla">${ICONS.close}</button></div><div class="z-dropdown-body z-center"><div class="z-spin-wrap">${ICONS.spinner}</div></div></div>`;
    }
    if (notifications.length === 0) {
      return `<div class="z-dropdown z-dropdown-msg"><div class="z-dropdown-header"><span>Mesajlar</span><button class="z-dd-close" data-close aria-label="Bağla">${ICONS.close}</button></div><div class="z-dropdown-body z-center"><div class="z-empty">Heç bir mesaj yoxdur.</div></div></div>`;
    }
    const rows = notifications.map((n) => {
      const unread = !n.is_read;
      return `<div class="z-msg-row ${unread ? 'z-unread' : ''}">
        <div class="z-msg-dot"></div>
        <div class="z-msg-body">
          <div class="z-msg-title">${n.title || 'Bildiriş'}</div>
          <div class="z-msg-text">${n.message || ''}</div>
          <div class="z-msg-time">${timeAgo(n.created_at)}</div>
        </div>
        <div class="z-msg-actions">
          ${unread ? `<button class="z-msg-btn" data-read="${n.id}" aria-label="Oxundu olaraq işarələ">${ICONS.check}</button>` : ''}
          <button class="z-msg-btn z-msg-trash" data-delete="${n.id}" aria-label="Sil">${ICONS.trash}</button>
        </div>
      </div>`;
    }).join('');
    const hasUnread = notifications.some((n) => !n.is_read);
    return `<div class="z-dropdown z-dropdown-msg">
      <div class="z-dropdown-header"><span>Mesajlar</span><div class="z-dd-actions">${hasUnread ? `<button class="z-link-btn" data-readall>Hamısını oxu</button>` : ''}<button class="z-dd-close" data-close aria-label="Bağla">${ICONS.close}</button></div></div>
      <div class="z-dropdown-body">${rows}</div>
    </div>`;
  }

  /* =====================================================================
     RENDER / BIND
     ===================================================================== */
  function renderHeader() {
    const existing = document.querySelector('.ztopup-header');
    if (existing) existing.remove();

    const style = document.getElementById('ztopupHeaderStyles');
    if (!style) {
      const s = document.createElement('style');
      s.id = 'ztopupHeaderStyles';
      s.textContent = HEADER_STYLES;
      document.head.appendChild(s);
    }

    const wrapper = h(buildHeaderHTML());
    const particles = document.querySelector('.particles');
    if (particles && particles.nextElementSibling) {
      document.body.insertBefore(wrapper, particles.nextElementSibling);
    } else {
      document.body.insertBefore(wrapper, document.body.firstChild);
    }
    bindHeader();
  }

  function bindHeader() {
    const cartBtn = document.getElementById('ztopupCartBtn');
    const msgBtn = document.getElementById('ztopupMsgBtn');
    const logoutBtn = document.getElementById('ztopupLogoutBtn');
    const loginBtn = document.getElementById('ztopupLoginBtn');
    if (cartBtn) cartBtn.addEventListener('click', (e) => toggleDropdown(e, 'cart'));
    if (msgBtn) msgBtn.addEventListener('click', (e) => toggleDropdown(e, 'messages'));
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    if (loginBtn) loginBtn.addEventListener('click', () => openLogin());

    // Close buttons
    document.querySelectorAll('.z-dd-close[data-close]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); closeDropdowns(); }));
    document.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); markRead(b.dataset.read); }));
    document.querySelectorAll('[data-readall]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); markAllRead(); }));
    document.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); deleteNotification(b.dataset.delete); }));
    document.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); removeCartItem(b.dataset.remove); }));
    document.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); clearCart(); }));
  }

  function openLogin() {
    const modal = document.querySelector(CONFIG.authModal);
    if (modal && modal.classList) {
      modal.classList.add('active');
    } else {
      window.location.href = CONFIG.loginPage;
    }
  }

  function toggleDropdown(e, name) {
    e.stopPropagation();
    if (openDropdown === name) {
      openDropdown = null;
    } else {
      openDropdown = name;
      if (name === 'cart') loadCart();
      if (name === 'messages') loadNotifications();
    }
    renderHeader();
  }

  function closeDropdowns() {
    if (openDropdown) {
      openDropdown = null;
      renderHeader();
    }
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.z-action-wrap')) closeDropdowns();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdowns();
  });
  window.addEventListener('ztopup:login', () => restoreSession());
  window.addEventListener('ztopup:cart', () => loadState());

  /* =====================================================================
     AUTH
     ===================================================================== */
  async function restoreSession() {
    const t = token();
    if (!t) {
      setAuthUser(null);
      return;
    }
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin', headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) throw new Error('Session expired');
      const result = await res.json();
      setAuthUser(result.user);
    } catch {
      localStorage.removeItem('zelixToken');
      localStorage.removeItem('zelixUser');
      setAuthUser(null);
    }
  }

  function setAuthUser(user) {
    currentUser = user || null;
    renderHeader();
    if (currentUser) {
      loadState();
      connectSSE();
    }
  }

  async function logout() {
    const t = token();
    try {
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: '{}',
      });
    } catch (err) { console.error('Logout error:', err); }
    finally {
      localStorage.removeItem('zelixToken');
      localStorage.removeItem('zelixUser');
      if (sse) { sse.close(); sse = null; }
      setAuthUser(null);
      if (window.location.pathname !== CONFIG.loginPage) {
        window.location.href = CONFIG.loginPage;
      }
    }
  }

  /* =====================================================================
     STYLES (premium gaming/fintech)
     ===================================================================== */
  const HEADER_STYLES = `
    .ztopup-spin { animation: ztopup-spin 1s linear infinite; }
    @keyframes ztopup-spin { 100% { transform: rotate(360deg); } }
    .ztopup-header {
      --z-gold: #ffb300;
      --z-gold-2: #ff8c00;
      --z-purple: #8a2eff;
      --z-blue: #00c8ff;
      --z-black: #050505;
      --z-muted: rgba(255,255,255,0.62);
      --z-line: 1px solid rgba(255,255,255,0.09);
      --z-gold-glow: 0 0 18px rgba(255,179,0,0.45);
      --z-blue-glow: 0 0 26px rgba(0,200,255,0.42);
      --z-glass: rgba(255,255,255,0.06);
    }
    .ztopup-header .header {
      position: sticky;
      top: 0;
      z-index: 40;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 22px;
      padding: 14px clamp(18px, 4vw, 64px);
      border-bottom: var(--z-line);
      background: rgba(5,5,5,0.78);
      backdrop-filter: blur(22px);
    }
    .ztopup-header .logo {
      display: flex; align-items: center; gap: 12px;
      min-width: max-content; text-decoration: none;
    }
    .ztopup-header .logo-mark {
      width: 46px; height: 46px; border-radius: 15px;
      display: grid; place-items: center;
      position: relative; overflow: hidden;
      color: #070400;
      font-family: 'Orbitron', sans-serif;
      font-size: 25px; font-weight: 900;
      background: linear-gradient(135deg, #ffe08a 0%, var(--z-gold) 45%, #ff7a00 100%);
      box-shadow: var(--z-gold-glow), 0 0 32px rgba(255,179,0,0.26);
    }
    .ztopup-header .logo-mark img { width: 145%; height: 145%; object-fit: cover; border-radius: inherit; display: block; filter: drop-shadow(0 0 10px rgba(255,179,0,.55)); }
    .ztopup-header .logo-mark::after {
      content: ""; position: absolute; inset: -40%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent);
      transform: rotate(35deg) translateX(-70%);
      animation: ztopup-shine 4.8s ease-in-out infinite;
    }
    @keyframes ztopup-shine { 50%, 100% { transform: rotate(35deg) translateX(90%); } }
    .ztopup-header .brand {
      color: var(--z-gold); font-size: 18px; font-weight: 900; letter-spacing: 0.12em;
      text-shadow: 0 0 16px rgba(255,179,0,.4);
      font-family: 'Orbitron', 'Rajdhani', sans-serif;
    }
    .ztopup-header .header-actions {
      display: flex; align-items: center; gap: 14px;
    }
    .ztopup-header .nav {
      display: flex; align-items: center; gap: 6px;
      padding: 6px;
      border: var(--z-line); border-radius: 999px;
      background: rgba(17,17,26,.7);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
    }
    .ztopup-header .navbtn {
      border: 0; border-radius: 999px;
      padding: 10px 16px;
      background: transparent;
      color: rgba(255,255,255,.72);
      font-size: 12px; font-weight: 800; letter-spacing: 0.05em;
      cursor: pointer; transition: 0.22s ease;
      display: inline-flex; align-items: center; gap: 6px;
      text-decoration: none;
      font-family: 'Orbitron', 'Rajdhani', sans-serif;
    }
    .ztopup-header .navbtn.active, .ztopup-header .navbtn:hover {
      background: linear-gradient(135deg, var(--z-gold), var(--z-gold-2));
      color: #120a00; box-shadow: var(--z-gold-glow);
    }
    .ztopup-header .login, .ztopup-header .user-chip {
      display: flex; align-items: center; gap: 8px;
      border: 1px solid rgba(255,179,0,.48); border-radius: 10px;
      padding: 9px 14px;
      color: var(--z-gold);
      background: linear-gradient(180deg, rgba(255,179,0,.14), rgba(255,179,0,.05));
      box-shadow: 0 0 22px rgba(255,179,0,.12);
      cursor: pointer; transition: 0.22s ease;
      font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: 700;
      text-decoration: none;
    }
    .ztopup-header .login:hover { transform: translateY(-1px); box-shadow: var(--z-gold-glow); }
    .ztopup-header .login svg, .ztopup-header .user-chip svg { width: 17px; height: 17px; }
    .ztopup-header .user-chip { border-color: rgba(0,200,255,.32); background: rgba(0,200,255,.08); color: #fff; box-shadow: var(--z-blue-glow); }
    .ztopup-header .user-avatar-link { text-decoration: none; }
    .ztopup-header .user-avatar {
      width: 28px; height: 28px; border-radius: 50%;
      display: grid; place-items: center;
      background: linear-gradient(135deg, var(--z-blue), var(--z-purple));
      color: #02020a; font-size: 12px; font-weight: 800;
    }
    .ztopup-header .user-name { color: #fff; text-decoration: none; font-weight: 800; }
    .ztopup-header .user-name:hover { color: var(--z-gold); }
    .ztopup-header .logout { border: 0; color: var(--z-gold); background: transparent; cursor: pointer; font-weight: 800; font-size: 13px; }
    .ztopup-header .z-hidden { display: none !important; }

    /* User action bar */
    .ztopup-header .z-user-bar {
      display: flex; align-items: center; gap: 10px;
      margin-left: 4px;
      padding-left: 12px;
      border-left: var(--z-line);
    }
    .ztopup-header .z-balance-card {
      display: flex; align-items: center; gap: 10px;
      padding: 6px 8px 6px 10px;
      border-radius: 16px;
      border: 1px solid rgba(255,179,0,.28);
      background: linear-gradient(135deg, rgba(255,179,0,.14), rgba(255,179,0,.04));
      box-shadow: 0 8px 30px rgba(255,179,0,.12);
      transition: 0.22s ease;
    }
    .ztopup-header .z-balance-card:hover { border-color: rgba(255,179,0,.55); transform: translateY(-1px); }
    .ztopup-header .z-balance-icon {
      width: 34px; height: 34px; border-radius: 10px;
      display: grid; place-items: center;
      background: linear-gradient(135deg, #ffe08a, var(--z-gold), var(--z-gold-2));
      color: #120a00;
    }
    .ztopup-header .z-balance-icon svg { width: 18px; height: 18px; }
    .ztopup-header .z-balance-info { min-width: 74px; }
    .ztopup-header .z-balance-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: rgba(255,255,255,.55); }
    .ztopup-header .z-balance-amount { font-family: 'Orbitron', sans-serif; font-size: 15px; font-weight: 900; color: var(--z-gold); line-height: 1; }
    .ztopup-header .z-balance-plus {
      width: 30px; height: 30px; border-radius: 9px;
      display: grid; place-items: center;
      border: 1px solid rgba(255,179,0,.45);
      background: rgba(255,179,0,.10);
      color: var(--z-gold);
      transition: 0.22s ease;
    }
    .ztopup-header .z-balance-plus:hover { background: linear-gradient(135deg, #ffe08a, var(--z-gold)); color: #120a00; transform: translateY(-1px); }
    .ztopup-header .z-balance-plus svg { width: 16px; height: 16px; }
    .ztopup-header .z-loading .z-balance-amount { color: rgba(255,255,255,.35); }

    .ztopup-header .z-action-wrap { position: relative; }
    .ztopup-header .z-action-btn {
      position: relative;
      display: flex; align-items: center; gap: 7px;
      border: 1px solid rgba(255,255,255,.12); border-radius: 14px;
      padding: 9px 12px;
      background: rgba(255,255,255,.05);
      color: rgba(255,255,255,.78);
      font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.03em;
      cursor: pointer; transition: 0.22s ease;
    }
    .ztopup-header .z-action-btn:hover, .ztopup-header .z-action-btn.z-open {
      border-color: rgba(255,179,0,.45); color: var(--z-gold); background: rgba(255,179,0,.08);
    }
    .ztopup-header .z-action-btn svg { width: 18px; height: 18px; }
    .ztopup-header .z-badge {
      position: absolute; top: -5px; right: -5px;
      min-width: 18px; height: 18px; border-radius: 9px;
      display: grid; place-items: center;
      background: linear-gradient(135deg, #ff4d4d, #ff1a1a);
      color: #fff; font-size: 10px; font-weight: 900;
      box-shadow: 0 0 10px rgba(255,26,26,.45);
      padding: 0 4px;
    }
    .ztopup-header .z-badge-msg { background: linear-gradient(135deg, var(--z-blue), var(--z-purple)); box-shadow: 0 0 10px rgba(0,200,255,.4); }

    /* Dropdowns */
    .ztopup-header .z-dropdown {
      position: absolute; top: calc(100% + 10px); right: 0;
      width: min(92vw, 340px);
      border: 1px solid rgba(255,255,255,.12); border-radius: 20px;
      background: rgba(12,12,18,.95);
      backdrop-filter: blur(24px);
      box-shadow: 0 30px 80px rgba(0,0,0,.65);
      overflow: hidden;
      z-index: 50;
      animation: z-dd-fade 0.18s ease;
    }
    @keyframes z-dd-fade { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    .ztopup-header .z-dropdown-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      font-family: 'Orbitron', sans-serif; font-size: 13px; font-weight: 900; color: #fff;
    }
    .ztopup-header .z-dd-actions { display: flex; align-items: center; gap: 8px; }
    .ztopup-header .z-dd-close {
      width: 26px; height: 26px; border-radius: 7px;
      border: 0; background: rgba(255,255,255,.08); color: rgba(255,255,255,.6);
      display: grid; place-items: center; cursor: pointer; transition: 0.2s;
    }
    .ztopup-header .z-dd-close:hover { background: rgba(255,255,255,.18); color: #fff; }
    .ztopup-header .z-dd-close svg { width: 14px; height: 14px; }
    .ztopup-header .z-dropdown-body { max-height: 360px; overflow-y: auto; padding: 8px; }
    .ztopup-header .z-dropdown-body.z-center { display: grid; place-items: center; min-height: 120px; }
    .ztopup-header .z-empty { color: rgba(255,255,255,.55); font-size: 13px; text-align: center; }
    .ztopup-header .z-spin-wrap { color: var(--z-gold); }
    .ztopup-header .z-spin-wrap svg { width: 28px; height: 28px; }

    .ztopup-header .z-cart-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px; border-radius: 12px;
      background: rgba(255,255,255,.04); margin-bottom: 6px;
    }
    .ztopup-header .z-cart-thumb { width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, var(--z-purple), var(--z-blue)); flex-shrink: 0; }
    .ztopup-header .z-cart-info { flex: 1; min-width: 0; }
    .ztopup-header .z-cart-title { font-size: 13px; font-weight: 800; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ztopup-header .z-cart-meta { font-size: 11px; color: rgba(255,255,255,.55); }
    .ztopup-header .z-cart-right { text-align: right; }
    .ztopup-header .z-cart-sub { font-family: 'Orbitron', sans-serif; font-size: 12px; font-weight: 900; color: var(--z-gold); }
    .ztopup-header .z-cart-remove {
      width: 24px; height: 24px; border-radius: 6px;
      border: 0; background: transparent; color: rgba(255,255,255,.35);
      display: grid; place-items: center; cursor: pointer; transition: 0.2s;
    }
    .ztopup-header .z-cart-item:hover .z-cart-remove { color: #ff6b6b; }
    .ztopup-header .z-cart-remove:hover { background: rgba(255,50,50,.15); }
    .ztopup-header .z-cart-remove svg { width: 14px; height: 14px; }
    .ztopup-header .z-dropdown-foot {
      padding: 12px 14px;
      border-top: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.03);
    }
    .ztopup-header .z-cart-total { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 13px; color: rgba(255,255,255,.7); }
    .ztopup-header .z-cart-total span:last-child { font-family: 'Orbitron', sans-serif; font-size: 15px; font-weight: 900; color: var(--z-gold); }
    .ztopup-header .z-cart-actions { display: flex; gap: 8px; }
    .ztopup-header .z-btn-primary, .ztopup-header .z-btn-ghost {
      flex: 1; text-align: center; border-radius: 10px; padding: 9px 12px;
      font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 800; text-decoration: none; cursor: pointer; transition: 0.2s;
    }
    .ztopup-header .z-btn-primary { background: linear-gradient(135deg, var(--z-gold), var(--z-gold-2)); color: #120a00; border: 0; }
    .ztopup-header .z-btn-primary:hover { transform: translateY(-1px); box-shadow: var(--z-gold-glow); }
    .ztopup-header .z-btn-ghost { border: 1px solid rgba(255,255,255,.15); background: transparent; color: rgba(255,255,255,.7); }
    .ztopup-header .z-btn-ghost:hover { border-color: rgba(255,255,255,.35); color: #fff; }
    .ztopup-header .z-link-btn { border: 0; background: transparent; color: var(--z-blue); font-size: 11px; font-weight: 700; cursor: pointer; }
    .ztopup-header .z-link-btn:hover { color: var(--z-gold); }

    .ztopup-header .z-msg-row {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 10px; border-radius: 12px;
      background: rgba(255,255,255,.04); margin-bottom: 6px;
      transition: 0.2s;
    }
    .ztopup-header .z-msg-row:hover { background: rgba(255,255,255,.08); }
    .ztopup-header .z-msg-row.z-unread { background: rgba(0,200,255,.08); border: 1px solid rgba(0,200,255,.18); }
    .ztopup-header .z-msg-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--z-blue); flex-shrink: 0; margin-top: 6px; box-shadow: 0 0 8px var(--z-blue); }
    .ztopup-header .z-msg-row:not(.z-unread) .z-msg-dot { background: rgba(255,255,255,.25); box-shadow: none; }
    .ztopup-header .z-msg-body { flex: 1; min-width: 0; }
    .ztopup-header .z-msg-title { font-size: 13px; font-weight: 800; color: #fff; margin-bottom: 2px; }
    .ztopup-header .z-msg-text { font-size: 12px; color: rgba(255,255,255,.65); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .ztopup-header .z-msg-time { font-size: 10px; color: rgba(255,255,255,.4); margin-top: 4px; }
    .ztopup-header .z-msg-actions { display: flex; gap: 4px; opacity: 0; transition: 0.2s; }
    .ztopup-header .z-msg-row:hover .z-msg-actions { opacity: 1; }
    .ztopup-header .z-msg-btn {
      width: 24px; height: 24px; border-radius: 6px;
      border: 0; background: rgba(255,255,255,.08); color: rgba(255,255,255,.5);
      display: grid; place-items: center; cursor: pointer; transition: 0.2s;
    }
    .ztopup-header .z-msg-btn:hover { color: #fff; }
    .ztopup-header .z-msg-btn.z-msg-trash:hover { color: #ff6b6b; background: rgba(255,50,50,.15); }
    .ztopup-header .z-msg-btn svg { width: 13px; height: 13px; }

    @media (max-width: 1020px) {
      .ztopup-header .header { flex-wrap: wrap; gap: 14px; }
      .ztopup-header .header-actions { width: 100%; justify-content: space-between; }
      .ztopup-header .z-user-bar { margin-left: 0; padding-left: 0; border-left: 0; border-top: var(--z-line); padding-top: 10px; width: 100%; justify-content: flex-end; }
    }
    @media (max-width: 720px) {
      .ztopup-header .header { padding: 12px 14px; }
      .ztopup-header .logo-mark { width: 40px; height: 40px; font-size: 22px; border-radius: 13px; }
      .ztopup-header .brand { font-size: 14px; }
      .ztopup-header .nav { display: none; }
      .ztopup-header .navbtn { font-size: 11px; padding: 8px 12px; }
      .ztopup-header .z-user-bar { gap: 8px; }
      .ztopup-header .z-balance-info { min-width: 60px; }
      .ztopup-header .z-balance-amount { font-size: 13px; }
      .ztopup-header .z-btn-label { display: none; }
      .ztopup-header .z-action-btn { padding: 8px; }
      .ztopup-header .z-dropdown { right: -40px; width: min(92vw, 320px); }
    }
  `;

  /* =====================================================================
     INIT
     ===================================================================== */
  function init() {
    if (document.querySelector('.ztopup-header')) return;
    restoreSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
