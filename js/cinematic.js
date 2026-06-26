// HOMEPAGE — ONE-CUT CINEMATIC. A SINGLE pinned stage + a SINGLE scroll-scrubbed ScrollTrigger drive BOTH phases as one
// continuous take, so scrolling scrubs the whole video on one fixed stage — no second section, no scroll-down:
//   progress [0 , SPLIT]  → orbital recon descent  (assets/descent-frames, 183) — recon feed → photoreal → dive to coast
//   progress [SPLIT , 1]  → 7-chapter story        (assets/story-frames, 480)  — continues from the SAME coastline frame
// The descent's last frame is pixel-identical to the story's first frame, so the hand-off happens in place (we just swap
// which stage is visible) and is invisible. Reduced-motion / mobile / no-GSAP => static stacked chapters (no pin/scrub).
import { createSequence } from '/js/canvas-seq.js';
import { createDiveLens } from '/js/dive-lens.js';
import { scramble } from '/js/scramble.js';
import { createWordmarkDecode } from '/js/artix-wordmark-decode.js';   // SAME hero wordmark decode the desktop dive-lens uses — rendered on a plain 2D canvas for the mobile static hero
import { createStarfield } from '/js/starfield.js';                    // orbital night sky over the dive hero — alive at rest, fades out as the dive begins
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
let telAlt, telVel, descentScrim;
let chapters = [], rail, railFill, railNum, skipBtn, activePrev = -1;
let mmW, mmR, onMM, onBooted, onSkip, onLang, built = false, phaseStory = false, staticIO = null, staticTimers = [];
let segTargets = [], snapLockT = 0, snapAnim = false, coolUntil = 0, glideRaf = 0, touchY = 0, onSnapInput = null, onSnapKey = null, onTouchStart = null, onTouchMove = null;
let descentQueued = 0, warmRaf = 0, warmForce = false;   // first descent glide is HELD until the dive frames are cached (dSeq.warm) so the cold-cache scrub never sticks/jumps; the scroll intent is queued + auto-fired on warm
let mobileWm = null;   // mobile/static hero wordmark — the desktop decode module on a 2D canvas (built in buildStaticDescent)
let stars = null;      // orbital starfield (desktop WebGL hero only; idle-only — fades out as the dive begins)

