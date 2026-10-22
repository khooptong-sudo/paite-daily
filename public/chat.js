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
        pai.textContent = turn.paite;
        const eng = document.createElement("div");
        eng.className = "eng";
        eng.textContent = turn.english;
        bub.append(pai, eng);
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    note.textContent = "…";
    try {
      const d = await (await fetch("/api/chat/match?q=" + encodeURIComponent(text))).json();
      if (d.match) say(d.match); else miss(text);
    } catch {
      note.textContent = t("offline") || "Could not reach the server.";
    }
  });
})();
