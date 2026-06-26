// STARFIELD — the orbital night sky over the dive hero, alive ONLY while the camera sits in space (descent progress ≈ 0).
// A realistic star field rather than the usual uniform blinking dots: a power-law magnitude distribution (many faint, few
// bright), real stellar colour temperatures (warm M-class → white → hot blue-white, gently brand-biased toward ice-cyan),
// per-star baked radial-glow sprites, diffraction spikes on the brightest "hero" stars, a faint Milky-Way dust band, organic
// two-frequency atmospheric scintillation, and slow parallax drift across two depth planes. The host canvas screen-blends
// (mix-blend-mode:screen in CSS) so starlight ADDS over the dark space region and washes out over the bright Earth limb —
// physically how a faint star is invisible against a sunlit planet but visible against black. Self-contained, zero-build.
//
//   createStarfield({ host, density?, reduced? }) → { setProgress(dP), start(), stop(), destroy() }
//
// setProgress(dP) is fed the descent progress: stars are full at dP=0 and fade out by FADE_END (the dive carries you past
// them); the rAF runs ONLY while they're visible, so there is zero idle cost once you've scrolled in. Scrubbing back to the
// top restores them. start() fades the field in over APPEAR_MS on first reveal.

const FADE_END = 0.045;     // descent progress at which the field is fully gone (you've dived past the stars)
const APPEAR_MS = 1200;     // first-reveal fade-in

// stellar colour palette — [r,g,b] + selection weight. Mostly white (as a real sky reads), with a warm minority and a cool
// majority tail biased toward the ARTIX ice-cyan so the field sits inside the brand without looking tinted or fake.
const PALETTE = [
  [255, 201, 158, 0.07],   // warm  — M/K class (rare)
  [255, 224, 192, 0.11],   // amber — late G
  [255, 244, 224, 0.15],   // pale gold — early G (sun-like)
  [255, 255, 255, 0.30],   // white — F/A
  [222, 236, 255, 0.20],   // cool white — A/B
  [196, 226, 252, 0.11],   // blue-white — B
  [176, 220, 255, 0.06],   // ice-cyan (brand lean)
];

function pickColor(r){
  let acc = 0; for(const p of PALETTE){ acc += p[3]; if(r <= acc) return p; } return PALETTE[3];
}

