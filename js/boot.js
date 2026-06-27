// LOADER — hold the overlay until the live HERO is actually preloaded + on screen, so the render is THERE the instant the loader
// lifts (no pop-in) AND the heavy frame preload happens behind the loading screen instead of competing with the entry wordmark decode.
// Readiness comes from two channels: the hero's LCP assets (fonts + first dive frame) AND a 'hero' progress signal (0..1; 1 = the WHOLE
// dive sequence is HTTP-cached + the WebGL canvas has painted) published by dive-lens. So the loader now holds until the entire dive is
// ready (not just the warm set) → the descent's fast 356-frame scrub never streams mid-flight. Meter reflects that real preload, HARD 12s
// cap (owner OK with a longer, honest load to avoid any in-experience lag), min ~600ms, Skip, once-per-session, settles "READY".
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
  offHero = onProgress('hero', (v) => { heroP = Math.max(heroP, v); if(heroP >= 1){ heroOK = true; maybeRelease(); } });   // event-driven: release the moment the hero reports ready, not only on the next rAF tick
  const decode = (src) => new Promise(r => { const im = new Image(); im.onload = im.onerror = () => r(); im.src = src; });
  let assetsOK = false;
  Promise.all([ document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve(), decode('/assets/dive-frames/frame-0001.webp') ]).then(() => { assetsOK = true; maybeRelease(); });
  for(let i = 1; i <= 12; i++) decode('/assets/dive-frames/frame-' + ('000' + i).slice(-4) + '.webp');   // warm the dive opener (covers the mobile/no-WebGL paths too)
  function finish(){ cancelAnimationFrame(raf); if(offHero){ offHero(); offHero = null; } document.documentElement.style.overflow = ''; sessionStorage.setItem('artix-booted', '1'); overlay.classList.add('is-done'); announce(); setTimeout(() => overlay.remove(), 700); }
  function release(){ done = true; }
  let minTimer = 0;
  function maybeRelease(){ if(done || !assetsOK || !heroOK) return;
    const left = min - (Date.now() - t0);
    if(left <= 0){ release(); }                                  // hero + assets ready and the min show-time has elapsed → go
    else if(!minTimer){ minTimer = setTimeout(maybeRelease, left); }   // ready early — wait out the remaining min show-time (one timer), so the loader never just flashes
  }
  function tick(){ maybeRelease();
    const target = done ? 100 : Math.min(94, Math.max(p, heroP * 94));   // bar follows REAL preload (painted ⇒ ~38%, warm ⇒ 94%); the +0.5 creep keeps it alive so a longer load never looks frozen
    p += (target - p) * 0.08 + 0.5; const shown = Math.min(100, Math.round(p));
    if(fill) fill.style.transform = 'scaleX(' + (shown / 100) + ')'; if(pct) pct.textContent = (done && shown >= 100 ? 'READY' : Math.min(99, shown) + '%');
    if(shown >= 100 && done){ finish(); return; } raf = requestAnimationFrame(tick); }
  setTimeout(release, 12000); if(skip) skip.addEventListener('click', release); tick();   // 12s hard cap (raised from 8s now the gate waits for the full dive cache) — if the network is slow, the in-page warm-gate + windowed decode still cover any stragglers
}
export function cleanup(){ cancelAnimationFrame(raf); if(offHero){ offHero(); offHero = null; } document.documentElement.style.overflow = ''; }
