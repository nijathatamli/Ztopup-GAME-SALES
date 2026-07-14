/**
 * ZTopUp Global Footer Component
 * Include this script on any public page to render the shared footer.
 * Do NOT include on profile, auth, or admin pages.
 *
 * <script src="/footer.js" defer></script>
 */
(function () {
  'use strict';

  /* =====================================================================
     CONFIGURATION — update these values to change links / text globally
     ===================================================================== */
  const CONFIG = {
    company: {
      name: 'ZTopUp',
      description:
        'ZTopUp — oyun dünyasının etibarlı tərəfdaşı. Sürətli, təhlükəsiz və güvənilir rəqəmsal oyun xidmətləri ilə sizə ən yaxşı müştəri təcrübəsini təqdim edirik. Ani çatdırılma, rəqabətli qiymətlər və 7/24 dəstək komandamız hər zaman xidmətinizdədir.',
    },
    corporate: [
      { label: 'Qaydalar və Qanunlar', href: '/rules.html' },
      { label: 'Məxfilik Siyasəti', href: '/privacy.html' },
      { label: 'İstifadə Şərtləri', href: '/terms.html' },
      { label: 'Tez-tez Verilən Suallar (FAQ)', href: '/faq.html' },
    ],
    contact: {
      title: 'Bizimlə Əlaqə',
      details: [
        { type: 'phone', label: '+994 10 123 95 23', href: 'tel:+994101239523', icon: 'phone' },
        { type: 'email', label: 'support@ztopup.az', href: 'mailto:support@ztopup.az', icon: 'email' },
      ],
      channels: [
        { name: 'WhatsApp', href: 'https://wa.me/994501234567', icon: 'whatsapp' },
        { name: 'Instagram', href: 'https://instagram.com/ztopup.az', icon: 'instagram' },
        { name: 'TikTok', href: 'https://tiktok.com/@ztopup.az', icon: 'tiktok' },
        { name: 'YouTube', href: 'https://youtube.com/@ztopupaz', icon: 'youtube' },
      ],
    },
    copyright: '© 2026 ZTopUp. Bütün hüquqlar qorunur.',
  };

  /* =====================================================================
     SVG ICONS (inline, no external dependencies)
     ===================================================================== */
  const ICONS = {
    whatsapp:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>',
    instagram:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.072 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>',
    tiktok:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.5-1.43 2.89 2.89 0 01-.38-1.44 2.89 2.89 0 012.88-2.88c.3 0 .59.05.86.13V8.32a6.2 6.2 0 00-.86-.06A6.22 6.22 0 002.5 14.48a6.22 6.22 0 006.22 6.22 6.22 6.22 0 006.22-6.22V9.13a8.14 8.14 0 004.77 1.53V7.21a4.85 4.85 0 01-2.12-.52z"/></svg>',
    youtube:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    phone:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.4 12.4 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.4 12.4 0 002.81.7A2 2 0 0122 16.92z"/></svg>',
    email:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/></svg>',
    arrow:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
  };

  /* =====================================================================
     STYLES (injected as a <style> block)
     ===================================================================== */
  const FOOTER_STYLES = `
    .ztopup-footer {
      --z-gold: #ffb300;
      --z-purple: #8a2eff;
      --z-blue: #00c8ff;
      --z-black: #050505;
      --z-panel: rgba(17,17,26,0.72);
      --z-panel-strong: #101018;
      --z-muted: rgba(255,255,255,0.62);
      --z-line: 1px solid rgba(255,255,255,0.09);
      --z-gold-glow: 0 0 18px rgba(255,179,0,0.45);
      font-family: 'Inter', sans-serif;
      color: #fff;
      width: 100%;
      position: relative;
      z-index: 1;
      flex-shrink: 0;
      margin-top: auto;
    }
    .ztopup-footer::before {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(circle at 80% 10%, rgba(138,46,255,0.18), transparent 40%),
        radial-gradient(circle at 20% 90%, rgba(0,200,255,0.12), transparent 40%);
      z-index: 0;
    }
    .ztopup-footer-inner {
      position: relative;
      z-index: 1;
      max-width: 1280px;
      margin: 0 auto;
      padding: 64px clamp(20px, 4vw, 64px) 28px;
    }
    .ztopup-footer-grid {
      display: grid;
      grid-template-columns: 1.4fr 0.9fr 1.1fr;
      gap: 48px;
      align-items: start;
    }
    @media (max-width: 860px) {
      .ztopup-footer-grid {
        grid-template-columns: 1fr 1fr;
        gap: 36px 32px;
      }
      .ztopup-footer-brand { grid-column: 1 / -1; }
    }
    @media (max-width: 560px) {
      .ztopup-footer-grid {
        grid-template-columns: 1fr;
        gap: 32px;
      }
    }

    /* ---- BRAND / COMPANY ---- */
    .ztopup-footer-brand .z-logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .ztopup-footer-brand .z-logo-mark {
      width: 46px; height: 46px; border-radius: 15px;
      display: grid; place-items: center;
      overflow: hidden; position: relative;
      background: linear-gradient(135deg, #ffe08a 0%, var(--z-gold) 45%, #ff7a00 100%);
      box-shadow: var(--z-gold-glow), 0 0 28px rgba(255,179,0,0.22);
      flex-shrink: 0;
    }
    .ztopup-footer-brand .z-logo-mark img {
      width: 145%; height: 145%; object-fit: cover; display: block;
      filter: drop-shadow(0 0 10px rgba(255,179,0,.55));
    }
    .ztopup-footer-brand .z-logo-text {
      font-family: 'Orbitron', sans-serif;
      font-size: 20px; font-weight: 800;
      letter-spacing: 0.12em;
      color: #fff;
    }
    .ztopup-footer-brand .z-logo-text span {
      color: var(--z-gold);
      text-shadow: var(--z-gold-glow);
    }
    .ztopup-footer-brand .z-desc {
      color: rgba(255,255,255,0.58);
      font-size: 14px;
      line-height: 1.7;
      max-width: 380px;
    }

    /* ---- SECTION TITLES ---- */
    .ztopup-footer-title {
      font-family: 'Orbitron', sans-serif;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #fff;
      margin-bottom: 20px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .ztopup-footer-title::after {
      content: '';
      display: block;
      width: 24px; height: 2px;
      border-radius: 2px;
      background: linear-gradient(90deg, var(--z-gold), transparent);
    }

    /* ---- LINKS ---- */
    .ztopup-footer-links {
      list-style: none;
      padding: 0; margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ztopup-footer-links a {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: rgba(255,255,255,0.58);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      padding: 4px 0;
      transition: all 0.22s ease;
      position: relative;
    }
    .ztopup-footer-links a::before {
      content: '';
      width: 0; height: 6px;
      border-radius: 50%;
      background: var(--z-gold);
      box-shadow: 0 0 8px rgba(255,179,0,0.45);
      transition: width 0.22s ease;
      flex-shrink: 0;
    }
    .ztopup-footer-links a:hover {
      color: #fff;
      transform: translateX(4px);
    }
    .ztopup-footer-links a:hover::before {
      width: 6px;
    }

    /* ---- SOCIAL ---- */
    .ztopup-footer-social {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .ztopup-footer-social a {
      display: grid;
      place-items: center;
      width: 42px; height: 42px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.6);
      transition: all 0.25s ease;
      position: relative;
      overflow: hidden;
    }
    .ztopup-footer-social a::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, var(--z-gold), #ff7a00);
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    .ztopup-footer-social a svg {
      width: 20px; height: 20px;
      position: relative;
      z-index: 1;
      transition: transform 0.25s ease;
    }
    .ztopup-footer-social a:hover {
      border-color: rgba(255,179,0,0.35);
      box-shadow: var(--z-gold-glow);
      color: #fff;
    }
    .ztopup-footer-social a:hover::before { opacity: 1; }
    .ztopup-footer-social a:hover svg { transform: scale(1.12); }

    /* ---- CONTACT DETAILS (phone / email) ---- */
    .ztopup-footer-contact {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 20px;
    }
    .ztopup-footer-contact a {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      color: rgba(255,255,255,0.78);
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.22s ease;
      width: fit-content;
    }
    .ztopup-footer-contact a .icon-wrap {
      width: 36px; height: 36px;
      border-radius: 10px;
      display: grid; place-items: center;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      color: var(--z-gold);
      transition: all 0.22s ease;
      flex-shrink: 0;
    }
    .ztopup-footer-contact a .icon-wrap svg {
      width: 18px; height: 18px;
    }
    .ztopup-footer-contact a:hover {
      color: #fff;
    }
    .ztopup-footer-contact a:hover .icon-wrap {
      border-color: rgba(255,179,0,0.35);
      background: rgba(255,179,0,0.1);
      box-shadow: var(--z-gold-glow);
    }

    /* ---- BOTTOM BAR ---- */
    .ztopup-footer-bottom {
      position: relative;
      z-index: 1;
      margin-top: 48px;
      padding-top: 24px;
      border-top: var(--z-line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .ztopup-footer-copy {
      color: rgba(255,255,255,0.38);
      font-size: 13px;
      font-weight: 500;
    }
    .ztopup-footer-legal {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .ztopup-footer-legal a {
      color: rgba(255,255,255,0.45);
      text-decoration: none;
      font-size: 12px;
      font-weight: 600;
      transition: color 0.2s ease;
    }
    .ztopup-footer-legal a:hover { color: var(--z-gold); }
    @media (max-width: 560px) {
      .ztopup-footer-bottom {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
      }
    }
  `;

  /* =====================================================================
     HTML TEMPLATE
     ===================================================================== */
  function buildFooterHTML() {
    const corpLinks = CONFIG.corporate
      .map(
        (l) =>
          `<li><a href="${l.href}">${l.label}</a></li>`
      )
      .join('');

    const contactDetails = CONFIG.contact.details
      .map(
        (d) =>
          `<a href="${d.href}" aria-label="${d.type === 'phone' ? 'Telefon' : 'Email'}"><span class="icon-wrap">${ICONS[d.icon]}</span><span>${d.label}</span></a>`
      )
      .join('');

    const socialLinks = CONFIG.contact.channels
      .map(
        (ch) =>
          `<a href="${ch.href}" target="_blank" rel="noopener noreferrer" aria-label="${ch.name}">${ICONS[ch.icon]}</a>`
      )
      .join('');

    return `
      <footer class="ztopup-footer" role="contentinfo" aria-label="Sayt altbilgisi">
        <div class="ztopup-footer-inner">
          <div class="ztopup-footer-grid">
            <!-- COMPANY INFO -->
            <div class="ztopup-footer-brand">
              <div class="z-logo">
                <div class="z-logo-mark">
                  <img src="/assets/zelix-generated-logo.svg" alt="ZELIX TOPUP logo"/>
                </div>
                <div class="z-logo-text">ZELIX <span>TOPUP</span></div>
              </div>
              <p class="z-desc">${CONFIG.company.description}</p>
            </div>

            <!-- CORPORATE -->
            <nav class="ztopup-footer-section" aria-label="Korporativ linklər">
              <h3 class="ztopup-footer-title">Korporativ</h3>
              <ul class="ztopup-footer-links">
                ${corpLinks}
              </ul>
            </nav>

            <!-- CONTACT -->
            <div class="ztopup-footer-section">
              <h3 class="ztopup-footer-title">${CONFIG.contact.title}</h3>
              <div class="ztopup-footer-contact" aria-label="Telefon və email">
                ${contactDetails}
              </div>
              <div class="ztopup-footer-social" aria-label="Sosial şəbəkələr">
                ${socialLinks}
              </div>
            </div>
          </div>

          <!-- BOTTOM BAR -->
          <div class="ztopup-footer-bottom">
            <span class="ztopup-footer-copy">${CONFIG.copyright}</span>
            <nav class="ztopup-footer-legal" aria-label="Hüquqi linklər">
              <a href="/terms.html">İstifadə Şərtləri</a>
              <a href="/privacy.html">Məxfilik</a>
            </nav>
          </div>
        </div>
      </footer>
    `;
  }

  /* =====================================================================
     INJECT FOOTER + STYLES
     ===================================================================== */
  function init() {
    // Prevent double-injection
    if (document.querySelector('.ztopup-footer')) return;

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = FOOTER_STYLES;
    document.head.appendChild(styleEl);

    // Inject footer HTML
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildFooterHTML();
    const footer = wrapper.firstElementChild;
    document.body.appendChild(footer);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
