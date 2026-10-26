// Christmas, loaded by theme.js in December only. Snow falls over the page, a string of
// lights twinkles under the shawl band, a sleigh and its reindeer cross the dark top now
// and then, and "Merry Christmas" sits at the top of the header. For people who ask for
// reduced motion the lights stay lit and nothing falls or flies.
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const make = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };

  function greeting() {
    const head = document.querySelector("body.blue main > header, body.blue .hero");
    if (head) head.prepend(make("p", "season-pill", "Merry Christmas"));
  }

  function lights() {
    const band = document.querySelector("canvas.puan-ripple, img.puan");
    if (!band) return;
    const row = make("div", "xmas-lights");
    row.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 16; i++) { const b = make("i", ""); b.style.setProperty("--d", `${(i * 0.37) % 1.6}s`); row.append(b); }
    // ripple.js puts its canvas after the image a moment later; lights go after both.
    (band.nextElementSibling?.matches("canvas.puan-ripple") ? band.nextElementSibling : band).after(row);
  }

  function snow() {
    const cv = make("canvas", "xmas-snow");
    cv.setAttribute("aria-hidden", "true");
    document.body.append(cv);
    const ctx = cv.getContext("2d");
    let W = 0, H = 0, flakes = [];
    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(90, (W * H) / 9000));
      flakes = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.6, v: 0.4 + Math.random() * 1.1, w: Math.random() * Math.PI * 2 }));
    };
    size(); addEventListener("resize", size);
    const frame = () => {
      if (!document.hidden) {
        ctx.clearRect(0, 0, W, H);
        for (const f of flakes) {
          f.y += f.v; f.w += 0.015; f.x += Math.sin(f.w) * 0.5;
          if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${0.55 + f.r / 8})`; ctx.shadowColor = "rgba(120, 140, 170, .5)"; ctx.shadowBlur = 2; ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function sleigh() {
    // Left to right, reindeer leading: Android draws the reindeer facing right.
    const s = make("div", "xmas-sleigh", "🎅🛷🦌🦌🦌");
    s.setAttribute("aria-hidden", "true");
    document.body.append(s);
    const fly = () => { if (document.hidden) return; s.classList.remove("go"); void s.offsetWidth; s.classList.add("go"); };
    setTimeout(fly, 2500);
    setInterval(fly, 22000);
  }

  const start = () => { greeting(); setTimeout(lights, 60); if (!still) { snow(); sleigh(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
