// The ask answer card, shared by the front-page chat and /wiki. Nothing here composes
// text: it only draws what the ask engine returned. opts = { t(key), flagUrl }.
(() => {
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

  function flagBlock(askId, t, flagUrl) {
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

  function seeList(a, t) {
    if (!a.seeAlso || !a.seeAlso.length) return [];
    const ul = el("ul", "ask-see");
    a.seeAlso.forEach((s) => { const li = el("li"); li.append(link(s.title, s.url)); ul.append(li); });
    return [el("h4", "", t("askSeeAlso")), ul];
  }

  window.pdAnswerCard = (a, opts) => {
    const t = opts.t;
    if (a.status === "limited") return el("p", "", t("askLimited"));
    if (a.status !== "answer") {
      const box = el("div", "ask-card");
      box.append(el("p", "", t("askNone")), ...seeList(a, t));
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
      if (s.audio) {
        const b = el("button", "play");
        b.type = "button";
        b.dataset.audio = String(s.audio);
        b.setAttribute("aria-label", "Listen");
        li.append(b);
        if (s.readBy) li.append(el("span", "by-line", "Read by " + s.readBy));
      }
      ol.append(li);
    });
    if (window.pdPlayInit) setTimeout(window.pdPlayInit);
    card.append(el("h4", "", t("askSources")), ol, ...seeList(a, t), el("small", "ask-licence", t("askLicence")));
    if (a.askId != null) card.append(flagBlock(a.askId, t, opts.flagUrl));
    return card;
  };
})();
