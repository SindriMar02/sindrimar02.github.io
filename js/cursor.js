// SITE-WIDE custom cursor — "Reticle Lock". A square targeting bracket (four L-corners + a centre dot) tracks the
// pointer, then eases inward and tints ember when the pointer reaches an interactive target (lock). Mounts on EVERY
// page (homepage + info routes). Gated on pointer:fine + not reduced-motion. aria-hidden + pointer-events:none;
// layered ABOVE :focus-visible (never replaces it). Off on touch / reduced-motion.
let cur, onMove, onOver, onOut, onLeave, raf = 0, px = 0, py = 0, shown = false;
const LOCK = 'a,button,input,textarea,select,summary,[role="button"],[data-target],label[for]';   // Spec v1 §05 lock affordances
export function init(){
  if(!(matchMedia('(pointer:fine)').matches && !matchMedia('(prefers-reduced-motion:reduce)').matches)) return;
  cur = document.createElement('div');
  cur.className = 'rl-cursor';
  cur.setAttribute('aria-hidden', 'true');
  cur.innerHTML = '<div class="rl-box"><span class="rl-c tl"></span><span class="rl-c tr"></span><span class="rl-c bl"></span><span class="rl-c br"></span><span class="rl-dot"></span></div>';
  document.body.appendChild(cur);
  document.body.classList.add('has-cursor');
  // Coalesce moves to ONE transform write per animation frame. A high-Hz mouse (or pointermove's own coalesced
  // events) can fire several times per frame; with mix-blend-mode:difference EACH write forces a backdrop recomposite,
  // so batching to rAF removes the redundant repaints → no stutter. Latency is ≤1 frame (imperceptible); still 1:1.
  const paint = () => {
    raf = 0;
    cur.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)';
    if(!shown){ shown = true; cur.classList.add('is-on'); }
  };
  onMove = (e) => {
    if(e.pointerType === 'touch') return;
    px = e.clientX; py = e.clientY;                        // store the latest position…
    if(!raf) raf = requestAnimationFrame(paint);           // …and write it at most once per frame
  };
  onLeave = () => { shown = false; cur.classList.remove('is-on'); };
  onOver = (e) => { if(e.target.closest && e.target.closest(LOCK)) cur.classList.add('is-lock'); };
  onOut = (e) => { const to = e.relatedTarget; if(!to || !(to.closest && to.closest(LOCK))) cur.classList.remove('is-lock'); };
  window.addEventListener('pointermove', onMove, { passive:true });
  document.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointerover', onOver, { passive:true });
  document.addEventListener('pointerout', onOut, { passive:true });
}
export function cleanup(){
  if(raf){ cancelAnimationFrame(raf); raf = 0; } shown = false;
  window.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerleave', onLeave);
  document.removeEventListener('pointerover', onOver);
  document.removeEventListener('pointerout', onOut);
  cur?.remove();
  document.body.classList.remove('has-cursor');
}
