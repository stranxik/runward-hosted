// The shell's files as the service serves them, on a real socket (the shell's page is served at / and at /app, the
// path it had while the public site held /, ADR-0022 then ADR-0028): every slot of the page is filled, every file the page names is served with its
// media type, the app's layer and fonts included (web/fonts/, by a closed list), and a path off the list is answered 404, the fonts the app used to take from the pinned
// fleet package included. The shell's scripts are modules (web/app.js and web/views/), served by a closed
// list under one folder named by the digest of them all. The content security policy is unchanged: fonts and styles from this origin only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { githubVerifier } from "../../src/adapters/oidc/github.js";
import { FONTS, MODULES, modulesFolder, buildAssets } from "../../src/http/assets.js";
import { fleetPin } from "../../src/adapters/fleet/assembler.js";
import { fakeAuthn, testJwk, sha, SEND_SHA } from "../helpers.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
let c, base;
before(async () => {
  const clock = manualClock(Date.now());
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_COMMIT: "c0ffee", RW_IMAGE: "sha256:abc", RW_SEND_WORKFLOW_SHAS: SEND_SHA });
  const jwksFetch = async () => new Response(JSON.stringify({ keys: [testJwk()] }));
  c = compose(config, { clock, log: silentLog, store: memoryStore({ clock }), objects: memoryObjects(), authn: fakeAuthn(), verifier: githubVerifier({ fetch: jwksFetch, clock }) });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${c.http.server.address().port}`;
});
after(() => new Promise((r) => c.http.server.close(r)));
const get = (path) => fetch(`${base}${path}`);

/** The slots of a page template left unfilled (`__NAME__`). */
export const unfilled = (html) => [...html.matchAll(/__[A-Z][A-Z_]*__/g)].map((m) => m[0]);

test("planted control: an unfilled slot of the page is seen", () => {
  assert.deepEqual(unfilled('<link rel="stylesheet" href="__COUCHE_CSS__"><link href="/assets/app.0123.css">'), ["__COUCHE_CSS__"]);
  assert.deepEqual(unfilled('<a class="vh skip" href="#main">x</a>'), []);
});

test("every slot of the page is filled, and every file it names is served with its media type", async () => {
  const html = await (await get("/app")).text();
  assert.deepEqual(unfilled(html), []);
  const named = [...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.equal(named.length, 7, "famille, the layer, the fleet stylesheet, app.css, parcours.css, views.js, app.js");
  for (const p of named) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("content-type"), p.endsWith(".css") ? /^text\/css; charset=utf-8$/ : /^text\/javascript; charset=utf-8$/, p);
  }
  const order = named.filter((p) => p.endsWith(".css")).map((p) => p.replace(/^\/assets\/([a-z-]+).*$/, "$1"));
  assert.deepEqual(order.slice(0, 2), ["famille", "couche-runward-app"], "the family's structure, then the app's layer");
});

test("the app's layer is served byte for byte, and the old tokens file is gone", async () => {
  const html = await (await get("/app")).text();
  const p = /href="(\/assets\/couche-runward-app\.[0-9a-f]{16}\.css)"/.exec(html)[1];
  const r = await get(p);
  assert.match(r.headers.get("cache-control"), /immutable/);
  assert.equal(sha(Buffer.from(await r.arrayBuffer())), sha(readFileSync(`${WEB}couche-runward-app.css`)));
  assert.equal(/\/assets\/tokens\./.test(html), false);
});

test("the fonts of the closed list are served from web/fonts with their media type, byte for byte", async () => {
  assert.deepEqual(FONTS.map(([f]) => f), ["Geist-Regular.woff2", "Geist-Medium.woff2", "Geist-SemiBold.woff2", "GeistMono-Regular.woff2", "GeistMono-Medium.woff2", "OFL.txt"]);
  for (const [f, type] of FONTS) {
    const r = await get(`/assets/fonts/${f}`);
    assert.equal(r.status, 200, f);
    assert.equal(r.headers.get("content-type"), type, f);
    assert.equal(sha(Buffer.from(await r.arrayBuffer())), sha(readFileSync(`${WEB}fonts/${f}`)), f);
  }
});

test("a path off the list is answered 404: another file name, the fonts of the fleet package, the source folders", async () => {
  for (const p of ["/assets/fonts/Geist-Bold.woff2", "/assets/fonts/inter-latin-400-normal.woff2", "/assets/fonts/DepartureMono-Regular.woff2",
    "/assets/fonts/OFL-Inter.txt", "/assets/fonts/", "/assets/fonts/..%2Fapp.css", "/assets/fonts/%2e%2e/%2e%2e/package.json", "/web/fonts/Geist-Regular.woff2",
    "/web/couche-runward-app.css", "/assets/couche-runward-app.css", "/assets/tokens.css", "/fonts/Geist-Regular.woff2"]) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.match(r.headers.get("content-type"), /^text\/html/, p);
  }
});

test("the content security policy is unchanged: fonts and stylesheets from this origin only, nothing inline", async () => {
  const csp = (await get("/app")).headers.get("content-security-policy");
  assert.match(csp, /(^|; )font-src 'self'(;|$)/);
  assert.match(csp, /(^|; )style-src-elem 'self'(;|$)/);
  assert.equal(/data:|unsafe-inline/.test(/font-src[^;]*/.exec(csp)[0] + /style-src-elem[^;]*/.exec(csp)[0]), false);
});

test("the shell's modules are served by a closed list under one folder named by their digest, immutable, the slot of the pinned views filled", async () => {
  const html = await (await get("/app")).text();
  const entry = /<script type="module" src="(\/assets\/app\.[0-9a-f]{16}\/)app\.js"><\/script>/.exec(html);
  assert.ok(entry, "the page loads the entry from the modules' folder");
  const views = /<link rel="modulepreload" href="(\/assets\/views-[^"]+\.js)">/.exec(html)[1];
  assert.ok(MODULES.length >= 25 && MODULES[0] === "app.js");
  for (const f of MODULES) {
    const r = await get(`${entry[1]}${f}`);
    assert.equal(r.status, 200, f);
    assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8", f);
    assert.match(r.headers.get("cache-control"), /immutable/, f);
    const text = await r.text();
    assert.equal(text, readFileSync(`${WEB}${f}`, "utf8").replace('"__VIEWS__"', JSON.stringify(views)), f);
    assert.equal(/__VIEWS__/.test(text), false, f);
  }
  const bridge = await (await get(`${entry[1]}views/fleet-views.js`)).text();
  assert.ok(bridge.includes(`from ${JSON.stringify(views)};`), "the one module that names the pinned views imports the file the page preloads");
});

test("a module off the list is answered 404: another name, the folder itself, another digest, the source folder", async () => {
  const html = await (await get("/app")).text();
  const folder = /src="(\/assets\/app\.[0-9a-f]{16}\/)app\.js"/.exec(html)[1];
  for (const p of [`${folder}views/planted.js`, `${folder}views/`, folder, `${folder}views/acces/`, `${folder}index.html`, `${folder}app.css`, `${folder}views/base.js.map`,
    "/assets/app.0000000000000000/app.js", "/assets/app.js", "/assets/views/base.js", "/web/app.js", "/web/views/base.js", "/views/base.js", `${folder}views%2Fbase.js`]) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.match(r.headers.get("content-type"), /^text\/html/, p);
  }
});

test("the modules' folder is named by every name and every byte: one byte or one name changed renames it (planted controls)", () => {
  const a = [["app.js", Buffer.from("import \"./views/base.js\";\n")], ["views/base.js", Buffer.from("export const x = 1;\n")]];
  const name = modulesFolder(a);
  assert.match(name, /^\/assets\/app\.[0-9a-f]{16}\/$/);
  assert.equal(modulesFolder(a.map(([f, b]) => [f, Buffer.from(b)])), name, "the same files give the same folder");
  assert.notEqual(modulesFolder([a[0], ["views/base.js", Buffer.from("export const x = 2;\n")]]), name, "one byte");
  assert.notEqual(modulesFolder([a[0], ["views/other.js", a[1][1]]]), name, "one name");
  assert.notEqual(modulesFolder([["app.js", Buffer.from("import \"./views/base.js\";\nviews/base.js")], ["", Buffer.from("export const x = 1;\n")]]), name, "bytes moved across the boundary of two files");
});

// ADR-0024: the archive pinned at main@d052814 (and at main@c9a886a, ADR-0033) ships two modules the app does not show yet (ui/mission.js, the
// path, the portfolio by step and the series; ui/documents.js, the documents). Their screens are a later lot:
// until then nothing of them is served, and the two files the app does take from the package ask for nothing more.
/** What a served file of the pinned package would make a browser fetch: an import, a url(), an @import. */
export const reaches = (text) => [...text.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)|@import\s+["']([^"']+)/gm)].map((m) => m.slice(1).find(Boolean));
test("the modules the pinned archive ships beside its views are not served, and what the app serves from the package reaches nothing", async () => {
  const pkg = new URL("../../node_modules/runward-fleet/", import.meta.url);
  const lock = JSON.parse(readFileSync(new URL("../../vendor/runward-fleet.lock.json", import.meta.url), "utf8"));
  const shipped = Object.keys(lock.files).filter((f) => f.startsWith("ui/") && f.endsWith(".js"));
  assert.deepEqual(shipped, ["ui/documents.js", "ui/mission.js", "ui/views.js"], "the scripts of the archive's ui/, from the lock");
  const html = await (await get("/app")).text();
  const viewsPath = /href="(\/assets\/views-[^"]+\.js)"/.exec(html)[1];
  const fleetPath = /href="(\/assets\/fleet-[^"]+\.css)"/.exec(html)[1];
  const views = await (await get(viewsPath)).text();
  assert.equal(sha(Buffer.from(views)), lock.files["ui/views.js"], "the views served are the pinned ones");
  assert.deepEqual(reaches(views), [], "views.js imports no module: the browser asks for no other file of the package");
  const css = await (await get(fleetPath)).text();
  assert.deepEqual(reaches(css).filter((u) => !/^(data:|%23)/.test(u)), [], "the fleet stylesheet names no file: its only url() is the inline grain, a data: image the policy already allows");
  // every file the service serves (buildAssets, as src/main.js composes it), by its digest: none is one of the two modules
  const built = buildAssets({ pin: fleetPin({ lockFile: new URL("../../vendor/runward-fleet.lock.json", import.meta.url).pathname }), commit: "c0ffee" });
  assert.ok(built.files.has(viewsPath) && built.files.has(fleetPath), "the same files the socket serves");
  const served = new Set([...built.files.values()].map((f) => sha(f.bytes)));
  for (const f of ["ui/mission.js", "ui/documents.js"]) {
    assert.equal(served.has(lock.files[f]), false, `${f} is not served`);
    assert.equal(sha(readFileSync(new URL(f, pkg))), lock.files[f], `${f} is in the install, as the lock pins it`);
    for (const p of [`/assets/${f.slice(3)}`, `/assets/${f}`, viewsPath.replace(/views-[^/]+$/, f.slice(3)), `/assets/app.0000000000000000/${f.slice(3)}`]) assert.equal((await get(p)).status, 404, p);
  }
  assert.ok(served.has(lock.files["ui/views.js"]), "the control: the views are among the files served");
  // planted controls: an import, a dynamic import, a url() and an @import are each seen
  assert.deepEqual(reaches('import { decide } from "./views.js";\nexport * from "./mission.js";\nimport "./x.js";\nconst m = await import("./documents.js");'), ["./views.js", "./mission.js", "./x.js", "./documents.js"]);
  assert.deepEqual(reaches('@import "a.css";\n.x{ background:url(b.png); src:url("c.woff2"); }'), ["a.css", "b.png", "c.woff2"]);
  assert.deepEqual(reaches(readFileSync(new URL("ui/mission.js", pkg), "utf8")), ["./views.js"], "the control on the real file: mission.js does import, so serving it alone would not be enough");
});
