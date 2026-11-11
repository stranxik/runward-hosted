// The phone menu of the shell (web/views/shell.js, menu and closeMenuWhenWide). It exists under 900 px only: above,
// the stylesheet hides its button, its veil and its sheet. While it is open it is the one thing that answers: the
// screen, the trail's line, the banners and the foot are inert. A window that crosses 900 px with the menu open (a
// tablet turned) must not keep a screen that ignores every tap with nothing visible: the menu closes when the width
// is crossed. Planted control: without that listener the screen stays inert.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULES } from "../../src/http/assets.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const VIEWS = new URL("../../node_modules/runward-fleet/ui/views.js", import.meta.url);

// ---- the page reduced to what the menu touches: the elements of web/index.html, by their id
const element = () => { const cls = new Set(), attrs = new Map(); return { hidden: false, inert: false, classList: { contains: (c) => cls.has(c), toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); return on; } }, setAttribute: (k, v) => attrs.set(k, v), getAttribute: (k) => attrs.get(k) ?? null }; };
const page = new Map();
const byId = (id) => { if (!page.has(id)) page.set(id, element()); return page.get(id); };
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: byId };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { host: "app.runward.dev", hash: "#/" };

// the modules as served; set up before the first case is declared (under Node.js 22 a case declared earlier would run,
// and the file's after hook with it, while these imports wait)
const served = mkdtempSync(join(tmpdir(), "rw-menu-"));
after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) { const p = join(served, f); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href))); }
const { menu, closeMenuWhenWide } = await import(pathToFileURL(join(served, "views/shell.js")).href);

/** A media query as the browser gives it: listeners, and a way to say the width was crossed. */
const query = () => { const ls = []; return { matches: false, addEventListener: (type, f) => { if (type === "change") ls.push(f); }, cross(matches) { this.matches = matches; for (const f of ls) f({ matches }); }, listeners: ls }; };
const UNDER = ["main", "bartel", "bandeaux", "pied"];
const state = () => ({ open: byId("colonne").classList.contains("menu-ouvert"), expanded: byId("menub").getAttribute("aria-expanded"), inert: UNDER.filter((id) => byId(id).inert), sheetInert: byId("mobnav").inert });

test("the phone menu open: the screen, the trail's line, the banners and the foot are inert, the sheet answers; closed, the reverse", () => {
  byId("menub").hidden = false;
  assert.equal(menu(true), true);
  assert.deepEqual(state(), { open: true, expanded: "true", inert: UNDER, sheetInert: false });
  assert.equal(menu(false), false);
  assert.deepEqual(state(), { open: false, expanded: "false", inert: [], sheetInert: true });
  // signed out there is no menu: its button is hidden, and asking for it opens nothing
  byId("menub").hidden = true;
  assert.equal(menu(true), false);
  assert.deepEqual(state().inert, []);
});

test("a window that crosses 900 px with the menu open closes it: the screen never stays inert with nothing visible", () => {
  byId("menub").hidden = false;
  const wide = query();
  closeMenuWhenWide(wide);
  assert.equal(wide.listeners.length, 1, "it listens to the width");
  menu(true);
  assert.deepEqual(state().inert, UNDER);
  wide.cross(true); // the tablet is turned: 900 px or more
  assert.deepEqual(state(), { open: false, expanded: "false", inert: [], sheetInert: true });
  // back under 900 px the menu stays closed, and opens again when asked
  wide.cross(false);
  assert.equal(state().open, false);
  assert.equal(menu(), true);
  menu(false);
  // planted control: the same crossing with no listener on the width leaves the screen inert
  const deaf = query();
  menu(true);
  deaf.cross(true);
  assert.deepEqual(state(), { open: true, expanded: "true", inert: UNDER, sheetInert: false }, "without the listener the screen ignores every tap");
  menu(false);
  // the page wires it on the width the stylesheet hides the menu at
  assert.match(readFileSync(`${WEB}views/events.js`, "utf8"), /closeMenuWhenWide\(matchMedia\("\(min-width:900px\)"\)\);/);
  assert.match(readFileSync(`${WEB}app.css`, "utf8"), /@media \(min-width:900px\)\{[^@]*\.menu-b, \.voile, \.menu-pan\{ display:none; \}/);
});
