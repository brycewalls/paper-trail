// boot.js: the first thing the page runs, a classic script in <head> (owner: auth, #14). If this
// device has a cached, allowed account (auth.js writes pt-last-user at every confirmed sign-in),
// it marks <html> with "pt-cached" before the first paint, so the app shows at once instead of the
// sign-in screen while the modules and Firebase load. auth.js and main.js take over and remove the
// mark. No imports, no network: it only reads localStorage.
(function () {
  try {
    var u = JSON.parse(localStorage.getItem("pt-last-user") || "null");
    var consent = localStorage.getItem("pt-drive-consent") === "true";
    if (u && u.uid && !consent && !/^#\/auth\/done/.test(location.hash)) document.documentElement.classList.add("pt-cached");
  } catch (e) { /* private mode: the sign-in screen waits for Firebase */ }
})();
