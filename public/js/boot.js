// boot.js: the first thing the page runs, a classic script in <head> (owner: auth, #14). If this
// device has a cached, allowed account (auth.js writes pt-last-user at every confirmed sign-in),
// it marks <html> with "pt-cached" before the first paint, so the app shows at once instead of the
// sign-in screen while the modules and Firebase load. auth.js and main.js take over and remove the
// mark. No imports, no network: it only reads localStorage.
// The lab build (#92): on paper-trail-lab.web.app (or localhost with ?lab) it also marks <html> with
// "pt-lab" before the first paint, so the Lab tint never flashes in late, and points the manifest
// and the Home Screen title at the lab's own. The same test as LAB in config.js.
(function () {
  try {
    var u = JSON.parse(localStorage.getItem("pt-last-user") || "null");
    var consent = localStorage.getItem("pt-drive-consent") === "true";
    if (u && u.uid && !consent && !/^#\/auth\/done/.test(location.hash)) document.documentElement.classList.add("pt-cached");
  } catch (e) { /* private mode: the sign-in screen waits for Firebase */ }
})();
(function () {
  var h = location.hostname;
  var lab = h === "paper-trail-lab.web.app" || h === "paper-trail-lab.firebaseapp.com"
    || (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(h) && /[?&]lab(=|&|$)/.test(location.search));
  if (!lab) return;
  document.documentElement.classList.add("pt-lab");
  document.title = "Paper Trail Lab";
  var m = document.querySelector('link[rel="manifest"]');
  if (m) m.setAttribute("href", "lab.webmanifest");
  var t = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (t) t.setAttribute("content", "PT Lab");
})();
