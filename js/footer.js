// Footer: reveal the column on enter (CSS .is-in) + drive the radar's live UTC clock + LAZY-load the Iceland⇄helm morph.
let io, clockTimer, morphLoaded = false;
function startClock(){
  const clock = document.querySelector('.fr-clock'); if(!clock) return;
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => { const d = new Date(); clock.textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC'; };
  tick(); clockTimer = setInterval(tick, 1000);
}
// Only pull in the morph (and flubber) when the footer is actually approached — keeps it off the critical path.
function startMorph(){ if(morphLoaded) return; morphLoaded = true; import('/js/footer-morph.js').then(m => m.init && m.init()).catch(() => {}); }
// Draw a PPI-scope bearing + range scale into the radar grid: 30° tick ring (majors at the cardinals), 000/090/180/270
// bearing labels, and 50/100/200 NM range-ring labels. Static + decorative (the grid is aria-hidden).
function buildRadarScale(){
  const grid = document.querySelector('.fr-grid'); if(!grid || grid.dataset.scaled) return; grid.dataset.scaled = '1';
  const NS = 'http://www.w3.org/2000/svg', cx = 100, cy = 100, R = 94;
  const el = (n, a, txt) => { const e = document.createElementNS(NS, n); for(const k in a) e.setAttribute(k, a[k]); if(txt != null) e.textContent = txt; return e; };
  const pt = (b, r) => [cx + r * Math.sin(b * Math.PI / 180), cy - r * Math.cos(b * Math.PI / 180)];
  const frag = document.createDocumentFragment();
  for(let b = 0; b < 360; b += 30){                                   // bearing ticks
    const major = b % 90 === 0, [x1, y1] = pt(b, major ? R - 12 : R - 6), [x2, y2] = pt(b, R);
    frag.appendChild(el('line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), class: 'fr-tick' + (major ? ' fr-tick-major' : '') }));
  }
  [[0, '000'], [90, '090'], [180, '180'], [270, '270']].forEach(([b, t]) => {   // cardinal bearings
    const [x, y] = pt(b, R - 23); frag.appendChild(el('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'fr-bearing' }, t));
  });
  [[94, '200'], [64, '100'], [34, '50']].forEach(([r, t]) => {        // range rings (NM), along the SE diagonal so they clear the cardinals
    const [x, y] = pt(135, r - 5); frag.appendChild(el('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'fr-range' }, t));
  });
  grid.appendChild(frag);
}
export function init(){
  buildRadarScale();
  const inner = document.querySelector('.site-footer .footer-col'); if(!inner) return;
  const footerEl = inner.closest('.site-footer');
  const reveal = () => { inner.classList.add('is-in'); if(footerEl) footerEl.classList.add('is-in'); startMorph(); };   // .is-in also fades the blueprint grid in
  if(!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion:reduce)').matches){ reveal(); startClock(); return; }
  // gate the 1Hz UTC clock on footer visibility (it sat at the bottom of a long page ticking forever) — keep the IO connected to toggle it
  io = new IntersectionObserver((ents) => ents.forEach(en => {
    if(en.isIntersecting){ reveal(); if(!clockTimer) startClock(); }
    else if(clockTimer){ clearInterval(clockTimer); clockTimer = null; }
  }), { rootMargin:'0px 0px -20% 0px' });
  io.observe(inner);
}
export function cleanup(){ io?.disconnect(); if(clockTimer){ clearInterval(clockTimer); clockTimer = null; } }
