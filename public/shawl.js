// The community shawl: the goal drawn as one BA / Siamsin Puan that everyone weaves together.
// BA / Siamsin Puan is the shawl given to learners who achieve something, so the corpus wears it.
// Every verified sentence is one thread; the shawl is woven along its length from the left,
// twenty threads to a pass, until the goal is reached. Colours are paite.org's recommended codes
// for Siamsin Puan (blue #1725d4, magenta #ec008c, green #00a651, black); the stripe order across
// the cloth follows the real shawl: broad magenta bands edged green then blue, on black, with a
// thin white pick line dotted in colour running through the black between them.
// The numbers come from the goal's progressbar (aria-valuenow / aria-valuemax), filled by app.js
// on the front page and by the server on Panlate. It weaves in once when it comes into view,
// holds still for people who ask for reduced motion, and redraws when the theme changes.
(() => {
  const c = document.querySelector("canvas.kp"), bar = document.querySelector(".goal-bar[role=progressbar]");
  if (!c || !bar || !c.getContext) return;
  const g = c.getContext("2d"), tip = document.querySelector(".kp-tip");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const BLUE = "#1725d4", PINK = "#ec008c", GREEN = "#00a651", BLACK = "#0b0b0c";
  // Across the cloth, top to bottom: [colour, weight]. "pick" is the dotted white line.
  const SETT = [[BLACK, 3], [BLUE, .45], [GREEN, .45], [PINK, 4.2], [GREEN, .45], [BLUE, .45], [BLACK, 2.3], ["pick", .55], [BLACK, 2.3],
    [BLUE, .45], [GREEN, .45], [PINK, 4.2], [GREEN, .45], [BLUE, .45], [BLACK, 3]];
  const TOTAL = SETT.reduce((s, [, w]) => s + w, 0), PASS = 20;
  let W = 0, H = 0, done = 0, goal = 0, shown = 0, t0 = 0, raf = 0, seen = false;

  const light = () => document.documentElement.dataset.theme === "light";
  function size() {
    const d = Math.min(devicePixelRatio || 1, 2), r = c.getBoundingClientRect();
    W = r.width; H = r.height; c.width = Math.max(1, W * d); c.height = Math.max(1, H * d); g.setTransform(d, 0, 0, d, 0, 0);
  }
  function draw(n) {
    const cols = Math.max(1, Math.ceil(goal / PASS)), cw = W / cols, wovenX = (n / goal) * W;
    // Bare warp: the loom before the weft goes in.
    g.fillStyle = light() ? "#ebe5d8" : "#1b1917"; g.fillRect(0, 0, W, H);
    g.fillStyle = light() ? "rgba(21,18,15,.10)" : "rgba(244,241,234,.08)";
    for (let x = 0; x < cols; x++) g.fillRect(x * cw + cw * .45, 0, Math.max(.6, cw * .12), H);
    if (n <= 0) return;
    g.save(); g.beginPath(); g.rect(0, 0, wovenX, H); g.clip();
    let y = 0;
    for (const [col, w] of SETT) {
      const h = (w / TOTAL) * H;
      if (col === "pick") {
        g.fillStyle = BLACK; g.fillRect(0, y, W, h);
        const ly = y + h * .3, lh = Math.max(1, h * .4);
        g.fillStyle = "#f4f1ea"; g.fillRect(0, ly, W, lh);
        // The small coloured dashes woven into the pick line.
        const step = Math.max(10, H * .09), dots = [PINK, GREEN, BLUE];
        for (let x = 4, i = 0; x < W; x += step, i++) { g.fillStyle = dots[i % 3]; g.fillRect(x, ly, step * .32, lh); }
      } else { g.fillStyle = col; g.fillRect(0, y, W, Math.ceil(h) + .5); }
      y += h;
    }
    // Twill: fine diagonal shadow, so it reads as cloth.
    g.strokeStyle = "rgba(0,0,0,.16)"; g.lineWidth = 1; g.beginPath();
    for (let k = -H; k < wovenX; k += 4) { g.moveTo(k, 0); g.lineTo(k + H, H); } g.stroke();
    g.restore();
    // The shuttle at the edge of the work.
    if (n < goal) {
      const grd = g.createLinearGradient(wovenX - 26, 0, wovenX + 4, 0);
      grd.addColorStop(0, "rgba(255,255,255,0)"); grd.addColorStop(1, "rgba(255,226,240,.55)");
      g.fillStyle = grd; g.fillRect(wovenX - 26, 0, 30, H);
    }
  }
  const frame = (t) => {
    const p = Math.min(1, (t - t0) / 2600), e = 1 - Math.pow(1 - p, 3);
    shown = Math.round(done * e); draw(shown);
    raf = p < 1 ? requestAnimationFrame(frame) : 0;
  };
  function start() {
    done = +bar.getAttribute("aria-valuenow") || 0; goal = +bar.getAttribute("aria-valuemax") || 0;
    if (!goal) return;
    size();
    if (still || seen) { shown = done; draw(done); return; }
    seen = true; t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  // Wait until the numbers are in and the shawl is on screen.
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver(([e]) => { if (e.isIntersecting && bar.getAttribute("aria-valuemax")) { io.disconnect(); start(); } })
    : null;
  const watch = () => { if (io) io.observe(c); else start(); };
  if (bar.getAttribute("aria-valuemax")) watch();
  else new MutationObserver((_, o) => { if (bar.getAttribute("aria-valuemax")) { o.disconnect(); watch(); } }).observe(bar, { attributes: true });
  addEventListener("resize", () => { if (goal) { size(); draw(shown); } });
  new MutationObserver(() => { if (goal) draw(shown); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Hover: which thread is under the pointer.
  if (tip) {
    c.addEventListener("pointermove", (e) => {
      if (!goal) return;
      const r = c.getBoundingClientRect(), cols = Math.ceil(goal / PASS), x = Math.floor(((e.clientX - r.left) / r.width) * cols), y = Math.floor(((e.clientY - r.top) / r.height) * PASS);
      const i = Math.min(goal, x * PASS + y + 1);
      tip.textContent = i <= shown ? `Thread ${i.toLocaleString("en")}` : `Thread ${i.toLocaleString("en")} · not woven yet`;
      tip.style.left = (e.clientX - r.left) + "px"; tip.style.top = (e.clientY - r.top) + "px"; tip.hidden = false;
    });
    c.addEventListener("pointerleave", () => { tip.hidden = true; });
  }
})();
