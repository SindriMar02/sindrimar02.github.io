// Per-page bootstrapper + View-Transition focus management + bfcache safety. No library — hand-rolled vanilla.
export function mount(modules){
  document.documentElement.classList.add('js');   // fail-open: CSS only hides reveals once JS is confirmed
  let mounted = false;
  const run = () => { if(mounted) return; mounted = true; modules.forEach(m => m.init && m.init()); if(typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh(); focusMain(); };
  const tear = () => { if(!mounted) return; mounted = false; modules.forEach(m => m.cleanup && m.cleanup()); };
  if(document.readyState !== 'loading') run(); else document.addEventListener('DOMContentLoaded', run);
  window.addEventListener('pageshow', (e) => { if(e.persisted) run(); });   // re-init on bfcache restore
  window.addEventListener('pagehide', tear);
}
// Land keyboard/SR focus on content (not the floating masthead) after a cross-document navigation.
function focusMain(){
  if(document.querySelector(':target')) return;
  const m = document.getElementById('main');
  if(m){ m.setAttribute('tabindex','-1'); m.focus({ preventScroll:true }); }
}
