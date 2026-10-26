// Number one sparkles by itself: every few seconds the 1 on the top step squashes and
// pops (the sculpt keyframes in contributors.css) and a ring of woven-colour stars bursts
// out. Nothing to tap. Skipped for reduced motion and while the tab is hidden.
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const COLOURS = ["#f6ff00", "#00a651", "#d71920", "#ffffff", "#f6ff00"];
  function pop() {
    if (document.hidden) return;
    for (const rk of document.querySelectorAll(".p1 .rk")) {
      if (!rk.offsetParent) continue; // the other period's podium is hidden
      rk.classList.remove("pop"); void rk.offsetWidth; rk.classList.add("pop");
      const ring = rk.parentElement, n = 9;
      setTimeout(() => {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.random() * .4, d = 34 + Math.random() * 22, s = document.createElement("i");
          s.className = "spark";
          s.style.cssText = `--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d - 8}px;--s:${8 + Math.random() * 8}px;--c:${COLOURS[i % COLOURS.length]};animation-delay:${Math.random() * 80}ms`;
          ring.append(s);
          s.addEventListener("animationend", () => s.remove(), { once: true });
        }
      }, 300);
    }
  }
  setTimeout(pop, 900);
  setInterval(pop, 3600);
})();
