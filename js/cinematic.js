// HOMEPAGE — ONE-CUT CINEMATIC. A SINGLE pinned stage + a SINGLE scroll-scrubbed ScrollTrigger drive BOTH phases as one
// continuous take, so scrolling scrubs the whole video on one fixed stage — no second section, no scroll-down:
//   progress [0 , SPLIT]  → orbital recon descent  (assets/descent-frames, 183) — recon feed → photoreal → dive to coast
//   progress [SPLIT , 1]  → 7-chapter story        (assets/story-frames, 480)  — continues from the SAME coastline frame
// The descent's last frame is pixel-identical to the story's first frame, so the hand-off happens in place (we just swap
// which stage is visible) and is invisible. Reduced-motion / mobile / no-GSAP => static stacked chapters (no pin/scrub).
import { createSequence } from '/js/canvas-seq.js';
import { createDiveLens } from '/js/dive-lens.js';
import { scramble } from '/js/scramble.js';
import { setProgress as busProgress } from '/js/progress-bus.js';

const COORD = '64.13°N 21.95°W';                // descent coast fix — Spec v1 §02 (exact). NB: footer/closing use the Akranes HQ fix 64.32°N 22.08°W
const SPLIT = 0.30;                              // descent owns the first 30% of the scroll (~300vh); story the rest (~700vh)
const SEAM = 0.06;                               // after the instant frame-continuous hand-off, the story's heavier grade EASES
                                                 // in over this much story-progress (over MOVING frames) so the tone never pops
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => t * t * (3 - 2 * t);         // used for the brand zoom-through
const lerp = (a, b, t) => a + (b - a) * t;       // falling-telemetry / gate interpolation
// Descent FRAME pacing: gentle ease-in for the opening reveal, then CONSTANT velocity into the seam. A smoothstep ease-OUT made
// the camera nearly STOP at the coast (read as a pause); constant end-velocity ≈ the story's linear scrub rate, so descent and
// story read as ONE continuous camera move with no deceleration at the hand-off.
const K = 0.2, NORM = 1 - K / 2;
const frameEase = t => (t < K ? (t * t) / (2 * K) : t - K / 2) / NORM;
const SUPPORTS_INERT = ('inert' in HTMLElement.prototype);

let st, dSeq, sSeq, dCanvas, sec, stage, dStage, sStage, mast;
let brand, word, dcStatus, dcVal, frostDisp, frostRaf = 0, ticker = 0, locked = false, revealed = false;
let telAlt, telVel;
let chapters = [], rail, railFill, railNum, skipBtn, activePrev = -1;
let mmW, mmR, onMM, onBooted, onSkip, built = false, phaseStory = false, staticIO = null, staticTimers = [];
let segTargets = [], snapLockT = 0, snapAnim = false, coolUntil = 0, glideRaf = 0, touchY = 0, onSnapInput = null, onSnapKey = null, onTouchStart = null, onTouchMove = null;

