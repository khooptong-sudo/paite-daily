// What's New, above the shawl on the front page. Each item shows for three days from its
// date, the box folds open and shut, and the × hides what is showing now for good on this
// phone (a later item still appears). Add new items at the top of NEWS.
(() => {
  const NEWS = [
    { id: "2026-10-27-week", date: "2026-10-27", title: "Your Week", text: "A weekly note of what you sent and what was verified, ready to share as your WhatsApp status." },
    { id: "2026-10-26-look", date: "2026-10-26", title: "A new look", text: "Blue from top to bottom, sharper text and clearer buttons on every page." },
    { id: "2026-10-26-spell", date: "2026-10-26", title: "Check spelling", text: "Every Paite box has a Check spelling button. It looks each word up in verified Paite and shows the spellings people have used.", href: null },
    { id: "2026-10-26-danbu", date: "2026-10-26", title: "Spelling Danbu", text: "Every spelling a reviewer has corrected, most common first. It writes itself as they work.", href: "/rules" },
    { id: "2026-10-26-place", date: "2026-10-26", title: "Paite pau koia na zir a?", text: "Say where you learned your Paite, if you like. The map shows how many verified lines come from each place, never who.", href: "/places" },
    { id: "2026-10-26-ask", date: "2026-10-26", title: "Ask a relative or friend", text: "The WhatsApp link now opens the same sentence on their phone, so they answer it themselves, with their own name." },
    { id: "2026-10-26-voice", date: "2026-10-26", title: "Aw in Aw: hear it", text: "Once a reviewer accepts a recording, a play button appears beside that line in the chat above." },
    { id: "2026-10-26-keyboard", date: "2026-10-26", title: "Paite for your keyboard", text: "Download the Paite word list for Gboard or AnySoftKeyboard at the bottom of the word list.", href: "/glossary" },
    { id: "2026-10-26-open", date: "2026-10-26", title: "Open data, everywhere", text: "Every verified pair now reaches Hugging Face each week, and Zenodo has a new version, 1.1.0.", href: "https://doi.org/10.5281/zenodo.23664981" },
    { id: "2026-10-26-gaps", date: "2026-10-26", title: "Sentences that fill gaps", text: "You now get sentences with everyday words that have no Paite example yet, first." },
    { id: "2026-10-26-motion", date: "2026-10-26", title: "A little motion", text: "Touch the shawl at the top and it ripples. Number one on Panlate sparkles.", href: "/contributors" },
    { id: "2026-10-26-review", date: "2026-10-26", title: "For reviewers", text: "Swipe to review on a phone, differences between answers marked, keyboard keys on a computer, and spelling rules and old-style endings shown as you review." },
    { id: "2026-10-26-xmas", date: "2026-10-26", title: "Coming in December", text: "Christmas Chibai! Snow, lights, bells and a sleigh, all month." },
  ];
  const DAYS = 3, KEY = "pd:news-hidden", OPEN = "pd:news-open";
  const box = document.getElementById("whatsnew");
  if (!box) return;
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const hidden = new Set(get(KEY, []));
  const now = Date.now();
  const live = NEWS.filter((n) => !hidden.has(n.id) && now < Date.parse(n.date + "T00:00:00") + DAYS * 86400000);
  if (!live.length) return;

  const details = box.querySelector("details"), list = box.querySelector("ul");
  box.querySelector(".news-count").textContent = live.length;
  for (const n of live) {
    const li = document.createElement("li"), b = document.createElement("b"), p = document.createElement("span");
    b.textContent = n.title; p.textContent = n.text;
    li.append(b, p);
    if (n.href) { const a = document.createElement("a"); a.href = n.href; a.textContent = "Have a look"; if (/^https?:/.test(n.href)) { a.target = "_blank"; a.rel = "noopener"; } li.append(a); }
    list.append(li);
  }
  details.open = get(OPEN, false); // starts folded, with the count showing, so the sentence stays near the top
  details.addEventListener("toggle", () => set(OPEN, details.open));
  box.querySelector(".news-close").addEventListener("click", () => {
    live.forEach((n) => hidden.add(n.id));
    set(KEY, [...hidden]);
    box.hidden = true;
  });
  box.hidden = false;
})();
