// Your puan: every verified sentence or word you gave weaves one more thread into a
// shawl that is yours alone. The colour order comes from your name, so no two puans
// match; the length comes from your count, so it grows as you give. Share it as a
// WhatsApp status. Also here: "Ask a relative", which sends the current sentence on
// WhatsApp to someone who speaks Paite better than you, with the site link.
(() => {
  const box = document.getElementById("mypuan"), c = document.getElementById("mypuan-c");
  // The three nampuan colour sets, with the colour codes paite.org recommends.
  // Each person's name picks their first set; the warp stripe is that shawl's accent.
  const SETS = [
    { name: "Puandum", weft: ["#d71920", "#000000", "#f6ff00", "#000000", "#00a651", "#000000"], warp: "#f6ff00" },
    { name: "BA / Siamsin Puan", weft: ["#1725d4", "#000000", "#ec008c", "#000000", "#00a651", "#000000"], warp: "#ec008c" },
    { name: "Ngoutekhelh", weft: ["#ffffff", "#000000", "#ffffff", "#000000", "#000000"], warp: "#ffffff" },
  ];
  // Aksi Puan, the star shawl: white eight-point stars on deep navy, not stripes.
  const AKSI = { name: "Aksi Puan", stars: true, ground: "#1b1c3f", star: "#f4f1ea" };
  // A shawl is finished at PER threads, and the next one starts. The journey: the shawl your
  // name picks, then BA / Siamsin Puan (skipped if that was your first), then Aksi Puan,
  // and round again.
  const PER = 50;
  const firstFor = (name) => { const r = seed(name || "Paite"); return SETS[Math.floor(r() * SETS.length)]; };
  const journey = (name) => { const first = firstFor(name); return first === SETS[1] ? [first, AKSI] : [first, SETS[1], AKSI]; };
  // Which shawl is on the loom, how many threads it has (1..PER), and how many are finished.
  const loom = (name, n) => {
    const done = Math.max(0, Math.floor((n - 1) / PER)), path = journey(name);
    return { set: path[done % path.length], cur: n - done * PER, done };
  };
  const setFor = (name, n) => loom(name, n).set;
  let me = null;
  // Every section counts as thread: sentences, words, sayings, meanings and recordings.
  const threads = (m) => (m.total || 0) + (m.words || 0) + (m.meanings || 0) + (m.sayings || 0) + (m.recordings || 0);
  // Pau Upa is Paite and takes no English plural.
  const plural = (n, one) => `${n} ${one}${n === 1 || one === "Pau Upa" ? "" : "s"}`;
  // The share card names each section the person gave to, e.g. "12 sentences · 3 words".
  const sections = (m) => [[m.total, "sentence"], [m.words, "word"], [m.sayings, "Pau Upa"], [m.meanings, "meaning"], [m.recordings, "recording"]]
    .filter(([v]) => v > 0).map(([v, one]) => plural(v, one)).join(" · ");
  const seed = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); };
  // Draw `n` threads (horizontal weft rows) across a black ground, with warp stripes at
  // fixed places, the way the liangbat is woven. Aksi Puan fills with stars instead, row by row.
  function weave(g, w, h, n, name, set = setFor(name, n)) {
    const r = seed((name || "Paite") + "#weave" + set.name);
    if (set.stars) return stars(g, w, h, n, set);
    // Same shawl colours for everyone on that shawl; the order of bands is personal.
    const order = [...set.weft].sort(() => r() - .5);
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    const rows = Math.max(n, 1), th = h / Math.max(rows, 12);
    for (let i = 0; i < rows && i * th < h; i++) {
      g.fillStyle = order[i % order.length]; g.fillRect(0, i * th, w, Math.max(1, th - 1));
    }
    g.globalAlpha = .85; g.fillStyle = set.warp;
    for (let x = w * .12; x < w; x += w * .19) { g.fillRect(x, 0, Math.max(2, w * .012), h); g.fillRect(x + w * .02, 0, Math.max(1, w * .005), h); }
    g.globalAlpha = 1;
  }
  // Aksi Puan: a field of eight-point stars with a small dot between each, filling in reading
  // order as threads are given; the whole field is out at PER threads.
  function stars(g, w, h, n, set) {
    g.fillStyle = set.ground; g.fillRect(0, 0, w, h);
    const step = Math.max(18, Math.min(32, h / 4)), cols = Math.ceil(w / step), rows = Math.ceil(h / step);
    const shown = Math.ceil(cols * rows * Math.min(1, n / PER));
    g.fillStyle = set.star;
    for (let k = 0; k < shown; k++) {
      const row = Math.floor(k / cols), col = k % cols, x = (col + .5) * step + (row % 2 ? step / 2 : 0), y = (row + .5) * step, R = step * .32;
      g.beginPath();
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8 - Math.PI / 2, rr = i % 2 ? R * .42 : R; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.closePath(); g.fill();
      g.fillRect(x + step / 2 - 1, y + step / 2 - 1, 2, 2);
    }
  }
  function draw() {
    if (!me) return;
    const n = threads(me);
    box.hidden = n < 1;
    if (n < 1) return;
    const { set, cur, done } = loom(me.name, n);
    const w = c.clientWidth || 320, h = Math.round(Math.min(160, 24 + cur * 2.72)), d = Math.min(devicePixelRatio || 1, 2);
    c.width = w * d; c.height = h * d; c.style.height = h + "px";
    const g = c.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0); weave(g, w, h, cur, me.name, set);
    document.getElementById("mypuan-note").textContent = `${set.name} · ${cur} of ${PER} threads` + (done ? ` · ${plural(done, "shawl")} finished` : "");
  }
  document.addEventListener("paite:me", (e) => { me = e.detail; draw(); });
  addEventListener("resize", draw);
  document.getElementById("mypuan-share").addEventListener("click", async () => {
    if (!me) return;
    const n = threads(me);
    await document.fonts.ready;
    const k = document.createElement("canvas"); k.width = 1080; k.height = 1920;
    const g = k.getContext("2d"), css = getComputedStyle(document.documentElement);
    const display = css.getPropertyValue("--display"), body = css.getPropertyValue("--body");
    g.fillStyle = "#fbfbf9"; g.fillRect(0, 0, 1080, 1920);
    const { set, cur, done } = loom(me.name, n);
    g.save(); g.beginPath(); g.roundRect(140, 300, 800, 900, 40); g.clip(); g.translate(140, 300); weave(g, 800, 900, Math.max(cur, 12), me.name, set); g.restore();
    g.textAlign = "center"; g.fillStyle = "#111"; g.font = `400 96px ${display}`; g.fillText("Nampuan Liangbat Gat", 540, 1360, 960);
    g.fillStyle = "#5d6066"; g.font = `44px ${body}`; g.fillText(`${me.name ? me.name + " · " : ""}${set.name} · ${plural(n, "thread")}` + (done ? ` · ${plural(done, "shawl")}` : ""), 540, 1440, 960);
    g.fillStyle = "#111"; g.font = `700 44px ${body}`; g.fillText(sections(me), 540, 1520, 960);
    g.fillStyle = "#111"; g.font = `700 46px ${body}`; g.fillText("One verified sentence, one thread. Weave yours.", 540, 1640, 960);
    g.fillStyle = "#5d6066"; g.font = `40px ${body}`; g.fillText("paite.lamkalabs.com", 540, 1710);
    const blob = await new Promise((r) => k.toBlob(r, "image/png"));
    const file = new File([blob], "ka-puan.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: "Nampuan Liangbat Gat: my shawl, woven from the Paite I gave. https://paite.lamkalabs.com" }).catch(() => {});
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  });
  // Ask a relative: the current sentence and the link, ready to send on WhatsApp.
  const ask = document.getElementById("ask-relative");
  if (ask) ask.addEventListener("click", () => {
    const el = document.getElementById("sentence"), line = (el?.textContent || "").trim();
    if (!line) return;
    // The link opens this exact sentence on their phone, so they answer it themselves, with their own name.
    const link = "https://paite.lamkalabs.com/" + (el.dataset.id ? `?s=${el.dataset.id}` : "");
    const msg = `Hiai Paite in bang chih ding? / How do you say this in Paite?\n\n"${line}"\n\nHiai hon dawng inla, na min toh hon pelut ve. / Answer it yourself here, and your name goes with it: ${link}`;
    open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank", "noopener");
  });
})();
