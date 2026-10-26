// The season, loaded in <head> so the page never flashes the wrong colour. Seasons come
// from the date: Chavang Kut from 25 October to 3 November, Christmas from 10 December to
// 1 January. ?season=kut|christmas|none previews one. There is no dark mode: the blue
// gradient is the site's look whatever the phone's setting.
(() => {
  const d = document.documentElement;
  try { localStorage.removeItem("pd:theme"); } catch {} // left by the short-lived dark switch
  const now = new Date(), m = now.getMonth() + 1, day = now.getDate();
  const asked = new URLSearchParams(location.search).get("season");
  const season = asked !== null ? asked
    : (m === 10 && day >= 25) || (m === 11 && day <= 3) ? "kut"
    : (m === 12 && day >= 10) || (m === 1 && day <= 1) ? "christmas" : "";
  if (season === "kut" || season === "christmas") d.dataset.season = season;
  const GREETING = { kut: "Happy Chavang Kut", christmas: "Merry Christmas" };

  // The greeting sits at the top of the page header.
  document.addEventListener("DOMContentLoaded", () => {
    const head = document.querySelector("body.blue main > header, body.blue .hero");
    if (!head || !GREETING[d.dataset.season]) return;
    const p = document.createElement("p");
    p.className = "season-pill"; p.textContent = GREETING[d.dataset.season];
    head.prepend(p);
  });
})();
