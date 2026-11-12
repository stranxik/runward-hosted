// The HTTP entry: host list (421), same origin on every browser write, the session cookie, the headers of
// every response, /api/version, security.txt, and a path through the real routes on a real socket.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { githubVerifier } from "../../src/adapters/oidc/github.js";
import { fakeAuthn, testJwk, sha, token, claimsFor, digestHeader, FIXTURE_CHECK, SEND_SHA } from "../helpers.js";

let c, base, clock;
before(async () => {
  clock = manualClock(Date.now());
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_COMMIT: "c0ffee", RW_IMAGE: "sha256:abc", RW_SEND_WORKFLOW_SHAS: SEND_SHA });
  const jwksFetch = async () => new Response(JSON.stringify({ keys: [testJwk()] }));
  c = compose(config, { clock, log: silentLog, store: memoryStore({ clock }), objects: memoryObjects(), authn: fakeAuthn(), verifier: githubVerifier({ fetch: jwksFetch, clock }) });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${c.http.server.address().port}`;
});
after(() => new Promise((r) => c.http.server.close(r)));

const H = { origin: "https://app.runward.dev", "content-type": "application/json" };
const call = (method, path, { body, headers = {}, cookie } = {}) => fetch(`${base}${path}`, { method, headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body) });

test("a host outside the list gets 421 before anything", async () => {
  const { request } = await import("node:http");
  const { status, body } = await new Promise((res, rej) => {
    const q = request(`${base}/api/version`, { method: "GET", headers: { host: "evil.example" } }, (r) => { let b = ""; r.on("data", (d) => { b += d; }); r.on("end", () => res({ status: r.statusCode, body: b })); });
    q.on("error", rej); q.end();
  });
  assert.equal(status, 421);
  assert.equal(JSON.parse(body).refusal, "host-not-allowed");
});

test("every response carries the request id, the version and the security headers", async () => {
  const r = await call("GET", "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("runward-request-id"), /^r-[0-9a-f]{12}$/);
  assert.equal(r.headers.get("runward-version"), "c0ffee");
  const csp = r.headers.get("content-security-policy");
  for (const d of ["default-src 'none'", "script-src 'self'", "frame-ancestors 'none'", "require-trusted-types-for 'script'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "no unsafe-inline for scripts (T20)");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("cache-control"), "no-store");
  const html = await r.text();
  assert.ok(!/<script>(?!<\/script>)/.test(html) && !/<style>/.test(html), "no inline script or style element in the page");
});

test("/api/version names the commit, the image, the views, the contract and the send workflow", async () => {
  const v = await (await call("GET", "/api/version")).json();
  assert.equal(v.commit, "c0ffee");
  assert.equal(v.image, "sha256:abc");
  assert.equal(v.views.runwardFleet, "0.46.0");
  assert.match(v.views.viewsSha256, /^[0-9a-f]{64}$/);
  assert.match(v.apiContract, /^[0-9a-f]{64}$/);
  assert.equal(v.indexFormat, "runward-fleet-index/0");
  assert.deepEqual(v.sendWorkflow, [SEND_SHA]);
});

test("the session cookie is Secure whatever the origin: __Host- requires it (guard on a defect the local witness found)", async () => {
  const { createHttp } = await import("../../src/http/server.js");
  const src = (await import("node:fs")).readFileSync(new URL("../../src/http/server.js", import.meta.url), "utf8");
  assert.match(src, /Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=\$\{7 \* 86400\}/);
  assert.equal(/secure \? "Secure; "/.test(src), false);
  assert.ok(createHttp);
});

test("security.txt and health", async () => {
  const t = await (await call("GET", "/.well-known/security.txt")).text();
  assert.match(t, /^Contact: /m); assert.match(t, /^Expires: /m);
  const hl = await (await call("GET", "/api/health")).json();
  assert.equal(hl.ok, true); assert.equal(hl.store, "memory");
});

test("a write without this origin is refused before its body is read; a GET never writes", async () => {
  let r = await call("POST", "/api/v0/auth/options", { body: {}, headers: { "content-type": "application/json", origin: "https://evil.example" } });
  assert.equal(r.status, 403); assert.equal((await r.json()).refusal, "same-origin");
  r = await call("POST", "/api/v0/auth/options", { body: {}, headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" } });
  assert.equal(r.status, 403);
  r = await call("POST", "/api/v0/auth/options", { body: {}, headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" } });
  assert.equal(r.status, 200);
  r = await call("GET", "/api/v0/auth/options");
  assert.equal(r.status, 405);
  r = await call("GET", "/api/v0/session");
  assert.equal(r.status, 401); assert.equal((await r.json()).refusal, "signed-out");
});

test("the whole path over HTTP: bootstrap link, passkey, cookie, declare, upload, fleet, journal", async () => {
  const t = randomBytes(32).toString("base64url");
  const { tenant } = await c.app.operator.openBootstrap({ hash: sha(Buffer.from(t)) });
  let r = await call("POST", "/api/v0/links/inspect", { body: { token: t }, headers: H });
  assert.equal((await r.json()).state, "link-live");
  const o = await (await call("POST", "/api/v0/links/options", { body: { token: t }, headers: H })).json();
  r = await call("POST", "/api/v0/links/redeem", { body: { token: t, challengeId: o.challengeId, response: { id: "http-1", challenge: o.options.challenge } }, headers: H });
  assert.equal(r.status, 200);
  const sc = r.headers.get("set-cookie");
  assert.match(sc, /^__Host-rw_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax/);
  assert.ok(!/Domain=/i.test(sc), "no Domain (T25)");
  const cookie = sc.split(";")[0];
  const s = await (await call("GET", "/api/v0/session", { cookie })).json();
  assert.equal(s.tenant.id, tenant); assert.equal(s.passkeys, 1); assert.equal(s.arrivalOpen, false);
  assert.deepEqual(s.sendWorkflow, [SEND_SHA]);
  // declare with consent: per gesture
  const fo = await (await call("POST", "/api/v0/auth/fresh/options", { body: { gesture: "declare-with-consent", object: "stranxik/dropyour" }, headers: H, cookie })).json();
  await call("POST", "/api/v0/auth/fresh", { body: { challengeId: fo.challengeId, response: { id: "http-1", challenge: fo.options.challenge } }, headers: H, cookie });
  r = await call("POST", "/api/v0/repositories", { body: { name: "stranxik/dropyour", consent: true, missions: [{ id: "dropyour" }] }, headers: H, cookie });
  assert.equal(r.status, 201);
  const repo = await r.json();
  // the upload as the send workflow makes it
  const claims = claimsFor(clock);
  r = await call("POST", "/api/v0/exports", { body: FIXTURE_CHECK, headers: { authorization: `Bearer ${token(claims)}`, "runward-mission": "dropyour", "runward-export-kind": "check", "content-digest": digestHeader(FIXTURE_CHECK), "content-type": "application/octet-stream" } });
  assert.equal(r.status, 202);
  const pend = await r.json();
  assert.equal(pend.refusal, "repository-pending"); assert.ok(pend.message && pend.action && pend.requestId);
  // the confirmation is bound to the repository and to the digest of the values the screen shows (ADR-0029 section 1)
  const shown = (await (await call("GET", "/api/v0/access", { cookie })).json()).repositories.find((x) => x.id === repo.id).pending;
  assert.deepEqual(shown.values, { forge: "github", repositoryId: claims.repository_id, ownerId: claims.repository_owner_id });
  const go = await (await call("POST", "/api/v0/auth/fresh/options", { body: { gesture: "repository-confirm", object: `${repo.id}:${shown.digest}` }, headers: H, cookie })).json();
  await call("POST", "/api/v0/auth/fresh", { body: { challengeId: go.challengeId, response: { id: "http-1", challenge: go.options.challenge } }, headers: H, cookie });
  r = await call("POST", `/api/v0/repositories/${repo.id}/confirm`, { body: { digest: shown.digest }, headers: H, cookie });
  assert.equal(r.status, 200);
  r = await call("GET", `/f/${tenant}/index.json`, { cookie });
  assert.equal(r.status, 200);
  const idx = await r.json();
  assert.equal(idx.missions[0].id, "dropyour");
  r = await call("GET", "/api/v0/fleet/status", { cookie });
  assert.equal((await r.json()).lines[0].accepted.runNumber, "12");
  r = await call("GET", "/api/v0/journal", { cookie });
  const j = await r.json();
  assert.ok(j.entries.length >= 4); assert.ok(j.head.hash);
  r = await call("GET", "/api/v0/journal?cursor=abc", { cookie });
  assert.equal((await r.json()).refusal, "cursor-invalid");
  // another tenant's index is a 404, never a read
  r = await call("GET", "/f/00000000-0000-4000-8000-000000000000/index.json", { cookie });
  assert.equal(r.status, 404);
  // sign out closes the session and clears the cookie
  r = await call("POST", "/api/v0/auth/logout", { body: {}, headers: H, cookie });
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await call("GET", "/api/v0/session", { cookie })).status, 401);
});

test("the served assets: immutable names, views.js byte for byte the pinned one", async () => {
  const html = await (await call("GET", "/app")).text();
  const views = /href="(\/assets\/views-0\.46\.0\.[0-9a-f]{16}\.js)"/.exec(html)[1];
  const r = await call("GET", views);
  assert.match(r.headers.get("cache-control"), /immutable/);
  const { readFileSync } = await import("node:fs");
  assert.equal(sha(Buffer.from(await r.arrayBuffer())), sha(readFileSync(new URL("../../node_modules/runward-fleet/ui/views.js", import.meta.url))));
  // the shell is modules under one folder named by their digest; one of them names the pinned views
  const folder = /src="(\/assets\/app\.[0-9a-f]{16}\/)app\.js"/.exec(html)[1];
  const app = await call("GET", `${folder}app.js`);
  assert.match(app.headers.get("cache-control"), /immutable/);
  const js = await (await call("GET", `${folder}views/fleet-views.js`)).text();
  assert.ok(js.includes(`from "${views}"`), "the shell imports the pinned views by their digest name");
});

test("the pin of ADR-0021: the decision reading is importable from the pinned package, and is the app's screen at #/ and #/decision", async () => {
  const views = await import("runward-fleet/views");
  const build = await import("runward-fleet");
  for (const name of ["decide", "renderDecision", "renderView", "renderNav", "ROUTES"]) assert.ok(name in views, `runward-fleet/views exports ${name}`);
  assert.equal(typeof views.decide, "function");
  assert.equal(typeof views.renderDecision, "function");
  assert.ok(build.VERDICT_STATES.includes("not-available"));
  assert.ok(Array.isArray(build.ENDORSEMENTS));
  assert.ok(views.ROUTES.includes("decision"), "the pinned views route the decision reading");
  const html = await (await call("GET", "/app")).text();
  // the shell is modules (lot L0): the router is web/views/router.js, the address reader is in web/views/base.js
  const folder = /src="(\/assets\/app\.[0-9a-f]{16}\/)app\.js"/.exec(html)[1];
  const { MODULES } = await import("../../src/http/assets.js");
  const served = {};
  for (const f of MODULES) served[f] = await (await call("GET", `${folder}${f}`)).text();
  const js = served["views/router.js"];
  assert.ok(js.includes('const FLEET_ROUTES = ROUTES.filter((r) => r !== "decision");'), "the views' own decision route is never taken: the app's screen is");
  for (const [f, text] of Object.entries(served)) assert.equal(/(?<!FLEET_)ROUTES\.includes\(|\.\.\.ROUTES\b/.test(text), false, `${f}: the router reads FLEET_ROUTES, never the views' own list`);
  assert.deepEqual(Object.keys(served).filter((f) => /\bROUTES\b/.test(served[f].replace(/FLEET_ROUTES/g, ""))).sort(), ["views/fleet-views.js", "views/router.js"], "no other module reads the views' own list");
  // the router itself, as served, run on the pinned ROUTES (the review of 3afe41d, C44: reading its source
  // let a router that also accepted the views' own list through). Its screens are stood for by their names.
  const parts = /^export (const parts = [^\n]*)$/m.exec(served["views/base.js"]);
  assert.ok(parts, "the address reader is where this test reads it");
  const from = js.indexOf("const FLEET_ROUTES = ");
  const to = js.indexOf("\nlet loadedFor");
  assert.ok(from > 0 && to > from, "the router is where this test reads it");
  const router = `${parts[1]}\n${js.slice(from, to)}`;
  assert.ok(router.includes("function resolve() {"));
  const screens = [...new Set(router.match(/\bview[A-Z]\w*/g))];
  assert.ok(screens.includes("viewFleet") && screens.includes("viewDecision"));
  const location = { hash: "" };
  const resolve = new Function("ROUTES", "location", ...screens, `${router}\nreturn resolve;`)(views.ROUTES, location, ...screens.map((name) => (...args) => [name, ...args]));
  const at = (hash) => { location.hash = hash; return resolve(); };
  // the technical views of runward-fleet: each a screen of the app; the dashboard moved to #/flotte
  for (const route of views.ROUTES.filter((r) => r !== "decision" && r !== "")) assert.deepEqual(at(`#/${route}`), ["viewFleet", route, ""], `the view ${route} is a screen of the app`);
  assert.equal(views.ROUTES.filter((r) => r !== "decision" && r !== "").length, views.ROUTES.length - 2);
  assert.deepEqual(at("#/vue"), ["viewFleet", "vue", ""], "the views' fleet view, in full");
  assert.deepEqual(at("#/flotte"), ["viewFleet", "flotte", ""], "the dashboard");
  // the decision reading: the screen a member lands on, and one application's reading at a stable address
  assert.deepEqual(at("#/"), ["viewDecision", ""]);
  assert.deepEqual(at(""), ["viewDecision", ""]);
  assert.deepEqual(at("#/decision"), ["viewDecision", ""]);
  assert.deepEqual(at("#/decision/dropyour"), ["viewDecision", "dropyour"], "the application's id is given to the screen, which decodes it");
  assert.deepEqual(at("#/decision/a%2Fb"), ["viewDecision", "a%2Fb"]);
  assert.equal(at("#/no-such-route"), null, "the control: an unknown route");
});

