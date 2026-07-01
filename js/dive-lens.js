// DIVE-LENS — the landing push-through. A WebGL gravitational-lens + membrane-wobble pass over the scroll-scrubbed
// dive frame sequence (assets/dive-frames), with the crystalline-ice ARTIX wordmark composited INTO the lensed scene:
// it scrambles in on entry, holds frozen above the centre line, then on scroll tears through the membrane (warp +
// colour-split on its edges) and zooms through the camera until it exits the frame. Drop-in for the descent stage —
// createDiveLens({canvas, dir, count, settings}) mirrors canvas-seq's { setProgress, redraw, destroy, count } plus
// scrambleIn()/pause()/resume(). Self-contained frame loader (windowed decode + cover-fit) so it never dispatches a
// resize or fights the ScrollTrigger pin. Returns null if WebGL is unavailable (caller then uses createSequence).

import { createWordmarkDecode } from '/js/artix-wordmark-decode.js';   // Treatment-B hero decode (claude-design handoff)
import { setProgress } from '/js/progress-bus.js';   // publish 'hero' readiness (warm + painted) so the loader holds until the live hero is on screen

const VS = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv=vec2(p.x*0.5+0.5,1.0-(p.y*0.5+0.5)); gl_Position=vec4(p,0.0,1.0); }';
// FOCUS-PULL composite (replaces the old gravitational-lens / chromatic "reality membrane" — that warp was timed to the space
// radar→Earth morph and no longer fits the coast→ship footage). The footage sits under a small depth-of-field blur so the ice
// wordmark pops; the blur racks to ZERO before the seam (the story frames are sharp → no blurry→sharp snap). The wordmark gets
// its own soft-focus blur only as it dissolves out. Both blurs are a normalised 9-tap tent, isotropic in screen space via uAspect.
const FS = [
  'precision highp float;',
  'uniform sampler2D uTex; uniform sampler2D uWM; uniform float uAspect; uniform float uBgBlur; uniform float uWmBlur; uniform float uWmDiss;',
  'uniform float uWmScale; uniform float uWmDriftN; uniform float uWmOp;',   // GPU-side wordmark zoom/lift/fade — was CPU-rasterized into wmc + re-uploaded every frame of the exit window (owner-reported stutter); now the bake is static once settled and only these 3 scalars change per frame
  'varying vec2 vUv;',
  'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }',
  'vec3 blur3(vec2 uv, float r){',
  '  if(r < 0.0008) return texture2D(uTex, uv).rgb;',
  '  vec2 o = vec2(r, r*uAspect);',
  '  vec3 s = texture2D(uTex, uv).rgb * 0.25;',
  '  s += (texture2D(uTex,uv+vec2(o.x,0.0)).rgb + texture2D(uTex,uv-vec2(o.x,0.0)).rgb + texture2D(uTex,uv+vec2(0.0,o.y)).rgb + texture2D(uTex,uv-vec2(0.0,o.y)).rgb) * 0.125;',
  '  s += (texture2D(uTex,uv+o).rgb + texture2D(uTex,uv-o).rgb + texture2D(uTex,uv+vec2(o.x,-o.y)).rgb + texture2D(uTex,uv+vec2(-o.x,o.y)).rgb) * 0.0625;',
  '  return s;',
  '}',
  'vec4 blur4(vec2 uv, float r){',                              // 5-tap cross (was 9-tap diamond) — cuts wordmark-blur fetches 44%, concentrated in the same exit window that now also carries the disintegration math
  '  if(r < 0.0008) return texture2D(uWM, uv);',
  '  vec2 o = vec2(r, r*uAspect);',
  '  vec4 s = texture2D(uWM, uv) * 0.4;',
  '  s += (texture2D(uWM,uv+vec2(o.x,0.0)) + texture2D(uWM,uv-vec2(o.x,0.0)) + texture2D(uWM,uv+vec2(0.0,o.y)) + texture2D(uWM,uv-vec2(0.0,o.y))) * 0.15;',
  '  return s;',
  '}',
  'void main(){',
  '  vec3 bg = blur3(vUv, uBgBlur);',
  '  vec2 sd = vUv - vec2(0.5, 0.39); sd.x *= 0.62;',                            // localized scrim behind the wordmark — gentle darkening for legibility (replaces the bg blur; the rest of the frame stays 100% sharp)
  '  float scrim = (1.0 - smoothstep(0.0, 0.40, length(sd))) * (1.0 - uWmDiss) * 0.40;',   // fades out as the wordmark disintegrates so the scene reads clean once the title is gone
  '  bg *= (1.0 - scrim);',
  '  vec4 wm;',
  // wmc is now baked ONCE (at rest: scale=1, drift=0) whenever the wordmark is settled — the continuous per-frame zoom/lift/fade that
  // used to be CPU-rasterized into wmc (forcing a full-resolution re-upload every frame of the exit window) is applied HERE instead, as
  // a UV remap around the wordmark's anchor point before sampling. Uniform scale in PIXEL space needs no aspect correction (the W/H
  // terms cancel — see the derivation in drawWordmark's comment); the disintegration cell grid below stays screen-space so flecks keep
  // a consistent on-screen size regardless of the live zoom.
  '  vec2 wmAnchor = vec2(0.5, 0.36);',
  '  vec2 wmUv = wmAnchor + (vUv - wmAnchor - vec2(0.0, uWmDriftN)) / uWmScale;',
  '  if(uWmDiss > 0.001){',
  '    vec2 cellN = vec2(uAspect, 1.0) * 170.0;',          // square fleck cells (~7px); aspect keeps them square in screen space
  '    vec2 cell  = floor(vUv * cellN);',
  '    float n  = hash(cell);',                            // per-cell vanish threshold (low n leaves first → staggered scatter)
  '    float n2 = hash(cell + 17.3);',                     // per-cell horizontal jitter
  '    vec2 duv = wmUv + vec2((n2 - 0.5) * 0.030 * uWmDiss, uWmDiss * (0.045 + 0.13 * n));',   // each fleck rises HARDER + scatters laterally as it flies off into the spindrift
  '    wm = blur4(duv, uWmBlur);',
  '    float keep = 1.0 - smoothstep(n - 0.06, n + 0.06, uWmDiss);',   // erode the cell once the dissolve front passes its threshold
  '    wm.a *= keep;',
  '    wm.rgb += vec3(0.05, 0.13, 0.20) * wm.a * uWmDiss;',            // icy spark — surviving flecks brighten toward signal-cyan as they fly off
  '  } else {',
  '    wm = blur4(wmUv, uWmBlur);',
  '  }',
  '  wm.a *= uWmOp;',                                                  // global fade (was CPU-baked master alpha; now a uniform so the settled bake never needs re-rasterizing for a pure alpha change either)
  '  vec3 col = mix(bg, wm.rgb, clamp(wm.a, 0.0, 1.0));',
  '  gl_FragColor = vec4(col, 1.0);',
  '}'
].join('\n');

