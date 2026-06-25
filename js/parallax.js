// Subtle scroll parallax on full-bleed band media (homepage post-cinematic bands).
// Carries the cinematic "live instrument" motion past the pin. Motion-gated; coexists with the story ScrollTrigger.
// Media imgs are 120% tall (CSS) so the ±yPercent shift never reveals an edge. Reduced-motion = no transform (CSS guard too).
let tweens = [];
export function init(){
  if(typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
  if(matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const els = document.querySelectorAll('[data-parallax]');
  els.forEach((el) => {
    const t = gsap.fromTo(el, { yPercent: -6 }, {
      yPercent: 6, ease: 'none',
      scrollTrigger: { trigger: el.closest('section') || el, start: 'top bottom', end: 'bottom top', scrub: true },
    });
    tweens.push(t);
  });
}
export function cleanup(){
  tweens.forEach((t) => { try { t.scrollTrigger && t.scrollTrigger.kill(); t.kill(); } catch(e){} });
  tweens = [];
}
