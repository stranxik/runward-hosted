// Declarations, consent, erasure, the export and its replay (architecture §3.4, PADR-0011 6 bis, PADR-0017).
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, founder, pinnedRepository, send, gesture, FIXTURE_CHECK } from "../helpers.js";
import { replay } from "../../scripts/replay-export.mjs";
import { DAY } from "../../src/domain/identity.js";

const refusal = async (p) => { try { await p; return null; } catch (e) { return e.code ?? e.message; } };
const fresh = async (h, f) => { await gesture(h, f.session, null, null); return h.app.identity.sessionFrom(f.token); };

test("declaring: malformed, already here, unavailable elsewhere (one answer, no oracle)", async () => {
  const h = harness();
  const a = await founder(h);
  const b = await founder(h, { prefix: "b" });
  let s = await fresh(h, a);
  assert.equal(await refusal(h.app.repositories.declare(s, { name: "not a repo" }, {})), "repository-malformed");
  assert.equal(await refusal(h.app.repositories.declare(s, { name: "o/r", workflow: "../x.yml" }, {})), "workflow-malformed");
  await h.app.repositories.declare(s, { name: "Org/Repo" }, {});
  assert.equal(await refusal(h.app.repositories.declare(s, { name: "org/repo", missions: [{ id: "other" }] }, {})), "repository-exists");
  const sb = await fresh(h, b);
  assert.equal(await refusal(h.app.repositories.declare(sb, { name: "org/REPO", missions: [{ id: "x" }] }, {})), "repository-unavailable");
  s = await fresh(h, a);
  assert.equal(await refusal(h.app.repositories.declare(s, { name: "org/two", missions: [{ id: "repo" }] }, {})), "mission-exists");
});

test("consent given in the declaration needs the per-gesture verification; the box is empty by default", async () => {
  const h = harness();
  const f = await founder(h);
  const s = await fresh(h, f);
  assert.equal(await refusal(h.app.repositories.declare(s, { name: "a/b", consent: true }, {})), "gesture-required");
  const d = await h.app.repositories.declare(s, { name: "a/b" }, {});
  const v = await h.app.identity.accessView(s);
  assert.equal(v.repositories.find((r) => r.id === d.id).consent, false);
});

test("withdrawing consent refuses the next uploads and may erase what was received; the journal keeps the digests", async () => {
  const h = harness();
  const f = await founder(h);
  const r = await pinnedRepository(h, f);
  await send(h, { run_number: "5", run_id: "40000000005" });
  await gesture(h, f.session, "consent-withdraw", r.id);
  await h.app.repositories.withdrawConsent(await h.app.identity.sessionFrom(f.token), r.id, { erase: true });
  assert.equal((await send(h, { run_number: "6", run_id: "40000000006" })).refusal, "content-not-consented");
  assert.equal([...h.objects._map.keys()].filter((k) => k.includes("/sha256/")).length, 0, "the bytes are gone");
  const entries = await h.store.tx(f.tenant, (tx) => tx.ledgerAll());
  const erased = entries.find((e) => e.body.what === "content-erased");
  assert.ok(erased.body.detail.digests.length >= 1);
  const idx = JSON.parse((await h.app.reading.index(f.tenant)).bytes.toString("utf8"));
  assert.equal(idx.missions[0].latest, "not-observed", "the index is rebuilt without them: silence is shown");
});

test("removing then restoring a repository, with an upload during the removal (AR)", async () => {
  const h = harness();
  const f = await founder(h);
  const r = await pinnedRepository(h, f);
  const s = await fresh(h, f);
  await h.app.repositories.remove(s, r.id, {});
  let idx = JSON.parse((await h.app.reading.index(f.tenant)).bytes.toString("utf8"));
  assert.equal(idx.missions.length, 0);
  assert.equal((await send(h, { run_number: "9", run_id: "40000000009" })).refusal, "repository-not-declared");
  await h.app.repositories.restore(await fresh(h, f), r.id, {});
  idx = JSON.parse((await h.app.reading.index(f.tenant)).bytes.toString("utf8"));
  assert.equal(idx.missions.length, 1, "restored as it was");
  const st = await h.app.reading.status(await h.app.identity.sessionFrom(f.token));
  assert.equal(st.lines[0].notAcceptedSince, 1);
  assert.equal(st.lines[0].lastRefusal, "repository-not-declared");
  h.clock.advance(31 * DAY);
});

