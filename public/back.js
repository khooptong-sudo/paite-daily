// Back links: step back in history when the visitor came from this site, otherwise follow the href.
document.addEventListener("click", function (e) {
  var a = e.target.closest && e.target.closest("a[data-back]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  try { if (history.length > 1 && new URL(document.referrer).origin === location.origin) { e.preventDefault(); history.back(); } } catch (_) {}
});
