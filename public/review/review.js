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
    $("english").textContent = card.sentence.english;
    $("english").focus();
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
      if (a.ai_note) { const ai = document.createElement("div"); ai.className = "ai"; ai.textContent = "AI note (advisory)" + (a.ai_flag ? " [" + a.ai_flag + "]" : "") + ": " + a.ai_note; box.append(ai); }
      const edit = document.createElement("textarea"); edit.value = a.paite; edit.maxLength = 300; edit.setAttribute("aria-label", "Edit before accepting: " + a.paite);
      const also = document.createElement("label"); also.hidden = !multi;
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.dataset.answerId = a.id; cb.setAttribute("aria-label", "Also correct (keep as variant): " + a.paite);
      cb.addEventListener("change", () => box.classList.toggle("variant", cb.checked));
      also.append(cb, " Also correct (keep as variant)");
      const accept = document.createElement("button"); accept.className = "primary"; accept.textContent = "✅ Accept this"; accept.setAttribute("aria-label", "Accept this: " + a.paite);
      accept.addEventListener("click", () => send({
        decision: "accept", answerId: a.id,
        finalPaite: edit.value.trim() === a.paite ? undefined : edit.value,
        alsoCorrect: [...document.querySelectorAll("[data-answer-id]:checked")].map((c) => Number(c.dataset.answerId)).filter((id) => id !== a.id),
      }));
      box.append(edit, also, accept);
      return box;
    }));
  }

  async function next(keepStatus = false) {
    $("english").textContent = "Loading…";
    try {
      const r = await fetch("/review/api/next");
      if (r.status === 204) { card = null; if (!keepStatus) { status(""); hideUndo(); } $("english").textContent = "Nothing to review right now. 🎉"; $("answers").replaceChildren(); return; }
      if (!r.ok) { card = null; status(""); hideUndo(); $("english").textContent = "Could not load. Reload the page."; $("answers").replaceChildren(); return; }
      card = await r.json();
      $("note").value = ""; $("register").value = "";
      render();
      if (!keepStatus) { status(""); hideUndo(); }
    } catch { card = null; status(""); hideUndo(); $("english").textContent = "Could not load. Reload the page."; }
  }

  const EXPIRED = "Sign-in expired. Reload the page.";
  let busy = false;
  async function send(extra) {
    if (!card || busy) return;
    busy = true; hideUndo();
    try {
      const r = await post("/review/api/decide", {
        sentenceId: card.sentence.id, answerIds: card.answers.map((a) => a.id),
        register: $("register").value || undefined, note: $("note").value || undefined, ...extra,
      });
      if (r.status === 401 || r.status === 403) { status(EXPIRED); return; }
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
      } else if (r.status === 401 || r.status === 403) status(EXPIRED);
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
      b.style.cssText = "background:#b00020;color:#fff;padding:.5rem 1rem";
      failing.forEach((f) => { const p = document.createElement("p"); p.textContent = `Background job failing: ${f.job} (last tried ${f.lastAt})`; b.append(p); });
      document.body.prepend(b);
    } catch {}
  }

  me().then((ok) => { if (ok) { next(); if (isOwner) health(); } });
})();
