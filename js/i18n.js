// ARTIX i18n — zero-build, vanilla. English ships in the markup (source of truth); Icelandic is applied as an
// override map from js/i18n-dict.js. This module MUST mount FIRST (before cinematic/scramble/reveal) so the swapped
// text is in the DOM before any other module reads textContent. A language change RELOADS the page — that is the
// cheapest fully-correct path here: scramble.js caches each title's textContent at mount, so live-swapping the
// cinematic would desync it; on reload the fresh markup is re-localised before anything reads it, and the boot loader
// is sessionStorage-gated so it does not re-show. CSP-safe: same-origin module + innerHTML of authored, script-free
// formatting markup only.
import { IS } from '/js/i18n-dict.js';

const KEY = 'artix-lang';

function getLang(){ try { return localStorage.getItem(KEY) === 'is' ? 'is' : 'en'; } catch(e){ return 'en'; } }

// Apply the Icelandic overrides. Only called when lang === 'is'; English needs no work (it is already in the markup).
function applyIS(){
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const v = IS[el.getAttribute('data-i18n')];
    if(v != null) el.innerHTML = v;                    // authored formatting markup only — no scripts
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    // value is "attr:key" pairs separated by ';' — e.g. "content:home.meta.desc" or "aria-label:nav.menu"
    el.getAttribute('data-i18n-attr').split(';').forEach(pair => {
      const i = pair.indexOf(':'); if(i < 0) return;
      const attr = pair.slice(0, i).trim(), k = pair.slice(i + 1).trim();
      const v = IS[k];
      if(attr && v != null) el.setAttribute(attr, v);
    });
  });
}

// Reflect the active language on any toggle controls (segmented buttons carrying data-lang-btn="is|en").
function markToggles(lang){
  document.querySelectorAll('[data-lang-btn]').forEach(b => {
    const on = b.getAttribute('data-lang-btn') === lang;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.classList.toggle('is-active', on);
  });
}

function set(lang){
  lang = lang === 'is' ? 'is' : 'en';
  if(lang === getLang()){ markToggles(lang); return; }   // no-op if unchanged
  try { localStorage.setItem(KEY, lang); } catch(e){}
  location.reload();
}

let onClick;
export function init(){
  const lang = getLang();
  if(lang === 'is') applyIS();
  document.documentElement.setAttribute('lang', lang);
  markToggles(lang);
  // Auto-wire any language control so the header markup only needs data-lang-btn="is|en" — no per-page JS.
  onClick = (e) => {
    const b = e.target.closest('[data-lang-btn]'); if(!b) return;
    e.preventDefault(); set(b.getAttribute('data-lang-btn'));
  };
  document.addEventListener('click', onClick);
}
export function cleanup(){ if(onClick) document.removeEventListener('click', onClick); }

// Public API (also callable from the console / other modules).
window.__artixLang = { set, get: getLang, toggle(){ set(getLang() === 'is' ? 'en' : 'is'); } };
// Named global alias for programmatic callers.
window.setLang = (l) => set(l === 'is' ? 'is' : 'en');
