// Erasure reaches the published versions of the index (ADR-0009; design decision D5 of 2026-11-10, lot
// E1; db/migrations/0006). A version's bytes are the projection of the uploads it was built from: an
// erasure that removes the uploads and leaves the earlier versions whole leaves the content in the
// database, and the export archive packs it again. Each test looks for the content itself (a marker the
// index projects), everywhere the service keeps bytes, and each zero has its control: the same search
// finds the content before the erasure, and finds it after an erasure that does not reach the versions
// (the planted control, the code of before 0006). The same scenario runs on a real PostgreSQL, under
// rw_app and rw_maint, in test/pg/erasure.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, founder, pinnedRepository, send, gesture, sha, markedCheck, contentLeft, withoutIndexErasure, erasureScenario, GONE, KEEP, BRAVO } from "../helpers.js";
import { replay } from "../../scripts/replay-export.mjs";
import { untar } from "../../src/adapters/archive/tar.js";
import { verifyChain } from "../../src/domain/ledger.js";
import { DAY } from "../../src/domain/identity.js";
import { ulid } from "../../src/adapters/system/ulid.js";

const refusal = async (p) => { try { await p; return null; } catch (e) { return e.code ?? e.message; } };
const rows = (h, tenant, table) => h.store.tx(tenant, (tx) => tx.list(table));
const session = (h, f) => h.app.identity.sessionFrom(f.token);

async function exported(h, f) {
  await gesture(h, f.session, "export", "");
  return h.app.reading.prepareExport(await session(h, f), {});
}
async function erase(h, f, repository) {
  await gesture(h, f.session, "content-erase", repository);
  return h.app.repositories.eraseContent(await session(h, f), repository, {});
}
const accepted = async (h, claims, opts) => assert.equal((await send(h, claims, opts)).status, 201);
async function twoTenants(h) {
  const A = await founder(h, { prefix: "a" }), B = await founder(h, { prefix: "b" });
  return { A, B, ...(await erasureScenario(h, A, B)) };
}
const shape = (versions) => versions.map((v) => ({ version: v.version, bytes: v.bytes.length > 0, erased: v.erasedAt != null }));

