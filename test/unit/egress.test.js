// The way out is bounded (review finding of 2026-11-08: no timeout on the fetches to the OIDC issuer and
// to S3): a closed list of hosts, a deadline on every call, and a circuit breaker per host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boundFetch, EgressRefused, EgressUnavailable } from "../../src/adapters/system/egress.js";

const ISSUER = "https://token.actions.githubusercontent.com/.well-known/jwks";
const hanging = (calls) => (url, init) => { calls.push(url); return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))); };
const answering = (calls, status = 200) => async (url) => { calls.push(url); return new Response("{}", { status }); };

test("egress: a host outside the list is refused before any socket", async () => {
  const calls = [];
  const f = boundFetch(["token.actions.githubusercontent.com"], answering(calls));
  await assert.rejects(f("https://example.org/x"), EgressRefused);
  await assert.rejects(f("http://token.actions.githubusercontent.com/x"), EgressRefused, "plain http to a remote host");
  assert.equal(calls.length, 0);
});

test("egress: a call that does not answer is cut at its deadline, and the caller's own signal still counts", async () => {
  const calls = [];
  const f = boundFetch(["token.actions.githubusercontent.com"], hanging(calls), { timeoutMs: 60 });
  const t0 = Date.now();
  await assert.rejects(f(ISSUER), (e) => e instanceof EgressUnavailable && /no answer within 60 ms/.test(e.message));
  assert.ok(Date.now() - t0 < 2000, "cut by the deadline, not left hanging");
  const mine = new AbortController();
  const p = f(ISSUER, { signal: mine.signal });
  mine.abort(new Error("caller gave up"));
  await assert.rejects(p, /caller gave up/);
});

test("egress: after five failures in a row the circuit opens, refuses without a socket, then lets one trial through", async () => {
  let at = 1_000_000;
  const calls = [];
  let status = 503;
  const f = boundFetch(["token.actions.githubusercontent.com"], async (url) => { calls.push(url); return new Response("{}", { status }); }, { failures: 5, openMs: 30_000, now: () => at });
  for (let i = 0; i < 5; i++) assert.equal((await f(ISSUER)).status, 503);
  assert.equal(calls.length, 5);
  await assert.rejects(f(ISSUER), (e) => e instanceof EgressUnavailable && /circuit open/.test(e.message));
  assert.equal(calls.length, 5, "an open circuit opens no socket");
  at += 30_001;
  assert.equal((await f(ISSUER)).status, 503, "the half-open trial reaches the host");
  await assert.rejects(f(ISSUER), /circuit open/, "a failed trial opens the circuit again at once");
  at += 30_001;
  status = 200;
  assert.equal((await f(ISSUER)).status, 200);
  assert.equal((await f(ISSUER)).status, 200, "a successful trial closes the circuit");
  assert.deepEqual(f.circuits()["token.actions.githubusercontent.com"], { open: false, failed: 0 });
});

test("egress: one host's open circuit does not close the way to another", async () => {
  const at = 5;
  const f = boundFetch(["token.actions.githubusercontent.com", "s3.fr-par.scw.cloud"], async (url) => new Response("{}", { status: url.includes("s3.") ? 200 : 500 }), { failures: 2, now: () => at });
  await f(ISSUER); await f(ISSUER);
  await assert.rejects(f(ISSUER), /circuit open/);
  assert.equal((await f("https://s3.fr-par.scw.cloud/b/k")).status, 200);
});

test("egress: a caller that gives up is not counted against the host", async () => {
  const f = boundFetch(["token.actions.githubusercontent.com"], hanging([]), { failures: 1, timeoutMs: 5_000 });
  const mine = new AbortController();
  const p = f(ISSUER, { signal: mine.signal });
  mine.abort(new Error("caller gave up"));
  await assert.rejects(p, /caller gave up/);
  assert.deepEqual(f.circuits()["token.actions.githubusercontent.com"], { open: false, failed: 0 });
});

test("egress: the service's composition bounds the issuer and S3 fetches (deadline and circuit)", async () => {
  const { readConfig, compose } = await import("../../src/main.js");
  const { memoryStore } = await import("../../src/adapters/store/memory.js");
  const { silentLog } = await import("../../src/adapters/system/log.js");
  const calls = [];
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_SEND_WORKFLOW_SHAS: "0".repeat(40) });
  const c = compose(config, { log: silentLog, store: memoryStore({ clock: { now: () => 0 } }), fetchImpl: hanging(calls), egressOptions: { timeoutMs: 50 } });
  await assert.rejects(c.egress(ISSUER), (e) => e instanceof EgressUnavailable && /no answer within 50 ms/.test(e.message));
  assert.equal(calls.length, 1);
  assert.ok(c.egress.circuits()["token.actions.githubusercontent.com"], "the issuer has a circuit");
});
