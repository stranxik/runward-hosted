// Limits on the public routes (review finding of 2026-11-08: none on /api/v0/auth/options). Per address
// and for the instance, a fixed window of one minute, on a real socket through the real routes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { githubVerifier } from "../../src/adapters/oidc/github.js";
import { rateLimiter } from "../../src/http/limits.js";
import { fakeAuthn, testJwk, SEND_SHA } from "../helpers.js";

const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))));

async function serve({ trustProxy = false, writes = { perAddress: 3, global: 5 }, reads = { perAddress: 4, global: 100 } } = {}) {
  const clock = manualClock(Date.parse("2026-11-08T12:00:10Z"));
  const config = { ...readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_SEND_WORKFLOW_SHAS: SEND_SHA }), trustProxy, publicLimits: { writes, reads } };
  const jwks = async () => new Response(JSON.stringify({ keys: [testJwk()] }));
  const c = compose(config, { clock, log: silentLog, store: memoryStore({ clock }), objects: memoryObjects(), authn: fakeAuthn(), verifier: githubVerifier({ fetch: jwks, clock }) });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  servers.push(c.http.server);
  const base = `http://127.0.0.1:${c.http.server.address().port}`;
  const post = (path, headers = {}) => fetch(`${base}${path}`, { method: "POST", headers: { origin: "https://app.runward.dev", "content-type": "application/json", ...headers }, body: "{}" });
  const get = (path, headers = {}) => fetch(`${base}${path}`, { headers });
  return { clock, post, get };
}

test("public routes: past the limit per address, 429 too-many-requests with Retry-After; the next minute opens again", async () => {
  const s = await serve();
  for (let i = 0; i < 3; i++) assert.equal((await s.post("/api/v0/auth/options")).status, 200);
  const r = await s.post("/api/v0/auth/options");
  assert.equal(r.status, 429);
  assert.equal((await r.json()).refusal, "too-many-requests");
  assert.equal(r.headers.get("retry-after"), "50");
  assert.equal((await s.post("/api/v0/links/inspect")).status, 429, "the limit is the address's, across the public write routes");
  for (let i = 0; i < 4; i++) assert.equal((await s.get("/api/version")).status, 200, "reads have their own counter");
  assert.equal((await s.get("/api/version")).status, 429);
  s.clock.advance(60_000);
  assert.equal((await s.post("/api/v0/auth/options")).status, 200);
});

test("public routes: the instance-wide limit holds whatever the addresses; behind the proxy, the address is the one it appended", async () => {
  const s = await serve({ trustProxy: true });
  for (let i = 0; i < 5; i++) assert.equal((await s.post("/api/v0/auth/options", { "x-forwarded-for": `198.51.100.${i}` })).status, 200);
  const r = await s.post("/api/v0/auth/options", { "x-forwarded-for": "198.51.100.77" });
  assert.equal(r.status, 429, "global limit");
  s.clock.advance(60_000);
  // the client's own claim (first entries) does not choose its counter: the last entry does
  for (let i = 0; i < 3; i++) assert.equal((await s.post("/api/v0/auth/options", { "x-forwarded-for": `203.0.113.${i}, 192.0.2.9` })).status, 200);
  assert.equal((await s.post("/api/v0/auth/options", { "x-forwarded-for": "203.0.113.200, 192.0.2.9" })).status, 429);
});

test("public routes: without the proxy setting, X-Forwarded-For is ignored (a client cannot pick a fresh counter)", async () => {
  const s = await serve({ writes: { perAddress: 2, global: 100 } });
  assert.equal((await s.post("/api/v0/auth/options", { "x-forwarded-for": "198.51.100.1" })).status, 200);
  assert.equal((await s.post("/api/v0/auth/options", { "x-forwarded-for": "198.51.100.2" })).status, 200);
  assert.equal((await s.post("/api/v0/auth/options", { "x-forwarded-for": "198.51.100.3" })).status, 429);
});

test("the limiter's table of addresses is bounded: new addresses past the bound share one counter", () => {
  const l = rateLimiter({ perAddress: 1, global: 1000, maxAddresses: 2, now: () => 0 });
  assert.equal(l.take("a").ok, true); assert.equal(l.take("b").ok, true);
  assert.equal(l.take("c").ok, true);
  assert.equal(l.take("d").ok, false, "c and d share the overflow counter");
  assert.equal(l.size(), 3);
});

test("RW_TRUST_PROXY: the number of proxies in front, read from the configuration, and which entry it counts", async () => {
  const { clientAddress } = await import("../../src/http/limits.js");
  const base = { RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_SEND_WORKFLOW_SHAS: SEND_SHA };
  assert.equal(readConfig(base).trustProxy, 0, "unset: no proxy trusted");
  assert.equal(readConfig({ ...base, RW_TRUST_PROXY: "1" }).trustProxy, 1);
  assert.throws(() => readConfig({ ...base, RW_TRUST_PROXY: "yes" }), (e) => e.problems.some((p) => /RW_TRUST_PROXY/.test(p)));
  const req = { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.5, 10.0.0.2" }, socket: { remoteAddress: "10.0.0.3" } };
  assert.equal(clientAddress(req, 0), "10.0.0.3");
  assert.equal(clientAddress(req, 1), "10.0.0.2");
  assert.equal(clientAddress(req, 2), "203.0.113.5", "two proxies: the entry the outer one appended");
  assert.equal(clientAddress({ headers: {}, socket: { remoteAddress: "10.0.0.3" } }, 1), "10.0.0.3", "no header: the peer");
});
