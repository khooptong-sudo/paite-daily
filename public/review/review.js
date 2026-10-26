(() => {
  const $ = (id) => document.getElementById(id);
  let card = null, isOwner = false, undoId = null, lastUndo = null;

  const status = (m, ok = false) => { $("status").textContent = m; $("status").className = "status " + (ok ? "ok" : m ? "err" : ""); };
  const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function me() {
    try {
      const r = await fetch("/review/api/me");
      if (r.status === 403) { $("english").textContent = "You are not a reviewer. Ask the owner to add your email."; return false; }
      if (!r.ok) { $("english").textContent = "Sign-in needed. Reload the page."; return false; }
      const m = await r.json();
      $("who").textContent = m.name; isOwner = m.owner === true;
      if (m.lastReviewId) lastUndo = m.lastReviewId;
      return true;
    } catch { $("english").textContent = "Sign-in needed. Reload the page."; return false; }
  }

  function hideUndo() { undoId = null; $("undo").hidden = true; }
  function showUndo(id) { undoId = id; $("undo").hidden = false; }

  // Differences: when there are several answers, a word that is not in every answer is
  // marked, so the reviewer sees at a glance where the answers part ways.
  const wordsOf = (t) => (t.toLowerCase().match(/\p{L}[\p{L}'’]*/gu) || []);
  function marked(text, common) {
    const p = document.createElement("p");
    for (const part of text.split(/(\p{L}[\p{L}'’]*)/u)) {
      if (common && /^\p{L}/u.test(part) && !common.has(part.toLowerCase())) { const m = document.createElement("mark"); m.className = "diff"; m.textContent = part; p.append(m); }
      else p.append(part);
    }
    return p;
  }

  // Swipe on a phone: right accepts this answer, left rejects this answer only. The box
  // follows the finger; let go before the threshold and it slides back. Scrolling wins
  // when the finger moves more up or down than sideways.
  const touch = matchMedia("(pointer: coarse)").matches;
  function swipeable(box, onRight, onLeft) {
    let x0 = 0, y0 = 0, dx = 0, live = false, dead = false;
    box.addEventListener("touchstart", (e) => {
      if (busy || e.touches.length > 1 || e.target.closest("textarea, input, button, select, label")) { dead = true; return; }
      dead = live = false; dx = 0; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    box.addEventListener("touchmove", (e) => {
      if (dead) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!live) { if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { dead = true; return; } if (Math.abs(mx) < 10) return; live = true; }
      dx = mx; box.style.transition = "none"; box.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
      box.classList.toggle("go-yes", dx > box.offsetWidth * .3); box.classList.toggle("go-no", dx < -box.offsetWidth * .3);
    }, { passive: true });
    box.addEventListener("touchend", () => {
      if (dead || !live) return;
      const far = Math.abs(dx) > box.offsetWidth * .3;
      box.style.transition = "transform .2s"; box.style.transform = far ? `translateX(${Math.sign(dx) * 120}%)` : "";
      box.classList.remove("go-yes", "go-no");
      if (far) (dx > 0 ? onRight : onLeft)();
      live = false;
    });
  }

  // The rulebook at review time: a word in an answer that reviewers have corrected before
  // shows what it became and how often, with a tap to make the same change in the edit box.
  let rules = new Map();
  async function loadRules() {
    try {
      const r = await fetch("/review/api/rules");
      if (!r.ok) return;
      for (const x of (await r.json()).rules) { if (!rules.has(x.from)) rules.set(x.from, []); rules.get(x.from).push(x); }
    } catch {}
  }
  const swapWord = (text, from, to) => text.replace(new RegExp(`(^|[^\p{L}'’])(${from.replace(/'/g, "['’]")})(?=$|[^\p{L}'’])`, "giu"),
    (_, pre, w) => pre + (w[0] !== w[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to));
  // House style (owner, 26 Oct): ending a sentence with uh, uhi, ahi or hi is an older way
  // of writing that is dying out. The hint offers to drop that last word, punctuation kept.
  const OLD_END = /(\s+)(uh|uhi|ahi|hi)([.?!]*)\s*$/i;
  function ruleHints(text, edit) {
    const seen = new Set(), wrap = document.createElement("div"); wrap.className = "rulehints";
    const end = text.match(OLD_END);
    if (end) {
      const row = document.createElement("div"); row.className = "meta rulehint";
      const t = document.createElement("span"); t.textContent = `Ends with "${end[2]}": an older style that is dying out.`;
      const drop = document.createElement("button"); drop.type = "button"; drop.className = "share-chip"; drop.textContent = `Drop "${end[2]}"`;
      drop.addEventListener("click", () => { edit.value = edit.value.replace(OLD_END, "$3"); edit.focus(); });
      row.append(t, drop); wrap.append(row);
    }
    for (const w of wordsOf(text)) {
      const w2 = w.replace(/’/g, "'");
      if (seen.has(w2) || !rules.has(w2)) continue;
      seen.add(w2);
      for (const x of rules.get(w2)) {
        const row = document.createElement("div"); row.className = "meta rulehint";
        const t = document.createElement("span"); t.textContent = `Reviewers changed ${x.from} to ${x.to} ${x.count === 1 ? "once" : x.count + " times"}.`;
        const use = document.createElement("button"); use.type = "button"; use.className = "share-chip"; use.textContent = `Use ${x.to}`;
        use.addEventListener("click", () => { edit.value = swapWord(edit.value, x.from, x.to); edit.focus(); });
        row.append(t, use); wrap.append(row);
      }
    }
    return wrap.childNodes.length ? wrap : null;
  }

  function render() {
    const rev = card.sentence.direction === "pai2en";
    $("dir").textContent = rev ? "Paite to English: translate into English" : "English";
    $("english").textContent = rev ? card.sentence.paite_prompt : card.sentence.english;
    $("orig").hidden = !rev; $("orig").textContent = rev ? "Original English (round trip): " + card.sentence.english : "";
    $("register").parentElement.hidden = rev;
    const multi = card.answers.length > 1;
    const hint = document.createElement("p"); hint.className = "meta"; hint.hidden = !multi;
    hint.textContent = "Press Accept this on the best answer. Tick any other correct answers to keep them as variants. Save keeps every answer as a variant when none is the exact answer. Reject removes one answer only; Reject all closes the whole sentence.";
    const sets = card.answers.map((a) => new Set(wordsOf(a.paite)));
    const common = multi ? new Set([...sets[0]].filter((w) => sets.every((s) => s.has(w)))) : null;
    const swipeHint = document.createElement("p"); swipeHint.className = "meta swipe-hint"; swipeHint.hidden = !touch;
    swipeHint.textContent = multi ? "Swipe an answer right to accept it, left to reject that answer only. Marked words differ between the answers." : "Swipe the answer right to accept it, left to reject it.";
    $("answers").replaceChildren(hint, swipeHint, ...card.answers.map((a) => {
      const box = document.createElement("div");
      box.className = "answer"; box.tabIndex = -1;
      const p = marked(a.paite, common);
      const meta = document.createElement("div"); meta.className = "meta";
      meta.textContent = `${a.register}${a.contributor_name ? " · " + a.contributor_name : ""}`;
      box.append(p, meta);
      if (a.explanation) { const ex = document.createElement("div"); ex.className = "meta"; ex.textContent = a.explanation; box.append(ex); }
      if (a.ai_note) { const ai = document.createElement("div"); ai.className = "ai"; ai.textContent = "AI note (advisory)" + (a.ai_flag ? " [" + (rev && a.ai_flag === "english" ? "not_english" : a.ai_flag) + "]" : "") + ": " + a.ai_note; box.append(ai); }
      const edit = document.createElement("textarea"); edit.value = a.paite;
      const hints = rev ? null : ruleHints(a.paite, edit); edit.maxLength = 300; edit.setAttribute("aria-label", "Edit before accepting: " + a.paite); edit.dataset.lang = rev ? "en" : "pai";
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
      const reject = document.createElement("button"); reject.type = "button"; reject.textContent = "✕ Reject"; reject.setAttribute("aria-label", "Reject this answer only: " + a.paite);
      reject.addEventListener("click", () => send({ decision: "reject", answerIds: [a.id] }, "Answer rejected. The rest stay open."));
      const row = document.createElement("div"); row.className = "row3"; row.append(accept, reject);
      box.append(edit);
      if (hints) box.append(hints);
      box.append(also, row);
      if (touch) swipeable(box, () => accept.click(), () => reject.click());
      box._accept = accept; box._reject = reject; box._edit = edit; box._also = cb;
      return box;
    }));
    $("answers").querySelectorAll("textarea[data-lang]").forEach((t) => window.pdLang && window.pdLang(t, t.dataset.lang));
    const first = $("answers").querySelector(".answer");
    if (first) focusBox(first); else $("english").focus();
  }

  async function queue() {
    try {
      const r = await fetch("/review/api/queue");
      if (r.ok) $("queue").textContent = (await r.json()).waiting + " waiting";
    } catch {}
  }

  // Every queue at a glance: how many wait and how long the oldest has waited.
  function since(t) {
    const days = Math.floor((Date.now() - new Date(t.replace(" ", "T") + "Z")) / 864e5);
    return days < 1 ? "today" : days === 1 ? "1 day ago" : days + " days ago";
  }
  async function dashboard() {
    try {
      const r = await fetch("/review/api/dashboard");
      if (!r.ok) return;
      const d = await r.json();
      for (const k of ["sentences", "words", "pauUpa", "recordings"]) {
        const t = $("dash-" + k), q = d[k];
        t.querySelector(".n").textContent = q.waiting;
        t.querySelector(".old").textContent = q.waiting && q.oldest ? "oldest: " + since(q.oldest) : "nothing waiting";
        t.classList.toggle("zero", !q.waiting);
      }
    } catch {}
  }

  // Keyboard: J and K (or the arrows, or 1 to 9) move between answers, and every key
  // acts on the answer that has focus.
  const boxes = () => [...document.querySelectorAll("#answers .answer")];
  function focusBox(box) {
    boxes().forEach((b) => b.classList.toggle("on", b === box));
    box.focus({ preventScroll: true }); box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  const current = (e) => (e.target.closest && e.target.closest(".answer")) || document.querySelector(".answer.on") || boxes()[0];
  function step(by, e) { const all = boxes(), i = all.indexOf(current(e)); if (all.length) focusBox(all[Math.max(0, Math.min(all.length - 1, i + by))]); }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && e.target.matches && e.target.matches("textarea") && e.target.closest(".answer")) { e.preventDefault(); focusBox(e.target.closest(".answer")); return; }
    if (e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.isContentEditable || (e.target.matches && e.target.matches("textarea, select, input:not([type=checkbox])"))) return;
    const k = e.key.toLowerCase();
    if (k === "?") $("help").hidden = !$("help").hidden;
    else if (k === "a" || (k === "enter" && e.target.classList && e.target.classList.contains("answer"))) { const box = current(e); if (box) box._accept.click(); else return; }
    else if (k === "x") { const box = current(e); if (box) box._reject.click(); }
    else if (k === "e") { const box = current(e); if (box) { box._edit.focus(); box._edit.select(); } }
    else if (k === "v") { const box = current(e); if (box && !box._also.parentElement.hidden) box._also.click(); }
    else if (k === "j" || k === "arrowdown") step(1, e);
    else if (k === "k" || k === "arrowup") step(-1, e);
    else if (/^[1-9]$/.test(k)) { const b = boxes()[Number(k) - 1]; if (b) focusBox(b); }
    else if (k === "s") $("save").click();
    else if (k === "n") $("skip").click();
    else if (k === "r") $("reject").click();
    else if (k === "u") { if (!$("undo").hidden) $("undo").click(); }
    else return;
    e.preventDefault();
  });

  async function next(keepStatus = false) {
    queue();
    dashboard();
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
  async function send(extra, done = "Saved.") {
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
      else { status(done, true); showUndo((await r.json()).reviewId); }
      await next(true);
    } catch { status(EXPIRED); }
    finally { busy = false; }
  }

  $("undo").addEventListener("click", async () => {
    if (busy || undoId === null) return;
    busy = true;
    try {
      const r = await post("/review/api/undo", { reviewId: undoId });
      const j = r.ok ? {} : await r.json().catch(() => ({}));
      if (r.ok) { hideUndo(); status("Undone.", true); await next(true); }
      else if (j.reason === "not_yours") status("You can undo only your own review.");
      else if (j.reason === "exported") status("Already published; cannot undo.");
      else if (j.reason === "not_latest") status("A newer review exists; cannot undo.");
      else status(expired(r) ? EXPIRED : "Cannot undo.");
    } catch { status(EXPIRED); }
    finally { busy = false; }
  });
  $("save").addEventListener("click", () => send({ decision: "variant" }, "Saved as variants. The sentence stays open."));
  // Pass on this sentence: it stays in the queue for someone else, and this
  // reviewer is not offered it again for a couple of hours.
  $("skip").addEventListener("click", async () => {
    if (!card || busy) return;
    busy = true;
    try {
      const r = await post("/review/api/skip", { sentenceId: card.sentence.id });
      if (expired(r)) { status(EXPIRED); return; }
      if (!r.ok && r.status !== 404) { status("Could not skip. Try again."); return; }
      status("Skipped. It waits for another reviewer.", true);
      await next(true);
    } catch { status(EXPIRED); }
    finally { busy = false; }
  });
  $("reject").addEventListener("click", () => send({ decision: "reject" }, "All answers rejected."));
  $("retire").addEventListener("click", () => send({ decision: "retire" }, "Sentence retired."));

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

  // Word list: every entry, grouped by letter. A reviewer can correct a wrong meaning or hide a word.
  async function words() {
    try {
      const r = await fetch("/review/api/glossary");
      if (!r.ok) return;
      const { entries } = await r.json();
      const groups = new Map();
      for (const e of entries) {
        const l = (e.paite || "#").charAt(0).toUpperCase();
        const k = /\p{L}/u.test(l) ? l : "#";
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(e);
      }
      const row = (e) => {
        const li = document.createElement("li"); li.className = "answer";
        const t = document.createElement("p"); t.textContent = e.paite + " = " + e.english;
        const m = document.createElement("div"); m.className = "meta";
        m.textContent = [e.note, e.example ? e.example.paite + " / " + e.example.english : null, e.by ? "by " + e.by : "from a note",
          e.edited_at ? "edited by " + (e.edited_by || "a reviewer") + " on " + e.edited_at : null, e.hidden ? "hidden from the public list" : null].filter(Boolean).join(" · ");
        const form = document.createElement("div"); form.className = "edit"; form.hidden = true;
        const field = (label, value, max) => {
          const wrap = document.createElement("label"); wrap.textContent = label;
          const input = document.createElement("input"); input.value = value ?? ""; input.maxLength = max;
          wrap.append(input); return [wrap, input];
        };
        const [lp, ip] = field("Paite", e.paite, 60);
        const [le, ie] = field("English meaning", e.english, 120);
        const [ln, inote] = field("Note (optional)", e.note ?? "", 200);
        const save = document.createElement("button"); save.type = "button"; save.className = "primary"; save.textContent = "Save correction";
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
        const row3 = document.createElement("div"); row3.className = "row3"; row3.append(save, cancel);
        form.append(lp, le, ln, row3);
        const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Edit"; edit.setAttribute("aria-label", "Edit word: " + e.paite);
        edit.addEventListener("click", () => { form.hidden = !form.hidden; if (!form.hidden) ip.focus(); });
        cancel.addEventListener("click", () => { form.hidden = true; ip.value = e.paite; ie.value = e.english; inote.value = e.note ?? ""; });
        save.addEventListener("click", async () => {
          save.disabled = true;
          const x = await post("/review/api/glossary/edit", { id: e.id, paite: ip.value, english: ie.value, note: inote.value });
          save.disabled = false;
          if (x.ok) { status("Correction saved.", true); words(); }
          else if (x.status === 409) status("That word and meaning are already in the list.");
          else if (x.status === 400) status("A word and an English meaning are both needed.");
          else status("Could not save the correction.");
        });
        const vis = document.createElement("button"); vis.type = "button"; vis.textContent = e.hidden ? "Show" : "Hide";
        vis.setAttribute("aria-label", (e.hidden ? "Show word: " : "Hide word: ") + e.paite);
        vis.addEventListener("click", async () => {
          vis.disabled = true;
          const x = await post("/review/api/glossary/hide", { id: e.id, hidden: !e.hidden });
          vis.disabled = false;
          if (x.ok) { status(e.hidden ? "Word is back in the list." : "Word hidden.", true); words(); }
          else status("Could not change that word.");
        });
        const row3b = document.createElement("div"); row3b.className = "row3"; row3b.append(edit, vis);
        li.append(t, m, row3b, form);
        return li;
      };
      const blocks = [...groups].map(([k, es]) => {
        const d = document.createElement("details"); d.className = "wgroup";
        const s = document.createElement("summary");
        const ltr = document.createElement("span"); ltr.textContent = k;
        const cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = es.length + (es.length === 1 ? " word" : " words");
        s.append(ltr, cnt);
        const ul = document.createElement("ul"); ul.append(...es.map(row));
        d.append(s, ul);
        return d;
      });
      $("words").replaceChildren(...blocks);
    } catch {}
  }

  // New words: pending contributor submissions, oldest first.
  async function newWords() {
    dashboard();
    try {
      const r = await fetch("/review/api/words/pending");
      if (!r.ok) return;
      const { words } = await r.json();
      const decide = (w, li, decision, label, extra) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-label", label + " word: " + w.paite);
        b.addEventListener("click", async () => {
          const bs = li.querySelectorAll("button"); bs.forEach((x) => (x.disabled = true));
          const x = await post("/review/api/words/decide", { id: w.id, decision, ...(extra ? extra() : {}) });
          if (x.ok || x.status === 409) li.remove(); else bs.forEach((y) => (y.disabled = false));
        });
        return b;
      };
      $("newwords").replaceChildren(...words.map((w) => {
        const li = document.createElement("li"); li.className = "answer";
        const t = document.createElement("p"); t.textContent = w.paite + " = " + w.english;
        const m = document.createElement("div"); m.className = "meta"; m.textContent = [w.source === "meaning" ? "meaning of a listed word" : null, w.note, w.name && "by " + w.name].filter(Boolean).join(" · ");
        const ip = document.createElement("input"); ip.maxLength = 60; ip.value = w.paite; ip.placeholder = "Paite";
        const ie = document.createElement("input"); ie.maxLength = 120; ie.value = w.english; ie.placeholder = "English meaning";
        const inn = document.createElement("input"); inn.maxLength = 200; inn.value = w.note ?? ""; inn.placeholder = "Note (optional)";
        const row = document.createElement("div"); row.className = "row3"; row.append(ip, ie, inn);
        const bar = document.createElement("div"); bar.className = "row3";
        bar.append(decide(w, li, "approve", "Approve", () => ({ paite: ip.value, english: ie.value, note: inn.value || undefined })),
          decide(w, li, "reject", "Reject"));
        li.append(t, m, row, bar);
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

  // Owner only: how far visitors get, and what broke.
  async function insights() {
    const line = (li, text, meta) => {
      const t = document.createElement("p"); t.textContent = text;
      const m = document.createElement("div"); m.className = "meta"; m.textContent = meta;
      li.append(t, m);
    };
    try {
      const a = await fetch("/review/api/analytics?days=7");
      if (a.ok) {
        const d = await a.json();
        $("funnel-card").hidden = false;
        const rows = d.funnel.map((f) => {
          const li = document.createElement("li"); li.className = "answer";
          line(li, `${f.kind}: ${f.people} people (${f.hits} events)`, "");
          return li;
        });
        d.dropOff.forEach((x, i) => { const m = rows[i + 1].querySelector(".meta"); m.textContent = `lost ${x.lost} (${x.percent}%) after ${d.funnel[i].kind}`; });
        const days = document.createElement("li"); days.className = "meta";
        days.textContent = d.byDay.map((b) => `${b.day}: ${b.people}`).join(" · ") || "No events yet.";
        $("funnel").replaceChildren(...rows, days, Object.assign(document.createElement("li"), { className: "meta", textContent: "devices: " + d.devices.map((x) => `${x.device} ${x.people}`).join(", ") }));
      }
    } catch {}
    try {
      const e = await fetch("/review/api/errors");
      if (!e.ok) return;
      const { errors } = await e.json();
      $("errors-card").hidden = false;
      if (!errors.length) { const li = document.createElement("li"); li.className = "meta"; li.textContent = "No errors in the last 7 days."; $("errors").replaceChildren(li); return; }
      $("errors").replaceChildren(...errors.map((x) => {
        const li = document.createElement("li"); li.className = "answer";
        line(li, x.message, `${x.route} · ${x.count} time(s) · last ${x.last}`);
        return li;
      }));
    } catch {}
  }

  // Link this browser's contributor phone id to the signed-in reviewer (for the badge on /contributors).
  const linkPhone = () => { try { const id = JSON.parse(localStorage.getItem("pd:phone")); if (id) post("/review/api/link-phone", { phoneId: id }).catch(() => {}); } catch {} };
  me().then((ok) => { if (ok) { linkPhone(); loadRules().then(next).then(() => { if (lastUndo !== null) showUndo(lastUndo); }); words(); newWords(); dashboard(); if (isOwner) { health(); people(); insights(); } } });
})();
