// Hear it: a contributor with a verified sentence reads a verified Paite line aloud.
// The card stays hidden until /api/me says this phone has one. Consent is ticked once
// and kept on the phone, but every upload carries it again, so the server never takes
// a clip without it. A reviewer listens before anything is published.
(() => {
  const $ = (id) => document.getElementById(id);
  const box = $("hear");
  if (!box || !window.MediaRecorder || !navigator.mediaDevices) return;
  const CONSENT = "CC-BY-4.0", MAX_MS = 20000;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem("pd:" + k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem("pd:" + k, JSON.stringify(v)); } catch {} },
  };
  const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  let line = null, rec = null, chunks = [], blob = null, started = 0, ms = 0, timer = null;
  const say = (t) => { $("h-status").textContent = t; };
  const show = (state) => {
    $("h-rec").hidden = state !== "ready";
    $("h-stop").hidden = state !== "recording";
    $("h-play").hidden = $("h-send").hidden = $("h-again").hidden = state !== "done";
    $("h-next").hidden = state === "recording";
  };

  async function next() {
    blob = null; show("ready"); say("");
    const r = await window.paiteApi("/api/record/next");
    if (r.status === 204) { $("h-line").textContent = "Every verified line has its voices for now. Thank you."; $("h-rec").hidden = true; return; }
    if (!r.ok) { box.hidden = true; return; }
    line = await r.json();
    $("h-line").textContent = line.paite; $("h-en").textContent = line.english;
  }

  $("h-consent").checked = store.get("voiceConsent") === CONSENT;
  $("h-consent").addEventListener("change", (e) => store.set("voiceConsent", e.target.checked ? CONSENT : null));

  $("h-rec").addEventListener("click", async () => {
    if (!$("h-consent").checked) { say("Tick the box first: your voice will be published under CC BY 4.0."); $("h-consent").focus(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { say("The microphone is blocked. Allow it for this site, then try again."); return; }
    chunks = []; rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()); clearTimeout(timer);
      ms = Date.now() - started; blob = new Blob(chunks, { type: (rec.mimeType || type || "audio/webm").split(";")[0] });
      $("h-audio").src = URL.createObjectURL(blob); show("done"); say("Listen back. Send it, or record again.");
    };
    rec.start(); started = Date.now(); show("recording"); say("Recording. Read the line, then tap Stop.");
    timer = setTimeout(() => rec.state === "recording" && rec.stop(), MAX_MS);
  });
  $("h-stop").addEventListener("click", () => rec && rec.state === "recording" && rec.stop());
  $("h-play").addEventListener("click", () => $("h-audio").play());
  $("h-again").addEventListener("click", () => { blob = null; show("ready"); say(""); });
  $("h-next").addEventListener("click", () => next().catch(() => say("Could not load a line. Try again.")));
  $("h-send").addEventListener("click", async () => {
    if (!blob || !line) return;
    $("h-send").disabled = true; say("Sending…");
    try {
      const r = await window.paiteApi("/api/record?reviewId=" + line.reviewId, { method: "POST", body: blob,
        headers: { "content-type": blob.type, "X-Consent": CONSENT, "X-Duration": String(ms) } });
      if (r.status === 429) say("Slow down a little, then send again.");
      else if (!r.ok) say("Could not send this clip. Record it again.");
      else { say("Thank you. A reviewer will listen to it."); document.dispatchEvent(new CustomEvent("paite:refresh")); setTimeout(() => next().catch(() => {}), 1200); }
    } catch { say("Could not send. Check your connection."); }
    $("h-send").disabled = false;
  });

  document.addEventListener("paite:me", (e) => {
    const ok = (e.detail.verified || 0) > 0;
    if (ok && box.hidden) { box.hidden = false; next().catch(() => { box.hidden = true; }); }
  });
})();
