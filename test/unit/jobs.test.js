// The daily jobs (async-job-guardrails; review finding of 2026-11-08: the operator note was written on
// success only, a failure went to stderr, and one tenant's error stopped the next ones). Each tenant is
// isolated, retried a bounded number of times, and every outcome reaches the operator journal; the last
// outcome of each job is read by /api/health and alerted on by the hourly probe (review finding of
// 2026-11-10: the journal was read by nothing).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { harness, founder, pinnedRepository, send, gesture, fakeAuthn, SEND_SHA } from "../helpers.js";
import { DAY } from "../../src/domain/identity.js";
import { readConfig, compose } from "../../src/main.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { probeVerdict } from "../../scripts/probe-verdict.mjs";

const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))));

/** A harness whose store fails, on purpose, for the transactions `fails(tenant, n)` selects. */
function failing(fails) {
  const h = harness({ config: { jobRetryWaits: [0, 0] } });
  const real = h.store.tx.bind(h.store);
  const calls = new Map();
  h.store.tx = (tenant, fn) => {
    const n = (calls.get(tenant) ?? 0) + 1; calls.set(tenant, n);
    return fails(tenant, n) ? Promise.reject(new Error(`planted failure ${n}`)) : real(tenant, fn);
  };
  return { h, calls };
}
const notes = (h, what) => h.store._state.operator.filter((n) => n.what === what);

test("a daily job: a failing tenant is retried three times, journalled with its error, and the next tenants still run", async () => {
  let bad = null;
  const { h, calls } = failing((t) => t !== null && t === bad);
  const a = await founder(h, { prefix: "a" });
  const b = await founder(h, { prefix: "b" });
  bad = a.tenant;
  calls.clear();
  const report = await h.app.operator.retention();
  const ra = report.find((r) => r.tenant === a.tenant), rb = report.find((r) => r.tenant === b.tenant);
  assert.deepEqual({ failed: ra.failed, attempts: ra.attempts }, { failed: true, attempts: 3 });
  assert.match(ra.error, /planted failure 3/);
  assert.equal(calls.get(a.tenant), 3, "bounded: three attempts, no more");
  assert.equal(rb.failed, undefined);
  assert.equal(rb.attempts, 1);
  const [note] = notes(h, "retention");
  assert.equal(note.detail.failed, 1, "the failure is in the operator journal, not only on stderr");
  assert.equal(note.detail.report.length, 2);
});

test("a daily job: a failure that clears on a later attempt is retried, not reported", async () => {
  let armed = null;
  const { h } = failing((t) => { if (t !== null && t === armed) { armed = null; return true; } return false; });
  const a = await founder(h, { prefix: "a" });
  armed = a.tenant;
  const report = await h.app.operator.verifyChains();
  assert.deepEqual({ failed: report[0].failed, ok: report[0].ok, attempts: report[0].attempts }, { failed: undefined, ok: true, attempts: 2 });
  assert.equal(notes(h, "verify-chains")[0].detail.failed, 0);
});

test("a daily job: when the tenant list itself cannot be read, the failure is noted before the job stops", async () => {
  let armed = false;
  const { h } = failing((t) => { if (t === null && armed) { armed = false; return true; } return false; });
  await founder(h, { prefix: "a" });
  armed = true;
  await assert.rejects(h.app.operator.retention(), /planted failure/);
  const [note] = notes(h, "retention");
  assert.equal(note.detail.failed, 1);
  assert.equal(note.detail.stage, "tenant list");
});

