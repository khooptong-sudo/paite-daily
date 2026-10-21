// Podium share: each of the top three cards gets a Share chip. It draws a 1080 x 1920
// status card (the shawl, the place, the name, the counts) and hands it to the phone's
// share sheet, so the person can post it as a WhatsApp status. Desktop saves the image.
(() => {
  const PLACE = { 1: ["1st", "#202223", "#f6ff00"], 2: ["2nd", "#00a651", "#fff"], 3: ["3rd", "#d71920", "#fff"] };
  const band = document.querySelector("img.puan");
  document.querySelectorAll(".podium .p").forEach((card) => {
    const rank = Number((card.className.match(/\bp([123])\b/) || [])[1]);
    if (!rank) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "share-chip pod-share";
    b.innerHTML = '<img src="/whatsapp.png" alt="" width="14" height="14">Share';
    b.setAttribute("aria-label", "Share this place as a WhatsApp status");
    card.insertBefore(b, card.querySelector(".ring"));
    b.addEventListener("click", () => share(card, rank).catch(() => {}));
  });
  async function share(card, rank) {
    await document.fonts.ready;
    const [label, fill, ink] = PLACE[rank];
    const view = card.closest(".view");
    const when = view && /all/i.test(view.querySelector("h2")?.textContent || "") ? "of all time" : "this week";
    const name = card.querySelector(".nm")?.textContent.trim() || "";
    const counts = [...card.querySelectorAll(".c")].map((c) => (c.querySelector("b").dataset.n || c.querySelector("b").textContent) + " " + (c.querySelector(".u")?.textContent.trim() || "")).join("   ·   ");
    const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
    const g = c.getContext("2d"), css = getComputedStyle(document.documentElement);
    const display = css.getPropertyValue("--display"), body = css.getPropertyValue("--body");
    g.fillStyle = "#fbfbf9"; g.fillRect(0, 0, 1080, 1920);
    if (band) { const img = new Image(); img.src = band.currentSrc || band.src; await img.decode(); g.drawImage(img, 0, 0, 1080, 231); }
    g.textAlign = "center"; g.fillStyle = "#5d6066"; g.font = `700 40px ${body}`;
    g.fillText("PANLATE · PAITE DAILY", 540, 380);
    // The step: a rounded block in the place's colour, with the place in large type.
    const top = 520, h = 560;
    g.fillStyle = fill; g.beginPath(); g.roundRect(190, top, 700, h, 48); g.fill();
    ["#d71920", "#f6ff00", "#00a651", "#000"].forEach((col, i) => { g.fillStyle = col; g.fillRect(190 + i * 175, top + h - 28, 175, 28); });
    g.fillStyle = ink; g.font = `400 300px ${display}`; g.fillText(String(rank), 540, top + 360);
    g.font = `700 54px ${body}`; g.fillText(`${label} ${when}`.toUpperCase(), 540, top + 460);
    g.fillStyle = "#111"; g.font = `400 88px ${display}`; g.fillText(name, 540, 1230, 960);
    g.fillStyle = "#5d6066"; g.font = `44px ${body}`; g.fillText(counts, 540, 1320, 960);
    g.fillStyle = "#111"; g.font = `700 46px ${body}`; g.fillText("Writing Paite into the future.", 540, 1640);
    g.fillStyle = "#5d6066"; g.font = `40px ${body}`; g.fillText("paite.lamkalabs.com/contributors", 540, 1710);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const file = new File([blob], "paite-daily-panlate.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: `${name}: ${label} ${when} on Paite Daily. https://paite.lamkalabs.com/contributors` });
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  }
})();
