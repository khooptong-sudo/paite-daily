// Word of the Day: one dictionary word, the same for everyone all day. Stays hidden on any failure.
(async () => {
  try {
    const r = await fetch("/api/word-of-day");
    if (!r.ok) return;
    const d = await r.json();
    document.getElementById("wotd-word").textContent = d.paite;
    document.getElementById("wotd-en").textContent = `${d.english} · ${d.type}`;
    document.getElementById("wotd").hidden = false;
  } catch {}
})();
