// DIVE-LENS — the landing push-through. A WebGL gravitational-lens + membrane-wobble pass over the scroll-scrubbed
// dive frame sequence (assets/dive-frames), with the crystalline-ice ARTIX wordmark composited INTO the lensed scene:
// it scrambles in on entry, holds frozen above the centre line, then on scroll tears through the membrane (warp +
// colour-split on its edges) and zooms through the camera until it exits the frame. Drop-in for the descent stage —
// createDiveLens({canvas, dir, count, settings}) mirrors canvas-seq's { setProgress, redraw, destroy, count } plus
// scrambleIn()/pause()/resume(). Self-contained frame loader (windowed decode + cover-fit) so it never dispatches a
// resize or fights the ScrollTrigger pin. Returns null if WebGL is unavailable (caller then uses createSequence).

import { createWordmarkDecode } from '/js/artix-wordmark-decode.js';   // Treatment-B hero decode (claude-design handoff)

const VS = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv=vec2(p.x*0.5+0.5,1.0-(p.y*0.5+0.5)); gl_Position=vec4(p,0.0,1.0); }';
const FS = [
  'precision highp float;',
  'uniform sampler2D uTex; uniform sampler2D uWM; uniform float uS; uniform float uAspect;',
  'uniform float uW; uniform float uWobScale; uniform float uWobSpeed; uniform float uTime;',
  'varying vec2 vUv;',
  'void main(){',
  '  vec2 c = vUv - 0.5;',
  '  vec2 ca = vec2(c.x*uAspect, c.y);',
  '  float r = length(ca);',
  '  float s = uS;',
  '  float warp = s * 0.62 / (1.0 + 7.0*r*r);',
  '  float zoom = 1.0 + 0.40 * s;',
  '  float rr = r * (1.0 - warp) / zoom;',
  '  vec2 dir = r > 0.0002 ? ca / r : vec2(0.0);',
  '  vec2 sca = dir * rr;',
  '  vec2 suv = vec2(sca.x/uAspect, sca.y) + 0.5;',
  '  float wb = uW * 0.05;',
  '  vec2 wob = vec2(',
  '    sin(suv.y*uWobScale + uTime*uWobSpeed) + 0.6*sin(suv.x*uWobScale*0.6 - uTime*uWobSpeed*0.8),',
  '    cos(suv.x*uWobScale + uTime*uWobSpeed*1.1) + 0.6*sin(suv.y*uWobScale*0.7 + uTime*uWobSpeed*0.9)',
  '  );',
  '  suv += wob * wb;',
  '  float cab = 0.022 * s;',
  '  vec2 off = dir * cab; off.x /= uAspect;',
  '  float R = texture2D(uTex, suv + off).r;',
  '  float G = texture2D(uTex, suv).g;',
  '  float B = texture2D(uTex, suv - off).b;',
  '  vec3 earth = vec3(R,G,B);',
  '  vec2 wmoff = dir * (0.032 * s); wmoff.x /= uAspect;',
  '  vec4 wR = texture2D(uWM, suv + wmoff);',
  '  vec4 wG = texture2D(uWM, suv);',
  '  vec4 wB = texture2D(uWM, suv - wmoff);',
  '  vec3 wmCol = vec3(wR.r, wG.g, wB.b);',
  '  float wmA = max(max(wR.a, wG.a), wB.a);',
  '  vec3 col = mix(earth, wmCol, clamp(wmA,0.0,1.0));',
  '  gl_FragColor = vec4(col, 1.0);',
  '}'
].join('\n');

