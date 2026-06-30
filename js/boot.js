// LOADER — hold the overlay until the live HERO is actually preloaded + on screen, so the render is THERE the instant the loader
// lifts (no pop-in) AND the heavy frame preload happens behind the loading screen instead of competing with the entry wordmark decode.
// Readiness = the hero's LCP assets (fonts + first dive frame) AND a 'hero' progress signal (0..1) published by dive-lens. The loader
// lifts at WARM (heroP ≥ 0.6 = painted + opening frames decoded), NOT the full dive cache — the SITE MUST BE USABLE FAST (owner: don't
// make the loading screen wait for 24MB). The rest of the dive streams in the BACKGROUND afterward; the in-page warm-gate holds the
// descent SCROLL until that finishes so the fast scrub still never streams mid-flight. Meter maps painted→warm to 0→94%, HARD 8s cap
// (failsafe only — warm is small, so it lifts in ~1s normally), min ~600ms, Skip, once-per-session, settles "READY".
import { onProgress } from '/js/progress-bus.js';
let raf, offHero;
export function init(){
  const overlay = document.querySelector('.boot'); if(!overlay) return;
  const announce = () => requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('artix:booted')));
  if(sessionStorage.getItem('artix-booted')){ overlay.remove(); announce(); return; }
  document.documentElement.style.overflow = 'hidden';
  const fill = overlay.querySelector('.boot-fill'), pct = overlay.querySelector('.boot-pct'), skip = overlay.querySelector('.boot-skip');
  const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  let done = false, p = 0; const t0 = Date.now(), min = reduce ? 0 : 600;
  // hero readiness (0..1) — published by the desktop WebGL dive (warm + painted) or set to 1 by the mobile/no-WebGL paths (their hero
  // is just the poster + fonts, already covered below). heroP is monotonic; heroOK once it hits 1. Capped by the 8s failsafe.
  let heroP = 0, heroOK = false;
  offHero = onProgress('hero', (v) => { heroP = Math.max(heroP, v); if(heroP >= 0.6){ heroOK = true; maybeRelease(); } });   // RELEASE at WARM (0.6 = hero painted + the opening frames decoded), NOT the full dive cache — the site must be usable fast; the rest of the dive streams in the BACKGROUND (bulk prefetch already started at warm) and the in-page warm-gate holds the descent SCROLL until cached so it still never stutters
  const decode = (src) => new Promise(r => { const im = new Image(); im.onload = im.onerror = () => r(); im.src = src; });
  let assetsOK = false;
  Promise.all([ document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve(), decode('/assets/dive-frames/frame-0001.webp') ]).then(() => { assetsOK = true; maybeRelease(); });
  // NOTE: frames 2-12 are NOT separately warmed here — dive-lens.js's own bounded-concurrency warm set (frames 1-50) already covers
  // them with its own retry/stall-watchdog logic; a second independent Image+decode() per frame here was pure duplicate decode work,
  // stacking on the exact frames most contended during cold load (owner: "sometimes images don't load on first open").
  function finish(){ cancelAnimationFrame(raf); if(offHero){ offHero(); offHero = null; } document.documentElement.style.overflow = ''; sessionStorage.setItem('artix-booted', '1'); overlay.classList.add('is-done'); announce(); setTimeout(() => overlay.remove(), 700); }
  function release(){ done = true; }
  let minTimer = 0;
  function maybeRelease(){ if(done || !assetsOK || !heroOK) return;
    const left = min - (Date.now() - t0);
    if(left <= 0){ release(); }                                  // hero + assets ready and the min show-time has elapsed → go
    else if(!minTimer){ minTimer = setTimeout(maybeRelease, left); }   // ready early — wait out the remaining min show-time (one timer), so the loader never just flashes
  }
  function tick(){ maybeRelease();
    const target = done ? 100 : Math.min(94, Math.max(p, (heroP / 0.6) * 94));   // bar maps the 0→0.6 (painted→warm) release window to 0→94%; +0.5 creep keeps it alive so it never looks frozen
    p += (target - p) * 0.08 + 0.5; const shown = Math.min(100, Math.round(p));
    if(fill) fill.style.transform = 'scaleX(' + (shown / 100) + ')'; if(pct) pct.textContent = (done && shown >= 100 ? 'READY' : Math.min(99, shown) + '%');
    if(shown >= 100 && done){ finish(); return; } raf = requestAnimationFrame(tick); }
  setTimeout(release, 8000); if(skip) skip.addEventListener('click', release); tick();   // 8s hard cap — the loader only waits for the WARM hero now (small), so it lifts in ~1s on a normal connection; the full 24MB dive streams in the background after. Failsafe only for a stalled warm load.
}
export function cleanup(){ cancelAnimationFrame(raf); if(offHero){ offHero(); offHero = null; } document.documentElement.style.overflow = ''; }
