// The public pages that left this origin (ADR-0028): the table of src/http/moved.js, then the server on a real socket.
// Every address this origin served as a public page answers 308 to the same page of runward.dev, its query string
// kept, with the app's own headers; ?lang=en names the English page; a path off the table is not moved; / is the app
// (the shell, whose signed-out root opens the sign-in). The shell's links to the public site follow the reader's
// language. Each guard has a planted control.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { githubVerifier } from "../../src/adapters/oidc/github.js";
import { MOVED_PAGES, MOVED_TABLE, PUBLIC_SITE, movedTo } from "../../src/http/moved.js";
import { SITE_PAGES } from "../../src/http/site.js";
import { fakeAuthn, testJwk, SEND_SHA } from "../helpers.js";

const ROOT = new URL("../../", import.meta.url).pathname;
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
const get = (path, init = {}) => fetch(`${base}${path}`, { redirect: "manual", ...init });

/** What is wrong with a redirect table, for the pages that were served: [] when every one of them is moved once, to the site. */
export function tableFaults(table, served) {
  const faults = [];
  const sources = table.map(([from]) => from);
  for (const p of served) if (p !== "/" && !sources.includes(p)) faults.push(`${p} was a public page and is not moved`);
  if (sources.includes("/")) faults.push("/ is the app: it is not moved");
  if (new Set(sources).size !== sources.length) faults.push("a source is written twice");
  for (const [from, to] of table) {
    if (!to.startsWith(`${PUBLIC_SITE}/`)) faults.push(`${from} leaves for another origin: ${to}`);
    if (/^\/(api|f|assets|app|lien|\.well-known)(\/|$)/.test(from)) faults.push(`${from} is an address of the app`);
  }
  return faults;
}

test("the table: the eight public pages and the landing's other name, each to the same page of runward.dev; the English addresses to /en; the root is not in it", () => {
  assert.equal(PUBLIC_SITE, "https://runward.dev");
  assert.deepEqual(MOVED_TABLE, [
    ["/index.html", "https://runward.dev/"],
    ["/pourquoi", "https://runward.dev/pourquoi"], ["/comment", "https://runward.dev/comment"], ["/pour-qui", "https://runward.dev/pour-qui"], ["/formats", "https://runward.dev/formats"],
    ["/donnees", "https://runward.dev/donnees"], ["/stand", "https://runward.dev/stand"], ["/releve", "https://runward.dev/releve"], ["/mentions", "https://runward.dev/mentions"],
    ["/en", "https://runward.dev/en"],
    ["/en/pourquoi", "https://runward.dev/en/pourquoi"], ["/en/comment", "https://runward.dev/en/comment"], ["/en/pour-qui", "https://runward.dev/en/pour-qui"], ["/en/formats", "https://runward.dev/en/formats"],
    ["/en/donnees", "https://runward.dev/en/donnees"], ["/en/stand", "https://runward.dev/en/stand"], ["/en/releve", "https://runward.dev/en/releve"], ["/en/mentions", "https://runward.dev/en/mentions"],
  ]);
  // every page the app served (the renderer's list, ADR-0022) is in the table, the root apart
  const served = SITE_PAGES.map(([p]) => p);
  assert.deepEqual(tableFaults(MOVED_TABLE, served), []);
  assert.deepEqual(MOVED_PAGES.map((n) => `/${n}`).sort(), served.filter((p) => p !== "/").sort());
  for (const [from, to] of MOVED_TABLE) assert.equal(movedTo(from), to, from);
  // planted controls: a page left out, the root moved, a source twice, another origin, an address of the app
  assert.deepEqual(tableFaults(MOVED_TABLE.filter(([f]) => f !== "/stand"), served), ["/stand was a public page and is not moved"]);
  assert.deepEqual(tableFaults([...MOVED_TABLE, ["/", "https://runward.dev/"]], served), ["/ is the app: it is not moved"]);
  assert.deepEqual(tableFaults([...MOVED_TABLE, ["/stand", "https://runward.dev/stand"]], served), ["a source is written twice"]);
  assert.deepEqual(tableFaults([...MOVED_TABLE, ["/x", "https://runward.dev.example/x"]], served), ["/x leaves for another origin: https://runward.dev.example/x"]);
  assert.deepEqual(tableFaults([...MOVED_TABLE, ["/api/health", "https://runward.dev/"]], served), ["/api/health is an address of the app"]);
});

test("movedTo: the query string is kept, ?lang=en names the English page, one trailing slash is the same page; a path off the table is not moved", () => {
  assert.equal(movedTo("/stand", "?utm_source=qr&x=1"), "https://runward.dev/stand?utm_source=qr&x=1");
  assert.equal(movedTo("/stand/", ""), "https://runward.dev/stand");
  assert.equal(movedTo("/en/stand/", "?a=b"), "https://runward.dev/en/stand?a=b");
  assert.equal(movedTo("/en/", ""), "https://runward.dev/en");
  assert.equal(movedTo("/donnees", "?lang=en"), "https://runward.dev/en/donnees?lang=en");
  assert.equal(movedTo("/index.html", "?lang=en&theme=dark"), "https://runward.dev/en?lang=en&theme=dark");
  assert.equal(movedTo("/donnees", "?lang=fr"), "https://runward.dev/donnees?lang=fr");
  assert.equal(movedTo("/en/donnees", "?lang=fr"), "https://runward.dev/en/donnees?lang=fr", "the path says the language first");
  for (const p of ["/", "", "/app", "/lien", "/api/health", "/api/v0/session", "/f/x/index.json", "/assets/app.css", "/.well-known/security.txt", "/stand.html", "/stand//", "/Stand", "/STAND", "/en/en/stand",
    "/fr/stand", "/stand/x", "/en/unknown", "/unknown", "/index", "/index.htm", "/en/index.html", "/pourquoi.html", "/constructor", "/__proto__", "/en/constructor", "/toString"]) {
    assert.equal(movedTo(p, ""), null, p);
    assert.equal(movedTo(p, "?lang=en"), null, `${p}?lang=en`);
  }
});