/* ───────── PHASE 1 · orbital descent ───────── */
function revealBrand(){
  if(revealed || !dStage) return; revealed = true;
  dStage.classList.add('is-revealed');
  if(dSeq && dSeq.scrambleIn) dSeq.scrambleIn();          // WebGL ice wordmark scrambles into view on entry
  else if(word) scramble(word, { duration: 900 });        // mobile / no-WebGL DOM fallback
}
// frost displacement scale setter — driven by SCROLL on desktop (per-frame, cached). A CSS filter swap (none → url(#dscFrost))
// can't tween, so the frost is animated by writing the feDisplacementMap scale directly.
function setFrost(v){
  if(!frostDisp) return;
  const s = clamp(v, 0, 9).toFixed(2);
  if(frostDisp._s === s) return; frostDisp._s = s;       // skip redundant per-frame writes
  frostDisp.setAttribute('scale', s);
}
// FALLING TELEMETRY — altitude + velocity drop as the camera descends (cached; pure function of dP so it scrubs both ways).
function setTelemetry(dP){
  const p = smooth(clamp(dP / 0.92, 0, 1));
  if(telAlt){ const a = String(Math.round(lerp(420, 0, p))); if(telAlt._v !== a){ telAlt._v = a; telAlt.textContent = a; } }
  if(telVel){ const v = lerp(7.6, 0, p).toFixed(1); if(telVel._v !== v){ telVel._v = v; telVel.textContent = v; } }
}
// TIMED frost ramp — used only by the MOBILE static descent (no scroll scrub), to crystallise the resting freeze over `dur`ms.
function rampFrost(to){
  if(!frostDisp) return;
  cancelAnimationFrame(frostRaf);
  const from = parseFloat(frostDisp.getAttribute('scale')) || 0;
  if(Math.abs(from - to) < 0.01) return;
  const dur = 1000, t0 = performance.now();
  const step = (t) => {
    const k = clamp((t - t0) / dur, 0, 1), e = k * k * (3 - 2 * k);
    setFrost(from + (to - from) * e);
    if(k < 1) frostRaf = requestAnimationFrame(step);
  };
  frostRaf = requestAnimationFrame(step);
}
function setLock(on){
  if(on === locked) return; locked = on;
  if(on && ticker){ clearInterval(ticker); ticker = 0; }   // the coord randomiser is no-op once locked (and hidden under .is-lens) — stop it for the page's life, don't just idle it
  dStage.classList.toggle('is-locked', on);
  dStage.classList.toggle('is-frozen', on);              // the wordmark crystallises to ice on lock (frost SCALE is scroll-driven, see renderDescent)
  if(on){ if(dcStatus) dcStatus.textContent = 'LOCK'; if(dcVal){ dcVal.textContent = COORD; scramble(dcVal, { duration: 700 }); } }
  else if(dcStatus) dcStatus.textContent = 'ACQUIRING';
  // ACQUIRING (ice) → LOCK (ember) colour flip handled by .descent.is-locked .dc-status CSS (Spec v1 §02)
}
function renderDescent(dP){
  // The WebGL dive-lens owns the whole opening: it scrubs the dive sequence (radar → membrane push-through → photoreal
  // → coast) AND composites the crystallise-ice ARTIX wordmark that tears through the lens. All the old DOM frost/shatter
  // choreography is gone — the wordmark lives in the canvas now. We only keep the live telemetry datum + header collapse.
  if(dSeq) dSeq.setProgress(dP);
  setLock(dP > 0.05);                                    // datum: ACQUIRING → LOCK
  setTelemetry(dP);                                      // altitude + velocity fall as the camera descends
}

