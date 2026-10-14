(() => {
  const S = window.STRINGS;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("pd:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("pd:" + k, JSON.stringify(v)); } catch {} },
  };
  const t = (key) => (S[key].pai ? `${S[key].pai}` : S[key].en);
  const tBoth = (key) => (S[key].pai ? `${S[key].pai}<small>${S[key].en}</small>` : S[key].en);

  document.querySelectorAll("[data-s]").forEach((el) => { el.innerHTML = tBoth(el.dataset.s); });
  $("explanation").placeholder = t("explanationHint");

  let phoneId = store.get("phone", null);
  if (!phoneId) { phoneId = crypto.randomUUID(); store.set("phone", phoneId); }
  let session = null, current = null;

  const status = (msg, ok = false) => { $("status").innerHTML = msg; $("status").className = "status " + (ok ? "ok" : msg ? "err" : ""); };
  const todayKey = () => "count:" + new Date().toISOString().slice(0, 10);
  const showToday = () => { const n = store.get(todayKey(), 0); $("today").textContent = n ? `🔥 ${n} ${t("today")}` : ""; };

  // Defined before the deferred Turnstile script runs (this file is a plain script at the end of <body>).
  const turnstileReady = new Promise((res) => { window.onTurnstileLoad = res; });
  let widgetId = null, waiter = null;

  function turnstileToken() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (waiter === me) waiter = null; reject(new Error("turnstile timeout")); }, 15000);
      const me = waiter = {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      turnstileReady.then(() => {
        if (widgetId === null) {
          widgetId = window.turnstile.render("#turnstile", {
            sitekey: document.documentElement.dataset.sitekey,
            appearance: "interaction-only",
            callback: (v) => waiter && waiter.resolve(v),
            "error-callback": () => waiter && waiter.reject(new Error("turnstile")),
          });
        } else {
          window.turnstile.reset(widgetId);
        }
      }).catch((e) => waiter && waiter.reject(e));
    });
  }

  let sessionP = null;
  async function getSession() {
    const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneId, turnstileToken: await turnstileToken() }) });
    if (!r.ok) throw new Error("session");
    return (await r.json()).session;
  }

  async function api(path, opts = {}, retried = false) {
    if (!session) {
      sessionP ??= getSession().finally(() => { sessionP = null; });
      session = await sessionP;
    }
    const r = await fetch(path, { ...opts, headers: { "content-type": "application/json", "X-Session": session } });
    if (r.status === 401 && !retried) { session = null; return api(path, opts, true); }
    return r;
  }

  // Empty pool with a refill running: poll every 5 s for up to 60 s, then show the empty text and Retry.
  let pollTimer = null, pollUntil = 0;
  const giveUp = () => { clearTimeout(pollTimer); current = null; $("sentence").innerHTML = tBoth("empty"); $("retry").hidden = false; };
  document.addEventListener("visibilitychange", () => { if (document.hidden && pollTimer) giveUp(); });
  $("retry").addEventListener("click", () => next());

  async function next(polling = false) {
    clearTimeout(pollTimer); pollTimer = null; $("retry").hidden = true;
    if (!polling) $("sentence").innerHTML = tBoth("loading");
    $("send").disabled = true;
    $("skip").disabled = true;
    try {
      const r = await api("/api/next");
      if (r.status === 202) {
        current = null;
        if (!polling) pollUntil = Date.now() + 60000;
        $("sentence").innerHTML = tBoth("refilling");
        pollTimer = setTimeout(() => { pollTimer = null; if (document.hidden || Date.now() >= pollUntil) giveUp(); else next(true); }, 5000);
        return;
      }
      if (r.status === 204) { giveUp(); return; }
      current = await r.json();
      const rev = current.direction === "pai2en";
      $("label").innerHTML = tBoth(rev ? "reverseTitle" : "translate");
      $("paite").setAttribute("aria-label", rev ? "English" : "Paite");
      document.querySelector(".register").hidden = rev;
      $("sentence").textContent = current.english;
      $("send").disabled = false;
      $("paite").focus();
    } catch {
      current = null;
      $("sentence").textContent = "";
      $("send").disabled = false;
      status(tBoth("offline"));
    } finally {
      $("skip").disabled = false;
    }
  }

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const paite = $("paite").value.trim();
    if (!current) { next(); return; }
    if (!paite) { $("paite").focus(); return; }
    $("send").disabled = true; $("skip").disabled = true;
    const register = new FormData($("form")).get("register");
    try {
      const r = await api("/api/answer", { method: "POST",
        body: JSON.stringify({ sentenceId: current.id, paite, register, name: store.get("name", ""), explanation: $("explanation").value.trim() }) });
      if (r.status === 429) { status(tBoth("tooFast")); $("send").disabled = false; $("skip").disabled = false; return; }
      if (!r.ok && r.status !== 409) { status(tBoth("offline")); $("send").disabled = false; $("skip").disabled = false; return; }
      if (r.ok) {
        const n = store.get(todayKey(), 0) + 1;
        store.set(todayKey(), n); showToday(); refreshMe();
        status(n % 5 === 0 ? tBoth("thanks") : "", true);
        if (!store.get("askedName", false)) { store.set("askedName", true); $("ask-name").hidden = false; }
      }
      $("paite").value = ""; $("explanation").value = "";
      next();
    } catch {
      status(tBoth("offline"));
      $("send").disabled = false; $("skip").disabled = false;
    }
  });

  $("word-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const w = (id) => $(id).value.trim(), ws = (m, ok = false) => { $("w-status").innerHTML = m; $("w-status").className = "status " + (ok ? "ok" : m ? "err" : ""); };
    if (!w("w-paite")) { $("w-paite").focus(); return; }
    if (!w("w-english")) { $("w-english").focus(); return; }
    $("w-send").disabled = true;
    try {
      const r = await api("/api/word", { method: "POST", body: JSON.stringify({ paite: w("w-paite"), english: w("w-english"), note: w("w-note"), name: store.get("name", "") }) });
      if (r.ok) { ws(tBoth("wordThanks"), true); $("word-form").reset(); } else ws(tBoth(r.status === 429 ? "tooFast" : "offline"));
    } catch { ws(tBoth("offline")); }
    $("w-send").disabled = false;
  });

  $("skip").addEventListener("click", async () => {
    if (current) { try { await api("/api/skip", { method: "POST", body: JSON.stringify({ sentenceId: current.id }) }); } catch {} }
    $("explanation").value = "";
    status("");
    next();
  });

  $("save-name").addEventListener("click", () => { store.set("name", $("name").value.trim().slice(0, 60)); $("ask-name").hidden = true; $("paite").focus(); });
  $("no-name").addEventListener("click", () => { $("ask-name").hidden = true; $("paite").focus(); });

  async function feedback() {
    try {
      const { items } = await (await api("/api/feedback?after=" + store.get("fbSeen", 0))).json();
      if (!items.length) return;
      const div = (cls, key, node) => {
        const d = document.createElement("div"); d.className = cls;
        if (key) { const l = document.createElement("small"); l.innerHTML = tBoth(key); d.append(l); }
        if (node) d.append(node);
        return d;
      };
      for (const it of items) {
        const li = document.createElement("li");
        li.append(div("en", null, it.english), div("", "yours", it.yours));
        if (it.result === "correct") li.append(div("ok", "correct", "✓"));
        else if (it.result === "retry") { const d = div("", null); d.innerHTML = tBoth("retry"); li.append(d); }
        else { const m = document.createElement("mark"); m.textContent = it.corrected; li.append(div("", it.result === "fixed" ? "corrected" : "other", m)); }
        if (it.note) li.append(div("", "note", it.note));
        $("fb-list").append(li);
      }
      $("fb-ok").onclick = () => { store.set("fbSeen", Math.max(...items.map((i) => i.reviewId))); $("feedback").hidden = true; };
      $("feedback").hidden = false;
    } catch {}
  }

  const shareText = "https://paite.lamkalabs.com";
  async function shareCard(total) {
    await document.fonts.ready;
    const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
    const g = c.getContext("2d"), css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue("--bg") || "#f7f4ef"; g.fillRect(0, 0, 1080, 1920);
    // The header band is an inline SVG: serialise it and draw it as an image.
    const svg = document.querySelector("svg.puan").cloneNode(true);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg"); svg.setAttribute("width", 1080); svg.setAttribute("height", 118);
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
    await img.decode(); g.drawImage(img, 0, 0, 1080, 118); URL.revokeObjectURL(img.src);
    const display = css.getPropertyValue("--display"), body = css.getPropertyValue("--body");
    g.textAlign = "center"; g.fillStyle = css.getPropertyValue("--fg") || "#1b1616";
    const wrap = (text, y, font, lh) => {
      g.font = font; let line = "";
      for (const w of text.split(" ")) {
        if (line && g.measureText(line + " " + w).width > 920) { g.fillText(line, 540, y); y += lh; line = w; } else line = line ? line + " " + w : w;
      }
      g.fillText(line, 540, y); return y + lh;
    };
    let y = wrap(S.shareLine.pai || S.shareLine.en, 520, `72px ${display}`, 90);
    if (S.shareLine.pai) y = wrap(S.shareLine.en, y + 20, `44px ${body}`, 60);
    g.fillStyle = css.getPropertyValue("--accent") || "#b0102e";
    y = wrap(`${total} ${S.sentences.pai || S.sentences.en}${S.sentences.pai ? " / " + total + " " + S.sentences.en : ""}`, y + 80, `700 52px ${body}`, 70);
    g.fillStyle = css.getPropertyValue("--muted") || "#625755";
    wrap("paite.lamkalabs.com", 1760, `40px ${body}`, 50);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    const file = new File([blob], "paite-daily.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareText }); } catch (e) { if (e.name !== "AbortError") { download(blob); status(tBoth("shareFailed")); } }
    } else download(blob);
  }
  function download(blob) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "paite-daily.png"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  let total = 0;
  async function refreshMe() {
    try {
      const r = await api("/api/me");
      if (!r.ok) return;
      const me = await r.json();
      total = me.total;
      $("badge").textContent = me.badge || ""; $("badge").hidden = !me.badge;
      $("share").hidden = total < 5;
    } catch {}
  }
  $("share").addEventListener("click", () => shareCard(total).catch(() => status(tBoth("shareError"))));

  async function showGoal() {
    try {
      const r = await fetch("/api/goal");
      if (!r.ok) return;
      const g = await r.json();
      $("goal-n").textContent = g.verified; $("goal-max").textContent = g.goal;
      $("goal-bar").setAttribute("aria-valuemax", g.goal); $("goal-bar").setAttribute("aria-valuenow", g.verified);
      $("goal-bar").firstChild.style.width = Math.min(100, Math.round((g.verified / g.goal) * 100)) + "%";
      $("goal").hidden = false;
    } catch {}
  }

  showToday();
  showGoal();
  next();
  refreshMe();
  feedback();
})();

// Coffee button: phones follow the UPI link; desktop opens the QR panel instead.
(() => {
  const a = document.getElementById("coffee"), p = document.getElementById("upi");
  if (!a || !p) return;
  a.addEventListener("click", (e) => {
    if (matchMedia("(pointer: coarse), (max-width: 640px)").matches) return;
    e.preventDefault();
    p.hidden = !p.hidden;
    a.setAttribute("aria-expanded", String(!p.hidden));
  });
  document.getElementById("upi-copy").addEventListener("click", async () => {
    const id = document.getElementById("upi-id");
    try { await navigator.clipboard.writeText(id.textContent); } catch {
      const r = document.createRange(); r.selectNodeContents(id);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  });
})();
