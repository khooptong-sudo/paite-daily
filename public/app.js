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

  async function next() {
    $("sentence").innerHTML = tBoth("loading");
    $("send").disabled = true;
    $("skip").disabled = true;
    try {
      const r = await api("/api/next");
      if (r.status === 204) { current = null; $("sentence").innerHTML = tBoth("empty"); return; }
      current = await r.json();
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
        body: JSON.stringify({ sentenceId: current.id, paite, register, name: store.get("name", "") }) });
      if (r.status === 429) { status(tBoth("tooFast")); $("send").disabled = false; $("skip").disabled = false; return; }
      if (!r.ok && r.status !== 409) { status(tBoth("offline")); $("send").disabled = false; $("skip").disabled = false; return; }
      if (r.ok) {
        const n = store.get(todayKey(), 0) + 1;
        store.set(todayKey(), n); showToday();
        status(n % 5 === 0 ? tBoth("thanks") : "", true);
        if (!store.get("askedName", false)) { store.set("askedName", true); $("ask-name").hidden = false; }
      }
      $("paite").value = "";
      next();
    } catch {
      status(tBoth("offline"));
      $("send").disabled = false; $("skip").disabled = false;
    }
  });

  $("skip").addEventListener("click", async () => {
    if (current) { try { await api("/api/skip", { method: "POST", body: JSON.stringify({ sentenceId: current.id }) }); } catch {} }
    status("");
    next();
  });

  $("save-name").addEventListener("click", () => { store.set("name", $("name").value.trim().slice(0, 60)); $("ask-name").hidden = true; $("paite").focus(); });
  $("no-name").addEventListener("click", () => { $("ask-name").hidden = true; $("paite").focus(); });

  showToday();
  next();
})();
