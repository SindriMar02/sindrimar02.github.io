// Masthead: compact-on-scroll + ACCESSIBLE mobile drawer (focus trap, scroll lock, Esc) + same-page smooth scroll.
let mast, burger, drawer, ticking = false, lastFocus = null, lockedY = 0;
let onScroll, onBurger, onKey, onNavClick, onTrap;
function setStuck(){ if(mast) mast.classList.toggle('is-stuck', window.scrollY > 40); ticking = false; }
function focusables(){ return drawer ? [...drawer.querySelectorAll('a[href],button:not([disabled])')] : []; }
function openDrawer(){
  if(!drawer) return; lastFocus = document.activeElement;
  drawer.removeAttribute('hidden'); burger.setAttribute('aria-expanded','true'); burger.setAttribute('aria-label','Close menu');
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
  drawer.setAttribute('hidden',''); burger.setAttribute('aria-expanded','false'); burger.setAttribute('aria-label','Open menu');
  document.body.style.cssText = ''; window.scrollTo(0, lockedY);   // release the body lock + restore scroll position
  if(onTrap) drawer.removeEventListener('keydown', onTrap);
  (lastFocus && lastFocus.focus) ? lastFocus.focus() : burger.focus();
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
}
export function cleanup(){
  window.removeEventListener('scroll', onScroll); burger?.removeEventListener('click', onBurger);
  document.removeEventListener('keydown', onKey); document.removeEventListener('click', onNavClick);
  if(onTrap && drawer) drawer.removeEventListener('keydown', onTrap);
  document.body.style.cssText = ''; document.documentElement.style.overflow = '';
}
