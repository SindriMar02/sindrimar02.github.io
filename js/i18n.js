// ARTIX i18n — zero-build, vanilla. English ships in the markup (source of truth); Icelandic is applied as an
// override map from js/i18n-dict.js. This module MUST mount FIRST (before cinematic/scramble/reveal) so the swapped
// text is in the DOM before any other module reads textContent.
//
// LANGUAGE SWAP IS LIVE — IN PLACE, NO RELOAD. The scroll position is never touched: we swap the text/attributes of every
// [data-i18n]/[data-i18n-attr] node, drop any stale scramble-split state on those nodes, fire 'artix:lang', and let the
// page re-decode whatever is on-screen into the new language (info-page eyebrows here; the homepage cinematic + its canvas
// wordmark slogan via the event, in cinematic.js). The original ENGLISH is snapshotted on each node at init so we can swap
// BACK to EN without a reload too. CSP-safe: same-origin module + innerHTML of authored, script-free formatting markup only.
import { IS } from '/js/i18n-dict.js';
import { scramble } from '/js/scramble.js';

const KEY = 'artix-lang';
const reduce = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < (window.innerHeight || 0); };

function getLang(){ try { return localStorage.getItem(KEY) === 'is' ? 'is' : 'en'; } catch(e){ return 'en'; } }

// Snapshot the original English on every localised node ONCE, before any override is applied — so a later swap back to EN
// restores the real markup (the IS overrides overwrite innerHTML, so EN can't be recovered from the DOM afterwards).
function snapshotEN(){
  document.querySelectorAll('[data-i18n]').forEach(el => { if(el.__i18nEN == null) el.__i18nEN = el.innerHTML; });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    if(el.__i18nAttrEN) return;
    const m = {};
    el.getAttribute('data-i18n-attr').split(';').forEach(pair => {
      const i = pair.indexOf(':'); if(i < 0) return;
      const attr = pair.slice(0, i).trim();
      if(attr) m[attr] = el.getAttribute(attr);
    });
    el.__i18nAttrEN = m;
  });
}

// Drop scramble.js's per-element split cache so a re-scramble re-reads the freshly-swapped text instead of replaying the
// old language from el.dataset.text / el._chars (scramble caches both on first run and won't rebuild while data-split=1).
function dropScrambleState(el){
  if(el._raf){ try { cancelAnimationFrame(el._raf); } catch(e){} el._raf = null; }
  el.removeAttribute('data-split');   // el.dataset.split
  el.removeAttribute('data-text');    // el.dataset.text (the cached original string)
  el._chars = null;
}

// Swap every localised node to `lang`. IS = override map (falls back to the EN snapshot for any un-mapped key); EN = the
// snapshot. Only writes when the value actually changes, and clears scramble state on any node it rewrites.
function swapText(lang){
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    const v = lang === 'is' ? (IS[k] != null ? IS[k] : el.__i18nEN) : el.__i18nEN;
    if(v != null && el.innerHTML !== v){ el.innerHTML = v; dropScrambleState(el); }
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.getAttribute('data-i18n-attr').split(';').forEach(pair => {
      const i = pair.indexOf(':'); if(i < 0) return;
      const attr = pair.slice(0, i).trim(), k = pair.slice(i + 1).trim();
      const en = el.__i18nAttrEN ? el.__i18nAttrEN[attr] : null;
      const v = lang === 'is' ? (IS[k] != null ? IS[k] : en) : en;
      if(attr && v != null) el.setAttribute(attr, v);
    });
  });
}

// Re-decode the simple scramble targets that aren't owned by the cinematic (info-page eyebrows). The homepage cinematic
// (chapter titles/subs/eyebrows) and its canvas wordmark slogan are re-decoded in cinematic.js off the same 'artix:lang' event.
function rescrambleGeneric(){
  if(reduce()) return;
  document.querySelectorAll('.eyebrow[data-i18n]').forEach(el => {
    if(el.closest('.cinematic')) return;          // homepage cinematic eyebrows are handled by cinematic.js
    if(!inView(el)) return;
    scramble(el, { duration: 520, spread: 0.6 });
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
  if(lang === getLang()){ markToggles(lang); return; }     // no-op if unchanged
  try { localStorage.setItem(KEY, lang); } catch(e){}
  swapText(lang);                                           // 1) text/attrs swap in place — scroll position untouched
  document.documentElement.setAttribute('lang', lang);
  markToggles(lang);
  document.dispatchEvent(new CustomEvent('artix:lang', { detail: { lang } }));   // 2) let owners re-decode (cinematic + its canvas slogan)
  rescrambleGeneric();                                      // 3) re-scramble visible info-page eyebrows so the swap reads as a decode
}

let onClick;
export function init(){
  snapshotEN();                                            // capture EN before any override — required for a live swap BACK to EN
  const lang = getLang();
  if(lang === 'is') swapText('is');                        // initial paint in IS (EN is already in the markup)
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
