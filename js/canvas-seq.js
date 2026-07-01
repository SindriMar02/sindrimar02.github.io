// Reusable WebP frame-sequence → <canvas> scrubber. cover-fit, fractional cross-blend, windowed lazy preload + EVICTION
// (bounded memory). SMOOTH-SCROLL: each preloaded frame is WARMED with img.decode() (off-thread) so drawImage rarely hits a
// synchronous WebP decode mid-scroll (the cause of scrub jank); opaque ctx + DPR-capped backing store keep per-frame draw
// light. (Draw gates on onload, not decode(), so it still renders when a tab is backgrounded.) Generic/unbranded frames only.
export function createSequence({ canvas, dir, count }){
  const ctx = canvas.getContext('2d', { alpha: false });   // opaque: frames cover-fill, so skip per-frame alpha compositing
  // STAY HIDDEN UNTIL PAINTED (owner: "sometimes the video just disappears and background is black") — an {alpha:false} 2D context
  // renders OPAQUE BLACK by spec the instant its backing store is sized, before anything is ever drawImage'd into it. This module is
  // also dive-lens's no-WebGL FALLBACK for the descent hero — if WebGL context creation fails (GPU pressure, driver hiccup, common
  // after repeated refreshes pile up contexts) cinematic.js falls back here, and this canvas was left at its CSS default opacity:1
  // with nothing drawn — solid black until the first frame loads, with no safety net. Mirror dive-lens.js's pattern: hold transparent
  // (the CSS poster behind shows through) until the first real frame paints, then fade in.
  canvas.style.opacity = '0'; canvas.style.transition = 'opacity .3s ease'; let painted = false;
  const n = count;
  const src = (i) => dir + 'frame-' + ('000' + i).slice(-4) + '.webp';
  const frames = new Array(n);
  const tries = new Uint8Array(n);   // bounded per-frame retry counter (symptom A: recover a transient WebP fetch failure instead of staying blank forever)
  const isReady = (im) => !!(im && im.complete && im.naturalWidth > 0);
  // Cap at 2 (native retina). The 1.5 cap WAS chosen as "lighter to draw" but it renders the canvas BELOW the device's
  // physical pixels, so the browser then upscales the finished canvas → visibly soft/blurry on hi-DPI desktops (owner complaint).
  // Rendering at the real DPR (one high-quality drawImage upscale of the source, mapped 1:1 to screen) reads far sharper.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cw = 0, ch = 0, curF = 1, rafResize = 0;
  function realSize(){ const r = canvas.getBoundingClientRect();
    if(Math.round(r.width) === cw && Math.round(r.height) === ch) return;
    cw = Math.round(r.width); ch = Math.round(r.height);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(curF); }
  function size(){ if(rafResize) return; rafResize = requestAnimationFrame(() => { rafResize = 0; realSize(); }); }
  // CONCURRENCY GATE (owner: "still unreliable/stuttery") — this module had ZERO inflight cap: preload() fires up to 25
  // simultaneous Image()+decode() requests per scroll-driven center change, and it's ALSO dive-lens's no-WebGL fallback for
  // the descent hero (WebGL context creation failure — GPU pressure/driver hiccup/repeat-visit context exhaustion), so that
  // entire visitor population streamed the whole dive sequence through a completely unthrottled path that the WebGL-side
  // concurrency fixes never touched. Mirrors dive-lens.js's load() gate exactly: speculative callers (preload's lookahead
  // window) queue past MAX_INFLIGHT; the on-demand call inside draw() (the frame actively blocking the visible render)
  // passes prioritize=true to bypass the cap outright — it must never wait behind speculative work.
  let inflightLoads = 0; const MAX_INFLIGHT = 8; const pendingQueue = [];
  function startLoad(i, onSettle){
    const im = new Image(); im.decoding = 'async';
    im.onload = () => { if(Math.round(curF) === i) draw(curF); onSettle(); };   // draw when loaded (renders in any tab state)
    im.onerror = () => { if(frames[i-1] !== im) return; frames[i-1] = undefined;        // free the slot (was: a failed/aborted request stayed in the array forever → frozen sequence)
      if(tries[i-1] < 4){ tries[i-1]++; setTimeout(() => { if(!frames[i-1]) startLoad(i, onSettle); }, 300 * tries[i-1]); }   // capped backoff retry so a transient miss self-heals
      else onSettle(); };
    im.src = src(i); frames[i-1] = im;
    if(im.decode) im.decode().catch(() => {}); }   // WARM the off-thread decode so a later drawImage rarely hits a SYNC decode (the scrub-jank cause)
  function drainQueue(){ while(inflightLoads < MAX_INFLIGHT && pendingQueue.length){ const i = pendingQueue.shift();
      if(frames[i-1]) continue;                                                         // loaded by another path while queued
      inflightLoads++; startLoad(i, () => { inflightLoads--; drainQueue(); }); } }
  function load(i, prioritize){ if(i < 1 || i > n || frames[i-1]) return;
    if(prioritize || inflightLoads < MAX_INFLIGHT){ inflightLoads++; startLoad(i, () => { inflightLoads--; drainQueue(); }); }
    else { pendingQueue.push(i); } }
  function drop(im){ if(im){ im.onload = null; im.onerror = null; im.src = ''; } }   // null handlers BEFORE blanking src so the abort doesn't trip onerror/retry
  function cover(img){ const ir = img.naturalWidth / img.naturalHeight, cr = cw / ch; let w, h;   // draw cover-fit DIRECTLY (no per-frame [x,y,w,h] array alloc → no GC saw-tooth in the scrub hot path)
    if(ir > cr){ h = ch; w = ch * ir; } else { w = cw; h = cw / ir; } ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h); }
  function draw(f){ curF = f; if(!cw) return;
    const lo = Math.max(1, Math.min(n, Math.floor(f))), hi = Math.min(n, lo + 1), frac = f - lo;
    const a = frames[lo-1]; if(!isReady(a)){ load(lo, true); return; }   // FRAME-EXACT: hold the last good frame until this one is loaded (no substitute frame). PRIORITIZED — this frame is blocking the visible render right now, must never queue behind preload's lookahead
    ctx.globalAlpha = 1; cover(a);                                    // opaque cover-fill overwrites all → no clearRect needed
    const b = frames[hi-1]; if(frac > 0 && isReady(b)){ ctx.globalAlpha = frac; cover(b); ctx.globalAlpha = 1; }
    if(!painted){ painted = true; canvas.style.opacity = '1'; } }      // first real content drawn — reveal (was: visible+black from creation until this point)
  function preload(center, radius){ for(let i = center - radius; i <= center + radius; i++) load(i); }
  function evict(center, keep){ for(let i = 1; i <= n; i++){ const im = frames[i-1];
    if(im && Math.abs(i - center) > keep){ drop(im); frames[i-1] = undefined; } } }
  let lastCenter = -1;
  function setProgress(p){ const f = 1 + Math.max(0, Math.min(1, p)) * (n - 1); const c = Math.round(f);
    if(c !== lastCenter){ lastCenter = c; preload(c, 12); evict(c, 18); }   // wider window than before = more buffer for fast scrolls
    draw(f); }
  // Warm the HTTP cache for the WHOLE sequence in the background (low priority, ≤4 in flight) so a fast scroll never waits on a
  // download — the windowed decode then pulls each frame from cache instantly. (serve.py marks frames cacheable.)
  const prefetchCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  let prefetchStarted = false;
  function prefetchAll(){ if(prefetchStarted) return; prefetchStarted = true;             // idempotent — the cinematic triggers this on dive-cached so the story caches during the dive-glide runway; the load+idle path below is only a fallback
    let i = 1, inflight = 0; const pump = () => {
    while(inflight < 3 && i <= n){ const u = src(i++); inflight++;                       // 3 in-flight (was 4): leave connection headroom for the windowed <img> loads + the live scrub
      fetch(u, { priority: 'low', signal: prefetchCtrl ? prefetchCtrl.signal : undefined }).then(r => r.arrayBuffer()).catch(() => {}).then(() => { inflight--; pump(); }); } };
    pump(); }
  realSize(); window.addEventListener('resize', size, { passive: true }); preload(1, 12);
  // FALLBACK trigger: if no external trigger (cinematic's dive-cached) fires, still warm the cache after load + idle so a fast scroll never waits.
  const schedulePrefetch = () => (window.requestIdleCallback || ((fn) => setTimeout(fn, 3000)))(prefetchAll, { timeout: 6000 });
  if(document.readyState === 'complete') schedulePrefetch();
  else window.addEventListener('load', schedulePrefetch, { once: true });
  return { setProgress, redraw: () => draw(curF), prefetch: prefetchAll,
    destroy(){ window.removeEventListener('resize', size); if(rafResize) cancelAnimationFrame(rafResize);
      try { prefetchCtrl && prefetchCtrl.abort(); } catch(e){}                            // stop the background prefetch pump on teardown (media-query flip) — was an un-abortable leak
      for(let i = 0; i < frames.length; i++){ drop(frames[i]); } frames.length = 0; },
    get count(){ return n; } };
}
