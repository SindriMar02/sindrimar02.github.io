// One low-lerp smooth-scroll layer (Lenis) unified onto GSAP's single rAF tick (digest §10.1). Native scroll under reduced-motion.
let lenis, tickerCb, stDirty = false;
export function init(){
  if(matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  if(typeof Lenis === 'undefined' || typeof gsap === 'undefined') return;
  lenis = new Lenis({ lerp: 0.10, smoothWheel: true, wheelMultiplier: 0.8, touchMultiplier: 0.9 });   // calm the raw scroll a touch (owner: trackpad felt too sensitive)
  window.__lenis = lenis;                 // exposed so the cinematic's "skip intro" can smooth-scroll past the pin
  // collapse ScrollTrigger geometry recalcs to AT MOST once per animation frame (was firing per scroll event)
  lenis.on('scroll', () => { stDirty = true; });
  tickerCb = (t) => { if(lenis) lenis.raf(t * 1000); if(stDirty && typeof ScrollTrigger !== 'undefined'){ ScrollTrigger.update(); stDirty = false; } };
  gsap.ticker.add(tickerCb); gsap.ticker.lagSmoothing(0);
}
export function cleanup(){
  if(tickerCb && typeof gsap !== 'undefined'){ gsap.ticker.remove(tickerCb); gsap.ticker.lagSmoothing(500, 33); }
  tickerCb = null; try { lenis && lenis.destroy(); } catch(e){} lenis = null;
}
