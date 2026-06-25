// BENTO CARDS (Stage 4) — poster always present; muted/loop/playsinline video in data-src, lazy-loaded near viewport via IO,
// opacity-crossfaded on hover/focus; cold --grade on BOTH poster+video; FRAME NEVER MOVES. Reduced-motion = poster only.
let io;
export function init(){ /* Stage 4: IO lazy-load + crossfade. */ }
export function cleanup(){ io?.disconnect(); }
