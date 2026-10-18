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
  // Older Android browsers have no crypto.randomUUID; the id only has to be unique enough.
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  }));
  if (!phoneId) { phoneId = newId(); store.set("phone", phoneId); }
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
      if (!sessionP) sessionP = getSession().finally(() => { sessionP = null; });
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
      if (window.pdTrack) window.pdTrack("card");
    } catch (e) {
      current = null;
      $("sentence").textContent = "";
      $("send").disabled = false;
      // The challenge and the session are not the visitor's connection. Say so, so a reload is the obvious next step.
      const blocked = e && (e.message === "turnstile" || e.message === "session");
      status(tBoth(blocked ? "verifyFailed" : "offline"));
    } finally {
      $("skip").disabled = false;
    }
  }

  // The name ask appears in the card the contributor is using, right after their first entry
  // there, and comes back for the next one until they give a name or turn it down. Saving it
  // stamps the entry that brought the ask up as well, through /api/name.
  const named = () => store.get("name", "") || store.get("noName", false);
  function askName(from) {
    if (named()) return;
    const box = $("ask-name");
    const host = from && from.closest("section.card");
    if (host && host !== box.parentElement) host.append(box);
    box.hidden = false;
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
        if (window.pdTrack) window.pdTrack("answer");
        const n = store.get(todayKey(), 0) + 1;
        store.set(todayKey(), n); showToday(); refreshMe();
        status(n % 5 === 0 ? tBoth("thanks") : "", true);
        askName($("send"));
      }
      $("paite").value = ""; $("explanation").value = "";
      next();
    } catch {
      status(tBoth("offline"));
      if (window.pdTrack) window.pdTrack("blocked", { path: "answer" });
      $("send").disabled = false; $("skip").disabled = false;
    }
  });

  // Give the Meaning: the page shows one word from the list, the contributor writes what it means.
  let meaningWord = null;
  const ms = (m, ok = false) => { $("m-status").innerHTML = m; $("m-status").className = "status " + (ok ? "ok" : m ? "err" : ""); };
  async function nextMeaning() {
    try {
      const r = await api("/api/word/next");
      if (r.status === 204) { meaningWord = null; $("m-word").textContent = t("noWord"); return; }
      if (!r.ok) { meaningWord = null; $("m-word").textContent = ""; return; }
      meaningWord = await r.json();
      $("m-word").textContent = meaningWord.paite;
    } catch { meaningWord = null; }
  }
  $("meaning-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const english = $("m-english").value.trim();
    if (!meaningWord) return;
    if (!english) { $("m-english").focus(); return; }
    $("m-send").disabled = true;
    try {
      const r = await api("/api/word/meaning", { method: "POST",
        body: JSON.stringify({ id: meaningWord.id, english, note: $("m-note").value.trim(), name: store.get("name", "") }) });
      if (r.ok) { ms(tBoth("wordThanks"), true); $("meaning-form").reset(); refreshMe(); nextMeaning(); askName($("m-send")); }
      else ms(tBoth(r.status === 429 ? "tooFast" : "offline"));
    } catch { ms(tBoth("offline")); }
    $("m-send").disabled = false;
  });
  nextMeaning();

  $("word-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const w = (id) => $(id).value.trim(), ws = (m, ok = false) => { $("w-status").innerHTML = m; $("w-status").className = "status " + (ok ? "ok" : m ? "err" : ""); };
    if (!w("w-paite")) { $("w-paite").focus(); return; }
    if (!w("w-english")) { $("w-english").focus(); return; }
    $("w-send").disabled = true;
    try {
      const r = await api("/api/word", { method: "POST", body: JSON.stringify({ paite: w("w-paite"), english: w("w-english"), note: w("w-note"), name: store.get("name", "") }) });
      if (r.ok) { ws(tBoth("wordThanks"), true); $("word-form").reset(); refreshMe(); askName($("w-send")); } else ws(tBoth(r.status === 429 ? "tooFast" : "offline"));
    } catch { ws(tBoth("offline")); }
    $("w-send").disabled = false;
  });

  $("skip").addEventListener("click", async () => {
    if (current) { try { await api("/api/skip", { method: "POST", body: JSON.stringify({ sentenceId: current.id }) }); } catch {} }
    $("explanation").value = "";
    status("");
    next();
  });

  $("save-name").addEventListener("click", async () => {
    const v = $("name").value.trim().slice(0, 60);
    if (!v) { store.set("noName", true); $("ask-name").hidden = true; return; }
    store.set("name", v);
    $("ask-name").hidden = true;
    try { await api("/api/name", { method: "POST", body: JSON.stringify({ name: v }) }); } catch {}
  });
  $("no-name").addEventListener("click", () => { store.set("noName", true); $("ask-name").hidden = true; });

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

  const cap = (v) => v.charAt(0).toLocaleUpperCase() + v.slice(1);
  // Paite puts the number after the noun (thuvual 8), English puts it before (8 Sentences).
  function shareCounts() {
    const pairs = [];
    if (total > 0) pairs.push([S.sentences.pai ? `${cap(S.sentences.pai)} ${total} toh` : null, `${total} Sentence${total === 1 ? "" : "s"}`]);
    if (words > 0) pairs.push([S.words.pai ? `${cap(S.words.pai)} ${words}` : null, `${words} Word${words === 1 ? "" : "s"}`]);
    return {
      pai: pairs.map((p) => p[0]).filter(Boolean).join(" ").trim(),
      en: pairs.map((p) => p[1]).join(" and "),
    };
  }
  async function shareCard() {
    await document.fonts.ready;
    const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
    const g = c.getContext("2d"), css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue("--bg") || "#f7f4ef"; g.fillRect(0, 0, 1080, 1920);
    // The header band is the shawl artwork: draw the picture straight into the card.
    const band = document.querySelector("img.puan");
    const img = new Image();
    img.src = band.currentSrc || band.src;
    await img.decode(); g.drawImage(img, 0, 0, 1080, 231);
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
    const counts = shareCounts();
    g.fillStyle = css.getPropertyValue("--accent") || "#b0102e";
    if (counts.pai) y = wrap(counts.pai, y + 80, `700 52px ${body}`, 70);
    if (counts.en) { g.fillStyle = css.getPropertyValue("--fg") || "#1b1616"; y = wrap(counts.en, y + (counts.pai ? 24 : 80), `700 52px ${body}`, 70); }
    // The invitation to post this as a status, then the address.
    g.fillStyle = css.getPropertyValue("--fg") || "#1b1616";
    if (S.share.pai) { y = wrap(S.share.pai, 1560, `700 46px ${body}`, 58); g.fillStyle = css.getPropertyValue("--muted") || "#625755"; }
    wrap(S.share.en, y + 14, `38px ${body}`, 48);
    g.fillStyle = css.getPropertyValue("--muted") || "#625755";
    wrap("paite.lamkalabs.com", 1810, `34px ${body}`, 44);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    const file = new File([blob], "paite-daily.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: `${S.share.en} https://paite.lamkalabs.com` }); } catch (e) { if (e.name !== "AbortError") { download(blob); status(tBoth("shareFailed")); } }
    } else download(blob);
  }
  function download(blob) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "paite-daily.png"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  let total = 0, words = 0;
  async function refreshMe() {
    try {
      const r = await api("/api/me");
      if (!r.ok) return;
      const me = await r.json();
      total = me.total; words = me.words || 0;
      $("badge").textContent = me.badge || ""; $("badge").hidden = !me.badge;
      $("share").hidden = total + words < 5;
    } catch {}
  }
  $("share").addEventListener("click", () => shareCard().catch(() => status(tBoth("shareError"))));

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
