// DIVE-LENS — the landing push-through. A WebGL gravitational-lens + membrane-wobble pass over the scroll-scrubbed
// dive frame sequence (assets/dive-frames), with the crystalline-ice ARTIX wordmark composited INTO the lensed scene:
// it scrambles in on entry, holds frozen above the centre line, then on scroll tears through the membrane (warp +
// colour-split on its edges) and zooms through the camera until it exits the frame. Drop-in for the descent stage —
// createDiveLens({canvas, dir, count, settings}) mirrors canvas-seq's { setProgress, redraw, destroy, count } plus
// scrambleIn()/pause()/resume(). Self-contained frame loader (windowed decode + cover-fit) so it never dispatches a
// resize or fights the ScrollTrigger pin.
//
// TWO RENDER BACKENDS, one everything-else: Chrome/Firefox/Edge composite through the WebGL shader; Safari (and any
// browser where WebGL creation fails) composites through a pixel-faithful 2D-canvas port of the same effects — see the
// "2D COMPOSITOR" section for the full why. Returns null only if BOTH context types are unavailable (caller then uses
// createSequence).

import { createWordmarkDecode } from '/js/artix-wordmark-decode.js';   // Treatment-B hero decode (claude-design handoff)
import { setProgress } from '/js/progress-bus.js';   // publish 'hero' readiness (warm + painted) so the loader holds until the live hero is on screen

const VS = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv=vec2(p.x*0.5+0.5,1.0-(p.y*0.5+0.5)); gl_Position=vec4(p,0.0,1.0); }';
// FOCUS-PULL composite (replaces the old gravitational-lens / chromatic "reality membrane" — that warp was timed to the space
// radar→Earth morph and no longer fits the coast→ship footage). The footage sits under a small depth-of-field blur so the ice
// wordmark pops; the blur racks to ZERO before the seam (the story frames are sharp → no blurry→sharp snap). The wordmark gets
// its own soft-focus blur only as it dissolves out. Both blurs are a normalised 9-tap tent, isotropic in screen space via uAspect.
// buildFS(sub): sub=true → the SUBLIMATION exit (the DEFAULT since 2026-07-01); sub=false → the legacy fleck-shatter
// exit (?exit=shatter; output identical to the original FS string). Sublimation: instead of the per-cell fleck
// scatter, a fine ice-grain noise field (uNoise — the
// SAME 512px field the 2D compositor bakes its masks from, so both backends erode identically) eats the letterforms at
// pixel level while the whole mark lifts as one body (uWmDriftN) and soft-focuses out. Sampled at wmUv (not vUv) so the
// grain RIDES the mark through its exit scale/lift — matching the 2D path, which erodes in source space before transforming.
const buildFS = (sub) => [
  'precision highp float;',
  'uniform sampler2D uTex; uniform sampler2D uWM; uniform float uAspect; uniform float uBgBlur; uniform float uWmBlur; uniform float uWmDiss;',
  'uniform float uWmScale; uniform float uWmDriftN; uniform float uWmOp;',   // GPU-side wordmark zoom/lift/fade — was CPU-rasterized into wmc + re-uploaded every frame of the exit window (owner-reported stutter); now the bake is static once settled and only these 3 scalars change per frame
  ...(sub ? ['uniform sampler2D uNoise; uniform float uNScale;'] : []),      // sublimation only: the shared ice-grain field + device-px→texel scale
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
  ...(sub ? [
  '    float n = texture2D(uNoise, wmUv * vec2(uAspect, 1.0) * uNScale).r;',   // ice-grain threshold field, anchored to the letterforms (see buildFS note)
  '    wm = blur4(wmUv, uWmBlur);',                                            // no per-fleck remap — the mark lifts as ONE body via uWmDriftN while the grain erodes it
  '    float keep = 1.0 - smoothstep(n - 0.06, n + 0.06, uWmDiss);',           // pixel-level erode once the dissolve front passes the grain threshold
  '    wm.a *= keep;',
  '    wm.rgb += vec3(0.05, 0.13, 0.20) * wm.a * uWmDiss;',                    // same icy breath as the shatter — surviving ink cools toward signal-cyan
  ] : [
  '    vec2 cellN = vec2(uAspect, 1.0) * 170.0;',          // square fleck cells (~7px); aspect keeps them square in screen space
  '    vec2 cell  = floor(vUv * cellN);',
  '    float n  = hash(cell);',                            // per-cell vanish threshold (low n leaves first → staggered scatter)
  '    float n2 = hash(cell + 17.3);',                     // per-cell horizontal jitter
  '    vec2 duv = wmUv + vec2((n2 - 0.5) * 0.030 * uWmDiss, uWmDiss * (0.045 + 0.13 * n));',   // each fleck rises HARDER + scatters laterally as it flies off into the spindrift
  '    wm = blur4(duv, uWmBlur);',
  '    float keep = 1.0 - smoothstep(n - 0.06, n + 0.06, uWmDiss);',   // erode the cell once the dissolve front passes its threshold
  '    wm.a *= keep;',
  '    wm.rgb += vec3(0.05, 0.13, 0.20) * wm.a * uWmDiss;',            // icy spark — surviving flecks brighten toward signal-cyan as they fly off
  ]),
  '  } else {',
  '    wm = blur4(wmUv, uWmBlur);',
  '  }',
  '  wm.a *= uWmOp;',                                                  // global fade (was CPU-baked master alpha; now a uniform so the settled bake never needs re-rasterizing for a pure alpha change either)
  '  vec3 col = mix(bg, wm.rgb, clamp(wm.a, 0.0, 1.0));',
  '  gl_FragColor = vec4(col, 1.0);',
  '}'
].join('\n');

