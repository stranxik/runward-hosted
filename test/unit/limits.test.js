// Rate limits (review findings of 2026-11-08: none on /api/v0/auth/options; of 2026-11-10: none on the
// requests of the other routes that are not authenticated yet). Per address and for the instance, a fixed
// window of one minute, on a real socket through the real routes.
import { test, after } from "node:test";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { githubVerifier } from "../../src/adapters/oidc/github.js";
import { rateLimiter, failureLimiter, recentlyValid, addressKey, prefixKey, RATE_LIMITS, OVERFLOW_HISTORY_MINUTES } from "../../src/http/limits.js";
import { probeVerdict } from "../../scripts/probe-verdict.mjs";
import { fakeAuthn, testJwk, SEND_SHA, founder, token, claimsFor } from "../helpers.js";

const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))));

async function serve({ trustProxy = false, writes = { perAddress: 3, global: 5 }, reads = { perAddress: 4, global: 100 }, machine, signedOut, log = silentLog } = {}) {
  const clock = manualClock(Date.parse("2026-11-08T12:00:10Z"));
  const rateLimits = { writes, reads, ...(machine ? { machine } : {}), ...(signedOut ? { signedOut } : {}) };
  const config = { ...readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_SEND_WORKFLOW_SHAS: SEND_SHA }), trustProxy, rateLimits };
  const jwks = async () => new Response(JSON.stringify({ keys: [testJwk()] }));
  // the costly work, counted: each RSA check of a token, each transaction of the store
  const work = { verify: 0, tx: 0 };
  const real = githubVerifier({ fetch: jwks, clock });
  const verifier = { verify: (...a) => { work.verify++; return real.verify(...a); } };
  const store = memoryStore({ clock });
  const tx = store.tx.bind(store);
  store.tx = (...a) => { work.tx++; return tx(...a); };
  const c = compose(config, { clock, log, store, objects: memoryObjects(), authn: fakeAuthn(), verifier });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  servers.push(c.http.server);
  const base = `http://127.0.0.1:${c.http.server.address().port}`;
  const post = (path, headers = {}) => fetch(`${base}${path}`, { method: "POST", headers: { origin: "https://app.runward.dev", "content-type": "application/json", ...headers }, body: "{}" });
  const get = (path, headers = {}) => fetch(`${base}${path}`, { headers });
  return { clock, post, get, work, c };
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

test("not yet authenticated: each upload and reader call is counted before its token's RSA check, past the budget 429 with no check", async () => {
  const s = await serve({ machine: { perAddress: 3, global: 100 } });
  const upload = () => s.post("/api/v0/exports", { authorization: "Bearer aaa.bbb.ccc", "runward-mission": "m", "runward-export-kind": "check" });
  for (let i = 0; i < 3; i++) assert.equal((await upload()).status, 401, "an unreadable token, refused by the verifier");
  assert.equal(s.work.verify, 3);
  const r = await upload();
  assert.equal(r.status, 429);
  assert.equal((await r.json()).refusal, "too-many-requests");
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
  assert.equal((await s.get("/api/v0/reader/index", { authorization: "Bearer aaa.bbb.ccc", "runward-fleet": "0b9f6b0e-3c2a-4d7e-9f1a-2b3c4d5e6f70" })).status, 429, "the witness reader's route shares the address's budget");
  assert.equal(s.work.verify, 3, "no RSA check past the budget");
  s.clock.advance(60_000);
  assert.equal((await upload()).status, 401, "the next minute opens again");
});

