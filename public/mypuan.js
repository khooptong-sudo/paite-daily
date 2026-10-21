// Your puan: every verified sentence or word you gave weaves one more thread into a
// shawl that is yours alone. The colour order comes from your name, so no two puans
// match; the length comes from your count, so it grows as you give. Share it as a
// WhatsApp status. Also here: "Ask a relative", which sends the current sentence on
// WhatsApp to someone who speaks Paite better than you, with the site link.
(() => {
  const box = document.getElementById("mypuan"), c = document.getElementById("mypuan-c");
  const COLS = ["#d71920", "#f6ff00", "#00a651", "#111111", "#ffffff"];
  let me = null;
  const seed = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); };
  // Draw `n` threads (horizontal weft rows) across a black ground, with yellow warp
  // stripes at fixed places, the way the liangbat is woven.
  function weave(g, w, h, n, name) {
    const r = seed(name || "Paite");
    const order = [0, 3, 1, 3, 2, 3, 0, 4].map((i) => COLS[i]).sort(() => r() - .5);
    g.fillStyle = "#111"; g.fillRect(0, 0, w, h);
    const rows = Math.max(n, 1), th = h / Math.max(rows, 12);
    for (let i = 0; i < rows && i * th < h; i++) {
      g.fillStyle = order[i % order.length]; g.fillRect(0, i * th, w, Math.max(1, th - 1));
    }
    g.globalAlpha = .85; g.fillStyle = "#f6ff00";
    for (let x = w * .12; x < w; x += w * .19) { g.fillRect(x, 0, Math.max(2, w * .012), h); g.fillRect(x + w * .02, 0, Math.max(1, w * .005), h); }
    g.globalAlpha = 1;
  }
  function draw() {
    if (!me) return;
    const n = (me.total || 0) + (me.words || 0);
    box.hidden = n < 1;
    if (n < 1) return;
    const w = c.clientWidth || 320, h = Math.min(160, 24 + n * 2), d = Math.min(devicePixelRatio || 1, 2);
    c.width = w * d; c.height = h * d; c.style.height = h + "px";
    const g = c.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0); weave(g, w, h, n, me.name);
    document.getElementById("mypuan-note").textContent = `${n} thread${n === 1 ? "" : "s"} woven. Each verified line adds one.`;
  }
  document.addEventListener("paite:me", (e) => { me = e.detail; draw(); });
  addEventListener("resize", draw);
  document.getElementById("mypuan-share").addEventListener("click", async () => {
    if (!me) return;
    const n = (me.total || 0) + (me.words || 0);
    await document.fonts.ready;
    const k = document.createElement("canvas"); k.width = 1080; k.height = 1920;
    const g = k.getContext("2d"), css = getComputedStyle(document.documentElement);
    const display = css.getPropertyValue("--display"), body = css.getPropertyValue("--body");
    g.fillStyle = "#fbfbf9"; g.fillRect(0, 0, 1080, 1920);
    g.save(); g.beginPath(); g.roundRect(140, 300, 800, 900, 40); g.clip(); weave(g, 800 + 140, 1200, Math.max(n, 12), me.name); g.restore();
    g.textAlign = "center"; g.fillStyle = "#111"; g.font = `400 96px ${display}`; g.fillText("Ka puan", 540, 1360);
    g.fillStyle = "#5d6066"; g.font = `44px ${body}`; g.fillText(`${me.name ? me.name + " · " : ""}${n} threads of Paite`, 540, 1440, 960);
    g.fillStyle = "#111"; g.font = `700 46px ${body}`; g.fillText("Weave yours: one sentence, one thread.", 540, 1640, 960);
    g.fillStyle = "#5d6066"; g.font = `40px ${body}`; g.fillText("paite.lamkalabs.com", 540, 1710);
    const blob = await new Promise((r) => k.toBlob(r, "image/png"));
    const file = new File([blob], "ka-puan.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: "Ka puan, woven from Paite sentences. https://paite.lamkalabs.com" }).catch(() => {});
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  });
  // Ask a relative: the current sentence and the link, ready to send on WhatsApp.
  const ask = document.getElementById("ask-relative");
  if (ask) ask.addEventListener("click", () => {
    const line = (document.getElementById("sentence")?.textContent || "").trim();
    if (!line) return;
    const msg = `Hiai Paite in bang chih ding? / How do you say this in Paite?\n\n"${line}"\n\nHelp us write Paite into the future: https://paite.lamkalabs.com`;
    open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank", "noopener");
  });
})();
