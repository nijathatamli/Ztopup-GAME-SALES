/**
 * ZELIX TOPUP — Canonical Logo Component
 *
 * Single source of truth for the logo used on all React-based pages.
 * Load this file as a plain <script> (NOT type="text/babel") after React is loaded:
 *
 *   <script src="/assets/logo-component.js"></script>
 *
 * Defines a global `Logo` function usable from any subsequent JSX/React script.
 * Uses React.createElement directly — no Babel transform required.
 */
(function (global) {
  function Logo(props) {
    var href      = (props && props.href      !== undefined) ? props.href      : '/';
    var className = (props && props.className !== undefined) ? props.className : '';

    var img = React.createElement('img', {
      className : 'h-[145%] w-[145%] object-cover drop-shadow-[0_0_10px_rgba(255,179,0,.55)]',
      src       : '/assets/zelix-generated-logo.svg',
      alt       : 'ZELIX TOPUP logo'
    });

    var mark = React.createElement('div', {
      className : 'grid h-12 w-12 flex-shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-200 via-gold to-orange-500 shadow-gold'
    }, img);

    var text = React.createElement('span', {
      className : 'font-orbitron text-xl font-black tracking-[.18em] text-gold'
    }, 'ZELIX TOPUP');

    var wrapClass = ('flex min-w-max items-center gap-3 ' + (className || '')).trim();

    if (href) {
      return React.createElement('a', { href: href, className: wrapClass + ' no-underline' }, mark, text);
    }
    return React.createElement('div', { className: wrapClass }, mark, text);
  }

  global.Logo = Logo;
})(window);
