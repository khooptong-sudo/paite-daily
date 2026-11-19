// Visitors dashboard on /review (owner only). Reads /review/api/visitors (totals), /live (the last five minutes)
// and /visits (recent visits with their steps). Charts are plain SVG; nothing from the server is
// inserted as HTML, every text goes in with textContent.
(() => {
  const root = document.getElementById("vz");
  if (!root) return;
  const API = root.dataset.api;
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
  const PAGES = { "/": "Front page", "/proverbs": "Pau Upa", "/same-opposite": "Same & Opposite", "/glossary": "Word list", "/contributors": "Panlate", "/about": "About", "/rules": "Spelling rules", "/places": "Places", "/wiki": "Paite Wiki", "/review": "Review", "/admin": "Admin", "/404": "Not found" };
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
  let range = "7", from = "", to = "", filters = [], gran = null, cmp = true, data = null, metric = "visitors", detail = null;
  // Narrowing: a filter is { dim, key }. The same dimension twice means either; different ones mean both.
  const FILTERABLE = ["source", "country", "region", "city", "device", "browser", "bv", "os", "osv", "brand", "model", "isp", "lang", "tz", "vw", "dpr", "net", "theme", "scheme", "pwa", "returning", "entry", "page", "hour", "kind"];
  const DIM = {
    source: "Source", country: "Country", region: "Region", city: "City", device: "Device", browser: "Browser", bv: "Browser version", os: "System", osv: "System version",
    brand: "Phone make", model: "Phone model", isp: "Network", lang: "Language", tz: "Time zone", tzcheck: "Time zone against place", vw: "Screen width", dpr: "Pixel density",
    net: "Connection", theme: "Theme", scheme: "System theme", pwa: "Installed app", returning: "Visitor", entry: "First page", exit: "Last page", page: "Page", hour: "Hour",
    kind: "Action", depth: "Pages per visit", dwell: "Visit length", scroll: "Scroll depth", flow: "Page to page", out: "Outbound link", jserror: "Browser error",
    lcp: "Largest paint (LCP)", inp: "Responsiveness (INP)", cls: "Layout shift (CLS)", ttfb: "Server reply (TTFB)", load: "Page load",
  };
  const RARE = ["city", "model", "isp", "tz"];
  const cap = (k) => (k ? k.charAt(0).toUpperCase() + k.slice(1) : "Unknown");
  // How a value reads for people: the key is what the server counts, this is what is shown.
  function valueLabel(dim, key) {
    if (!key) return RARE.includes(dim) ? "Other" : dim === "country" ? "Unknown place" : "Unknown";
    switch (dim) {
      case "country": return countryName(key);
      case "region": return key.split("|")[1] || key;
      case "city": return key.split("|")[2] || key;
      case "page": case "entry": case "exit": return pageName(key);
      case "kind": return KINDS[key] || key;
      case "device": return cap(key);
      case "returning": return key === "1" ? "Returning" : key === "0" ? "New" : "Not known";
      case "hour": return `${key}:00`;
      case "pwa": return key === "1" ? "Installed app" : "In the browser";
      case "net": return key === "saver" ? "Data saver" : key.toUpperCase();
      case "tzcheck": return key === "same" ? "Same as the place" : "Differs from the place";
      case "flow": return key.split(">").map(pageName).join(" → ");
      case "jserror": { const i = key.indexOf("|"); return key.slice(i + 1); }
      case "depth": return key === "1" ? "1 page" : `${key} pages`;
      case "lcp": case "inp": case "ttfb": case "load": return bucketLabel(dim, key);
      case "cls": return bucketLabel(dim, key);
      default: return key;
    }
  }
  const msFmt = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)} s` : `${v} ms`);
  function bucketLabel(dim, key) {
    const f = dim === "cls" ? (v) => (v / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : msFmt;
    return key.endsWith("+") ? `over ${f(Number(key.slice(0, -1)))}` : (([a, b]) => `${f(Number(a))} to ${f(Number(b))}`)(key.split("-"));
  }
  const hasFilter = (dim, key) => filters.some((f) => f.dim === dim && f.key === key);
  function addFilter(dim, key) {
    if (!FILTERABLE.includes(dim) || (!key && dim !== "country") || hasFilter(dim, key)) return;
    filters.push({ dim, key });
    load();
  }
  function setRange(r, a, b) { range = r; from = a || ""; to = b || ""; gran = null; load(); }
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
    if (!cmp) return null;
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
  // A point's key is an hour ("14"), a day and hour ("2026-11-14 09"), a day, or the Monday of a week.
  const pointLabel = (k, long) => (k.length === 2 ? `${k}:00` : k.length === 13 ? `${dayLabel(k.slice(0, 10))} ${k.slice(11)}:00` : data && data.g === "week" ? `Week of ${dayLabel(k)}` : dayLabel(k, long));
  // replaceChildren turns a null into the text "null"; this leaves absent items out.
  const putKids = (el, ...k) => el.replaceChildren(...k.flat().filter((c) => c !== null && c !== undefined && c !== false));
  const spanDays =() => Math.round((Date.parse(data.to) - Date.parse(data.from)) / 86400000) + 1;
  const oneDay = () => data.from === data.to;
  const addDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  function chart() {
    const el = $("vz-plot"), m = METRICS.find((x) => x.key === metric);
    const cur = data.series, prev = cmp ? data.prevSeries || [] : [];
    const W = Math.max(280, el.clientWidth), H = W < 520 ? 200 : 260, L = 44, R = 14, T = 16, B = 30;
    const hourly = data.g === "hour" && oneDay(), n = Math.max(cur.length, hourly ? 24 : cur.length);
    const vals = cur.map((p) => p[metric] || 0), pvals = prev.slice(0, n).map((p) => p[metric] || 0);
    const max = niceMax(Math.max(1, ...vals, ...pvals) * 1.08);
    const x = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
    const y = (v) => T + (1 - v / max) * (H - T - B);
    const svg = s("svg", { class: "vz-svg", viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `${m.label}, by ${data.g}` });
    const defs = s("defs", null, s("linearGradient", { id: "vz-fill", x1: "0", y1: "0", x2: "0", y2: "1" }, s("stop", { offset: "0", class: "g0" }), s("stop", { offset: "1", class: "g1" })));
    svg.append(defs);
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      svg.append(s("line", { class: "grid", x1: L, x2: W - R, y1: yy, y2: yy }));
      const t = s("text", { class: "ax", x: L - 10, y: yy + 4, "text-anchor": "end" }); t.textContent = metric === "avgMs" ? dur(v) : metric === "bounceRate" ? `${Math.round(v)}%` : short(v); svg.append(t);
    }
    const ticks = Math.min(n, W < 520 ? 4 : 7);
    const keys = hourly ? Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")) : cur.map((p) => p.key);
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
      const label = hourly ? `${keys[i]}:00 to ${keys[i]}:59` : pointLabel(keys[i], true);
      putKids(tip,
        h("b", { text: label }),
        h("span", { class: "now" }, h("i"), `${m.label}: `, h("strong", { text: hasCur ? m.fmt(vals[i]) : "–" })),
        i < pvals.length ? h("span", { class: "was" }, h("i"), oneDay() ? "Day before: " : `${pointLabel(prev[i].key)}: `, h("strong", { text: m.fmt(pvals[i]) })) : null);
      tip.hidden = false;
      const fr = $("vz-chart").getBoundingClientRect(), tx = (x(i) / W) * r.width + (r.left - fr.left);
      tip.style.left = `${Math.min(Math.max(tx, 90), fr.width - 90)}px`;
      tip.style.top = `${((hasCur ? y(vals[i]) : T) / H) * r.height + (r.top - fr.top) - 12}px`;
    };
    hit.addEventListener("pointermove", show);
    let touch = false;
    hit.addEventListener("pointerdown", (ev) => { touch = ev.pointerType === "touch"; show(ev); });
    hit.addEventListener("pointerleave", () => { tip.hidden = true; guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); pdot.setAttribute("visibility", "hidden"); });
    // A click on a day (with a mouse; a tap only shows the figures) narrows the view to that day.
    hit.addEventListener("click", (ev) => {
      if (touch || oneDay()) return;
      const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(cur.length - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
      const k = cur[i] && cur[i].key;
      if (!k) return;
      const day = k.slice(0, 10);
      if (data.g === "week") setRange("custom", day, addDay(day, 6) > data.today ? data.today : addDay(day, 6));
      else setRange("custom", day, day);
    });
    el.replaceChildren(svg);
    putKids($("vz-legend"),
      h("span", { class: "k now" }, h("i"), oneDay() ? (data.from === data.today ? "Today" : dayLabel(data.from, true)) : `${dayLabel(data.from)} to ${dayLabel(data.to)}`),
      pvals.some((v) => v) ? h("span", { class: "k was" }, h("i"), oneDay() ? (data.from === data.today ? "Yesterday" : "The day before") : "The period before") : null,
      h("span", { class: "k tot" }, `${m.label} in all: `, h("b", { text: m.fmt(data.totals[metric]) })));
  }

  // ---------- breakdown panels ----------
  function rows(items, opts) {
    if (!items.length) return [h("li", { class: "vz-empty", text: "Nothing yet in this period." })];
    const top = Math.max(...items.map((i) => i[opts.by]));
    return items.map((it) => {
      const lab = opts.label(it);
      // A row is a filter: click it (or press Enter) to narrow every card to this value.
      const can = opts.dim && FILTERABLE.includes(opts.dim) && (it.key || opts.dim === "country");
      const pick = () => addFilter(opts.dim, it.key);
      return h("li", {
        style: `--w:${top ? (it[opts.by] / top) * 100 : 0}%`, title: opts.title ? opts.title(it) : null,
        class: can ? (hasFilter(opts.dim, it.key) ? "pick on" : "pick") : null, tabindex: can ? "0" : null, role: can ? "button" : null,
        onclick: can ? pick : null, onkeydown: can ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } } : null,
      },
        h("span", { class: "vz-bar", "aria-hidden": "true" }),
        h("span", { class: "vz-l" }, opts.lead ? opts.lead(it) : null, h("span", { class: opts.wrap ? "vz-lt wrap" : "vz-lt", text: lab.main }), lab.sub ? h("small", { text: lab.sub }) : null),
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
      dim: "source", tab: "Sources", col: "Source", unit: "Visits", by: "visits", items: () => data.sources,
      label: (i) => ({ main: i.key, sub: `${num(i.visitors)} visitors · ${Math.round(i.bounceRate)}% left at once` }), lead: (i) => dotLead(srcColour(i.key)),
    }]);
    panel("vz-places", "Places", "From Cloudflare's view of each visit", [
      { dim: "country", tab: "Countries", col: "Country", by: "visitors", items: () => data.countries, label: (i) => ({ main: countryName(i.key) }), lead: (i) => h("span", { class: "vz-flag", text: flag(i.key) }) },
      { dim: "region", tab: "Regions", col: "Region", by: "visitors", items: () => data.regions, label: (i) => { const [c, r] = i.key.split("|"); return { main: r, sub: countryName(c) }; }, lead: (i) => h("span", { class: "vz-flag", text: flag(i.key.split("|")[0]) }) },
      { dim: "city", tab: "Cities", col: "City", by: "visitors", items: () => data.cities, label: (i) => { if (!i.key) return { main: "Other places", sub: "Cities with one visitor are not named" }; const [c, r, ci] = i.key.split("|"); return { main: ci, sub: `${r}, ${countryName(c)}` }; }, lead: (i) => h("span", { class: "vz-flag", text: i.key ? flag(i.key.split("|")[0]) : "·" }) },
    ]);
    panel("vz-pages", "Pages", "What people open", [
      { dim: "page", tab: "Top", col: "Page", unit: "Views", by: "hits", extraHead: "On screen", items: () => data.pages, label: (i) => ({ main: pageName(i.key), sub: `${i.key} · ${num(i.visitors)} visitors` }), extra: (i) => (i.avgMs ? dur(i.avgMs) : "–") },
      { dim: "entry", tab: "First page", col: "Page", unit: "Visits", by: "visits", items: () => data.entries, label: (i) => ({ main: pageName(i.key), sub: i.key }) },
      { tab: "Last page", col: "Page", unit: "Visits", by: "visits", items: () => data.exits, label: (i) => ({ main: pageName(i.key), sub: i.key }) },
    ]);
    const cap = (k) => (k ? k.charAt(0).toUpperCase() + k.slice(1) : "Unknown");
    panel("vz-tech", "Devices", "What they read on", [
      { dim: "device", tab: "Device", col: "Device", by: "visitors", items: () => data.devices, label: (i) => ({ main: cap(i.key) }), lead: (i) => icon(i.key) },
      { dim: "browser", tab: "Browser", col: "Browser", by: "visitors", items: () => data.browsers, label: (i) => ({ main: i.key }) },
      { dim: "os", tab: "System", col: "System", by: "visitors", items: () => data.systems, label: (i) => ({ main: i.key }) },
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
      // A cell is a filter on its hour.
      row.forEach((v, hr) => grid.append(h("span", { class: "vz-hc pick", role: "button", tabindex: "0", style: `--a:${v ? 0.12 + (v / max) * 0.88 : 0}`, title: `${days[d]} ${String(hr).padStart(2, "0")}:00 · ${num(v)} visits. Click to show only this hour.`,
        onclick: () => addFilter("hour", String(hr).padStart(2, "0")), onkeydown: (e) => { if (e.key === "Enter") addFilter("hour", String(hr).padStart(2, "0")); } })));
    });
    el.replaceChildren(head, grid, h("div", { class: "vz-hl" }, h("span", { text: "Fewer" }), h("i"), h("span", { text: "More" })));
  }

  function insightsList() {
    const ul = $("vz-ins");
    ul.replaceChildren(...data.insights.map((x) => h("li", { class: x.tone }, h("i", { "aria-hidden": "true" }), h("span", { text: x.text }))));
    ul.hidden = !data.insights.length;
  }

  // ---------- technology and network (from the main view) ----------
  const card = (dim) => (data.cards && data.cards[dim]) || [];
  const plain = (dim, tab, col, source, by) => ({
    dim, tab, col, by: by || "visitors", items: source, extraHead: "Share",
    label: (i) => ({ main: valueLabel(dim, i.key), sub: !i.key && RARE.includes(dim) ? "Seen by one visitor only, so not named" : null }),
  });
  // Versions gathered under their system or browser: one stacked bar each, versions as buttons that filter.
  function stacked(id, title, sub, dim, groupDim) {
    const groups = new Map();
    for (const it of card(dim)) {
      const m = /^(.*?) ([\d/]+)$/.exec(it.key), name = m ? m[1] : it.key, ver = m ? m[2] : "–";
      const g = groups.get(name) || { name, total: 0, parts: [] };
      g.total += it.visitors; g.parts.push({ it, ver });
      groups.set(name, g);
    }
    const list = [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 8);
    const all = list.reduce((x, g) => x + g.total, 0) || 1;
    $(id).replaceChildren(
      h("header", null, h("h3", null, title, h("small", { text: sub }))),
      list.length ? h("ul", { class: "vz-stack" }, list.map((g) => h("li", null,
        h("div", { class: "vz-sh" },
          h("button", { type: "button", class: "vz-fb", text: g.name, title: `Show only ${g.name}`, onclick: () => addFilter(groupDim, g.name) }),
          h("span", { class: "vz-v", text: num(g.total) }), h("span", { class: "vz-p", text: `${Math.round((g.total / all) * 100)}%` })),
        h("div", { class: "vz-sb", style: `width:${Math.max(4, (g.total / all) * 100)}%`, role: "img", "aria-label": `${g.name} versions` }, g.parts.map((p, i) => h("span", { style: `flex:${p.it.visitors};--k:${Math.max(18, 100 - i * 16)}%`, title: `${g.name} ${p.ver}: ${num(p.it.visitors)}` }))),
        h("div", { class: "vz-sv2" }, g.parts.slice(0, 6).map((p) => h("button", { type: "button", class: "vz-fb", title: `Show only ${g.name} ${p.ver}`, onclick: () => addFilter(dim, p.it.key) }, h("span", { text: p.ver }), h("small", { text: num(p.it.visitors) }))))))
      ) : h("p", { class: "vz-empty", text: "Nothing yet in this period." }));
  }
  function technology() {
    stacked("vz-t-os", "System", "By version", "osv", "os");
    stacked("vz-t-br", "Browser", "By version", "bv", "browser");
    panel("vz-t-brand", "Phone", "Make, then model; a model is named once two people share it", [
      plain("brand", "Make", "Make", () => card("brand")), plain("model", "Model", "Model", () => card("model")),
    ]);
    panel("vz-t-screen", "Screen", "Width and sharpness", [
      plain("vw", "Width", "Width in pixels", () => card("vw")), plain("dpr", "Pixel density", "Density", () => card("dpr")),
    ]);
    panel("vz-t-theme", "Look", "The theme in use, the phone's own, and the installed app", [
      plain("theme", "Theme chosen", "Theme", () => card("theme")), plain("scheme", "System theme", "System theme", () => card("scheme")), plain("pwa", "Installed app", "How opened", () => card("pwa")),
    ]);
  }
  function network() {
    panel("vz-n-net", "Connection", "How they reach the site", [
      plain("net", "Connection", "Connection", () => card("net")), plain("isp", "Network", "Network", () => card("isp")),
    ]);
    panel("vz-n-lang", "Language and time zone", "A network or time zone is named once two people share it", [
      plain("lang", "Language", "Language", () => card("lang")), plain("tz", "Time zone", "Time zone", () => card("tz")),
    ]);
    const same = (card("tzcheck").find((i) => i.key === "same") || {}).visits || 0, differs = (card("tzcheck").find((i) => i.key === "differs") || {}).visits || 0;
    if (same + differs) $("vz-n-lang").append(h("p", { class: "vz-note-in" }, h("b", { text: `${num(differs)} of ${num(same + differs)}` }),
      " visits come from a time zone that differs from where the network places them: people living away from home, or on a VPN."));
  }

  // ---------- the heavy cards: explorer, speed, behaviour (loaded when scrolled into view) ----------
  const GROUPS = [
    ["Audience", ["source", "country", "region", "city", "returning", "hour"]],
    ["Technology", ["device", "browser", "bv", "os", "osv", "brand", "model", "vw", "dpr", "theme", "scheme", "pwa"]],
    ["Network", ["net", "isp", "lang", "tz", "tzcheck"]],
    ["Behaviour", ["entry", "exit", "page", "kind", "depth", "dwell", "scroll", "flow", "out", "jserror"]],
    ["Speed", ["lcp", "inp", "cls", "ttfb", "load"]],
  ];
  const PIVOTABLE = new Set(["source", "country", "region", "city", "device", "browser", "bv", "os", "osv", "brand", "model", "isp", "lang", "tz", "tzcheck", "vw", "dpr", "net", "theme", "scheme", "pwa", "returning", "hour", "depth", "dwell", "entry", "exit", "page", "kind"]);
  const ex = { dim: "source", dim2: "", sort: "visitors", dir: -1, q: "", pm: "visitors", pivot: null, busy: false };
  const COLS = [
    ["visitors", "Visitors", (i) => i.visitors, num], ["visits", "Visits", (i) => i.visits, num], ["hits", "Views", (i) => i.hits, num],
    ["vpv", "Views per visit", (i) => (i.visits ? i.hits / i.visits : 0), (v) => v.toFixed(1)], ["bounceRate", "Left at once", (i) => i.bounceRate, (v) => `${Math.round(v)}%`],
    ["avgMs", "Time", (i) => i.avgMs, (v) => (v ? dur(v) : "–")], ["share", "Share", (i) => i.share, (v) => `${Math.round(v * 10) / 10}%`],
  ];
  const exportUrl = (what, dim) => `${API}/export?${query({ what, dim })}`;
  function select(label, value, onchange, none) {
    return h("label", { class: "vz-sel" }, h("span", { text: label }),
      h("select", { onchange: (e) => onchange(e.target.value) }, none ? h("option", { value: "", text: none, selected: !value }) : null,
        GROUPS.map(([g, dims]) => h("optgroup", { label: g }, dims.filter((d) => !none || PIVOTABLE.has(d)).map((d) => h("option", { value: d, text: DIM[d] || d, selected: d === value }))))));
  }
  function explorer() {
    const el = $("vz-explorer");
    el.replaceChildren(
      h("header", null, h("h3", null, "Explorer", h("small", { text: "Any measure, sorted and searched; add a second to cross them" })),
        h("div", { class: "vz-dl" }, h("a", { class: "vz-btn", href: exportUrl("table", ex.dim), download: "", text: "Download table (CSV)" }), h("a", { class: "vz-btn", href: exportUrl("visits"), download: "", text: "Download visits (CSV)" }))),
      h("div", { class: "vz-exctl" },
        select("Rows", ex.dim, (v) => { ex.dim = v; if (ex.dim2 === v || !PIVOTABLE.has(v)) ex.dim2 = ""; ex.pivot = null; explorer(); }),
        PIVOTABLE.has(ex.dim) ? select("Columns", ex.dim2, (v) => { ex.dim2 = v; ex.pivot = null; explorer(); }, "None") : null,
        ex.dim2 ? h("label", { class: "vz-sel" }, h("span", { text: "Cells show" }), h("select", { onchange: (e) => { ex.pm = e.target.value; exTable(); } }, [["visitors", "Visitors"], ["visits", "Visits"], ["hits", "Views"]].map(([v, t]) => h("option", { value: v, text: t, selected: v === ex.pm })))) : null,
        h("label", { class: "vz-sel" }, h("span", { text: "Search" }), h("input", { type: "search", value: ex.q, placeholder: "Filter these rows", oninput: (e) => { ex.q = e.target.value; exTable(); } }))),
      h("div", { class: "vz-tw", id: "vz-extable" }));
    if (ex.dim2 && !ex.pivot) loadPivot(); else exTable();
  }
  async function loadPivot() {
    $("vz-extable").replaceChildren(h("p", { class: "vz-empty", text: "Crossing the two…" }));
    const mine = `${ex.dim}|${ex.dim2}`;
    try {
      const r = await fetch(`${API}?${query({ part: "pivot", dim: ex.dim, dim2: ex.dim2 })}`);
      if (mine !== `${ex.dim}|${ex.dim2}`) return;
      if (!r.ok) { $("vz-extable").replaceChildren(h("p", { class: "vz-empty", text: "Crossing two measures reads individual visits, kept for 30 days. Pick a shorter period." })); return; }
      ex.pivot = await r.json();
      exTable();
    } catch { $("vz-extable").replaceChildren(h("p", { class: "vz-empty", text: "Could not load this." })); }
  }
  function exTable() {
    const box = $("vz-extable");
    if (!box || !detail) return;
    const needle = ex.q.trim().toLowerCase();
    if (ex.dim2) {
      const p = ex.pivot;
      if (!p) return;
      const cell = new Map(p.cells.map((c) => [c.r + "\u0000" + c.c, c]));
      const rows = p.rows.filter((r) => !needle || valueLabel(ex.dim, r).toLowerCase().includes(needle));
      box.replaceChildren(rows.length ? h("table", { class: "vz-table" },
        h("thead", null, h("tr", null, h("th", { text: `${DIM[ex.dim]} \\ ${DIM[ex.dim2]}` }), p.cols.map((c) => h("th", { class: "n", text: valueLabel(ex.dim2, c) })))),
        h("tbody", null, rows.map((r) => h("tr", null, h("th", { scope: "row", text: valueLabel(ex.dim, r) }), p.cols.map((c) => { const x = cell.get(r + "\u0000" + c); return h("td", { class: "n", text: x ? num(x[ex.pm]) : "·" }); }))))) : h("p", { class: "vz-empty", text: "Nothing yet in this period." }));
      return;
    }
    const col = COLS.find((c) => c[0] === ex.sort) || COLS[0];
    const items = (detail.dims[ex.dim] || []).filter((i) => !needle || valueLabel(ex.dim, i.key).toLowerCase().includes(needle))
      .sort((a, b) => ex.dir * (col[2](a) - col[2](b)));
    const can = FILTERABLE.includes(ex.dim);
    box.replaceChildren(items.length ? h("table", { class: "vz-table" },
      h("thead", null, h("tr", null, h("th", { text: DIM[ex.dim] || ex.dim }), COLS.map((c) => h("th", { class: "n", "aria-sort": ex.sort === c[0] ? (ex.dir < 0 ? "descending" : "ascending") : "none" },
        h("button", { type: "button", text: c[1] + (ex.sort === c[0] ? (ex.dir < 0 ? " ↓" : " ↑") : ""), onclick: () => { if (ex.sort === c[0]) ex.dir = -ex.dir; else { ex.sort = c[0]; ex.dir = -1; } exTable(); } }))))),
      h("tbody", null, items.map((i) => h("tr", { class: can && i.key ? "pick" : null, tabindex: can && i.key ? "0" : null, onclick: can && i.key ? () => addFilter(ex.dim, i.key) : null,
        onkeydown: can && i.key ? (e) => { if (e.key === "Enter") addFilter(ex.dim, i.key); } : null },
        h("th", { scope: "row", text: valueLabel(ex.dim, i.key) }), COLS.map((c) => h("td", { class: "n", text: !i.key && RARE.includes(ex.dim) && (c[0] === "bounceRate" || c[0] === "avgMs") ? "–" : c[3](c[2](i)) })))))) : h("p", { class: "vz-empty", text: "Nothing yet in this period." }));
  }

  const SPEED = [
    ["lcp", "Largest paint", "When the main content shows"], ["inp", "Responsiveness", "The slowest tap or key press"], ["cls", "Layout shift", "How much the page jumps as it loads"],
    ["ttfb", "Server reply", "Time to the first byte"], ["load", "Page load", "Until everything has loaded"],
  ];
  const fmtV = (metric, v) => (v === null || v === undefined ? "–" : metric === "cls" ? (v / 1000).toFixed(2).replace(/0$/, "") : msFmt(v));
  const tri = (sp) => h("div", { class: "vz-tri", role: "img", "aria-label": `Good ${sp.good}%, needs work ${sp.needs}%, poor ${sp.poor}%` },
    h("i", { class: "g", style: `flex:${sp.good}`, title: `Good ${sp.good}%` }), h("i", { class: "n", style: `flex:${sp.needs}`, title: `Needs work ${sp.needs}%` }), h("i", { class: "p", style: `flex:${sp.poor}`, title: `Poor ${sp.poor}%` }));
  function speed() {
    const sp = detail.speed;
    const any = SPEED.some(([k]) => sp[k].n);
    putKids($("vz-speed"),
      h("header", null, h("h3", null, "Speed", h("small", { text: "What people felt; the figures are about, from coarse buckets" }))),
      any ? h("ul", { class: "vz-sp" }, SPEED.filter(([k]) => sp[k].n).map(([k, name, what]) => {
        const x = sp[k];
        const dev = Object.entries(x.byDevice).map(([d, y]) => `${cap(d)} about ${fmtV(k, y.p75)}`).join(" · ");
        return h("li", null,
          h("div", { class: "vz-sph" }, h("b", { text: name }), h("span", { class: "vz-spv", text: `about ${fmtV(k, x.p75)}` }), h("small", { text: `75 in 100 loads were faster` })),
          tri(x),
          h("small", { class: "vz-spn", text: `${what}. Good ${x.good}% · Needs work ${x.needs}% · Poor ${x.poor}% · ${num(x.n)} page views${dev ? ` · ${dev}` : ""}` }));
      })) : h("p", { class: "vz-empty", text: "No speed readings yet in this period. They arrive as pages are left." }),
      detail.slowPages.length ? h("div", { class: "vz-slow" }, h("h4", { text: "Slowest pages, by largest paint" }), h("ol", { class: "vz-rows" }, detail.slowPages.map((p) => h("li", { class: "vz-flat" },
        h("span", { class: "vz-l" }, h("span", { class: "vz-lt", text: pageName(p.page) }), h("small", { text: `${p.page} · ${num(p.n)} page views` })),
        h("span", { class: "vz-v", text: `about ${fmtV("lcp", p.p75)}` }), h("span", { class: "vz-p", text: "" }))))) : null);
  }
  function behaviour() {
    const d = detail.dims;
    panel("vz-b-hist", "How far people go", "Pages per visit, visit length, scroll depth", [
      { tab: "Pages per visit", col: "Pages", unit: "Visits", by: "visits", items: () => d.depth, label: (i) => ({ main: valueLabel("depth", i.key) }) },
      { tab: "Visit length", col: "Time", unit: "Visits", by: "visits", items: () => d.dwell, label: (i) => ({ main: i.key }) },
      { tab: "Scroll depth", col: "Read to", unit: "Page views", by: "hits", items: () => d.scroll, label: (i) => ({ main: i.key === "100" ? "The end" : `${i.key}%` }) },
    ]);
    panel("vz-b-flow", "Where they go next", "Page to page, links out, and browser errors", [
      { wrap: true, tab: "Page to page", col: "From → to", unit: "Times", by: "hits", items: () => d.flow.slice(0, 12), label: (i) => ({ main: valueLabel("flow", i.key) }) },
      { tab: "Links out", col: "Site", unit: "Clicks", by: "hits", items: () => d.out, label: (i) => ({ main: i.key }) },
      { wrap: true, tab: "Errors", col: "Message", unit: "Times", by: "hits", items: () => d.jserror, label: (i) => ({ main: valueLabel("jserror", i.key), sub: pageName(i.key.split("|")[0]) }) },
    ]);
  }
  // The heavy cards read one extra answer from the server, fetched the first time any of them scrolls into view.
  let wanted = false, tok = 0;
  const heavyPlaceholder = () => { for (const id of ["vz-explorer", "vz-speed"]) $(id).replaceChildren(h("p", { class: "vz-empty", text: "Loading…" })); };
  async function loadDetail() {
    const mine = ++tok;
    try {
      const r = await fetch(`${API}?${query({ part: "detail" })}`);
      if (mine !== tok || !r.ok) return;
      detail = await r.json();
      explorer(); speed(); behaviour();
    } catch {}
  }
  function wantHeavy() { if (wanted) return; wanted = true; heavyPlaceholder(); loadDetail(); }
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
      // "Samsung · Android 14 · Chrome 131 · Reliance Jio · 4G"; older visits only know the browser and system.
      h("span", null, icon(v.device), [v.brand, v.osv || v.os, v.bv || v.browser, v.isp, v.net ? valueLabel("net", v.net) : ""].filter(Boolean).join(" · ")));
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
    const r = await fetch(`${API}/visits` + (before ? `?before=${before}` : ""));
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
      const r = await fetch(`${API}/live`);
      if (!r.ok) return;
      const d = await r.json();
      $("vz-now").textContent = num(d.count);
      $("vz-live").classList.toggle("on", d.count > 0);
      $("vz-livepanel").replaceChildren(h("header", null, h("h3", null, "Right now", h("small", { text: "Last five minutes, refreshed every 20 seconds" }))),
        d.visits.length ? h("ol", { class: "vz-vlist" }, d.visits.map((v) => visitRow(v, true))) : h("p", { class: "vz-empty", text: "Nobody on the site this minute." }));
    } catch {}
  }

  // ---------- loading ----------
  // The view is its query: range, dates, filters, grouping. It lives in the address (#vz=...) so a view can be bookmarked.
  function query(extra) {
    const p = new URLSearchParams();
    p.set("range", range);
    if (range === "custom") { p.set("from", from); p.set("to", to); }
    for (const f of filters) p.append("f", `${f.dim}:${f.key}`);
    if (gran) p.set("g", gran);
    for (const [k, v] of Object.entries(extra || {})) if (v) p.set(k, v);
    return p.toString();
  }
  function writeHash() { try { history.replaceState(null, "", `${location.pathname}${location.search}#vz=${encodeURIComponent(query() + (cmp ? "" : "&cmp=0"))}`); } catch {} }
  function readHash() {
    try {
      if (!location.hash.startsWith("#vz=")) return;
      const p = new URLSearchParams(decodeURIComponent(location.hash.slice(4)));
      const r = p.get("range");
      if (["today", "7", "30", "90", "custom"].includes(r)) range = r;
      if (range === "custom") { from = p.get("from") || ""; to = p.get("to") || ""; if (!from || !to) range = "7"; }
      filters = p.getAll("f").map((f) => ({ dim: f.slice(0, f.indexOf(":")), key: f.slice(f.indexOf(":") + 1) })).filter((f) => FILTERABLE.includes(f.dim));
      gran = ["hour", "day", "week"].includes(p.get("g")) ? p.get("g") : null;
      cmp = p.get("cmp") !== "0";
    } catch {}
  }
  const note = (text) => { const n = $("vz-note"); n.textContent = text || ""; n.hidden = !text; };
  function filterBar() {
    const el = $("vz-filters");
    el.hidden = !filters.length;
    el.replaceChildren(...(filters.length ? [
      h("span", { class: "vz-fl", text: "Showing only" }),
      ...filters.map((f, i) => h("button", { type: "button", class: "vz-chip", title: "Remove this filter", "aria-label": `Remove filter ${DIM[f.dim] || f.dim}: ${valueLabel(f.dim, f.key)}`, onclick: () => { filters.splice(i, 1); load(); } },
        h("span", { text: `${DIM[f.dim] || f.dim}: ` }), h("b", { text: valueLabel(f.dim, f.key) }), h("i", { "aria-hidden": "true", text: "×" }))),
      h("button", { type: "button", class: "vz-clear", text: "Clear all", onclick: () => { filters = []; load(); } }),
    ] : []));
  }
  // The period, dates, compare and grouping controls always show what the server answered.
  function syncControls() {
    root.querySelectorAll(".vz-seg button[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === range)));
    $("vz-dates").hidden = range !== "custom";
    $("vz-from").value = data.from; $("vz-to").value = data.to;
    $("vz-from").max = $("vz-to").max = data.today;
    $("vz-cmp").setAttribute("aria-pressed", String(cmp));
    root.querySelectorAll("#vz-gran button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.g === data.g)); b.disabled = b.dataset.g === "hour" && spanDays() > 2; });
  }
  async function load() {
    root.setAttribute("aria-busy", "true");
    root.classList.add("loading");
    const mine = ++loadTok;
    filterBar();
    try {
      const r = await fetch(`${API}?${query()}`);
      if (mine !== loadTok) return;
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        note(e.error === "filters_need_raw" ? "Filters read individual visits, which are kept for 30 days. Pick a period inside the last 30 days, or clear the filters." : "This view could not be loaded.");
        return;
      }
      note("");
      data = await r.json();
      kpis(); chart(); insightsList(); panels(); funnel(); actions(); heat(); technology(); network(); syncControls(); writeHash();
      $("vz-sub").textContent = `India time · updated ${clock(data.generated)}`;
      // The heavy cards start again from the new view, but only once they have been scrolled into view.
      detail = null; ex.pivot = null; ++tok;
      if (wanted) { heavyPlaceholder(); loadDetail(); }
    } finally {
      root.setAttribute("aria-busy", "false");
      root.classList.remove("loading");
    }
  }
  let loadTok = 0;
  root.querySelectorAll(".vz-seg button[data-range]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.range === "custom") {
      const t = istDay(Date.now());
      setRange("custom", range === "custom" && from ? from : istDay(Date.now() - 6 * 86400000), range === "custom" && to ? to : t);
    } else setRange(b.dataset.range);
  }));
  const dateChange = () => { const a = $("vz-from").value, b = $("vz-to").value; if (a && b && a <= b) setRange("custom", a, b); else note("Pick a start day that is not after the end day."); };
  $("vz-from").addEventListener("change", dateChange);
  $("vz-to").addEventListener("change", dateChange);
  $("vz-cmp").addEventListener("click", () => { cmp = !cmp; if (data) { kpis(); chart(); syncControls(); writeHash(); } });
  root.querySelectorAll("#vz-gran button").forEach((b) => b.addEventListener("click", () => { gran = b.dataset.g; load(); }));
  // Heavy cards (explorer, speed, behaviour) read their data when first scrolled into view.
  if (window.IntersectionObserver) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); wantHeavy(); } }, { rootMargin: "200px" });
    for (const id of ["vz-explorer", "vz-speed", "vz-b-hist"]) io.observe($(id));
  } else wantHeavy();
  readHash();
  let resizeT = 0;
  new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (data) chart(); }, 120); }).observe($("vz-plot"));
  // review.js calls this once it knows the signed-in reviewer is the owner; nobody else sees the section.
  // The box folds to its heading and the "on the site now" count; the choice is remembered. While it is
  // folded nothing heavy is read: the dashboard loads the first time it is opened.
  const toggle = $("vz-toggle");
  let loaded = false, started = false;
  const remembered = () => { try { return localStorage.getItem("pd:vz") !== "0"; } catch { return true; } };
  function setOpen(open) {
    root.classList.toggle("collapsed", !open);
    toggle.setAttribute("aria-expanded", String(open));
    for (const b of [toggle, $("vz-toggle2")]) { const l = open ? "Hide the dashboard" : "Show the dashboard"; b.setAttribute("aria-label", l); b.title = l; }
    try { localStorage.setItem("pd:vz", open ? "1" : "0"); } catch {}
    if (open && !loaded) { loaded = true; load().then(() => loadVisits(null)); }
    else if (open && data) chart();
  }
  toggle.addEventListener("click", () => setOpen(root.classList.contains("collapsed")));
  // The floating ^ folds the box and brings its heading back into view.
  $("vz-toggle2").addEventListener("click", () => { setOpen(false); root.scrollIntoView({ block: "start", behavior: "smooth" }); });
  // The floating ^ appears only once the heading has scrolled out of view.
  if (window.IntersectionObserver) new IntersectionObserver(([e]) => root.classList.toggle("away", !e.isIntersecting)).observe(root.querySelector(".vz-top"));
  // A folded bar opens with a tap anywhere on it.
  root.addEventListener("click", (e) => { if (root.classList.contains("collapsed") && e.target.closest(".vz-top") && !e.target.closest("button")) setOpen(true); });
  window.pdVisitors = () => {
    if (started) return;
    started = true;
    root.hidden = false;
    setOpen(remembered());
    loadLive();
    setInterval(() => { if (document.visibilityState === "visible") loadLive(); }, 20000);
  };
})();
