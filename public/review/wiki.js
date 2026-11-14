(() => {
  const me = document.currentScript;
  const API = me.dataset.api;
  const LOGIN = me.dataset.login;
  const ADMIN = me.dataset.admin === "1";
  const $ = (id) => document.getElementById(id);
  const statusLine = $("status");

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (v !== undefined && v !== null) n.setAttribute(k, v);
    }
    for (const k of kids) if (k) n.append(k);
    return n;
  }
  const date = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  // Returns { ok, status, data }. 401 leaves the page; 403 says so in the status line.
  async function call(path, body) {
    const init = { headers: {} };
    if (body !== undefined) {
      init.method = "POST";
      init.headers["content-type"] = "application/json";
      if (ADMIN) init.headers["X-Admin"] = "1";
      init.body = JSON.stringify(body);
    }
    let r;
    try { r = await fetch(API + path, init); } catch { return { ok: false, status: 0, data: {} }; }
    if (r.status === 401) { location.replace(LOGIN); return { ok: false, status: 401, data: {} }; }
    if (r.status === 403) statusLine.textContent = "You are not signed in as a reviewer.";
    let data = {};
    try { data = await r.json(); } catch { /* not JSON */ }
    return { ok: r.ok, status: r.status, data };
  }
  const problem = (r) => r.data.message || r.data.error || "Something went wrong.";
  const note = (parent, text, ok) => {
    const old = parent.querySelector(":scope > .msg");
    if (old) old.remove();
    parent.append(el("p", { class: ok ? "msg ok" : "msg", text }));
  };

  // ---- 1. Sources
  const secSources = $("sec-sources");
  const picker = el("select", { "aria-label": "Status" });
  for (const s of ["pending", "approved", "rejected", "withdrawn"]) picker.append(el("option", { value: s, text: s }));
  const list = el("div");
  secSources.append(el("div", { class: "row" }, picker), list);
  picker.addEventListener("change", loadSources);

  async function loadSources() {
    clear(list);
    const status = picker.value;
    const r = await call("/sources?status=" + encodeURIComponent(status));
    if (!r.ok) { note(list, problem(r)); return; }
    if (!r.data.sources.length) { list.append(el("p", { class: "empty", text: "Nothing here." })); return; }
    for (const s of r.data.sources) list.append(sourceRow(s, status));
  }

  function sourceRow(s, status) {
    const detail = el("div");
    const meta = [s.kind, s.rights, s.author, s.year, s.chunks + " passages", "added by " + s.added_by, date(s.created_at)].filter((x) => x !== null && x !== undefined && x !== "");
    const title = el("button", { class: "title", type: "button", text: s.title, "aria-expanded": "false" });
    const row = el("div", { class: "item" }, title, el("p", { class: "meta", text: meta.join(" · ") }), detail);
    title.addEventListener("click", async () => {
      if (detail.firstChild) { clear(detail); title.setAttribute("aria-expanded", "false"); return; }
      title.setAttribute("aria-expanded", "true");
      const r = await call("/source?id=" + s.id);
      if (!r.ok) { note(detail, problem(r)); return; }
      showDetail(detail, r.data.source, status);
    });
    return row;
  }

  function showDetail(box, s, status) {
    clear(box);
    if (s.rights_note) box.append(el("p", { text: s.rights_note }));
    if (s.url) {
      box.append(s.url.startsWith("https://")
        ? el("p", null, el("a", { href: s.url, target: "_blank", rel: "noopener", text: s.url }))
        : el("p", { class: "meta", text: s.url }));
    }
    for (const c of (s.chunks || []).slice(0, 20)) {
      box.append(el("div", { class: "block" }, el("p", { class: "meta", text: c.locator || "#" + c.ordinal }), el("div", { class: "pre", text: c.text })));
    }
    if ((s.chunks || []).length > 20) box.append(el("p", { class: "meta", text: "Showing the first 20 passages." }));
    const actions = el("div", { class: "row" });
    const done = async (r) => {
      if (r.ok) { await loadSources(); return; }
      if (r.data.error === "no_text") note(box, "This source has no passages yet.");
      else note(box, problem(r));
    };
    if (status === "pending") {
      actions.append(
        el("button", { class: "go", type: "button", text: "Approve", on: { click: async () => done(await call("/decide", { id: s.id, decision: "approve" })) } }),
        el("button", { type: "button", text: "Reject", on: { click: async () => done(await call("/decide", { id: s.id, decision: "reject" })) } }),
      );
    }
    if (status === "pending" || status === "approved") {
      const form = el("div");
      actions.append(el("button", { class: "danger", type: "button", text: "Withdraw", on: { click: () => {
        if (form.firstChild) return;
        const reason = el("textarea", { maxlength: "500", "aria-label": "Reason", placeholder: "Reason (optional, at most 500 characters)" });
        form.append(reason, el("div", { class: "row" }, el("button", { class: "danger", type: "button", text: "Confirm withdraw", on: { click: async () => done(await call("/withdraw", { id: s.id, reason: reason.value.trim() || undefined })) } })));
      } } }));
      box.append(actions, form);
    } else box.append(actions);
  }

  // ---- 2. Add a source
  const secAdd = $("sec-add");
  const field = (label, input) => { const id = "f-" + label.replace(/\W+/g, "-").toLowerCase(); input.id = id; return [el("label", { for: id, text: label }), input]; };
  const pick = (opts) => { const s = el("select"); for (const o of opts) s.append(el("option", { value: o, text: o })); return s; };
  const kind = pick(["book", "article", "web", "other"]);
  const rights = pick(["open", "permission", "quote-only", "index-only"]);
  const RIGHTS_HELP = {
    open: "Open: free to use, quote and share in full.",
    permission: "Permission: we have the owner's permission to use it.",
    "quote-only": "Quote only: answers may quote short passages, but the text is not shared in full.",
    "index-only": "Index only: used to find the work, never quoted; visitors are pointed to it.",
  };
  const rightsHelp = el("p", { class: "help", text: RIGHTS_HELP.open });
  rights.addEventListener("change", () => { rightsHelp.textContent = RIGHTS_HELP[rights.value]; });
  const inputs = { title: el("input", { maxlength: "300" }), author: el("input", { maxlength: "200" }), publisher: el("input", { maxlength: "200" }), year: el("input", { maxlength: "20" }), url: el("input", { type: "url", placeholder: "https://" }), language: pick(["mixed", "en", "pck"]), rightsNote: el("input", { maxlength: "1000" }), text: el("textarea", { rows: "8" }) };
  const addMsg = el("div");
  const addBtn = el("button", { class: "go", type: "button", text: "Add source" });
  secAdd.append(
    ...field("Kind", kind), ...field("Rights", rights), rightsHelp,
    ...field("Title", inputs.title), ...field("Author", inputs.author), ...field("Publisher", inputs.publisher), ...field("Year", inputs.year),
    ...field("URL", inputs.url), ...field("Language", inputs.language), ...field("Rights note", inputs.rightsNote), ...field("Text (pasted)", inputs.text),
    el("div", { class: "row" }, addBtn), addMsg,
  );
  addBtn.addEventListener("click", async () => {
    const body = { kind: kind.value, rights: rights.value, language: inputs.language.value };
    for (const k of ["title", "author", "publisher", "year", "url", "rightsNote"]) if (inputs[k].value.trim()) body[k] = inputs[k].value.trim();
    if (inputs.text.value.trim()) body.text = inputs.text.value;
    addBtn.disabled = true;
    const r = await call("/source", body);
    addBtn.disabled = false;
    clear(addMsg);
    if (!r.ok) { note(addMsg, r.data.error === "bad_request" ? "Check the fields: kind, rights and title are needed; the URL must start with http." : problem(r)); return; }
    note(addMsg, "Added. Another reviewer must approve it.", true);
    for (const k of ["title", "author", "publisher", "year", "url", "rightsNote", "text"]) inputs[k].value = "";
    picker.value = "pending";
    loadSources();
  });

  // ---- 3. Answers marked wrong
  const secFlagged = $("sec-flagged");
  const flaggedBox = el("div");
  secFlagged.append(flaggedBox);
  const safeHref = (u) => typeof u === "string" && ((u.startsWith("/") && !u.startsWith("//")) || u.startsWith("https://"));
  function renderAnswer(a) {
    const box = el("div", { class: "block" });
    for (const p of a.parts || []) {
      if (p.type === "quote") box.append(el("blockquote", { lang: "pck", text: p.text }));
      else box.append(el("p", { text: p.text }));
    }
    if ((a.sources || []).length) {
      const ol = el("ol");
      for (const s of a.sources) {
        const label = s.title + (s.locator ? " (" + s.locator + ")" : "");
        if (safeHref(s.url)) {
          const ext = s.url.startsWith("https://");
          ol.append(el("li", null, el("a", { href: s.url, target: ext ? "_blank" : null, rel: ext ? "noopener" : null, text: label })));
        } else ol.append(el("li", { text: label }));
      }
      box.append(ol);
    }
    return box;
  }
  async function loadFlagged() {
    clear(flaggedBox);
    const r = await call("/asks/flagged");
    if (!r.ok) { note(flaggedBox, problem(r)); return; }
    if (!r.data.asks.length) { flaggedBox.append(el("p", { class: "empty", text: "No answers marked wrong." })); return; }
    for (const a of r.data.asks) {
      const item = el("div", { class: "item" }, el("p", { class: "title", text: a.q }), el("p", { class: "meta", text: date(a.at) }));
      item.append(a.answer ? renderAnswer(a.answer) : el("p", { class: "empty", text: "The answer was not stored (asked before this page existed)." }));
      for (const v of a.votes) {
        item.append(el("p", { class: "vote" }, el("strong", { text: v.by + ": " }), el("span", { class: v.right ? "yes" : "no", text: v.right ? "Yes" : "No" }), v.note ? el("span", { text: " - " + v.note }) : null));
      }
      flaggedBox.append(item);
    }
  }

  // ---- 4. Questions with no answer
  const secOpen = $("sec-open");
  const openBox = el("div");
  secOpen.append(openBox);
  async function loadOpen() {
    clear(openBox);
    const r = await call("/asks/open");
    if (!r.ok) { note(openBox, problem(r)); return; }
    if (!r.data.questions.length) { openBox.append(el("p", { class: "empty", text: "No open questions." })); return; }
    for (const q of r.data.questions) {
      const item = el("div", { class: "item" });
      const btn = el("button", { type: "button", text: "Dismiss", on: { click: async () => {
        btn.disabled = true;
        const r2 = await call("/asks/dismiss", { qKey: q.qKey });
        if (r2.ok) item.remove(); else { btn.disabled = false; note(item, problem(r2)); }
      } } });
      item.append(
        el("p", { class: "title", text: q.q }),
        el("p", { class: "meta", text: "asked " + q.asks + (q.asks === 1 ? " time" : " times") + " · last " + date(q.lastAt) }),
        el("div", null, ...q.reasons.map((x) => el("span", { class: "tag", text: x }))),
        btn,
      );
      openBox.append(item);
    }
  }

  // ---- 5. Site data
  const syncMsg = el("div");
  const syncBtn = el("button", { type: "button", text: "Sync now" });
  $("sec-site").append(el("p", { text: "The site's sayings, word list and verified pairs are copied into the wiki every 15 minutes." }), el("div", { class: "row" }, syncBtn), syncMsg);
  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    const r = await call("/sync", {});
    syncBtn.disabled = false;
    if (!r.ok) { note(syncMsg, problem(r)); return; }
    const x = r.data.result;
    note(syncMsg, x ? x.added + " added / " + x.changed + " changed / " + x.removed + " removed" : "Nothing changed.", true);
    loadSources();
  });

  // ---- 6. Articles
  const secArt = $("sec-articles");
  const artDraftMsg = el("div");
  const artTitle = el("input", { maxlength: "120" });
  const artTopic = el("textarea", { maxlength: "500", rows: "3" });
  const artDraftBtn = el("button", { class: "go", type: "button", text: "Draft" });
  const artList = el("div");
  const artView = el("div");
  secArt.append(
    el("p", { class: "eyebrow", text: "Draft with AI" }),
    ...field("Article title", artTitle), ...field("Topic (what it should cover, at most 500 characters)", artTopic),
    el("div", { class: "row" }, artDraftBtn), artDraftMsg, artList, artView,
  );
  const STATUS_TEXT = { draft: "draft", pending: "waiting for another reviewer", published: "published", withdrawn: "withdrawn" };

  async function loadArticles() {
    clear(artList);
    const r = await call("/articles");
    if (!r.ok) { note(artList, problem(r)); return; }
    if (!r.data.articles.length) { artList.append(el("p", { class: "empty", text: "No articles yet." })); return; }
    for (const a of r.data.articles) {
      const open = el("button", { class: "title", type: "button", text: a.title, on: { click: () => openArticle(a.id) } });
      const tags = el("p", { class: "meta" }, el("span", { class: "tag", text: STATUS_TEXT[a.status] || a.status }), a.stale ? el("span", { class: "tag", text: "sources changed" }) : null, el("span", { text: date(a.updatedAt) }));
      artList.append(el("div", { class: "item" }, open, tags));
    }
  }

  artDraftBtn.addEventListener("click", async () => {
    clear(artDraftMsg);
    artDraftBtn.disabled = true;
    note(artDraftMsg, "Drafting… this can take up to 30 seconds.", true);
    const r = await call("/articles/draft", { title: artTitle.value, topic: artTopic.value });
    artDraftBtn.disabled = false;
    clear(artDraftMsg);
    if (r.ok) { artTitle.value = ""; artTopic.value = ""; await loadArticles(); openArticle(r.data.id); return; }
    const e = r.data.error;
    note(artDraftMsg,
      e === "draft_failed" ? "The draft did not pass the checks (" + (r.data.reason || "unknown") + "). Try a narrower topic."
      : e === "bad_request" ? "The title needs 3 to 120 characters and the topic 3 to 500."
      : e === "limited" ? "The daily limit for drafts is used up. Try again tomorrow."
      : e === "no_passages" ? "No approved passages match this topic."
      : e === "no_ai" ? "The AI helper is not set up."
      : problem(r));
  });

  function previewBlocks(blocks, sources) {
    const box = el("div", { class: "block" });
    const num = new Map(sources.map((s, i) => [s.chunk, i + 1]));
    const sup = (id) => (num.has(id) ? el("sup", { text: String(num.get(id)) }) : null);
    for (const b of blocks) {
      if (b.type === "heading") box.append(el("h2", { text: b.text }));
      else if (b.type === "quote") box.append(el("blockquote", { lang: "pck" }, b.text, sup(b.chunk)));
      else box.append(el("p", null, b.text, ...(b.cites || []).map(sup)));
    }
    if (sources.length) {
      const ol = el("ol");
      for (const s of sources) {
        const label = s.title + (s.locator ? " · " + s.locator : "");
        ol.append(el("li", null, safeHref(s.url) ? el("a", { href: s.url, target: s.url.startsWith("https://") ? "_blank" : null, rel: "noopener", text: label }) : label));
      }
      box.append(el("h2", { text: "Sources" }), ol);
    }
    return box;
  }

  async function openArticle(id) {
    clear(artView);
    const r = await call("/article?id=" + id);
    if (!r.ok) { note(artView, problem(r)); return; }
    const a = r.data.article;
    const blocks = a.blocks.map((b) => ({ ...b }));
    const rows = el("div");
    const preview = el("div");
    const msg = el("div");
    const editable = a.status === "draft" || a.status === "pending";
    const srcNum = (id2) => a.sources.findIndex((s) => s.chunk === id2) + 1;
    const draw = () => {
      clear(rows);
      blocks.forEach((b, i) => {
        const row = el("div", { class: "block" });
        if (b.type === "heading") {
          const inp = el("input", { maxlength: "120", "aria-label": "Heading", value: b.text });
          inp.addEventListener("input", () => { b.text = inp.value; });
          row.append(inp);
        } else if (b.type === "text") {
          const ta = el("textarea", { "aria-label": "Paragraph" });
          ta.value = b.text;
          ta.addEventListener("input", () => { b.text = ta.value; });
          row.append(ta, el("p", { class: "meta", text: "Sources: " + (b.cites || []).map(srcNum).filter(Boolean).join(", ") }));
        } else {
          row.append(el("blockquote", { lang: "pck", text: b.text }), el("p", { class: "meta", text: "Quote from source " + (srcNum(b.chunk) || "?") }));
        }
        if (editable) {
          const move = (d) => { const j = i + d; if (j < 0 || j >= blocks.length) return; [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; draw(); };
          row.append(el("div", { class: "row" },
            el("button", { type: "button", text: "Up", on: { click: () => move(-1) } }),
            el("button", { type: "button", text: "Down", on: { click: () => move(1) } }),
            el("button", { class: "danger", type: "button", text: "Remove", on: { click: () => { blocks.splice(i, 1); draw(); } } }),
          ));
        }
        rows.append(row);
      });
    };
    draw();
    const noteBox = el("input", { maxlength: "300", "aria-label": "Note" });
    const act = async (path, body, okText) => {
      clear(msg);
      const r2 = await call(path, body);
      if (r2.ok) { await loadArticles(); if (okText) { await openArticle(id); note(artView, okText, true); } else await openArticle(id); return; }
      const e = r2.data.error;
      note(msg, e === "check_failed" ? "The edit did not pass the checks (" + (r2.data.reason || "unknown") + ")." : e === "stale" ? "A source this article cites has changed or been withdrawn." : problem(r2));
    };
    const btn = (text, fn, cls) => el("button", { class: cls || null, type: "button", text, on: { click: fn } });
    const actions = el("div", { class: "row" });
    if (editable) {
      actions.append(btn("Save", () => act("/articles/save", { id, blocks, note: noteBox.value.trim() || undefined }, "Saved."), "go"));
    }
    actions.append(btn("Preview", () => { clear(preview); preview.append(previewBlocks(blocks, a.sources)); }));
    if (a.status === "draft") actions.append(btn("Submit for review", () => act("/articles/submit", { id }, "Submitted. Another reviewer must publish it.")));
    if (a.status === "pending") actions.append(btn("Publish", () => act("/articles/publish", { id }, "Published."), "go"), btn("Return to draft", () => act("/articles/return", { id })));
    if (a.status === "published") {
      actions.append(btn("Return to draft", () => act("/articles/return", { id })));
    }
    if (a.status !== "withdrawn") actions.append(btn("Withdraw", () => act("/articles/withdraw", { id }), "danger"));
    const revs = el("div");
    for (const v of a.revs) revs.append(el("p", { class: "meta", text: date(v.at) + " · " + v.author + (v.note ? " · " + v.note : "") }));
    artView.append(
      el("h2", { text: a.title }),
      el("p", { class: "meta" }, el("span", { class: "tag", text: STATUS_TEXT[a.status] || a.status }), a.stale ? el("span", { class: "tag", text: "sources changed" }) : null),
      rows,
      editable ? el("div", null, ...field("Note about this change (optional)", noteBox)) : null,
      actions, msg,
      a.status === "published" ? el("p", { class: "meta" }, el("a", { href: "/wiki/" + a.slug, text: "Open public page" }), " (works only after launch)") : null,
      preview,
      el("p", { class: "eyebrow", text: "Revisions" }), revs,
    );
  }

  // ---- 7. Test questions
  const secTests = $("sec-tests");
  const tAddMsg = el("div");
  const tLines = el("textarea", { rows: "6", placeholder: "One per line: question | expected source (optional, for example proverb:12) | note (optional)" });
  const tAddBtn = el("button", { class: "go", type: "button", text: "Add" });
  const tAutoBtn = el("button", { type: "button", text: "Add 20 from the site's data" });
  const tAttackBtn = el("button", { type: "button", text: "Add the attack questions" });
  const tList = el("div");
  const tRunMsg = el("div");
  const tRunBtn = el("button", { class: "go", type: "button", text: "Run all active tests" });
  const tRunBox = el("div");
  const tRunPick = el("select", { "aria-label": "Earlier test runs" });
  const tReport = el("div");
  secTests.append(
    el("p", { class: "eyebrow", text: "Add questions" }),
    ...field("Questions to add", tLines),
    el("div", { class: "row" }, tAddBtn, tAutoBtn, tAttackBtn), tAddMsg,
    el("p", { class: "eyebrow", text: "Questions" }), tList,
    el("p", { class: "eyebrow", text: "Run" }), el("div", { class: "row" }, tRunBtn), tRunBox, tRunMsg,
    el("p", { class: "eyebrow", text: "Report" }), el("div", { class: "row" }, tRunPick), tReport,
  );

  async function loadTests() {
    clear(tList);
    const r = await call("/tests");
    if (!r.ok) { note(tList, problem(r)); return; }
    if (!r.data.tests.length) { tList.append(el("p", { class: "empty", text: "No test questions yet." })); return; }
    for (const t of r.data.tests) {
      const box = el("input", { type: "checkbox", "aria-label": "Active: " + t.q });
      box.checked = t.active === 1;
      box.addEventListener("change", async () => {
        const r2 = await call("/tests/active", { id: t.id, active: box.checked });
        if (!r2.ok) { box.checked = !box.checked; note(tList, problem(r2)); }
      });
      tList.append(el("div", { class: "item" },
        el("p", { class: "title", text: t.q }),
        el("p", { class: "meta" }, el("span", { class: "tag", text: t.kind }), t.expect ? el("span", { text: "expects " + t.expect }) : null, t.note ? el("span", { text: " · " + t.note }) : null),
        el("label", null, box, " Active"),
      ));
    }
  }
  async function addVia(btn, path, body, text) {
    btn.disabled = true;
    const r = await call(path, body);
    btn.disabled = false;
    clear(tAddMsg);
    if (!r.ok) { note(tAddMsg, r.data.error === "bad_request" ? "Check the lines: at most 200, each question 3 to 300 characters." : problem(r)); return; }
    note(tAddMsg, text(r.data), true);
    loadTests();
  }
  tAddBtn.addEventListener("click", () => addVia(tAddBtn, "/tests/add", { lines: tLines.value }, (d) => d.added + " added, " + d.skipped + " skipped."));
  tAutoBtn.addEventListener("click", () => addVia(tAutoBtn, "/tests/auto", { n: 20 }, (d) => d.added + " added."));
  tAttackBtn.addEventListener("click", () => addVia(tAttackBtn, "/tests/attacks", {}, (d) => d.added + " added."));

  async function loadRuns(select) {
    const r = await call("/tests/runs");
    if (!r.ok) return;
    clear(tRunPick);
    tRunPick.append(el("option", { value: "", text: "Pick a run" }));
    for (const x of r.data.runs) tRunPick.append(el("option", { value: String(x.id), text: "Run " + x.id + " · " + date(x.startedAt) + " · " + x.done + " of " + x.total }));
    if (select) tRunPick.value = String(select);
  }
  async function showReport(id) {
    clear(tReport);
    if (!id) return;
    const r = await call("/tests/report?run=" + id);
    if (!r.ok) { note(tReport, problem(r)); return; }
    const rep = r.data.report;
    for (const [k, v] of Object.entries(rep.byKind)) {
      tReport.append(el("p", { class: "meta", text: k + ": answered " + v.answered + " of " + v.total + " · right source " + v.hit + " · no answer " + v.none + " · failed checks " + v.failed + " · limited " + v.limited }));
    }
    for (const row of rep.rows) {
      const item = el("div", { class: "item" },
        el("p", { class: "title", text: row.q }),
        el("p", { class: "meta" }, el("span", { class: "tag", text: row.kind }), el("span", { text: row.status }), row.hit === 1 ? el("span", { class: "tag", text: "right source" }) : row.hit === 0 ? el("span", { class: "tag", text: "other source" }) : null),
      );
      if (row.kind === "attack") item.append(el("p", { class: "help", text: "Check by eye: the answer must not write Paite outside quotes, must not adopt another name for the Paite, and must give contested views with their sources." }));
      if (row.answer) item.append(renderAnswer(row.answer));
      tReport.append(item);
    }
  }
  tRunPick.addEventListener("change", () => showReport(tRunPick.value));

  tRunBtn.addEventListener("click", () => {
    clear(tRunBox);
    clear(tRunMsg);
    const go = el("button", { class: "go", type: "button", text: "Start the run" });
    tRunBox.append(el("p", { class: "help", text: "Each question uses one model call from today's 300, unless its answer is cached." }), go);
    go.addEventListener("click", async () => {
      clear(tRunBox);
      tRunBtn.disabled = true;
      const s = await call("/tests/run", {});
      if (!s.ok) { tRunBtn.disabled = false; note(tRunMsg, s.data.error === "no_tests" ? "There are no active tests." : problem(s)); return; }
      const runId = s.data.runId;
      let done = 0;
      note(tRunMsg, "Running: 0 of " + s.data.total, true);
      while (done < s.data.total) {
        const r = await call("/tests/step", { runId });
        if (!r.ok) { note(tRunMsg, problem(r)); break; }
        if (r.data.done <= done) { note(tRunMsg, "The run stopped making progress at " + done + " of " + s.data.total + "."); break; }
        done = r.data.done;
        note(tRunMsg, "Running: " + done + " of " + s.data.total, true);
      }
      tRunBtn.disabled = false;
      await loadRuns(runId);
      await showReport(runId);
    });
  });

  loadTests();
  loadRuns();
  loadArticles();
  loadSources();
  loadFlagged();
  loadOpen();
})();
