// The shell is ES modules without a bundler (web/app.js, the entry, and web/views/): the browser is the
// only thing that would see a module left off the served list, an import that names nothing, or a name
// used and never imported, and it would see it at the moment a visitor opens that screen. These guards see
// it before: the closed list of src/http/assets.js is the files on disk; every import names a listed module
// and a name that module exports; no identifier is left undefined. Each has a planted control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { ESLint } from "eslint";
import { MODULES } from "../../src/http/assets.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const WEB = new URL("../../web/", import.meta.url).pathname;
const SLOT = "__VIEWS__"; // the served path of the pinned runward-fleet views, written by the server

/**
 * The scripts under web/: app.js and every file of views/, by their path under web/. The public site's scripts
 * (web/site/, ADR-0022) are not modules of the shell: they are another closed list (SITE_FILES), held to the files on
 * disk by test/unit/site.test.js.
 */
const onDisk = () => readdirSync(WEB, { recursive: true }).map((f) => f.split("\\").join("/")).filter((f) => f.endsWith(".js") && !f.startsWith("site/")).sort();

/** What separates a list from the files: the files not listed, the names listed twice or missing. */
export function listFaults(listed, files) {
  const faults = [];
  for (const f of files) if (!listed.includes(f)) faults.push(`not listed: ${f}`);
  for (const f of listed) if (!files.includes(f)) faults.push(`listed, missing: ${f}`);
  for (const f of new Set(listed)) if (listed.filter((x) => x === f).length > 1) faults.push(`listed twice: ${f}`);
  return faults;
}

/** The imports of a module: [specifier, names] (names empty for a side-effect import), and what it exports. */
export function reads(text) {
  const src = text.replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``");
  const names = (s) => s.split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean);
  const imports = [
    ...[...src.matchAll(/^import\s+\{([^}]*)\}\s+from\s+"([^"]+)";/gm)].map((m) => [m[2], names(m[1])]),
    ...[...src.matchAll(/^import\s+"([^"]+)";/gm)].map((m) => [m[1], []]),
    ...[...src.matchAll(/^export\s+\{([^}]*)\}\s+from\s+"([^"]+)";/gm)].map((m) => [m[2], []]),
  ];
  const exports = [
    ...[...src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]),
    ...[...src.matchAll(/^export\s+(?:const|let)\s+([^=]+?)\s*=/gm)].map((m) => m[1]),
    ...[...src.matchAll(/^export\s+(?:const|let)\s[^\n]*/gm)].flatMap((m) => [...m[0].matchAll(/[,;]?\s([A-Za-z0-9_$]+)\s=\s/g)].map((x) => x[1])),
    ...[...src.matchAll(/^export\s+\{([^}]*)\}/gm)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)),
  ];
  const other = [...src.matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]).filter((l) => !/^import\s+(\{[^}]*\}\s+from\s+)?"[^"]+";$/.test(l));
  return { imports, exports: [...new Set(exports)], other };
}

/** The imports that would fail in a browser: a module off the list, a name the module does not export. */
export function importFaults(modules) {
  const faults = [];
  for (const [f, text] of Object.entries(modules)) {
    const { imports, other } = reads(text);
    for (const l of other) faults.push(`${f}: an import this guard cannot read: ${l.trim()}`);
    for (const [spec, names] of imports) {
      if (spec === SLOT) { if (f !== "views/fleet-views.js") faults.push(`${f}: only views/fleet-views.js names the pinned views`); continue; }
      if (!spec.startsWith("./") && !spec.startsWith("../")) { faults.push(`${f}: ${spec} is not a relative path`); continue; }
      const target = normalize(join(dirname(f), spec)).split("\\").join("/");
      if (!Object.hasOwn(modules, target)) { faults.push(`${f}: ${spec} is not a module of the list`); continue; }
      const exported = reads(modules[target]).exports;
      for (const n of names) if (!exported.includes(n)) faults.push(`${f}: ${target} does not export ${n}`);
    }
  }
  return faults;
}

/** The import cycles among the modules, each as its path: a module evaluated before one it imports reads a name not yet set. */
export function cycles(modules) {
  const next = (f) => reads(modules[f]).imports.filter(([spec]) => spec !== SLOT).map(([spec]) => normalize(join(dirname(f), spec)).split("\\").join("/")).filter((g) => Object.hasOwn(modules, g));
  const found = [], state = new Map();
  const visit = (f, path) => {
    if (state.get(f) === "done") return;
    if (state.get(f) === "open") { found.push([...path.slice(path.indexOf(f)), f].join(" > ")); return; }
    state.set(f, "open");
    for (const g of next(f)) visit(g, [...path, f]);
    state.set(f, "done");
  };
  for (const f of Object.keys(modules)) visit(f, []);
  return found;
}

const texts = () => Object.fromEntries(MODULES.map((f) => [f, readFileSync(join(WEB, f), "utf8")]));

test("the served list of the shell's modules is the scripts under web/: none off the list, none missing, none twice", () => {
  const files = onDisk();
  assert.ok(files.includes("app.js") && files.filter((f) => f.startsWith("views/")).length >= 25, "the guard must see the real files, or it proves nothing");
  assert.deepEqual(listFaults([...MODULES], files), []);
});

