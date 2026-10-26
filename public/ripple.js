// Water ripple on the liangbat band. A finger or the pointer drops rings into the weave
// and they spread and fade; now and then one falls on its own. The band is redrawn on a
// canvas over the same box, and the <img> stays in the page for its alt text and as the
// fallback. Nothing runs for people who ask for reduced motion, and the loop sleeps when
// the water is still or the band is off screen.
(() => {
  const img = document.querySelector("img.puan");
  if (!img || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const CELL = 2, DAMP = 0.965, CALM = 0.05;
  function start() {
    const w = img.clientWidth, h = img.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(w * dpr), H = Math.round(h * dpr);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H; cv.className = "puan puan-ripple"; cv.setAttribute("aria-hidden", "true");
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    let src;
    try { src = ctx.getImageData(0, 0, W, H).data; } catch { return; }
    const out = ctx.createImageData(W, H), o = out.data;

    // Height field on a coarse grid, two buffers swapped each frame.
    const gw = Math.ceil(w / CELL) + 2, gh = Math.ceil(h / CELL) + 2;
    let cur = new Float32Array(gw * gh), prev = new Float32Array(gw * gh);

    (img.closest("picture") || img).after(cv); // after the <picture>, so it sits where the band was
    img.classList.add("puan-under");

    let running = false, visible = true;
    const drop = (x, y, r = 3, power = 220) => {
      const cx = Math.round(x / CELL) + 1, cy = Math.round(y / CELL) + 1;
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const d = Math.hypot(i, j);
        if (d > r) continue;
        const gx = cx + i, gy = cy + j;
        if (gx > 0 && gy > 0 && gx < gw - 1 && gy < gh - 1) cur[gy * gw + gx] += power * Math.cos((d / r) * Math.PI / 2);
      }
      if (!running && visible) { running = true; requestAnimationFrame(frame); }
    };

    function frame() {
      let energy = 0;
      for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
        const k = y * gw + x;
        const v = ((cur[k - 1] + cur[k + 1] + cur[k - gw] + cur[k + gw]) / 2 - prev[k]) * DAMP;
        prev[k] = v;
        energy += Math.abs(v);
      }
      [cur, prev] = [prev, cur];

      // Bend the weave by the slope of the water, and catch a little light on the crests.
      for (let py = 0; py < H; py++) {
        const gy = Math.min(gh - 2, Math.max(1, Math.round(py / dpr / CELL) + 1));
        for (let px = 0; px < W; px++) {
          const gx = Math.min(gw - 2, Math.max(1, Math.round(px / dpr / CELL) + 1)), k = gy * gw + gx;
          const dx = cur[k - 1] - cur[k + 1], dy = cur[k - gw] - cur[k + gw];
          const sx = Math.min(W - 1, Math.max(0, px + Math.round(dx * dpr * 0.12)));
          const sy = Math.min(H - 1, Math.max(0, py + Math.round(dy * dpr * 0.12)));
          const s = (sy * W + sx) * 4, t = (py * W + px) * 4, shine = dx * 0.35;
          o[t] = src[s] + shine; o[t + 1] = src[s + 1] + shine; o[t + 2] = src[s + 2] + shine; o[t + 3] = src[s + 3];
        }
      }
      ctx.putImageData(out, 0, 0);
      if (energy / (gw * gh) > CALM && visible) requestAnimationFrame(frame);
      else { running = false; if (!visible) return; cur.fill(0); prev.fill(0); ctx.putImageData(new ImageData(new Uint8ClampedArray(src), W, H), 0, 0); }
    }

    const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (w / r.width), (e.clientY - r.top) * (h / r.height)]; };
    let last = 0;
    cv.addEventListener("pointermove", (e) => { const now = performance.now(); if (now - last < 40) return; last = now; const [x, y] = at(e); drop(x, y, 2, 90); });
    cv.addEventListener("pointerdown", (e) => { const [x, y] = at(e); drop(x, y, 4, 380); });

    // A drop on its own every few seconds while the band is in view.
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !running) drop(Math.random() * w, Math.random() * h); }).observe(cv);
    setInterval(() => { if (visible && !document.hidden) drop(Math.random() * w, Math.random() * h, 3, 160); }, 4200);
  }
  if (img.complete && img.naturalWidth) start(); else img.addEventListener("load", start, { once: true });
})();