export function createStarfield({ host, density = 1, reduced = false }){
  if(!host) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'descent-stars';
  canvas.setAttribute('aria-hidden', 'true');
  // insert just ABOVE the WebGL dive canvas but below the HUD/brand (CSS z-index:1, early in DOM) so it screen-blends over
  // the dive image only — see site.css .descent-stars
  const dCanvas = host.querySelector('.descent-canvas');
  if(dCanvas && dCanvas.nextSibling) host.insertBefore(canvas, dCanvas.nextSibling);
  else host.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 1, H = 1, unit = 1;                 // device px + a viewport scale (min-dim / 900) so stars scale with the stage
  let stars = [], nebula = null;
  let raf = 0, running = false, t0 = 0, lastT = 0;
  let appear = 0;                             // first-reveal fade-in 0→1
  let vis = 1;                                // descent-progress visibility 1→0
  const rand = Math.random;

  // gaussian (Box–Muller) for the Milky-Way dust band's perpendicular scatter
  let spare = null;
  function gauss(){ if(spare !== null){ const v = spare; spare = null; return v; }
    let u = 0, v = 0, s = 0; do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u * u + v * v; } while(s === 0 || s >= 1);
    const m = Math.sqrt(-2 * Math.log(s) / s); spare = v * m; return u * m; }

  // ── star generation (normalized positions so they're resolution-independent across resizes) ──
  function build(){
    const area = (host.clientWidth * host.clientHeight) || (1440 * 900);
    const N = Math.round(Math.max(90, Math.min(280, 150 * Math.sqrt(area / (1440 * 900)) * density)));
    stars = new Array(N);
    // a soft diagonal "galactic band" — a fraction of the stars are extra-faint dust clustered along this axis (Milky-Way feel)
    const bandAng = -0.34, ca = Math.cos(bandAng), sa = Math.sin(bandAng);   // band axis ≈ -20°, upper diagonal (away from the low-right Earth)
    for(let i = 0; i < N; i++){
      const dust = rand() < 0.34;
      let x, y;
      if(dust){
        const t = rand() - 0.5;                                   // position ALONG the band
        const off = gauss() * 0.12;                               // gaussian scatter PERPENDICULAR to it
        x = 0.46 + t * ca - off * sa;                             // band centred a touch above mid-frame
        y = 0.40 + t * sa + off * ca;
      } else { x = rand(); y = rand(); }
      // magnitude: power-law toward faint. Dust stars are fainter still.
      let mag = Math.pow(rand(), dust ? 3.4 : 2.3);
      const col = pickColor(rand());
      const layer = rand() < 0.34 ? 1 : 0;                        // 0 = far (slow), 1 = near (faster) parallax plane
      const twinkles = rand() < 0.72;                             // ~28% of stars burn steady (realistic — not everything scintillates)
      const period = 1.4 + rand() * 3.1;                          // 1.4–4.5 s
      stars[i] = {
        x, y, layer,
        mag,
        col: [col[0], col[1], col[2]],
        baseA: 0.30 + 0.70 * Math.pow(mag, 0.7),                  // faint stars genuinely dim
        twAmp: twinkles ? (0.12 + 0.46 * mag) : 0,                // brighter stars scintillate more visibly
        tws: (Math.PI * 2) / period, tph: rand() * 7, tph2: rand() * 7,
        hero: false, sprite: null, half: 0,
        // drift: very slow celestial creep — near plane a touch quicker; mostly lateral, slight rise as we descend
        dx: (layer ? 0.0092 : 0.0042) * (rand() < 0.5 ? 1 : 0.7),
        dy: (layer ? -0.0036 : -0.0016),
      };
    }
    // promote the few brightest to "hero" stars (diffraction spikes + bigger bloom) — the detail that sells "real telescope sky"
    const order = stars.slice().sort((a, b) => b.mag - a.mag);
    for(let i = 0; i < Math.min(5, order.length); i++){ order[i].hero = true; order[i].twAmp = Math.min(order[i].twAmp, 0.34); }   // calm the brightest — big stars shouldn't strobe
  }

  // ── per-star sprite bake (device px; re-baked on resize so stars scale with the viewport and stay crisp on HiDPI) ──
  function bakeStar(s){
    const r = (s.hero ? 1.7 : 0.5 + 1.4 * s.mag) * unit * dpr;   // core radius
    const glow = (s.hero ? 5.0 : 3.2) * r;
    const spike = s.hero ? 9.5 * r : 0;
    const half = Math.ceil(Math.max(glow, spike) + 2);
    const cv = document.createElement('canvas'); cv.width = cv.height = half * 2;
    const g = cv.getContext('2d'); const cx = half, cy = half;
    const cc = s.col[0] + ',' + s.col[1] + ',' + s.col[2];
    // a real star's core reads WHITE (blown-out brightness); the TINT lives in the halo → mix 60% toward white for the core
    const wc = Math.round(s.col[0] * 0.4 + 153) + ',' + Math.round(s.col[1] * 0.4 + 153) + ',' + Math.round(s.col[2] * 0.4 + 153);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, glow);
    grad.addColorStop(0, 'rgba(' + wc + ',1)');
    grad.addColorStop(0.16, 'rgba(' + cc + ',0.82)');
    grad.addColorStop(0.40, 'rgba(' + cc + ',0.20)');
    grad.addColorStop(1, 'rgba(' + cc + ',0)');
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, glow, 0, 7); g.fill();
    g.fillStyle = 'rgba(' + wc + ',1)'; g.beginPath(); g.arc(cx, cy, Math.max(0.6, r * 0.62), 0, 7); g.fill();   // crisp pin core
    if(s.hero){
      g.lineCap = 'round';
      const axes = [[1, 0, 1], [0, 1, 1], [0.7071, 0.7071, 0.42], [0.7071, -0.7071, 0.42]];   // 4-point cross + a fainter diagonal pair
      for(const [ux, uy, a] of axes){
        const x0 = cx - ux * spike, y0 = cy - uy * spike, x1 = cx + ux * spike, y1 = cy + uy * spike;
        const lg = g.createLinearGradient(x0, y0, x1, y1);
        lg.addColorStop(0, 'rgba(' + cc + ',0)');
        lg.addColorStop(0.5, 'rgba(' + wc + ',' + (0.5 * a).toFixed(3) + ')');
        lg.addColorStop(1, 'rgba(' + cc + ',0)');
        g.strokeStyle = lg; g.lineWidth = Math.max(1, r * 0.45); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }
    s.sprite = cv; s.half = half;
  }

  // ── faint nebula / galactic-haze underlay, baked once per size (a soft cool glow along the band so the black is never dead-flat) ──
  function bakeNebula(){
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const blob = (cxN, cyN, rN, rgb, a) => {
      const x = cxN * W, y = cyN * H, rr = rN * Math.max(W, H);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    };
    blob(0.30, 0.30, 0.55, '120,150,190', 0.05);    // cool upper-left haze
    blob(0.62, 0.20, 0.40, '90,120,160', 0.035);     // secondary, dimmer
    nebula = cv;
  }

  function resize(){
    const r = host.getBoundingClientRect();
    const cssW = Math.max(1, r.width), cssH = Math.max(1, r.height);
    W = Math.round(cssW * dpr); H = Math.round(cssH * dpr);
    canvas.width = W; canvas.height = H;
    unit = Math.min(W, H) / (900 * dpr);             // viewport scale (1 ≈ a 900px-tall stage); keeps stars proportionate
    for(const s of stars) bakeStar(s);
    bakeNebula();
  }

  function paint(now){
    const t = (now - t0) / 1000;
    if(lastT){ const dt = Math.min(0.05, (now - lastT) / 1000);     // clamp dt so a tab-stall doesn't teleport the drift
      for(const s of stars){ s.x += s.dx * dt; s.y += s.dy * dt;
        if(s.x > 1.04) s.x -= 1.08; else if(s.x < -0.04) s.x += 1.08;
        if(s.y > 1.04) s.y -= 1.08; else if(s.y < -0.04) s.y += 1.08; } }
    lastT = now;
    const F = appear * vis;                                          // effective field opacity
    ctx.clearRect(0, 0, W, H);
    if(F <= 0.001) return;
    if(nebula){ ctx.globalAlpha = F * 0.85; ctx.drawImage(nebula, 0, 0); }
    ctx.globalCompositeOperation = 'lighter';                        // starlight ADDS — overlapping halos bloom realistically
    for(const s of stars){
      let tw = 1;
      if(s.twAmp){ const f1 = 0.5 + 0.5 * Math.sin(t * s.tws + s.tph);
        const f2 = 0.5 + 0.5 * Math.sin(t * s.tws * 1.7 + s.tph2);
        tw = 1 - s.twAmp * (f1 * 0.7 + f2 * 0.3); }                  // two summed frequencies → organic, non-uniform scintillation
      ctx.globalAlpha = Math.max(0, s.baseA * tw * F);
      ctx.drawImage(s.sprite, s.x * W - s.half, s.y * H - s.half);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function loop(now){
    if(!t0) t0 = now;
    if(appear < 1) appear = Math.min(1, (now - t0) / APPEAR_MS);
    const e = appear < 1 ? (appear * appear * (3 - 2 * appear)) : 1; // smoothstep the fade-in
    const savedAppear = appear; appear = e;
    paint(now);
    appear = savedAppear;
    // keep running while visible OR still fading in; once fully gone (scrolled into the dive) stop to spend nothing at rest
    if(running && (vis > 0.001 || appear < 1)) raf = requestAnimationFrame(loop);
    else { raf = 0; }
  }

  let ro = null;
  function start(){
    if(reduced){ resize(); appear = 1; vis = 1; lastT = 0; t0 = performance.now(); paint(performance.now()); return; }   // reduced-motion: a still, calm sky (no drift/twinkle loop)
    if(running) return; running = true; t0 = 0; lastT = 0;
    if(!raf) raf = requestAnimationFrame(loop);
  }
  function stop(){ running = false; if(raf){ cancelAnimationFrame(raf); raf = 0; } }

  function setProgress(dP){
    const v = Math.max(0, Math.min(1, 1 - dP / FADE_END));
    if(v === vis) return; vis = v;
    if(reduced){ paint(performance.now()); return; }
    if(vis > 0.001 && running && !raf) raf = requestAnimationFrame(loop);   // scrubbed back up → wake the loop
  }

  build();
  resize();
  try { ro = new ResizeObserver(() => resize()); ro.observe(host); } catch(e){ window.addEventListener('resize', resize, { passive: true }); }

  return {
    setProgress, start, stop,
    destroy(){ stop(); try { ro && ro.disconnect(); } catch(e){} window.removeEventListener('resize', resize);
      stars = []; nebula = null; try { canvas.remove(); } catch(e){} }
  };
}
