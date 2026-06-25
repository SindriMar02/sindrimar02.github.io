// Homepage intro — an orbital descent that lands on the cinematic's first frame, with a lock-on targeting HUD.
// Plays once per session, after the loader, scroll locked. Reduced-motion / repeat visit / autoplay-blocked => skipped
// instantly into the site. The video's last frame == story frame-0001, so when the overlay fades the cinematic is already there.
import { scramble } from '/js/scramble.js';
const COORD = '64.32°N 22.08°W';
let el, video, ticker, finished = false;
function lockScroll(on){ document.documentElement.style.overflow = on ? 'hidden' : ''; }
function reveal(){ document.dispatchEvent(new CustomEvent('artix:reveal')); }
function finish(){
  if(finished) return; finished = true;
  if(ticker){ clearInterval(ticker); ticker = null; }
  lockScroll(false);
  if(el) el.classList.add('is-done');
  reveal();
  try { video && video.pause(); } catch(e){}
  setTimeout(() => { el && el.remove(); el = null; }, 950);
}
function lock(){
  if(!el || el.classList.contains('is-locked')) return;
  el.classList.add('is-locked');
  const status = el.querySelector('.ic-status'); if(status) status.textContent = 'LOCK';
  const val = el.querySelector('.ic-val'); if(val){ val.textContent = COORD; scramble(val, { duration: 720 }); }
}
export function init(){
  el = document.querySelector('[data-intro]'); if(!el) return;
  video = el.querySelector('.intro-video');
  const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  let seen = false; try { seen = !!sessionStorage.getItem('artix-intro'); } catch(e){}
  // ?intro in the URL forces a replay (review affordance) — bypasses the once-per-session gate
  let force = false; try { force = new URLSearchParams(location.search).has('intro'); } catch(e){}
  if(reduce || (seen && !force) || !video){ el.remove(); el = null; reveal(); return; }
  try { sessionStorage.setItem('artix-intro', '1'); } catch(e){}
  lockScroll(true);
  el.querySelector('.intro-skip')?.addEventListener('click', finish);
  // "acquiring" coordinate ticker until lock
  const val = el.querySelector('.ic-val');
  const rnd = () => (Math.random() * 88 + 1).toFixed(2);
  ticker = setInterval(() => { if(val && el && !el.classList.contains('is-locked')) val.textContent = rnd() + '°N ' + rnd() + '°W'; }, 80);
  const start = () => {
    if(finished || !el) return;
    lockScroll(true);   // the loader clears overflow when it finishes — re-lock for the descent
    el.classList.add('is-playing');
    video.addEventListener('timeupdate', () => { if(video.duration && video.currentTime / video.duration >= 0.8) lock(); });
    video.addEventListener('ended', finish);
    const p = video.play();
    if(p && p.catch) p.catch(() => finish());   // autoplay blocked → straight into the site
    setTimeout(finish, 13000);                   // safety net if 'ended' never fires
  };
  if(document.querySelector('.boot')) document.addEventListener('artix:booted', start, { once: true });
  else start();
}
export function cleanup(){ if(ticker){ clearInterval(ticker); ticker = null; } }