test("erasing a repository's content empties every version of the index built from it: no byte is left in a version, an object or an archive, and the digests stay", async () => {
  const h = harness();
  const { A, gone } = await twoTenants(h);
  const before = await rows(h, A.tenant, "fleet_index");
  assert.deepEqual(before.map((v) => v.version), [1, 2, 3, 4, 5], "five versions, the last three built from an upload of the repository");
  const old = await exported(h, A);
  // the control of the search: before the erasure it finds the content, in the versions, the objects and the archive
  const found = await contentLeft(h, A.tenant, GONE, old.bytes);
  for (const where of ["fleet_index version 4 bytes: GONE-RUN-1", "fleet_index version 5 bytes: GONE-RUN-2", "object sha256: GONE-RUN-1", "object sha256: GONE-RUN-2", "object archives: GONE-RUN-2", "archive versions/4/index.json: GONE-RUN-1", "archive versions/5/index.json: GONE-RUN-2"]) {
    assert.ok(found.includes(where), `the search must see the content before the erasure (${where}): ${JSON.stringify(found)}`);
  }

  const out = await erase(h, A, gone.id);
  const after = await rows(h, A.tenant, "fleet_index");
  assert.deepEqual(shape(after), [
    { version: 1, bytes: true, erased: false }, { version: 2, bytes: true, erased: false },
    { version: 3, bytes: false, erased: true }, { version: 4, bytes: false, erased: true }, { version: 5, bytes: false, erased: true },
    { version: 6, bytes: true, erased: false },
  ], "the versions built from the repository hold no byte; those that never carried it, and the one published after, are whole");
  for (const v of before) {
    const now = after.find((x) => x.version === v.version);
    assert.deepEqual({ sha256: now.sha256, manifestSha256: now.manifestSha256, seq: now.seq, publishedAt: now.publishedAt, manifest: sha(now.manifest) }, { sha256: v.sha256, manifestSha256: v.manifestSha256, seq: v.seq, publishedAt: v.publishedAt, manifest: sha(v.manifest) }, `version ${v.version} keeps its digests, its seq and its fleet.json`);
  }
  for (const v of after.filter((x) => !x.erasedAt)) assert.equal(sha(v.bytes), v.sha256, `version ${v.version}: the bytes kept are the bytes published`);

  const fresh = await exported(h, A);
  assert.deepEqual(await contentLeft(h, A.tenant, GONE, fresh.bytes), [], "no byte of the erased content is left: not in a version, not in an object, not in the journal, not in the archive");
  assert.equal(await refusal(h.app.reading.downloadExport(await session(h, A), old.id)), "not-found", "the archive prepared before the erasure went with it");
  const names = untar(fresh.bytes).map((f) => f.name);
  for (const n of [3, 4, 5]) {
    assert.equal(names.includes(`versions/${n}/index.json`), false, `the archive does not bring version ${n}'s index back`);
    assert.ok(names.includes(`versions/${n}/fleet.json`), `version ${n} keeps its fleet.json`);
  }
  for (const n of [1, 2, 6]) assert.ok(names.includes(`versions/${n}/index.json`));
  const plan = JSON.parse(untar(fresh.bytes).find((f) => f.name === "replay.json").bytes.toString("utf8"));
  assert.deepEqual(plan.versions.map((v) => [v.version, v.replayable, v.why ?? null, v.indexErased ?? false]), [
    [1, true, null, false], [2, true, null, false], [3, false, "content erased", true], [4, false, "content erased", true], [5, false, "content erased", true], [6, true, null, false],
  ], "replay.json says which index no longer replays, and that its bytes are erased");
  const r = replay(fresh.bytes, "0.46.0");
  assert.equal(r.ok, true, JSON.stringify(r.results));

  // the journal: the entry names the versions erased, and the chain holds
  const entries = await h.store.tx(A.tenant, (tx) => tx.ledgerAll());
  const entry = entries.find((e) => e.seq === out.entry.seq);
  assert.deepEqual([entry.body.what, entry.body.detail.indexVersions, entry.body.detail.indexVersion], ["content-erased", [3, 4, 5], 6]);
  assert.equal(verifyChain(entries).ok, true);

  // what is served: the index rebuilt without the repository's content, with the other repository's
  const served = await h.app.reading.index(A.tenant);
  assert.equal(served.version, 6);
  const idx = JSON.parse(served.bytes.toString("utf8"));
  assert.deepEqual(idx.missions.map((m) => [m.id, m.latest === "not-observed"]).sort(), [["org-gone", true], ["org-keep", false]]);
  // the other repository of the same tenant is whole: its content is still there, and still replays
  const kept = await contentLeft(h, A.tenant, KEEP, fresh.bytes);
  for (const where of ["fleet_index version 2 bytes: KEEP-RUN-1", "fleet_index version 6 bytes: KEEP-RUN-1", "object sha256: KEEP-RUN-1", "archive versions/6/index.json: KEEP-RUN-1"]) assert.ok(kept.includes(where), `${where}: ${JSON.stringify(kept)}`);
});

test("another tenant is untouched by an erasure: its versions, its bytes and its archive are what they were", async () => {
  const h = harness();
  const { A, B, gone } = await twoTenants(h);
  const state = async () => ({
    versions: (await rows(h, B.tenant, "fleet_index")).map((v) => ({ ...v, bytes: sha(v.bytes), manifest: sha(v.manifest) })),
    uploads: await rows(h, B.tenant, "upload"), blobs: await rows(h, B.tenant, "blob"),
    journal: (await h.store.tx(B.tenant, (tx) => tx.ledgerAll())).length,
    objects: [...h.objects._map].filter(([k]) => k.startsWith(`tenants/${B.tenant}/`)).map(([k, b]) => [k, sha(b)]).sort(),
  });
  const before = await state();
  assert.deepEqual(shape(await rows(h, B.tenant, "fleet_index")), [{ version: 1, bytes: true, erased: false }, { version: 2, bytes: true, erased: false }]);
  await erase(h, A, gone.id);
  assert.deepEqual(await state(), before, "nothing of the other tenant moved");
  const b = await exported(h, B);
  const left = await contentLeft(h, B.tenant, BRAVO, b.bytes);
  for (const where of ["fleet_index version 2 bytes: BRAVO-RUN-1", "object sha256: BRAVO-RUN-1", "archive versions/2/index.json: BRAVO-RUN-1"]) assert.ok(left.includes(where), `${where}: ${JSON.stringify(left)}`);
  assert.equal(replay(b.bytes, "0.46.0").ok, true);
  assert.deepEqual(await contentLeft(h, B.tenant, GONE), [], "and it never held the first tenant's content");
});