test("on a real socket: each address of the table answers 308 with its target and the app's headers, GET and HEAD; the answer is kept an hour, not for ever", async () => {
  const csp = (await get("/app")).headers.get("content-security-policy");
  assert.ok(csp.includes("script-src 'self'") && csp.includes("trusted-types runward"));
  for (const [from, to] of MOVED_TABLE) {
    const r = await get(from);
    assert.equal(r.status, 308, from);
    assert.equal(r.headers.get("location"), to, from);
    assert.equal(r.headers.get("cache-control"), "public, max-age=3600", from);
    assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8", from);
    assert.equal(r.headers.get("content-security-policy"), csp, `${from}: the policy is the app's, unchanged`);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", from);
    assert.equal(r.headers.get("referrer-policy"), "no-referrer", from);
    assert.equal(r.headers.get("set-cookie"), null, `${from}: a redirection sets no cookie`);
    assert.match(r.headers.get("runward-request-id"), /^r-[0-9a-f]{12}$/, from);
    assert.equal(await r.text(), `${to}\n`, `${from}: the body is the address, as text`);
    const h = await get(from, { method: "HEAD" });
    assert.equal(h.status, 308, from);
    assert.equal(h.headers.get("location"), to, from);
    assert.equal((await h.arrayBuffer()).byteLength, 0, `${from}: HEAD has no body`);
  }
});

test("on a real socket: the query string is kept as the URL parser wrote it, and nothing of a request reaches another origin or a second header", async () => {
  const to = async (p) => { const r = await get(p); return [r.status, r.headers.get("location")]; };
  assert.deepEqual(await to("/stand?utm_source=qr&utm_medium=print"), [308, "https://runward.dev/stand?utm_source=qr&utm_medium=print"]);
  assert.deepEqual(await to("/stand/"), [308, "https://runward.dev/stand"]);
  assert.deepEqual(await to("/pourquoi?lang=en"), [308, "https://runward.dev/en/pourquoi?lang=en"]);
  assert.deepEqual(await to("/index.html?lang=en"), [308, "https://runward.dev/en?lang=en"]);
  assert.deepEqual(await to("/stand?next=//evil.example/&u=https://evil.example"), [308, "https://runward.dev/stand?next=//evil.example/&u=https://evil.example"]);
  const crlf = await get("/stand?a=b%0d%0aset-cookie:%20x=1");
  assert.equal(crlf.status, 308);
  assert.equal(crlf.headers.get("location"), "https://runward.dev/stand?a=b%0d%0aset-cookie:%20x=1", "an encoded line end stays encoded");
  assert.equal(crlf.headers.get("set-cookie"), null);
  for (const r of [await get("/stand?x=1"), await get("/en/mentions")]) assert.ok(r.headers.get("location").startsWith("https://runward.dev/"));
});

test("on a real socket: / is the app, not moved; a path off the table is answered as before; a write to a moved address is not a redirection; a foreign host is refused first", async () => {
  for (const p of ["/", "/?lang=en", "/app", "/lien"]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get("location"), null, p);
    assert.equal(r.headers.get("cache-control"), "no-store", p);
    assert.match(await r.text(), /<script type="module" src="\/assets\/app\.[0-9a-f]{16}\/app\.js"><\/script>/, `${p} is the shell`);
  }
  assert.equal((await get("/", { method: "HEAD" })).status, 200);
  for (const p of ["/stand.html", "/en/unknown", "/stand/x", "/Stand", "/index", "/fr/stand"]) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.equal(r.headers.get("location"), null, p);
  }
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await get("/stand", { method, headers: { origin: "https://app.runward.dev" } });
    assert.equal(r.status, 404, method);
    assert.equal(r.headers.get("location"), null, method);
    assert.equal((await r.json()).refusal, "not-found", method);
  }
  assert.equal((await get("/api/health")).status, 200);
  const { request } = await import("node:http");
  const foreign = await new Promise((res, rej) => {
    const q = request(`${base}/stand`, { method: "GET", headers: { host: "evil.example" } }, (r) => { r.resume(); r.on("end", () => res({ status: r.statusCode, location: r.headers.location })); });
    q.on("error", rej); q.end();
  });
  assert.deepEqual(foreign, { status: 421, location: undefined });
});

test("the shell's side: its signed-out root opens the sign-in, never / (the shell itself); the public site's origin is written once for the server and once for the shell", () => {
  const read = (f) => readFileSync(`${ROOT}${f}`, "utf8");
  const router = read("web/views/router.js");
  assert.ok(router.includes('else if (route === "") location.replace("#/entree");'));
  assert.equal(/location\.(replace|assign)\("\/"\)|location\.href\s*=\s*"\/"/.test(router), false);
  assert.ok(read("web/app.js").includes('if (location.pathname === "/app") history.replaceState(null, "", `/${location.hash || "#/"}`);'), "/app still writes the address back");
  // the origin: one place in src/, one in the shell (the lexicon); the two legal sentences hold their link by language
  const holders = (dir, files) => files.filter((f) => /["'`]https:\/\/runward\.dev["'`/]/.test(read(`${dir}${f}`).replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")));
  assert.deepEqual(holders("src/http/", ["server.js", "assets.js", "moved.js", "site.js"]), ["moved.js"]);
  assert.deepEqual(holders("web/views/", ["shell.js", "legal.js", "entree.js", "router.js", "lexique.js"]), ["lexique.js"]);
});
