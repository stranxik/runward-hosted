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
  const { jobIncomplete, gestureStatus, incompleteReason } = await import("../../src/operator.js");
  assert.equal(jobIncomplete([{ tenant: "a", erased: 0, attempts: 1 }]), false);
  assert.equal(jobIncomplete([{ tenant: "a", erased: 0 }, { tenant: "b", failed: true, error: "x", attempts: 3 }]), true);
  assert.equal(jobIncomplete([{ tenant: "a", ok: false, at: 3, why: "hash" }]), true);
  assert.equal(jobIncomplete({ opened: true }), false, "a gesture that is not a daily job");
  // what a run prints is its status, never its result (the result is in the operator journal)
  assert.deepEqual(gestureStatus("verify-chains", [{ tenant: "a", ok: false, head: "h", why: "hash" }]), { gesture: "verify-chains", ok: false });
  assert.deepEqual(gestureStatus("open-bootstrap", { tenant: "t", link: "l", expiresAt: "x" }), { gesture: "open-bootstrap", ok: true });
  // the reason of an incomplete run, for the gateway's log line at the hoster: a count and the first reason, no tenant
  const tenant = "0b9f6b0e-3c2a-4d7e-9f1a-2b3c4d5e6f70";
  const reason = incompleteReason("retention", [{ tenant, erased: 0 }, { tenant, failed: true, error: "object store: DELETE 503", attempts: 3 }]);
  assert.equal(reason, "operator: retention did not complete: 1 tenant(s) failed or broken; first reason: object store: DELETE 503");
  assert.match(incompleteReason("verify-chains", [{ tenant, ok: false, at: 3, why: "hash does not match the entry" }]), /chain broken at seq 3 \(hash does not match the entry\)/);
  assert.equal(incompleteReason("retention", [{ tenant, erased: 0 }]), null);
  assert.equal(incompleteReason("open-bootstrap", { tenant, link: "l" }), null);
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

// Review finding of 2026-11-10 (code review C6): the alert failed open. When rw.daily_jobs() cannot be read
// (a grant not applied, the function missing after a partial deploy, a statement past its deadline),
// /api/health says dailyJobs null with db ok, and the probe read null as nothing to report.
test("the daily jobs' outcome that cannot be read raises the probe's alert: null with the database ok is not silence", async () => {
  const h = harness();
  let broken = true;
  const real = h.store.tx.bind(h.store);
  // the store answers everything but the read of the daily jobs, as a database without the grant would
  h.store.tx = (tenant, fn) => real(tenant, (tx) => fn(new Proxy(tx, { get: (t, k) => (k === "dailyJobs" && broken ? () => { throw new Error("permission denied for function daily_jobs"); } : t[k]) })));
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_SEND_WORKFLOW_SHAS: SEND_SHA });
  const c = compose(config, { clock: h.clock, log: silentLog, store: h.store, objects: memoryObjects(), authn: fakeAuthn(), verifier: { async verify() { throw new Error("no upload here"); } } });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  servers.push(c.http.server);
  const read = async () => { const r = await fetch(`http://127.0.0.1:${c.http.server.address().port}/api/health`); return { status: r.status, health: await r.json() }; };
  const first = await read();
  assert.deepEqual([first.status, first.health.ok, first.health.db, first.health.dailyJobs], [200, true, "ok", null], "the service itself is up");
  const v = probeVerdict({ healthStatus: first.status, health: first.health, version: { commit: "c0ffee" }, now: h.clock.now() });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(), /the daily jobs' last outcome cannot be read/);
  // controls: once it reads again the alert clears; with the database down, the outage is the one reason
  broken = false;
  const second = await read();
  assert.equal(probeVerdict({ healthStatus: second.status, health: second.health, version: { commit: "c0ffee" }, now: h.clock.now() }).ok, true);
  assert.deepEqual(probeVerdict({ healthStatus: 503, health: { ok: false, db: "down", objectStore: "ok", dailyJobs: null }, version: { commit: "c0ffee" } }).reasons, ["health answered 503 (db down, objects ok)"]);
});