test("/api/version names the archive that is installed: the digest of the tarball npm installed, not a line of the lock alone", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const root = new URL("../../", import.meta.url);
  const lock = JSON.parse(readFileSync(new URL("vendor/runward-fleet.lock.json", root), "utf8"));
  // what npm installed, by its own record: the file it resolved, and the integrity it checked it against
  const installed = JSON.parse(readFileSync(new URL("node_modules/.package-lock.json", root), "utf8")).packages["node_modules/runward-fleet"];
  assert.match(installed.resolved, /^file:vendor\/runward-fleet-[0-9a-z.-]+\.tgz$/);
  const tgz = readFileSync(new URL(installed.resolved.slice("file:".length), root));
  assert.equal(`sha512-${createHash("sha512").update(tgz).digest("base64")}`, installed.integrity, "the tarball in vendor/ is the one npm installed");
  const v = await (await call("GET", "/api/version")).json();
  assert.equal(v.views.runwardFleetArchiveSha256, sha(tgz), "the digest served is the sha256 of that tarball (a digit of the lock changed is caught here, K6)");
  assert.equal(v.views.runwardFleet, JSON.parse(readFileSync(new URL("node_modules/runward-fleet/package.json", root), "utf8")).version);
  assert.equal(v.views.viewsSha256, sha(readFileSync(new URL("node_modules/runward-fleet/ui/views.js", root))));
  assert.equal(v.views.runwardFleetCommit, lock.commit);
  assert.equal(v.views.runwardFleetArchiveSha256, lock.tarballSha256);
});

