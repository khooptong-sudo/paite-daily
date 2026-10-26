// A one-time celebration the first time a phone reaches 10, 50, 100, 250, 500 or 1000
// verified lines. app.js dispatches paite:me after every /api/me. Shown levels are kept in
// localStorage so each appears once. Reduced motion: the card only, no burst.
(() => {
  const LEVELS = [1000, 500, 250, 100, 50, 10];
  const KEY = "pd:milestones";
  const COLOURS = ["#d71920", "#f6ff00", "#00a651", "#000000"];
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };

  function burst(card) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + Math.random() * .3, d = 60 + Math.random() * 70, s = document.createElement("i");
      s.className = "ms-spark";
      s.style.cssText = `--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--s:${6 + Math.random() * 8}px;--c:${COLOURS[i % COLOURS.length]};animation-delay:${Math.random() * 120}ms`;
      card.append(s);
      s.addEventListener("animationend", () => s.remove(), { once: true });
    }
  }

  document.addEventListener("paite:me", (e) => {
    const v = (e.detail && e.detail.verified) || 0;
    const reached = LEVELS.filter((l) => v >= l);
    if (!reached.length) return;
    const seen = read();
    const fresh = reached.filter((l) => !seen.includes(l));
    if (!fresh.length) return;
    // Remember every level reached, but celebrate only the highest new one.
    try { localStorage.setItem(KEY, JSON.stringify([...seen, ...fresh])); } catch {}
    const card = document.createElement("div");
    card.className = "milestone";
    card.setAttribute("role", "status");
    const p = document.createElement("p");
    p.textContent = `${fresh[0]} lines verified. Thank you for writing Paite into the future.`;
    const b = document.createElement("button");
    b.type = "button"; b.className = "ms-close"; b.setAttribute("aria-label", "Close"); b.textContent = "\u00d7";
    b.addEventListener("click", () => card.remove());
    card.append(p, b);
    document.body.prepend(card);
    burst(card);
  });
})();
