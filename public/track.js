// First-party visit counting. No cookie, no third party, no personal data, no IP kept.
// Skips itself when the browser asks for no tracking. Never blocks the page: the one thing it waits
// for is the browser's own model and version hints, and never longer than 400 ms.
// Sends: the page, a random id for this tab, the referrer's host (cut on the server), a
// shared-link tag (?via=wa), whether this browser has been here before (yes/no, never an id),
// and how long the page was actually on screen. With the first beacon, coarse facts about the device:
// language, time zone, screen-width bucket, pixel density, connection type, theme, installed app,
// and the phone model and system and browser versions when the browser offers them. On leaving, how
// fast the page was and how far it was read. A click on a link to another site sends only that site's
// name; a script error sends a short message (at most three a tab). Nothing typed is ever sent.
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

  // The browser's own hints (phone model, system and browser version), if it has them, within 400 ms.
  function hints() {
    return new Promise(function (resolve) {
      var done = false;
      function end(h) { if (!done) { done = true; clearTimeout(t); resolve(h || {}); } }
      var t = setTimeout(end, 400);
      try {
        var u = navigator.userAgentData;
        if (!u || !u.getHighEntropyValues) return end();
        u.getHighEntropyValues(["model", "platformVersion", "fullVersionList"]).then(end, function () { end(); });
      } catch (e) { end(); }
    });
  }
  // What is true of this device and page, all coarse. Every line may fail on its own.
  function facts(h) {
    var o = {}, mm = function (s) { return window.matchMedia && matchMedia(s).matches; };
    try { o.lang = navigator.language; } catch (e) {}
    try { o.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    try { var w = innerWidth; o.vw = w < 360 ? "<360" : w < 390 ? "360-389" : w < 420 ? "390-419" : w < 600 ? "420-599" : w < 900 ? "600-899" : w < 1280 ? "900-1279" : "1280+"; } catch (e) {}
    try { o.dpr = Math.round(devicePixelRatio || 1); } catch (e) {}
    try { var c = navigator.connection; if (c) o.net = c.saveData ? "saver" : c.effectiveType === "slow-2g" ? "2g" : c.effectiveType; } catch (e) {}
    try {
      o.scheme = mm("(prefers-color-scheme: dark)") ? "dark" : "light";
      var th = document.documentElement.getAttribute("data-theme");
      o.theme = th === "light" || th === "dark" ? th : o.scheme;
      o.pwa = mm("(display-mode: standalone)") || navigator.standalone ? 1 : 0;
    } catch (e) {}
    try {
      if (h.model) o.model = h.model;
      if (h.platformVersion) o.pv = h.platformVersion;
      var list = h.fullVersionList || [], pick = null;
      list.forEach(function (b) { if (!pick && !/not.?a.?brand|chromium/i.test(b.brand)) pick = b; });
      // Only a Chromium entry is left: use it, but never the grease brand ("Not A;Brand 8").
      if (!pick) list.forEach(function (b) { if (!pick && !/not.?a.?brand/i.test(b.brand)) pick = b; });
      if (pick && pick.version) o.bvh = parseInt(pick.version, 10);
    } catch (e) {}
    return o;
  }
  hints().then(function (h) { window.pdTrack("page", facts(h)); }, function () { window.pdTrack("page"); });

  // Speed and how far the page was read, sent once, with the first 'leave'.
  var lcp = null, cls = 0, win = 0, winFirst = 0, winLast = 0, inp = 0, maxScroll = 0, sentSpeed = false;
  try { new PerformanceObserver(function (l) { var e = l.getEntries(); if (e.length) lcp = Math.round(e[e.length - 1].startTime); }).observe({ type: "largest-contentful-paint", buffered: true }); } catch (e) {}
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) {
        if (e.hadRecentInput) return;
        if (win && e.startTime - winLast < 1000 && e.startTime - winFirst < 5000) win += e.value; else { win = e.value; winFirst = e.startTime; }
        winLast = e.startTime;
        if (win > cls) cls = win;
      });
    }).observe({ type: "layout-shift", buffered: true });
  } catch (e) {}
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (e.duration > inp) inp = e.duration; }); }).observe({ type: "event", durationThreshold: 40, buffered: true }); } catch (e) {}
  function reach() {
    try { var d = document.documentElement, p = Math.round(((scrollY + innerHeight) / Math.max(d.scrollHeight, 1)) * 100); if (p > maxScroll) maxScroll = Math.min(p, 100); } catch (e) {}
  }
  var tick = 0;
  addEventListener("scroll", function () { if (!tick) tick = setTimeout(function () { tick = 0; reach(); }, 200); }, { passive: true });
  reach();
  function speed() {
    var o = {};
    try {
      reach();
      o.scroll = maxScroll;
      if (lcp !== null) o.lcp = lcp;
      if (inp > 0) o.inp = Math.round(inp);
      o.cls = Math.round(cls * 1000);
      var n = performance.getEntriesByType("navigation")[0];
      if (n) { if (n.responseStart > 0) o.ttfb = Math.round(n.responseStart); if (n.loadEventEnd > 0) o.load = Math.round(n.loadEventEnd); }
    } catch (e) {}
    return o;
  }

  // Time on screen: counted only while the page is visible, sent when it is hidden or left.
  var shown = document.visibilityState === "visible" ? Date.now() : 0, spent = 0;
  function pause() { if (shown) { spent += Date.now() - shown; shown = 0; } }
  function flush() {
    pause();
    if (spent >= 1000) {
      var extra = { ms: Math.min(spent, 1800000) };
      if (!sentSpeed) { sentSpeed = true; var s = speed(); for (var k in s) extra[k] = s[k]; }
      window.pdTrack("leave", extra);
    }
    spent = 0;
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); else shown = Date.now(); });
  addEventListener("pagehide", flush);

  // A click on a link to another site: only the site's name is sent.
  document.addEventListener("click", function (e) {
    try {
      var a = e.target && e.target.closest ? e.target.closest("a[href^='http']") : null;
      if (a && a.hostname && a.hostname !== location.hostname) window.pdTrack("out", { target: a.hostname });
    } catch (x) {}
  }, true);

  // Script errors, at most three a tab, each cut to 120 characters on the server too.
  function oops(m) {
    try {
      var n = Number(sessionStorage.getItem("pd:err") || 0);
      if (n >= 3) return;
      sessionStorage.setItem("pd:err", String(n + 1));
      window.pdTrack("jserror", { target: String(m || "error").slice(0, 120) });
    } catch (e) {}
  }
  addEventListener("error", function (e) { oops(e && e.message); });
  addEventListener("unhandledrejection", function (e) { oops(e && e.reason && e.reason.message ? e.reason.message : e && e.reason); });
})();
