// Your Week, on the front page: the last seven days in one line, and a Share chip that draws
// a 1080 x 1920 status card for WhatsApp. Hidden until the person has sent something.
(() => {
  const card = document.getElementById("week");
  if (!card) return;
  let w = null;
  const line = () => `${w.sent} sent · ${w.verified} verified · ${w.words} words` + (w.rank ? ` · #${w.rank} this week` : "");
  // app.js sets paiteApi once it has a session helper; wait for it, but not forever.
  let tries = 0;
  const ready = () => window.paiteApi ? load() : ++tries < 30 && setTimeout(ready, 300);
  async function load() {
    try {
      const r = await window.paiteApi("/api/week");
      if (!r.ok) return;
      w = await r.json();
      if (!(w.sent > 0)) return;
      document.getElementById("week-line").textContent = line();
      card.hidden = false;
    } catch {}
  }
  ready();
  document.getElementById("week-share").addEventListener("click", () => share().catch(() => {}));
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
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: `My week on Paite Daily: ${line()}. https://paite.lamkalabs.com` });
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  }
})();
