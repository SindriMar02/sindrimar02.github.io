/* artix-wordmark-decode.js
 * ============================================================================
 * ARTIX hero wordmark decode — TREATMENT B ("chromatic split")
 * From the claude-design handoff (design_handoff_artix_scramble). Owner-approved
 * replacement for the rejected artixText()/subInfo() in js/dive-lens.js.
 * Zero-build, vanilla ES module, no deps.
 * ----------------------------------------------------------------------------
 * THE FEEL (per character, swept left -> right, smoothstep-eased):
 *   1. churn  — a uniform-width MARTIAN MONO glyph, random + throttled to ~20/s,
 *               painted DIM ICE, with a soft focus-pull blur AND a cyan/violet
 *               chromatic split. Both tighten toward zero as the char resolves.
 *   2. flare  — as the char crosses 66% it FLARES to ICE (#74C6E6) with a glow.
 *   3. lock   — it snaps to its real wide MICHROMA glyph and settles to FROST.
 *   ARTIX resolves first; the slogan decodes as a clean SECOND BEAT.
 *
 * SITE ADAPTATIONS (vs the raw handoff — to honour "keep placing/glow/scroll"):
 *   • draw() takes a `master` alpha (last arg) so dive-lens's zoom-through exit
 *     fade (op) still applies — the per-glyph save/restore would otherwise wipe
 *     the outer globalAlpha. master multiplies every glyph's alpha.
 *   • the LOCKED title keeps the current crystalline ICE GLOW (the handoff locked
 *     to flat frost); paintFinal draws a soft cyan halo on resolved title glyphs.
 *   • opts.subGap places the slogan to match the CURRENT placing (dive-lens used
 *     height*0.088 below the wordmark centre ≈ 0.8·fs).
 *   • the layout cache is invalidated on document.fonts.ready so Michroma /
 *     Martian Mono advances are measured correctly even if the first draw raced
 *     font load.
 * ============================================================================ */

const GLYPHS = 'ABCDEFGHIJKLMNPQRSTUVWXYZ0123456789#%/<>*+=';  // matches scramble.js (no 'O')

// ---- colour spine (design tokens) ------------------------------------------
const DIM   = 'rgba(124,202,232,0.85)';  // unresolved char tint — DIM ice
const ICE   = '#74C6E6';                  // --accent-signal : the flare/lock signal
const FROST = '#EDF3F7';                  // --frost         : resolved text
const SPLIT_CYAN   = 'rgb(0,200,236)';    // chromatic fringe (left offset)
const SPLIT_VIOLET = 'rgb(132,152,255)';  // chromatic fringe (right offset)
const LOCK_GLOW_COL = 'rgba(120,214,255,0.42)';   // resting wordmark halo — matches the prior dive-lens glow
const LOCK_GLOW     = 0.18;                        // resting glow blur as a fraction of fs (≈ prior fs*0.2)

const clamp  = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);   // smoothstep — gentle in/out
const isPass = (c) => c === ' ' || c === '.'; // spaces + periods pass through

/**
 * @param {object} [opts]
 * @param {string} [opts.title='ARTIX']
 * @param {string} [opts.sub='SOURCED. DELIVERED. SUPPORTED.']
 * @param {number} [opts.titleDur=860]      ms for ARTIX to fully resolve (used when titleStagger is NOT set)
 * @param {number} [opts.titleStagger=null] explicit per-char stagger ms; if set, stag=settle=titleStagger → strict one-letter-at-a-time
 * @param {number} [opts.subDur=1000]       ms for the slogan to fully resolve
 * @param {number} [opts.gap=190]           ms beat between title lock and slogan start
 * @param {number} [opts.subScale=0.175]    slogan font size as a fraction of wordmark fs
 * @param {number} [opts.subGap=0.62]       slogan baseline below the wordmark centre, in fs (site uses 0.8 to keep current placing)
 */
