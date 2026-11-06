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
  const go = await (await call("POST", "/api/v0/auth/fresh/options", { body: { gesture: "repository-confirm", object: repo.id }, headers: H, cookie })).json();
  await call("POST", "/api/v0/auth/fresh", { body: { challengeId: go.challengeId, response: { id: "http-1", challenge: go.options.challenge } }, headers: H, cookie });
  r = await call("POST", `/api/v0/repositories/${repo.id}/confirm`, { body: {}, headers: H, cookie });
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
  const html = await (await call("GET", "/")).text();
  const views = /href="(\/assets\/views-0\.46\.0\.[0-9a-f]{16}\.js)"/.exec(html)[1];
  const r = await call("GET", views);
  assert.match(r.headers.get("cache-control"), /immutable/);
  const { readFileSync } = await import("node:fs");
  assert.equal(sha(Buffer.from(await r.arrayBuffer())), sha(readFileSync(new URL("../../node_modules/runward-fleet/ui/views.js", import.meta.url))));
  const app = /src="(\/assets\/app\.[0-9a-f]{16}\.js)"/.exec(html)[1];
  const js = await (await call("GET", app)).text();
  assert.ok(js.includes(`from "${views}"`), "the shell imports the pinned views by their digest name");
});
