// The service shell of runward hosted (PADR-0016 point 4), ported from the preview of 2026-11-06 onto the
// live API. This file is the entry the page loads: it starts the page and nothing else. The shell, the
// router and each screen are the modules of web/views/, served by a closed list (src/http/assets.js#MODULES)
// under one folder named by the digest of them all, and imported by relative paths: no bundler, no import
// map. The fleet views are runward-fleet's views.js, served from the pinned package and imported as is
// (PADR-0011 point 4, web/views/fleet-views.js). Every HTML string goes through one Trusted Types policy
// (web/views/base.js); every value from the API is escaped by the shell or by views.js. Times are kept in
// UTC and shown in Paris time with their offset. Reads per screen stay within the budget of architecture §6
// (4 at most): the router holds them (web/views/router.js).
//
// To add a screen: one file in web/views/, one line in SCREENS (web/views/router.js), one line in MODULES
// (src/http/assets.js). test/unit/shell.test.js fails on a file off the list, and on an import that names
// nothing.
import { S, parts } from "./views/base.js";
import { loadSession, api } from "./views/api.js";
import { show } from "./views/router.js";
import "./views/events.js";
import "./views/theme.js";

// ------------------------------------------------------------- boot: a link in the fragment, never in the address
(async function boot() {
  // the shell's own path: the public site at / sends an address of the app here (web/site/aiguillage.js, ADR-0022);
  // the address is written back to /#/..., the one the app has always had
  if (location.pathname === "/app") history.replaceState(null, "", `/${location.hash || "#/"}`);
  if (location.pathname === "/lien") {
    const m = /^#t=([A-Za-z0-9_-]+)$/.exec(location.hash);
    S.link = m ? m[1] : null;
    history.replaceState(null, "", "/#/lien");
    await loadSession();
    if (S.link) { const r = await api("POST", "/api/v0/links/inspect", { token: S.link }); S.linkInfo = r.ok ? r.data : { state: "link-invalid" }; }
  }
  window.addEventListener("hashchange", () => { S.confirming = null; S.failed = null; show(); });
  window.addEventListener("online", () => { if (parts().route === "panne") show(); });
  await show();
})();