test("the served views say « niveau non atteint » and \"level not met\" for level-not-met, from the pinned package (author's rule)", async () => {
  const html = await (await call("GET", "/app")).text();
  const views = /href="(\/assets\/views-0\.46\.0\.[0-9a-f]{16}\.js)"/.exec(html)[1];
  const js = await (await call("GET", views)).text();
  assert.ok(js.includes('"level-not-met": "niveau non atteint"'));
  assert.ok(js.includes('"level-not-met": "level not met"'));
  assert.equal(/non franchi|not crossed/.test(js), false);
});

// Review finding of 2026-11-10 (independent review): `GET //` threw "Invalid URL" before any limiter, was
// answered 503 and counted as a server error; with the unreadable token, anyone could raise the error-rate
// alert. A request target that is not a path of this origin is the caller's fault.
test("a request target that does not parse, or names its own authority, is answered 404 and is not a server error", async () => {
  const { request } = await import("node:http");
  const port = new URL(base).port;
  const raw = (path, method = "GET") => new Promise((resolve, reject) => {
    const q = request({ host: "127.0.0.1", port, path, method }, (res) => { let b = ""; res.on("data", (d) => { b += d; }); res.on("end", () => resolve({ status: res.statusCode, body: b })); });
    q.on("error", reject); q.end();
  });
  const errorsBefore = (await (await call("GET", "/api/health")).json()).errors.serverErrors;
  for (const [path, method] of [["//", "GET"], ["///", "GET"], ["/\\\\", "GET"], ["//", "POST"], ["//evil.example/api/health", "GET"], ["//evil.example/", "GET"]]) {
    const r = await raw(path, method);
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.equal(JSON.parse(r.body).refusal, "not-found", `${method} ${path}`);
  }
  assert.equal((await (await call("GET", "/api/health")).json()).errors.serverErrors, errorsBefore, "none of them counted as a server error");
  // controls: the paths of this origin answer as before
  assert.equal((await raw("/api/version")).status, 200);
  assert.equal((await raw("/api/version?x=//y")).status, 200);
});

