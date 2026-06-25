// CONNECTOR FLOW — homepage only. A bright bead relays Manufacturers → ARTIX → End-users, lighting each pill as it
// passes (pure CSS animations). This module just starts the loop when the section enters view (and pauses it when not),
// so the infinite animation isn't burning frames off-screen. Reduced-motion / no-IO => static lit diagram.
let io;
export function init(){
  const d = document.querySelector('[data-flow]'); if(!d) return;
  if(matchMedia('(prefers-reduced-motion:reduce)').matches || !('IntersectionObserver' in window)){ d.classList.add('flow-static'); return; }
  io = new IntersectionObserver((ents) => ents.forEach(en => d.classList.toggle('is-flowing', en.isIntersecting)), { rootMargin:'0px 0px -10% 0px' });
  io.observe(d);
}
export function cleanup(){ io?.disconnect(); io = null; }