test("planted controls: a file off the list, a listed file that is missing, a name listed twice", () => {
  assert.deepEqual(listFaults(["app.js"], ["app.js", "views/planted.js"]), ["not listed: views/planted.js"]);
  assert.deepEqual(listFaults(["app.js", "views/gone.js"], ["app.js"]), ["listed, missing: views/gone.js"]);
  assert.deepEqual(listFaults(["app.js", "app.js"], ["app.js"]), ["listed twice: app.js"]);
});

test("every import of every module names a module of the list and a name it exports; only one module names the pinned views", () => {
  const modules = texts();
  const all = Object.values(modules).flatMap((t) => reads(t).imports);
  assert.ok(all.length >= 100, "the guard must see the real imports, or it proves nothing");
  assert.deepEqual(importFaults(modules), []);
  // every module is reached from the entry: a listed file nothing imports is served for nothing
  const seen = new Set(), stack = ["app.js"];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const [spec] of reads(modules[f]).imports) if (spec !== SLOT) stack.push(normalize(join(dirname(f), spec)).split("\\").join("/"));
  }
  assert.deepEqual(MODULES.filter((f) => !seen.has(f)), [], "reached from web/app.js");
  // and the modules import each other in one direction: the base, what screens share, the screens, the shell,
  // the router, the gestures, the entry
  assert.deepEqual(cycles(modules), []);
});

test("planted controls: an import off the list, a name not exported, a bare specifier, a second module naming the pinned views, a default import, a cycle", () => {
  const base = { "app.js": 'import { a } from "./views/a.js";\n', "views/a.js": "export const a = 1;\n" };
  assert.deepEqual(importFaults(base), []);
  assert.deepEqual(importFaults({ ...base, "app.js": 'import { a } from "./views/b.js";\n' }), ["app.js: ./views/b.js is not a module of the list"]);
  assert.deepEqual(importFaults({ ...base, "app.js": 'import { a, b } from "./views/a.js";\n' }), ["app.js: views/a.js does not export b"]);
  assert.deepEqual(importFaults({ ...base, "views/a.js": 'import { x } from "lodash";\nexport const a = 1;\n' }), ["views/a.js: lodash is not a relative path"]);
  assert.deepEqual(importFaults({ ...base, "views/a.js": 'import { renderView } from "__VIEWS__";\nexport const a = 1;\n' }), ["views/a.js: only views/fleet-views.js names the pinned views"]);
  assert.deepEqual(importFaults({ ...base, "app.js": 'import a from "./views/a.js";\n' }), ['app.js: an import this guard cannot read: import a from "./views/a.js";']);
  assert.deepEqual(cycles({ ...base, "views/a.js": 'import { b } from "./b.js";\nexport const a = 1;\n', "views/b.js": 'import { a } from "./a.js";\nexport const b = a;\n' }), ["views/a.js > views/b.js > views/a.js"]);
  assert.deepEqual(cycles(base), []);
  assert.deepEqual(importFaults({ "views/a.js": 'import { b } from "../views/acces/b.js";\n', "views/acces/b.js": 'import { a } from "../a.js";\nexport function b() {}\n' }), ["views/acces/b.js: views/a.js does not export a"]);
});

// What the shell touches of the browser, and nothing else: a name outside this list and outside the
// module's own imports is undefined at run time.
const BROWSER = ["document", "window", "location", "history", "navigator", "fetch", "localStorage", "matchMedia", "getSelection", "setTimeout", "clearTimeout", "atob", "btoa", "PublicKeyCredential", "NodeFilter", "CSS"];
// Inherited, kept as it was by lot L0, which changes no behaviour: api() calls render(), a name nothing
// declares (web/app.js line 53 before the cut), inside the timer of a request slower than 20 s. The timer
// throws after setting S.slow, and nothing is redrawn. This entry goes away with the fix of that defect.
const KNOWN_UNDEFINED = ["views/api.js: render"];
const linter = new ESLint({
  cwd: ROOT, overrideConfigFile: true,
  overrideConfig: [{ files: ["**/*.js"], languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: Object.fromEntries(BROWSER.map((g) => [g, "readonly"])) }, rules: { "no-undef": "error", "no-import-assign": "error", "no-const-assign": "error" } }],
});
const undefinedIn = async (file, text) => (await linter.lintText(text, { filePath: `${ROOT}web/${file}` }))[0].messages.map((m) => `${file}: ${m.ruleId === "no-undef" ? /'([^']+)'/.exec(m.message)[1] : m.fatal ? `does not parse: ${m.message}` : m.ruleId}`);

test("no module of the shell uses a name it neither declares nor imports, or writes to a name it imports", async () => {
  const found = [];
  for (const [f, text] of Object.entries(texts())) found.push(...await undefinedIn(f, text.replace(`"${SLOT}"`, '"/assets/views.js"')));
  assert.deepEqual(found, KNOWN_UNDEFINED);
});

test("planted controls: a name never imported, a write to an imported name, a module that does not parse", async () => {
  assert.deepEqual(await undefinedIn("views/planted.js", "export const x = () => esc(location.hash);\n"), ["views/planted.js: esc"]);
  assert.deepEqual(await undefinedIn("views/planted.js", 'import { loadedFor } from "./router.js";\nexport const x = () => { loadedFor = null; };\n'), ["views/planted.js: no-import-assign"]);
  assert.deepEqual(await undefinedIn("views/planted.js", 'import { esc } from "./base.js";\nexport const x = () => esc(document.title);\n'), []);
  assert.equal((await undefinedIn("views/planted.js", "export const x = ;\n"))[0].startsWith("views/planted.js: does not parse"), true);
});