// Finding of the restore drill, 2026-11-10: over HTTP, maintenance answered 503 to the writes of a session
// only; the sign-in and the link routes are public and went through.
test("under maintenance every write from a browser is answered 503 maintenance with Retry-After, the sign-in and link routes included; reads stay open", async () => {
  const post = (path, body = {}) => call("POST", path, { headers: H, body });
  assert.equal((await post("/api/v0/auth/options")).status, 200, "before");
  await c.app.operator.maintenance({ on: true, reason: "restore" });
  try {
    for (const path of ["/api/v0/auth/options", "/api/v0/auth/verify", "/api/v0/links/options", "/api/v0/links/redeem", "/api/v0/links/inspect"]) {
      const r = await post(path, { token: "x".repeat(43), challengeId: "0b9f6b0e-3c2a-4d7e-9f1a-2b3c4d5e6f70", response: {} });
      assert.deepEqual([r.status, (await r.json()).refusal, r.headers.get("retry-after")], [503, "maintenance", "600"], path);
    }
    assert.equal((await call("GET", "/api/version")).status, 200, "a read is served");
    assert.equal((await call("GET", "/")).status, 200, "the page is served");
  } finally { await c.app.operator.maintenance({ on: false }); }
  assert.equal((await post("/api/v0/auth/options")).status, 200, "after");
});
