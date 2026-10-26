// Spellcheck by language, and Check English. A field marked data-lang="en" gets the
// browser's English spellcheck and a Check English pill; data-lang="pai" switches the
// spellcheck off, so Paite is never underlined as wrong English. Fields whose language
// follows the sentence call window.pdLang(el, lang) when it changes. The suggestion is
// only applied when the person taps Use this.
(() => {
  // The page decides how to reach the check: the front page through its session, the
  // reviewer pages through Cloudflare Access. /proverbs has neither, so no pill there.
  const call = (what, text) => {
    if (window.paiteApi) return window.paiteApi(`/api/${what}`, { method: "POST", body: JSON.stringify({ text }) });
    if (location.pathname.startsWith("/review")) return fetch(`/review/api/${what}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    return null;
  };
  const check = (text) => call("grammar", text);
  const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

  function pill(el) {
    if (el._gram) return el._gram;
    const wrap = make("div", "gram"), btn = make("button", "share-chip", "Check English"), out = make("div", "gram-out");
    btn.type = "button"; out.hidden = true; out.setAttribute("role", "status");
    wrap.append(btn, out); el.after(wrap);
    btn.addEventListener("click", async () => {
      const text = el.value.trim();
      if (!text) { el.focus(); return; }
      btn.disabled = true; out.hidden = false; out.textContent = "Checking…";
      try {
        const r = await check(text);
        if (!r) { out.textContent = "Could not check right now."; return; }
        if (r.status === 429) { out.textContent = "Too many checks for now. Try again in a minute."; return; }
        if (!r.ok) { out.textContent = "The check is not available right now."; return; }
        const j = await r.json();
        out.textContent = "";
        if (!j.changed) { out.append(make("span", "", "Looks right.")); return; }
        const use = make("button", "share-chip", "Use this"), keep = make("button", "linkish", "Keep mine");
        use.type = keep.type = "button";
        out.append(make("span", "gram-label", "Suggested"), make("p", "gram-text", j.suggestion), use, keep);
        use.onclick = () => { el.value = j.suggestion; el.dispatchEvent(new Event("input", { bubbles: true })); out.hidden = true; el.focus(); };
        keep.onclick = () => { out.hidden = true; el.focus(); };
      } catch { out.textContent = "Could not check right now."; }
      finally { btn.disabled = false; }
    });
    // A new answer means an old suggestion no longer applies.
    el.addEventListener("input", () => { if (!out.contains(document.activeElement)) out.hidden = true; });
    el._gram = wrap;
    return wrap;
  }

  // Check spelling, for Paite fields: every word is looked up in verified Paite. An unseen
  // word shows the nearest spellings people have used; tapping one swaps it in. Nothing is
  // generated, and an unseen word may simply be new.
  // A word is letters and apostrophes only, so it needs no escaping inside the pattern.
  const swap = (text, from, to) => text.replace(new RegExp(`(^|[^\\p{L}'’])(${from.replace(/'/g, "['’]")})(?=$|[^\\p{L}'’])`, "giu"),
    (_, pre, w) => pre + (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to));
  function spellPill(el) {
    if (el._spell) return el._spell;
    const wrap = make("div", "gram"), btn = make("button", "share-chip", "Check spelling"), out = make("div", "gram-out");
    btn.type = "button"; out.hidden = true; out.setAttribute("role", "status");
    wrap.append(btn, out); el.after(wrap);
    const run = async () => {
      const text = el.value.trim();
      if (!text) { el.focus(); return; }
      btn.disabled = true; out.hidden = false; out.textContent = "Checking…";
      try {
        const r = await call("spelling", text);
        if (!r || !r.ok) { out.textContent = "Could not check right now."; return; }
        const j = await r.json();
        out.textContent = "";
        const unseen = j.words.filter((w) => !w.count);
        if (!unseen.length) { out.append(make("span", "", "Every word is in verified Paite.")); return; }
        out.append(make("span", "gram-label", "Not in verified Paite yet"));
        for (const w of unseen) {
          const row = make("div", "spell-row");
          row.append(make("b", "", w.word));
          if (w.suggestions.length) {
            row.append(make("span", "", "Seen:"));
            for (const s of w.suggestions) {
              const b = make("button", "share-chip", `${s.word} (${s.count})`);
              b.type = "button";
              b.onclick = () => { el.value = swap(el.value, w.word, s.word); el.dispatchEvent(new Event("input", { bubbles: true })); run(); };
              row.append(b);
            }
          } else row.append(make("span", "", "No close spelling yet. It may be a new word, which is fine."));
          out.append(row);
        }
      } catch { out.textContent = "Could not check right now."; }
      finally { btn.disabled = false; }
    };
    btn.addEventListener("click", run);
    el.addEventListener("input", () => { if (!out.contains(document.activeElement)) out.hidden = true; });
    el._spell = wrap;
    return wrap;
  }

  window.pdLang = (el, lang) => {
    if (!el) return;
    el.dataset.lang = lang;
    el.lang = lang === "en" ? "en" : "pck";
    el.spellcheck = lang === "en";
    const canCheck = lang === "en" && el.dataset.check !== "off" && (window.paiteApi || location.pathname.startsWith("/review"));
    if (canCheck) pill(el).hidden = false;
    else if (el._gram) el._gram.hidden = true;
    const canSpell = lang === "pai" && el.dataset.check !== "off" && (window.paiteApi || location.pathname.startsWith("/review"));
    if (canSpell) spellPill(el).hidden = false;
    else if (el._spell) el._spell.hidden = true;
  };
  const init = () => document.querySelectorAll("[data-lang]").forEach((el) => window.pdLang(el, el.dataset.lang));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
