// Visitors dashboard on /admin. Reads /admin/api/visitors (totals), /live (the last five minutes)
// and /visits (recent visits with their steps). Charts are plain SVG; nothing from the server is
// inserted as HTML, every text goes in with textContent.
(() => {
  const root = document.getElementById("vz");
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";

  // ---------- building blocks ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
  }
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
    for (const c of kids) if (c) el.append(c);
    return el;
  }

  // ---------- formats ----------
  const nf = new Intl.NumberFormat("en-IN");
  const num = (n) => nf.format(Math.round(n || 0));
  const short = (n) => (n >= 100000 ? (n / 100000).toFixed(n >= 1000000 ? 0 : 1) + "L" : n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(Math.round(n)));
  const dur = (ms) => {
    const t = Math.round((ms || 0) / 1000);
    if (t < 60) return `${t}s`;
    if (t < 3600) return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`;
    return `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}m`;
  };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayLabel = (d, long) => { const x = new Date(d + "T00:00:00Z"); return (long ? WD[x.getUTCDay()] + " " : "") + x.getUTCDate() + " " + MON[x.getUTCMonth()]; };
  const clock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const istDay = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
  function when(ms) {
    const d = istDay(ms), t = istDay(Date.now());
    if (Date.now() - ms < 60000) return "just now";
    if (Date.now() - ms < 3600000) return `${Math.floor((Date.now() - ms) / 60000)} min ago`;
    if (d === t) return `Today ${clock(ms)}`;
    if (d === istDay(Date.now() - 86400000)) return `Yesterday ${clock(ms)}`;
    return `${dayLabel(d)} ${clock(ms)}`;
  }
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch {}
  const countryName = (c) => { if (!c) return "Unknown"; try { return regionNames ? regionNames.of(c) : c; } catch { return c; } };
  const flag = (c) => (c && /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((x) => 0x1f1e6 + x.charCodeAt(0) - 65)) : "·");
  const PAGES = { "/": "Front page", "/proverbs": "Pau Upa", "/glossary": "Word list", "/contributors": "Panlate", "/about": "About", "/rules": "Spelling rules", "/places": "Places", "/wiki": "Paite Wiki", "/review": "Review", "/admin": "Admin", "/404": "Not found" };
  const pageName = (p) => PAGES[p] || (p && p.startsWith("/wiki/") ? "Wiki article" : p || "/");
  const KINDS = { card: "Saw a sentence", answer: "Sent an answer", blocked: "Answer held back", chat: "Typed a chat line", ask: "Asked Tongdot | Tongsan", play: "Played a recording", share: "Shared", install: "Installed the app" };
  const SRC = { WhatsApp: "#25d366", Facebook: "#1877f2", Instagram: "#e1306c", Google: "#4285f4", Bing: "#00a4ef", YouTube: "#ff0033", Telegram: "#26a5e4", X: "var(--fg)", "Paite Daily app": "var(--vz)", "Shared link": "#b87a00", Email: "#8e6cd8", ChatGPT: "#10a37f", Direct: "var(--muted)" };
  const srcColour = (k) => SRC[k] || "var(--hair)";
  const placeOf = (v) => [v.city, v.region, v.country ? countryName(v.country) : ""].filter(Boolean).slice(0, 2).join(", ") || "Unknown place";

  const ICON = {
    phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm3 17h2",
    tablet: "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm5 17h2",
    desktop: "M3 4h18v12H3zM8 20h8M12 16v4",
  };
  const icon = (name) => s("svg", { class: "vz-ic", viewBox: "0 0 24 24", "aria-hidden": "true" }, s("path", { d: ICON[name] || ICON.desktop }));

  // ---------- state ----------
  let range = "7", data = null, metric = "visitors";
  const METRICS = [
    { key: "visitors", label: "Visitors", fmt: num },
    { key: "visits", label: "Visits", fmt: num },
    { key: "pageviews", label: "Page views", fmt: num },
    { key: "avgMs", label: "Time per visit", fmt: dur },
    { key: "bounceRate", label: "Left at once", fmt: (v) => `${Math.round(v)}%`, lowerIsBetter: true },
    { key: "actions", label: "Actions", fmt: num },
  ];

  // ---------- KPIs ----------
  function delta(cur, prev, lower) {
    if (prev === null || prev === undefined || !data.previous) return h("span", { class: "vz-delta none", text: "no earlier data" });
    if (!prev) return h("span", { class: "vz-delta none", text: "new" });
    const ch = ((cur - prev) / prev) * 100;
    if (Math.abs(ch) < 0.5) return h("span", { class: "vz-delta flat", text: "steady" });
    const good = lower ? ch < 0 : ch > 0;
    return h("span", { class: `vz-delta ${good ? "good" : "bad"}`, text: `${ch > 0 ? "▲" : "▼"} ${Math.abs(ch) >= 10 ? Math.round(Math.abs(ch)) : Math.abs(ch).toFixed(1)}%` });
  }
  function spark(values) {
    const w = 120, ht = 30, max = Math.max(1, ...values), n = values.length;
    if (n < 2) return s("svg", { class: "vz-spark", viewBox: `0 0 ${w} ${ht}`, "aria-hidden": "true" });
    const pts = values.map((v, i) => [(i / (n - 1)) * w, ht - 3 - (v / max) * (ht - 6)]);
    const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
    return s("svg", { class: "vz-spark", viewBox: `0 0 ${w} ${ht}`, preserveAspectRatio: "none", "aria-hidden": "true" },
      s("path", { class: "a", d: `${line}L${w} ${ht}L0 ${ht}Z` }), s("path", { class: "l", d: line }));
  }
  function kpis() {
    $("vz-kpis").replaceChildren(...METRICS.map((m) => {
      const cur = data.totals[m.key], prev = data.previous ? data.previous[m.key] : null;
      const b = h("button", { type: "button", class: "vz-kpi", "aria-pressed": String(metric === m.key), onclick: () => { metric = m.key; kpis(); chart(); } },
        h("span", { class: "vz-kl", text: m.label }),
        h("span", { class: "vz-kv", text: m.fmt(cur) }),
        delta(cur, prev, m.lowerIsBetter),
        spark(data.series.map((p) => p[m.key] || 0)));
      return b;
    }));
  }

  // ---------- main chart ----------
  function curve(pts) {
    // Monotone cubic (Fritsch-Carlson): smooth, and never overshoots below zero or above a peak.
    if (pts.length < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}` : "";
    const n = pts.length, dx = [], dy = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = pts[i + 1][1] - pts[i][1]; m[i] = dy[i] / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const c1x = pts[i][0] + dx[i] / 3, c1y = pts[i][1] + (t[i] * dx[i]) / 3, c2x = pts[i + 1][0] - dx[i] / 3, c2y = pts[i + 1][1] - (t[i + 1] * dx[i]) / 3;
      d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
    }
    return d;
  }
  const niceMax = (v) => { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
  const pointLabel = (k, long) => (k.length === 2 ? `${k}:00` : dayLabel(k, long));
  function chart() {
    const el = $("vz-plot"), m = METRICS.find((x) => x.key === metric);
    const cur = data.series, prev = data.prevSeries || [];
    const W = Math.max(280, el.clientWidth), H = W < 520 ? 200 : 260, L = 44, R = 14, T = 16, B = 30;
    const n = Math.max(cur.length, data.range === "today" ? 24 : cur.length);
    const vals = cur.map((p) => p[metric] || 0), pvals = prev.slice(0, n).map((p) => p[metric] || 0);
    const max = niceMax(Math.max(1, ...vals, ...pvals) * 1.08);
    const x = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
    const y = (v) => T + (1 - v / max) * (H - T - B);
    const svg = s("svg", { class: "vz-svg", viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `${m.label}, ${data.range === "today" ? "by hour today" : "by day"}` });
    const defs = s("defs", null, s("linearGradient", { id: "vz-fill", x1: "0", y1: "0", x2: "0", y2: "1" }, s("stop", { offset: "0", class: "g0" }), s("stop", { offset: "1", class: "g1" })));
    svg.append(defs);
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      svg.append(s("line", { class: "grid", x1: L, x2: W - R, y1: yy, y2: yy }));
      const t = s("text", { class: "ax", x: L - 10, y: yy + 4, "text-anchor": "end" }); t.textContent = metric === "avgMs" ? dur(v) : metric === "bounceRate" ? `${Math.round(v)}%` : short(v); svg.append(t);
    }
    const ticks = Math.min(n, W < 520 ? 4 : 7);
    const keys = data.range === "today" ? Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")) : cur.map((p) => p.key);
    for (let k = 0; k < ticks; k++) {
      const i = ticks === 1 ? 0 : Math.round((k / (ticks - 1)) * (n - 1));
      const t = s("text", { class: "ax", x: x(i), y: H - 8, "text-anchor": k === 0 ? "start" : k === ticks - 1 ? "end" : "middle" }); t.textContent = pointLabel(keys[i] || ""); svg.append(t);
    }
    if (pvals.length > 1) svg.append(s("path", { class: "prev", d: curve(pvals.map((v, i) => [x(i), y(v)])) }));
    const pts = vals.map((v, i) => [x(i), y(v)]);
    if (pts.length) {
      const line = curve(pts);
      svg.append(s("path", { class: "area", d: `${line}L${pts[pts.length - 1][0]} ${y(0)}L${pts[0][0]} ${y(0)}Z` }));
      svg.append(s("path", { class: "line", d: line }));
      const last = pts[pts.length - 1];
      svg.append(s("circle", { class: "end", cx: last[0], cy: last[1], r: 4 }));
    }
    const guide = s("line", { class: "guide", x1: 0, x2: 0, y1: T, y2: H - B, visibility: "hidden" });
    const dot = s("circle", { class: "dot", r: 5, visibility: "hidden" });
    const pdot = s("circle", { class: "pdot", r: 3.5, visibility: "hidden" });
    svg.append(guide, pdot, dot);
    const hit = s("rect", { x: L, y: 0, width: W - L - R, height: H, fill: "transparent" });
    svg.append(hit);
    const tip = $("vz-tip");
    const show = (ev) => {
      const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
      const hasCur = i < vals.length;
      guide.setAttribute("x1", x(i)); guide.setAttribute("x2", x(i)); guide.setAttribute("visibility", "visible");
      if (hasCur) { dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(vals[i])); dot.setAttribute("visibility", "visible"); } else dot.setAttribute("visibility", "hidden");
      if (i < pvals.length) { pdot.setAttribute("cx", x(i)); pdot.setAttribute("cy", y(pvals[i])); pdot.setAttribute("visibility", "visible"); } else pdot.setAttribute("visibility", "hidden");
      const label = data.range === "today" ? `${keys[i]}:00 to ${keys[i]}:59` : dayLabel(cur[i].key, true);
      tip.replaceChildren(
        h("b", { text: label }),
        h("span", { class: "now" }, h("i"), `${m.label}: `, h("strong", { text: hasCur ? m.fmt(vals[i]) : "–" })),
        i < pvals.length ? h("span", { class: "was" }, h("i"), data.range === "today" ? "Yesterday: " : `${dayLabel(prev[i].key)}: `, h("strong", { text: m.fmt(pvals[i]) })) : null);
      tip.hidden = false;
      const fr = $("vz-chart").getBoundingClientRect(), tx = (x(i) / W) * r.width + (r.left - fr.left);
      tip.style.left = `${Math.min(Math.max(tx, 90), fr.width - 90)}px`;
      tip.style.top = `${((hasCur ? y(vals[i]) : T) / H) * r.height + (r.top - fr.top) - 12}px`;
    };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", () => { tip.hidden = true; guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); pdot.setAttribute("visibility", "hidden"); });
    el.replaceChildren(svg);
    $("vz-legend").replaceChildren(
      h("span", { class: "k now" }, h("i"), data.range === "today" ? "Today" : `Last ${data.series.length} days`),
      pvals.some((v) => v) ? h("span", { class: "k was" }, h("i"), data.range === "today" ? "Yesterday" : "The period before") : null,
      h("span", { class: "k tot" }, `${m.label} in all: `, h("b", { text: m.fmt(data.totals[metric]) })));
  }

  // ---------- breakdown panels ----------
  function rows(items, opts) {
    if (!items.length) return [h("li", { class: "vz-empty", text: "Nothing yet in this period." })];
    const top = Math.max(...items.map((i) => i[opts.by]));
    return items.map((it) => {
      const lab = opts.label(it);
      return h("li", { style: `--w:${top ? (it[opts.by] / top) * 100 : 0}%`, title: opts.title ? opts.title(it) : null },
        h("span", { class: "vz-bar", "aria-hidden": "true" }),
        h("span", { class: "vz-l" }, opts.lead ? opts.lead(it) : null, h("span", { class: "vz-lt", text: lab.main }), lab.sub ? h("small", { text: lab.sub }) : null),
        h("span", { class: "vz-v", text: num(it[opts.by]) }),
        h("span", { class: "vz-p", text: opts.extra ? opts.extra(it) : `${Math.round(it.share)}%` }));
    });
  }
  function panel(id, title, sub, tabs) {
    const el = $(id);
    let cur = 0;
    const list = h("ol", { class: "vz-rows" });
    const head = h("div", { class: "vz-cols" }, h("span", { text: tabs[0].col || "" }), h("span", { text: tabs[0].unit || "Visitors" }), h("span", { text: "" }));
    const draw = () => {
      const t = tabs[cur];
      head.children[0].textContent = t.col || ""; head.children[1].textContent = t.unit || "Visitors"; head.children[2].textContent = t.extraHead || "Share";
      list.replaceChildren(...rows(t.items(), t));
      tabBar && [...tabBar.children].forEach((b, i) => b.setAttribute("aria-pressed", String(i === cur)));
    };
    const tabBar = tabs.length > 1 ? h("div", { class: "vz-tabs", role: "group", "aria-label": title }, ...tabs.map((t, i) => h("button", { type: "button", text: t.tab, onclick: () => { cur = i; draw(); } }))) : null;
    el.replaceChildren(h("header", null, h("h3", null, title, sub ? h("small", { text: sub }) : null), tabBar), head, list);
    draw();
  }
  const dotLead = (colour) => h("i", { class: "vz-dot", style: `background:${colour}` });
  function panels() {
    panel("vz-sources", "Sources", "Where visits come from", [{
      tab: "Sources", col: "Source", unit: "Visits", by: "visits", items: () => data.sources,
      label: (i) => ({ main: i.key, sub: `${num(i.visitors)} visitors · ${Math.round(i.bounceRate)}% left at once` }), lead: (i) => dotLead(srcColour(i.key)),
    }]);
    panel("vz-places", "Places", "From Cloudflare's view of each visit", [
      { tab: "Countries", col: "Country", by: "visitors", items: () => data.countries, label: (i) => ({ main: countryName(i.key) }), lead: (i) => h("span", { class: "vz-flag", text: flag(i.key) }) },
      { tab: "Regions", col: "Region", by: "visitors", items: () => data.regions, label: (i) => { const [c, r] = i.key.split("|"); return { main: r, sub: countryName(c) }; }, lead: (i) => h("span", { class: "vz-flag", text: flag(i.key.split("|")[0]) }) },
      { tab: "Cities", col: "City", by: "visitors", items: () => data.cities, label: (i) => { if (!i.key) return { main: "Other places", sub: "Cities with one visitor are not named" }; const [c, r, ci] = i.key.split("|"); return { main: ci, sub: `${r}, ${countryName(c)}` }; }, lead: (i) => h("span", { class: "vz-flag", text: i.key ? flag(i.key.split("|")[0]) : "·" }) },
    ]);
    panel("vz-pages", "Pages", "What people open", [
      { tab: "Top", col: "Page", unit: "Views", by: "hits", extraHead: "On screen", items: () => data.pages, label: (i) => ({ main: pageName(i.key), sub: `${i.key} · ${num(i.visitors)} visitors` }), extra: (i) => (i.avgMs ? dur(i.avgMs) : "–") },
      { tab: "First page", col: "Page", unit: "Visits", by: "visits", items: () => data.entries, label: (i) => ({ main: pageName(i.key), sub: i.key }) },
      { tab: "Last page", col: "Page", unit: "Visits", by: "visits", items: () => data.exits, label: (i) => ({ main: pageName(i.key), sub: i.key }) },
    ]);
    const cap = (k) => (k ? k.charAt(0).toUpperCase() + k.slice(1) : "Unknown");
    panel("vz-tech", "Devices", "What they read on", [
      { tab: "Device", col: "Device", by: "visitors", items: () => data.devices, label: (i) => ({ main: cap(i.key) }), lead: (i) => icon(i.key) },
      { tab: "Browser", col: "Browser", by: "visitors", items: () => data.browsers, label: (i) => ({ main: i.key }) },
      { tab: "System", col: "System", by: "visitors", items: () => data.systems, label: (i) => ({ main: i.key }) },
    ]);
  }

  function funnel() {
    const f = data.funnel, top = Math.max(1, f[0].visits);
    const steps = [];
    f.forEach((st, i) => {
      if (i) {
        const from = f[i - 1].visits, lost = from ? Math.round(((from - st.visits) / from) * 100) : 0;
        steps.push(h("li", { class: "vz-drop", text: from ? `${lost}% go no further` : "" }));
      }
      steps.push(h("li", { class: "vz-step", style: `--w:${(st.visits / top) * 100}%` },
        h("span", { class: "vz-sn", text: String(i + 1).padStart(2, "0") }),
        h("span", { class: "vz-st", text: st.step }),
        h("span", { class: "vz-sv" }, h("b", { text: num(st.visits) }), h("small", { text: `${Math.round((st.visits / top) * 100)}%` })),
        h("span", { class: "vz-sbar", "aria-hidden": "true" })));
    });
    $("vz-funnel").replaceChildren(h("header", null, h("h3", null, "The contributor path", h("small", { text: "Visits that reach each step" }))), h("ol", { class: "vz-fun" }, steps));
  }

  function actions() {
    const r = data.returning, known = r.new + r.returning;
    const share = known ? Math.round((r.returning / known) * 100) : 0;
    const ring = s("svg", { class: "vz-ring", viewBox: "0 0 42 42", "aria-hidden": "true" },
      s("circle", { class: "bg", cx: 21, cy: 21, r: 15.9 }),
      s("circle", { class: "fg", cx: 21, cy: 21, r: 15.9, "stroke-dasharray": `${share} ${100 - share}`, "stroke-dashoffset": 25 }));
    const items = data.actions;
    const top = Math.max(1, ...items.map((a) => a.hits));
    $("vz-actions").replaceChildren(
      h("header", null, h("h3", null, "What they did", h("small", { text: "Beyond reading" }))),
      h("ol", { class: "vz-rows vz-acts" }, items.length ? items.map((a) => h("li", { style: `--w:${(a.hits / top) * 100}%` },
        h("span", { class: "vz-bar", "aria-hidden": "true" }),
        h("span", { class: "vz-l" }, h("span", { class: "vz-lt", text: KINDS[a.key] || a.key }), h("small", { text: `${num(a.visits)} visits · ${num(a.visitors)} visitors` })),
        h("span", { class: "vz-v", text: num(a.hits) }), h("span", { class: "vz-p", text: "" }))) : [h("li", { class: "vz-empty", text: "No actions yet in this period." })]),
      h("div", { class: "vz-back" }, ring,
        h("div", null, h("b", { text: known ? `${share}%` : "–" }), h("span", { text: "of visits are from people who have been here before" }),
          h("small", { text: known ? `${num(r.returning)} returning · ${num(r.new)} new` : "Counted from today on" }))));
  }

  function heat() {
    const el = $("vz-heat");
    const head = h("header", null, h("h3", null, "Rhythm of the week", h("small", { text: "When visits start, India time" })));
    if (!data.heatmap) { el.replaceChildren(head, h("p", { class: "vz-empty", text: "Pick 7, 30 or 90 days to see the week." })); return; }
    const max = Math.max(1, ...data.heatmap.flat());
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const grid = h("div", { class: "vz-hm", role: "img", "aria-label": "Visits by weekday and hour" });
    grid.append(h("span"));
    for (let hr = 0; hr < 24; hr++) grid.append(h("span", { class: "vz-hh", text: hr % 3 === 0 ? String(hr).padStart(2, "0") : "" }));
    data.heatmap.forEach((row, d) => {
      grid.append(h("span", { class: "vz-hd", text: days[d] }));
      row.forEach((v, hr) => grid.append(h("span", { class: "vz-hc", style: `--a:${v ? 0.12 + (v / max) * 0.88 : 0}`, title: `${days[d]} ${String(hr).padStart(2, "0")}:00 · ${num(v)} visits` })));
    });
    el.replaceChildren(head, grid, h("div", { class: "vz-hl" }, h("span", { text: "Fewer" }), h("i"), h("span", { text: "More" })));
  }

  function insightsList() {
    const ul = $("vz-ins");
    ul.replaceChildren(...data.insights.map((x) => h("li", { class: x.tone }, h("i", { "aria-hidden": "true" }), h("span", { text: x.text }))));
    ul.hidden = !data.insights.length;
  }

  // ---------- visits ----------
  function steps(v) {
    const out = [];
    for (const st of v.steps) {
      if (st.kind === "leave") { for (let j = out.length - 1; j >= 0; j--) if (out[j].kind === "page" && out[j].path === st.path) { out[j].ms = (out[j].ms || 0) + (st.ms || 0); break; } continue; }
      out.push({ ...st });
    }
    return out;
  }
  function visitRow(v, live) {
    const meta = h("span", { class: "vz-vm" },
      h("span", { class: "vz-src" }, dotLead(srcColour(v.source)), v.source),
      h("span", null, h("span", { class: "vz-flag", text: flag(v.country) }), placeOf(v)),
      h("span", null, icon(v.device), `${v.browser} · ${v.os}`));
    const stats = h("span", { class: "vz-vs" },
      h("b", { text: live ? pageName(v.page) : `${v.pages} ${v.pages === 1 ? "page" : "pages"}` }),
      h("small", { text: `${dur(v.ms)}${v.returning === 1 ? " · returning" : v.returning === 0 ? " · new" : ""}` }));
    const tl = h("ol", { class: "vz-tl" }, ...steps(v).map((st) => {
      const isPage = st.kind === "page";
      return h("li", { class: isPage ? "pg" : `act ${st.kind}` },
        h("span", { class: "vz-tt", text: `+${dur(st.at - v.start)}` }),
        h("span", { class: "vz-tn" }, h("b", { text: isPage ? pageName(st.path) : KINDS[st.kind] || st.kind }), isPage ? h("small", { text: `${st.path}${st.ms ? ` · on screen ${dur(st.ms)}` : ""}` }) : null));
    }));
    return h("li", { class: "vz-visit" }, h("details", null,
      h("summary", null, h("span", { class: "vz-vt" }, live ? h("i", { class: "vz-pulse", "aria-hidden": "true" }) : null, h("span", { text: live ? `since ${clock(v.start)}` : when(v.start) })), meta, stats),
      tl));
  }
  let more = null;
  async function loadVisits(before) {
    const r = await fetch("/admin/api/visitors/visits" + (before ? `?before=${before}` : ""));
    if (!r.ok) return;
    const d = await r.json();
    const list = before ? $("vz-vlist") : h("ol", { class: "vz-vlist", id: "vz-vlist" });
    if (!before) {
      more = h("button", { type: "button", class: "vz-more", text: "Show more visits" });
      $("vz-visits").replaceChildren(h("header", null, h("h3", null, "Recent visits", h("small", { text: "Open one to see its path" }))), list, more);
    }
    if (!d.visits.length && !before) list.append(h("li", { class: "vz-empty", text: "No visits in the last 30 days." }));
    list.append(...d.visits.map((v) => visitRow(v, false)));
    more.hidden = !d.more;
    const last = d.visits.length ? d.visits[d.visits.length - 1].id : null;
    more.onclick = () => { more.disabled = true; loadVisits(last).finally(() => { more.disabled = false; }); };
  }
  async function loadLive() {
    try {
      const r = await fetch("/admin/api/visitors/live");
      if (!r.ok) return;
      const d = await r.json();
      $("vz-now").textContent = num(d.count);
      $("vz-live").classList.toggle("on", d.count > 0);
      $("vz-livepanel").replaceChildren(h("header", null, h("h3", null, "Right now", h("small", { text: "Last five minutes, refreshed every 20 seconds" }))),
        d.visits.length ? h("ol", { class: "vz-vlist" }, d.visits.map((v) => visitRow(v, true))) : h("p", { class: "vz-empty", text: "Nobody on the site this minute." }));
    } catch {}
  }

  // ---------- loading ----------
  async function load() {
    root.setAttribute("aria-busy", "true");
    root.classList.add("loading");
    try {
      const r = await fetch(`/admin/api/visitors?range=${range}`);
      if (!r.ok) return;
      data = await r.json();
      kpis(); chart(); insightsList(); panels(); funnel(); actions(); heat();
      $("vz-sub").textContent = `India time · updated ${clock(data.generated)}`;
    } finally {
      root.setAttribute("aria-busy", "false");
      root.classList.remove("loading");
    }
  }
  root.querySelectorAll(".vz-seg button").forEach((b) => b.addEventListener("click", () => {
    range = b.dataset.range;
    root.querySelectorAll(".vz-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    load();
  }));
  let resizeT = 0;
  new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (data) chart(); }, 120); }).observe($("vz-plot"));
  load().then(() => { loadLive(); loadVisits(null); });
  setInterval(() => { if (document.visibilityState === "visible") loadLive(); }, 20000);
})();
