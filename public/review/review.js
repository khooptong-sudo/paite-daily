(() => {
  const $ = (id) => document.getElementById(id);
  let card = null, isOwner = false, undoId = null;

  const status = (m, ok = false) => { $("status").textContent = m; $("status").className = "status " + (ok ? "ok" : m ? "err" : ""); };
  const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function me() {
    try {
      const r = await fetch("/review/api/me");
      if (r.status === 403) { $("english").textContent = "You are not a reviewer. Ask the owner to add your email."; return false; }
      if (!r.ok) { $("english").textContent = "Sign-in needed. Reload the page."; return false; }
      const m = await r.json();
      $("who").textContent = m.name; isOwner = m.owner === true;
      return true;
    } catch { $("english").textContent = "Sign-in needed. Reload the page."; return false; }
  }

  function hideUndo() { undoId = null; $("undo").hidden = true; }
  function showUndo(id) { undoId = id; $("undo").hidden = false; }

  function render() {
    const rev = card.sentence.direction === "pai2en";
    $("dir").textContent = rev ? "Paite to English: translate into English" : "English";
    $("english").textContent = rev ? card.sentence.paite_prompt : card.sentence.english;
    $("orig").hidden = !rev; $("orig").textContent = rev ? "Original English (round trip): " + card.sentence.english : "";
    $("register").parentElement.hidden = rev;
    const multi = card.answers.length > 1;
    const hint = document.createElement("p"); hint.className = "meta"; hint.hidden = !multi;
    hint.textContent = "Press Accept this on the best answer. Tick any other correct answers to keep them as variants.";
    $("answers").replaceChildren(hint, ...card.answers.map((a) => {
      const box = document.createElement("div");
      box.className = "answer";
      const p = document.createElement("p"); p.textContent = a.paite;
      const meta = document.createElement("div"); meta.className = "meta";
      meta.textContent = `${a.register}${a.contributor_name ? " · " + a.contributor_name : ""}`;
      box.append(p, meta);
      if (a.explanation) { const ex = document.createElement("div"); ex.className = "meta"; ex.textContent = a.explanation; box.append(ex); }
      if (a.ai_note) { const ai = document.createElement("div"); ai.className = "ai"; ai.textContent = "AI note (advisory)" + (a.ai_flag ? " [" + (rev && a.ai_flag === "english" ? "not_english" : a.ai_flag) + "]" : "") + ": " + a.ai_note; box.append(ai); }
      const edit = document.createElement("textarea"); edit.value = a.paite; edit.maxLength = 300; edit.setAttribute("aria-label", "Edit before accepting: " + a.paite);
      const also = document.createElement("label"); also.hidden = !multi;
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.dataset.answerId = a.id; cb.setAttribute("aria-label", "Also correct (keep as variant): " + a.paite);
      cb.addEventListener("change", () => box.classList.toggle("variant", cb.checked));
      also.append(cb, " Also correct (keep as variant)");
      const accept = document.createElement("button"); accept.className = "primary"; accept.textContent = "✓ Accept this"; accept.setAttribute("aria-label", "Accept this: " + a.paite); accept.setAttribute("aria-keyshortcuts", "A");
      const hintKey = document.createElement("span"); hintKey.className = "kbd"; hintKey.setAttribute("aria-hidden", "true"); hintKey.textContent = "A"; accept.append(hintKey);
      accept.addEventListener("click", () => send({
        decision: "accept", answerId: a.id,
        finalPaite: edit.value.trim() === a.paite ? undefined : edit.value,
        alsoCorrect: [...document.querySelectorAll("[data-answer-id]:checked")].map((c) => Number(c.dataset.answerId)).filter((id) => id !== a.id),
      }));
      box.append(edit, also, accept);
      return box;
    }));
    const first = $("answers").querySelector(".answer p");
    if (first) { first.tabIndex = -1; first.focus(); } else $("english").focus();
  }

  async function queue() {
    try {
      const r = await fetch("/review/api/queue");
      if (r.ok) $("queue").textContent = (await r.json()).waiting + " waiting";
    } catch {}
  }

  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.isContentEditable || (e.target.matches && e.target.matches("textarea, select, input:not([type=checkbox])"))) return;
    const k = e.key.toLowerCase();
    if (k === "?") $("help").hidden = !$("help").hidden;
    else if (k === "a") { const box = (e.target.closest && e.target.closest(".answer")) || document.querySelector(".answer"); if (box) box.querySelector("button.primary").click(); }
    else if (k === "r") $("reject").click();
    else if (k === "u") { if (!$("undo").hidden) $("undo").click(); }
    else return;
    e.preventDefault();
  });

  async function next(keepStatus = false) {
    queue();
    $("english").textContent = "Loading…";
    try {
      const r = await fetch("/review/api/next");
      if (expired(r)) { card = null; status(EXPIRED); $("english").textContent = EXPIRED; $("answers").replaceChildren(); return; }
      if (r.status === 204) { card = null; if (!keepStatus) { status(""); hideUndo(); } $("english").textContent = "Nothing to review right now. 🎉"; $("answers").replaceChildren(); return; }
      if (!r.ok) { card = null; status(""); hideUndo(); $("english").textContent = "Could not load. Reload the page."; $("answers").replaceChildren(); return; }
      card = await r.json();
      $("note").value = ""; $("register").value = "";
      render();
      if (!keepStatus) { status(""); hideUndo(); }
    } catch { card = null; status(""); hideUndo(); $("english").textContent = "Could not load. Reload the page."; }
  }

  const EXPIRED = "Sign-in expired. Reload the page.";
  const expired = (r) => r.status === 401 || r.status === 403 || r.type === "opaqueredirect" || (r.redirected && !new URL(r.url).pathname.startsWith("/review/api/"));
  let busy = false;
  async function send(extra) {
    if (!card || busy) return;
    busy = true; hideUndo();
    try {
      const r = await post("/review/api/decide", {
        sentenceId: card.sentence.id, answerIds: card.answers.map((a) => a.id),
        register: $("register").value || undefined, note: $("note").value || undefined, ...extra,
      });
      if (expired(r)) { status(EXPIRED); return; }
      if (r.status === 409) status("Your lock ran out or someone else took this one. Loading the next.");
      else if (!r.ok) { status("Could not save. Try again."); return; }
      else { status("Saved.", true); if (isOwner) showUndo((await r.json()).reviewId); }
      await next(true);
    } catch { status(EXPIRED); }
    finally { busy = false; }
  }

  $("undo").addEventListener("click", async () => {
    if (busy || undoId === null) return;
    busy = true;
    try {
      const r = await post("/review/api/undo", { reviewId: undoId });
      if (r.status === 409) {
        const j = await r.json().catch(() => ({}));
        status(j.reason === "exported" ? "Already published; cannot undo." : j.reason === "not_latest" ? "A newer review exists; cannot undo." : "Cannot undo.");
      } else if (expired(r)) status(EXPIRED);
      else if (!r.ok) status("Cannot undo.");
      else { hideUndo(); status("Undone.", true); await next(true); }
    } catch { status(EXPIRED); }
    finally { busy = false; }
  });
  $("reject").addEventListener("click", () => send({ decision: "reject" }));
  $("retire").addEventListener("click", () => send({ decision: "retire" }));

  async function health() {
    try {
      const r = await fetch("/review/api/health");
      if (!r.ok) return;
      const { failing } = await r.json();
      if (!failing.length) return;
      const b = document.createElement("div");
      b.setAttribute("role", "alert");
      b.className = "alert";
      failing.forEach((f) => { const p = document.createElement("p"); p.textContent = `Background job failing: ${f.job} (last tried ${f.lastAt})`; b.append(p); });
      document.body.prepend(b);
    } catch {}
  }

  // Word list: newest 20 entries, each with a Hide button.
  async function words() {
    try {
      const r = await fetch("/review/api/glossary");
      if (!r.ok) return;
      const { entries } = await r.json();
      $("words").replaceChildren(...entries.map((e) => {
        const li = document.createElement("li"); li.className = "answer";
        const t = document.createElement("p"); t.textContent = e.paite + " = " + e.english;
        const m = document.createElement("div"); m.className = "meta"; m.textContent = (e.note ? e.note + " · " : "") + e.example.paite + " / " + e.example.english;
        const h = document.createElement("button"); h.type = "button"; h.textContent = "Hide"; h.setAttribute("aria-label", "Hide word: " + e.paite);
        h.addEventListener("click", async () => { h.disabled = true; const x = await post("/review/api/glossary/hide", { id: e.id }); if (x.ok) li.remove(); else h.disabled = false; });
        li.append(t, m, h);
        return li;
      }));
    } catch {}
  }

  // Owner only: pending applications and the reviewer list.
  async function people() {
    const row = (title, sub, ...btns) => {
      const li = document.createElement("li"); li.className = "answer";
      const t = document.createElement("p"); t.textContent = title;
      const m = document.createElement("div"); m.className = "meta"; m.textContent = sub;
      li.append(t, m, ...btns); return li;
    };
    const act = (label, aria, fn) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-label", aria);
      b.addEventListener("click", async () => { b.disabled = true; if (!(await fn())) b.disabled = false; else people(); });
      return b;
    };
    try {
      const a = await fetch("/review/api/applications");
      if (a.ok) {
        const { applications } = await a.json();
        $("apps-card").hidden = false;
        $("apps").replaceChildren(...applications.map((x) => row(x.name + " <" + x.email + ">", x.note || "", ...["approve", "decline"].map((d) =>
          act(d === "approve" ? "Approve" : "Decline", (d === "approve" ? "Approve " : "Decline ") + x.name, async () => (await post("/review/api/applications/decide", { id: x.id, decision: d })).ok)))));
        if (!applications.length) { const li = document.createElement("li"); li.className = "meta"; li.textContent = "No pending applications."; $("apps").replaceChildren(li); }
      }
      const r = await fetch("/review/api/reviewers");
      if (r.ok) {
        const { reviewers } = await r.json();
        $("revs-card").hidden = false;
        $("revs").replaceChildren(...reviewers.map((x) => row(x.name + " <" + x.email + ">", x.source, ...(x.source === "db" ? [act("Remove", "Remove " + x.name, async () => {
          if (!confirm("Remove " + x.name + " (" + x.email + ") as a reviewer?")) return false;
          const d = await post("/review/api/reviewers/remove", { email: x.email });
          if (!d.ok) status((await d.json().catch(() => ({}))).message || "Could not remove.");
          return d.ok;
        })] : []))));
      }
    } catch {}
  }

  // Link this browser's contributor phone id to the signed-in reviewer (for the badge on /contributors).
  const linkPhone = () => { try { const id = JSON.parse(localStorage.getItem("pd:phone")); if (id) post("/review/api/link-phone", { phoneId: id }).catch(() => {}); } catch {} };
  me().then((ok) => { if (ok) { linkPhone(); next(); words(); if (isOwner) { health(); people(); } } });
})();
