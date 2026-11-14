// The witness reader's first run in production (temoin.yml, run 43611694113, 2026-11-14): the export of a
// fleet whose mission is `runward-demo-renaming` answered 503, `tar: name too long` (its path,
// exports/runward-demo-renaming/check-<sha256>.json, is 105 bytes; ustar's name field holds 100), and the
// reader read the error's bytes as an archive without replay.json. Here: every legal export path fits the
// archive (ustar prefix), the reader and the member export such a fleet and the replay holds, and a refused
// export is said with its status.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, founder, pinnedRepository, send, gesture, claimsFor, token, ORIGIN } from "../helpers.js";
import { judge } from "../../scripts/witness-reader.mjs";
import { replayPin } from "../../scripts/replay-export.mjs";
import { tar, untar } from "../../src/adapters/archive/tar.js";
import { exportPath } from "../../src/adapters/fleet/assembler.js";
import { UPLOAD_KINDS } from "../../src/domain/workload.js";

const HEX = "c".repeat(64);
const longestKind = UPLOAD_KINDS.reduce((a, b) => (b.length > a.length ? b : a));

test("every export path a mission may have fits the archive, and reads back by its full name", () => {
  const paths = [exportPath("runward-demo-renaming", "check", HEX), exportPath(`m${"x".repeat(62)}`, longestKind, HEX), "versions/12/fleet.json"];
  assert.ok(Buffer.byteLength(paths[0]) > 100 && Buffer.byteLength(paths[1]) > 100, "the paths are past ustar's 100-byte name field");
  const files = paths.map((name, i) => ({ name, bytes: Buffer.from(`file ${i}\n`) }));
  assert.deepEqual(untar(tar(files)), files);
  // positive control: the system's tar lists the same names (a real ustar prefix, not a private convention)
  const dir = mkdtempSync(join(tmpdir(), "rw-tar-"));
  try {
    writeFileSync(join(dir, "a.tar"), tar(files));
    const r = spawnSync("tar", ["-tf", join(dir, "a.tar")], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split("\n"), paths);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a name of at most 100 bytes is written as before: the same content gives the same bytes", () => {
  const a = tar([{ name: "replay.json", bytes: Buffer.from("{}\n") }]);
  assert.ok(a.subarray(345, 500).every((x) => x === 0), "no prefix for a short name");
  assert.throws(() => tar([{ name: `${"d".repeat(160)}/x`, bytes: Buffer.alloc(0) }]), /name too long/, "a path that fits neither field is still refused");
});

test("the reader and the member export a fleet whose mission path is past 100 bytes, and the replay holds", async () => {
  const h = harness();
  const f = await founder(h);
  const mission = "runward-demo-renaming";
  await pinnedRepository(h, f, { name: "stranxik/runward-demo-renaming", mission });
  await send(h, { repository: "stranxik/runward-demo-renaming", run_number: "2", run_id: "39000000002" }, { mission });
  await gesture(h, f.session, "reader-authorize", "");
  await h.app.repositories.reader(await h.app.identity.sessionFrom(f.token), true, { requestId: "r" });
  const bearer = () => `Bearer ${token(claimsFor(h.clock, { aud: `${ORIGIN}/read`, repository: "stranxik/runward-hosted", workflow_ref: "stranxik/runward-hosted/.github/workflows/temoin.yml@refs/heads/main", job_workflow_ref: "stranxik/runward-hosted/.github/workflows/temoin.yml@refs/heads/main" }))}`;
  const idx = await h.app.reader.readIndex({ authorization: bearer(), fleet: f.tenant, requestId: "r1" });
  const ex = await h.app.reader.readExport({ authorization: bearer(), fleet: f.tenant, requestId: "r2" });
  assert.ok(untar(ex.bytes).some((x) => x.name.startsWith(`exports/${mission}/check-`) && Buffer.byteLength(x.name) > 100), "the long path is in the archive");
  const j = judge({ archive: ex.bytes, served: idx.index.sha256, pin: replayPin() });
  assert.equal(j.ok, true, j.words);
  assert.equal(j.replay.verdict, "same");
  const s = await h.app.identity.sessionFrom(f.token);
  await gesture(h, s, "export", "");
  const mine = await h.app.reading.prepareExport(await h.app.identity.sessionFrom(f.token), { requestId: "r3" });
  assert.ok(untar(mine.bytes).some((x) => x.name.startsWith(`exports/${mission}/`)), "the member's own export holds it too");
});

test("an export the service refused is said with its status, never as an archive without replay.json", () => {
  const answered = "the export answered HTTP 503 service-unavailable, request r-000000000000";
  const j = judge({ archive: Buffer.from('{"refusal":"service-unavailable"}'), served: "a".repeat(64), pin: replayPin(), answered });
  assert.equal(j.ok, false);
  assert.equal(j.replay.verdict, "cannot-tell");
  assert.deepEqual(j.why, [answered, "the served index is not the last one rebuilt here"]);
});