test("planted control: an erasure that does not reach the index versions (the code before 0006) leaves the content, and the search says where", async () => {
  const h = harness({ wrapStore: withoutIndexErasure });
  const { A, gone } = await twoTenants(h);
  await erase(h, A, gone.id);
  assert.deepEqual(shape(await rows(h, A.tenant, "fleet_index")).filter((v) => v.erased), [], "the planted erasure emptied no version");
  assert.deepEqual(await contentLeft(h, A.tenant, GONE), ["fleet_index version 4 bytes: GONE-RUN-1", "fleet_index version 5 bytes: GONE-RUN-2"], "the content is still in the versions built from it: the first test's zero would be refused");
});

test("the archive never waits for the pass: versions an earlier erasure left whole are not packed, and the retention job then empties them once", async () => {
  const plant = { on: true };
  const h = harness({ wrapStore: (s) => withoutIndexErasure(s, plant) });
  const { A, B, gone } = await twoTenants(h);
  await erase(h, A, gone.id);
  const stale = await exported(h, A);
  // the state an erasure of before 0006 left: the database still holds the content, and the archive does not bring it back
  assert.deepEqual(await contentLeft(h, A.tenant, GONE), ["fleet_index version 4 bytes: GONE-RUN-1", "fleet_index version 5 bytes: GONE-RUN-2"]);
  assert.deepEqual((await contentLeft(h, A.tenant, GONE, stale.bytes)).filter((w) => w.startsWith("archive ")), []);

  plant.on = false;
  const journal = async () => (await h.store.tx(A.tenant, (tx) => tx.ledgerAll()));
  const n = (await journal()).length;
  const first = await h.app.operator.retention();
  assert.deepEqual(first.map((r) => [r.tenant, r.indexVersions]), [[A.tenant, 3], [B.tenant, 0]], "the pass empties the three versions of the first tenant, none of the second");
  assert.deepEqual(await contentLeft(h, A.tenant, GONE), []);
  assert.deepEqual(shape(await rows(h, A.tenant, "fleet_index")).filter((v) => v.erased).map((v) => v.version), [3, 4, 5]);
  const entries = await journal();
  assert.equal(entries.length, n + 1, "one entry says it");
  const last = entries[entries.length - 1].body;
  assert.deepEqual([last.who.type, last.what, last.detail], ["operator", "content-erased", { digests: [], indexVersions: [3, 4, 5], reason: "retention" }]);
  assert.equal(verifyChain(entries).ok, true);
  assert.equal(await refusal(h.app.reading.downloadExport(await session(h, A), stale.id)), "not-found", "an archive prepared before the pass goes with the versions");
  const second = await h.app.operator.retention();
  assert.deepEqual(second.map((r) => r.indexVersions), [0, 0], "a second pass erases nothing");
  assert.equal((await journal()).length, n + 1, "and journals nothing more");
  assert.equal(shape(await rows(h, B.tenant, "fleet_index")).every((v) => v.bytes && !v.erased), true, "the other tenant's versions are whole");
});

test("30 days after a removal, the retention job erases the uploads' bytes and the versions built from them", async () => {
  const h = harness();
  const { A, B, gone } = await twoTenants(h);
  await gesture(h, A.session, null, null);
  await h.app.repositories.remove(await session(h, A), gone.id, {});
  h.clock.advance(29 * DAY);
  assert.deepEqual((await h.app.operator.retention()).map((r) => [r.erased, r.indexVersions]), [[0, 0], [0, 0]], "within the 30 days nothing is erased: the repository can still be restored");
  assert.equal((await contentLeft(h, A.tenant, GONE)).length > 0, true);
  h.clock.advance(2 * DAY);
  const report = await h.app.operator.retention();
  assert.deepEqual(report.map((r) => [r.tenant, r.erased, r.indexVersions]), [[A.tenant, 3, 3], [B.tenant, 0, 0]]);
  assert.deepEqual(await contentLeft(h, A.tenant, GONE), [], "no byte of the removed repository is left");
  assert.deepEqual(shape(await rows(h, A.tenant, "fleet_index")).filter((v) => v.erased).map((v) => v.version), [3, 4, 5], "the version published by the removal never carried it and is whole");
  const entries = await h.store.tx(A.tenant, (tx) => tx.ledgerAll());
  const last = entries[entries.length - 1].body;
  assert.deepEqual([last.what, last.detail.indexVersions, last.detail.reason], ["content-erased", [3, 4, 5], "retention"]);
  assert.equal((await h.app.reading.index(A.tenant)).version, 6, "the index served is the one the removal published");
  assert.equal((await contentLeft(h, B.tenant, BRAVO)).length > 0, true, "the other tenant keeps its content");
});

