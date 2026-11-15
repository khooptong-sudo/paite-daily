// First-party visit counting. No cookie, no third party, no personal data, no IP kept.
// Skips itself when the browser asks for no tracking. Never blocks the page.
// Sends: the page, a random id for this tab, the referrer's host (cut on the server), a
// shared-link tag (?via=wa), whether this browser has been here before (yes/no, never an id),
// and how long the page was actually on screen.
(function () {
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;
  var vid = null, ret = null, via = null;
  try {
    vid = sessionStorage.getItem("pd:vid");
    if (!vid) { vid = Math.random().toString(36).slice(2, 12); sessionStorage.setItem("pd:vid", vid); }
    // Decided once per tab: a later page in the same visit must not turn it into a "return".
    ret = sessionStorage.getItem("pd:ret");
    if (ret === null) { ret = localStorage.getItem("pd:been") ? "1" : "0"; sessionStorage.setItem("pd:ret", ret); localStorage.setItem("pd:been", "1"); }
  } catch (e) {}
  // A tag on a shared link says where it was shared. Read it, then tidy the address bar.
  // ?s= is a sentence id (the "ask a relative" link) and is left alone.
  try {
    var q = new URLSearchParams(location.search);
    via = q.get("via") || q.get("utm_source");
    var junk = ["via", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];
    if (junk.some(function (k) { return q.has(k); })) {
      junk.forEach(function (k) { q.delete(k); });
      var rest = q.toString();
      history.replaceState(history.state, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
    }
  } catch (e) {}
  var ref = document.referrer || null;
  window.pdTrack = function (kind, extra) {
    try {
      var p = { kind: kind, path: location.pathname, vid: vid, ref: ref, via: via, ret: ret === null ? null : Number(ret) };
      if (extra) for (var k in extra) p[k] = extra[k];
      var payload = JSON.stringify(p);
      if (navigator.sendBeacon) navigator.sendBeacon("/api/event", new Blob([payload], { type: "application/json" }));
      else fetch("/api/event", { method: "POST", body: payload, keepalive: true });
    } catch (e) {}
  };
  window.pdTrack("page");
  // Time on screen: counted only while the page is visible, sent when it is hidden or left.
  var shown = document.visibilityState === "visible" ? Date.now() : 0, spent = 0;
  function pause() { if (shown) { spent += Date.now() - shown; shown = 0; } }
  function flush() { pause(); if (spent >= 1000) window.pdTrack("leave", { ms: Math.min(spent, 1800000) }); spent = 0; }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); else shown = Date.now(); });
  addEventListener("pagehide", flush);
})();
