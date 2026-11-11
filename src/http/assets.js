// The shell's static files, built once at start: names that carry their digest, cached immutable; the
// page itself no-store. The shell's scripts are ES modules (web/app.js, the entry, and web/views/), served by
// a closed list under one folder named by the digest of them all, so that they import each other by relative
// paths: no bundler, no import map, and one file changed renames the folder for every module. views.js is
// read from the pinned runward-fleet package, never copied into this
// repository (PADR-0011 point 4); the fleet stylesheet is the <style> of its template.html with its :root
// token blocks removed, so web/couche-runward-app.css (the app's layer, ADR "app layer") is the only source
// of values. The app's fonts (Geist, Geist Mono, SIL OFL 1.1) are served from web/fonts/, by a closed list:
// nothing else in that folder, and nothing outside it, is ever served.
//
// The public site left this origin (ADR-0028): its pages answer 308 to runward.dev (src/http/moved.js), and nothing
// of web/site/ is served any more. Its sources stay in the tree until their removal, a change of its own.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const WEB = new URL("../../web/", import.meta.url).pathname;
/** The files of web/fonts/ the app serves, and only these (closed list: no folder is listed at run time). */
export const FONTS = Object.freeze([
  ["Geist-Regular.woff2", "font/woff2"], ["Geist-Medium.woff2", "font/woff2"], ["Geist-SemiBold.woff2", "font/woff2"],
  ["GeistMono-Regular.woff2", "font/woff2"], ["GeistMono-Medium.woff2", "font/woff2"], ["OFL.txt", "text/plain; charset=utf-8"],
]);

/**
 * The modules of the shell the app serves, and only these: web/app.js (the entry the page loads) and the
 * files of web/views/ it reaches, by their path under web/. Nothing else of web/views/, and no folder, is
 * read at run time. One line per file: a lot adds its screen's file here, in its group, when it adds its
 * line to SCREENS (web/views/router.js). test/unit/shell.test.js fails on a file of web/views/ that is not
 * listed, on a listed file that is missing, and on an import that names a file off this list.
 */
export const MODULES = Object.freeze([
  "app.js",
  // ---- the base: the page, its words (FR, EN), the API, the pinned fleet views
  "views/base.js",
  "views/lexique.js",
  "views/time.js",
  "views/marks.js",
  "views/api.js",
  "views/webauthn.js",
  "views/fleet-views.js",
  // ---- what several screens share
  "views/lignes.js",
  "views/confirm.js",
  "views/workflow.js",
  "views/claims.js",
  "views/liens.js",
  // ---- the shell, its theme selector, the router, the gestures
  "views/shell.js",
  "views/theme.js",
  "views/router.js",
  "views/gestures.js",
  "views/events.js",
  // ---- the screens, one file each
  "views/entree.js",
  "views/lien.js",
  "views/reprise.js",
  "views/arrivee.js",
  "views/declarer.js",
  "views/envois.js",
  "views/fleet.js",
  "views/flotte.js",
  "views/decision.js",
  "views/mission.js",
  "views/panne.js",
  "views/legal.js",
  "views/introuvable.js",
  // ---- Accès: the screen, its sections, its sub-screens
  "views/acces.js",
  "views/acces/passkeys.js",
  "views/acces/sessions.js",
  "views/acces/depots.js",
  "views/acces/reglages.js",
  "views/acces/membres.js",
  "views/acces/donnees.js",
  "views/acces/limites.js",
  "views/acces/ajout.js",
  "views/acces/export.js",
  "views/acces/effacer.js",
  "views/acces/depot.js",
]);
const SCRIPT = "text/javascript; charset=utf-8";
const CSS = "text/css; charset=utf-8";

/**
 * The scripts and the stylesheet of web/site/, the public site this origin served until ADR-0028: [file, its key in
 * the pages' links, its media type]. None is served any more (test/unit/site.test.js asks each of them, 404); the list
 * stays, with the sources, for the guards that still read them (test/unit/tokens.test.js, test/unit/site.test.js),
 * until web/site/ is removed.
 */