// ── shared ice-grain noise field (?exit=sub only) — generated ONCE, used by BOTH backends ──────────────────────────
// A 512px-tiling 3-octave value-noise field built from the same sin-hash the shader/2D cell hash uses (deterministic:
// scrub-back replays identically, and the GL noise TEXTURE is uploaded from the same canvas the 2D masks bake from, so
// the two backends erode the exact same pattern). Feature mix: 64px patches (erosion happens in organic clumps) +
// 8px + 4px grain (crisp frost-crystal edges). Histogram stretched so the threshold sweep uses the full 0..1 band.
const NSIZE = 512;
let _iceNoise = null;
function iceNoise(){
  if(_iceNoise) return _iceNoise;
  const N = NSIZE, data = new Float32Array(N * N);
  const fr = (x) => x - Math.floor(x);
  const h2 = (x, y) => fr(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
  const oct = (px, py, P, seed) => {                       // wrapped-lattice value noise, period NSIZE/P px, smoothstep-interpolated
    const u = px * P / N, v = py * P / N;
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const xa = x0 % P, ya = y0 % P, xb = (x0 + 1) % P, yb = (y0 + 1) % P;
    const a = h2(xa + seed, ya - seed), b = h2(xb + seed, ya - seed), c = h2(xa + seed, yb - seed), d = h2(xb + seed, yb - seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for(let y = 0; y < N; y++){ for(let x = 0; x < N; x++){
    let n = 0.50 * oct(x, y, 8, 0) + 0.35 * oct(x, y, 64, 91) + 0.15 * oct(x, y, 128, 173);
    n = (n - 0.5) * 2.1 + 0.5;                             // stretch the bell-shaped 3-octave sum back toward full range (clipped tails just erode first/linger last — same as the shatter's hash extremes)
    data[y * N + x] = Math.min(0.999, Math.max(0.001, n));
  } }
  const canvas = document.createElement('canvas'); canvas.width = N; canvas.height = N;
  const cx = canvas.getContext('2d'), id = cx.createImageData(N, N), px = id.data;
  for(let i = 0; i < N * N; i++){ const v = (data[i] * 255) | 0; px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
  cx.putImageData(id, 0, 0);
  return (_iceNoise = { data, canvas });
}

export function createDiveLens({ canvas, dir, count, settings }){
  // FOCUS-PULL knobs (replaces the membrane ampMul/ctr/wid/wob*): bgBlurMax = resting background softness (uv.x units, ~px/canvasW);
  // bgSharpEnd = scroll progress where the background has fully racked to sharp; wmExitStart/End = the wordmark dissolve window;
  // wmBlurMax = soft-focus on the wordmark as it dissolves. All tunable from cinematic.js.
  const cfg = Object.assign({ bgBlurMax: 0.0016, bgSharpEnd: 0.45, wmBlurMax: 0.0030, wmExitStart: 0.08, wmExitEnd: 0.30 }, settings || {});
  // ── BACKEND SELECTION — WebGL everywhere EXCEPT Safari/WebKit; the 2D compositor there (and as the no-WebGL fallback) ──
  // desynchronized:true — THE fix for the "first scroll (descent) isn't smooth, every scroll after (story) is" report ON CHROME. Root cause
  // found by live Chrome profiling (Long-Animation-Frames API + per-frame timing, tab kept foreground so rAF ran at 60fps): the descent glide
  // ran at 33ms/frame (30fps) while the identically-sized, identically-scrolled STORY canvas ran at 16.7ms (60fps). The ONLY difference is
  // WebGL vs 2D-canvas: a 2D canvas has a fast compositor-blit path, but a normal WebGL canvas must SYNC its backbuffer to the page compositor
  // every frame, and during a Lenis/ScrollTrigger scroll that sync back-pressures the main thread (~+16ms). desynchronized:true opts into
  // Chrome's low-latency canvas path, which bypasses that sync → measured descent glide dropped 33ms→16.7ms (30→60fps), matching the story.
  // Zero visual change (it only affects present latency, not pixels). It was NOT: decode-starvation (0 holds), texture upload (texSubImage2D
  // ~0ms), fragment shader (~0ms), fill-rate (DPR-1 didn't help), MSAA, or blend/backdrop overlays — all ruled out by measurement.
  //
  // SAFARI GETS NO WEBGL AT ALL — the owner's follow-up report ("descent glitches/lags EVERY time in Safari, ONLY the first 10s clip, fine in
  // Chrome") plus research killed every keep-WebGL option there: `desynchronized` has ZERO WebKit support for the WebGL context path (caniuse:
  // unsupported on every Safari/iOS-Safari version), so Safari is permanently stuck on exactly the synchronized compositor path Chrome needed
  // rescuing from; `powerPreference:'high-performance'` is a proven WebKit no-op on macOS (WebKit bug 202834, WONTFIX) with an iOS-15.5+
  // regression on top; and WebKit's ANGLE/Metal backend has its own documented per-frame canvas→texture upload costs (WebKit bugs 230749,
  // 239015) that Chromium's ANGLE doesn't share — a cost this renderer pays EVERY frame (earthC/wmc are uploaded as textures). Meanwhile the
  // story chapters — same 1920×1080 frames, same scroll engine, same machine — run smooth in Safari on a plain 2D canvas. So Safari now renders
  // the descent through the 2D COMPOSITOR below: the same loader, the same earthC/wmc pipelines, every effect reproduced pixel-faithfully, and
  // the visible surface becomes the same fast canvas type the story already proves out. A/B override on any browser: ?dive=2d forces the 2D
  // compositor, ?dive=gl forces WebGL (useful for comparing the two live on Safari itself).
  const qsDive = (() => { try { return new URLSearchParams(location.search).get('dive'); } catch(e){ return null; } })();
  // Wordmark exit: SUBLIMATION (fine ice-grain pixel erode + whole-mark lift) is the DEFAULT — owner-picked over the old
  // fleck shatter after a live A/B (2026-07-01). ?exit=shatter restores the fleck scatter for comparison. Works on both
  // backends; on the 2D compositor sublimation replaces the per-cell drawImage scatter (thousands of calls/frame at
  // onset) with ~6 blits/frame — the descent's heaviest 2D moment becomes its cheapest.
  const qsExit = (() => { try { return new URLSearchParams(location.search).get('exit'); } catch(e){ return null; } })();
  const subExit = qsExit !== 'shatter';
  const isSafari = /^((?!chrome|crios|android).)*safari/i.test(navigator.userAgent);
  let use2D = qsDive === '2d' || (qsDive !== 'gl' && isSafari);
  let gl = null;
  if(!use2D){
    try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance', desynchronized: true }); } catch(e){}
    if(!gl) use2D = true;   // WebGL unavailable → the 2D compositor IS the fallback now (keeps the wordmark/scrim/dissolve; the old createSequence fallback lost all three)
  }
  let ctx2 = null;
  if(use2D){
    // alpha:false = opaque fast path (scene covers every pixel); desynchronized IS supported by WebKit for 2D contexts (Safari 15+,
    // unlike its WebGL counterpart) — the same low-latency present that fixed Chrome's WebGL, free where available, ignored elsewhere.
    try { ctx2 = canvas.getContext('2d', { alpha: false, desynchronized: true }); } catch(e){}
    if(!ctx2) return null;   // no 2D either (canvas already bound to a failed/mismatched context) → caller falls back to createSequence
  }
  canvas.style.opacity = '0';   // stay transparent until the FIRST frame actually paints (the CSS poster behind shows through) → no black flash on load/refresh

  const FS = buildFS(subExit);   // shatter (default) or sublimation (?exit=sub) fragment shader — chosen once at creation
  function sh(t, src){ const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[dive-lens]', gl.getShaderInfoLog(s)); return s; }
  function mkTex(){ const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; }
  let prog, quad, loc, tex, wmTex, uA, uBgBlur, uWmBlur, uWmDiss, uWmScaleU, uWmDriftU, uWmOpU, noiseTex = null, uNScaleU = null;
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
    uWmScaleU = gl.getUniformLocation(prog, 'uWmScale'); uWmDriftU = gl.getUniformLocation(prog, 'uWmDriftN'); uWmOpU = gl.getUniformLocation(prog, 'uWmOp');
    if(subExit){                                              // sublimation exit: upload the shared ice-grain field ONCE, parked on unit 2 (frame() only ever rebinds units 0/1)
      noiseTex = gl.createTexture(); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, noiseTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);   // 512 is POT so REPEAT is legal in WebGL1; LINEAR sampling softens the threshold band for free
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, iceNoise().canvas);
      gl.uniform1i(gl.getUniformLocation(prog, 'uNoise'), 2);
      uNScaleU = gl.getUniformLocation(prog, 'uNScale');
      gl.activeTexture(gl.TEXTURE0);
    } }
  if(gl) setupGL();

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
  function coverBlit(im){ const cw = earthC.width, ch = earthC.height, ir = im.naturalWidth / im.naturalHeight, cr = cw / ch; let w, h;
    if(ir > cr){ h = ch; w = ch * ir; } else { w = cw; h = cw / ir; } octx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h); }   // hoisted out of coverDraw — no per-frame closure alloc in the scrub hot path (same treatment canvas-seq's cover() already got)
  function coverDraw(){ if(!earthC.width) return false;
    const lo = Math.max(1, Math.min(count, Math.floor(curF))), hi = Math.min(count, lo + 1), frac = curF - lo;
    const a = frames[lo-1]; if(!isReady(a)){ load(lo, undefined, true); return false; }   // FRAME-EXACT: hold the last drawn frame until this one is ready (no substitute frame → no halt-snap). PRIORITIZED — this frame is blocking the visible render right now, it must never wait behind speculative lookahead
    octx.globalAlpha = 1; coverBlit(a);
    const b = frames[hi-1]; if(frac > 0 && isReady(b)){ octx.globalAlpha = frac; coverBlit(b); octx.globalAlpha = 1; }
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
  // Warm the HTTP byte-cache for the whole sequence at low priority (6 in flight, coordinated with the load()/MAX_INFLIGHT gate). This
  // does NOT hold decoded bitmaps — it just fills the browser cache so the windowed loader (setFrame's load()) creates + decodes each
  // frame instantly-from-cache during the glide, then evicts (bounded memory; the alternative — decoding+holding all 356 frames here —
  // was tried and reverted: it risked ~hundreds of decoded 1920×1080 bitmaps resident at once, and profiling proved the first-glide lag
  // was the WebGL compositor-sync, not decode starvation — coverDraw never once held on an unready frame in the live trace).
  function runPrefetchRest(){ if(prefetchStarted) return; prefetchStarted = true;
    let i = 1, inflight = 0;
    const pump = () => { while(inflight < 6 && i <= count){ const u = srcOf(i++); inflight++;
        fetch(u, { priority: 'low', signal: prefetchCtrl ? prefetchCtrl.signal : undefined }).then(r => r.arrayBuffer()).catch(() => {}).then(() => { inflight--; fetched++; if(fetched >= count) prefetchDone = true; pump(); }); } };
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
    // sublimation (?exit=sub): no per-fleck rise exists, so the WHOLE mark carries the evaporation motion — stronger lift,
    // subtler zoom. Shatter (default): the per-fleck scatter is the event, the body barely moves. Both feed the same uniforms.
    const scale = 1 + e * (subExit ? 0.03 : 0.05);                 // subtle push (the scatter/erode is the event)
    const op = 1 - sstep(0.82, 1.0, e);                            // hold solid through the exit, fade only the final remnant
    const drift = -e * wmc.height * (subExit ? 0.045 : 0.018);     // global lift (shatter adds per-fleck rise in the composite)

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
        if(use2D && subExit && !subPrebaked){ subPrebaked = true;   // sublimation masks: bake off the hot path, one per idle tick, while the viewer reads the resting hero (draw2DSublime also bakes on demand — this just makes that a no-op)
          const idle = window.requestIdleCallback ? ((f) => window.requestIdleCallback(f, { timeout: 800 })) : ((f) => setTimeout(f, 180));
          let k = 0; const step = () => { if(destroyed || k >= SUB_NM) return; try { subPattern(k++); } catch(e){} idle(step); };
          idle(step); }
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
    if(canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; if(gl) gl.viewport(0, 0, w, h); resized = true; }
    if(earthC.width !== w || earthC.height !== h){                                       // earthC = canvas res (FULL quality — must match the story frames so the dive→coast hand-off is seamless, no blurry→sharp snap)
      // 2D backend: carry the last frame ACROSS the realloc (stretched to the new size). The realloc clears earthC to opaque
      // black, and if the current dive frame isn't decode-ready at that instant (mid-scrub resize) coverDraw() holds — the GL
      // path re-presents its stale TEXTURE in that window (textures survive a canvas resize), but a bare 2D blit would flash
      // the cleared black source. Copying the old pixels through a scratch canvas mirrors the GL hold exactly.
      if(use2D && earthC.width > 2 && lastDrawnF > 0){
        const t = fit._keep || (fit._keep = document.createElement('canvas'));
        t.width = earthC.width; t.height = earthC.height; t.getContext('2d').drawImage(earthC, 0, 0);
        earthC.width = w; earthC.height = h; octx.drawImage(t, 0, 0, w, h);
        t.width = 1; t.height = 1;                                                       // release the scratch backing store immediately
      } else { earthC.width = w; earthC.height = h; }
      resized = true; }
    const wmDpr = Math.min(window.devicePixelRatio || 1, WM_FULL_DPR);   // wordmark canvas: FULL res at all times — crisp churn + crisp rest (see WM_FULL_DPR note)
    const ww = Math.max(2, Math.round(r.width * wmDpr)), wh = Math.max(2, Math.round(r.height * wmDpr));
    if(wmc.width !== ww || wmc.height !== wh){ wmc.width = ww; wmc.height = wh; resized = true; }
    return resized;
  }

  // ── 2D COMPOSITOR (Safari / no-WebGL) — a pixel-faithful port of the fragment shader above ────────────────────────
  // Everything upstream is shared with the WebGL path: the SAME frame loader fills the SAME earthC cover-compose, the SAME
  // wordmark decode bakes the SAME wmc bitmap, the SAME dirty/idle-skip gating decides when to draw. Only the final composite
  // differs, effect by effect:
  //   bg        → earthC is blitted 1:1 (it IS the texture the shader sampled); the focus-pull blur (prod ships bgBlurMax:0,
  //               so this leg is dormant) is a two-stage downsample crossfaded over the sharp frame.
  //   scrim     → the shader's radial smoothstep((0,0.40), centre (0.5,0.39), x-axis 1/0.62 wider) is sampled into the stops
  //               of a cached radial-gradient sprite; drawing black-at-alpha over the frame IS the shader's bg*(1-scrim).
  //   wordmark  → wmc and the canvas share the same DPR cap, so the intact wordmark is a 1:1 blit; the settled-exit
  //               scale/drift/op "uniforms" (wmScaleV/wmDriftV/wmOpV) only depart from neutral once the dissolve window
  //               opens, and the dissolve path below applies them in its sampling remap — same division of labour as the shader.
  //   dissolve  → the EXACT shader math on the EXACT screen-space cell grid (H/170 square cells): same per-cell hash for the
  //               erode threshold + stagger, same lateral jitter, same rise curve, same smoothstep erode, same additive icy
  //               spark; each surviving cell blits its remapped source region with alpha = keep·op. A cell-resolution ink mask
  //               (wmc downsampled to one px per cell, ~30k px readback) skips the ~2/3 of grid cells that hold no letter ink.
  const CELL_N = 170;                                       // shader cellN — square fleck cells of H/170 device px
  const fract = (x) => x - Math.floor(x);
  const cellHash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);   // the shader's hash(); JS sin precision differs from the GPU's — same statistics, equally stable frame-to-frame, never shown side by side
  let scrimC = null, scrimStale = true;                     // cached scrim sprite (rebaked on resize)
  let blurA = null, blurB = null;                           // small downsample ping-pong canvases (blur legs only)
  let wmFxC = null, wmFxCtx = null, cyanC = null, cyanCtx = null, cyanStale = true;   // dissolve source (wmc + spark [+ blur]) and the cyan silhouette, both sized to the padded ink region
  let maskData = null, maskW = 0, maskH = 0, maskStale = true, inkBox = null, srcR = null;
  // ── sublimation exit (?exit=sub) state — see draw2DSublime ──
  const SUB_NM = 12;                                        // erosion levels; adjacent-mask alpha-interp approximates the shader's continuous smoothstep sweep
  let subPats = null, subPrebaked = false, destroyed = false;
  function subPattern(k){
    // mask k = the shader's erode amount smoothstep(n-0.06, n+0.06, t_k) baked into a 512px-tiling alpha pattern; per frame
    // draw2DSublime destination-outs mask idx at full alpha + mask idx+1 at frac — 2 pattern fills replace the fleck loop.
    subPats = subPats || new Array(SUB_NM);
    if(subPats[k]) return subPats[k];
    const nf = iceNoise().data, N = NSIZE, t = k / (SUB_NM - 1);
    const c = document.createElement('canvas'); c.width = N; c.height = N;
    const cx = c.getContext('2d'), id = cx.createImageData(N, N), d = id.data;
    for(let i = 0; i < N * N; i++){ const a = Math.min(1, Math.max(0, (t - (nf[i] - 0.06)) / 0.12));
      d[i * 4 + 3] = (a * a * (3 - 2 * a) * 255) | 0; }     // rgb stays 0 — only alpha matters to destination-out
    cx.putImageData(id, 0, 0);
    return (subPats[k] = cx.createPattern(c, 'repeat'));
  }
  function bakeScrim(){
    scrimStale = false;
    const W = canvas.width, H = canvas.height, sw = Math.max(2, W >> 2), sh = Math.max(2, H >> 2);   // ¼-res sprite; bilinear upscale of a smooth gradient is lossless to the eye
    if(!scrimC) scrimC = document.createElement('canvas');
    if(scrimC.width !== sw || scrimC.height !== sh){ scrimC.width = sw; scrimC.height = sh; }
    const c = scrimC.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, sw, sh);
    // shader: sd = uv-(0.5,0.39); sd.x *= 0.62 → the len(sd)=0.40 contour is an ellipse with semi-axes (0.40/0.62)·W × 0.40·H
    c.translate(0.5 * sw, 0.39 * sh); c.scale((0.40 / 0.62) * sw, 0.40 * sh);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    for(let k = 0; k <= 8; k++){ const t = k / 8, s = t * t * (3 - 2 * t);           // sample the smoothstep falloff into gradient stops (radial gradients lerp between stops — 9 samples nails the curve)
      g.addColorStop(t, 'rgba(0,0,0,' + (0.40 * (1 - s)).toFixed(4) + ')'); }
    c.fillStyle = g; c.fillRect(-4, -4, 8, 8);              // unit-space rect large enough to cover the whole sprite; past t=1 the gradient clamps to alpha 0
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  function buildInkMask(){
    maskStale = false;
    const W = canvas.width, H = canvas.height;
    maskH = CELL_N; maskW = Math.max(1, Math.round(CELL_N * W / Math.max(1, H)));     // one mask texel per screen cell
    const mc = buildInkMask._c || (buildInkMask._c = document.createElement('canvas'));
    if(mc.width !== maskW || mc.height !== maskH){ mc.width = maskW; mc.height = maskH; }
    const mx = mc.getContext('2d', { willReadFrequently: true });
    mx.clearRect(0, 0, maskW, maskH); mx.drawImage(wmc, 0, 0, maskW, maskH);
    let d = null; try { d = mx.getImageData(0, 0, maskW, maskH).data; } catch(e){}
    maskData = d;
    let x0 = maskW, y0 = maskH, x1 = -1, y1 = -1;
    if(d){ for(let y = 0; y < maskH; y++){ const row = y * maskW;
      for(let x = 0; x < maskW; x++){ if(d[(row + x) * 4 + 3] > 4){ if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; } } } }
    inkBox = (d && x1 >= 0) ? { x0, y0, x1, y1 } : (d ? null : { x0: 0, y0: 0, x1: maskW - 1, y1: maskH - 1 });   // readback blocked → assume ink everywhere (correct, just less pruning); genuinely blank wmc → null (dissolve no-ops)
    // source region for the dissolve scratch canvases: the ink bbox + 2 cells of margin (device px, clamped to the canvas).
    // Cells only ever SAMPLE within the ink (the mask gate skips the rest), so the scratch never needs the full canvas —
    // at a typical wordmark footprint that's ~4× less scratch memory than two full-screen RGBA canvases.
    if(inkBox){ const cw = W / maskW, ch = H / maskH;
      const rx = Math.max(0, Math.floor((inkBox.x0 - 2) * cw)), ry = Math.max(0, Math.floor((inkBox.y0 - 2) * ch));
      srcR = { x: rx, y: ry,
        w: Math.min(W - rx, Math.ceil((inkBox.x1 - inkBox.x0 + 5) * cw)), h: Math.min(H - ry, Math.ceil((inkBox.y1 - inkBox.y0 + 5) * ch)) };
    } else srcR = null;
  }
  function buildWmFx(diss, wmBlur){
    // shared by BOTH exits: wmFxC = wmc's ink region + icy spark (the shader's wm.rgb += (.05,.13,.20)·wm.a·uWmDiss — additive
    // cyan inside the ink, 'lighter' over a silhouette pre-filled with that colour), then the exit soft-focus as a downsample
    // crossfade (blur4's tent). Returns false when there's no ink to dissolve.
    if(maskStale || !wmDecode.settled) buildInkMask();      // settled: rebuilt only when the bake actually changes; churn-overlap (scrolled mid-entrance): per frame — it's a cell-res readback, trivial
    if(!inkBox || !srcR) return false;
    if(!wmFxC){ wmFxC = document.createElement('canvas'); wmFxCtx = wmFxC.getContext('2d'); cyanC = document.createElement('canvas'); cyanCtx = cyanC.getContext('2d'); }
    if(wmFxC.width < srcR.w || wmFxC.height < srcR.h){ wmFxC.width = srcR.w; wmFxC.height = srcR.h; cyanC.width = srcR.w; cyanC.height = srcR.h; cyanStale = true; }
    if(cyanStale){ cyanStale = false;
      cyanCtx.clearRect(0, 0, srcR.w, srcR.h); cyanCtx.drawImage(wmc, srcR.x, srcR.y, srcR.w, srcR.h, 0, 0, srcR.w, srcR.h);
      cyanCtx.globalCompositeOperation = 'source-in'; cyanCtx.fillStyle = 'rgb(13,33,51)'; cyanCtx.fillRect(0, 0, srcR.w, srcR.h);
      cyanCtx.globalCompositeOperation = 'source-over'; }
    wmFxCtx.clearRect(0, 0, srcR.w, srcR.h);
    wmFxCtx.drawImage(wmc, srcR.x, srcR.y, srcR.w, srcR.h, 0, 0, srcR.w, srcR.h);
    wmFxCtx.globalCompositeOperation = 'lighter'; wmFxCtx.globalAlpha = diss;
    wmFxCtx.drawImage(cyanC, 0, 0, srcR.w, srcR.h, 0, 0, srcR.w, srcR.h);   // explicit region — the scratch canvases are growth-only sized, so the canvas itself can outlive a shrunken srcR
    wmFxCtx.globalCompositeOperation = 'source-over'; wmFxCtx.globalAlpha = 1;
    if(wmBlur > 0.0008){                                    // soft-focus: blur the ink region, crossfade it over the sharp source (approximates the shader's growing tent radius; identical at the window's peak)
      if(!blurA) blurA = document.createElement('canvas');
      const s = 4, bw = Math.max(2, Math.ceil(srcR.w / s)), bh = Math.max(2, Math.ceil(srcR.h / s));
      if(blurA.width < bw || blurA.height < bh){ blurA.width = bw; blurA.height = bh; }
      const ac = blurA.getContext('2d');
      ac.clearRect(0, 0, bw, bh); ac.drawImage(wmFxC, 0, 0, srcR.w, srcR.h, 0, 0, bw, bh);
      wmFxCtx.globalAlpha = Math.min(1, wmBlur / Math.max(1e-6, cfg.wmBlurMax));
      wmFxCtx.drawImage(blurA, 0, 0, bw, bh, 0, 0, srcR.w, srcR.h); wmFxCtx.globalAlpha = 1;
    }
    return true;
  }
  function draw2DSublime(diss, wmBlur){
    // SUBLIMATION exit — the whole per-cell scatter loop is replaced by: erode wmFxC with two tiled noise-mask pattern fills
    // (destination-out; mask idx full + mask idx+1 at frac ≈ the shader's continuous smoothstep sweep), then ONE transformed
    // blit applying the exit scale/lift/fade. ~6 draw calls total vs thousands of per-fleck drawImages in the shatter.
    if(!buildWmFx(diss, wmBlur)) return;
    const L = Math.min(1, diss) * (SUB_NM - 1), idx = Math.min(SUB_NM - 1, Math.floor(L)), frac = L - idx;
    wmFxCtx.globalCompositeOperation = 'destination-out';
    wmFxCtx.save(); wmFxCtx.translate(-srcR.x, -srcR.y);    // anchor the 512px noise tiling to SOURCE-space device px — the same wmUv-space sampling the sublimation shader uses, so the grain rides the mark identically on both backends
    wmFxCtx.fillStyle = subPattern(idx); wmFxCtx.fillRect(srcR.x, srcR.y, srcR.w, srcR.h);
    if(frac > 0.002 && idx + 1 < SUB_NM){ wmFxCtx.globalAlpha = frac;
      wmFxCtx.fillStyle = subPattern(idx + 1); wmFxCtx.fillRect(srcR.x, srcR.y, srcR.w, srcR.h); wmFxCtx.globalAlpha = 1; }
    wmFxCtx.restore(); wmFxCtx.globalCompositeOperation = 'source-over';
    // exit transform — the shader's wmUv = a + (v - a - (0,dN))/sc inverted to dest space: v = a + (0,dN) + (s - a)·sc
    const W = canvas.width, H = canvas.height, sc = wmScaleV, dN = wmDriftV, op = wmOpV, ax = 0.5, ay = 0.36;
    ctx2.globalAlpha = op;
    ctx2.drawImage(wmFxC, 0, 0, srcR.w, srcR.h,
      ax * W + (srcR.x - ax * W) * sc, ay * H + dN * H + (srcR.y - ay * H) * sc, srcR.w * sc, srcR.h * sc);
    ctx2.globalAlpha = 1;
  }
  function draw2DDissolve(diss, wmBlur){
    if(!buildWmFx(diss, wmBlur)) return;
    const W = canvas.width, H = canvas.height;
    const sc = wmScaleV, dN = wmDriftV, op = wmOpV;
    const cellsX = maskW, cellsY = maskH, cw = W / cellsX, ch = H / cellsY;
    // THE SCATTER — iterate only the cells that could show ink this frame: the ink bbox widened by the CURRENT jitter reach
    // (±0.030·diss of W) and raised by the CURRENT rise reach (up to 0.175·diss of H — cells ABOVE the letters sample DOWN
    // into them as the flecks fly up). Every constant below is the shader's, verbatim.
    const ax = 0.5, ay = 0.36;                              // wmAnchor
    // vertical pad covers the FULL downward sample reach, not just the raw rise: the remap below also shifts sampling down by
    // the global drift (-dN) and the scale pull toward the anchor (ay·(1-1/sc) upper-bounds it for any cell above the ink) —
    // without those terms the topmost (highest-n, longest-surviving) flecks of the spindrift crest were culled vs the shader
    const padX = Math.ceil((0.030 * diss * W) / cw) + 1;
    const padUp = Math.ceil(((0.175 * diss + Math.abs(dN) + ay * (1 - 1 / sc)) * H) / ch) + 1;
    const bx0 = Math.max(0, inkBox.x0 - padX), bx1 = Math.min(cellsX - 1, inkBox.x1 + padX);
    const by0 = Math.max(0, inkBox.y0 - padUp), by1 = Math.min(cellsY - 1, inkBox.y1 + 1);
    for(let cy = by0; cy <= by1; cy++){
      const uy = cy / cellsY;
      // snap tile edges to SHARED integer device pixels: at fractional edges canvas AA composes two abutting tiles to less
      // than full alpha (up to a ~25% dip at a half-pixel seam), which read as a hairline grid across the still-solid letters
      // in the first dissolve frames. Shared snapped edges reconstruct gapless coverage exactly; the source rect scales and
      // shifts by the same deltas so the mapping stays the shader's.
      const dy0 = Math.round(uy * H), dy1 = Math.round(((cy + 1) / cellsY) * H), dh = dy1 - dy0;
      for(let cx = bx0; cx <= bx1; cx++){
        const n = cellHash(cx, cy);
        const keep = (1 - sstep(n - 0.06, n + 0.06, diss)) * op;                     // erode past the per-cell threshold; op = the shader's uWmOp master fade
        if(keep <= 0.004) continue;
        const n2 = cellHash(cx + 17.3, cy + 17.3);
        const ux = cx / cellsX;
        const wu = ax + (ux - ax) / sc + (n2 - 0.5) * 0.030 * diss;                  // shader wmUv remap (scale about the anchor; x carries no drift) + lateral jitter
        const wv = ay + (uy - ay - dN) / sc + diss * (0.045 + 0.13 * n);             // + drift + the per-fleck rise (sampling lower in the bitmap = the fleck flying up)
        const mxi = Math.floor(wu * cellsX + 0.5), myi = Math.floor(wv * cellsY + 0.5);   // mask texel under the SAMPLED region's centre (origin + half a cell)
        if(mxi < 0 || myi < 0 || mxi >= cellsX || myi >= cellsY) continue;
        if(maskData && maskData[(myi * cellsX + mxi) * 4 + 3] < 5) continue;         // no letter ink where this cell samples → skip the draw entirely
        const dx0 = Math.round(ux * W), dx1 = Math.round(((cx + 1) / cellsX) * W), dw = dx1 - dx0;
        ctx2.globalAlpha = keep;
        ctx2.drawImage(wmFxC, wu * W - srcR.x + (dx0 - ux * W) / sc, wv * H - srcR.y + (dy0 - uy * H) / sc, dw / sc, dh / sc, dx0, dy0, dw, dh);
      }
    }
    ctx2.globalAlpha = 1;
  }
  function draw2D(bgBlur, wmBlur, wmDiss){
    const W = canvas.width, H = canvas.height;
    ctx2.globalAlpha = 1;
    ctx2.drawImage(earthC, 0, 0);                           // bg: earthC IS the texture the shader sampled — 1:1 blit
    if(bgBlur > 0.0008){                                    // focus-pull rack (dormant in prod: cinematic.js ships bgBlurMax:0; kept live for the cfg knob)
      if(!blurA) blurA = document.createElement('canvas'); if(!blurB) blurB = document.createElement('canvas');
      const aw = Math.max(2, W >> 2), ah = Math.max(2, H >> 2), bw = Math.max(2, W >> 3), bh = Math.max(2, H >> 3);
      if(blurA.width < aw || blurA.height < ah){ blurA.width = aw; blurA.height = ah; }
      if(blurB.width !== bw || blurB.height !== bh){ blurB.width = bw; blurB.height = bh; }
      const ac = blurA.getContext('2d'), bc = blurB.getContext('2d');
      ac.drawImage(earthC, 0, 0, aw, ah); bc.drawImage(blurA, 0, 0, aw, ah, 0, 0, bw, bh);   // two-stage downsample ≈ gaussian; crossfaded below ≈ the shader's shrinking tent radius
      ctx2.globalAlpha = Math.min(1, bgBlur / Math.max(1e-6, cfg.bgBlurMax));
      ctx2.drawImage(blurB, 0, 0, bw, bh, 0, 0, W, H); ctx2.globalAlpha = 1;
    }
    if(wmDiss < 0.999){                                     // scrim (fades with the dissolve exactly like the shader's ·(1-uWmDiss); fully gone → skip the draw)
      if(scrimStale) bakeScrim();
      ctx2.globalAlpha = 1 - wmDiss; ctx2.drawImage(scrimC, 0, 0, W, H); ctx2.globalAlpha = 1;
    }
    if(wmOpV <= 0.002) return;                              // wordmark fully faded (shader's op<=0.002 clear) — bg+scrim only
    if(wmDiss <= 0.001){                                    // intact wordmark: same DPR cap as the canvas → 1:1 blit. Neutral pose by construction:
      ctx2.globalAlpha = wmOpV;                             // the exit's scale/drift only depart from (1,0) once the dissolve window opens (e>0 ⇔ wmDiss>0),
      ctx2.drawImage(wmc, 0, 0);                            // and the churn phase bakes its own scale/drift/op into wmc's pixels with uniforms pinned neutral.
      ctx2.globalAlpha = 1;
      return;
    }
    if(subExit) draw2DSublime(wmDiss, wmBlur); else draw2DDissolve(wmDiss, wmBlur);
  }

  let painted = false, heroLast = -1, lastBgBlur = -1, lastWmBlur = -1, lastWmDiss = -1;
  let texAlloc = false, wmTexAlloc = false;   // false → next upload must (re)allocate the GPU texture store via texImage2D; true → update in place via texSubImage2D (avoids re-allocating the whole store every frame — best-practice, though the real first-glide fix was the desynchronized context flag)
  function frame(){
    const resized = fit();
    if(resized){ bakedSettled = false; texAlloc = false; wmTexAlloc = false; scrimStale = true; maskStale = true; cyanStale = true; }   // a wmc/earth realloc cleared the wordmark canvas → force one re-bake+upload; the GPU textures also need a fresh texImage2D at the new size before texSubImage2D can update them (also re-bakes it crisp after the settle resize); the 2D compositor's cached sprites/masks re-derive from the new sizes the same way
    let dirty = resized;
    if(curF !== lastDrawnF || resized){ if(coverDraw()){ lastDrawnF = curF; earthDirty = true; dirty = true; } }   // earthC only changes when the frame/blend moves or on resize
    if(!painted && lastDrawnF < 0 && !earthDirty){ if(running) raf = requestAnimationFrame(frame); return; }   // nothing has ever drawn (first frame not ready) — hold the canvas transparent so the CSS poster shows (no black flash); skip the GL draw
    const e = sstep(cfg.wmExitStart, cfg.wmExitEnd, progress);                  // wordmark exit progress (0 held → 1 fully scattered)
    const wmChanged = drawWordmark(e); if(wmChanged) dirty = true;
    if(use2D && wmTexNeedsUpload){ maskStale = true; cyanStale = true; }        // "texture upload needed" = wmc's CONTENT changed — the 2D path's ink mask + cyan silhouette derive from those pixels
    // FOCUS-PULL + DISINTEGRATION amounts (ride scroll, not a centred membrane): bg racks soft→sharp before the seam; the wordmark soft-blurs
    // and SHATTERS into rising icy flecks as it exits (uWmDiss drives the per-cell erode/rise/spark in the shader)
    const bgBlur = cfg.bgBlurMax * (1 - sstep(0.10, cfg.bgSharpEnd, progress));
    const wmBlur = cfg.wmBlurMax * sstep(cfg.wmExitStart + 0.06, cfg.wmExitEnd, progress);
    const wmDiss = e;
    if(bgBlur !== lastBgBlur || wmBlur !== lastWmBlur || wmDiss !== lastWmDiss) dirty = true;
    if(dirty || !painted){                                                       // idle-skip: at rest (no scroll, decode settled) nothing changes → no GPU draw (was: redraw every rAF for the now-removed wobble)
      if(use2D){ earthDirty = false; draw2D(bgBlur, wmBlur, wmDiss); }           // 2D compositor: earthC/wmc are read directly — no upload step to gate, the dirty flags already decided this frame draws
      else {
      try { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        if(earthDirty){ earthDirty = false;
          if(texAlloc){ gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, earthC); }   // FAST PATH — update pixels in the existing GPU allocation instead of reallocating the whole texture store every frame (best practice)
          else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, earthC); texAlloc = true; } } } catch(e){ texAlloc = false; }   // (re)allocate once at this size, then sub-update; on any GL error, force a fresh allocation next frame
      try { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, wmTex);
        if(wmTexNeedsUpload){                                                             // gated on the content-only flag: the wordmark-exit window's continuous scale/drift/op change no longer forces any re-upload (those ride shader uniforms)
          if(wmTexAlloc){ gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, wmc); }
          else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, wmc); wmTexAlloc = true; } } } catch(e){ wmTexAlloc = false; }
      if(resized || !painted){ gl.uniform1f(uA, canvas.width / Math.max(1, canvas.height));   // only changes on resize — was rewritten every dirty frame (i.e. every frame of the wordmark-exit window) for an unchanging value
        if(uNScaleU) gl.uniform1f(uNScaleU, canvas.height / NSIZE); }                         // sublimation: device px → noise texels (the 2D masks tile at the same 1 texel = 1 device px)
      gl.uniform1f(uBgBlur, bgBlur); gl.uniform1f(uWmBlur, wmBlur); gl.uniform1f(uWmDiss, wmDiss);
      gl.uniform1f(uWmScaleU, wmScaleV); gl.uniform1f(uWmDriftU, wmDriftV); gl.uniform1f(uWmOpU, wmOpV);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
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
  // (WebGL backend only — a 2D canvas has no context-loss lifecycle to recover from; its listeners would just be dead weight)
  // NAMED so destroy() can remove them — the canvas is markup-owned and outlives this instance across teardown/rebuild
  // (matchMedia flips, bfcache restores); anonymous listeners kept every dead instance reachable (~2 full-res canvases each),
  // and a later real context-restore would have run EVERY accumulated handler: each dead instance re-creating orphan GL
  // programs and restarting its frame() loop against the live one on the same canvas.
  const onCtxLost = (e) => { e.preventDefault(); painted = false; lastDrawnF = -1; earthDirty = false; canvas.style.opacity = '0'; stop(); };
  if(gl) canvas.addEventListener('webglcontextlost', onCtxLost, false);
  // RESTORE (owner: "sometimes the video just disappears and background is black") — preventDefault() above IS what tells the browser to
  // actually attempt restoration (GPU resets/driver hiccups/too many contexts piling up across refreshes are the common real-world
  // triggers), but nothing was ever resuming afterward: the old program/buffers/textures were destroyed with the lost context and the
  // render loop had been stop()'d, so even a successful browser-side restore left the page permanently black until a manual reload.
  // earthC (the 2D source canvas) and wmc (the wordmark canvas) are untouched by a WebGL context loss — only the GL-side resources need
  // recreating — so this just rebuilds the program/buffers/textures, forces one full re-upload of the already-decoded content, and
  // resumes the loop. No re-fetch, no re-decode, no visible re-scramble.
  const onCtxRestored = () => {
    setupGL(); earthDirty = true; wmTexStale = true; texAlloc = false; wmTexAlloc = false; needsFit = true; start(); };   // setupGL() makes brand-new (unallocated) textures → the alloc flags must reset so the next upload re-allocs via texImage2D before any texSubImage2D. wmTexStale (not bakedSettled=false): wmc's pixels survive a WebGL-only context loss, so this only needs a re-upload, not a re-bake
  if(gl) canvas.addEventListener('webglcontextrestored', onCtxRestored, false);
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
    destroy(){ stop(); destroyed = true; try { ro && ro.disconnect(); } catch(e){} window.removeEventListener('resize', onResize); try { prefetchCtrl && prefetchCtrl.abort(); } catch(e){}
      if(gl){ canvas.removeEventListener('webglcontextlost', onCtxLost, false); canvas.removeEventListener('webglcontextrestored', onCtxRestored, false); }
      pendingQueue.length = 0;                                                        // drop queued (not-yet-started) frame loads — they'd otherwise keep fetching+decoding into this dead instance as inflight slots free up
      for(let i = 0; i < frames.length; i++){ drop(frames[i]); } frames.length = 0;
      scrimC = blurA = blurB = wmFxC = wmFxCtx = cyanC = cyanCtx = maskData = subPats = null;   // release the 2D compositor's scratch surfaces (no-ops on the WebGL path)
      try { if(gl){ gl.deleteTexture(tex); gl.deleteTexture(wmTex); if(noiseTex) gl.deleteTexture(noiseTex); gl.deleteBuffer(quad); gl.deleteProgram(prog); gl.clear(gl.COLOR_BUFFER_BIT); } } catch(e){} }
  };
}
