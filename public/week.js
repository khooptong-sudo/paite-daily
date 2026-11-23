// Your Work, on the front page: the streak and the last seven days in one line, the list of lines a
// reviewer corrected for you, and (as a fallback for the card's Share chip) a 1080 x 1920 week card.
// Hidden until there is something to show; mypuan.js draws the shawl and owns the Share click.
(() => {
  const card = document.getElementById("yourwork");
  if (!card) return;
  let w = null, streak = 0;
  // Share draws the shawl or, without one, the week card: hide it when there is neither.
  const ywShow = () => {
    const y = document.getElementById("yourwork"), on = (i) => !document.getElementById(i).hidden;
    if (!y) return;
    y.hidden = !["week-line", "mypuan", "yw-fixed"].some(on);
    document.getElementById("yw-share").hidden = !(on("mypuan") || window.ywWeek);
  };
  const line = () => `${w.sent} sent · ${w.verified} verified · ${w.words} words` + (w.rank ? ` · #${w.rank} this week` : "");
  const show = () => {
    const parts = [];
    if (streak >= 2) parts.push(`${streak} days in a row`);
    if (w && w.sent > 0) parts.push("This week: " + line());
    const el = document.getElementById("week-line");
    el.textContent = parts.join(" · "); el.hidden = !parts.length;
    ywShow();
  };
  // app.js sets paiteApi once it has a session helper; wait for it, but not forever.
  let tries = 0;
  const ready = () => window.paiteApi ? load() : ++tries < 30 && setTimeout(ready, 300);
  async function load() {
    try {
      const r = await window.paiteApi("/api/week");
      if (!r.ok) return;
      w = await r.json();
      if (w.sent > 0) window.ywWeek = w;
      show();
    } catch {}
  }
  ready();
  document.addEventListener("paite:me", (e) => { streak = e.detail.streak || 0; show(); });
  // Corrected for You: the newest three corrections, built with textContent only.
  document.addEventListener("paite:feedback", (e) => {
    const items = (e.detail || []).filter((i) => (i.result === "fixed" || i.result === "other") && i.corrected).sort((a, b) => b.reviewId - a.reviewId).slice(0, 3);
    const ul = document.getElementById("yw-fixed-list");
    ul.textContent = "";
    const row = (cls, label, node) => {
      const d = document.createElement("div"); d.className = cls;
      if (label) { const l = document.createElement("small"); l.textContent = label; d.append(l, " "); }
      d.append(node); return d;
    };
    for (const it of items) {
      const li = document.createElement("li"), m = document.createElement("mark");
      m.textContent = it.corrected;
      li.append(row("en", null, it.english || ""), row("", "Yours", it.yours || ""), row("", "Corrected", m));
      if (it.reviewer) li.append(row("", null, "— " + it.reviewer));
      ul.append(li);
    }
    document.getElementById("yw-fixed").hidden = !items.length;
    ywShow();
  });
  window.ywWeekShare = () => share().catch(() => {});
  async function share() {
    await document.fonts.ready;
    const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
    const g = c.getContext("2d"), css = getComputedStyle(document.documentElement);
    const display = css.getPropertyValue("--display"), body = css.getPropertyValue("--body");
    // The site's own colours: near-black at the top deepening into blue, white type.
    const sky = g.createLinearGradient(0, 0, 0, 1920);
    sky.addColorStop(0, "#020617"); sky.addColorStop(0.3, "#0a2a8a"); sky.addColorStop(0.75, "#0b4bff"); sky.addColorStop(1, "#5b8cff");
    g.fillStyle = sky; g.fillRect(0, 0, 1080, 1920);
    g.textAlign = "center"; g.fillStyle = "#c9d6ff"; g.font = `700 40px ${body}`;
    g.fillText("PAITE DAILY · MY WEEK", 540, 300);
    const rows = [["sent", w.sent], ["verified", w.verified], ["words", w.words]];
    if (w.rank) rows.push(["this week", "#" + w.rank]);
    rows.forEach(([label, n], i) => {
      const y = 620 + i * 280;
      g.fillStyle = "#fff"; g.font = `400 190px ${display}`; g.fillText(String(n), 540, y);
      g.fillStyle = "#c9d6ff"; g.font = `700 50px ${body}`; g.fillText(label.toUpperCase(), 540, y + 70);
    });
    ["#d71920", "#f6ff00", "#00a651", "#000"].forEach((col, i) => { g.fillStyle = col; g.fillRect(190 + i * 175, 1590, 175, 20); });
    g.fillStyle = "#fff"; g.font = `400 80px ${display}`; g.fillText("Paite Daily", 540, 1720);
    g.fillStyle = "#dfe7ff"; g.font = `40px ${body}`; g.fillText("paite.lamkalabs.com", 540, 1790);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const file = new File([blob], "paite-daily-week.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: `My week on Paite Daily: ${line()}. https://paite.lamkalabs.com/?via=share` });
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
    if (window.pdTrack) window.pdTrack("share");
  }
})();