export const SITE_FILES = Object.freeze([
  ["site.css", "css", CSS],
  ["aiguillage.js", "aiguillage", SCRIPT],
  ["site.js", "js", SCRIPT],
]);

/** The folder the modules are served under: one digest over every name and every byte, in the list's order. */
export function modulesFolder(modules) {
  return `/assets/app.${sha(Buffer.concat(modules.flatMap(([f, bytes]) => [Buffer.from(`${f}\0${bytes.length}\0`), bytes]))).slice(0, 16)}/`;
}

/** The selector without the comments before it (a loop, not a nested quantifier: no backtracking). */
function leadingCommentsOff(selector) {
  let s = selector;
  for (;;) {
    const t = s.trimStart();
    if (!t.startsWith("/*")) return t;
    const close = t.indexOf("*/", 2);
    if (close < 0) return t;
    s = t.slice(close + 2);
  }
}

/** Remove every rule whose selector starts with :root, including inside an at-rule; drop at-rules left empty. */
export function stripRootBlocks(css) {
  let out = "", i = 0;
  const block = (from) => { let depth = 0; for (let j = from; j < css.length; j++) { if (css[j] === "{") depth++; else if (css[j] === "}") { depth--; if (depth === 0) return j + 1; } } return css.length; };
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) { out += css.slice(i); break; }
    const selector = css.slice(i, open);
    const end = block(open);
    if (/^\s*:root\b/.test(leadingCommentsOff(selector))) { out += selector.replace(/[^\n]*$/, ""); i = end; continue; }
    if (/^\s*@media/.test(selector.trim().split("\n").pop() ?? "")) {
      const inner = stripRootBlocks(css.slice(open + 1, end - 1));
      out += inner.trim() ? `${selector}{${inner}}` : selector.replace(/[^\n]*$/, "");
      i = end; continue;
    }
    out += css.slice(i, end); i = end;
  }
  return out;
}

export function fleetCss(pinDir) {
  const t = readFileSync(join(pinDir, "ui", "template.html"), "utf8");
  const css = t.slice(t.indexOf("<style>") + 7, t.indexOf("</style>")).replace("/*FONTS*/", "");
  return stripRootBlocks(css);
}

export function buildAssets({ pin, commit }) {
  const files = new Map();
  const add = (name, ext, bytes, type) => { const p = `/assets/${name}.${sha(bytes).slice(0, 16)}.${ext}`; files.set(p, { bytes, type, immutable: true }); return p; };
  const views = readFileSync(join(pin.dir, "ui", "views.js"));
  const viewsPath = add(`views-${pin.version}`, "js", views, SCRIPT);
  const famille = add("famille", "css", readFileSync(join(WEB, "famille.css")), CSS);
  const couche = add("couche-runward-app", "css", readFileSync(join(WEB, "couche-runward-app.css")), CSS);
  const fleet = add(`fleet-${pin.version}`, "css", Buffer.from(fleetCss(pin.dir)), CSS);
  const appCss = add("app", "css", readFileSync(join(WEB, "app.css")), CSS);
  // the modules: the slot of the pinned views filled first, then one digest over every name and every byte
  const modules = MODULES.map((f) => [f, Buffer.from(readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(viewsPath)))]);
  const folder = modulesFolder(modules);
  for (const [f, bytes] of modules) files.set(`${folder}${f}`, { bytes, type: SCRIPT, immutable: true });
  const appJs = `${folder}app.js`;
  for (const [f, type] of FONTS) files.set(`/assets/fonts/${f}`, { bytes: readFileSync(join(WEB, "fonts", f)), type, immutable: false });
  const page = Buffer.from(readFileSync(join(WEB, "index.html"), "utf8")
    .replace("__COMMIT__", commit).replace("__FAMILLE_CSS__", famille).replace("__COUCHE_CSS__", couche).replace("__FLEET_CSS__", fleet)
    .replace("__APP_CSS__", appCss).replace("__VIEWS_JS__", viewsPath).replace("__APP_JS__", appJs));
  return { files, page, viewsSha256: sha(views), viewsPath, modulesPath: folder };
}