export function createDiveLens({ canvas, dir, count, settings }){
  // FOCUS-PULL knobs (replaces the membrane ampMul/ctr/wid/wob*): bgBlurMax = resting background softness (uv.x units, ~px/canvasW);
  // bgSharpEnd = scroll progress where the background has fully racked to sharp; wmExitStart/End = the wordmark dissolve window;
  // wmBlurMax = soft-focus on the wordmark as it dissolves. All tunable from cinematic.js.
  const cfg = Object.assign({ bgBlurMax: 0.0016, bgSharpEnd: 0.45, wmBlurMax: 0.0030, wmExitStart: 0.08, wmExitEnd: 0.30 }, settings || {});
  let gl = null;
  try { gl = canvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: false, powerPreference: 'high-performance' }); } catch(e){}
  if(!gl) return null;
  canvas.style.opacity = '0';   // stay transparent until the FIRST frame actually paints (the CSS poster behind shows through) → no black flash on load/refresh

  function sh(t, src){ const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[dive-lens]', gl.getShaderInfoLog(s)); return s; }
  function mkTex(){ const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; }
  let prog, quad, loc, tex, wmTex, uA, uBgBlur, uWmBlur, uWmDiss, uWmScaleU, uWmDriftU, uWmOpU;
  function setupGL(){                                         // (re)create every GL resource — called once below AND again on webglcontextrestored
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog);
    quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    tex = mkTex(); wmTex = mkTex();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0); gl.uniform1i(gl.getUniformLocation(prog, 'uWM'), 1);
    uA = gl.getUniformLocation(prog, 'uAspect'); uBgBlur = gl.getUniformLocation(prog, 'uBgBlur'); uWmBlur = gl.getUniformLocation(prog, 'uWmBlur'); uWmDiss = gl.getUniformLocation(prog, 'uWmDiss');
    uWmScaleU = gl.getUniformLocation(prog, 'uWmScale'); uWmDriftU = gl.getUniformLocation(prog, 'uWmDriftN'); uWmOpU = gl.getUniformLocation(prog, 'uWmOp'); }
  setupGL();

  // ── self-contained frame loader (windowed decode + eviction; mirrors canvas-seq but draws cover-fit to our earthC) ──
  const earthC = document.createElement('canvas'); const octx = earthC.getContext('2d', { alpha: false });
  const frames = new Array(count);
  const tries = new Uint8Array(count);   // bounded per-frame retry counter — recover a transient WebP fetch failure instead of staying blank forever
  const srcOf = (i) => dir + 'frame-' + ('000' + i).slice(-4) + '.webp';
  let curF = 1, lastCenter = -1, evictTick = 0;
  const isReady = (im) => !!(im && im.complete && im.naturalWidth > 0);
  // CONCURRENCY GATE — lives INSIDE load() itself (not bolted onto one caller) so EVERY path that wants a frame — the cold-start warm
  // set, setFrame()'s forward lookahead window, AND coverDraw()'s on-demand fetch — shares one budget. (A prior version of this fix
  // only throttled the warm-set's own loop, but setFrame(0) ALSO fires a 1-73 frame window directly and unconditionally on init,
  // completely bypassing that external throttle — the real burst was never actually reduced. Centralizing it here is the only place
  // that can't be raced around.) Speculative callers (warm set, lookahead window) queue past the cap; coverDraw's `prioritize=true`
  // bypasses it outright — the frame actively blocking the visible render must never wait behind a queue of frames nobody's looking at.
  let inflightLoads = 0; const MAX_INFLIGHT = 8; const pendingQueue = [];
  function startLoad(i, onSettle){
    const im = new Image(); im.decoding = 'async'; let settled = false;
    const done = () => { if(settled) return; settled = true; clearTimeout(stall); onSettle(); };
    const stall = setTimeout(() => {                                                    // STALL WATCHDOG — a request that neither loads nor errors (a silent network drop, not a clean failure) would otherwise hang this slot forever; force a fresh retry
      if(frames[i-1] !== im || settled) return; frames[i-1] = undefined;
      if(tries[i-1] < 4){ tries[i-1]++; startLoad(i, onSettle); } else done(); }, 6000);
    im.onload = done;
    im.onerror = () => { if(frames[i-1] !== im) return; frames[i-1] = undefined; clearTimeout(stall);  // free the slot (was: a failed/aborted request stayed in the array forever → permanent black / frozen frame)
      if(tries[i-1] < 4){ tries[i-1]++; setTimeout(() => { if(!frames[i-1]) startLoad(i, onSettle); }, 300 * tries[i-1]); }   // capped backoff retry so a transient miss self-heals
      else done(); };
    im.src = srcOf(i); frames[i-1] = im; if(im.decode) im.decode().catch(() => {}); }
  function drainQueue(){ while(inflightLoads < MAX_INFLIGHT && pendingQueue.length){ const job = pendingQueue.shift();
      if(frames[job.i - 1]){ if(job.onDone) job.onDone(); continue; }                    // loaded by another path while queued
      inflightLoads++; startLoad(job.i, () => { inflightLoads--; if(job.onDone) job.onDone(); drainQueue(); }); } }
  function load(i, onDone, prioritize){ if(i < 1 || i > count){ if(onDone) onDone(); return; }
    if(frames[i-1]){ if(onDone) onDone(); return; }
    if(prioritize || inflightLoads < MAX_INFLIGHT){ inflightLoads++; startLoad(i, () => { inflightLoads--; if(onDone) onDone(); drainQueue(); }); }
    else { pendingQueue.push({ i, onDone }); } }
  function drop(im){ if(im){ im.onerror = null; im.src = ''; } }   // null onerror BEFORE blanking src so the abort doesn't trip the retry
  function setFrame(p){ const f = 1 + Math.max(0, Math.min(1, p)) * (count - 1); curF = f; const c = Math.round(f);
    if(c !== lastCenter){ lastCenter = c; for(let i = c - 8; i <= c + 72; i++) load(i);   // wide FORWARD-biased window: 72 frames lead (was 48) — re-tuned for the native-1920 frames' heavier decode cost so the bezier glide's peak velocity never out-runs decode; gated by the shared concurrency budget above, NOT unconditional
      if(++evictTick >= 4){ evictTick = 0;                                                // throttle the O(count) eviction scan to every 4th center-change (was every change) — eviction doesn't need rAF precision, and the fast glide changes center nearly every frame
        for(let i = 1; i <= count; i++){ const im = frames[i-1]; if(im && Math.abs(i - c) > 96){ drop(im); frames[i-1] = undefined; } } } } }
  function coverDraw(){ const cw = earthC.width, ch = earthC.height; if(!cw) return false;
    const lo = Math.max(1, Math.min(count, Math.floor(curF))), hi = Math.min(count, lo + 1), frac = curF - lo;
    const a = frames[lo-1]; if(!isReady(a)){ load(lo, undefined, true); return false; }   // FRAME-EXACT: hold the last drawn frame until this one is ready (no substitute frame → no halt-snap). PRIORITIZED — this frame is blocking the visible render right now, it must never wait behind speculative lookahead
    const cover = (im) => { const ir = im.naturalWidth / im.naturalHeight, cr = cw / ch; let w, h;
      if(ir > cr){ h = ch; w = ch * ir; } else { w = cw; h = cw / ir; } octx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h); };
    octx.globalAlpha = 1; cover(a);
    const b = frames[hi-1]; if(frac > 0 && isReady(b)){ octx.globalAlpha = frac; cover(b); octx.globalAlpha = 1; }
    return true; }
  const prefetchCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const WARM_PRELOAD = 50;   // warm gate checks decode-readiness of these Image objects, not just HTTP cache presence
  let fetched = 0, prefetchDone = false;
  // WARM SET — load the opening frames as real Image objects (direct decode, not just HTTP cache) IMMEDIATELY on creation, i.e.
  // WHILE the loader overlay is still up. boot.js gates the overlay's release on the hero being warm + painted (see the 'hero'
  // publish in frame()), so this heavy preload happens BEHIND the loading screen instead of competing with the wordmark decode that
  // fires the instant the loader clears. (A module-init prefetch WAS a verified "frames don't load on refresh" cause — but that was
  // the FULL 356-frame storm starving frame-1; the bounded 50-frame warm set, loaded first, IS the loader's job now.)
  // BOUNDED CONCURRENCY (owner: "sometimes images don't load on first open") — requesting all 50 at once was a thundering herd on a
  // cold connection/cold CPU: 50 simultaneous network requests + 50 simultaneous WebP decodes contending with each other AND the
  // page's other first-load work (fonts, JS modules, CSS) — exactly the kind of contention that drops or stalls a request on a
  // slow/flaky link. These 50 calls just feed the shared MAX_INFLIGHT gate above (frame-0001 first in line, the rest queue behind it).
  for(let k = 1; k <= Math.min(WARM_PRELOAD, count); k++) load(k);
  // REST OF THE SEQUENCE — held back until the entry wordmark decode SETTLES (frame() trips runPrefetchRest), so the ~2.7s decode runs
  // with zero network/decode contention. An early scroll is still warm-gated (cinematic.js) so the dive only scrubs once cached; the
  // bulk streams in during the seconds the viewer reads the resting hero. Owner-directed: prefer a longer load over any entry lag.
  let prefetchStarted = false;
  // REBUILT (owner: "first scroll isn't smooth, every scroll after is" — persisted even after the GPU-idle fix). Root cause: this used
  // to be a raw fetch() pass — it warms the HTTP byte cache but NEVER actually decodes a frame into a ready-to-draw bitmap. dSeq.cached
  // (the gate that releases the first glide) was true the instant BYTES were downloaded, not once frames were genuinely decode-ready —
  // a materially weaker guarantee than its name implies. The descent is the ONLY glide that ever touches most of these 356 frames for
  // the FIRST time; every later chapter-to-chapter glide reuses story-frames the browser already decoded during earlier scrolling. At
  // the glide's peak velocity (~160 frames/sec, the bezier ease's steep midsection) the 72-frame forward lookahead window gets consumed
  // faster than 6-8 concurrent WebP decodes can clear it, so coverDraw() repeatedly hits an undecoded frame and holds — visible judder,
  // concentrated exactly in the fast part of the FIRST glide only. Fix: actually decode every frame here (im.decode(), not just fetch),
  // store it in frames[] so coverDraw() finds it instantly ready, and only mark prefetchDone once every frame's decode has genuinely
  // settled — so dSeq.cached now means what it claims. Frames already claimed by the warm set (1-50) are polled for real readiness
  // instead of counted immediately (load()'s "already claimed" branch resolves without waiting — counting that here would reintroduce
  // the exact premature-cached bug avoided in the previous concurrency fix).
  function runPrefetchRest(){ if(prefetchStarted) return; prefetchStarted = true;
    let i = 1, inflight = 0;
    const settle = () => { inflight--; fetched++; if(fetched >= count) prefetchDone = true; pump(); };
    const pump = () => { while(inflight < 6 && i <= count){ const k = i++; inflight++;
        if(frames[k-1]){ const check = () => { if(isReady(frames[k-1])) settle(); else setTimeout(check, 50); }; check(); continue; }
        const im = new Image(); im.decoding = 'async'; im.src = srcOf(k); frames[k-1] = im;
        const onErr = () => { frames[k-1] = undefined; settle(); };   // clear the slot on failure — leaving the broken Image there would block load()'s own retry-with-backoff from ever firing later (its "already claimed" guard would just see this dead object and skip)
        if(im.decode) im.decode().then(settle).catch(onErr); else { im.onload = settle; im.onerror = onErr; } } };
    pump(); }
  // safety net: if no reveal/settle ever fires (e.g. session-cached skip under reduced motion), still fill the cache shortly after load
  window.addEventListener('load', () => setTimeout(runPrefetchRest, 4500), { once: true });

  // ── ice ARTIX wordmark (its own canvas; warped/composited by the shader) ──
  // Treatment-B instrument decode (claude-design handoff) draws the wordmark+slogan; this file keeps the placing, the resting
  // glow (re-added in the decode module), the scroll-driven zoom-through, and the WebGL lens/chromatic-tear composite unchanged.
  const wmc = document.createElement('canvas'); const wmctx = wmc.getContext('2d');
  if(document.fonts){ document.fonts.load('400 100px Michroma').catch(() => {}); document.fonts.load('500 100px "Martian Mono"').catch(() => {}); }
  const wmDecode = createWordmarkDecode({ subGap: 0.8, titleStagger: 220, sub: document.documentElement.lang === 'is' ? 'ÚTVEGAÐ. AFHENT. STUTT.' : 'SOURCED. DELIVERED. SUPPORTED.' });   // 220ms per letter = strict sequential (A→R→T→I→X)
  let progress = 0, t0 = performance.now(), raf = 0, running = false;
  // per-frame change tracking — skip the expensive work (layout reflow, cover redraw, GPU uploads, wordmark glyph loop) when nothing changed
  let needsFit = true, lastDrawnF = -1, earthDirty = false, ro = null;   // earthDirty starts FALSE so the first frame() doesn't upload an empty earthC (black) over the poster — it's set true only once coverDraw actually draws
  // SETTLED-BAKE state (owner-reported wordmark-exit stutter, confirmed via live frame timing: a dense run of 30fps frames exactly
  // spanning the exit window, even with the decode already settled — traced to drawWordmark CPU-rasterizing + fully re-uploading wmc
  // EVERY frame because scale/drift genuinely change frame-to-frame there, defeating the old dirty-gate). Once wmDecode.settled, the
  // bitmap content itself never changes again — bake it ONCE at a neutral pose and drive scale/drift/alpha as shader uniforms instead.
  let bakedSettled = false, wmTexStale = false, wmTexNeedsUpload = false, wmScaleV = 1, wmDriftV = 0, wmOpV = 1, lastWmScaleV = -1, lastWmDriftV = -1, lastWmOpV = -1;
  // wmc (wordmark canvas) resolution: FULL DPR at ALL times, including during the scramble-in churn (owner: the decode must stay
  // crystal-crisp — never down-rezzed). The decode is kept smooth NOT by dropping resolution but by removing contention: the dive
  // frame prefetch is held back until the decode settles (see runPrefetchRest), so the ~2.7s decode owns the main thread. The shader
  // samples wmc in normalised UV, so wmc's pixel count only affects sharpness, never geometry/placing.
  const WM_FULL_DPR = 2;   // wordmark renders at native retina (was 1.5 → text was sub-native + browser-upscaled = blurry on hi-DPI desktops)
  const onResize = () => { needsFit = true; };
  try { ro = new ResizeObserver(() => { needsFit = true; }); ro.observe(canvas); } catch(e){}
  window.addEventListener('resize', onResize, { passive: true });

  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function drawWordmark(e){
    // DISINTEGRATION exit: the wordmark holds crisp, then as the camera pushes toward the ship it shatters into a field of icy flecks
    // that lift and scatter upward (the per-cell erode/rise/spark is in the shader via uWmDiss). Here we only keep the TEXTURE solid for
    // the shader to disintegrate (so flecks carry real letter pixels), with a tiny global scale+lift; the master alpha holds ~1 until the
    // very end then clears the last remnant. No 43× zoom-tear, no chromatic membrane.
    const scale = 1 + e * 0.05;                                     // subtle push (the scatter is the event)
    const op = 1 - sstep(0.82, 1.0, e);                            // hold solid through the scatter, fade only the final remnant
    const drift = -e * wmc.height * 0.018;                         // tiny global lift (the shader does the per-fleck rise)

    if(wmDecode.settled){
      // SETTLED — content is a fixed locked bitmap that never changes again on its own; bake it ONCE at a neutral pose (scale=1,
      // drift=0, alpha=1) and drive scale/drift/alpha as shader uniforms instead (uWmScale/uWmDriftN/uWmOp — applied as a UV remap
      // around the wordmark's anchor in the fragment shader). Uniform pixel-space scale needs no aspect correction (the canvas
      // width/height terms cancel in the derivation); the scale here only ever ranges [1, 1.05] so the remapped sample is always
      // PULLED TOWARD the anchor, never pushed beyond the baked content's bounds — no CLAMP_TO_EDGE smearing risk for this range.
      wmTexNeedsUpload = false;                                     // separate from the return value: frame() must only re-upload the GPU texture on ACTUAL content change, never on a pure uniform (scale/drift/op) change — that's the whole point of this rewrite
      if(!bakedSettled || wmTexStale){
        wmTexStale = false;
        if(!bakedSettled){                                          // content itself is stale (never baked, or a resize cleared wmc) — actually re-render; a context-restore alone doesn't need this (wmc's pixels survive a WebGL-only context loss)
          bakedSettled = true;
          wmctx.clearRect(0, 0, wmc.width, wmc.height);
          const fs = Math.round(wmc.height * 0.11);
          wmctx.save();
          wmctx.translate(wmc.width * 0.5, wmc.height * 0.36);
          wmDecode.draw(wmctx, 0, 0, fs, performance.now(), 1, 1);
          wmctx.restore();
        }
        wmTexNeedsUpload = true;
      }
      wmScaleV = scale; wmDriftV = drift / wmc.height; wmOpV = op;
      const uniformsChanged = (wmScaleV !== lastWmScaleV || wmDriftV !== lastWmDriftV || wmOpV !== lastWmOpV);
      lastWmScaleV = wmScaleV; lastWmDriftV = wmDriftV; lastWmOpV = wmOpV;
      return wmTexNeedsUpload || uniformsChanged;                    // still tells frame() "redraw the frame" (gl.drawArrays) — just no longer forces a texture re-upload for a pure uniform change
    }

    // NOT YET SETTLED (churn-in entrance) — the churn glyphs animate every frame on their own internal clock regardless of
    // scale/op/drift (both pinned at neutral here anyway, since e is 0 before wmExitStart), so always redraw — unchanged from
    // the original per-frame behavior for this phase. The shader-side uniforms stay neutral (1,0,1): the CPU bake below already
    // applies scale/drift/op directly to pixels, so the shader must NOT also transform it (would double-apply).
    bakedSettled = false; wmTexStale = false; wmTexNeedsUpload = true;   // this branch always redraws the CPU canvas below, so the texture always needs a fresh upload — matches the original's unconditional churn-frame behavior
    wmScaleV = 1; wmDriftV = 0; wmOpV = 1;
    wmctx.clearRect(0, 0, wmc.width, wmc.height);
    if(op <= 0.002) return true;                                    // fully scattered + remnant cleared — nothing to draw
    const fs = Math.round(wmc.height * 0.11);                       // KEEP: wordmark size
    wmctx.save();
    wmctx.translate(wmc.width * 0.5, wmc.height * 0.36 + drift);    // KEEP: wordmark placing (origin) + exit lift
    wmctx.scale(scale, scale);
    wmDecode.draw(wmctx, 0, 0, fs, performance.now(), op, scale);   // Treatment-B decode; op = master alpha, scale gates the locked-bitmap cache
    wmctx.restore();
    return true;
  }

  function fit(){
    if(!needsFit) return false; needsFit = false;                  // only re-measure on a real resize (ResizeObserver) — no getBoundingClientRect reflow every frame
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);   // render at native retina (was 1.5 → hero was sub-native + browser-upscaled = soft on hi-DPI desktops)
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    let resized = false;
    if(canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); resized = true; }
    if(earthC.width !== w || earthC.height !== h){ earthC.width = w; earthC.height = h; resized = true; }   // earthC = canvas res (FULL quality — must match the story frames so the dive→coast hand-off is seamless, no blurry→sharp snap)
    const wmDpr = Math.min(window.devicePixelRatio || 1, WM_FULL_DPR);   // wordmark canvas: FULL res at all times — crisp churn + crisp rest (see WM_FULL_DPR note)
    const ww = Math.max(2, Math.round(r.width * wmDpr)), wh = Math.max(2, Math.round(r.height * wmDpr));
    if(wmc.width !== ww || wmc.height !== wh){ wmc.width = ww; wmc.height = wh; resized = true; }
    return resized;
  }

  let painted = false, heroLast = -1, lastBgBlur = -1, lastWmBlur = -1, lastWmDiss = -1, lastDrawAt = 0;
  function frame(){
    const resized = fit();
    if(resized){ bakedSettled = false; }            // a wmc/earth realloc cleared the wordmark canvas → force one re-bake+upload (also re-bakes it crisp after the settle resize)
    let dirty = resized;
    if(curF !== lastDrawnF || resized){ if(coverDraw()){ lastDrawnF = curF; earthDirty = true; dirty = true; } }   // earthC only changes when the frame/blend moves or on resize
    if(!painted && lastDrawnF < 0 && !earthDirty){ if(running) raf = requestAnimationFrame(frame); return; }   // nothing has ever drawn (first frame not ready) — hold the canvas transparent so the CSS poster shows (no black flash); skip the GL draw
    const e = sstep(cfg.wmExitStart, cfg.wmExitEnd, progress);                  // wordmark exit progress (0 held → 1 fully scattered)
    const wmChanged = drawWordmark(e); if(wmChanged) dirty = true;
    // FOCUS-PULL + DISINTEGRATION amounts (ride scroll, not a centred membrane): bg racks soft→sharp before the seam; the wordmark soft-blurs
    // and SHATTERS into rising icy flecks as it exits (uWmDiss drives the per-cell erode/rise/spark in the shader)
    const bgBlur = cfg.bgBlurMax * (1 - sstep(0.10, cfg.bgSharpEnd, progress));
    const wmBlur = cfg.wmBlurMax * sstep(cfg.wmExitStart + 0.06, cfg.wmExitEnd, progress);
    const wmDiss = e;
    if(bgBlur !== lastBgBlur || wmBlur !== lastWmBlur || wmDiss !== lastWmDiss) dirty = true;
    // GPU KEEP-ALIVE (owner: "first scroll isn't smooth, every scroll after is") — the idle-skip below is a genuine perf win (0 GPU
    // draws at rest) but it means the WebGL pipeline can sit fully idle for however long the viewer reads the resting hero before
    // their first scroll. This is the ONLY glide that touches WebGL at all — every later chapter-to-chapter glide scrubs the story on
    // a plain 2D canvas, which has no comparable "pipeline" to go cold. GPU drivers/compositors commonly downclock or evict resources
    // during real idle stretches, so the first scroll can pay a one-time wake-up cost that no later glide ever hits — matching the
    // reported pattern exactly. Force one cheap draw at least every 800ms even at rest so the pipeline never goes fully cold; ~1.25
    // draws/sec is negligible GPU cost, nowhere near the "redraw every rAF" cost this idle-skip was originally added to remove.
    const now = performance.now();
    if(!dirty && now - lastDrawAt > 800) dirty = true;
    if(dirty || !painted){                                                       // idle-skip: at rest (no scroll, decode settled) nothing changes → no GPU draw (was: redraw every rAF for the now-removed wobble)
      lastDrawAt = now;
      try { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        if(earthDirty){ earthDirty = false; gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, earthC); } } catch(e){}
      try { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, wmTex);
        if(wmTexNeedsUpload){ gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, wmc); } } catch(e){}   // was gated on wmChanged (texture-content OR uniform change) — now gated on the content-only flag, so the wordmark-exit window's continuous scale/drift/op change no longer forces a full-resolution re-upload every frame
      if(resized || !painted) gl.uniform1f(uA, canvas.width / Math.max(1, canvas.height));   // only changes on resize — was rewritten every dirty frame (i.e. every frame of the wordmark-exit window) for an unchanging value
      gl.uniform1f(uBgBlur, bgBlur); gl.uniform1f(uWmBlur, wmBlur); gl.uniform1f(uWmDiss, wmDiss);
      gl.uniform1f(uWmScaleU, wmScaleV); gl.uniform1f(uWmDriftU, wmDriftV); gl.uniform1f(uWmOpU, wmOpV);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      lastBgBlur = bgBlur; lastWmBlur = wmBlur; lastWmDiss = wmDiss;
      if(!painted){ painted = true; canvas.style.opacity = '1'; }                         // first real paint — fade the canvas in over the poster (CSS transition)
    }
    // HERO READINESS → loader: once the canvas has painted AND the warm set is decoded, the live hero is fully on screen → release the
    // overlay. Publish a fraction so the loader's meter reflects real preload (painted ⇒ ≥0.4; 1.0 at warm). Stops scanning once warm
    // (heroLast===1) so there's zero idle cost for the rest of the page's life.
    // HERO READINESS → loader. The signal now spans the WHOLE dive prefetch so the loader holds until the dive is fully CACHED (not just
    // the 50-frame warm set): the descent's first scroll is a fast 356-frame scrub, so EVERY frame must be ready before the loader lifts —
    // no mid-dive streaming stutter. painted ⇒ 0.30; warm set decoded ⇒ 0.60 AND the bulk prefetch STARTS here (during the loader, while
    // there's zero contention — the wordmark decode only runs after the loader); full dive cached ⇒ 1.0. boot.js's bar follows this, so the
    // loading time honestly represents the lazy-load completing. (Owner-directed: a longer, honest load beats any in-experience lag.)
    if(painted && heroLast < 1){ let hp;
      if(prefetchStarted){ hp = Math.min(1, 0.6 + 0.4 * (fetched / count)); }   // bulk prefetch running: track real cache fill 0.6 → 1.0
      else { let r = 0; for(let k = 0; k < Math.min(WARM_PRELOAD, count); k++) if(isReady(frames[k])) r++;
        if(r >= WARM_PRELOAD){ runPrefetchRest(); hp = 0.6; } else hp = 0.3 + 0.3 * (r / WARM_PRELOAD); }   // warm set decoding 0.3 → 0.6, then kick the bulk fill
      if(hp > heroLast){ heroLast = hp; try { setProgress('hero', hp); } catch(e){} } }
    if(running) raf = requestAnimationFrame(frame);
  }
  function start(){ if(running) return; running = true; raf = requestAnimationFrame(frame); }
  function stop(){ running = false; cancelAnimationFrame(raf); }
  // GPU dropped the WebGL context: fall back to the poster (canvas transparent) instead of a permanent black canvas, and stop the loop
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); painted = false; lastDrawnF = -1; earthDirty = false; canvas.style.opacity = '0'; stop(); }, false);
  // RESTORE (owner: "sometimes the video just disappears and background is black") — preventDefault() above IS what tells the browser to
  // actually attempt restoration (GPU resets/driver hiccups/too many contexts piling up across refreshes are the common real-world
  // triggers), but nothing was ever resuming afterward: the old program/buffers/textures were destroyed with the lost context and the
  // render loop had been stop()'d, so even a successful browser-side restore left the page permanently black until a manual reload.
  // earthC (the 2D source canvas) and wmc (the wordmark canvas) are untouched by a WebGL context loss — only the GL-side resources need
  // recreating — so this just rebuilds the program/buffers/textures, forces one full re-upload of the already-decoded content, and
  // resumes the loop. No re-fetch, no re-decode, no visible re-scramble.
  canvas.addEventListener('webglcontextrestored', () => {
    setupGL(); earthDirty = true; wmTexStale = true; needsFit = true; start(); }, false);   // wmTexStale (not bakedSettled=false): wmc's pixels survive a WebGL-only context loss, so this only needs a re-upload, not a re-bake
  setFrame(0); start();

  return {
    setProgress(p){ progress = Math.max(0, Math.min(1, p)); setFrame(progress); if(!running) start(); },
    scrambleIn(){ wmDecode.scrambleIn(performance.now());
      setTimeout(runPrefetchRest, 3200);   // decode is ~2.7s; fallback if the settle-trip is missed (e.g. reduced motion never bakes) — fill the rest of the cache anyway
      bakedSettled = false; },
    setSub(s){ wmDecode.setSub(s); bakedSettled = false; },   // relocalise slogan; force drawWordmark to re-bake+re-upload next frame
    redraw(){},
    pause: stop,
    resume: start,
    get count(){ return count; },
    get warm(){ for(let k = 0; k < Math.min(WARM_PRELOAD, count); k++){ if(!isReady(frames[k])) return false; } return true; },   // true once the first WARM_PRELOAD Image objects are decoded + drawable — stronger than HTTP cache presence (which can silently fail or be incomplete)
    get cached(){ return prefetchDone; },   // true once ALL count frames have been HTTP-prefetched (the whole dive is in cache → the fast scrub never network-stalls). The loader gates on this via the 'hero' signal.
    get painted(){ return painted; },   // true once the WebGL hero has drawn its first real frame (loader waits on this so the live render shows on entry)
    destroy(){ stop(); try { ro && ro.disconnect(); } catch(e){} window.removeEventListener('resize', onResize); try { prefetchCtrl && prefetchCtrl.abort(); } catch(e){}
      for(let i = 0; i < frames.length; i++){ drop(frames[i]); } frames.length = 0;
      try { gl.deleteTexture(tex); gl.deleteTexture(wmTex); gl.deleteBuffer(quad); gl.deleteProgram(prog); gl.clear(gl.COLOR_BUFFER_BIT); } catch(e){} }
  };
}
