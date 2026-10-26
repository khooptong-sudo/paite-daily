// The season, loaded in <head> so the page never flashes the wrong colour. The site is the
// blue gradient all year except December to 1 January, when it turns to Christmas: reds,
// snow, twinkling lights and a sleigh across the top (christmas.js, loaded only then).
// ?season=christmas previews it any day; ?season=none shows the blue.
(() => {
  const d = document.documentElement;
  try { localStorage.removeItem("pd:theme"); } catch {} // left by the short-lived dark switch
  const now = new Date(), m = now.getMonth() + 1, day = now.getDate();
  const asked = new URLSearchParams(location.search).get("season");
  const season = asked !== null ? asked : m === 12 || (m === 1 && day === 1) ? "christmas" : "";
  if (season !== "christmas") return;
  d.dataset.season = "christmas";
  const s = document.createElement("script");
  s.src = "/christmas.js"; s.defer = true;
  document.head.append(s);
})();
