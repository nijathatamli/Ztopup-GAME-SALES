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

  let currentUser = null;
  let state = { balance: 0, cartCount: 0, unreadCount: 0, loading: true };
  let cart = null; // full cart data
  let notifications = [];
  let sse = null;
  let openDropdown = null; // 'cart' | 'messages' | null
  let mobileMenuOpen = false;
  const currencySymbol = '₼';

  /* =====================================================================
     ICONS (inline SVG strings)
     ===================================================================== */
  const ICONS = {
    home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
    gamepad: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 12h4"></path><path d="M8 10v4"></path><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line></svg>`,
    wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M21 12h-6a2 2 0 0 0 0 4h6v-4Z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
    cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6h15l-1.5 9h-12z"/><circle cx="9" cy="20" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="20" r="1.5" fill="currentColor" stroke="none"/><path d="M6 6L5 3H2"/></svg>`,
    bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    spinner: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ztopup-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`,
    logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`,
    caret: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`,
    orders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1Z"/><path d="M9 4h6"/><path d="M8 11h8M8 15h5"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>`,
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* Resolve the authenticated user's display name with a strict fallback
     priority: username -> displayName -> firstName -> email prefix -> name.
     Never returns the placeholder "User". */
  function userDisplayName() {
    const u = currentUser || {};
    const emailPrefix = u.email ? String(u.email).split('@')[0] : '';
    const name = u.username || u.displayName || u.firstName || emailPrefix || u.name;
    const clean = String(name == null ? '' : name).trim();
    return clean || 'İstifadəçi';
  }

  /* Build avatar initials from real name parts when available. */
  function userInitials() {
    const u = currentUser || {};
    const base = (u.firstName && u.lastName) ? `${u.firstName} ${u.lastName}` : userDisplayName();
    const parts = String(base).trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0] || 'Z').slice(0, 2).toUpperCase();
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
            <div class="logo-mark"><img src="/assets/zelix-generated-logo.svg" alt="ZELIX TOPUP logo"></div>
            <div class="brand">${CONFIG.brand.name}</div>
          </a>
          <div class="header-actions">
            <nav class="nav" aria-label="Əsas naviqasiya">${navItems}</nav>
            <button class="login ${currentUser ? 'z-hidden' : ''}" id="ztopupLoginBtn" type="button">
              ${ICONS.user}
              <span>Login</span>
            </button>
            <div class="z-action-wrap z-profile-wrap ${currentUser ? '' : 'z-hidden'}" id="ztopupUserChip">
              <button class="z-profile-chip ${openDropdown === 'profile' ? 'z-open' : ''} ${state.loading ? 'z-loading' : ''}" id="ztopupUserChipBtn" type="button" aria-haspopup="menu" aria-expanded="${openDropdown === 'profile' ? 'true' : 'false'}" aria-label="Hesab menyusu">
                <span class="z-profile-avatar" id="ztopupUserAvatar">${currentUser ? esc(userInitials()) : 'Z'}</span>
                <span class="z-profile-name" id="ztopupUserName">${currentUser ? esc(userDisplayName()) : ''}</span>
                <span class="z-profile-caret">${ICONS.caret}</span>
              </button>
              ${openDropdown === 'profile' ? renderProfileDropdown() : ''}
            </div>
            ${userActionBar}
            <button class="z-burger" id="ztopupBurger" type="button" aria-label="Menyu" aria-expanded="${mobileMenuOpen ? 'true' : 'false'}">
              ${ICONS.menu}
            </button>
          </div>
        </header>
        ${buildMobileDrawer(navItems)}
        ${buildBottomNav()}
      </div>
    `;
  }

  function buildBottomNav() {
    const path = window.location.pathname;
    const isHome = path === '/' || path === '/index.html';
    const isCat = path.includes('/category') || path.includes('/pubg') || path.includes('/mehsullar');
    const isCart = path.includes('/cart');
    const isBalance = path.includes('/balance') || path.includes('/deposits');
    const isProfile = path.includes('/profile');
    
    const cartBadge = state.cartCount > 0 ? `<span class="z-bnav-badge">${state.cartCount > 99 ? '99+' : state.cartCount}</span>` : '';
    const balanceText = currentUser ? `${currencySymbol}${formatMoney(state.balance)}` : 'Giriş';
    const profileAction = currentUser ? `href="/profile.html"` : `href="/login-v2.html"`;
    const balanceAction = currentUser ? `href="/profile.html#balance"` : `href="/login-v2.html"`;
    
    return `
      <nav class="z-bottom-nav">
        <div class="z-bnav-inner">
          <a href="/" class="z-bnav-item ${isHome ? 'active' : ''}">
            <div class="z-bnav-icon">${ICONS.home}</div>
            <span class="z-bnav-label">Ana səhifə</span>
            <div class="z-bnav-indicator"></div>
          </a>
          <a href="/category.html" class="z-bnav-item ${isCat ? 'active' : ''}">
            <div class="z-bnav-icon">${ICONS.gamepad}</div>
            <span class="z-bnav-label">Kataloq</span>
            <div class="z-bnav-indicator"></div>
          </a>
          <a href="/cart.html" class="z-bnav-item ${isCart ? 'active' : ''}">
            <div class="z-bnav-icon">
              ${ICONS.cart}
              ${cartBadge}
            </div>
            <span class="z-bnav-label">Səbət</span>
            <div class="z-bnav-indicator"></div>
          </a>
          <a ${balanceAction} class="z-bnav-item ${isBalance ? 'active' : ''}">
            <div class="z-bnav-icon">${ICONS.wallet}</div>
            <span class="z-bnav-label">${balanceText}</span>
            <div class="z-bnav-indicator"></div>
          </a>
          <a ${profileAction} class="z-bnav-item ${isProfile ? 'active' : ''}">
            <div class="z-bnav-icon">${ICONS.user}</div>
            <span class="z-bnav-label">Profil</span>
            <div class="z-bnav-indicator"></div>
          </a>
        </div>
      </nav>
    `;
  }

  function buildMobileDrawer() {
    const path = window.location.pathname;
    const links = CONFIG.nav.map((n) => {
      const isActive = n.href === path || (n.href !== '/' && path.startsWith(n.href));
      return `<a href="${n.href}" class="z-drawer-link ${isActive ? 'active' : ''}">${n.label}${ICONS.chevron}</a>`;
    }).join('');

    const account = currentUser
      ? `<div class="z-drawer-user">
           <span class="z-drawer-avatar" id="ztopupDrawerAvatar">${esc(userInitials())}</span>
           <div class="z-drawer-user-info">
             <div class="z-drawer-user-name">${esc(userDisplayName())}</div>
             <div class="z-drawer-balance">${currencySymbol}${formatMoney(state.balance)}</div>
           </div>
         </div>
         <a href="${CONFIG.balanceTopup}" class="z-drawer-btn z-drawer-btn-primary">${ICONS.wallet}<span>Balans artır</span></a>
         <a href="${CONFIG.cartPage}" class="z-drawer-btn">${ICONS.cart}<span>Səbət${state.cartCount > 0 ? ` (${state.cartCount})` : ''}</span></a>
         <button class="z-drawer-btn z-drawer-logout" id="ztopupDrawerLogout" type="button">${ICONS.logout}<span>Çıxış</span></button>`
      : `<button class="z-drawer-btn z-drawer-btn-primary" id="ztopupDrawerLogin" type="button">${ICONS.user}<span>Login / Qeydiyyat</span></button>`;

    return `
      <div class="z-drawer-scrim ${mobileMenuOpen ? 'z-open' : ''}" id="ztopupDrawerScrim"></div>
      <aside class="z-drawer ${mobileMenuOpen ? 'z-open' : ''}" id="ztopupDrawer" aria-hidden="${mobileMenuOpen ? 'false' : 'true'}">
        <div class="z-drawer-head">
          <a href="${CONFIG.brand.home}" class="z-drawer-brand">
            <div class="logo-mark"><img src="/assets/zelix-generated-logo.svg" alt="ZELIX TOPUP logo"></div>
            <span>${CONFIG.brand.name}</span>
          </a>
          <button class="z-drawer-close" id="ztopupDrawerClose" type="button" aria-label="Bağla">${ICONS.close}</button>
        </div>
        <nav class="z-drawer-nav" aria-label="Mobil naviqasiya">${links}</nav>
        <div class="z-drawer-account">${account}</div>
      </aside>
    `;
  }

  function renderProfileDropdown() {
    const items = [
      { label: 'Profilim', href: CONFIG.profilePage, icon: ICONS.user },
      { label: 'Sifarişlərim', href: CONFIG.profilePage, icon: ICONS.orders },
      { label: 'Balansım', href: CONFIG.balanceTopup, icon: ICONS.wallet },
      { label: 'Parametrlər', href: CONFIG.profilePage, icon: ICONS.settings },
    ];
    const rows = items.map((it) => `
      <a href="${it.href}" class="z-menu-item" role="menuitem">
        <span class="z-menu-icon">${it.icon}</span>
        <span class="z-menu-label">${it.label}</span>
        <span class="z-menu-chevron">${ICONS.chevron}</span>
      </a>
    `).join('');
    return `<div class="z-dropdown z-dropdown-profile" role="menu" aria-label="Hesab menyusu">
      <div class="z-menu-id">
        <span class="z-menu-avatar">${esc(userInitials())}</span>
        <div class="z-menu-id-info">
          <div class="z-menu-id-name">${esc(userDisplayName())}</div>
          <div class="z-menu-id-balance">${currencySymbol}${formatMoney(state.balance)}</div>
        </div>
      </div>
      <div class="z-menu-list">${rows}</div>
      <div class="z-menu-foot">
        <button class="z-menu-item z-menu-logout" id="ztopupMenuLogout" type="button" role="menuitem">
          <span class="z-menu-icon">${ICONS.logout}</span>
          <span class="z-menu-label">Çıxış</span>
        </button>
      </div>
    </div>`;
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
    const chipBtn = document.getElementById('ztopupUserChipBtn');
    const menuLogout = document.getElementById('ztopupMenuLogout');
    const loginBtn = document.getElementById('ztopupLoginBtn');
    if (cartBtn) cartBtn.addEventListener('click', (e) => toggleDropdown(e, 'cart'));
    if (msgBtn) msgBtn.addEventListener('click', (e) => toggleDropdown(e, 'messages'));
    if (chipBtn) chipBtn.addEventListener('click', (e) => toggleDropdown(e, 'profile'));
    if (menuLogout) menuLogout.addEventListener('click', (e) => { e.stopPropagation(); logout(); });
    if (loginBtn) loginBtn.addEventListener('click', () => openLogin());

    // Mobile drawer
    const burger = document.getElementById('ztopupBurger');
    const drawerClose = document.getElementById('ztopupDrawerClose');
    const scrim = document.getElementById('ztopupDrawerScrim');
    const drawerLogin = document.getElementById('ztopupDrawerLogin');
    const drawerLogout = document.getElementById('ztopupDrawerLogout');
    if (burger) burger.addEventListener('click', () => setMobileMenu(!mobileMenuOpen));
    if (drawerClose) drawerClose.addEventListener('click', () => setMobileMenu(false));
    if (scrim) scrim.addEventListener('click', () => setMobileMenu(false));
    if (drawerLogin) drawerLogin.addEventListener('click', () => { setMobileMenu(false); openLogin(); });
    if (drawerLogout) drawerLogout.addEventListener('click', () => { setMobileMenu(false); logout(); });
    document.querySelectorAll('.z-drawer-link').forEach((a) => a.addEventListener('click', () => setMobileMenu(false)));

    // Close buttons
    document.querySelectorAll('.z-dd-close[data-close]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); closeDropdowns(); }));
    document.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); markRead(b.dataset.read); }));
    document.querySelectorAll('[data-readall]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); markAllRead(); }));
    document.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); deleteNotification(b.dataset.delete); }));
    document.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); removeCartItem(b.dataset.remove); }));
    document.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); clearCart(); }));
  }

  function setMobileMenu(open) {
    mobileMenuOpen = open;
    const drawer = document.getElementById('ztopupDrawer');
    const scrim = document.getElementById('ztopupDrawerScrim');
    const burger = document.getElementById('ztopupBurger');
    if (drawer) { drawer.classList.toggle('z-open', open); drawer.setAttribute('aria-hidden', open ? 'false' : 'true'); }
    if (scrim) scrim.classList.toggle('z-open', open);
    if (burger) burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
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
    if (e.key === 'Escape') { closeDropdowns(); if (mobileMenuOpen) setMobileMenu(false); }
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
    .ztopup-header .login {
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
    .ztopup-header .login svg { width: 17px; height: 17px; }

    /* ===== Premium user identity chip ===== */
    .ztopup-header .z-profile-wrap { position: relative; }
    .ztopup-header .z-profile-chip {
      display: flex; align-items: center; gap: 9px;
      max-width: 220px;
      border: 1px solid rgba(0,200,255,.30); border-radius: 14px;
      padding: 6px 10px 6px 6px;
      background: linear-gradient(135deg, rgba(0,200,255,.12), rgba(138,46,255,.08));
      box-shadow: 0 8px 26px rgba(0,200,255,.14);
      cursor: pointer; transition: transform .22s ease, border-color .22s ease, box-shadow .22s ease, background .22s ease;
      font-family: 'Rajdhani', sans-serif;
    }
    .ztopup-header .z-profile-chip:hover { transform: translateY(-1px); border-color: rgba(0,200,255,.6); box-shadow: var(--z-blue-glow); }
    .ztopup-header .z-profile-chip:active { transform: translateY(0); }
    .ztopup-header .z-profile-chip.z-open { border-color: rgba(255,179,0,.55); background: rgba(255,179,0,.10); box-shadow: var(--z-gold-glow); }
    .ztopup-header .z-profile-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      display: grid; place-items: center; flex-shrink: 0;
      background: linear-gradient(135deg, var(--z-blue), var(--z-purple));
      color: #02020a; font-size: 12px; font-weight: 900; letter-spacing: .02em;
      box-shadow: inset 0 0 0 2px rgba(255,255,255,.12);
    }
    .ztopup-header .z-profile-name {
      color: #fff; font-size: 14px; font-weight: 800; letter-spacing: .01em;
      max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .ztopup-header .z-profile-caret { display: grid; place-items: center; color: rgba(255,255,255,.55); transition: transform .22s ease, color .22s ease; }
    .ztopup-header .z-profile-caret svg { width: 15px; height: 15px; }
    .ztopup-header .z-profile-chip:hover .z-profile-caret { color: #fff; }
    .ztopup-header .z-profile-chip.z-open .z-profile-caret { transform: rotate(180deg); color: var(--z-gold); }
    /* Loading shimmer state */
    .ztopup-header .z-profile-chip.z-loading .z-profile-name {
      color: transparent; border-radius: 6px; min-width: 70px;
      background: linear-gradient(90deg, rgba(255,255,255,.08) 25%, rgba(255,255,255,.18) 37%, rgba(255,255,255,.08) 63%);
      background-size: 400% 100%; animation: z-shimmer 1.3s ease infinite;
    }
    @keyframes z-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }

    /* ===== Profile dropdown menu ===== */
    .ztopup-header .z-dropdown-profile { width: min(90vw, 280px); }
    .ztopup-header .z-menu-id {
      display: flex; align-items: center; gap: 12px;
      padding: 16px; border-bottom: 1px solid rgba(255,255,255,.08);
      background: linear-gradient(135deg, rgba(0,200,255,.08), rgba(138,46,255,.06));
    }
    .ztopup-header .z-menu-avatar {
      width: 44px; height: 44px; border-radius: 50%;
      display: grid; place-items: center; flex-shrink: 0;
      background: linear-gradient(135deg, var(--z-blue), var(--z-purple));
      color: #02020a; font-size: 16px; font-weight: 900;
      box-shadow: inset 0 0 0 2px rgba(255,255,255,.14);
    }
    .ztopup-header .z-menu-id-info { min-width: 0; }
    .ztopup-header .z-menu-id-name { font-size: 15px; font-weight: 800; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ztopup-header .z-menu-id-balance { font-family: 'Orbitron', sans-serif; font-size: 14px; font-weight: 900; color: var(--z-gold); margin-top: 2px; }
    .ztopup-header .z-menu-list { padding: 8px; }
    .ztopup-header .z-menu-foot { padding: 8px; border-top: 1px solid rgba(255,255,255,.08); }
    .ztopup-header .z-menu-item {
      width: 100%;
      display: flex; align-items: center; gap: 12px;
      padding: 11px 12px; border-radius: 12px;
      border: 0; background: transparent; cursor: pointer;
      color: rgba(255,255,255,.82); text-decoration: none;
      font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: 700;
      transition: background .18s ease, color .18s ease;
    }
    .ztopup-header .z-menu-item:hover { background: rgba(255,179,0,.10); color: var(--z-gold); }
    .ztopup-header .z-menu-icon { display: grid; place-items: center; width: 20px; flex-shrink: 0; color: inherit; }
    .ztopup-header .z-menu-icon svg { width: 18px; height: 18px; }
    .ztopup-header .z-menu-label { flex: 1; text-align: left; }
    .ztopup-header .z-menu-chevron { display: grid; place-items: center; color: rgba(255,255,255,.25); transition: transform .18s ease, color .18s ease; }
    .ztopup-header .z-menu-chevron svg { width: 14px; height: 14px; }
    .ztopup-header .z-menu-item:hover .z-menu-chevron { color: var(--z-gold); transform: translateX(2px); }
    .ztopup-header .z-menu-logout { color: #ff7b7b; }
    .ztopup-header .z-menu-logout:hover { background: rgba(255,80,80,.12); color: #ff5b5b; }
    .ztopup-header .z-hidden { display: none !important; }

    /* Hamburger button (hidden on desktop) */
    .ztopup-header .z-burger {
      display: none;
      width: 46px; height: 46px;
      border-radius: 13px;
      align-items: center; justify-content: center;
      border: 1px solid rgba(255,179,0,.4);
      background: linear-gradient(180deg, rgba(255,179,0,.12), rgba(255,179,0,.04));
      color: var(--z-gold);
      cursor: pointer;
      flex-shrink: 0;
      transition: 0.2s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .ztopup-header .z-burger:active { transform: scale(0.94); }
    .ztopup-header .z-burger svg { width: 24px; height: 24px; }

    /* Mobile drawer */
    .ztopup-header .z-drawer-scrim {
      position: fixed; inset: 0; z-index: 998;
      background: rgba(0,0,0,.6);
      backdrop-filter: blur(4px);
      opacity: 0; visibility: hidden;
      transition: opacity 0.3s ease, visibility 0.3s ease;
    }
    .ztopup-header .z-drawer-scrim.z-open { opacity: 1; visibility: visible; }
    .ztopup-header .z-drawer {
      position: fixed; top: 0; right: 0; z-index: 999;
      height: 100dvh; width: min(86vw, 340px);
      display: flex; flex-direction: column;
      background: linear-gradient(180deg, #0d0b16 0%, #070710 100%);
      border-left: 1px solid rgba(255,179,0,.18);
      box-shadow: -30px 0 80px rgba(0,0,0,.6);
      transform: translateX(100%);
      transition: transform 0.32s cubic-bezier(0.4, 0, 0.2, 1);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }
    .ztopup-header .z-drawer.z-open { transform: translateX(0); }
    .ztopup-header .z-drawer-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 20px;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .ztopup-header .z-drawer-brand {
      display: flex; align-items: center; gap: 10px;
      text-decoration: none;
      color: var(--z-gold); font-family: 'Orbitron', sans-serif; font-size: 15px; font-weight: 900; letter-spacing: 0.08em;
    }
    .ztopup-header .z-drawer-brand .logo-mark { width: 38px; height: 38px; border-radius: 12px; }
    .ztopup-header .z-drawer-close {
      width: 42px; height: 42px; border-radius: 11px;
      display: grid; place-items: center;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.05);
      color: rgba(255,255,255,.75);
      cursor: pointer; transition: 0.2s;
    }
    .ztopup-header .z-drawer-close:active { transform: scale(0.94); }
    .ztopup-header .z-drawer-close svg { width: 20px; height: 20px; }
    .ztopup-header .z-drawer-nav {
      display: flex; flex-direction: column;
      padding: 14px;
      gap: 6px;
    }
    .ztopup-header .z-drawer-link {
      display: flex; align-items: center; justify-content: space-between;
      min-height: 54px;
      padding: 0 16px;
      border-radius: 14px;
      color: rgba(255,255,255,.82);
      text-decoration: none;
      font-family: 'Rajdhani', sans-serif; font-size: 17px; font-weight: 700; letter-spacing: 0.02em;
      transition: 0.2s ease;
    }
    .ztopup-header .z-drawer-link svg { width: 18px; height: 18px; opacity: 0.4; }
    .ztopup-header .z-drawer-link:active { background: rgba(255,255,255,.06); }
    .ztopup-header .z-drawer-link.active {
      background: linear-gradient(135deg, rgba(255,179,0,.18), rgba(255,179,0,.06));
      color: var(--z-gold);
      border: 1px solid rgba(255,179,0,.3);
    }
    .ztopup-header .z-drawer-link.active svg { opacity: 1; color: var(--z-gold); }
    .ztopup-header .z-drawer-account {
      margin-top: auto;
      display: flex; flex-direction: column; gap: 10px;
      padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
      border-top: 1px solid rgba(255,255,255,.08);
    }
    .ztopup-header .z-drawer-user {
      display: flex; align-items: center; gap: 12px;
      padding: 6px 4px 12px;
    }
    .ztopup-header .z-drawer-avatar {
      width: 46px; height: 46px; border-radius: 50%;
      display: grid; place-items: center; flex-shrink: 0;
      background: linear-gradient(135deg, var(--z-blue), var(--z-purple));
      color: #02020a; font-size: 18px; font-weight: 800;
    }
    .ztopup-header .z-drawer-user-name { font-size: 16px; font-weight: 800; color: #fff; }
    .ztopup-header .z-drawer-balance { font-family: 'Orbitron', sans-serif; font-size: 15px; font-weight: 900; color: var(--z-gold); }
    .ztopup-header .z-drawer-btn {
      display: flex; align-items: center; gap: 12px;
      min-height: 52px;
      padding: 0 18px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.05);
      color: rgba(255,255,255,.85);
      font-family: 'Rajdhani', sans-serif; font-size: 16px; font-weight: 700;
      text-decoration: none; cursor: pointer; transition: 0.2s ease;
      width: 100%;
    }
    .ztopup-header .z-drawer-btn svg { width: 20px; height: 20px; }
    .ztopup-header .z-drawer-btn:active { transform: scale(0.98); }
    .ztopup-header .z-drawer-btn-primary {
      border: 0;
      background: linear-gradient(135deg, var(--z-gold), var(--z-gold-2));
      color: #120a00;
      box-shadow: var(--z-gold-glow);
    }
    .ztopup-header .z-drawer-logout { color: #ff7b7b; border-color: rgba(255,80,80,.3); }

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

    /* Tablet: condense the desktop bar before switching to drawer */
    @media (max-width: 1080px) {
      .ztopup-header .navbtn { font-size: 11px; padding: 9px 13px; }
      .ztopup-header .z-balance-info { min-width: 60px; }
      .ztopup-header .z-btn-label { display: none; }
      .ztopup-header .z-action-btn { padding: 9px; }
    }
    /* Mobile + small tablet: hamburger drawer takes over */
    @media (max-width: 900px) {
      .ztopup-header .header {
        padding: 12px clamp(14px, 4vw, 28px);
        gap: 12px;
      }
      .ztopup-header .nav,
      .ztopup-header .login,
      .ztopup-header .z-profile-wrap,
      .ztopup-header .z-user-bar { display: none !important; }
      .ztopup-header .z-burger { display: inline-flex; }
      .ztopup-header .header-actions { gap: 10px; }
    }
    @media (max-width: 480px) {
      .ztopup-header .header { padding: 11px 14px; }
      .ztopup-header .logo-mark { width: 40px; height: 40px; font-size: 22px; border-radius: 12px; }
      .ztopup-header .brand { font-size: 15px; letter-spacing: 0.08em; }
    }
    @media (max-width: 340px) {
      .ztopup-header .brand { display: none; }
    }

    /* BOTTOM NAVIGATION */
    .ztopup-header .z-bottom-nav {
      display: none;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      background: rgba(12, 12, 18, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      z-index: 9999;
      padding-bottom: env(safe-area-inset-bottom);
    }
    .ztopup-header .z-bnav-inner {
      display: flex;
      justify-content: space-around;
      align-items: center;
      height: 64px;
      padding: 0 8px;
    }
    .ztopup-header .z-bnav-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      color: rgba(255, 255, 255, 0.55);
      gap: 4px;
      position: relative;
      transition: color 0.2s ease;
      height: 100%;
      -webkit-tap-highlight-color: transparent;
    }
    .ztopup-header .z-bnav-item.active {
      color: var(--z-gold);
    }
    .ztopup-header .z-bnav-icon {
      position: relative;
      width: 24px; height: 24px;
      display: grid; place-items: center;
      transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .ztopup-header .z-bnav-item:active .z-bnav-icon {
      transform: scale(0.85);
    }
    .ztopup-header .z-bnav-item.active .z-bnav-icon {
      transform: translateY(-2px);
    }
    .ztopup-header .z-bnav-icon svg {
      width: 22px; height: 22px;
    }
    .ztopup-header .z-bnav-label {
      font-size: 10px;
      font-family: 'Rajdhani', sans-serif;
      font-weight: 700;
      letter-spacing: 0.03em;
    }
    .ztopup-header .z-bnav-badge {
      position: absolute;
      top: -4px; right: -8px;
      background: #ff3232;
      color: #fff;
      font-size: 9px;
      font-weight: 900;
      padding: 2px 5px;
      border-radius: 10px;
      box-shadow: 0 0 8px rgba(255, 50, 50, 0.5);
      min-width: 14px;
      text-align: center;
      animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    @keyframes popIn {
      0% { transform: scale(0.5); opacity: 0; }
      50% { transform: scale(1.2); }
      100% { transform: scale(1); opacity: 1; }
    }
    .ztopup-header .z-bnav-indicator {
      position: absolute;
      top: 0; left: 50%;
      transform: translateX(-50%);
      width: 24px; height: 3px;
      border-radius: 0 0 4px 4px;
      background: var(--z-gold);
      box-shadow: 0 2px 8px rgba(255, 179, 0, 0.5);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .ztopup-header .z-bnav-item.active .z-bnav-indicator {
      opacity: 1;
    }

    @media (max-width: 768px) {
      .ztopup-header .z-bottom-nav { display: block; }
      body { padding-bottom: calc(64px + env(safe-area-inset-bottom)) !important; }
      .ztopup-header .z-burger { display: none !important; }
      .ztopup-header .z-drawer { display: none !important; }
      .ztopup-header .z-drawer-scrim { display: none !important; }
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
