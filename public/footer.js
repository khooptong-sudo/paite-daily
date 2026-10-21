// Footer coffee button: phones follow the UPI link; desktop opens the QR panel instead.
(() => {
  const a = document.getElementById("coffee"), p = document.getElementById("upi");
  if (!a || !p) return;
  a.addEventListener("click", (e) => {
    if (matchMedia("(pointer: coarse), (max-width: 640px)").matches) return;
    e.preventDefault();
    p.hidden = !p.hidden;
    a.setAttribute("aria-expanded", String(!p.hidden));
  });
  document.getElementById("upi-copy").addEventListener("click", async () => {
    const id = document.getElementById("upi-id");
    try { await navigator.clipboard.writeText(id.textContent); } catch {
      const r = document.createRange(); r.selectNodeContents(id);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  });
})();

// Footer waveform: a few thin sine lines drift slowly across the charcoal band, their
// colour sliding round the hue wheel. The canvas is stretched to the viewport's client
// width (no scrollbar), so it never adds sideways scroll. It only animates while the
// band is on screen, and holds one still frame for people who ask for reduced motion.
(() => {
  const c = document.querySelector(".foot .wave");
  if (!c || !c.getContext) return;
  const g = c.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, raf = 0, shown = false;
  const size = () => {
    const d = Math.min(devicePixelRatio || 1, 2), band = c.parentNode.getBoundingClientRect();
    w = document.documentElement.clientWidth; h = band.height - 8;
    c.style.left = -band.left + "px"; c.style.width = w + "px";
    c.width = w * d; c.height = h * d; g.setTransform(d, 0, 0, d, 0, 0);
  };
  // Every page load rolls its own set of lines: each is a sum of three sines with random
  // wavelength, height, drift speed and direction, and its height swells and settles on its
  // own slow clock. So no two visits draw the same water.
  const rnd = (a, b) => a + Math.random() * (b - a);
  const lines = Array.from({ length: 6 }, () => ({
    base: rnd(.35, .8), hue: rnd(0, 360), breathe: rnd(.05, .15), phase: rnd(0, 6.3), width: rnd(.8, 1.8),
    parts: Array.from({ length: 3 }, (_, i) => ({ amp: rnd(.03, .13) / (i + 1), freq: rnd(.002, .006) * (i + 1), speed: rnd(.08, .35) * (Math.random() < .5 ? -1 : 1), phase: rnd(0, 6.3) })),
  }));
  const draw = (t) => {
    const s = t / 1000;
    g.clearRect(0, 0, w, h);
    for (const L of lines) {
      const swell = .6 + .4 * Math.sin(s * L.breathe + L.phase);
      const grad = g.createLinearGradient(0, 0, w, 0);
      for (let i = 0; i <= 4; i++) grad.addColorStop(i / 4, `hsla(${(L.hue + s * 8 + i * 75) % 360}, 90%, 64%, .3)`);
      g.strokeStyle = grad; g.lineWidth = L.width;
      g.beginPath();
      for (let x = 0; x <= w + 6; x += 6) {
        let y = h * L.base;
        for (const p of L.parts) y += Math.sin(x * p.freq + s * p.speed + p.phase) * p.amp * h * swell;
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
  };
  const loop = (t) => { draw(t); raf = shown ? requestAnimationFrame(loop) : 0; };
  size();
  draw(0);
  // Watch the page box, not the window: phones rotate and zoom without a resize event.
  const redo = () => { size(); draw(performance.now()); };
  if ("ResizeObserver" in window) new ResizeObserver(redo).observe(document.documentElement);
  else addEventListener("resize", redo);
  if (still || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(([e]) => {
    shown = e.isIntersecting;
    if (shown && !raf) raf = requestAnimationFrame(loop);
  }).observe(c.parentNode);
})();
