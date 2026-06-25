// scramble.js — sleek "mission-brief" decode. Each character resolves in its OWN width-locked slot, so swapping glyphs
// never reflows the line (the old version jittered because proportional glyphs changed the text width every frame).
// Default ("rise") motion per char: a short, throttled glyph churn under a smooth eased opacity + blur + micro-rise, swept
// left→right. opts.mode:'scan' = Spec v1 §06 "ICE instrument decode" — chars sit DIM ice (rgba(116,198,230,.5)), churn glyphs,
// FLARE to ICE (#74C6E6 + ice glow) within ~200ms of resolving, then settle to FROST (#EDF3F7). NO ember — ice is the decode
// signal (ember stays rationed to lock/CTA). Reduced-motion / no-JS safe. Idempotent: splits once, re-animates the same spans
// on re-trigger (scrubbing back/forth). SHARED utility — reveal.js (every .eyebrow) + cinematic.js depend on it.
const GLYPHS = 'ABCDEFGHIJKLMNPQRSTUVWXYZ0123456789#%/<>*+=';                   // Spec v1 §06 glyph pool (alphanumerics + instrument symbols)
const reduce = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = t => t * t * (3 - 2 * t);   // smoothstep — gentle in/out, no robotic linear churn
const DIM = 'rgba(116,198,230,.5)';                                            // scan: unresolved char tint — ICE @50% (var(--accent-signal))
const FLARE_COL = '#74C6E6';                                                   // scan: ICE flare as each char locks (var(--accent-signal))
const FLARE_SH = '0 0 12px rgba(116,198,230,.7)';                              // scan: ice glow at the flare

function buildChars(el, target){
  el.textContent = '';
  const chars = [];
  for(const ch of target){
    const s = document.createElement('span');
    s.className = 'sc';
    const space = ch === ' ';
    s.dataset.final = space ? ' ' : ch;
    if(space){ s.dataset.space = '1'; s.style.whiteSpace = 'pre'; }   // pre = keep the space from collapsing to 0-width inside the inline-block slot (.ch-title .sc forces inline-block, which otherwise trims a lone space)
    s.textContent = space ? ' ' : ch;
    el.appendChild(s);
    chars.push(s);
  }
  // lock each slot to its final glyph width so subsequent glyph swaps can't shift the layout
  chars.forEach(s => { const w = s.getBoundingClientRect().width; if(w > 0){ s.style.display = 'inline-block'; s.style.width = w.toFixed(2) + 'px'; s.style.textAlign = 'center'; } });
  el._chars = chars;
  el.dataset.split = '1';
}

export function scramble(el, opts = {}){
  if(!el) return;
  const scan = opts.mode === 'scan';
  const target = el.dataset.text != null ? el.dataset.text : (el.dataset.text = el.textContent.trim());
  if(reduce()){
    if(el.dataset.split === '1') el._chars.forEach(s => { s.textContent = s.dataset.final; s.style.opacity = ''; s.style.filter = ''; s.style.transform = ''; s.style.color = ''; s.style.textShadow = ''; });
    else el.textContent = target;
    return;
  }
  if(el.dataset.split !== '1') buildChars(el, target);
  const chars = el._chars, n = chars.length;
  if(el._raf) cancelAnimationFrame(el._raf);
  const dur = opts.duration || 780;
  const stag = (dur * 0.42) / Math.max(n, 1);   // left→right reveal sweep
  const settle = dur * 0.52;                      // per-char resolve window
  const t0 = performance.now();
  let lastSwap = 0;
  // _lc/_ls (scan colour+shadow) and _lo/_lf/_lt (rise opacity/filter/transform) cache the last written value per span,
  // so we only touch the DOM when a value actually changes (the churn glyph swap still fires on its own 50ms clock).
  if(scan) chars.forEach(s => { if(!s.dataset.space){ s.style.opacity = '1'; s.style.color = DIM; s._lc = DIM; } });
  else chars.forEach(s => { if(!s.dataset.space){ s.style.opacity = '0'; s._lo = '0'; } });
  const step = (now) => {
    const t = now - t0;
    const swap = (now - lastSwap) > 50; if(swap) lastSwap = now;   // throttle glyph churn (~20/s) — calmer than per-frame
    let running = false;
    for(let i = 0; i < n; i++){
      const s = chars[i];
      if(s.dataset.space) continue;
      const p = clamp((t - i * stag) / settle, 0, 1);
      if(p < 1) running = true;
      if(scan){
        if(p >= 1){
          if(s.textContent !== s.dataset.final) s.textContent = s.dataset.final;
          if(s._lc !== ''){ s.style.color = ''; s._lc = ''; }                     // resolve → inherits frost
          if(s._ls !== ''){ s.style.textShadow = ''; s._ls = ''; }
        } else {
          if(swap) s.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
          if(p > 0.66){ if(s._lc !== FLARE_COL){ s.style.color = FLARE_COL; s._lc = FLARE_COL; } if(s._ls !== FLARE_SH){ s.style.textShadow = FLARE_SH; s._ls = FLARE_SH; } }   // ICE flare as it locks (Spec v1 §06)
          else { if(s._lc !== DIM){ s.style.color = DIM; s._lc = DIM; } if(s._ls !== 'none'){ s.style.textShadow = 'none'; s._ls = 'none'; } }
        }
      } else {
        const e = smooth(p);
        const opVal = e.toFixed(3);
        const flVal = p >= 1 ? 'none' : 'blur(' + (5 * (1 - e)).toFixed(2) + 'px)';
        const trVal = p >= 1 ? 'none' : 'translateY(' + (0.14 * (1 - e)).toFixed(3) + 'em)';
        if(s._lo !== opVal){ s.style.opacity = opVal; s._lo = opVal; }
        if(s._lf !== flVal){ s.style.filter = flVal; s._lf = flVal; }
        if(s._lt !== trVal){ s.style.transform = trVal; s._lt = trVal; }
        if(p >= 1){ if(s.textContent !== s.dataset.final) s.textContent = s.dataset.final; }
        else if(swap) s.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
    }
    if(running){ el._raf = requestAnimationFrame(step); }
    else { chars.forEach(s => { s.textContent = s.dataset.final; s.style.opacity = ''; s.style.filter = ''; s.style.transform = ''; s.style.color = ''; s.style.textShadow = ''; s._lc = s._ls = s._lo = s._lf = s._lt = undefined; }); el._raf = null; }
  };
  el._raf = requestAnimationFrame(step);
}

export function resetScramble(el){
  if(!el) return;
  if(el._raf){ cancelAnimationFrame(el._raf); el._raf = null; }
  if(el.dataset.split === '1' && el._chars) el._chars.forEach(s => { s.textContent = s.dataset.final; s.style.opacity = ''; s.style.filter = ''; s.style.transform = ''; s.style.color = ''; s.style.textShadow = ''; s._lc = s._ls = s._lo = s._lf = s._lt = undefined; });
  else if(el.dataset.text != null) el.textContent = el.dataset.text;
}
