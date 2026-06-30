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
  'vec4 blur4(vec2 uv, float r){',
  '  if(r < 0.0008) return texture2D(uWM, uv);',
  '  vec2 o = vec2(r, r*uAspect);',
  '  vec4 s = texture2D(uWM, uv) * 0.25;',
  '  s += (texture2D(uWM,uv+vec2(o.x,0.0)) + texture2D(uWM,uv-vec2(o.x,0.0)) + texture2D(uWM,uv+vec2(0.0,o.y)) + texture2D(uWM,uv-vec2(0.0,o.y))) * 0.125;',
  '  s += (texture2D(uWM,uv+o) + texture2D(uWM,uv-o) + texture2D(uWM,uv+vec2(o.x,-o.y)) + texture2D(uWM,uv+vec2(-o.x,o.y))) * 0.0625;',
  '  return s;',
  '}',
  'void main(){',
  '  vec3 bg = blur3(vUv, uBgBlur);',
  '  vec2 sd = vUv - vec2(0.5, 0.39); sd.x *= 0.62;',                            // localized scrim behind the wordmark — gentle darkening for legibility (replaces the bg blur; the rest of the frame stays 100% sharp)
  '  float scrim = (1.0 - smoothstep(0.0, 0.40, length(sd))) * (1.0 - uWmDiss) * 0.40;',   // fades out as the wordmark disintegrates so the scene reads clean once the title is gone
  '  bg *= (1.0 - scrim);',
  '  vec4 wm;',
  '  if(uWmDiss > 0.001){',
  '    vec2 cellN = vec2(uAspect, 1.0) * 170.0;',          // square fleck cells (~7px); aspect keeps them square in screen space
  '    vec2 cell  = floor(vUv * cellN);',
  '    float n  = hash(cell);',                            // per-cell vanish threshold (low n leaves first → staggered scatter)
  '    float n2 = hash(cell + 17.3);',                     // per-cell horizontal jitter
  '    vec2 duv = vUv + vec2((n2 - 0.5) * 0.030 * uWmDiss, uWmDiss * (0.045 + 0.13 * n));',   // each fleck rises HARDER + scatters laterally as it flies off into the spindrift
  '    wm = blur4(duv, uWmBlur);',
  '    float keep = 1.0 - smoothstep(n - 0.06, n + 0.06, uWmDiss);',   // erode the cell once the dissolve front passes its threshold
  '    wm.a *= keep;',
  '    wm.rgb += vec3(0.05, 0.13, 0.20) * wm.a * uWmDiss;',            // icy spark — surviving flecks brighten toward signal-cyan as they fly off
  '  } else {',
  '    wm = blur4(vUv, uWmBlur);',
  '  }',
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
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog); gl.useProgram(prog);
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  function mkTex(){ const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; }
  const tex = mkTex(), wmTex = mkTex();
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0); gl.uniform1i(gl.getUniformLocation(prog, 'uWM'), 1);
  const uA = gl.getUniformLocation(prog, 'uAspect'), uBgBlur = gl.getUniformLocation(prog, 'uBgBlur'), uWmBlur = gl.getUniformLocation(prog, 'uWmBlur'), uWmDiss = gl.getUniformLocation(prog, 'uWmDiss');

  // ── self-contained frame loader (windowed decode + eviction; mirrors canvas-seq but draws cover-fit to our earthC) ──
  const earthC = document.createElement('canvas'); const octx = earthC.getContext('2d', { alpha: false });
  const frames = new Array(count);
  const tries = new Uint8Array(count);   // bounded per-frame retry counter — recover a transient WebP fetch failure instead of staying blank forever
  const srcOf = (i) => dir + 'frame-' + ('000' + i).slice(-4) + '.webp';
  let curF = 1, lastCenter = -1;
  const isReady = (im) => !!(im && im.complete && im.naturalWidth > 0);
  function load(i){ if(i < 1 || i > count || frames[i-1]) return;
    const im = new Image(); im.decoding = 'async';
    im.onerror = () => { if(frames[i-1] !== im) return; frames[i-1] = undefined;        // free the slot (was: a failed/aborted request stayed in the array forever → permanent black / frozen frame)
      if(tries[i-1] < 4){ tries[i-1]++; setTimeout(() => { if(!frames[i-1]) load(i); }, 300 * tries[i-1]); } };   // capped backoff retry so a transient miss self-heals
    im.src = srcOf(i); frames[i-1] = im; if(im.decode) im.decode().catch(() => {}); }
  function drop(im){ if(im){ im.onerror = null; im.src = ''; } }   // null onerror BEFORE blanking src so the abort doesn't trip the retry
  function setFrame(p){ const f = 1 + Math.max(0, Math.min(1, p)) * (count - 1); curF = f; const c = Math.round(f);
    if(c !== lastCenter){ lastCenter = c; for(let i = c - 8; i <= c + 48; i++) load(i);   // wide FORWARD-biased window: 48 frames ≈ 310ms lead at peak velocity — enough headroom for a cache-miss network round-trip
      for(let i = 1; i <= count; i++){ const im = frames[i-1]; if(im && Math.abs(i - c) > 60){ drop(im); frames[i-1] = undefined; } } } }
  function coverDraw(){ const cw = earthC.width, ch = earthC.height; if(!cw) return false;
    const lo = Math.max(1, Math.min(count, Math.floor(curF))), hi = Math.min(count, lo + 1), frac = curF - lo;
    const a = frames[lo-1]; if(!isReady(a)){ load(lo); return false; }                    // FRAME-EXACT: hold the last drawn frame until this one is ready (no substitute frame → no halt-snap)
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
  for(let k = 1; k <= Math.min(WARM_PRELOAD, count); k++) load(k);
  // REST OF THE SEQUENCE — held back until the entry wordmark decode SETTLES (frame() trips runPrefetchRest), so the ~2.7s decode runs
  // with zero network/decode contention. An early scroll is still warm-gated (cinematic.js) so the dive only scrubs once cached; the
  // bulk streams in during the seconds the viewer reads the resting hero. Owner-directed: prefer a longer load over any entry lag.
  let prefetchStarted = false;
  function runPrefetchRest(){ if(prefetchStarted) return; prefetchStarted = true;
    let i = 1, inflight = 0;
    const pump = () => { while(inflight < 12 && i <= count){ const u = srcOf(i++); inflight++;
        fetch(u, { signal: prefetchCtrl ? prefetchCtrl.signal : undefined }).then(r => r.arrayBuffer()).catch(() => {}).then(() => { inflight--; fetched++; if(fetched >= count) prefetchDone = true; pump(); }); } };
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
  let needsFit = true, lastDrawnF = -1, earthDirty = false, lastWmOp = -1, lastWmScale = -1, lastWmDrift = -1, ro = null;   // earthDirty starts FALSE so the first frame() doesn't upload an empty earthC (black) over the poster — it's set true only once coverDraw actually draws
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
    // once the decode is fully settled the wordmark only changes when the exit state moves (scroll) — skip clear+draw (+upload) at rest
    if(wmDecode.settled && op === lastWmOp && scale === lastWmScale && drift === lastWmDrift) return false;
    lastWmOp = op; lastWmScale = scale; lastWmDrift = drift;
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

  let painted = false, heroLast = -1, lastBgBlur = -1, lastWmBlur = -1, lastWmDiss = -1;
  function frame(){
    const resized = fit();
    if(resized){ lastWmOp = -1; lastWmScale = -1; lastWmDrift = -1; }            // a wmc/earth realloc cleared the wordmark canvas → force one redraw+upload (also re-bakes it crisp after the settle resize)
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
    if(dirty || !painted){                                                       // idle-skip: at rest (no scroll, decode settled) nothing changes → no GPU draw (was: redraw every rAF for the now-removed wobble)
      try { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        if(earthDirty){ earthDirty = false; gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, earthC); } } catch(e){}
      try { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, wmTex);
        if(wmChanged){ gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, wmc); } } catch(e){}
      gl.uniform1f(uA, canvas.width / Math.max(1, canvas.height));
      gl.uniform1f(uBgBlur, bgBlur); gl.uniform1f(uWmBlur, wmBlur); gl.uniform1f(uWmDiss, wmDiss);
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
  setFrame(0); start();

  return {
    setProgress(p){ progress = Math.max(0, Math.min(1, p)); setFrame(progress); if(!running) start(); },
    scrambleIn(){ wmDecode.scrambleIn(performance.now());
      setTimeout(runPrefetchRest, 3200);   // decode is ~2.7s; fallback if the settle-trip is missed (e.g. reduced motion never bakes) — fill the rest of the cache anyway
      lastWmOp = -1; lastWmScale = -1; },
    setSub(s){ wmDecode.setSub(s); lastWmOp = -1; lastWmScale = -1; },   // relocalise slogan; force drawWordmark to redraw+re-upload next frame
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
