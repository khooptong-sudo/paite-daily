// The season, loaded in <head> so the page never flashes the wrong colour. The site is the
// blue gradient all year except December (1 Dec 00:00 to 31 Dec 23:59, phone time), when it turns to Christmas: reds,
// snow, twinkling lights and a sleigh across the top (christmas.js, loaded only then).
// ?season=christmas previews it any day; ?season=none shows the blue.
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
