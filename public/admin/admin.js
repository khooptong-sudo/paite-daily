// Admin pages: sign-in (login.html) and the dashboard (index.html). Every write sends X-Admin,
// which the server requires on top of its SameSite=Strict cookie. Nothing from the server is
// inserted as HTML; text goes in with textContent.
(() => {
  const $ = (id) => document.getElementById(id);
  const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json", "X-Admin": "1" }, body: JSON.stringify(body || {}) });
  const say = (el, text, ok) => { el.textContent = text; el.classList.toggle("err", !ok); el.classList.toggle("ok", !!ok); };

  // ---------- sign-in page ----------
  if ($("login-form")) {
    const token = (location.hash.match(/^#set=([0-9a-f]{64})$/) || [])[1];
    if (token) { $("signin").hidden = true; $("choose").hidden = false; history.replaceState(null, "", location.pathname); }
    $("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await post("/admin/api/login", { email: $("email").value, password: $("password").value });
      if (r.ok) { location.href = "/admin/"; return; }
      say($("login-status"), r.status === 429 ? "Too many tries. Wait a few minutes." : "That email and password do not match an admin.", false);
    });
    $("send-link").addEventListener("click", async () => {
      if (!$("email").value) { say($("login-status"), "Type your email first.", false); return; }
      const r = await post("/admin/api/password/link", { email: $("email").value });
      say($("login-status"), r.status === 429 ? "Too many links asked for. Wait a few minutes." : "If that email belongs to an admin, a link is on its way. Check your inbox.", r.ok);
    });
    $("set-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await post("/admin/api/password/set", { token, password: $("new-password").value });
      if (r.ok) { location.href = "/admin/"; return; }
      const d = await r.json().catch(() => ({}));
      say($("set-status"), d.error === "weak_password" ? "Use at least 8 characters." : "That link has expired or was already used. Ask for a new one.", false);
    });
    return;
  }

  // ---------- dashboard ----------
  let presets = [];
  const when = (ms) => new Date(ms).toLocaleString();
  function showAI(d) {
    presets = d.presets || presets;
    const sel = $("provider");
    if (!sel.options.length) for (const p of presets) { const o = document.createElement("option"); o.value = p.id; o.textContent = p.label; sel.append(o); }
    const st = $("ai-state");
    if (d.source === "dashboard") { st.textContent = `In use: ${d.provider} · ${d.model} · key ending ${d.keyHint} · saved by ${d.updatedBy} on ${when(d.updatedAt)}`; st.className = "adm-state on"; }
    else if (d.source === "env") { st.textContent = `In use: DeepSeek from the server secret (key ending ${d.keyHint}). Saving here takes over from it.`; st.className = "adm-state on"; }
    else { st.textContent = "No AI is set up. The chat answers by word matching only, and new sentences, reviewer notes and Check English are off."; st.className = "adm-state off"; }
    sel.value = d.provider || "deepseek";
    fill(d.source === "dashboard" ? d : null);
  }
  function fill(saved) {
    const p = presets.find((x) => x.id === $("provider").value) || presets[0];
    const custom = p.id === "custom";
    $("base-url").value = saved && saved.provider === p.id ? saved.baseUrl : p.baseUrl;
    $("base-url").readOnly = !custom;
    $("model").value = saved && saved.provider === p.id ? saved.model : p.model;
    $("key").value = "";
  }
  async function loadAdmins() {
    const r = await fetch("/admin/api/admins");
    if (!r.ok) return;
    const ul = $("admins"); ul.textContent = "";
    const { admins } = await r.json();
    if (!admins.length) { const li = document.createElement("li"); li.textContent = "No admins yet. You are the only one with access."; ul.append(li); }
    for (const a of admins) {
      const li = document.createElement("li"), span = document.createElement("span"), small = document.createElement("small"), btn = document.createElement("button");
      span.textContent = a.email; small.textContent = `Added by ${a.added_by} on ${when(a.added_at)}`; span.append(small);
      btn.type = "button"; btn.textContent = "Remove";
      btn.addEventListener("click", async () => { if (!confirm(`Remove ${a.email} as an admin?`)) return; await post("/admin/api/admins/remove", { email: a.email }); loadAdmins(); });
      li.append(span, btn); ul.append(li);
    }
  }
  (async () => {
    const me = await fetch("/admin/api/me");
    if (me.status === 401) { location.href = "/admin/login"; return; }
    const m = await me.json();
    $("who").textContent = `${m.email}${m.superuser ? " · owner" : " · admin"}`;
    $("dash").hidden = false;
    showAI(await (await fetch("/admin/api/ai")).json());
    if (m.superuser) { $("admins-card").hidden = false; loadAdmins(); }
  })();
  $("provider").addEventListener("change", () => fill(null));
  $("ai-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await post("/admin/api/ai", { provider: $("provider").value, baseUrl: $("base-url").value, model: $("model").value, key: $("key").value });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { showAI(d); say($("ai-status"), "Saved. Test it to be sure the key works.", true); }
    else say($("ai-status"), d.message || { bad_model: "That model name has characters it cannot have.", bad_key: "That does not look like an API key.", bad_provider: "Pick a provider." }[d.error] || "Could not save.", false);
  });
  $("test").addEventListener("click", async () => {
    say($("ai-status"), "Testing…", true);
    const d = await (await post("/admin/api/ai/test")).json();
    say($("ai-status"), d.ok ? `Working: ${d.provider} · ${d.model} answered in ${d.ms} ms.` : d.error, d.ok);
  });
  $("clear").addEventListener("click", async () => {
    if (!confirm("Remove the saved key? The site falls back to the server secret if there is one, otherwise AI features stop.")) return;
    showAI(await (await post("/admin/api/ai/clear")).json());
    say($("ai-status"), "Removed.", true);
  });
  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await post("/admin/api/admins/add", { email: $("add-email").value });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { $("add-email").value = ""; say($("add-status"), "Added. They have an email with a link to choose a password.", true); loadAdmins(); }
    else say($("add-status"), { bad_email: "That is not an email address.", already_owner: "That is the owner's email." }[d.error] || "Could not add.", false);
  });
  $("sign-out").addEventListener("click", async () => { await post("/admin/api/logout"); location.href = "/admin/login"; });
})();
