// First-party funnel beacon. No cookie, no third party, no personal data.
// Skips itself when the browser asks for no tracking. Never blocks the page.
(function () {
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
  var vid = null;
  try {
    vid = sessionStorage.getItem("pd:vid");
    if (!vid) { vid = Math.random().toString(36).slice(2, 12); sessionStorage.setItem("pd:vid", vid); }
  } catch (e) {}
  var body = function (kind) {
    return JSON.stringify({ kind: kind, path: location.pathname, vid: vid, ref: document.referrer || null });
  };
  window.pdTrack = function (kind, extra) {
    try {
      var payload = body(kind);
      if (extra) payload = JSON.stringify(Object.assign(JSON.parse(payload), extra));
      if (navigator.sendBeacon) navigator.sendBeacon("/api/event", new Blob([payload], { type: "application/json" }));
      else fetch("/api/event", { method: "POST", body: payload, keepalive: true });
    } catch (e) {}
  };
  window.pdTrack("page");
})();