test("a restore gives the erased versions back; the replay empties them again, and nothing erased is served meanwhile", async () => {
  const h = harness();
  const f = await founder(h);
  const repo = await pinnedRepository(h, f, { name: "org-a/gone", mission: "gone", claims: { repository_id: "8102" } });
  await accepted(h, { repository: "org-a/gone", repository_id: "8102", run_number: "2", run_id: "42000000002" }, { mission: "gone", bytes: markedCheck(GONE[0]) });
  // T: the backup, then the erasure after it
  h.clock.advance(1000);
  const since = ulid(h.clock.now()).slice(0, 10) + "0".repeat(16);
  h.clock.advance(1000);
  const s = h.store._state;
  const backup = { rows: { ...s.rows }, ledger: s.ledger, operator: [...s.operator] };
  await erase(h, f, repo.id);
  assert.deepEqual(await contentLeft(h, f.tenant, GONE), []);
  h.clock.advance(1000);
  s.rows = { ...backup.rows }; s.ledger = backup.ledger; s.operator = [...backup.operator];
  // the control: the restored database holds the erased content again, in the version it serves
  assert.deepEqual(await contentLeft(h, f.tenant, GONE), ["fleet_index version 2 bytes: GONE-RUN-1"]);
  assert.equal((await h.app.reading.index(f.tenant)).version, 2);

  const [r] = await h.app.operator.restoreReplay({ since });
  assert.equal(r.replayed, 1);
  assert.deepEqual(await contentLeft(h, f.tenant, GONE), [], "the replayed erasure empties the versions again");
  assert.deepEqual(shape(await rows(h, f.tenant, "fleet_index")), [{ version: 1, bytes: false, erased: true }, { version: 2, bytes: false, erased: true }]);
  assert.equal(await h.app.reading.index(f.tenant), null, "the last version is erased and none was published since: no index is served, never an empty or an erased one");
  assert.equal((await h.app.reading.status({ tenantId: f.tenant })).index, null, "the replay closed every session: read as the witness reader does");
  // the service's next upload publishes a version again, numbered after the erased ones
  await accepted(h, { repository: "org-a/gone", repository_id: "8102", run_number: "3", run_id: "42000000003" }, { mission: "gone", bytes: markedCheck("AFTER-RUN-3") });
  const served = await h.app.reading.index(f.tenant);
  assert.equal(served.version, 3);
  assert.equal(served.bytes.includes("AFTER-RUN-3") && !served.bytes.includes(GONE[0]), true);
  // replayed a second time (the margin of the backup's instant), the erasure touches nothing
  await h.app.operator.restoreReplay({ since });
  assert.deepEqual(shape(await rows(h, f.tenant, "fleet_index")).map((v) => v.erased), [true, true, false]);
});

test("a published version is written once: the store refuses any change but the erasure of its bytes", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  const change = (patch) => refusal(h.store.tx(f.tenant, (tx) => tx.update("fleet_index", { version: 1 }, patch)));
  for (const patch of [{ sha256: "0".repeat(64) }, { bytes: Buffer.from("{}") }, { bytes: Buffer.from("{}"), erasedAt: h.clock.now() }, { bytes: Buffer.alloc(0) }, { erasedAt: h.clock.now() }, { seq: 1 }, { manifest: Buffer.from("{}") }]) {
    assert.match(String(await change(patch)), /written once/, JSON.stringify(Object.keys(patch)));
  }
  const at = h.clock.now();
  assert.equal(await change({ bytes: Buffer.alloc(0), erasedAt: at }), null, "the erasure itself is accepted");
  assert.match(String(await change({ bytes: Buffer.alloc(0), erasedAt: at + 1 })), /written once/, "an erasure is not moved or undone");
});