/* ───────── PHASE 2 · 7-chapter story ───────── */
// Spec v1 §06 — ICE instrument decode (no ember scan-bar): each chapter title decodes per-character in ICE→FROST. On the HERO
// chapter (the only one carrying a .ch-status chip) the §06 element runs in full: the title resolves first, THEN the secondary
// line (.ch-sub) decodes as a second beat, then the status chip flips Decoding → Locked. Other chapters keep their CSS sub-fade.
function lockChip(chip){ if(!chip) return; chip.classList.add('is-locked'); const em = chip.querySelector('em'); if(em) em.textContent = 'Locked'; }
function decodeChapter(c){
  if(!c) return;
  const reduceMo = matchMedia('(prefers-reduced-motion:reduce)').matches;
  const title = c.querySelector('.ch-title');
  const sub = c.querySelector('.ch-sub');
  const chip = c.querySelector('.ch-status');                          // hero chapter only
  if(chip){ chip.classList.remove('is-locked'); const em = chip.querySelector('em'); if(em) em.textContent = 'Decoding'; clearTimeout(chip._lock); }
  let titleDone = 0;
  if(title){
    const lines = [...title.querySelectorAll('.ln i')];
    lines.forEach((el, i) => scramble(el, { duration: 560 + i * 150, mode: 'scan' }));   // 1) title decodes in ICE
    titleDone = lines.length ? (560 + (lines.length - 1) * 150) : 0;
  }
  scramble(c.querySelector('.eyebrow'), { duration: 520, spread: 0.6 });
  if(reduceMo){ if(chip) lockChip(chip); return; }
  if(sub){
    clearTimeout(sub._beat);
    sub.style.opacity = '0';                                           // hold until title resolves, then decode as the second beat
    sub._beat = setTimeout(() => {
      sub.style.opacity = '';
      scramble(sub, { duration: 760, mode: 'scan' });
      if(chip) chip._lock = setTimeout(() => lockChip(chip), 820);
    }, titleDone + 140);
  } else {
    if(chip) chip._lock = setTimeout(() => lockChip(chip), titleDone + 140);
  }
}
function setLive(c, live){
  if(SUPPORTS_INERT){ c.inert = !live; }
  else { c.querySelectorAll('a,button').forEach(el => { if(live) el.removeAttribute('tabindex'); else el.setAttribute('tabindex', '-1'); }); }
  if(live) c.removeAttribute('aria-hidden'); else c.setAttribute('aria-hidden', 'true');
}
function renderStory(sP){
  busProgress('story', sP); if(sSeq) sSeq.setProgress(sP);
  const N = chapters.length || 1, cp = sP * (N - 1), active = clamp(Math.round(cp), 0, N - 1);
  if(active !== activePrev){ activePrev = active; decodeChapter(chapters[active]); }
  chapters.forEach((c, k) => {
    if(k < cp - 1.5 || k > cp + 1.5){                       // far from the cursor → already opacity 0; force-once then skip the per-frame dist math + writes
      if(c._o !== '0.00'){ c._o = '0.00'; c.style.opacity = '0'; c.style.transform = 'none'; }
      if(c._on){ c._on = false; c.classList.toggle('is-on', false); if(c.dataset.live !== '0'){ c.dataset.live = '0'; setLive(c, false); } }
      return;
    }
    const dist = Math.abs(cp - k);
    const o = dist < 0.3 ? 1 : (dist > 0.5 ? 0 : clamp(1 - (dist - 0.3) / 0.2, 0, 1));
    const oR = o.toFixed(2);
    if(c._o !== oR){ c._o = oR; c.style.opacity = oR; c.style.transform = o >= 1 ? 'none' : 'translateY(' + ((1 - o) * 22).toFixed(1) + 'px)'; }   // only touch the DOM when this chapter's value actually changes
    const on = (k === active);
    if(c._on !== on){ c._on = on; c.classList.toggle('is-on', on); const want = on ? '1' : '0'; if(c.dataset.live !== want){ c.dataset.live = want; setLive(c, on); } }
  });
  if(railFill) railFill.style.transform = 'scaleY(' + sP.toFixed(3) + ')';
  const railOn = sP > 0.02 && sP < 0.985;
  if(rail && rail._on !== railOn){ rail._on = railOn; rail.classList.toggle('is-on', railOn); }
  if(railNum && railNum._n !== active){ railNum._n = active; railNum.textContent = active === 0 ? '00' : ('0' + active); }
}

