// Registers the service worker, and reveals the install button when the
// browser says the app can be installed on this device.
(function () {
  if ("serviceWorker" in navigator) {
    addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  var button = document.getElementById("install-app");
  if (!button) return;

  var offer = null;

  addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    offer = event;
    button.hidden = false;
  });

  button.addEventListener("click", function () {
    if (!offer) return;
    offer.prompt();
    offer.userChoice.then(function () {
      offer = null;
      button.hidden = true;
    });
  });

  addEventListener("appinstalled", function () {
    button.hidden = true;
  });
})();