test("not yet authenticated: a session cookie that resolves to nothing is counted; past the budget it is refused before the database is read, a valid session never is", async () => {
  const s = await serve({ trustProxy: true, signedOut: { perAddress: 2, global: 100 } });
  const { token } = await founder({ app: s.c.app, store: s.c.store }, { passkeys: 1 });
  const as = (ip, cookie) => s.get("/api/v0/session", { "x-forwarded-for": ip, ...(cookie ? { cookie: `__Host-rw_session=${cookie}` } : {}) });
  for (let i = 0; i < 2; i++) assert.equal((await as("198.51.100.1", `forged-${i}`)).status, 401);
  const before = s.work.tx;
  const r = await as("198.51.100.1", "forged-3");
  assert.equal(r.status, 429);
  assert.equal((await r.json()).refusal, "too-many-requests");
  assert.equal(s.work.tx, before, "refused before the database is read");
  // the session routes called without a cookie count too
  for (let i = 0; i < 2; i++) assert.equal((await as("198.51.100.2", null)).status, 401);
  assert.equal((await as("198.51.100.2", null)).status, 429);
  // a valid session is authenticated: it is never counted, whatever the number of its calls
  for (let i = 0; i < 5; i++) assert.equal((await as("198.51.100.3", token)).status, 200, `signed-in call ${i + 1}`);
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

// Review finding of 2026-11-10 (code review C2, and the independent review): the instance-wide budgets
// refused valid callers too. 600 dead cookies a minute from 20 addresses spent the signedOut budget, and
// every cookie-bearing request was then answered 429 before its session was read, public routes included;
// 1,200 junk uploads refused every tenant's upload. The scenario of the finding, with the default budgets.
test("the instance's budgets refuse only what failed: after a flood of dead cookies and of junk uploads, a valid session and a signed upload are still served", async () => {
  const s = await serve({ trustProxy: true, ...RATE_LIMITS });
  const h = { app: s.c.app, store: s.c.store };
  const seen = await founder(h, { passkeys: 1, prefix: "seen" });
  const unseen = await founder(h, { passkeys: 1, prefix: "unseen" });
  const as = (ip, cookie, path = "/api/v0/session") => s.get(path, { "x-forwarded-for": ip, ...(cookie ? { cookie: `__Host-rw_session=${cookie}` } : {}) });
  assert.equal((await as("198.51.100.1", seen.token)).status, 200, "a valid session, before");

  // ---- 600 dead cookies from 20 addresses: the instance's budget of failures is spent
  // (the twenty addresses at once, each sending its requests one after the other)
  const twenty = (each) => Promise.all(Array.from({ length: 20 }, (_, k) => each(k + 1))).then((x) => x.flat());
  const flood = await twenty(async (a) => { const out = []; for (let i = 0; i < RATE_LIMITS.signedOut.perAddress; i++) out.push((await as(`198.51.100.${a}`, `dead-${a}-${i}`)).status); return out; });
  assert.deepEqual([...new Set(flood)], [401]);
  assert.equal(flood.length, RATE_LIMITS.signedOut.global);
  const before = s.work.tx;
  assert.equal((await as("198.51.100.2", "dead-again")).status, 429, "an address that failed is refused");
  assert.equal(s.work.tx, before, "and nothing is read for it");
  // a valid session is served: one not seen before, from an address that did not fail; one seen a moment
  // ago, even from an address of the flood; and on a public route
  assert.equal((await as("203.0.113.7", unseen.token)).status, 200, "a valid session from another address");
  assert.equal((await as("198.51.100.1", seen.token)).status, 200, "a valid session seen a moment ago, from an address of the flood");
  assert.equal((await as("198.51.100.1", seen.token, "/api/version")).status, 200, "the same cookie on a public route");
  // what the flood can still cost: one failure for each new address, then nothing
  assert.equal((await as("203.0.113.8", "dead-new")).status, 401);
  const then = s.work.tx;
  assert.equal((await as("203.0.113.8", "dead-new-2")).status, 429);
  assert.equal(s.work.tx, then);

  // ---- 1,200 junk uploads from 20 addresses
  const upload = (ip, bearer) => s.post("/api/v0/exports", { "x-forwarded-for": ip, authorization: `Bearer ${bearer}`, "runward-mission": "m", "runward-export-kind": "check" });
  const junk = await twenty(async (a) => { const out = []; for (let i = 0; i < RATE_LIMITS.machine.perAddress; i++) out.push((await upload(`192.0.2.${a}`, "aaa.bbb.ccc")).status); return out; });
  assert.deepEqual([...new Set(junk)], [401]);
  assert.equal(junk.length, RATE_LIMITS.machine.global);
  assert.equal((await upload("192.0.2.1", "aaa.bbb.ccc")).status, 429);
  // an upload signed by the issuer, from another address, has its token checked and reaches the application
  // (which answers for what it carries: here, a body that does not match its digest header)
  const signed = await upload("203.0.113.20", token(claimsFor(s.clock)));
  assert.deepEqual([signed.status, (await signed.json()).refusal], [400, "digest-mismatch"], "a signed upload is not refused for the others' junk");
  const verified = s.work.verify;
  assert.equal((await upload("203.0.113.21", "aaa.bbb.ccc")).status, 401, "a new address has one failure");
  assert.equal((await upload("203.0.113.21", "aaa.bbb.ccc")).status, 429, "then it is refused");
  assert.equal(s.work.verify, verified + 1, "with no RSA check past it");
});

test("the budget of failures: an address is refused past its own failures; once the instance's is spent, only the addresses that failed; the table is bounded", () => {
  let t = 0;
  const l = failureLimiter({ perAddress: 2, global: 3, maxAddresses: 4, now: () => t });
  const failOnce = (a) => { const e = l.enter(a); if (e.ok) e.settle(true); return e.ok; };
  assert.deepEqual([failOnce("a"), failOnce("a"), failOnce("a")], [true, true, false], "its own budget");
  for (let i = 0; i < 50; i++) { const e = l.enter("good"); assert.equal(e.ok, true); e.settle(false); }
  assert.equal(failOnce("b"), true, "the third failure of the instance");
  assert.deepEqual([l.enter("b").scope, l.enter("good").ok, l.enter("new").ok], ["global", true, true], "spent: b failed and is refused, the others are served");
  assert.equal(failOnce("new"), true); assert.equal(l.enter("new").ok, false);
  // past the bound, a new address is served and not tracked: nothing is held against it, whatever the
  // others past the bound did (code review C11; they shared one entry, and its first failure refused them all)
  assert.equal(failOnce("x1"), true);
  assert.deepEqual([l.enter("x2").ok, l.enter("x1").ok, l.enter("x2").tracked, l.enter("a").tracked], [true, true, false, undefined]);
  assert.equal(l.size(), 4, "the table holds its bound and no more");
  t = 60_000;
  assert.equal(failOnce("a"), true, "the next minute opens again");
  const every = failureLimiter({ perAddress: 2, global: 100, everyCall: true, now: () => 0 });
  every.enter("m").settle(false); every.enter("m").settle(false);
  assert.equal(every.enter("m").ok, false, "everyCall: each call is counted for its address, failed or not");
});

test("a cookie that resolved a moment ago is exempt from the budget, never from the read of its session; the table is bounded and forgets", () => {
  let t = 0;
  const v = recentlyValid({ ttlMs: 1000, max: 2, now: () => t });
  v.add("a"); assert.equal(v.has("a"), true);
  t = 1000; assert.equal(v.has("a"), false, "past its time");
  v.add("a"); v.add("b"); v.add("c");
  assert.deepEqual([v.has("a"), v.has("b"), v.has("c"), v.size()], [false, true, true, 2], "the oldest goes");
  v.drop("b"); assert.equal(v.has("b"), false);
});

test("a session closed a moment ago is refused at once, though its cookie was seen valid, and it is counted as a failure", async () => {
  const s = await serve({ trustProxy: true, signedOut: { perAddress: 1, global: 100 } });
  const f = await founder({ app: s.c.app, store: s.c.store }, { passkeys: 1 });
  const as = (cookie) => s.get("/api/v0/session", { "x-forwarded-for": "198.51.100.9", cookie: `__Host-rw_session=${cookie}` });
  assert.equal((await as(f.token)).status, 200);
  await s.c.app.identity.signOut(await s.c.app.identity.sessionFrom(f.token), {});
  assert.equal((await as(f.token)).status, 401, "the session is read on every request");
  assert.equal((await as(f.token)).status, 429, "and the dead cookie is counted like any other");
});

// Review finding of 2026-11-10 (code review C7): the signedOut budget was looked at, the session awaited,
// and the failure counted after, so dead cookies sent at once all passed before any was counted (66 reads
// of the database for a budget of 30). Each lookup now holds a place in its address's budget while it runs.
test("a burst of dead cookies sent at once from one address reads the database no more than its budget allows", async () => {
  const s = await serve({ trustProxy: true, signedOut: { perAddress: 30, global: 600 } });
  const f = await founder({ app: s.c.app, store: s.c.store }, { passkeys: 1 });
  // a store that takes 20 ms to answer, as a database does
  const tx = s.c.store.tx;
  s.c.store.tx = async (...a) => { await new Promise((r) => setTimeout(r, 20)); return tx(...a); };
  const as = (ip, cookie) => s.get("/api/v0/session", { "x-forwarded-for": ip, cookie: `__Host-rw_session=${cookie}` });
  const before = s.work.tx;
  const statuses = await Promise.all(Array.from({ length: 200 }, (_, i) => as("198.51.100.1", `dead-${i}`).then((r) => r.status)));
  const count = (x) => statuses.filter((v) => v === x).length;
  assert.deepEqual({ 401: count(401), 429: count(429) }, { 401: 30, 429: 170 });
  assert.equal(s.work.tx - before, 30, "one read of the database for each of the 30, none for the others");
  // control: a place held by a lookup is given back when the session is valid, so a signed-in burst is not refused
  const valid = await Promise.all(Array.from({ length: 60 }, () => as("198.51.100.2", f.token).then((r) => r.status)));
  assert.equal(valid.filter((v) => v === 200).length >= 30, true, "the first lookups of a valid cookie all resolve");
  const again = await Promise.all(Array.from({ length: 60 }, () => as("198.51.100.2", f.token).then((r) => r.status)));
  assert.deepEqual([...new Set(again)], [200], "and once it has resolved, the cookie is not asked at all");
});

// Code review of 2026-11-10, C11: the C2 lockout remained through the bounded table of addresses. Past
// 10,000 addresses in a window, every address not yet in the table shared the `(overflow)` counter, spent
// after 30 failures: 10,030 dead cookies a minute, one per address, and a valid session from any address
// not seen in this window was refused 429; 10,060 junk uploads, and so was every upload (send.yml gives up
// after four attempts). The scenario of the finding, with the default budgets and the default bound.
test("C11: past the table's bound, an address not seen in this window is served, never refused for the others' failures (10,030 dead cookies, 10,060 junk uploads, one per address)", () => {
  const ip = (n) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
  const flood = (l, n) => { for (let i = 0; i < n; i++) { const e = l.enter(ip(i)); assert.equal(e.ok, true, `call ${i} of the flood`); e.settle(true); } };

  const signedOut = failureLimiter({ ...RATE_LIMITS.signedOut, now: () => 0 });
  flood(signedOut, 10_030);
  assert.equal(signedOut.size(), 10_000, "the table is full, and holds no more than its bound");
  // a valid session from an address not seen in this window: its session is read
  for (let i = 0; i < 100; i++) {
    const valid = signedOut.enter(`203.0.113.${i}`);
    assert.deepEqual([valid.ok, valid.tracked], [true, false], `a new address past the bound, ${i}`);
    valid.settle(false);
  }
  // the control: the budgets still refuse what failed. An address of the table has failed and the
  // instance's budget is spent; an address past the bound is not counted, so the table cannot grow
  assert.deepEqual(signedOut.enter(ip(7)), { ok: false, scope: "global", retryAfter: 60 });
  // the 30 addresses of the flood and the 100 valid ones that found the table full were counted with their
  // /24 (C14), none was served untracked
  assert.deepEqual([signedOut.aggregated(), signedOut.untracked()], [130, 0]);
  assert.equal(signedOut.size(), 10_000);

  const machine = failureLimiter({ ...RATE_LIMITS.machine, everyCall: true, now: () => 0 });
  flood(machine, 10_060);
  const upload = machine.enter("203.0.113.20");
  assert.deepEqual([upload.ok, upload.tracked], [true, false], "an upload from a new address has its token read");
  upload.settle(false);
  assert.deepEqual(machine.enter(ip(7)), { ok: false, scope: "global", retryAfter: 60 }, "the control: an address of the table that failed is refused");
  assert.equal(machine.size(), 10_000);
});

// The same through the real routes, on real sockets, with a table of 50 addresses (the budgets are the
// defaults): the flood fills the table, then spends what was the shared counter.
test("C11, through the routes: after dead cookies and junk uploads from more addresses than the table holds, a valid session and a signed upload from a new address are served", async () => {
  const bound = 50;
  const s = await serve({ trustProxy: true, ...RATE_LIMITS, signedOut: { ...RATE_LIMITS.signedOut, maxAddresses: bound }, machine: { ...RATE_LIMITS.machine, maxAddresses: bound } });
  const h = { app: s.c.app, store: s.c.store };
  const unseen = await founder(h, { passkeys: 1, prefix: "unseen" });
  const as = (ip, cookie) => s.get("/api/v0/session", { "x-forwarded-for": ip, cookie: `__Host-rw_session=${cookie}` });
  const upload = (ip, bearer) => s.post("/api/v0/exports", { "x-forwarded-for": ip, authorization: `Bearer ${bearer}`, "runward-mission": "m", "runward-export-kind": "check" });
  const each = async (n, call) => { const out = new Set(); for (let i = 0; i < n; i++) out.add((await call(`198.51.${Math.floor(i / 250)}.${(i % 250) + 1}`, i)).status); return [...out]; };

  // bound + 30 dead cookies, one per address
  assert.deepEqual(await each(bound + RATE_LIMITS.signedOut.perAddress, (ip, i) => as(ip, `dead-${i}`)), [401]);
  assert.equal((await as("203.0.113.7", unseen.token)).status, 200, "a valid session from an address not seen in this window");
  const before = s.work.tx;
  assert.equal((await as("203.0.113.8", "dead-new")).status, 401, "a dead cookie from a new address costs one read, and is answered for what it is");
  assert.equal(s.work.tx, before + 1);
  // the control: the flood did count. An address of the table spends its own budget and is refused unread
  for (let i = 1; i < RATE_LIMITS.signedOut.perAddress; i++) assert.equal((await as("198.51.0.1", `dead-again-${i}`)).status, 401);
  const then = s.work.tx;
  assert.equal((await as("198.51.0.1", "dead-last")).status, 429);
  assert.equal(s.work.tx, then);

  // bound + 60 junk uploads, one per address
  assert.deepEqual(await each(bound + RATE_LIMITS.machine.perAddress, (ip) => upload(ip, "aaa.bbb.ccc")), [401]);
  const signed = await upload("203.0.113.20", token(claimsFor(s.clock)));
  assert.deepEqual([signed.status, (await signed.json()).refusal], [400, "digest-mismatch"], "a signed upload from a new address has its token checked and reaches the application");
});

test("an IPv6 address is counted by its /64, an IPv4 address as it is, whichever way it is written", async () => {
  assert.equal(addressKey("2001:db8:12:3400:aaaa:bbbb:cccc:dddd"), "2001:db8:12:3400::/64");
  assert.equal(addressKey("2001:0DB8:0012:3400::1"), "2001:db8:12:3400::/64", "one spelling for one network");
  assert.equal(addressKey("2001:db8:12:3401::1"), "2001:db8:12:3401::/64", "the next /64 is another caller");
  assert.equal(addressKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(addressKey("::1"), "0:0:0:0::/64");
  assert.equal(addressKey("fe80::1%eth0"), "fe80:0:0:0::/64", "a zone is not part of the address");
  assert.equal(addressKey("[2001:db8:12:3400::9]:44321"), "2001:db8:12:3400::/64", "brackets and a port, as a proxy may write it");
  assert.equal(addressKey("198.51.100.7"), "198.51.100.7");
  // an IPv4 peer as a dual-stack socket names it: that IPv4 address, never one /64 for every IPv4 caller
  assert.equal(addressKey("::ffff:198.51.100.7"), "198.51.100.7");
  assert.equal(addressKey("::ffff:c633:6407"), "198.51.100.7");
  assert.notEqual(addressKey("::ffff:198.51.100.7"), addressKey("::ffff:198.51.100.8"));
  for (const odd of ["?", "unknown", "2001:db8::1::2", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "::ffff:999.1.1.1", "g::1", "(overflow)"]) assert.equal(addressKey(odd), odd, `${odd} is not an address: its own key`);

  // through the routes: the addresses of one /64 share one budget of failures; another /64 has its own
  const s = await serve({ trustProxy: true, signedOut: { perAddress: 3, global: 100 }, writes: { perAddress: 2, global: 100 } });
  const as = (ip, cookie) => s.get("/api/v0/session", { "x-forwarded-for": ip, cookie: `__Host-rw_session=${cookie}` });
  for (let i = 1; i <= 3; i++) assert.equal((await as(`2001:db8:12:3400::${i}`, `dead-${i}`)).status, 401);
  assert.equal((await as("2001:db8:12:3400:ffff:ffff:ffff:fffe", "dead-4")).status, 429, "a fourth address of the same /64 is the same caller");
  assert.equal((await as("2001:db8:12:3401::1", "dead-5")).status, 401, "another /64 is another caller");
  // the public routes count by the same key
  for (let i = 1; i <= 2; i++) assert.equal((await s.post("/api/v0/auth/options", { "x-forwarded-for": `2001:db8:77:1::${i}` })).status, 200);
  assert.equal((await s.post("/api/v0/auth/options", { "x-forwarded-for": "2001:db8:77:1::3" })).status, 429);
  assert.equal((await s.post("/api/v0/auth/options", { "x-forwarded-for": "2001:db8:77:2::3" })).status, 200);
});

// Code review of 2026-11-10, C14: past the table's bound the two budgets of failures were off for every
// key not in the table, and nothing said so. 10,000 /64s fit in one IPv6 /48, and one cheap call from each
// filled the table; any address could then send dead cookies or junk uploads without limit (100,000 served
// where main served 30 and 60).
test("C14: one /48 cannot fill the table, and a key without a place is counted with its prefix on a larger allowance (10,000 /64s of one /48, then 100,000 failures)", () => {
  assert.equal(prefixKey(addressKey("2001:db8:12:3400::1")), "2001:db8:12::/48");
  assert.equal(prefixKey(addressKey("2001:db8:12:ffff::1")), "2001:db8:12::/48");
  assert.notEqual(prefixKey(addressKey("2001:db8:13:3400::1")), "2001:db8:12::/48");
  assert.equal(prefixKey(addressKey("::ffff:198.51.100.7")), "198.51.100.0/24");
  assert.equal(prefixKey("?"), "(not an address)");

  const sub = (n) => `2001:db8:12:${n.toString(16)}::1`; // the n-th /64 of one /48
  const failing = (l, address, n) => { let served = 0; for (let i = 0; i < n; i++) { const e = l.enter(address); if (e.ok) { served++; e.settle(true); } } return served; };

  // ---- the session cookies: 10,000 /64s, one call each, none failing
  const signedOut = failureLimiter({ ...RATE_LIMITS.signedOut, now: () => 0 });
  for (let i = 0; i < 10_000; i++) { const e = signedOut.enter(sub(i)); assert.equal(e.ok, true); e.settle(false); }
  assert.equal(signedOut.size(), 256, "one /48 holds 256 keys of the table, not 10,000");
  const next = signedOut.enter(sub(10_000));
  assert.deepEqual([next.ok, next.tracked, next.counted], [true, false, "prefix"], "the next /64 of the same /48 is counted with its /48");
  next.settle(false);
  // one more /64 of that /48 then fails 100,000 times: served 240 (eight times an address's 30)
  assert.equal(failing(signedOut, sub(10_001), 100_000), RATE_LIMITS.signedOut.perAddress * 8);
  assert.deepEqual(signedOut.enter(sub(10_002)), { ok: false, scope: "prefix", retryAfter: 60 }, "and so is any other /64 of that /48 that has no place");
  // C11 holds: another prefix is served, a key that has its place in the spent /48 is judged on itself,
  // and nothing was served untracked
  for (const other of ["2001:db8:13::1", "203.0.113.7"]) { const e = signedOut.enter(other); assert.deepEqual([e.ok, e.counted], [true, "address"], other); e.settle(false); }
  const own = signedOut.enter(sub(5)); assert.deepEqual([own.ok, own.counted], [true, "address"]); own.settle(false);
  assert.equal(signedOut.untracked(), 0);

  // ---- the machine routes count each call: the flood itself stops at 256 keys and 480 calls of the /48
  const machine = failureLimiter({ ...RATE_LIMITS.machine, everyCall: true, now: () => 0 });
  let served = 0;
  for (let i = 0; i < 10_000; i++) { const e = machine.enter(sub(i)); if (e.ok) { served++; e.settle(false); } }
  assert.equal(served, 256 + RATE_LIMITS.machine.perAddress * 8);
  assert.equal(failing(machine, sub(10_001), 100_000), 0);
  assert.equal(machine.enter("203.0.113.20").ok, true, "an upload from another prefix has its token read");
});

test("C14: once 10,000 keys of forty prefixes filled the table, a key of another prefix is bounded by its prefix, and a valid call from an unseen address is still served", () => {
  const ip = (n) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
  const failing = (l, address, n) => { let served = 0; for (let i = 0; i < n; i++) { const e = l.enter(address); if (e.ok) { served++; e.settle(true); } } return served; };
  for (const [name, options, allowance] of [["signedOut", RATE_LIMITS.signedOut, 240], ["machine", { ...RATE_LIMITS.machine, everyCall: true }, 480]]) {
    const l = failureLimiter({ ...options, now: () => 0 });
    for (let i = 0; i < 10_000; i++) { const e = l.enter(ip(i)); assert.equal(e.ok, true); e.settle(false); }
    assert.equal(l.size(), 10_000, `${name}: the table is full, of keys that did not fail`);
    // d569c95 served 100,000 here; main served 30 and 60
    assert.equal(failing(l, "198.51.100.7", 100_000), allowance, `${name}: one more key, failing 100,000 times`);
    assert.equal(failing(l, "198.51.100.8", 1000), 0, `${name}: its neighbours without a place share that allowance`);
    // C11: a valid call from an address not seen in this window, of another prefix, is served
    const valid = l.enter("203.0.113.7");
    assert.deepEqual([valid.ok, valid.counted], [true, "prefix"], name);
    valid.settle(false);
    assert.equal(l.untracked(), 0, `${name}: nothing was served untracked`);
  }
});

test("C14: past the table of prefixes a call is served untracked, said once a window and counted for 130 minutes", () => {
  let t = 0, said = 0;
  const l = failureLimiter({ perAddress: 2, global: 100, maxAddresses: 2, maxPrefixes: 2, onUntracked: () => said++, now: () => t });
  const call = (a, failed = true) => { const e = l.enter(a); if (e.ok) e.settle(failed); return e.counted ?? e.scope; };
  assert.deepEqual([call("10.0.0.1"), call("10.0.1.1")], ["address", "address"], "the table of addresses: two keys");
  assert.deepEqual([call("10.0.2.1"), call("10.0.3.1")], ["prefix", "prefix"], "the table of prefixes: two prefixes");
  assert.deepEqual([call("10.0.4.1"), call("10.0.5.1"), call("10.0.4.1")], ["none", "none", "none"], "past both, served untracked");
  assert.equal(said, 1, "said once in this window, not once a call");
  assert.deepEqual(l.overflow(), { countedByPrefix: 2, untracked: 3, refusedByPrefix: 0 });
  t = 60_000;
  assert.deepEqual([call("10.0.0.1"), call("10.0.1.1"), call("10.0.2.1"), call("10.0.3.1"), call("10.0.4.1")], ["address", "address", "prefix", "prefix", "none"]);
  assert.equal(said, 2, "and once in the next window");
  assert.deepEqual(l.overflow(), { countedByPrefix: 4, untracked: 4, refusedByPrefix: 0 }, "the last windows are remembered");
  t = (OVERFLOW_HISTORY_MINUTES - 1) * 60_000;
  assert.deepEqual(l.overflow(), { countedByPrefix: 4, untracked: 4, refusedByPrefix: 0 }, "for 130 minutes, in one process");
  t = OVERFLOW_HISTORY_MINUTES * 60_000;
  assert.deepEqual(l.overflow(), { countedByPrefix: 2, untracked: 1, refusedByPrefix: 0 }, "then the first window is forgotten");
  t = (OVERFLOW_HISTORY_MINUTES + 1) * 60_000;
  assert.deepEqual(l.overflow(), { countedByPrefix: 0, untracked: 0, refusedByPrefix: 0 });
});

test("C14, through the routes: untracked calls are a log line without an address, a count in /api/health, and an alert of the probe", async () => {
  const lines = [];
  const log = { info() {}, error() {}, warn: (event, fields) => lines.push({ event, ...fields }) };
  const tiny = { maxAddresses: 2, maxPrefixes: 2 };
  const s = await serve({ trustProxy: true, log, reads: { perAddress: 100, global: 1000 }, signedOut: { ...RATE_LIMITS.signedOut, ...tiny }, machine: { ...RATE_LIMITS.machine, ...tiny } });
  const health = async () => (await s.get("/api/health", { "x-forwarded-for": "192.0.2.200" })).json();
  const quiet = await health();
  assert.deepEqual(quiet.limits, { windowSeconds: OVERFLOW_HISTORY_MINUTES * 60, machine: { countedByPrefix: 0, untracked: 0, refusedByPrefix: 0 }, signedOut: { countedByPrefix: 0, untracked: 0, refusedByPrefix: 0 } });
  const up = { ...quiet, ok: true, db: "ok", objectStore: "ok", dailyJobs: { retention: { lastRun: null, ok: null } } };
  assert.equal(probeVerdict({ healthStatus: 200, health: up, version: { commit: "abc" } }).ok, true, "nothing untracked: no alert");

  // six dead cookies, each from its own /24: two take the table, two the prefixes, two are untracked
  for (let i = 0; i < 6; i++) assert.equal((await s.get("/api/v0/session", { "x-forwarded-for": `198.51.${i}.9`, cookie: `__Host-rw_session=dead-${i}` })).status, 401);
  const after = await health();
  assert.deepEqual(after.limits.signedOut, { countedByPrefix: 2, untracked: 2, refusedByPrefix: 0 });
  assert.deepEqual(after.limits.machine, { countedByPrefix: 0, untracked: 0, refusedByPrefix: 0 });
  assert.equal(lines.length, 1, "one line for the window, not one a call");
  assert.equal(lines[0].event, "limits.untracked");
  assert.equal(lines[0].detail.budget, "signedOut");
  assert.doesNotMatch(JSON.stringify(lines), /198\.51|\d+\.\d+\.\d+\.\d+/, "no address in the line");
  const verdict = probeVerdict({ healthStatus: 200, health: { ...up, limits: after.limits }, version: { commit: "abc" } });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(), /2 call\(s\) of the session cookies were served untracked/);
  // counted with a prefix is not an alert: the budgets hold there
  const held = { ...after.limits, signedOut: { countedByPrefix: 5, untracked: 0, refusedByPrefix: 0 } };
  assert.equal(probeVerdict({ healthStatus: 200, health: { ...up, limits: held }, version: { commit: "abc" } }).ok, true);
});

// Code review of 2026-11-10 on 144211b, C34: the count the alert reads is one process's memory, the service
// scales to zero, and the issue needed two failed probes in a row: a flood, then an instance stopped or
// replaced within the hour, and the second probe read a new process whose count was zero.
test("C34: the count of untracked calls ends with the process, so the probe's verdict asks for the issue at once (exit 3), and for that reason only", () => {
  const up = { ok: true, db: "ok", objectStore: "ok", dailyJobs: { retention: { lastRun: null, ok: null } } };
  const flooded = { ...up, limits: { windowSeconds: 7800, machine: { countedByPrefix: 0, untracked: 0, refusedByPrefix: 0 }, signedOut: { countedByPrefix: 9, untracked: 4, refusedByPrefix: 2 } } };
  const quiet = { ...up, limits: { windowSeconds: 7800, machine: { countedByPrefix: 3, untracked: 0, refusedByPrefix: 7 }, signedOut: { countedByPrefix: 9, untracked: 0, refusedByPrefix: 2 } } };
  const v = (health, healthStatus = 200) => probeVerdict({ healthStatus, health, version: { commit: "abc" } });
  assert.deepEqual([v(flooded).ok, v(flooded).atOnce], [false, true], "an untracked call does not wait for a second probe");
  assert.deepEqual([v(quiet).ok, v(quiet).atOnce], [true, false], "counted with a prefix, or refused for one, is no alert: the budgets held");
  // the other reasons keep the rule of two failures in a row
  assert.deepEqual([v({ ok: false, db: "down", objectStore: "ok" }, 503).ok, v({ ok: false, db: "down", objectStore: "ok" }, 503).atOnce], [false, false]);
  assert.equal(v({ ...up, errors: { windowSeconds: 300, requests: 100, serverErrors: 50, rate: 0.5 } }).atOnce, false);
  assert.equal(v({ ...up, dailyJobs: null }).atOnce, false);
  // the process is the memory: a second limiter, as after a restart, has forgotten what the first one counted
  const tiny = { perAddress: 2, global: 100, maxAddresses: 1, maxPrefixes: 1 };
  const first = failureLimiter(tiny);
  for (const a of ["10.0.0.1", "10.0.1.1", "10.0.2.1"]) first.enter(a).settle(true);
  assert.equal(first.overflow().untracked, 1);
  assert.equal(failureLimiter(tiny).overflow().untracked, 0, "the control: a new process starts at zero");
  // the command the workflow runs, and its exit code
  const dir = mkdtempSync(join(tmpdir(), "rw-probe-"));
  try {
    const run = (health, status) => {
      writeFileSync(join(dir, "health.json"), JSON.stringify(health)); writeFileSync(join(dir, "version.json"), JSON.stringify({ commit: "abc" }));
      return spawnSync(process.execPath, [new URL("../../scripts/probe-verdict.mjs", import.meta.url).pathname, join(dir, "health.json"), String(status), join(dir, "version.json")], { encoding: "utf8" });
    };
    assert.equal(run(up, 200).status, 0);
    assert.equal(run(flooded, 200).status, 3);
    assert.match(run(flooded, 200).stdout, /^probe: 4 call\(s\) of the session cookies were served untracked/);
    assert.equal(run({ ok: false, db: "down", objectStore: "ok" }, 503).status, 1);
    assert.equal(run({ ...flooded, ok: false, db: "down" }, 503).status, 3, "with another reason next to it, still at once");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The step of probe.yml that opens, updates or closes the issue, run as GitHub runs it (bash -e), with a
// `gh` and a `date` of our own on its PATH.
test("C34: probe.yml opens the issue on the first failed probe when the verdict says at once, and keeps two failures in a row for the rest", async () => {
  const text = readFileSync(new URL("../../.github/workflows/probe.yml", import.meta.url), "utf8");
  // the first step turns the verdict's exit 3 into the output the second step reads
  assert.match(text, /^ {10}at_once=\$\(\[ "\$vcode" = "3" \] && echo yes \|\| echo no\)$/m);
  assert.match(text, /echo "at_once=\$at_once" >> "\$GITHUB_OUTPUT"/);
  assert.match(text, /AT_ONCE: "\$\{\{ steps\.read\.outputs\.at_once \}\}"/);
  const lines = text.split("\n");
  const at = lines.indexOf("      - name: open, update or close the issue");
  assert.ok(at > 0 && lines[at + 2] === "        run: |", "the step is where this test reads it");
  const script = lines.slice(at + 3).filter((l) => l.startsWith("          ") || !l.trim()).map((l) => l.slice(10)).join("\n");
  assert.match(script, /gh issue create/);
  const dir = mkdtempSync(join(tmpdir(), "rw-probe-"));
  try {
    writeFileSync(join(dir, "step.sh"), script);
    writeFileSync(join(dir, "gh"), `#!/bin/bash\necho "$1 $2" >> "$CALLS"\ncase "$1 $2" in\n  "issue list") echo "$FAKE_OPEN";;\n  "run list") echo "$FAKE_PREV";;\n  "api "*) echo 2026-11-09T00:00:00Z;;\n  "issue create") echo "$*" >> "$CREATED";;\nesac\n`);
    writeFileSync(join(dir, "date"), `#!/bin/bash\ncase "$*" in *+%s*) echo 1794268800;; *) echo 2026-11-10T00:00:00Z;; esac\n`);
    chmodSync(join(dir, "gh"), 0o755); chmodSync(join(dir, "date"), 0o755);
    const step = async ({ ok, atOnce, open = "", prev = "success" }) => {
      rmSync(join(dir, "calls"), { force: true }); rmSync(join(dir, "created"), { force: true });
      const env = { PATH: `${dir}:/usr/bin:/bin`, OK: ok, AT_ONCE: atOnce, DAYS: "90", VERDICT: "the verdict", REPO: "o/r", GH_TOKEN: "x", FAKE_OPEN: open, FAKE_PREV: prev, CALLS: join(dir, "calls"), CREATED: join(dir, "created") };
      const code = await new Promise((resolve) => execFile("/bin/bash", ["-e", join(dir, "step.sh")], { env, timeout: 30_000 }, (e) => resolve(e ? e.code : 0)));
      const calls = existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").trim().split("\n") : [];
      return { code, calls: calls.filter((c) => /^issue (create|comment|close)$/.test(c)), created: existsSync(join(dir, "created")) ? readFileSync(join(dir, "created"), "utf8") : "" };
    };
    // the first failed probe, the one before it green
    const first = await step({ ok: "no", atOnce: "yes" });
    assert.deepEqual([first.code, first.calls], [1, ["issue create"]], "at once: the issue opens on this probe");
    assert.match(first.created, /--label probe .*This probe failed for a reason that does not wait for a second one: the verdict/);
    assert.deepEqual(await step({ ok: "no", atOnce: "no" }).then((r) => [r.code, r.calls]), [1, []], "any other reason waits for the second failure");
    const second = await step({ ok: "no", atOnce: "no", prev: "failure" });
    assert.deepEqual(second.calls, ["issue create"]);
    assert.match(second.created, /Two probes in a row failed: the verdict/);
    // an issue already open is commented, never opened twice; a green probe closes it
    assert.deepEqual((await step({ ok: "no", atOnce: "yes", open: "12" })).calls, ["issue comment"]);
    assert.deepEqual(await step({ ok: "yes", atOnce: "no", open: "12" }).then((r) => [r.code, r.calls]), [0, ["issue close"]]);
    assert.deepEqual(await step({ ok: "yes", atOnce: "no" }).then((r) => [r.code, r.calls]), [0, []]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Same review, C35: a key without a place is refused for what the keys of its own prefix that had no place
// did. The cost was written nowhere, and those refusals were counted nowhere.
test("C35: the refusals on a prefix's allowance are counted, and what they cost inside one /48 is 496 requests a minute", () => {
  let t = 0;
  const l = failureLimiter({ ...RATE_LIMITS.signedOut, now: () => t });
  const fail = (a) => { const e = l.enter(a); if (e.ok) e.settle(true); return e.ok ? e.counted : e.scope; };
  const net = (i) => `2001:db8:1:${i.toString(16)}::1`;
  let sent = 0;
  // 256 calls, each from its own /64 of one /48, take the prefix's share of the table
  for (let i = 0; i < 256; i++) { assert.equal(fail(net(i)), "address"); sent++; }
  // then 240 failures from further /64s spend the prefix's allowance (eight times an address's)
  for (let i = 256; i < 256 + 240; i++) { assert.equal(fail(net(i)), "prefix"); sent++; }
  assert.equal(sent, 496);
  assert.deepEqual(l.overflow(), { countedByPrefix: 240, untracked: 0, refusedByPrefix: 0 });
  // from here every /64 of that /48 without a place is refused, a stranger's first call included
  assert.equal(fail(net(0x9000)), "prefix");
  const stranger = l.enter(net(0x9001));
  assert.deepEqual([stranger.ok, stranger.scope], [false, "prefix"]);
  assert.deepEqual(l.overflow(), { countedByPrefix: 240, untracked: 0, refusedByPrefix: 2 }, "counted, where /api/health reads it");
  // never a /64 that has its place, never another prefix
  assert.equal(l.enter(net(3)).ok, true);
  assert.equal(l.enter("2001:db8:2:1::1").ok, true);
  // the machine routes count every call: 256, then 480, so 736 a minute
  const m = failureLimiter({ ...RATE_LIMITS.machine, everyCall: true, now: () => t });
  let calls = 0;
  for (let i = 0; m.enter(net(i)).ok; i++) calls++;
  assert.deepEqual([calls, m.overflow()], [736, { countedByPrefix: 480, untracked: 0, refusedByPrefix: 1 }]);
  // an IPv4 /24 never holds more than its share: it is counted with its prefix only once the table is full
  const v4 = failureLimiter({ ...RATE_LIMITS.signedOut, now: () => t });
  for (let i = 0; i < 256; i++) assert.equal(v4.enter(`192.0.2.${i}`).counted, "address");
  assert.equal(v4.overflow().countedByPrefix, 0);
  // the count is kept with the others, then forgotten with them
  t = 60_000;
  assert.equal(l.overflow().refusedByPrefix, 2);
  t = (OVERFLOW_HISTORY_MINUTES + 1) * 60_000;
  assert.equal(l.overflow().refusedByPrefix, 0);
});