/* ───────── master timeline ───────── */
function stageVis(dOp, sOp){                              // drive the cross-fade; SKIP redundant writes (no per-frame style recalc once settled)
  if(dStage && dStage._op !== dOp){ dStage._op = dOp; dStage.style.opacity = dOp.toFixed(3); dStage.style.visibility = dOp > 0.001 ? 'visible' : 'hidden'; }
  if(sStage && sStage._op !== sOp){ sStage._op = sOp; sStage.style.opacity = sOp.toFixed(3); sStage.style.visibility = sOp > 0.001 ? 'visible' : 'hidden'; }
}
function setSeam(v){ if(sStage && sStage._seam !== v){ sStage._seam = v; sStage.style.setProperty('--seam', v); } }
function setCollapsed(on){ if(mast && mast._col !== on){ mast._col = on; mast.classList.toggle('is-collapsed', on); } }
function paint(p){
  phaseStory = p >= SPLIT;
  const skipOn = p > 0.07 && p < 0.92;                   // reveal "skip intro" a bit INTO the cinematic (not from the jump)
  if(skipBtn && skipBtn._on !== skipOn){ skipBtn._on = skipOn; skipBtn.classList.toggle('is-on', skipOn); }
  setCollapsed(p < 0.985);                               // GHOST the header (no bar skin) for the WHOLE cinematic; the flat bar assembles at the very end
  if(p < SPLIT){
    activePrev = -1;                                     // re-arm: the first headline decodes each time the story is (re)entered
    if(dSeq && dSeq.resume) dSeq.resume();               // wake the WebGL lens loop
    renderDescent(p / SPLIT);
    stageVis(1, 0);
    setSeam('0');                                        // prime the story grade to MATCH the descent for the upcoming hand-off
  } else {
    const sP = (p - SPLIT) / (1 - SPLIT);                // CONTINUOUS: the story advances immediately from frame-1 (== dive last frame) — no hold, no pause
    renderStory(sP);                                     // chapter-0 decodes on entry and fades in over the MOVING frames
    setSeam(clamp(sP / SEAM, 0, 1).toFixed(3));          // story's heavier grade eases in over the moving frames
    stageVis(0, 1);                                      // instant frame-continuous swap (dive lands on the coast == story frame-1 ⇒ no cut)
    if(dSeq && dSeq.pause) dSeq.pause();                 // idle the WebGL lens loop while the story owns the stage
  }
}
/* ───────── scroll choreography — GESTURE-ADVANCE between fixed stops ─────────
   The descent [0..SPLIT] is ONE indivisible segment, so a scroll from the top can ONLY resolve to chapter 0: it plays the whole
   dive (orbital ARTIX hero → through the clouds → Iceland → coastline) and stops on the scrambled headline at the coast — it can
   NEVER stop mid-descent. We fire IMMEDIATELY on the first wheel/key/touch (direction straight from the event — NO arming delay,
   so no input lag and no Lenis free-scroll hand-off to glitch on), then glide ONE stop that way over a precise rAF tween:
   descent 3.0s, chapters 1.6s. The glide is momentum-IMMUNE (we set the exact eased position every frame, overwriting anything
   Lenis adds) and input is ignored during the glide + a short cooldown, so the trackpad momentum tail can't chain a step.
   paint()/seam/decode/scrub/SPLIT untouched — only the scroll TARGET changes. */
function buildSegments(){ const N = chapters.length || 8; segTargets = [0];                 // index 0 = top (p=0); index 1 = ch0 (=SPLIT); … index N = ch(N-1) (=1.0)
  for(let k = 0; k < N; k++) segTargets.push(SPLIT + (k / (N - 1)) * (1 - SPLIT)); }
