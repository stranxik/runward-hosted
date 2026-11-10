// The shell's files as the service serves them, on a real socket: every slot of the page is filled, every
// file the page names is served with its media type, the app's layer and fonts included (web/fonts/, by a
// closed list), and a path off the list is answered 404, the fonts the app used to take from the pinned
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
import { FONTS, MODULES, modulesFolder } from "../../src/http/assets.js";
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
  const html = await (await get("/")).text();
  assert.deepEqual(unfilled(html), []);
  const named = [...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.equal(named.length, 6, "famille, the layer, the fleet stylesheet, app.css, views.js, app.js");
  for (const p of named) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("content-type"), p.endsWith(".css") ? /^text\/css; charset=utf-8$/ : /^text\/javascript; charset=utf-8$/, p);
  }
  const order = named.filter((p) => p.endsWith(".css")).map((p) => p.replace(/^\/assets\/([a-z-]+).*$/, "$1"));
  assert.deepEqual(order.slice(0, 2), ["famille", "couche-runward-app"], "the family's structure, then the app's layer");
});

test("the app's layer is served byte for byte, and the old tokens file is gone", async () => {
  const html = await (await get("/")).text();
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
  const csp = (await get("/")).headers.get("content-security-policy");
  assert.match(csp, /(^|; )font-src 'self'(;|$)/);
  assert.match(csp, /(^|; )style-src-elem 'self'(;|$)/);
  assert.equal(/data:|unsafe-inline/.test(/font-src[^;]*/.exec(csp)[0] + /style-src-elem[^;]*/.exec(csp)[0]), false);
});

test("the shell's modules are served by a closed list under one folder named by their digest, immutable, the slot of the pinned views filled", async () => {
  const html = await (await get("/")).text();
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
  const html = await (await get("/")).text();
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
