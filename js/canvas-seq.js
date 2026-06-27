// Reusable WebP frame-sequence → <canvas> scrubber. cover-fit, fractional cross-blend, windowed lazy preload + EVICTION
// (bounded memory). SMOOTH-SCROLL: each preloaded frame is WARMED with img.decode() (off-thread) so drawImage rarely hits a
// synchronous WebP decode mid-scroll (the cause of scrub jank); opaque ctx + DPR-capped backing store keep per-frame draw
// light. (Draw gates on onload, not decode(), so it still renders when a tab is backgrounded.) Generic/unbranded frames only.
export function createSequence({ canvas, dir, count }){
  const ctx = canvas.getContext('2d', { alpha: false });   // opaque: frames cover-fill, so skip per-frame alpha compositing
  const n = count;
  const src = (i) => dir + 'frame-' + ('000' + i).slice(-4) + '.webp';
  const frames = new Array(n);
  const tries = new Uint8Array(n);   // bounded per-frame retry counter (symptom A: recover a transient WebP fetch failure instead of staying blank forever)
  const isReady = (im) => !!(im && im.complete && im.naturalWidth > 0);
  // Frames are ~1600–1920px; a DPR-2 backing store oversamples beyond the source (no real sharpness gain) and ~doubles the
  // pixels drawn + GPU memory every frame. Cap at 1.5 — still ≥ source res, much lighter to draw → smoother scrub.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let cw = 0, ch = 0, curF = 1, rafResize = 0;
  function realSize(){ const r = canvas.getBoundingClientRect();
    if(Math.round(r.width) === cw && Math.round(r.height) === ch) return;
    cw = Math.round(r.width); ch = Math.round(r.height);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(curF); }
  function size(){ if(rafResize) return; rafResize = requestAnimationFrame(() => { rafResize = 0; realSize(); }); }
  function load(i){ if(i < 1 || i > n || frames[i-1]) return;
    const im = new Image(); im.decoding = 'async';
    im.onload = () => { if(Math.round(curF) === i) draw(curF); };   // draw when loaded (renders in any tab state)
    im.onerror = () => { if(frames[i-1] !== im) return; frames[i-1] = undefined;        // free the slot (was: a failed/aborted request stayed in the array forever → frozen sequence)
      if(tries[i-1] < 4){ tries[i-1]++; setTimeout(() => { if(!frames[i-1]) load(i); }, 300 * tries[i-1]); } };   // capped backoff retry so a transient miss self-heals
    im.src = src(i); frames[i-1] = im;
    if(im.decode) im.decode().catch(() => {}); }   // WARM the off-thread decode so a later drawImage rarely hits a SYNC decode (the scrub-jank cause)
  function drop(im){ if(im){ im.onload = null; im.onerror = null; im.src = ''; } }   // null handlers BEFORE blanking src so the abort doesn't trip onerror/retry
  function cover(img){ const ir = img.naturalWidth / img.naturalHeight, cr = cw / ch; let w, h;   // draw cover-fit DIRECTLY (no per-frame [x,y,w,h] array alloc → no GC saw-tooth in the scrub hot path)
    if(ir > cr){ h = ch; w = ch * ir; } else { w = cw; h = cw / ir; } ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h); }
  function draw(f){ curF = f; if(!cw) return;
    const lo = Math.max(1, Math.min(n, Math.floor(f))), hi = Math.min(n, lo + 1), frac = f - lo;
    const a = frames[lo-1]; if(!isReady(a)){ load(lo); return; }       // FRAME-EXACT: hold the last good frame until this one is loaded (no substitute frame)
    ctx.globalAlpha = 1; cover(a);                                    // opaque cover-fill overwrites all → no clearRect needed
    const b = frames[hi-1]; if(frac > 0 && isReady(b)){ ctx.globalAlpha = frac; cover(b); ctx.globalAlpha = 1; } }
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