test("a pending declaration expires after 7 days without an upload", async () => {
  const h = harness();
  const f = await founder(h);
  const d = await h.app.repositories.declare(await fresh(h, f), { name: "a/late" }, {});
  h.clock.advance(7 * DAY);
  const rep = await h.app.operator.retention();
  assert.equal(rep[0].expired, 1);
  const s = await h.store.tx(f.tenant, (tx) => tx.get("repository", { id: d.id }));
  assert.ok(s.removedAt);
});

test("the export replays: every published index is rebuilt byte for byte by runward-fleet (S1 b)", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  await pinnedRepository(h, f, { name: "stranxik/hitpoint", mission: "hitpoint", claims: { repository_id: "3003", run_id: "39000000002" } });
  const clean = Buffer.from(FIXTURE_CHECK.toString("utf8").replace('"gaps"', '"clean"'));
  await send(h, { run_number: "2", run_id: "40000000102" }, { bytes: clean });
  await send(h, { repository: "stranxik/hitpoint", repository_id: "3003", run_number: "3", run_id: "40000000103" }, { mission: "hitpoint" });
  assert.equal(await refusal(h.app.reading.prepareExport(f.session, {})), "gesture-required");
  await gesture(h, f.session, "export", "");
  const a = await h.app.reading.prepareExport(await h.app.identity.sessionFrom(f.token), {});
  const r = replay(a.bytes, "0.46.0");
  assert.equal(r.ok, true, JSON.stringify(r.results));
  assert.ok(r.results.filter((x) => x.state === "same").length >= 3, JSON.stringify(r.results.map((x) => x.state)));
  assert.equal(r.chainOk, true);
  const live = await h.app.identity.sessionFrom(f.token);
  const dl = await h.app.reading.downloadExport(live, a.id);
  assert.equal(dl.sha256, a.sha256);
  h.clock.advance(DAY);
  assert.equal(await refusal(h.app.reading.downloadExport(live, a.id)), "not-found", "an archive lives 24 h");
});

test("the hosted index never shows machine-established, even if an export claims it (PADR-0011 point 2, planted)", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  const doc = JSON.parse(FIXTURE_CHECK.toString("utf8"));
  doc.implemented = "machine-established";
  const res = await send(h, { run_number: "8", run_id: "40000000008" }, { bytes: Buffer.from(JSON.stringify(doc)) });
  assert.equal(res.status, 201);
  const idx = (await h.app.reading.index(f.tenant)).bytes.toString("utf8");
  assert.equal(/"implemented": "machine-established"/.test(idx), false);
});

test("an export that breaks runward-fleet is kept in quarantine; the fleet goes on", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  const before = (await h.app.reading.index(f.tenant)).sha256;
  const doc = JSON.parse(FIXTURE_CHECK.toString("utf8"));
  doc.gateNonScope = "see /home/someone/secret";
  const res = await send(h, { run_number: "9", run_id: "40000000009" }, { bytes: Buffer.from(JSON.stringify(doc)) });
  assert.equal(res.status, 422);
  assert.equal(res.refusal, "private-path");
  assert.equal((await h.app.reading.index(f.tenant)).sha256, before);
  const st = await h.app.reading.status(f.session);
  assert.equal(st.quarantined, 1);
  assert.equal(st.lines[0].lastRefusal, "private-path");
});

test("the language of the index is the tenant's setting, and rebuilds it", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  const s = await fresh(h, f);
  await h.app.repositories.settings(s, { lang: "en" }, {});
  assert.equal(JSON.parse((await h.app.reading.index(f.tenant)).bytes.toString("utf8")).lang, "en");
});

test("changing the calling workflow opens a new order epoch", async () => {
  const h = harness();
  const f = await founder(h);
  const r = await pinnedRepository(h, f);
  await send(h, { run_number: "50", run_id: "40000000050" });
  await h.app.repositories.patch(await fresh(h, f), r.id, { workflow: ".github/workflows/ci.yml" }, {});
  const res = await send(h, { run_number: "1", run_id: "50000000001", workflow_ref: "stranxik/dropyour/.github/workflows/ci.yml@refs/heads/main" });
  assert.equal(res.body.current, true, "run 1 of the new workflow is current in the new epoch");
});

test("a mission that has uploads is removed only knowingly; its uploads stay in the journal", async () => {
  const h = harness();
  const f = await founder(h);
  const r = await pinnedRepository(h, f);
  assert.equal(await refusal(h.app.repositories.patch(await fresh(h, f), r.id, { removeMissions: ["dropyour"] }, {})), "mission-has-sends");
  await h.app.repositories.patch(await fresh(h, f), r.id, { removeMissions: ["dropyour"], knowingSendsStay: true }, {});
  const entries = await h.store.tx(f.tenant, (tx) => tx.ledgerAll());
  assert.ok(entries.some((e) => e.body.what === "send-pending"));
});
