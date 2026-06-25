// BORDER GLOW — ice/cyan, cursor-following border glow on the capability (.bento-card) grid (replaces the old static ice hover ring).
// Recreated in vanilla JS/CSS from React Bits "BorderGlow" (JS-CSS, pointer/hover mode). On pointermove over a card we set
// two CSS vars: --cg-edge (0–100, how close the cursor is to an edge) and --cg-angle (the cursor's bearing from card centre, deg).
// CSS (.bento-card.cg-on::before/::after) reveals an ember border + inner bloom only in the wedge facing the cursor, so the glow
// rides the border under the pointer. rAF-throttled, one shared frame for all cards. Gated to fine pointers + motion-OK (skip touch).
let cards = [], onMove, onLeave, raf = 0, pending = null;

// Port of React Bits getEdgeProximity (0 at centre → 1 at edge) + getCursorAngle (atan2 + 90°, normalised 0–360).
function apply(card, x, y){
  const r = card.getBoundingClientRect();
  if(!r.width || !r.height) return;
  const cx = r.width / 2, cy = r.height / 2;
  const dx = (x - r.left) - cx, dy = (y - r.top) - cy;
  const kx = dx !== 0 ? cx / Math.abs(dx) : Infinity;
  const ky = dy !== 0 ? cy / Math.abs(dy) : Infinity;
  const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
  let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
  if(deg < 0) deg += 360;
  card.style.setProperty('--cg-edge', (edge * 100).toFixed(1));
  card.style.setProperty('--cg-angle', deg.toFixed(1) + 'deg');
}

export function init(){
  if(matchMedia('(prefers-reduced-motion:reduce)').matches) return;          // motion-off: no glow
  if(!matchMedia('(hover:hover) and (pointer:fine)').matches) return;          // touch/coarse pointer: skip (no hover)
  cards = [...document.querySelectorAll('.bento-card')];
  if(!cards.length) return;
  onMove = (e) => {                                                            // capture position now; compute on the next frame
    pending = { card: e.currentTarget, x: e.clientX, y: e.clientY };
    if(!raf) raf = requestAnimationFrame(() => { raf = 0; const p = pending; if(p) apply(p.card, p.x, p.y); });
  };
  onLeave = (e) => { e.currentTarget.style.setProperty('--cg-edge', '0'); };   // fade out (CSS opacity transition handles the easing)
  cards.forEach(c => {
    c.classList.add('cg-on');
    c.addEventListener('pointermove', onMove, { passive: true });
    c.addEventListener('pointerleave', onLeave, { passive: true });
  });
}

export function cleanup(){
  if(raf){ cancelAnimationFrame(raf); raf = 0; }
  pending = null;
  cards.forEach(c => { c.classList.remove('cg-on'); c.removeEventListener('pointermove', onMove); c.removeEventListener('pointerleave', onLeave); });
  cards = [];
}
