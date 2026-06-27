// RADAR PULSE — a live sonar "ping" that emanates from Iceland through the baked range rings on the dive hero, alive ONLY while the
// camera sits in orbit (descent progress ≈ 0) and fades out the instant the dive begins (same FADE_END as the starfield). It shares the
// rings' CENTRE, their perspective ELLIPSE aspect, and their outer EXTENT, so the expanding wavefronts read as the existing circles
// pulsing. Pure CSS-compositor animation (transform+opacity on a few elements) — NO per-frame main-thread/rAF cost; JS only re-measures
// the cover-fit centre on resize and sets the scroll fade. Once faded (scrolled into the dive) the host is display:none → zero cost.
//
//   createRadarPulse({ host }) → { setProgress(dP), start(), stop(), destroy() }
//
// Geometry is locked to the baked rings of dive-frames/frame-0001 (Iceland centred): CENTRE (0.502w, 0.825h), perspective aspect 0.46
// (rings lie on the tilted globe surface), outer radius 0.185w. The hero draws the frame COVER-FIT and the lens is un-warped at rest
// (strength 0 at progress 0), so the same cover-fit maths the dive uses places the overlay exactly on the baked rings at any viewport.

const TRIGGER = 0.004;           // descent progress that counts as "the first scroll is initiated" (~7px) → fire the quick fade-out
const FRAME_W = 1600, FRAME_H = 900;
const CENTRE_X = 0.502, CENTRE_Y = 0.846;   // Iceland / ring centre, as a fraction of the 1600×900 frame
const OUTER_RX = 0.185;          // outermost baked ring, semi-axis as a fraction of frame WIDTH
const ASPECT = 0.51;             // ring ry/rx — oval flatten of the radar plane (owner-tuned by eye; 0.42 measured was a touch too flat)

export function createRadarPulse({ host }){
  if(!host) return null;
  const el = document.createElement('div');
  el.className = 'descent-radar is-hidden';
  el.setAttribute('aria-hidden', 'true');
  // three staggered expanding wavefronts emanating from Iceland
  el.innerHTML = '<i class="radar-ring"></i><i class="radar-ring"></i><i class="radar-ring"></i>';
  // sit just above the WebGL dive canvas, below the HUD — same slot as the starfield, so it glows over the dive image only
  const dCanvas = host.querySelector('.descent-canvas');
  if(dCanvas && dCanvas.nextSibling) host.insertBefore(el, dCanvas.nextSibling);
  else host.appendChild(el);

  let out = false, goneT = 0, ro = null;

  // place the overlay on the baked rings using the dive's OWN cover-fit transform (uniform scale → screen aspect == frame aspect)
  function measure(){
    const r = host.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const scale = Math.max(w / FRAME_W, h / FRAME_H);     // cover-fit
    const drawnW = FRAME_W * scale, drawnH = FRAME_H * scale;
    const offX = (w - drawnW) / 2, offY = (h - drawnH) / 2;
    const cx = offX + CENTRE_X * drawnW, cy = offY + CENTRE_Y * drawnH;
    const rx = OUTER_RX * drawnW, ry = rx * ASPECT;
    el.style.setProperty('--radar-x', cx.toFixed(1) + 'px');
    el.style.setProperty('--radar-y', cy.toFixed(1) + 'px');
    el.style.setProperty('--radar-rx', rx.toFixed(1) + 'px');
    el.style.setProperty('--radar-ry', ry.toFixed(1) + 'px');
  }

  function start(){
    measure();
    requestAnimationFrame(() => el.classList.remove('is-hidden'));   // one-frame defer so the CSS opacity transition runs (fade-in)
  }
  function stop(){ /* CSS animations idle on their own; nothing to cancel */ }

  // Fade out FAST the instant the first scroll is initiated — NOT proportional to scroll distance (a slow scroll used to make it linger).
  // The moment dP crosses TRIGGER, a quick CSS fade runs (.is-out, ~0.22s) then display:none (animations stop, zero cost). Scrubbing all
  // the way back to the top restores it (fades back in over the base .9s).
  function setProgress(dP){
    const scrolling = dP > TRIGGER;
    if(scrolling === out) return; out = scrolling;
    if(scrolling){ el.classList.add('is-out'); clearTimeout(goneT); goneT = setTimeout(() => { if(out) el.classList.add('is-gone'); }, 260); }
    else { clearTimeout(goneT); el.classList.remove('is-gone', 'is-out'); }
  }

  try { ro = new ResizeObserver(() => { if(!out) measure(); }); ro.observe(host); }
  catch(e){ window.addEventListener('resize', measure, { passive: true }); }

  return {
    setProgress, start, stop,
    destroy(){ try { ro && ro.disconnect(); } catch(e){} window.removeEventListener('resize', measure); try { el.remove(); } catch(e){} }
  };
}
