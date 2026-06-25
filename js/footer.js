// Footer: reveal the column + blueprint grid on enter (CSS toggles .is-in). The old radar dial, the Iceland⇄helm
// morph (footer-morph.js) and the live UTC clock were removed — the footer now shows just a slowly BREATHING helm
// mark (pure CSS, see .fh-mark / @keyframes helmBreath in site.css). Nothing here needs to run per-frame.
let io;
export function init(){
  const inner = document.querySelector('.site-footer .footer-col'); if(!inner) return;
  const footerEl = inner.closest('.site-footer');
  const reveal = () => { inner.classList.add('is-in'); if(footerEl) footerEl.classList.add('is-in'); };   // .is-in also fades the blueprint grid in
  if(!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion:reduce)').matches){ reveal(); return; }
  io = new IntersectionObserver((ents) => ents.forEach(en => {
    if(en.isIntersecting){ reveal(); io.disconnect(); io = null; }   // one-shot: nothing to toggle back off anymore
  }), { rootMargin:'0px 0px -20% 0px' });
  io.observe(inner);
}
export function cleanup(){ io?.disconnect(); io = null; }
