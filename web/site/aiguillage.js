/* The first script of every public page of runward hosted (ADR-0022), loaded in the head before anything else, from
   the closed list (src/http/assets.js). Two duties, both before the first paint:
   1. an address of the app is a fragment that starts with "#/" (/#/entree, /#/acces, /#/vue/...): it opens the app's
      shell. The page is replaced by /app with the same fragment, and the shell writes the address back to /#/...
      (web/app.js), so the app's addresses stay what they were. A change of fragment within the page does the same
      (a link to /#/entree followed from /). Any other fragment (#contenu, #scene) is an anchor of the page;
   2. the theme chosen in this browser (the app's key, web/views/theme.js) is set, so a dark page never flashes light. */
(function () {
  function versApp() {
    if (location.hash.indexOf("#/") !== 0) return false;
    location.replace("/app" + location.hash);
    return true;
  }
  if (versApp()) return;
  window.addEventListener("hashchange", versApp);
  var theme = null;
  try { theme = new URLSearchParams(location.search).get("theme") || localStorage.getItem("runward-hosted-theme"); } catch (e) { theme = null; }
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
})();
