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
  const srcOf = (i) => dir + 'frame-' + ('000' + i).slice(-4) + '.webp';
  let curF = 1, lastCenter = -1;
  function load(i){ if(i < 1 || i > count || frames[i-1]) return;
    const im = new Image(); im.decoding = 'async'; im.src = srcOf(i); frames[i-1] = im; if(im.decode) im.decode().catch(() => {}); }
  function setFrame(p){ const f = 1 + Math.max(0, Math.min(1, p)) * (count - 1); curF = f; const c = Math.round(f);
    if(c !== lastCenter){ lastCenter = c; for(let i = c - 8; i <= c + 24; i++) load(i);   // FORWARD-biased window — decode well ahead of the dive so the fast Iceland/clouds stretch never out-runs the WebP decode
      for(let i = 1; i <= count; i++){ const im = frames[i-1]; if(im && Math.abs(i - c) > 32){ im.src = ''; frames[i-1] = undefined; } } } }
  function coverDraw(){ const cw = earthC.width, ch = earthC.height; if(!cw) return false;
    const lo = Math.max(1, Math.min(count, Math.floor(curF))), hi = Math.min(count, lo + 1), frac = curF - lo;
    const a = frames[lo-1]; if(!a || !a.complete || !a.naturalWidth){ load(lo); return false; }
    const cover = (im) => { const ir = im.naturalWidth / im.naturalHeight, cr = cw / ch; let w, h;
      if(ir > cr){ h = ch; w = ch * ir; } else { w = cw; h = cw / ir; } octx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h); };
    octx.globalAlpha = 1; cover(a);
    const b = frames[hi-1]; if(frac > 0 && b && b.complete && b.naturalWidth){ octx.globalAlpha = frac; cover(b); octx.globalAlpha = 1; }
    return true; }
  const prefetchCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  function prefetchAll(){ let i = 1, inflight = 0; const pump = () => { while(inflight < 4 && i <= count){ const u = srcOf(i++); inflight++;
      fetch(u, { priority: 'low', signal: prefetchCtrl ? prefetchCtrl.signal : undefined }).then(r => r.arrayBuffer()).catch(() => {}).then(() => { inflight--; pump(); }); } };
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 2500)))(pump); }
  prefetchAll();

  // ── ice ARTIX wordmark (its own canvas; warped/composited by the shader) ──
  // Treatment-B instrument decode (claude-design handoff) draws the wordmark+slogan; this file keeps the placing, the resting
  // glow (re-added in the decode module), the scroll-driven zoom-through, and the WebGL lens/chromatic-tear composite unchanged.
  const wmc = document.createElement('canvas'); const wmctx = wmc.getContext('2d');
  if(document.fonts){ document.fonts.load('400 100px Michroma').catch(() => {}); document.fonts.load('500 100px "Martian Mono"').catch(() => {}); }
  const wmDecode = createWordmarkDecode({ subGap: 0.8, titleStagger: 220 });   // 220ms per letter = strict sequential (A→R→T→I→X)
  let progress = 0, t0 = performance.now(), raf = 0, running = false;
  // per-frame change tracking — skip the expensive work (layout reflow, cover redraw, GPU uploads, wordmark glyph loop) when nothing changed
  let needsFit = true, lastDrawnF = -1, earthDirty = true, lastWmOp = -1, lastWmScale = -1, ro = null;
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
    if(earthC.width !== w || earthC.height !== h){ earthC.width = w; earthC.height = h; resized = true; }
    if(wmc.width !== w || wmc.height !== h){ wmc.width = w; wmc.height = h; resized = true; }
    return resized;
  }

  function frame(){
    const resized = fit();
    if(curF !== lastDrawnF || resized){ if(coverDraw()){ lastDrawnF = curF; earthDirty = true; } }   // earthC only changes when the frame/blend moves or on resize
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
    if(running) raf = requestAnimationFrame(frame);
  }
  function start(){ if(running) return; running = true; raf = requestAnimationFrame(frame); }
  function stop(){ running = false; cancelAnimationFrame(raf); }
  setFrame(0); start();

  return {
    setProgress(p){ progress = Math.max(0, Math.min(1, p)); setFrame(progress); if(!running) start(); },
    scrambleIn(){ wmDecode.scrambleIn(performance.now()); },
    redraw(){},
    pause: stop,
    resume: start,
    get count(){ return count; },
    destroy(){ stop(); try { ro && ro.disconnect(); } catch(e){} window.removeEventListener('resize', onResize); try { prefetchCtrl && prefetchCtrl.abort(); } catch(e){}
      for(let i = 0; i < frames.length; i++){ const im = frames[i]; if(im){ im.src = ''; } } frames.length = 0;
      try { gl.deleteTexture(tex); gl.deleteTexture(wmTex); gl.deleteBuffer(quad); gl.deleteProgram(prog); gl.clear(gl.COLOR_BUFFER_BIT); } catch(e){} }
  };
}