/* ───────── PHASE 1 · orbital descent ───────── */
function revealBrand(){
  if(revealed || !dStage) return; revealed = true;
  dStage.classList.add('is-revealed');
  if(dSeq && dSeq.scrambleIn) dSeq.scrambleIn();          // desktop: WebGL ice wordmark scrambles into view on entry
  else if(mobileWm) mobileWm.scrambleIn();                // mobile/static: the SAME wordmark-decode module on a 2D canvas (look + scramble match desktop)
  else if(word) scramble(word, { duration: 900 });        // last-ditch DOM fallback (canvas build failed)
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
  if(stars) stars.setProgress(dP);                       // orbital sky fades out as the dive carries past it (gone by dP≈0.045)
  setLock(dP > 0.05);                                    // datum: ACQUIRING → LOCK
  setTelemetry(dP);                                      // altitude + velocity fall as the camera descends
  // seam prep: fade the bottom gradient out over the last 15% of descent so it matches the story (scrim=0 at seam=0)
  if(descentScrim){ const v = clamp(1 - (dP - 0.85) / 0.15, 0, 1).toFixed(3); if(descentScrim._op !== v){ descentScrim._op = v; descentScrim.style.opacity = v; } }
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
  const cta = c.querySelector('.ch-cta'), cue = c.querySelector('.ch-cue');
  if(reduceMo){ if(chip) lockChip(chip); return; }                    // (reduced-motion reveals cta/cue via CSS — never held here)
  // The action link (cta) + scroll cue follow the SUB beat — the CSS reveal would otherwise fade them in at ~.3s, BEFORE the
  // JS-held sub even starts decoding (~titleDone+140), inverting the eyebrow → sub → cta reading order. Hold, release after the sub.
  const followers = [cta, cue].filter(Boolean);
  followers.forEach(el => { clearTimeout(el._beat); el.style.opacity = '0'; });
  const releaseFollowers = (delay) => followers.forEach(el => { el._beat = setTimeout(() => { el.style.opacity = ''; }, delay); });
  if(sub){
    const subStart = Math.round(titleDone * 0.5);                     // start the sub WHILE the title is still resolving (was titleDone+140 ≈ +850ms — owner: subs took too long to appear)
    clearTimeout(sub._beat);
    sub.style.opacity = '0';                                           // hold briefly, then decode as an overlapping second beat
    sub._beat = setTimeout(() => {
      sub.style.opacity = '';
      scramble(sub, { duration: 760, mode: 'scan' });
      if(chip) chip._lock = setTimeout(() => lockChip(chip), 820);
    }, subStart);
    releaseFollowers(subStart + 320);                                 // a beat AFTER the sub begins decoding
  } else {
    if(chip) chip._lock = setTimeout(() => lockChip(chip), titleDone + 140);
    releaseFollowers(titleDone + 140);                                // no sub → follow straight off the title
  }
}
// LIVE LANGUAGE SWAP — i18n has already swapped the chapter/hero text in the DOM and fired 'artix:lang'. Relocalise the one
// thing that is NOT a DOM node (the canvas wordmark slogan), then re-run the decode on whatever is on-screen so the swap reads
// as a re-scramble into the new language IN PLACE — the page never reloads, so the scroll position is untouched.
const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < (window.innerHeight || 0); };
function relocalize(lang){
  const slogan = lang === 'is' ? 'ÚTVEGAÐ. AFHENT. STUTT.' : 'SOURCED. DELIVERED. SUPPORTED.';
  if(dSeq && dSeq.setSub) dSeq.setSub(slogan);
  if(mobileWm && mobileWm.setSub) mobileWm.setSub(slogan);
  // hero is the resting view → re-decode the wordmark in the new language (the signature scramble)
  if(!phaseStory && revealed){
    if(dSeq && dSeq.scrambleIn) dSeq.scrambleIn();
    else if(mobileWm && mobileWm.scrambleIn) mobileWm.scrambleIn();
  }
  // re-decode every chapter currently on-screen (desktop: the one active chapter; static stack: each visible card)
  chapters.forEach(c => { if(c._on && c.offsetParent !== null && inView(c)) decodeChapter(c); });
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
// UNIFIED ease = easeInOutSine for ALL glides (descent + chapters). Has zero velocity at both ends (no jerk at start or halt)
// but non-zero acceleration immediately at t=0 — motion is visible from the first frame (~2.45% at 360ms vs quintic's 0.86%).
// Same shape for every scroll-start so the trigger delay feels identical whether entering descent or advancing a chapter.
// Peak velocity 1.57× avg (lower than the old quintic's 1.875×) — well within the frame-decode budget at 3.6s/2.4s.
const easeSlide = t => -(Math.cos(Math.PI * t) - 1) / 2;
function lenisY(){ return (window.__lenis && typeof window.__lenis.scroll === 'number') ? window.__lenis.scroll : (window.scrollY || 0); }
function scrollProgress(){ if(!st) return 0; return clamp((lenisY() - st.start) / Math.max(1, st.end - st.start), 0, 1); }
// Own the glide via rAF + scrollTo(immediate): we set the EXACT eased position every frame, which overwrites any wheel/trackpad
// momentum Lenis adds mid-glide (this build's lock:true / stop()+force are broken, so a lock:false lenis.scrollTo gets pushed
// off-target by the momentum tail). Result: a committed, momentum-immune glide of a precise duration.
// After the eased glide reaches the stop, run a short SETTLE TAIL instead of releasing on the spot. Releasing at k=1 was what
// made the halt read as shaky/abrupt: the trackpad MOMENTUM TAIL is still feeding Lenis's own wheel handler, so the instant the
// glide stopped overriding, those late events nudged Lenis a few px PAST the stop — the scrub then chased the stuttering momentum
// decay (jiggle) and dead-stopped when it died (abrupt). The settle keeps the scroll PINNED to the exact target AND pumps
// ScrollTrigger.update() each frame for one scrub-length, so the momentum is absorbed and the scrub coasts cleanly onto the exact
// target frame — a smooth glide to a crisp, dead stop. Pure bounded tail work (it ends) → no standing per-frame cost.
const SETTLE_MS = 520;
function runGlide(targetY, dur, ease){
  cancelAnimationFrame(glideRaf); clearTimeout(snapLockT);
  const startY = lenisY(), span = targetY - startY, t0 = performance.now();
  const L = window.__lenis;
  const finish = () => { glideRaf = 0; clearTimeout(snapLockT); snapAnim = false; coolUntil = performance.now() + 60; };   // settle already swallowed the momentum tail — only a hair of cooldown left
  let settleT0 = 0;
  const step = (now) => {
    const k = clamp((now - t0) / (dur * 1000), 0, 1);
    if(k < 1){                                                                       // EASE phase: drive the eased position, overriding any momentum Lenis adds
      if(L && L.scrollTo) L.scrollTo(startY + span * ease(k), { immediate: true });
      glideRaf = requestAnimationFrame(step);
    } else {                                                                         // SETTLE phase: pin the exact stop + keep feeding the scrub so it coasts to rest without drift
      if(L && L.scrollTo) L.scrollTo(targetY, { immediate: true });
      if(typeof ScrollTrigger !== 'undefined') ScrollTrigger.update();
      if(!settleT0) settleT0 = now;
      if(now - settleT0 < SETTLE_MS){ glideRaf = requestAnimationFrame(step); } else finish();
    }
  };
  glideRaf = requestAnimationFrame(step);
  snapLockT = setTimeout(finish, dur * 1000 + SETTLE_MS + 600);   // failsafe unlock if the rAF stalls (e.g. backgrounded)
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
  // HOLD the dive until its frames are cached: a cold-cache scrub out-runs the WebP download and the frame-exact draw STICKS, then
  // jumps to the seam. Queue the scroll intent and auto-fire the glide the instant the dive is warm (the orbital hero is the hold UI).
  if(descentMove && dir > 0 && !warmForce && dSeq && dSeq.warm === false){ descentQueued = dir; armWarmFire(); return; }
  const dur = descentMove ? 3.6 : 2.4;                        // SLOW + smooth: the full dive glides over 3.6s (smootherstep settle); each chapter over 2.4s — slower so the footage between chapters reads
  snapAnim = true;
  runGlide(st.start + target * (st.end - st.start), dur, easeSlide);
}
// poll dive readiness; once the frames are cached (or a 6s fallback), fire the queued descent glide so it scrubs smoothly from the start
function armWarmFire(){
  if(warmRaf) return;                                         // already waiting
  const t0 = performance.now();
  const tick = () => {
    if(dSeq && dSeq.warm === false && performance.now() - t0 < 6000){ warmRaf = requestAnimationFrame(tick); return; }
    warmRaf = 0;
    if(performance.now() - t0 >= 6000) warmForce = true;      // don't hang forever on a stalled fetch — let it run (load()'s retry covers stragglers)
    const d = descentQueued; descentQueued = 0;
    if(d && !snapAnim) doGestureAdvance(d);
  };
  warmRaf = requestAnimationFrame(tick);
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
  clearTimeout(snapLockT); cancelAnimationFrame(glideRaf); cancelAnimationFrame(warmRaf); snapLockT = glideRaf = warmRaf = 0; snapAnim = false; coolUntil = 0; segTargets = []; touchY = 0; descentQueued = 0; warmForce = false;
  if(onSnapInput) window.removeEventListener('wheel', onSnapInput);
  if(onSnapKey) window.removeEventListener('keydown', onSnapKey);
  if(onTouchStart) window.removeEventListener('touchstart', onTouchStart);
  if(onTouchMove) window.removeEventListener('touchmove', onTouchMove);
  onSnapInput = onSnapKey = onTouchStart = onTouchMove = null;
}
function buildAnimated(){
  gsap.registerPlugin(ScrollTrigger);
  dCanvas = dStage.querySelector('.descent-canvas');
  dSeq = createDiveLens({ canvas: dCanvas, dir: '/assets/dive-frames/', count: 367,
    settings: { ampMul: 0.59, ctr: 0.175, wid: 0.064, wobMul: 0.94, wobScale: 7, wobSpeed: 0.3 } });   // ctr lands the membrane tear ON the radar→photoreal morph. The v2 clip morphs early (flip ≈ frames 55-72 = progress ~0.15-0.19), so ctr is back at the original 0.175. (Re-set this whenever the clip is re-cut — it must match where the new clip flips.)
  if(dSeq){ dStage.classList.add('is-lens');             // canvas owns the wordmark now — hide the legacy DOM brand/coord/shatter
    try { stars = createStarfield({ host: dStage, reduced: mmR.matches }); if(stars) stars.start(); } catch(e){ stars = null; } }   // orbital sky at idle (only over the live WebGL hero)
  else dSeq = createSequence({ canvas: dCanvas, dir: '/assets/dive-frames/', count: 367 });   // no-WebGL fallback: plain scrub, no lens
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
// MOBILE/static hero wordmark — renders the SAME decode module the desktop dive-lens uses (artix-wordmark-decode.js: chromatic-
// split / focus-pull ICE churn → Michroma FROST; ARTIX resolves, then the slogan decodes as a 2nd beat) onto a plain 2D canvas, so
// the mobile hero wordmark MATCHES desktop in look AND scramble. (The old path was scramble.js on the DOM .descent-word — a wholly
// different animation.) Opts are IDENTICAL to dive-lens: subGap 0.8, titleStagger 220 = strict sequential A→R→T→I→X. The rAF runs
// only through the ~2.7s decode, then stops (the resolved wordmark + its resting glow are left painted; resize re-bakes).
function buildMobileWordmark(host){
  const cv = document.createElement('canvas');
  cv.className = 'descent-wm-canvas';
  cv.setAttribute('aria-hidden', 'true');
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  const wm = createWordmarkDecode({ subGap: 0.8, titleStagger: 220, sub: document.documentElement.lang === 'is' ? 'ÚTVEGAÐ. AFHENT. STUTT.' : 'SOURCED. DELIVERED. SUPPORTED.' });
  let raf = 0, settledFrames = 0, cssW = 1, cssH = 1, fs = 0, cx = 0, cy = 0, lastPaint = 0, decoding = false;
  // The DECODE phase is fuzzy by design (chromatic split + focus-pull blur), so it doesn't need full retina res —
  // and canvas filter-blur cost scales with pixel area (∝ dpr²). Rasterise the churn at a reduced DPR (1.5) to cut
  // the per-glyph blur work ~44%, then re-bake the RESOLVED still at full DPR (loop() flips `decoding` off on settle)
  // so the final wordmark stays crisp. Verified: at 1.5 the churning glyphs are pixel-indistinguishable from 2.0,
  // and the locked letters snap to full res the instant the decode lands. (mobile/static only; desktop = dive-lens.)
  const DECODE_DPR = 1.5, FULL_DPR = 2;
  function size(){
    const r = host.getBoundingClientRect();
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    const dpr = Math.min(decoding ? DECODE_DPR : FULL_DPR, window.devicePixelRatio || 1);
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);                 // draw in CSS px, crisp on HiDPI
    fs = Math.round(Math.min(cssH * 0.11, cssW * 0.145));   // confident size; ARTIX (5 wide Michroma glyphs) fits the column
    cx = cssW * 0.5; cy = cssH * 0.47;                      // centred (matches the current DOM brand placing; the slogan draws below)
  }
  function paint(){ ctx.clearRect(0, 0, cssW, cssH); wm.draw(ctx, cx, cy, fs, performance.now(), 1, 1); }
  // ~30fps cap on the decode redraw: each active frame runs ~34 per-glyph ctx.filter blur + chromatic-split fills
  // (canvas filter blur is brutal on mobile Safari). Halving the paint rate halves that cost; a 2.7s blur/churn
  // transition at 30fps is indistinguishable from 60fps (film is 24fps). Loop stays alive every rAF; only paint throttles.
  function loop(now){
    raf = requestAnimationFrame(loop);
    if((now || 0) - lastPaint < 32) return;
    lastPaint = now || 0;
    paint();
    if(wm.settled){
      if(decoding){ decoding = false; size(); paint(); }    // decode landed → re-rasterise the resolved still at full DPR (crisp), once
      if(++settledFrames > 2){ cancelAnimationFrame(raf); raf = 0; }
    }
  }
  const onResize = () => { size(); if(!raf){ settledFrames = 0; paint(); } };   // URL-bar collapse / orientation: a settled wordmark re-bakes at the new fs inside draw()
  size();
  window.addEventListener('resize', onResize, { passive: true });
  return {
    scrambleIn(){
      decoding = !mmR.matches;                             // reduced-motion draws the resolved still straight away → keep full DPR
      size(); wm.scrambleIn(performance.now()); settledFrames = 0; lastPaint = 0;
      if(mmR.matches){ paint(); return; }                  // reduced-motion → draw resolved instantly, no loop
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    },
    setSub(s){ wm.setSub(s); if(!raf){ decoding = false; size(); paint(); } },   // relocalise slogan; repaint the resolved still if the decode loop has already stopped
    destroy(){ cancelAnimationFrame(raf); raf = 0; window.removeEventListener('resize', onResize); cv.remove(); }
  };
}
function buildStaticDescent(){
  if(!dStage) return;
  dStage.classList.add('is-on');
  try { mobileWm = buildMobileWordmark(dStage); dStage.classList.add('has-canvas-wm'); }   // canvas owns ARTIX + slogan; .has-canvas-wm hides the DOM .descent-word/.descent-sub
  catch(e){ mobileWm = null; }                            // build failed → DOM brand stays visible, revealBrand falls back to scramble(word)
  if(mmR.matches){                                       // reduced-motion: resolve the opening instantly — no scramble/ticker
    revealed = true; dStage.classList.add('is-revealed'); setLock(true); setTelemetry(1);
    if(mobileWm) mobileWm.scrambleIn();                  // under reduce() this draws the wordmark already resolved
    return;                                              // show the descent already LANDED (ALT/VEL 0), not frozen at cruise
  }
  let lkd = false, telRaf = 0;
  const rnd = () => (Math.random() * 88 + 1).toFixed(2);
  const tick = setInterval(() => { if(!lkd && dcVal) dcVal.textContent = rnd() + '°N ' + rnd() + '°W'; }, 90);
  // live HUD — ALT/VEL fall to "landed" over the descent window (rAF, decode-free) so the instrument reads as a real descent, not a frozen still
  const telT0 = performance.now(), TEL_DUR = 1900;
  const telStep = (now) => { const k = clamp((now - telT0) / TEL_DUR, 0, 1); setTelemetry(k); if(k < 1) telRaf = requestAnimationFrame(telStep); };
  telRaf = requestAnimationFrame(telStep);
  const t1 = setTimeout(() => revealBrand(), 380);       // ARTIX decodes out of the acquisition telemetry (canvas wordmark scrambleIn)
  const t2 = setTimeout(() => { lkd = true; setLock(true); }, 1900);  // ACQUIRING → LOCK (poster racks sharp + coord flips ember); the canvas wordmark carries its own frost (no rampFrost on the hidden DOM word)
  staticTimers.push(() => { clearInterval(tick); clearTimeout(t1); clearTimeout(t2); cancelAnimationFrame(telRaf); });
}
// MOBILE static headline parallax — the only per-frame work on phones (the cinematic scrub doesn't run here). A STATIC transform
// per scroll frame, rAF-coalesced, NOT animation-timeline:view() — the CSS scroll-timeline ghosts the scrambled per-char title
// in Chrome (re-rasters the layer at interpolated positions); a plain static transform renders cleanly. Each headline rides a
// nearer plane as its chapter crosses the viewport. The title carries no transform-based entrance, so nothing conflicts.
let pllxRaf = 0, pllxScroll = null, pllxTitles = [];
function pllxApply(){
  pllxRaf = 0;
  const vh = window.innerHeight || 1, mid = vh / 2, n = pllxTitles.length, ys = new Array(n);
  for(let i = 0; i < n; i++){                                       // READ phase — all rect reads back-to-back (one layout flush, no interleaved writes between them)
    const r = pllxTitles[i].getBoundingClientRect();
    ys[i] = (r.bottom < -80 || r.top > vh + 80) ? '0'              // off-screen → rest
          : (clamp(((r.top + r.height / 2) - mid) / vh, -1, 1) * 22).toFixed(1);   // -1 (above) … +1 (below) viewport centre
  }
  for(let i = 0; i < n; i++){                                       // WRITE phase — only the titles whose value actually changed (no reads here → no forced reflow)
    const t = pllxTitles[i], y = ys[i];
    if(t._py !== y){ t._py = y; t.style.transform = y === '0' ? '' : 'translateY(' + y + 'px)'; }
  }
}
function setupStaticParallax(){
  if(mmR.matches || !mmW.matches) return;                          // reduced-motion OR not the compact shell (e.g. a no-GSAP DESKTOP fallback also takes buildStatic) → no parallax
  pllxTitles = chapters.filter(c => c.offsetParent !== null).map(c => c.querySelector('.ch-title')).filter(Boolean);   // visible chapters only — in hero-only mode (≤860) that's just the hero headline (1..7 are display:none)
  if(!pllxTitles.length) return;
  pllxScroll = () => { if(!pllxRaf) pllxRaf = requestAnimationFrame(pllxApply); };
  window.addEventListener('scroll', pllxScroll, { passive: true });
  window.addEventListener('resize', pllxScroll, { passive: true });   // re-prime on URL-bar collapse / orientation flip (innerHeight changes with NO scroll event); pllxScroll coalesces to one rAF
  pllxApply();                                                     // prime initial offsets
}
function teardownStaticParallax(){
  if(pllxScroll){ window.removeEventListener('scroll', pllxScroll); window.removeEventListener('resize', pllxScroll); }
  cancelAnimationFrame(pllxRaf); pllxRaf = 0; pllxScroll = null;
  pllxTitles.forEach(t => { t.style.transform = ''; delete t._py; });
  pllxTitles = [];
}
function buildStatic(){
  sec.classList.add('is-static');
  chapters.forEach(c => { c.removeAttribute('aria-hidden'); if(SUPPORTS_INERT) c.inert = false; });
  buildStaticDescent();
  setupStaticParallax();
  // HERO-ONLY on mobile/compact (≤860, paired with the CSS that display:none's .chapter:not(.chapter-hero)): the 7 narrative
  // chapters duplicate the content sections below and, stripped of the dive footage, read as a long scroll of black scramble-
  // cards. Reveal ONLY the hero headline, and reveal it CLEANLY — the orbital ARTIX wordmark is the one signature decode (no
  // per-char scramble here). Wide reduced-motion / no-GSAP fallbacks keep the full stacked story (those chapters stay visible >860).
  const heroOnly = mmW.matches;
  const targets = heroOnly ? [] : chapters;   // mobile: chapter-hero hidden by CSS; nothing to observe or decode
  if(mmR.matches || typeof IntersectionObserver === 'undefined'){
    targets.forEach(c => { c._on = true; c.classList.add('is-on'); lockChip(c.querySelector('.ch-status')); });   // instant reveal, no per-char motion
  } else {
    // reveal as each target scrolls into view: the full stack decodes (ICE scramble, mirrors the desktop beats); the lone hero just fades in
    staticIO = new IntersectionObserver((ents) => ents.forEach(en => {
      if(en.isIntersecting){ const c = en.target; if(!c._on){ c._on = true; c.classList.add('is-on'); decodeChapter(c); } }
    }), { rootMargin: '0px 0px -40% 0px', threshold: 0.01 });
    targets.forEach(c => staticIO.observe(c));
  }
  built = true;
}
function teardown(){
  teardownSnap();
  teardownStaticParallax();
  try { st && st.kill(); } catch(e){}
  try { dSeq && dSeq.destroy(); } catch(e){}
  try { sSeq && sSeq.destroy(); } catch(e){}
  if(ticker){ clearInterval(ticker); ticker = 0; }
  if(staticIO){ staticIO.disconnect(); staticIO = null; }
  staticTimers.forEach(fn => { try { fn(); } catch(e){} }); staticTimers = [];
  if(mobileWm){ try { mobileWm.destroy(); } catch(e){} mobileWm = null; }
  if(stars){ try { stars.destroy(); } catch(e){} stars = null; }
  cancelAnimationFrame(frostRaf); if(frostDisp){ frostDisp.setAttribute('scale', '0'); delete frostDisp._s; }
  if(telAlt) delete telAlt._v; if(telVel) delete telVel._v;
  if(descentScrim){ descentScrim.style.opacity = ''; delete descentScrim._op; }
  st = dSeq = sSeq = dCanvas = null; locked = false; revealed = false; phaseStory = false; activePrev = -1; built = false;
  sec && sec.classList.remove('is-static');
  if(dStage){ dStage.style.opacity = ''; dStage.style.visibility = ''; delete dStage._op; }
  if(sStage){ sStage.style.opacity = ''; sStage.style.visibility = ''; sStage.style.removeProperty('--seam'); delete sStage._op; delete sStage._seam; }
  dStage && dStage.classList.remove('is-on', 'is-locked', 'is-frozen', 'is-revealed', 'has-canvas-wm');
  if(brand){ brand.style.transform = ''; brand.style.opacity = ''; brand.style.filter = ''; brand.style.willChange = ''; }
  chapters.forEach(c => { c.style.opacity = ''; c.style.transform = ''; c.removeAttribute('aria-hidden'); delete c.dataset.live; delete c._o; delete c._on;
    c.classList.remove('is-on'); if(SUPPORTS_INERT) c.inert = false; else c.querySelectorAll('a,button').forEach(el => el.removeAttribute('tabindex'));
    const sub = c.querySelector('.ch-sub'); if(sub){ clearTimeout(sub._beat); sub.style.opacity = ''; }
    [c.querySelector('.ch-cta'), c.querySelector('.ch-cue')].forEach(el => { if(el){ clearTimeout(el._beat); el.style.opacity = ''; } });   // release the sub-beat hold so a rebuild never strands them invisible
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
  descentScrim = sec.querySelector('.descent-scrim');
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
  onLang = (e) => relocalize(e.detail && e.detail.lang === 'is' ? 'is' : 'en');   // live IS/EN swap, in place (no reload)
  document.addEventListener('artix:lang', onLang);
  build();
}
export function cleanup(){ if(mmW) mmW.removeEventListener('change', onMM); if(mmR) mmR.removeEventListener('change', onMM); if(onBooted){ document.removeEventListener('artix:booted', onBooted); document.removeEventListener('artix:reveal', onBooted); } if(onLang) document.removeEventListener('artix:lang', onLang); if(skipBtn && onSkip) skipBtn.removeEventListener('click', onSkip); teardown(); }