const SNAP_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
// DESCENT ease = easeInOutSine: LOW peak velocity (~1.6× avg, vs cubic's 3×) so the 356-frame dive never scrubs faster than the
// WebP decode can keep up — kills the Iceland/clouds (mid-dive) stutter — and still eases gently in/out.
const easeSine = t => (1 - Math.cos(Math.PI * t)) / 2;
// CHAPTER ease = easeInOutQuart: a long, floaty deceleration tail so the video frame "settles" to a halt instead of landing abruptly.
const easeQuart = t => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
function lenisY(){ return (window.__lenis && typeof window.__lenis.scroll === 'number') ? window.__lenis.scroll : (window.scrollY || 0); }
function scrollProgress(){ if(!st) return 0; return clamp((lenisY() - st.start) / Math.max(1, st.end - st.start), 0, 1); }
// Own the glide via rAF + scrollTo(immediate): we set the EXACT eased position every frame, which overwrites any wheel/trackpad
// momentum Lenis adds mid-glide (this build's lock:true / stop()+force are broken, so a lock:false lenis.scrollTo gets pushed
// off-target by the momentum tail). Result: a committed, momentum-immune glide of a precise duration.
function runGlide(targetY, dur, ease){
  cancelAnimationFrame(glideRaf); clearTimeout(snapLockT);
  const startY = lenisY(), span = targetY - startY, t0 = performance.now();
  const finish = () => { glideRaf = 0; clearTimeout(snapLockT); snapAnim = false; coolUntil = performance.now() + 300; };   // brief cooldown swallows the momentum tail so it can't chain a step
  const step = (now) => {
    const k = clamp((now - t0) / (dur * 1000), 0, 1);
    if(window.__lenis && window.__lenis.scrollTo) window.__lenis.scrollTo(startY + span * ease(k), { immediate: true });
    if(k < 1){ glideRaf = requestAnimationFrame(step); } else finish();
  };
  glideRaf = requestAnimationFrame(step);
  snapLockT = setTimeout(finish, dur * 1000 + 600);          // failsafe unlock if the rAF stalls (e.g. backgrounded)
}
function doGestureAdvance(dir){
  if(!st || snapAnim || !dir || !window.__lenis || !window.__lenis.scrollTo) return;
  const y = lenisY();
  if(y < st.start - 2 || y > st.end + 2) return;             // outside the pinned cinematic → leave the content below to scroll freely
  const p = scrollProgress();
  let target = null;                                          // the next stop STRICTLY in the travel direction (a scroll from the top can only reach ch0 — the dive has no interior stop)
  if(dir > 0){ for(let i = 0; i < segTargets.length; i++){ if(segTargets[i] > p + 0.012){ target = segTargets[i]; break; } } }
  else { for(let i = segTargets.length - 1; i >= 0; i--){ if(segTargets[i] < p - 0.012){ target = segTargets[i]; break; } } }
  if(target == null) return;                                  // already at the final stop in that direction
  const descentMove = (dir > 0 && p < SPLIT - 0.01 && target >= SPLIT - 0.01) || (dir < 0 && target < 0.01);
  const dur = descentMove ? 3.0 : 1.6;                        // SLOW + smooth: the full dive glides over 3.0s, each chapter over 1.6s
  snapAnim = true;
  runGlide(st.start + target * (st.end - st.start), dur, descentMove ? easeSine : easeQuart);   // sine = even frame-rate (decode-friendly) for the dive; quart = floaty halt for chapters
}
function setupGestureAdvance(){
  buildSegments();
  // ready = in the cinematic, not mid-glide, past the cooldown, animated mode (mobile/reduced-motion use the static path)
  const ready = () => !!st && !snapAnim && !mmR.matches && performance.now() >= coolUntil && lenisY() >= st.start - 2 && lenisY() <= st.end + 2;
  onSnapInput = (e) => { if(ready() && e && Math.abs(e.deltaY) > 3) doGestureAdvance(e.deltaY > 0 ? 1 : -1); };   // fire on the FIRST wheel — direction straight from deltaY (no arming delay)
  onSnapKey = (e) => { if(SNAP_KEYS.has(e.key) && ready()) doGestureAdvance((e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'End' || e.key === ' ' || e.key === 'Spacebar') ? 1 : -1); };
  onTouchStart = (e) => { touchY = (e.touches && e.touches[0]) ? e.touches[0].clientY : 0; };
  onTouchMove = (e) => { const cy = (e.touches && e.touches[0]) ? e.touches[0].clientY : touchY;
    if(ready() && Math.abs(cy - touchY) > 18) doGestureAdvance(cy < touchY ? 1 : -1); };   // finger up = scroll down = forward
  window.addEventListener('wheel', onSnapInput, { passive: true });
  window.addEventListener('keydown', onSnapKey);
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
}
function teardownSnap(){
  clearTimeout(snapLockT); cancelAnimationFrame(glideRaf); snapLockT = glideRaf = 0; snapAnim = false; coolUntil = 0; segTargets = []; touchY = 0;
  if(onSnapInput) window.removeEventListener('wheel', onSnapInput);
  if(onSnapKey) window.removeEventListener('keydown', onSnapKey);
  if(onTouchStart) window.removeEventListener('touchstart', onTouchStart);
  if(onTouchMove) window.removeEventListener('touchmove', onTouchMove);
  onSnapInput = onSnapKey = onTouchStart = onTouchMove = null;
}
function buildAnimated(){
  gsap.registerPlugin(ScrollTrigger);
  dCanvas = dStage.querySelector('.descent-canvas');
  dSeq = createDiveLens({ canvas: dCanvas, dir: '/assets/dive-frames/', count: 356,
    settings: { ampMul: 0.59, ctr: 0.175, wid: 0.064, wobMul: 0.94, wobScale: 7, wobSpeed: 0.3 } });
  if(dSeq) dStage.classList.add('is-lens');              // canvas owns the wordmark now — hide the legacy DOM brand/coord/shatter
  else dSeq = createSequence({ canvas: dCanvas, dir: '/assets/dive-frames/', count: 356 });   // no-WebGL fallback: plain scrub, no lens
  sSeq = createSequence({ canvas: sStage.querySelector('.story-canvas'),   dir: '/assets/story-frames/',   count: 480 });
  st = ScrollTrigger.create({ trigger: sec, start: 'top top', end: 'bottom bottom', pin: stage, scrub: 0.6, invalidateOnRefresh: true, onUpdate: (self) => paint(self.progress) });
  setupGestureAdvance();                                  // gesture-advance choreography (descent-as-segment + chapter steps) — see doGestureAdvance
  dStage.classList.add('is-on');
  const rnd = () => (Math.random() * 88 + 1).toFixed(2);
  ticker = setInterval(() => { if(!locked && !phaseStory && dcVal) dcVal.textContent = rnd() + '°N ' + rnd() + '°W'; }, 90);
  paint(0);
  let booted = false; try { booted = !!sessionStorage.getItem('artix-booted'); } catch(e){}
  if(booted) revealBrand();
  built = true;
}
// MOBILE/static cinematic OPENING — the descent is a portrait hero (CSS poster backdrop; no canvas scrub). A short TIMED sequence
// (not scroll) plays the brand: coordinate ticker → ARTIX decodes out of the telemetry → ACQUIRING flips to LOCK + the wordmark
// ice-freezes. This brings the "Watch at the Edge" opening to phones without the 663-frame landscape scrub (battery/crop hazard).
function buildStaticDescent(){
  if(!dStage) return;
  dStage.classList.add('is-on');
  if(mmR.matches){                                       // reduced-motion: resolve the opening instantly — no scramble/ticker
    revealed = true; dStage.classList.add('is-revealed'); setLock(true); return;
  }
  let lkd = false;
  const rnd = () => (Math.random() * 88 + 1).toFixed(2);
  const tick = setInterval(() => { if(!lkd && dcVal) dcVal.textContent = rnd() + '°N ' + rnd() + '°W'; }, 90);
  const t1 = setTimeout(() => revealBrand(), 380);       // ARTIX decodes out of the acquisition telemetry
  const t2 = setTimeout(() => { lkd = true; setLock(true); rampFrost(3.8); }, 1900);  // ACQUIRING → LOCK; settle the frost to a legible RESTING freeze (setLock ramps to 7 = the desktop zoom-through peak, too heavy as a static state)
  staticTimers.push(() => { clearInterval(tick); clearTimeout(t1); clearTimeout(t2); });
}
function buildStatic(){
  sec.classList.add('is-static');
  chapters.forEach(c => { c.removeAttribute('aria-hidden'); if(SUPPORTS_INERT) c.inert = false; });
  buildStaticDescent();
  if(mmR.matches || typeof IntersectionObserver === 'undefined'){
    chapters.forEach(c => { c._on = true; c.classList.add('is-on'); lockChip(c.querySelector('.ch-status')); });   // instant reveal, no per-char motion
  } else {
    // per-chapter cinematic: each chapter decodes (ICE scramble) + reveals as it scrolls into view (mirrors the desktop story beats)
    staticIO = new IntersectionObserver((ents) => ents.forEach(en => {
      if(en.isIntersecting){ const c = en.target; if(!c._on){ c._on = true; c.classList.add('is-on'); decodeChapter(c); } }
    }), { rootMargin: '0px 0px -40% 0px', threshold: 0.01 });
    chapters.forEach(c => staticIO.observe(c));
  }
  built = true;
}
function teardown(){
  teardownSnap();
  try { st && st.kill(); } catch(e){}
  try { dSeq && dSeq.destroy(); } catch(e){}
  try { sSeq && sSeq.destroy(); } catch(e){}
  if(ticker){ clearInterval(ticker); ticker = 0; }
  if(staticIO){ staticIO.disconnect(); staticIO = null; }
  staticTimers.forEach(fn => { try { fn(); } catch(e){} }); staticTimers = [];
  cancelAnimationFrame(frostRaf); if(frostDisp){ frostDisp.setAttribute('scale', '0'); delete frostDisp._s; }
  if(telAlt) delete telAlt._v; if(telVel) delete telVel._v;
  st = dSeq = sSeq = dCanvas = null; locked = false; revealed = false; phaseStory = false; activePrev = -1; built = false;
  sec && sec.classList.remove('is-static');
  if(dStage){ dStage.style.opacity = ''; dStage.style.visibility = ''; delete dStage._op; }
  if(sStage){ sStage.style.opacity = ''; sStage.style.visibility = ''; sStage.style.removeProperty('--seam'); delete sStage._op; delete sStage._seam; }
  dStage && dStage.classList.remove('is-on', 'is-locked', 'is-frozen', 'is-revealed');
  if(brand){ brand.style.transform = ''; brand.style.opacity = ''; brand.style.filter = ''; brand.style.willChange = ''; }
  chapters.forEach(c => { c.style.opacity = ''; c.style.transform = ''; c.removeAttribute('aria-hidden'); delete c.dataset.live; delete c._o; delete c._on;
    c.classList.remove('is-on'); if(SUPPORTS_INERT) c.inert = false; else c.querySelectorAll('a,button').forEach(el => el.removeAttribute('tabindex'));
    const sub = c.querySelector('.ch-sub'); if(sub){ clearTimeout(sub._beat); sub.style.opacity = ''; }
    const chip = c.querySelector('.ch-status'); if(chip){ clearTimeout(chip._lock); chip.classList.remove('is-locked'); const em = chip.querySelector('em'); if(em) em.textContent = 'Decoding'; } });
  if(mast){ mast.classList.remove('is-collapsed'); delete mast._col; }
  if(skipBtn){ skipBtn.classList.remove('is-on'); delete skipBtn._on; }
  if(rail) delete rail._on; if(railNum) delete railNum._n;
}
function build(){
  const lite = mmR.matches || mmW.matches || typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined';
  if(lite) buildStatic(); else buildAnimated();
}
export function init(){
  sec = document.getElementById('cinematic'); if(!sec) return;
  stage = sec.querySelector('.cinematic-stage');
  dStage = sec.querySelector('.descent'); sStage = sec.querySelector('.story');
  mast = document.querySelector('.masthead');
  brand = sec.querySelector('.descent-brand'); word = sec.querySelector('.descent-word');
  frostDisp = sec.querySelector('#dscFrost feDisplacementMap');
  dcStatus = sec.querySelector('.dc-status'); dcVal = sec.querySelector('.dc-val');
  telAlt = sec.querySelector('.dh-alt'); telVel = sec.querySelector('.dh-vel');
  chapters = [...sec.querySelectorAll('.chapter')];
  rail = document.querySelector('.story-rail'); railFill = document.querySelector('.story-rail-fill'); railNum = document.querySelector('.story-rail-num');
  skipBtn = document.querySelector('.cine-skip');
  onSkip = () => {                                         // cancel any in-flight gesture glide + cooldown, then jump to the end (skip the intro)
    cancelAnimationFrame(glideRaf); clearTimeout(snapLockT); glideRaf = snapLockT = 0; snapAnim = false; coolUntil = 0;
    const to = st ? st.end : (sec.offsetTop + sec.offsetHeight);
    if(window.__lenis) window.__lenis.scrollTo(to, { duration: 1.1, force: true }); else window.scrollTo(0, to); };
  if(skipBtn) skipBtn.addEventListener('click', onSkip);
  mmW = matchMedia('(max-width:860px)'); mmR = matchMedia('(prefers-reduced-motion:reduce)');   // align the cinematic's compact gate with the nav drawer breakpoint (no rail-less live-cinematic dead-band)
  onMM = () => { teardown(); build(); if(typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh(); };
  mmW.addEventListener('change', onMM); mmR.addEventListener('change', onMM);
  onBooted = () => { revealBrand(); };   // brand entrance when the loader clears — chapter-0 decodes later, AS the story phase enters
  document.addEventListener('artix:booted', onBooted, { once: true });
  document.addEventListener('artix:reveal', onBooted, { once: true });
  build();
}
export function cleanup(){ if(mmW) mmW.removeEventListener('change', onMM); if(mmR) mmR.removeEventListener('change', onMM); if(onBooted){ document.removeEventListener('artix:booted', onBooted); document.removeEventListener('artix:reveal', onBooted); } if(skipBtn && onSkip) skipBtn.removeEventListener('click', onSkip); teardown(); }
