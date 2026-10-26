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
  // Where you learned it: optional, kept on this phone so it is typed once.
  $("place").value = store.get("place", "");
  $("place").addEventListener("change", () => store.set("place", $("place").value.trim()));

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
  // Both scripts are deferred and Turnstile comes first, so it may already be here.
  const turnstileReady = new Promise((res) => { if (window.turnstile) res(); else window.onTurnstileLoad = res; });
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
    const r = await fetch(path, { ...opts, headers: { "content-type": "application/json", ...opts.headers, "X-Session": session } });
    if (r.status === 401 && !retried) { session = null; return api(path, opts, true); }
    return r;
  }

  // hear.js records through the same session.
  window.paiteApi = api;

  // Empty pool with a refill running: poll every 5 s for up to 60 s, then show the empty text and Retry.
  let pollTimer = null, pollUntil = 0;
  const giveUp = () => { clearTimeout(pollTimer); current = null; $("sentence").innerHTML = tBoth("empty"); $("retry").hidden = false; };
  document.addEventListener("visibilitychange", () => { if (document.hidden && pollTimer) giveUp(); });
  $("retry").addEventListener("click", () => next());

  // Ask a relative: /?s=<id> opens that sentence; the address is tidied so a reload is a normal visit.
  let sharedId = Number(new URLSearchParams(location.search).get("s")) || null;
  if (sharedId) { const u = new URL(location.href); u.searchParams.delete("s"); history.replaceState(null, "", u); }

  async function next(polling = false) {
    clearTimeout(pollTimer); pollTimer = null; $("retry").hidden = true;
    if (!polling) $("sentence").innerHTML = tBoth("loading");
    $("send").disabled = true;
    $("skip").disabled = true;
    try {
      // A link from Ask a relative (/?s=<id>) asks for that sentence once.
      const r = await api(sharedId ? `/api/next?s=${sharedId}` : "/api/next");
      sharedId = null;
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
      if (window.pdLang) window.pdLang($("paite"), rev ? "en" : "pai");
      document.querySelector(".register").hidden = rev;
      $("sentence").textContent = current.english;
      $("sentence").dataset.id = current.id;
      $("shared-note").hidden = !(current.shared || current.sharedGone);
      $("shared-note").innerHTML = current.shared ? tBoth("sharedHello") : current.sharedGone ? tBoth("sharedGone") : "";
      $("send").disabled = false;
      $("paite").focus();
      if (window.pdTrack) window.pdTrack("card");
    } catch (e) {
      current = null;
      $("sentence").textContent = "";
      $("send").disabled = false;
      // The challenge and the session are not the visitor's connection. Say so, so a reload is the obvious next step.
      const blocked = e && (e.message === "turnstile" || e.message === "session");
      // Offline keeps whatever status is showing, so "Saved on this phone" is not wiped.
      if (blocked || navigator.onLine !== false) status(tBoth(blocked ? "verifyFailed" : "offline"));
      if (!blocked) $("sentence").textContent = "You are offline. Answers you already sent are saved and will go when you are back.";
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

  // Answers typed with no network wait in localStorage and go one by one, oldest first.
  const showOutbox = () => {
    const n = store.get("outbox", []).length;
    $("outbox-note").hidden = !n;
    $("outbox-note").textContent = n ? `${n} waiting to send` : "";
  };
  function queueAnswer(body) {
    store.set("outbox", [...store.get("outbox", []), { body, at: Date.now() }].slice(-50));
    showOutbox();
  }
  let flushing = false;
  async function flushOutbox() {
    if (flushing) return;
    flushing = true;
    let sent = 0;
    try {
      for (;;) {
        const item = store.get("outbox", [])[0];
        if (!item || navigator.onLine === false) break;
        const r = await api("/api/answer", { method: "POST", body: item.body });
        // 400 and 409 will never succeed (bad or closed sentence); 429 and the rest can wait.
        if (!r.ok && r.status !== 400 && r.status !== 409) break;
        store.set("outbox", store.get("outbox", []).slice(1));
        if (r.ok) sent++;
        showOutbox();
      }
    } catch {}
    flushing = false;
    if (sent) { status(`${sent} saved answer${sent === 1 ? "" : "s"} sent.`, true); refreshMe(); }
  }
  window.addEventListener("online", flushOutbox);
  showOutbox();

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const paite = $("paite").value.trim();
    if (!current) { next(); return; }
    if (!paite) { $("paite").focus(); return; }
    $("send").disabled = true; $("skip").disabled = true;
    const register = new FormData($("form")).get("register");
    const body = JSON.stringify({ sentenceId: current.id, paite, register, name: store.get("name", ""), explanation: $("explanation").value.trim(), place: $("place").value.trim() });
    // No network: keep the answer on the phone and carry on as if it had gone.
    const saveOffline = () => {
      queueAnswer(body);
      status("Saved on this phone. It will send by itself when you are back online.", true);
      $("paite").value = ""; $("explanation").value = "";
      next();
    };
    if (navigator.onLine === false) { saveOffline(); return; }
    try {
      const r = await api("/api/answer", { method: "POST", body });
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
      if (r.ok) flushOutbox();
    } catch (err) {
      // fetch throws only when the network fails; a failed challenge or session is not that.
      if (!(err && (err.message === "turnstile" || err.message === "session"))) { saveOffline(); return; }
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

  // Proverbs and idioms: a whole saying pair, entered from either side. It waits for a reviewer.
  document.querySelectorAll("form.saying").forEach((form) => {
    const st = form.querySelector(".status"), btn = form.querySelector("button[type=submit]");
    const say = (m, ok = false) => { st.innerHTML = m; st.className = "status " + (ok ? "ok" : m ? "err" : ""); };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form).entries());
      const text = (k) => String(f[k] ?? "").trim();
      if (!text("paite")) { form.querySelector('[name="paite"]').focus(); return; }
      if (!text("english")) { form.querySelector('[name="english"]').focus(); return; }
      btn.disabled = true;
      try {
        const r = await api("/api/proverb/submit", { method: "POST", body: JSON.stringify({
          direction: form.dataset.dir, kind: f.kind, paite: text("paite"), english: text("english"),
          explainer: text("explainer"), name: store.get("name", ""),
        }) });
        if (r.ok) { say(tBoth("sayingThanks"), true); form.reset(); refreshMe(); askName(btn); }
        else say(tBoth(r.status === 429 ? "tooFast" : "offline"));
      } catch { say(tBoth("offline")); }
      btn.disabled = false;
    });
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
        // Sign the review: the contributor sees who read their sentence.
        if (it.reviewer) { const d = div("", "by"); const s = document.createElement("span"); s.textContent = "— " + it.reviewer; d.append(s); li.append(d); }
        $("fb-list").append(li);
      }
      $("fb-ok").onclick = () => { store.set("fbSeen", Math.max(...items.map((i) => i.reviewId))); $("feedback").hidden = true; };
      $("feedback").hidden = false;
    } catch {}
  }

  // "You: N" in each box. The counts are also kept for /proverbs, which has no session of its own.
  function showCounts(me) {
    const n = { sentences: me.total || 0, words: me.words || 0, meanings: me.meanings || 0, sayings: me.sayings || 0, recordings: me.recordings || 0 };
    store.set("me", n);
    document.querySelectorAll("[data-you]").forEach((el) => { const v = n[el.dataset.you]; el.textContent = "You: " + v; el.hidden = !v; });
  }
  async function refreshMe() {
    try {
      const r = await api("/api/me");
      if (!r.ok) return;
      const me = await r.json();
      $("badge").textContent = me.badge || ""; $("badge").hidden = !me.badge;
      showCounts(me);
      // mypuan.js weaves the personal shawl from these counts.
      document.dispatchEvent(new CustomEvent("paite:me", { detail: me }));
    } catch {}
  }

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
  flushOutbox();
  document.addEventListener("paite:refresh", refreshMe);
})();
