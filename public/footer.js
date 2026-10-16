// Footer coffee button: phones follow the UPI link; desktop opens the QR panel instead.
(() => {
  const a = document.getElementById("coffee"), p = document.getElementById("upi");
  if (!a || !p) return;
  a.addEventListener("click", (e) => {
    if (matchMedia("(pointer: coarse), (max-width: 640px)").matches) return;
    e.preventDefault();
    p.hidden = !p.hidden;
    a.setAttribute("aria-expanded", String(!p.hidden));
  });
  document.getElementById("upi-copy").addEventListener("click", async () => {
    const id = document.getElementById("upi-id");
    try { await navigator.clipboard.writeText(id.textContent); } catch {
      const r = document.createRange(); r.selectNodeContents(id);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  });
})();