// Review finding of 2026-11-10 (independent review): a daily job killed at its deadline wrote no note, and
// verify-chains was scheduled at the very minute retention's deadline ended. The note the gateway has
// written (src/operator.js job-note) reads as a run that did not complete; the schedule leaves the gap.
test("the note of a daily job that did not run to its end is read by /api/health as a run that did not complete, and raises the probe's alert", async () => {
  const { noteIncomplete, JOB_NOTE } = await import("../../src/operator.js");
  const h = harness();
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_SEND_WORKFLOW_SHAS: SEND_SHA });
  const c = compose(config, { clock: h.clock, log: silentLog, store: h.store, objects: memoryObjects(), authn: fakeAuthn(), verifier: { async verify() { throw new Error("no upload here"); } } });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  servers.push(c.http.server);
  const health = async () => (await fetch(`http://127.0.0.1:${c.http.server.address().port}/api/health`)).json();
  await h.app.operator.retention();
  assert.equal((await health()).dailyJobs.retention.ok, true, "a completed run, before");
  for (const why of JOB_NOTE.whys) {
    await noteIncomplete(h.store, "retention", why);
    const body = await health();
    assert.equal(body.dailyJobs.retention.ok, false, why);
    assert.match(probeVerdict({ healthStatus: 200, health: body, version: { commit: "c0ffee" }, now: h.clock.now() }).reasons.join(), /the daily job retention did not complete/);
    await h.app.operator.retention();
    assert.equal((await health()).dailyJobs.retention.ok, true, "the next completed run clears it");
  }
  assert.deepEqual(notes(h, "retention").filter((n) => n.detail.incomplete).map((n) => n.detail), JOB_NOTE.whys.map((why) => ({ report: [], failed: 1, incomplete: why })), "the note names no tenant");
  await assert.rejects(noteIncomplete(h.store, "migrate", "deadline"), /--job must be one of/);
  await assert.rejects(noteIncomplete(h.store, "retention", "because"), /--why must be one of/);
});

test("the schedule: each daily job starts after the other's deadline, its kill and its note are over, and the hoster's timeout is above them", async () => {
  const { GESTURES, NOTE_TIMEOUT_MS } = await import("../../src/operator-gateway.js");
  const { readFileSync } = await import("node:fs");
  const tf = readFileSync(new URL("../../infra/scaleway/main.tf", import.meta.url), "utf8");
  const scheduled = /scheduled = \{ retention = "(\d+) (\d+) \* \* \*", verify-chains = "(\d+) (\d+) \* \* \*" \}/.exec(tf);
  assert.ok(scheduled, "the two daily triggers are declared in infra/scaleway/main.tf");
  const [rm, rh, vm, vh] = scheduled.slice(1).map(Number);
  const start = { retention: (rh * 60 + rm) * 60_000, "verify-chains": (vh * 60 + vm) * 60_000 };
  const KILL_GRACE_MS = 5_000, MARGIN_MS = 5 * 60_000;
  const busyFor = (job) => GESTURES[job].timeoutMs + KILL_GRACE_MS + NOTE_TIMEOUT_MS;
  const [first, second] = start.retention < start["verify-chains"] ? ["retention", "verify-chains"] : ["verify-chains", "retention"];
  assert.ok(start[second] - start[first] >= busyFor(first) + MARGIN_MS, `${second} starts ${(start[second] - start[first]) / 60_000} min after ${first}, which may hold the gateway ${busyFor(first) / 60_000} min`);
  assert.ok(start[first] + 24 * 3600_000 - start[second] >= busyFor(second) + MARGIN_MS);
  // the hoster cuts a call after `timeout` seconds: above the longest gesture, its kill and its note
  const timeouts = [...tf.matchAll(/^\s*timeout\s*=\s*(\d+)/gm)].map((m) => Number(m[1]));
  assert.ok(timeouts.length >= 1);
  const operator = Number(/name\s*=\s*"runward-hosted-operator"[\s\S]*?\n\s*timeout\s*=\s*(\d+)/.exec(tf)[1]);
  assert.ok(operator * 1000 >= Math.max(...Object.values(GESTURES).map((g) => g.timeoutMs)) + KILL_GRACE_MS + NOTE_TIMEOUT_MS, "the gateway container's timeout");
});
