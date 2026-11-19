// Front-page chat demo. Every Paite line comes back from the API, which answers
// only out of reviewed pairs; this file never composes Paite of its own.
(() => {
  const S = window.STRINGS || {};
  const t = (k) => (S[k] ? S[k].pai || S[k].en : "");
  const $ = (id) => document.getElementById(id);
  const card = $("chat");
  if (!card) return;
  const chips = $("chat-chips");
  const thread = $("chat-thread");
  const note = $("chat-note");
  const form = $("chat-form");
  const input = $("chat-q");
  const chatBox = $("chat-box");
  if (!chatBox) return;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("pd:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("pd:" + k, JSON.stringify(v)); } catch {} },
  };

  let scenes = [];

  input.placeholder = t("chatPlaceholder") || "Type an English line…";

  function draw(i) {
    thread.replaceChildren(
      ...scenes[i].turns.map((turn) => {
        const row = document.createElement("div");
        row.className = "turn " + turn.side;
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = turn.side === "me" ? "You" : "Lianpu";
        const bub = document.createElement("div");
        bub.className = "bub";
        const pai = document.createElement("div");
        pai.className = "pai";
        pai.textContent = turn.paite; pai.lang = "pck";
        const eng = document.createElement("div");
        eng.className = "eng";
        eng.textContent = turn.english;
        bub.append(pai, eng);
        if (turn.audio) pai.append(play(turn.audio));
        row.append(who, bub);
        return row;
      }),
    );
    [...chips.children].forEach((c, k) => c.setAttribute("aria-pressed", String(k === i)));
  }

  fetch("/api/chat/scenes")
    .then((r) => (r.ok ? r.json() : { scenes: [] }))
    .then((d) => {
      scenes = (d.scenes || []).filter((s) => s.turns && s.turns.length);
      // Nothing reviewed yet: no demo rather than an empty shell.
      if (!scenes.length) { card.hidden = true; return; }
      chips.replaceChildren(
        ...scenes.map((s, i) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "chip";
          b.textContent = s.label;
          b.setAttribute("aria-pressed", String(i === 0));
          b.addEventListener("click", () => draw(i));
          return b;
        }),
      );
      draw(0);
    })
    .catch(() => { /* the greeting still greets; chips stay empty */ });

  // Folded to its greeting by default: the demo is a tour, not the page. Once a
  // visitor opens it, their choice is remembered.
  chatBox.open = store.get("chatOpen", false);
  chatBox.addEventListener("toggle", () => store.set("chatOpen", chatBox.open));

  // A line a contributor has read aloud, and a reviewer accepted, gets a play button.
  let voice = null;
  function play(id) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "play"; b.lang = "en"; b.textContent = "▶"; b.setAttribute("aria-label", "Hear it read aloud");
    b.addEventListener("click", () => {
      if (voice && !voice.paused && voice.dataset.id === String(id)) { voice.pause(); return; }
      if (voice) voice.pause();
      voice = new Audio(`/audio/${id}`); voice.dataset.id = id;
      document.querySelectorAll(".play.on").forEach((x) => { x.classList.remove("on"); x.textContent = "▶"; });
      b.classList.add("on"); b.textContent = "❚❚";
      const done = () => { b.classList.remove("on"); b.textContent = "▶"; };
      voice.addEventListener("ended", done); voice.addEventListener("pause", done);
      voice.play().catch(done);
      if (window.pdTrack) window.pdTrack("play");
    });
    return b;
  }

  function say(match) {
    const box = document.createElement("div");
    box.className = "answer";
    const pai = document.createElement("div");
    pai.className = "pai";
    pai.textContent = match.paite;
    const eng = document.createElement("div");
    eng.className = "eng";
    eng.textContent = match.english + " · " + t("chatFromCorpus");
    box.append(pai, eng);
    if (match.audio) pai.append(play(match.audio));
    note.replaceChildren(box);
  }

  function miss(text) {
    note.replaceChildren(document.createTextNode(t("chatMiss") + " "));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "want";
    b.textContent = t("chatWant");
    b.addEventListener("click", () => {
      b.disabled = true;
      b.textContent = "…";
      fetch("/api/chat/want", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: text }) })
        .then((r) => { b.textContent = r.ok ? t("chatWanted") : t("chatWant"); b.disabled = r.ok; })
        .catch(() => { b.textContent = t("chatWant"); b.disabled = false; });
    });
    note.append(b);
  }

  // Tongdot | Tongsan: ask mode. Answers come from the checked ask engine; nothing here composes text.
  const modes = $("chat-modes");
  const submitBtn = form.querySelector("button[type=submit]");
  let mode = "line", askUrl = "", flagUrl = "";
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const safeUrl = (u) => typeof u === "string" && ((u.startsWith("/") && !u.startsWith("//")) || u.startsWith("https://"));
  function link(title, url) {
    if (!safeUrl(url)) return document.createTextNode(title);
    const a = el("a", "", title);
    a.href = url;
    if (url.startsWith("https://")) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  }

  const how = el("a", "ask-who", t("askHow"));
  how.href = "/wiki/how";
  how.hidden = true;
  note.after(how);

  function setMode(m) {
    mode = m;
    [...modes.querySelectorAll("[data-mode]")].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    if (m === "ask") {
      input.maxLength = 300;
      input.placeholder = t("askPlaceholder");
      submitBtn.textContent = t("askButton");
      note.textContent = t("askNote");
      how.hidden = false;
    } else {
      input.maxLength = 120;
      input.placeholder = t("chatPlaceholder") || "Type an English line…";
      submitBtn.textContent = t("chatAsk");
      note.textContent = t("chatNote");
      how.hidden = true;
    }
    store.set("chatMode", m);
  }

  fetch("/api/ask/mode", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : { mode: null }))
    .then((d) => {
      if (d.mode !== "public" && d.mode !== "review") return;
      const review = d.mode === "review";
      askUrl = review ? "/review/api/ask" : "/api/ask";
      flagUrl = review ? "/review/api/ask/flag" : "/api/ask/flag";
      modes.querySelectorAll("[data-mode]").forEach((b) => {
        b.textContent = b.dataset.mode === "ask" ? t("askMode") : t("askModeLine");
        b.addEventListener("click", () => setMode(b.dataset.mode));
      });
      if (review) modes.after(el("p", "ask-who", t("askReviewers")));
      modes.hidden = false;
      if (store.get("chatMode", "line") === "ask") setMode("ask");
    })
    .catch(() => { /* stays as it is today */ });

  function flagBlock(askId) {
    const box = el("div", "ask-flag");
    const send = async (right, noteText, btns) => {
      btns.forEach((b) => { b.disabled = true; });
      try {
        const r = await fetch(flagUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ askId, right, note: noteText }), credentials: "same-origin" });
        if (!r.ok) throw new Error();
        box.replaceChildren(el("span", "", t("askThanks")));
      } catch { btns.forEach((b) => { b.disabled = false; }); }
    };
    const yes = el("button", "", t("askYes"));
    const no = el("button", "", t("askNo"));
    yes.type = no.type = "button";
    yes.addEventListener("click", () => send(true, "", [yes, no]));
    no.addEventListener("click", () => {
      const ta = el("textarea");
      ta.maxLength = 300;
      ta.placeholder = t("askWhy");
      const go = el("button", "", t("askSendNote"));
      go.type = "button";
      go.addEventListener("click", () => send(false, ta.value.trim(), [go, ta]));
      box.replaceChildren(el("span", "", t("askRight")), ta, go);
    });
    box.append(el("span", "", t("askRight")), yes, no);
    return box;
  }

  function seeList(a) {
    if (!a.seeAlso || !a.seeAlso.length) return [];
    const ul = el("ul", "ask-see");
    a.seeAlso.forEach((s) => { const li = el("li"); li.append(link(s.title, s.url)); ul.append(li); });
    return [el("h4", "", t("askSeeAlso")), ul];
  }

  function answerCard(a) {
    if (a.status === "limited") return el("p", "", t("askLimited"));
    if (a.status !== "answer") {
      const box = el("div", "ask-card");
      box.append(el("p", "", t("askNone")), ...seeList(a));
      return box;
    }
    const sources = a.sources || [];
    const card = el("div", "ask-card");
    (a.parts || []).forEach((p) => {
      if (p.type === "quote") {
        const q = el("blockquote", "ask-quote", p.text);
        q.lang = "pck";
        const n = sources.findIndex((s) => s.chunk === p.chunk) + 1;
        if (n) q.append(el("sup", "", String(n)));
        card.append(q);
      } else card.append(el("p", "ask-text", p.text));
    });
    const ol = el("ol", "ask-sources");
    sources.forEach((s) => {
      const li = el("li");
      li.append(link(s.title, s.url));
      if (s.locator) li.append(document.createTextNode(" · " + s.locator));
      ol.append(li);
    });
    card.append(el("h4", "", t("askSources")), ol, ...seeList(a), el("small", "ask-licence", t("askLicence")));
    if (a.askId != null) card.append(flagBlock(a.askId));
    return card;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (window.pdTrack) window.pdTrack(mode === "ask" ? "ask" : "chat");
    note.textContent = "…";
    if (mode === "ask") {
      try {
        const r = await fetch(askUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: text }), credentials: "same-origin" });
        if (!r.ok) throw new Error();
        note.replaceChildren(answerCard(await r.json()));
      } catch {
        note.textContent = t("offline") || "Could not reach the server.";
      }
      return;
    }
    try {
      const d = await (await fetch("/api/chat/match?q=" + encodeURIComponent(text))).json();
      if (d.match) say(d.match); else miss(text);
    } catch {
      note.textContent = t("offline") || "Could not reach the server.";
    }
  });
})();
