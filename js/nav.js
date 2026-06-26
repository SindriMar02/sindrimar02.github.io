// Masthead: compact-on-scroll + ACCESSIBLE mobile drawer (focus trap, scroll lock, Esc) + same-page smooth scroll.
let mast, burger, drawer, ticking = false, lastFocus = null, lockedY = 0;
let onScroll, onBurger, onKey, onNavClick, onTrap;
// desktop dropdown disclosure menus (Solutions / future Network groups)
let groups = [], openGroup = null, hoverTimer = null;
let onMastKey, onDocDown, onMastScroll, onMastResize;
// localized burger aria-label (the static initial value comes from data-i18n-attr; this covers the dynamic open/close swap)
function burgerLabel(open){ const is = document.documentElement.lang === 'is'; return open ? (is ? 'Loka valmynd' : 'Close menu') : (is ? 'Opna valmynd' : 'Open menu'); }
function setStuck(){ if(mast) mast.classList.toggle('is-stuck', window.scrollY > 40); ticking = false; }
function focusables(){ return drawer ? [...drawer.querySelectorAll('a[href],button:not([disabled])')] : []; }
function openDrawer(){
  if(!drawer) return; lastFocus = document.activeElement;
  drawer.removeAttribute('hidden'); burger.setAttribute('aria-expanded','true'); burger.setAttribute('aria-label', burgerLabel(true));
  // iOS-safe scroll lock: <html>overflow:hidden is ignored by Safari (page rubber-bands). Pin the body with position:fixed.
  lockedY = window.scrollY;
  document.body.style.cssText = 'position:fixed;top:' + (-lockedY) + 'px;left:0;right:0;width:100%;';
  focusables()[0]?.focus();
  onTrap = (e) => { if(e.key !== 'Tab') return; const f = focusables(); if(!f.length) return;
    const first = f[0], last = f[f.length-1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); } };
  drawer.addEventListener('keydown', onTrap);
}
function closeDrawer(){
  if(!drawer || drawer.hasAttribute('hidden')) return;
  drawer.setAttribute('hidden',''); burger.setAttribute('aria-expanded','false'); burger.setAttribute('aria-label', burgerLabel(false));
  document.body.style.cssText = ''; window.scrollTo(0, lockedY);   // release the body lock + restore scroll position
  if(onTrap) drawer.removeEventListener('keydown', onTrap);
  (lastFocus && lastFocus.focus) ? lastFocus.focus() : burger.focus();
}
// ---- DESKTOP DROPDOWN DISCLOSURE CONTROLLER — delegated, selector-based (a 3rd group needs NO JS change).
//      Disclosure menus (not a trapped menubar): Tab flows out naturally; Esc returns focus to the trigger.
//      Bound regardless of viewport — the panels are display:none ≤860px (drawer owns nav there), so the
//      handlers are inert on mobile and survive a resize across the breakpoint.
function menuItemsOf(g){ return [...g.menu.querySelectorAll('[role="menuitem"]')]; }
function openMenu(g, focusIdx){
  if(openGroup && openGroup !== g) closeMenu(openGroup, false);
  g.menu.hidden = false; g.trigger.setAttribute('aria-expanded','true'); openGroup = g;
  if(focusIdx != null){ const items = menuItemsOf(g); (items[focusIdx] || items[0])?.focus(); }
}
function closeMenu(g, returnFocus){
  if(!g || g.menu.hidden) return;
  g.menu.hidden = true; g.trigger.setAttribute('aria-expanded','false');
  if(openGroup === g) openGroup = null;
  if(returnFocus) g.trigger.focus();
}
function closeAllMenus(returnFocus){ if(openGroup) closeMenu(openGroup, returnFocus); }
function initDropdowns(){
  groups = [...mast.querySelectorAll('.mast-group')].map(group => ({ group, trigger: group.querySelector('.mast-trigger'), menu: group.querySelector('.mast-menu') })).filter(g => g.trigger && g.menu);
  if(!groups.length) return;
  groups.forEach(g => {
    g.trigger.addEventListener('click', () => { g.menu.hidden ? openMenu(g, null) : closeMenu(g, false); });
    g.group.addEventListener('pointerenter', () => { if(matchMedia('(hover:hover)').matches){ clearTimeout(hoverTimer); openMenu(g, null); } });
    g.group.addEventListener('pointerleave', () => { if(matchMedia('(hover:hover)').matches){ clearTimeout(hoverTimer); hoverTimer = setTimeout(() => closeMenu(g, false), 120); } });
    g.trigger.addEventListener('keydown', (e) => { const items = menuItemsOf(g);
      switch(e.key){
        case 'ArrowDown': case 'Enter': case ' ': e.preventDefault(); openMenu(g, 0); break;
        case 'ArrowUp': e.preventDefault(); openMenu(g, items.length - 1); break;
        case 'Escape': closeMenu(g, true); break;
      } });
    g.menu.addEventListener('keydown', (e) => { const items = menuItemsOf(g); const i = items.indexOf(document.activeElement);
      switch(e.key){
        case 'ArrowDown': e.preventDefault(); items[(i + 1) % items.length].focus(); break;
        case 'ArrowUp': e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); break;
        case 'Home': e.preventDefault(); items[0].focus(); break;
        case 'End': e.preventDefault(); items[items.length - 1].focus(); break;
        case 'Escape': e.preventDefault(); closeMenu(g, true); break;
        case 'Tab': closeMenu(g, false); break;
      } });
  });
  onDocDown = (e) => { if(openGroup && !openGroup.group.contains(e.target)) closeAllMenus(false); };
  document.addEventListener('pointerdown', onDocDown);
  onMastKey = (e) => { if(e.key === 'Escape' && openGroup) closeAllMenus(true); };
  document.addEventListener('keydown', onMastKey);
  onMastScroll = () => closeAllMenus(false);
  window.addEventListener('scroll', onMastScroll, { passive:true });
  onMastResize = () => { if(matchMedia('(max-width:860px)').matches) closeAllMenus(false); };
  window.addEventListener('resize', onMastResize, { passive:true });
}
// active-ancestor: mark the group whose child is the current page so the collapsed trigger keeps the cyan affordance
function markAncestors(){
  document.querySelectorAll('.mast-group').forEach(group => { group.toggleAttribute('data-current', !!group.querySelector('a[aria-current="page"]')); });
}
export function init(){
  mast = document.querySelector('[data-masthead]'); if(!mast) return;
  burger = mast.querySelector('.mast-burger'); drawer = document.getElementById('mast-drawer');
  // you-are-here: mark the current nav link (skip the home brand + the CTA)
  const path = location.pathname.replace(/index\.html$/, '');
  document.querySelectorAll('.mast-nav a[href], .mast-drawer a[href]:not(.mast-cta)').forEach(a => {
    const href = a.getAttribute('href');
    if(href && href !== '/' && path === href) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  setStuck();
  onScroll = () => { if(!ticking){ ticking = true; requestAnimationFrame(setStuck); } };
  window.addEventListener('scroll', onScroll, { passive:true });
  if(burger && drawer){
    onBurger = () => { drawer.hasAttribute('hidden') ? openDrawer() : closeDrawer(); };
    burger.addEventListener('click', onBurger);
    onKey = (e) => { if(e.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', onKey);
  }
  onNavClick = (e) => {
    const a = e.target.closest('a[href^="#"]'); if(!a) return;
    const el = document.querySelector(a.getAttribute('href')); if(!el) return;
    e.preventDefault(); closeDrawer();
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
    el.setAttribute('tabindex','-1'); el.focus({ preventScroll:true });   // move focus, not just scroll
  };
  document.addEventListener('click', onNavClick);
  markAncestors();   // after the you-are-here pass above
  initDropdowns();
}
export function cleanup(){
  window.removeEventListener('scroll', onScroll); burger?.removeEventListener('click', onBurger);
  document.removeEventListener('keydown', onKey); document.removeEventListener('click', onNavClick);
  if(onTrap && drawer) drawer.removeEventListener('keydown', onTrap);
  document.removeEventListener('pointerdown', onDocDown); document.removeEventListener('keydown', onMastKey);
  window.removeEventListener('scroll', onMastScroll); window.removeEventListener('resize', onMastResize);
  clearTimeout(hoverTimer);
  document.body.style.cssText = ''; document.documentElement.style.overflow = '';
}