export function createWordmarkDecode(opts = {}) {
  const TITLE         = opts.title         ?? 'ARTIX';
  const SUB           = opts.sub           ?? 'SOURCED. DELIVERED. SUPPORTED.';
  const TITLE_DUR     = opts.titleDur      ?? 860;
  const TITLE_STAGGER = opts.titleStagger  ?? null;   // if set: stag=settle=titleStagger (sequential one-at-a-time decode)
  const SUB_DUR   = opts.subDur   ?? 1000;
  const GAP       = opts.gap      ?? 190;
  const SUB_SCALE = opts.subScale ?? 0.175;
  const SUB_GAP   = opts.subGap   ?? 0.62;
  const SUB_TRACK = opts.subTrack ?? 0.22;   // slogan letter-spacing (em) — matches the prototype's Martian-Mono 0.22em label

  const reduce = () =>
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion:reduce)').matches;

  let active = false;        // true once scrambleIn() has fired
  let startT = 0;            // performance.now() at scrambleIn()
  const titleChurn = { last: 0, g: [] };
  const subChurn   = { last: 0, g: [] };
  let cache = null;          // { fs, title, sub } layout cache
  let lockedBitmap = null;   // the fully-resolved wordmark baked ONCE → drawImage instead of re-running ~33 glyph fills/frame
  let allLocked = false;     // true once both beats have settled and the bitmap is baked

  // re-measure once the self-hosted Michroma + Martian Mono are ready (a first draw
  // that raced font load would otherwise cache fallback-metric advances forever)
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(() => { cache = null; lockedBitmap = null; allLocked = false; }).catch(() => {});
  }

  /** Kick-off. Call once on entry (cinematic.js revealBrand). */
  function scrambleIn(now) {
    active = true;
    startT = now != null ? now : performance.now();
    titleChurn.last = 0;
    subChurn.last = 0;
    lockedBitmap = null; allLocked = false;   // re-decode from scratch on a fresh kick
  }

  /** Measure a string at size fs: per-slot centre x, natural width, churn-fit scale.
   *  Each slot is measured in the font it will LOCK to — Michroma for the wordmark, Martian Mono for the slogan.
   *  (Bug fixed: the slogan used to be measured in Michroma but drawn in Martian Mono → ~20% wider, uneven slots,
   *  and the narrow Michroma '.' slot collided with the wide mono period. Mono advances give even instrument spacing.) */
  function layout(ctx, str, fs, isTitle) {
    ctx.font = isTitle ? '400 ' + fs + 'px Michroma, sans-serif'
                       : '500 ' + fs + 'px "Martian Mono", monospace';
    const slots = [];
    let total = 0;
    for (const c of str) { const w = ctx.measureText(c).width; slots.push({ c, w }); total += w; }
    const track = fs * (isTitle ? 0.05 : SUB_TRACK);   // wordmark +0.05em; slogan wider instrument tracking
    total += track * Math.max(0, slots.length - 1);
    ctx.font = '500 ' + fs + 'px "Martian Mono", monospace';   // churn glyph is always Martian Mono
    const monoW = ctx.measureText('W').width || fs * 0.6;
    let x = -total / 2, ai = 0;
    for (const s of slots) {
      s.cx   = x + s.w / 2;
      x     += s.w + track;
      s.pass = isPass(s.c);
      s.ai   = s.pass ? -1 : ai++;
      s.fit  = Math.min(1, s.w / monoW);     // scaleX so mono churn fits its slot (≈1 for the slogan)
    }
    return { slots, total, n: ai, monoW };
  }

  function layouts(ctx, fs) {
    if (!cache || cache.fs !== fs) {
      cache = { fs, title: layout(ctx, TITLE, fs, true), sub: layout(ctx, SUB, fs * SUB_SCALE, false) };
      lockedBitmap = null; allLocked = false;   // size changed → re-bake the locked bitmap at the new fs
    }
    return cache;
  }

  /** Bake the fully-resolved wordmark + slogan into one offscreen bitmap (called once, after both beats settle). */
  function bakeLocked(L, fs) {
    const glow = fs * LOCK_GLOW;
    const w = Math.max(2, Math.ceil(Math.max(L.title.total, L.sub.total) + glow * 2 + fs * 0.5));
    const oy = Math.ceil(fs * 0.85 + glow);                                  // title centre sits this far below the top
    const h = Math.max(2, Math.ceil(oy + fs * SUB_GAP + fs * SUB_SCALE * 0.8 + glow + fs * 0.15));
    const bc = document.createElement('canvas'); bc.width = w; bc.height = h;
    const bx = bc.getContext('2d');
    drawWordStatic(bx, L.title, w / 2, oy, fs, true, 1);                     // bake at master alpha 1; live alpha applied on drawImage
    drawWordStatic(bx, L.sub, w / 2, oy + fs * SUB_GAP, fs, false, 1);
    lockedBitmap = { canvas: bc, fs, ox: w / 2, oy };
    allLocked = true;
  }

  /** Paint one decoding word. t = ms since THIS word's beat began. */
  function drawWord(ctx, lay, cx, cy, fs, t, churn, now, isTitle, alpha) {
    const n      = lay.n;
    const dur    = isTitle ? TITLE_DUR : SUB_DUR;
    // titleStagger: stag=settle=TITLE_STAGGER → strictly one letter resolves before the next begins
    const stag   = (isTitle && TITLE_STAGGER != null) ? TITLE_STAGGER : ((dur * 0.42) / Math.max(n, 1));
    const settle = (isTitle && TITLE_STAGGER != null) ? TITLE_STAGGER : (dur * 0.52);

    // throttle the random churn to ~20/s with one shared clock (calm, not strobe)
    if (now - churn.last > 50) {
      churn.last = now;
      for (let i = 0; i < n; i++) churn.g[i] = GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const s of lay.slots) {
      const X = cx + s.cx;
      if (s.pass) { paintFinal(ctx, s.c, X, cy, fs, isTitle, FROST, 0, 1, alpha); continue; }

      const p = smooth(clamp((t - s.ai * stag) / settle, 0, 1));

      if (p >= 1) {
        // LOCKED — real Michroma glyph (or mono for the slogan), frost + resting ice glow on the title
        paintFinal(ctx, s.c, X, cy, fs, isTitle, FROST, isTitle ? fs * LOCK_GLOW : 0, 1, alpha);
      } else {
        // CHURN — mono glyph, dim->ice flare, focus-pull blur, chromatic split
        const g     = churn.g[s.ai] || 'X';
        const flare = p > 0.66;
        paintChurn(ctx, g, X, cy, fs, isTitle, p, flare, s.fit, alpha);
      }
    }
  }

  /** Resolved / passthrough glyph. glow>0 draws the resting cyan halo (kept from the prior wordmark). */
  function paintFinal(ctx, ch, x, y, fs, isTitle, color, glow, scaleX, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = isTitle
      ? '400 ' + fs + 'px Michroma, sans-serif'
      : '400 ' + Math.round(fs * SUB_SCALE) + 'px "Martian Mono", monospace';
    if (glow > 0) { ctx.shadowColor = LOCK_GLOW_COL; ctx.shadowBlur = glow; }
    if (scaleX !== 1) { ctx.translate(x, y); ctx.scale(scaleX, 1); ctx.fillText(ch, 0, 0); }
    else ctx.fillText(ch, x, y);
    ctx.restore();
  }

  /** Churning glyph: focus-pull blur + cyan/violet chromatic split, scaleX-fit. */
  function paintChurn(ctx, g, x, y, fs, isTitle, p, flare, fit, alpha) {
    const glyphFs = isTitle ? fs : Math.round(fs * SUB_SCALE);
    const blur = (1 - p) * glyphFs * 0.030;   // ≈ 2.1px at 70px
    const off  = (1 - p) * glyphFs * 0.057 + 0.5;
    const a    = alpha * (0.78 + 0.22 * p);

    ctx.save();
    ctx.translate(x, y);
    if (fit !== 1) ctx.scale(fit, 1);          // fit mono churn into a narrow slot
    ctx.font = '500 ' + glyphFs + 'px "Martian Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (blur > 0.2 && 'filter' in ctx) ctx.filter = 'blur(' + blur.toFixed(2) + 'px)';

    // additive cyan (left) + violet (right) fringe — the chromatic split
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * 0.92;
    ctx.fillStyle = SPLIT_CYAN;   ctx.fillText(g, -off, 0);
    ctx.fillStyle = SPLIT_VIOLET; ctx.fillText(g,  off, 0);
    // bright core
    ctx.globalAlpha = a * (flare ? 1 : 0.82);
    ctx.fillStyle = flare ? 'rgb(166,226,246)' : 'rgb(126,204,234)';
    ctx.fillText(g, 0, 0);
    ctx.restore();

    // ICE flare glow as it locks in
    if (flare) {
      ctx.save();
      ctx.translate(x, y);
      if (fit !== 1) ctx.scale(fit, 1);
      ctx.font = '500 ' + glyphFs + 'px "Martian Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = a * 0.6;
      ctx.shadowColor = 'rgba(116,198,230,0.7)';
      ctx.shadowBlur = glyphFs * 0.18;
      ctx.fillStyle = ICE;
      ctx.fillText(g, 0, 0);
      ctx.restore();
    }
  }

  /**
   * Paint the wordmark + slogan at (cx, cy) — origin should already be translated
   * and scaled by drawWordmark()'s zoom-through. fs = wordmark font size in px.
   * master = outer alpha (the zoom-through op) multiplied into every glyph.
   */
  function draw(ctx, cx, cy, fs, now, master, scaleHint) {
    const m = master == null ? 1 : master;
    const L = layouts(ctx, fs);
    const subCy = cy + fs * SUB_GAP;          // slogan sits below the wordmark (site placing)

    // reduced motion (or not yet kicked) -> resolve instantly
    if (!active || reduce()) {
      drawWordStatic(ctx, L.title, cx, cy, fs, true, m);
      drawWordStatic(ctx, L.sub,   cx, subCy, fs, false, m);
      return;
    }

    // FULLY LOCKED + near rest: one cheap drawImage instead of ~33 glyph fills/frame. Only when scale≈1 — scaling a 1x
    // bake up through the zoom-through would blur it, so during the zoom we fall through to crisp vector drawing.
    if (allLocked && lockedBitmap && lockedBitmap.fs === fs && (scaleHint == null || scaleHint < 1.5)) {
      ctx.save();
      ctx.globalAlpha = m;
      ctx.drawImage(lockedBitmap.canvas, cx - lockedBitmap.ox, cy - lockedBitmap.oy);
      ctx.restore();
      return;
    }

    const t = now - startT;

    // beat boundaries — recalculate using the same stag/settle logic as drawWord
    const tN = L.title.n;
    const tStag   = TITLE_STAGGER != null ? TITLE_STAGGER : ((TITLE_DUR * 0.42) / tN);
    const tSettle = TITLE_STAGGER != null ? TITLE_STAGGER : (TITLE_DUR * 0.52);
    const titleTotal = (tN - 1) * tStag + tSettle;
    const subStart = titleTotal + GAP;

    // title (beat 1)
    drawWord(ctx, L.title, cx, cy, fs, t, titleChurn, now, true, m);

    // slogan (beat 2) — fades in just as the title finishes, then decodes
    const subAlpha = clamp((t - (titleTotal - 40)) / 220, 0, 1) * m;
    if (subAlpha > 0.01) {
      drawWord(ctx, L.sub, cx, subCy, fs, Math.max(0, t - subStart),
               subChurn, now, false, subAlpha);
    }

    // both beats fully settled (incl. the slogan) → bake the static wordmark once; subsequent rest frames use the bitmap
    if (!allLocked && t >= subStart + SUB_DUR) bakeLocked(L, fs);
  }

  function drawWordStatic(ctx, lay, cx, cy, fs, isTitle, master) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of lay.slots)
      paintFinal(ctx, s.c, cx + s.cx, cy, fs, isTitle, FROST, (isTitle && !s.pass) ? fs * LOCK_GLOW : 0, 1, master);
  }

  return { scrambleIn, draw, get active() { return active; }, get settled() { return allLocked; } };
}
