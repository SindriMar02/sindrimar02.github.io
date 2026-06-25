// HOMEPAGE-ONLY custom cursor — "Reticle Lock". A square targeting bracket (four L-corners + a centre dot) tracks the
// pointer 1:1 (NO lerp — instant), then eases inward and tints ember when the pointer reaches an interactive target (lock).
// Gated on body.home + pointer:fine + not reduced-motion. aria-hidden + pointer-events:none; layered ABOVE :focus-visible
// (never replaces it). Never mounts on info routes (they lack body.home) or on touch / reduced-motion.
let cur, onMove, onOver, onOut, onLeave;
const LOCK = 'a,button,input,textarea,select,summary,[role="button"],[data-target],label[for]';   // Spec v1 §05 lock affordances
export function init(){
  if(!(document.body.classList.contains('home') && matchMedia('(pointer:fine)').matches && !matchMedia('(prefers-reduced-motion:reduce)').matches)) return;
  cur = document.createElement('div');
  cur.className = 'rl-cursor';
  cur.setAttribute('aria-hidden', 'true');
  cur.innerHTML = '<div class="rl-box"><span class="rl-c tl"></span><span class="rl-c tr"></span><span class="rl-c bl"></span><span class="rl-c br"></span><span class="rl-dot"></span></div>';
  document.body.appendChild(cur);
  document.body.classList.add('has-cursor');
  onMove = (e) => {
    if(e.pointerType === 'touch') return;
    cur.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';   // 1:1, transform-only (no rAF lerp)
    if(!cur.classList.contains('is-on')) cur.classList.add('is-on');
  };
  onLeave = () => cur.classList.remove('is-on');
  onOver = (e) => { if(e.target.closest && e.target.closest(LOCK)) cur.classList.add('is-lock'); };
  onOut = (e) => { const to = e.relatedTarget; if(!to || !(to.closest && to.closest(LOCK))) cur.classList.remove('is-lock'); };
  window.addEventListener('pointermove', onMove, { passive:true });
  document.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointerover', onOver, { passive:true });
  document.addEventListener('pointerout', onOut, { passive:true });
}
export function cleanup(){
  window.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerleave', onLeave);
  document.removeEventListener('pointerover', onOver);
  document.removeEventListener('pointerout', onOut);
  cur?.remove();
  document.body.classList.remove('has-cursor');
}
