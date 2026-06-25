// Explicit per-section progress API — the zero-build replacement for the old window.__heroP/__domP/__connP globals.
const subs = new Map();
export function onProgress(id, fn){ if(!subs.has(id)) subs.set(id, new Set()); subs.get(id).add(fn); return () => subs.get(id)?.delete(fn); }
export function setProgress(id, p){ const s = subs.get(id); if(s) for(const fn of s) fn(p); }
