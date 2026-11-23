// Play buttons for the recordings: <button class="play" data-audio="<id>">. One clip at a time.
(() => {
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/></svg>';
  let audio = null, btn = null;
  const idle = (b) => { b.innerHTML = PLAY; b.setAttribute("aria-label", "Listen"); b.classList.remove("on"); };
  const stop = () => {
    if (audio) { audio.onended = audio.onerror = null; audio.pause(); }
    if (btn) idle(btn);
    audio = btn = null;
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button.play[data-audio]");
    if (!b) return;
    const same = b === btn;
    stop();
    if (same) return;
    const a = new Audio("/audio/" + encodeURIComponent(b.dataset.audio));
    audio = a; btn = b;
    b.innerHTML = STOP; b.setAttribute("aria-label", "Stop"); b.classList.add("on");
    a.onended = a.onerror = () => { if (audio === a) stop(); };
    a.play().catch(() => { if (audio === a) stop(); });
  });
  const init = () => document.querySelectorAll("button.play[data-audio]:empty").forEach(idle);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.pdPlayInit = init;
})();
