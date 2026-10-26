// Light or charcoal dark, and the season. Loaded in <head> so the page never flashes the
// wrong colour. Dark follows the phone's setting until someone taps the switch in the
// footer, which is then remembered. Seasons come from the date: Chavang Kut from 25 October
// to 3 November, Christmas from 10 December to 1 January. ?season=kut|christmas|none
// previews one.
(() => {
  const d = document.documentElement;
  const get = () => { try { return localStorage.getItem("pd:theme"); } catch { return null; } };
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => { const p = get(); d.dataset.theme = (p ? p === "dark" : media.matches) ? "dark" : "light"; };
  apply();
  media.addEventListener("change", () => { if (!get()) apply(); });

  const now = new Date(), m = now.getMonth() + 1, day = now.getDate();
  const asked = new URLSearchParams(location.search).get("season");
  const season = asked !== null ? asked
    : (m === 10 && day >= 25) || (m === 11 && day <= 3) ? "kut"
    : (m === 12 && day >= 10) || (m === 1 && day <= 1) ? "christmas" : "";
  if (season === "kut" || season === "christmas") d.dataset.season = season;
  const GREETING = { kut: "Happy Chavang Kut", christmas: "Merry Christmas" };

  document.addEventListener("DOMContentLoaded", () => {
    // The greeting sits at the top of the page header.
    const head = document.querySelector("body.blue main > header, body.blue .hero");
    if (head && GREETING[d.dataset.season]) {
      const p = document.createElement("p");
      p.className = "season-pill"; p.textContent = GREETING[d.dataset.season];
      head.prepend(p);
    }
    // The switch, beside About This Project in the footer.
    const built = document.querySelector(".foot .built");
    if (!built) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "theme-toggle";
    const label = () => { b.textContent = d.dataset.theme === "dark" ? "Light mode" : "Dark mode"; };
    label();
    b.addEventListener("click", () => {
      const next = d.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem("pd:theme", next); } catch {}
      apply(); label();
    });
    built.append(" · ", b);
  });
})();
