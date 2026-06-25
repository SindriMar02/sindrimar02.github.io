// Fire-once enter reveals for [data-reveal] (info routes). Stagger via data-reveal-index. Reduced-motion = show immediately.
// Eyebrows additionally scramble-decode on entry, matching the cinematic's mission-brief language.
import { scramble } from '/js/scramble.js';
let io;
export function init(){
  const els = [...document.querySelectorAll('[data-reveal]:not(.is-in)')]; if(!els.length) return;
  if(!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion:reduce)').matches){ els.forEach(e => e.classList.add('is-in')); return; }
  io = new IntersectionObserver((ents) => ents.forEach(en => { if(en.isIntersecting){ const el = en.target;
    const delay = Math.min(+(el.dataset.revealIndex||0), 6) * 120;
    el.style.transitionDelay = delay + 'ms'; el.classList.add('is-in');
    if(el.classList.contains('eyebrow')) setTimeout(() => scramble(el, { duration: 560, spread: 0.6 }), delay + 60);
    io.unobserve(el); } }),
    { rootMargin: '0px 0px -12% 0px' });
  els.forEach(e => io.observe(e));
}
export function cleanup(){ io?.disconnect(); }