export function createDiveLens({ canvas, dir, count, settings }){
  const cfg = Object.assign({ ampMul: 0.59, ctr: 0.175, wid: 0.064, wobMul: 0.94, wobScale: 7, wobSpeed: 0.3 }, settings || {});
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
  const uS = gl.getUniformLocation(prog, 'uS'), uA = gl.getUniformLocation(prog, 'uAspect');
  const uW = gl.getUniformLocation(prog, 'uW'), uWS = gl.getUniformLocation(prog, 'uWobScale'), uWSp = gl.getUniformLocation(prog, 'uWobSpeed'), uT = gl.getUniformLocation(prog, 'uTime');

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
  function prefetchAll(){
    // Pre-load the opening frames as actual Image objects right now (direct decode, not just HTTP cache).
    // The warm gate waits for these to be isReady() so the first scroll never fires onto undecoded frames.
    for(let k = 1; k <= Math.min(WARM_PRELOAD, count); k++) load(k);
    let i = 1, inflight = 0;
    const pump = () => { while(inflight < 12 && i <= count){ const u = srcOf(i++); inflight++;   // 12 in-flight, no priority:low (page is past first-paint, no contention) — fills the cache ~2× faster
        fetch(u, { signal: prefetchCtrl ? prefetchCtrl.signal : undefined }).then(r => r.arrayBuffer()).catch(() => {}).then(() => { inflight--; fetched++; if(fetched >= count) prefetchDone = true; pump(); }); } };
    pump(); }
  // Start the whole-sequence prefetch the moment the loader releases (artix:booted) or on window load — both are PAST first paint +
  // the critical opener frames, so the warm-storm never competes with them (a prefetch at module init was a verified "frames don't
  // load on refresh" cause). cinematic.js gates the first descent glide on `warm` so the dive only scrubs once these are cached.
  let prefetchStarted = false;
  const schedulePrefetch = () => { if(prefetchStarted) return; prefetchStarted = true; prefetchAll(); };
  if(document.readyState === 'complete') schedulePrefetch();
  else { window.addEventListener('load', schedulePrefetch, { once: true }); document.addEventListener('artix:booted', schedulePrefetch, { once: true }); }

  // ── ice ARTIX wordmark (its own canvas; warped/composited by the shader) ──
  // Treatment-B instrument decode (claude-design handoff) draws the wordmark+slogan; this file keeps the placing, the resting
  // glow (re-added in the decode module), the scroll-driven zoom-through, and the WebGL lens/chromatic-tear composite unchanged.
  const wmc = document.createElement('canvas'); const wmctx = wmc.getContext('2d');
  if(document.fonts){ document.fonts.load('400 100px Michroma').catch(() => {}); document.fonts.load('500 100px "Martian Mono"').catch(() => {}); }
  const wmDecode = createWordmarkDecode({ subGap: 0.8, titleStagger: 220, sub: document.documentElement.lang === 'is' ? 'ÚTVEGAÐ. AFHENT. STUTT.' : 'SOURCED. DELIVERED. SUPPORTED.' });   // 220ms per letter = strict sequential (A→R→T→I→X)
  let progress = 0, t0 = performance.now(), raf = 0, running = false;
  // per-frame change tracking — skip the expensive work (layout reflow, cover redraw, GPU uploads, wordmark glyph loop) when nothing changed
  let needsFit = true, lastDrawnF = -1, earthDirty = false, lastWmOp = -1, lastWmScale = -1, ro = null;   // earthDirty starts FALSE so the first frame() doesn't upload an empty earthC (black) over the poster — it's set true only once coverDraw actually draws
  const onResize = () => { needsFit = true; };
  try { ro = new ResizeObserver(() => { needsFit = true; }); ro.observe(canvas); } catch(e){}
  window.addEventListener('resize', onResize, { passive: true });

  function bump(p){ const d = Math.abs(p - cfg.ctr) / cfg.wid; const s = Math.max(0, 1 - d); return s * s * (3 - 2 * s); }
  function strength(){ return Math.min(1, bump(progress) * cfg.ampMul); }
  function drawWordmark(){
    const z = Math.min(1, Math.max(0, (progress - 0.06) / 0.22));   // wider window + earlier start: longer "hold" before zoom
    const scale = 1 + Math.pow(z, 4) * 42;                          // z^4 ease-in: barely creeps → then rushes through the lens
    const op = 1 - Math.min(1, Math.max(0, (z - 0.97) / 0.03));     // KEEP: geometric exit fade in the final sliver
    // once the decode is fully settled the wordmark only changes when op/scale change (scroll) — skip clear+draw (+upload) at rest
    if(wmDecode.settled && op === lastWmOp && scale === lastWmScale) return false;
    lastWmOp = op; lastWmScale = scale;
    wmctx.clearRect(0, 0, wmc.width, wmc.height);
    if(op <= 0.002) return true;                                    // faded out post-zoom — cleared (no ghost), nothing to draw
    const fs = Math.round(wmc.height * 0.11);                       // KEEP: wordmark size
    wmctx.save();
    wmctx.translate(wmc.width * 0.5, wmc.height * 0.36);            // KEEP: wordmark placing (origin)
    wmctx.scale(scale, scale);
    wmDecode.draw(wmctx, 0, 0, fs, performance.now(), op, scale);   // Treatment-B decode; op = master alpha (zoom-out fade), scale gates the locked-bitmap cache
    wmctx.restore();
    return true;
  }

  function fit(){
    if(!needsFit) return false; needsFit = false;                  // only re-measure on a real resize (ResizeObserver) — no getBoundingClientRect reflow every frame
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    let resized = false;
    if(canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); resized = true; }
    if(earthC.width !== w || earthC.height !== h){ earthC.width = w; earthC.height = h; resized = true; }   // earthC = canvas res (FULL quality — must match the story frames so the dive→coast hand-off is seamless, no blurry→sharp snap)
    if(wmc.width !== w || wmc.height !== h){ wmc.width = w; wmc.height = h; resized = true; }
    return resized;
  }

  let painted = false;
  function frame(){
    const resized = fit();
    if(curF !== lastDrawnF || resized){ if(coverDraw()){ lastDrawnF = curF; earthDirty = true; } }   // earthC only changes when the frame/blend moves or on resize
    if(!painted && lastDrawnF < 0 && !earthDirty){ if(running) raf = requestAnimationFrame(frame); return; }   // nothing has ever drawn (first frame not ready) — hold the canvas transparent so the CSS poster shows (no black flash); skip the GL draw
    const wmChanged = drawWordmark();
    try { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      if(earthDirty){ earthDirty = false; gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, earthC); } } catch(e){}
    try { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, wmTex);
      if(wmChanged){ gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, wmc); } } catch(e){}
    gl.uniform1f(uS, strength());
    gl.uniform1f(uA, canvas.width / Math.max(1, canvas.height));
    gl.uniform1f(uW, Math.min(1, bump(progress) * cfg.wobMul));
    gl.uniform1f(uWS, cfg.wobScale); gl.uniform1f(uWSp, cfg.wobSpeed);
    gl.uniform1f(uT, (performance.now() - t0) / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if(!painted){ painted = true; canvas.style.opacity = '1'; }                           // first real paint — fade the canvas in over the poster (CSS transition)
    if(running) raf = requestAnimationFrame(frame);
  }
  function start(){ if(running) return; running = true; raf = requestAnimationFrame(frame); }
  function stop(){ running = false; cancelAnimationFrame(raf); }
  // GPU dropped the WebGL context: fall back to the poster (canvas transparent) instead of a permanent black canvas, and stop the loop
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); painted = false; lastDrawnF = -1; earthDirty = false; canvas.style.opacity = '0'; stop(); }, false);
  setFrame(0); start();

  return {
    setProgress(p){ progress = Math.max(0, Math.min(1, p)); setFrame(progress); if(!running) start(); },
    scrambleIn(){ wmDecode.scrambleIn(performance.now()); },
    setSub(s){ wmDecode.setSub(s); lastWmOp = -1; lastWmScale = -1; },   // relocalise slogan; force drawWordmark to redraw+re-upload next frame
    redraw(){},
    pause: stop,
    resume: start,
    get count(){ return count; },
    get warm(){ for(let k = 0; k < Math.min(WARM_PRELOAD, count); k++){ if(!isReady(frames[k])) return false; } return true; },   // true once the first WARM_PRELOAD Image objects are decoded + drawable — stronger than HTTP cache presence (which can silently fail or be incomplete)
    destroy(){ stop(); try { ro && ro.disconnect(); } catch(e){} window.removeEventListener('resize', onResize); try { prefetchCtrl && prefetchCtrl.abort(); } catch(e){}
      for(let i = 0; i < frames.length; i++){ drop(frames[i]); } frames.length = 0;
      try { gl.deleteTexture(tex); gl.deleteTexture(wmTex); gl.deleteBuffer(quad); gl.deleteProgram(prog); gl.clear(gl.COLOR_BUFFER_BIT); } catch(e){} }
  };
}