test("the retention job is idempotent: a second pass erases nothing and journals nothing more", async () => {
  const h = harness();
  const f = await founder(h);
  const r = await pinnedRepository(h, f);
  await send(h, { run_number: "5", run_id: "40000000005" });
  await gesture(h, f.session, null, null);
  await h.app.repositories.remove(await h.app.identity.sessionFrom(f.token), r.id, {});
  h.clock.advance(31 * DAY);
  const first = await h.app.operator.retention();
  assert.ok(first[0].erased >= 1, "the bytes of a repository removed 30 days ago are erased");
  const ledger = (await h.store.tx(f.tenant, (tx) => tx.ledgerAll())).length;
  const second = await h.app.operator.retention();
  assert.deepEqual({ erased: second[0].erased, archives: second[0].archives, expired: second[0].expired }, { erased: 0, archives: 0, expired: 0 });
  assert.equal((await h.store.tx(f.tenant, (tx) => tx.ledgerAll())).length, ledger, "no second entry in the tenant's journal");
});

test("the operator's run of a daily job ends non-zero when a tenant failed or a chain is broken", async () => {
  const { jobIncomplete, gestureStatus } = await import("../../src/operator.js");
  assert.equal(jobIncomplete([{ tenant: "a", erased: 0, attempts: 1 }]), false);
  assert.equal(jobIncomplete([{ tenant: "a", erased: 0 }, { tenant: "b", failed: true, error: "x", attempts: 3 }]), true);
  assert.equal(jobIncomplete([{ tenant: "a", ok: false, at: 3, why: "hash" }]), true);
  assert.equal(jobIncomplete({ opened: true }), false, "a gesture that is not a daily job");
  // what a run prints is its status, never its result (the result is in the operator journal)
  assert.deepEqual(gestureStatus("verify-chains", [{ tenant: "a", ok: false, head: "h", why: "hash" }]), { gesture: "verify-chains", ok: false });
  assert.deepEqual(gestureStatus("open-bootstrap", { tenant: "t", link: "l", expiresAt: "x" }), { gesture: "open-bootstrap", ok: true });
});

test("a daily job that did not complete is read by /api/health, without a tenant, and raises the hourly probe's alert until a run completes", async () => {
  let bad = null;
  const { h } = failing((t) => t !== null && t === bad);
  const a = await founder(h, { prefix: "a" });
  // the service over the same store as the operator's runs
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_SEND_WORKFLOW_SHAS: SEND_SHA });
  const c = compose(config, { clock: h.clock, log: silentLog, store: h.store, objects: memoryObjects(), authn: fakeAuthn(), verifier: { async verify() { throw new Error("no upload here"); } } });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  servers.push(c.http.server);
  const health = async () => (await fetch(`http://127.0.0.1:${c.http.server.address().port}/api/health`)).json();
  const verdict = async () => probeVerdict({ healthStatus: 200, health: await health(), version: { commit: "c0ffee" }, now: h.clock.now() });

  assert.deepEqual((await health()).dailyJobs, { retention: { lastRun: null, ok: null }, "verify-chains": { lastRun: null, ok: null } }, "no run yet: nothing to say");
  assert.equal((await verdict()).ok, true);

  bad = a.tenant;
  await h.app.operator.retention();
  const body = await health();
  assert.deepEqual(body.dailyJobs.retention, { lastRun: new Date(h.clock.now()).toISOString(), ok: false });
  assert.equal(JSON.stringify(body).includes(a.tenant), false, "the public health names no tenant");
  assert.match((await verdict()).reasons.join(), /the daily job retention did not complete/);

  bad = null;
  await h.app.operator.retention();
  assert.equal((await health()).dailyJobs.retention.ok, true, "the next run completes");
  assert.equal((await verdict()).ok, true, "the alert clears with it");

  // a broken chain is a run that did not complete either, though no tenant failed
  h.store._state.ledger = h.store._state.ledger.map((e, i) => (i === 0 ? { ...e, body: { ...e.body, what: "tampered" } } : e));
  await h.app.operator.verifyChains();
  assert.equal((await health()).dailyJobs["verify-chains"].ok, false);
  assert.match((await verdict()).reasons.join(), /the daily job verify-chains did not complete/);

  // a job that stopped running: no run for more than a day
  h.store._state.ledger = [];
  await h.app.operator.verifyChains();
  h.clock.advance(27 * 3600 * 1000);
  assert.match((await verdict()).reasons.join(), /the daily job retention has not run since/);
});
