// LOADER — gate release ONLY on the hero's real LCP assets (fonts + first story frame); warm the first chapter frames in the
// background (don't block first paint). Meter eases, min ~600ms, HARD 4s max-wait, Skip, once-per-session, settles "READY".
let raf;
export function init(){
  const overlay = document.querySelector('.boot'); if(!overlay) return;
  const announce = () => requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('artix:booted')));
  if(sessionStorage.getItem('artix-booted')){ overlay.remove(); announce(); return; }
  document.documentElement.style.overflow = 'hidden';
  const fill = overlay.querySelector('.boot-fill'), pct = overlay.querySelector('.boot-pct'), skip = overlay.querySelector('.boot-skip');
  const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  let done = false, p = 0; const t0 = Date.now(), min = reduce ? 0 : 600;
  const decode = (src) => new Promise(r => { const im = new Image(); im.onload = im.onerror = () => r(); im.src = src; });
  const ready = [ document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve(), decode('/assets/dive-frames/frame-0001.webp') ];
  for(let i = 1; i <= 12; i++) decode('/assets/dive-frames/frame-' + ('000' + i).slice(-4) + '.webp');   // warm the ACTIVE dive opener (was the retired descent-frames), not gated
  function finish(){ cancelAnimationFrame(raf); document.documentElement.style.overflow = ''; sessionStorage.setItem('artix-booted', '1'); overlay.classList.add('is-done'); announce(); setTimeout(() => overlay.remove(), 700); }
  function release(){ done = true; }
  function tick(){ const target = done ? 100 : Math.min(94, p); p += (target - p) * 0.08 + 0.5; const shown = Math.min(100, Math.round(p));
    if(fill) fill.style.transform = 'scaleX(' + (shown / 100) + ')'; if(pct) pct.textContent = (shown >= 100 ? 'READY' : shown + '%');
    if(shown >= 100 && done){ finish(); return; } raf = requestAnimationFrame(tick); }
  Promise.all(ready).then(() => setTimeout(release, Math.max(0, min - (Date.now() - t0))));
  setTimeout(release, 4000); if(skip) skip.addEventListener('click', release); tick();
}
export function cleanup(){ cancelAnimationFrame(raf); document.documentElement.style.overflow = ''; }
