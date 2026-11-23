// The season, loaded in <head> so the page never flashes the wrong colour. The site is the
// blue gradient all year except December (1 Dec 00:00 to 31 Dec 23:59, phone time), when it turns to Christmas: reds,
// snow, twinkling lights and a sleigh across the top (christmas.js, loaded only then).
// ?season=christmas previews it any day; ?season=none shows the blue.
// Light or dark: the page follows the phone's own setting (light "paper" or dark "ink"), and
// changes with it if the phone switches at sunset. The sun / moon switch in the header overrides
// it and remembers the choice on this device; switching back to what the phone shows forgets the
// choice, so the page follows the phone again. ?theme=light or ?theme=dark previews either.
(() => {
  const d = document.documentElement, KEY = "pd:mode";
  const asked = new URLSearchParams(location.search).get("theme");
  let mq = null;
  try { mq = matchMedia("(prefers-color-scheme: dark)"); } catch {}
  const phone = () => (mq && mq.matches ? "dark" : "light");
  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const pick = () => asked || saved() || phone();
  // The phone's top bar matches the page: paper by day, ink at night.
  const bar = () => {
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.append(m); }
    m.content = d.dataset.theme === "light" ? "#f5f1e8" : "#0c0b0a";
  };
  let onChange = () => {};
  const apply = (mode) => {
    if (mode === "dark") delete d.dataset.theme; else d.dataset.theme = "light";
    bar(); onChange();
  };
  apply(pick());
  if (mq) {
    const follow = () => { if (!asked && !saved()) apply(phone()); };
    if (mq.addEventListener) mq.addEventListener("change", follow); else if (mq.addListener) mq.addListener(follow);
  }
  const ICON = '<svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>'
    + '<svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  addEventListener("DOMContentLoaded", () => {
    const spot = document.querySelector(".hdr-links") || document.querySelector(".hero-nav") || document.querySelector("main > header");
    if (!spot) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "theme-toggle"; b.innerHTML = ICON;
    const label = () => { const light = d.dataset.theme === "light"; b.setAttribute("aria-label", light ? "Switch to dark" : "Switch to light"); b.title = b.getAttribute("aria-label"); };
    label();
    onChange = label;
    b.addEventListener("click", () => {
      const mode = d.dataset.theme === "light" ? "dark" : "light";
      try { if (mode === phone()) localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch {}
      apply(mode);
    });
    spot.append(b);
  });
})();
(() => {
  const d = document.documentElement;
  try { localStorage.removeItem("pd:theme"); } catch {} // left by the short-lived dark switch
  const m = new Date().getMonth() + 1;
  const asked = new URLSearchParams(location.search).get("season");
  const season = asked !== null ? asked : m === 12 ? "christmas" : "";
  if (season !== "christmas") return;
  d.dataset.season = "christmas";
  const s = document.createElement("script");
  s.src = "/christmas.js"; s.defer = true;
  document.head.append(s);
})();
