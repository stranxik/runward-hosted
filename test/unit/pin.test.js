// The pin of runward-fleet, attacked (the adversarial review of 3afe41d, findings C40 to C44):
//   C40  scripts/verify-runward-fleet.mjs refuses a tarball npm would install as other files;
//   C41  scripts/replay-export.mjs takes an index out of the comparison only on a label the lock and the
//        journal both know, and scripts/witness-reader.mjs counts what was not rebuilt;
//   C42  fleetPin refuses an install that is not the pinned archive;
//   C44  the exit codes of the replay CLI and the rule of the witness reader.
// Nothing here reads the network: the commit is stood for by the genuine tarball's own files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { harness, founder, pinnedRepository, send, gesture, sha, FIXTURE_CHECK, LOCK } from "../helpers.js";
import { verify, packageFiles, packList, tarEntries } from "../../scripts/verify-runward-fleet.mjs";
import { replay, replayPin, lockArchives, countsLine, exitCode } from "../../scripts/replay-export.mjs";
import { judge } from "../../scripts/witness-reader.mjs";
import { fleetPin } from "../../src/adapters/fleet/assembler.js";
import { tar, untar } from "../../src/adapters/archive/tar.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const lock = JSON.parse(readFileSync(LOCK, "utf8"));
const TGZ = readFileSync(join(ROOT, lock.tarball));
const PACKAGE_LOCK = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const GENUINE = packageFiles(TGZ).files;

// ------------------------------------------------------------------ C40: the tarball

/** A tar entry of any type (the Archive port writes regular files only). */
function entry(name, bytes = Buffer.alloc(0), { type = "0", linkname = "" } = {}) {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, "utf8");
  h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124); h.write("00000000000\0", 136);
  h.write("        ", 148); h.write(type, 156); h.write(linkname, 157, "utf8"); h.write("ustar\0", 257); h.write("00", 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return Buffer.concat([h, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512, 0)]);
}
const pack = (entries) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024, 0)]));
const genuineEntries = (keep = () => true) => [...GENUINE].filter(([f]) => keep(f)).map(([f, b]) => entry(`package/${f}`, b));
/** A lock that pins `tgz` as an attacker who controls the lock would: its digests, and its files if `files` is given. */
const lockFor = (tgz, files = null) => ({ ...lock, tarballSha256: sha(tgz), integrity: `sha512-${createHash("sha512").update(tgz).digest("base64")}`, ...(files ? { files } : {}) });
const packageLockFor = (l) => ({ packages: { "node_modules/runward-fleet": { integrity: l.integrity } } });
const digests = (files) => Object.fromEntries([...files].map(([f, b]) => [f, sha(b)]));
/** The commit, stood for by the genuine tarball: its files, and a tree with a file npm does not pack. */
const COMMIT = {
  file: async (rel) => GENUINE.get(rel) ?? null,
  tree: async () => [...[...GENUINE.keys()].map((path) => ({ path, mode: "100644" })), { path: "test/build.test.js", mode: "100644" }],
};
const run = (tgz, l, { offline = false, remote = COMMIT } = {}) => verify({ lock: l, tgz, packageLock: packageLockFor(l), offline, remote });

test("C40: the vendored tarball passes both modes, and the offline mode says what it did not compare", async () => {
  const off = await verify({ lock, tgz: TGZ, packageLock: PACKAGE_LOCK, offline: true });
  assert.equal(off.exit, 0, off.message);
  assert.match(off.message, /offline: the files are NOT compared with the commit/);
  const on = await verify({ lock, tgz: TGZ, packageLock: PACKAGE_LOCK, remote: COMMIT });
  assert.equal(on.exit, 0, on.message);
  assert.match(on.message, /the 22 files .* are the files npm packs .* and nothing else is in it/);
  assert.equal(Object.keys(lock.files).length, 22);
  assert.equal(tarEntries(gunzipSync(TGZ)).every((e) => e.type === "0" && e.name.startsWith("package/")), true);
});

test("C40: the review's tarball (a second root over src/build.js, LICENSE missing, the lock set to its digests) is refused in both modes", async () => {
  const planted = pack([...genuineEntries((f) => f !== "LICENSE"), entry("zz/src/build.js", Buffer.from("export const planted = true;\n"))]);
  // the control: this is the archive the check of 3afe41d passed. Its package/ tree is genuine, 21 files.
  const names = tarEntries(gunzipSync(planted)).map((e) => e.name);
  assert.equal(names.filter((n) => n.startsWith("package/")).length, 21);
  assert.ok(names.includes("zz/src/build.js"));
  const withoutLicense = digests([...GENUINE].filter(([f]) => f !== "LICENSE"));
  for (const files of [lock.files, withoutLicense]) {
    for (const offline of [true, false]) {
      const r = await run(planted, lockFor(planted, files), { offline });
      assert.equal(r.exit, 1, `${offline ? "offline" : "online"}: ${r.message}`);
      assert.match(r.message, /zz\/src\/build\.js is outside package\/: npm would install it as src\/build\.js/);
    }
  }
});

test("C40: a file of the package missing from the tarball, or a file added to it, is refused; offline only as far as the lock is honest", async () => {
  const short = pack(genuineEntries((f) => f !== "LICENSE"));
  const honest = await run(short, lockFor(short), { offline: true });
  assert.equal(honest.exit, 1);
  assert.match(honest.message, /in the lock only: LICENSE/);
  // the lock changed with the tarball: the offline mode cannot tell, and says so in its header; online refuses
  const shortFiles = digests([...GENUINE].filter(([f]) => f !== "LICENSE"));
  assert.equal((await run(short, lockFor(short, shortFiles), { offline: true })).exit, 0, "the limit of --offline, said in the script's header");
  const online = await run(short, lockFor(short, shortFiles));
  assert.equal(online.exit, 1);
  assert.match(online.message, /packed there and missing here: LICENSE/);

  const more = pack([...genuineEntries(), entry("package/src/planted.js", Buffer.from("export {};\n"))]);
  const moreFiles = { ...lock.files, "src/planted.js": sha(Buffer.from("export {};\n")) };
  assert.match((await run(more, lockFor(more), { offline: true })).message, /in the tarball only: src\/planted\.js/);
  const r = await run(more, lockFor(more, moreFiles));
  assert.equal(r.exit, 1);
  assert.match(r.message, /here and not packed there: src\/planted\.js/);

  const changed = pack([...genuineEntries((f) => f !== "src/build.js"), entry("package/src/build.js", Buffer.from("export const planted = true;\n"))]);
  assert.match((await run(changed, lockFor(changed), { offline: true })).message, /src\/build\.js in the tarball is not the file the lock pins/);
  const changedFiles = { ...lock.files, "src/build.js": sha(Buffer.from("export const planted = true;\n")) };
  const c = await run(changed, lockFor(changed, changedFiles));
  assert.equal(c.exit, 1);
  assert.match(c.message, /src\/build\.js in the tarball is not the file at/);
});

test("C40: a link, a duplicate name, a directory, an extended header and a name that climbs are each refused", async () => {
  const cases = [
    [entry("package/src/link.js", Buffer.alloc(0), { type: "2", linkname: "../../../etc/passwd" }), /package\/src\/link\.js is not a regular file \(symbolic link to \.\.\/\.\.\/\.\.\/etc\/passwd\)/],
    [entry("package/src/hard.js", Buffer.alloc(0), { type: "1", linkname: "package/src/build.js" }), /package\/src\/hard\.js is not a regular file \(hard link to package\/src\/build\.js\)/],
    [entry("package/src/build.js", Buffer.from("export const planted = true;\n")), /package\/src\/build\.js is in the archive twice/],
    [entry("package/SRC/build.js", Buffer.from("export const planted = true;\n")), /package\/SRC\/build\.js is in the archive twice/],
    [entry("package/src/", Buffer.alloc(0), { type: "5" }), /package\/src\/ is not a regular file \(directory\)/],
    [entry("PaxHeader/build.js", Buffer.from("30 path=package/src/build.js\n"), { type: "x" }), /PaxHeader\/build\.js is not a regular file \(extended header\)/],
    [entry("package/../src/build.js", Buffer.from("x")), /is not a plain relative name/],
    [entry("package", Buffer.from("x")), /is outside package\//],
  ];
  for (const [e, why] of cases) {
    const tgz = pack([...genuineEntries(), e]);
    for (const offline of [true, false]) {
      const r = await run(tgz, lockFor(tgz), { offline });
      assert.equal(r.exit, 1, r.message);
      assert.match(r.message, why);
    }
  }
  const after = gzipSync(Buffer.concat([...genuineEntries(), Buffer.alloc(1024, 0), entry("src/build.js", Buffer.from("x"))]));
  assert.match((await run(after, lockFor(after), { offline: true })).message, /data after the end of the archive/);
});

test("C40: what the check cannot read at the commit is a cannot-tell, never a pass", async () => {
  assert.equal((await run(TGZ, lock, { remote: { ...COMMIT, tree: async () => null } })).exit, 2);
  assert.equal((await run(TGZ, lock, { remote: { ...COMMIT, file: async () => null } })).exit, 2);
  assert.equal((await run(TGZ, lock, { remote: { ...COMMIT, file: async (rel) => (rel === "ui/views.js" ? null : GENUINE.get(rel)) } })).exit, 2);
  const pkg = JSON.parse(GENUINE.get("package.json").toString("utf8"));
  const tree = await COMMIT.tree();
  assert.deepEqual(packList(pkg, tree).names, [...GENUINE.keys()].sort(), "the pack list of the commit is the tarball's 22 names; test/ is not packed");
  assert.match(packList({ ...pkg, files: ["src/*.js"] }, tree).cannotTell, /a pattern this check does not read/);
  assert.match(packList({ ...pkg, files: undefined }, tree).cannotTell, /no "files"/);
  assert.match(packList(pkg, [...tree, { path: "src/.npmignore", mode: "100644" }]).cannotTell, /changes what npm packs/);
  assert.match(packList(pkg, [...tree, { path: "src/link.js", mode: "120000" }]).cannotTell, /not a regular file/);
  assert.match(packList(pkg, [...tree, { path: "src/.DS_Store", mode: "100644" }]).cannotTell, /npm leaves out of a pack/);
});

// ------------------------------------------------------------------ C42: what is installed

/** A copy of the installed package and of npm's record of it, in a throwaway node_modules. */
function installCopy() {
  const dir = mkdtempSync(join(tmpdir(), "rw-pin-"));
  const pkgDir = join(dir, "node_modules", "runward-fleet");
  mkdirSync(dirname(pkgDir), { recursive: true });
  cpSync(join(ROOT, "node_modules", "runward-fleet"), pkgDir, { recursive: true });
  const record = join(dir, "node_modules", ".package-lock.json");
  writeFileSync(record, JSON.stringify({ packages: { "node_modules/runward-fleet": { version: lock.version, integrity: lock.integrity } } }));
  return { dir, pkgDir, record };
}
const refused = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

test("C42: fleetPin gives the archive digest only when the install is the pinned archive: npm's integrity and every file", () => {
  const live = fleetPin({ lockFile: LOCK });
  assert.equal(live.archiveSha256, lock.tarballSha256);
  assert.equal(JSON.parse(readFileSync(join(ROOT, "node_modules", ".package-lock.json"), "utf8")).packages["node_modules/runward-fleet"].integrity, lock.integrity, "npm recorded the lock's integrity for what the tests run on");
  const c = installCopy();
  try {
    const pin = () => fleetPin({ lockFile: LOCK, pkgDir: c.pkgDir });
    assert.equal(pin().archiveSha256, lock.tarballSha256, "the control: the copy is accepted before it is changed");

    // the review's K7: another archive's files under the same version, npm's record untouched
    const build = join(c.pkgDir, "src", "build.js");
    const genuine = readFileSync(build);
    writeFileSync(build, Buffer.concat([genuine, Buffer.from("// another archive\n")]));
    assert.match(refused(pin), /is not the pinned archive fff950650d3a: changed: src\/build\.js\. Nothing is served or published with it; install again with npm ci/);
    writeFileSync(build, genuine);
    assert.equal(refused(pin), null);

    writeFileSync(join(c.pkgDir, "src", "planted.js"), "export {};\n");
    assert.match(refused(pin), /not of the archive: src\/planted\.js/);
    rmSync(join(c.pkgDir, "src", "planted.js"));
    rmSync(join(c.pkgDir, "LICENSE"));
    assert.match(refused(pin), /missing: LICENSE/);
    writeFileSync(join(c.pkgDir, "LICENSE"), GENUINE.get("LICENSE"));
    symlinkSync(build, join(c.pkgDir, "src", "link.js"));
    assert.match(refused(pin), /src\/link\.js is neither a file nor a directory/);
    rmSync(join(c.pkgDir, "src", "link.js"));
    assert.equal(refused(pin), null);

    // npm installed another archive: its record names another integrity
    writeFileSync(c.record, JSON.stringify({ packages: { "node_modules/runward-fleet": { version: lock.version, integrity: "sha512-AAAA" } } }));
    assert.match(refused(pin), /npm installed an archive of integrity sha512-AAAA, the lock pins sha512-/);
    writeFileSync(c.record, JSON.stringify({ packages: {} }));
    assert.match(refused(pin), /npm recorded no integrity for it/);
    rmSync(c.record);
    assert.match(refused(pin), /npm recorded no integrity for it/);

    // a lock without its file list proves nothing about the install
    const bare = join(c.dir, "lock.json");
    writeFileSync(c.record, JSON.stringify({ packages: { "node_modules/runward-fleet": { integrity: lock.integrity } } }));
    writeFileSync(bare, JSON.stringify({ ...lock, files: undefined }));
    assert.match(refused(() => fleetPin({ lockFile: bare, pkgDir: c.pkgDir })), /the lock pins no "files"/);
  } finally { rmSync(c.dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ C41, C43, C44: the replay

const PIN = replayPin();
const PREVIOUS = lock.previous.tarballSha256;
const CLEAN = Buffer.from(FIXTURE_CHECK.toString("utf8").replace('"gaps"', '"clean"'));

/**
 * A fleet with three published indexes, and its export. `play[n]` says how publication n happens:
 * `archive`, the digest the service records for it (on the index and in the journal, as a service that
 * ran another pin would); `changed`, the published bytes are not those the pinned archive builds.
 */
async function fleet(play = {}) {
  const h = harness();
  const f = await founder(h);
  const assemble = h.assembler.assemble;
  const pinned = h.assembler.pin.archiveSha256;
  const steps = [
    () => pinnedRepository(h, f),
    () => send(h, { run_number: "2", run_id: "40000000102" }, { bytes: CLEAN }),
    () => send(h, { run_number: "3", run_id: "40000000103" }),
  ];
  for (const [i, step] of steps.entries()) {
    const how = play[i + 1] ?? {};
    if ("archive" in how) h.assembler.pin.archiveSha256 = how.archive;
    if (how.changed) h.assembler.assemble = (input) => { const r = assemble(input); const bytes = Buffer.concat([r.bytes, Buffer.from("\n")]); return { ...r, bytes, sha256: sha(bytes) }; };
    await step();
    h.assembler.pin.archiveSha256 = pinned;
    h.assembler.assemble = assemble;
  }
  await gesture(h, f.session, "export", "");
  const a = await h.app.reading.prepareExport(await h.app.identity.sessionFrom(f.token), {});
  const plan = JSON.parse(untar(a.bytes).find((x) => x.name === "replay.json").bytes.toString("utf8"));
  assert.deepEqual(plan.versions.map((v) => v.version), [1, 2, 3], "three publications, three indexes");
  return { bytes: a.bytes, plan, served: plan.versions[2].indexSha256 };
}
/** The same archive with replay.json rewritten: what a service says of its indexes, its journal left as it is. */
const relabel = (bytes, change) => tar(untar(bytes).map((x) => {
  if (x.name !== "replay.json") return x;
  const plan = JSON.parse(x.bytes.toString("utf8"));
  return { name: x.name, bytes: Buffer.from(JSON.stringify({ ...plan, versions: plan.versions.map((v) => change(v) ?? v) })) };
}));
const states = (r) => r.results.map((x) => x.state);
const read = (bytes) => replay(bytes, PIN.version, PIN.archives);

test("C41: the lock's archives are the pinned one and its previous chain, and nothing else", () => {
  const a = lockArchives({ tarballSha256: "c", commit: "3", previous: { tarballSha256: "b", commit: "2", previous: { tarballSha256: "a", commit: "1" } } });
  assert.equal(a.archiveSha256, "c");
  assert.deepEqual([...a.known], [["c", "3"], ["b", "2"], ["a", "1"]]);
  assert.deepEqual([...PIN.archives.known.keys()], [lock.tarballSha256, PREVIOUS]);
  assert.equal(PIN.version, lock.version);
});

test("C41: the review's table. An index whose bytes changed is judged, or the fleet is not passed, whatever its entry says", async () => {
  const changed = await fleet({ 1: { changed: true } });
  const first = (change) => relabel(changed.bytes, (v) => (v.version === 1 ? change(v) : null));
  const without = ({ runwardFleetArchiveSha256: _, ...v }) => v;
  const table = [
    ["the pinned archive", changed.bytes, ["different", "same", "same"], "different", 1, null],
    ["the previous archive, in replay.json only", first((v) => ({ ...v, runwardFleetArchiveSha256: PREVIOUS })), ["label-refused", "same", "same"], "cannot-tell", 2, /the journal names another archive for this index/],
    ["no archive", first(without), ["label-refused", "same", "same"], "cannot-tell", 2, /the entry names no archive/],
    ["an empty archive", first((v) => ({ ...v, runwardFleetArchiveSha256: "" })), ["label-refused", "same", "same"], "cannot-tell", 2, /the entry names no archive/],
    ["the archive x", first((v) => ({ ...v, runwardFleetArchiveSha256: "x" })), ["label-refused", "same", "same"], "cannot-tell", 2, /an archive the lock does not know/],
    ["the version 0.45.0", first((v) => ({ ...v, runwardFleet: "0.45.0" })), ["label-refused", "same", "same"], "cannot-tell", 2, /the journal names another version for this index/],
    ["not replayable, its bytes being there", first((v) => ({ ...v, replayable: false, why: "bytes missing" })), ["different", "same", "same"], "different", 1, null],
    ["another index digest", first((v) => ({ ...v, indexSha256: changed.plan.versions[1].indexSha256 })), ["label-refused", "same", "same"], "cannot-tell", 2, /the journal names another index for this version/],
  ];
  for (const [label, bytes, want, verdict, exit, why] of table) {
    const r = read(bytes);
    assert.deepEqual(states(r), want, label);
    assert.equal(r.verdict, verdict, label);
    assert.equal(r.ok, false, label);
    assert.equal(exitCode(r), exit, label);
    if (why) assert.match(r.why.join("; "), why, label);
    const j = judge({ archive: bytes, served: changed.served, pin: PIN });
    assert.equal(j.ok, false, `the witness reader is red: ${label}`);
    assert.match(j.words, /^replay same 2, different [01], not rebuilt here [01].*; RED: /, label);
  }
  // the control: the same relabelling passed at 3afe41d, where any other digest took the index out
  const before = replay(first((v) => ({ ...v, runwardFleetArchiveSha256: "x" })), PIN.version, null);
  assert.deepEqual(states(before), ["different", "same", "same"], "and without the lock's archives every index is rebuilt, as before ADR-0021");
});

test("C41: an index the previous archive built, the journal agreeing, is named and counted; a re-pin does not make a fleet red", async () => {
  const repinned = await fleet({ 1: { archive: PREVIOUS } });
  assert.equal(repinned.plan.versions[0].runwardFleetArchiveSha256, PREVIOUS);
  const r = read(repinned.bytes);
  assert.deepEqual(states(r), ["other-archive", "same", "same"]);
  assert.equal(r.results[0].commit, lock.previous.commit, "the commit that archive is packed at, from the lock");
  assert.deepEqual(r.counts, { same: 2, different: 0, notRebuilt: 1 });
  assert.equal(r.verdict, "same");
  assert.equal(exitCode(r), 0);
  assert.equal(r.journalChainOk, true);
  const j = judge({ archive: repinned.bytes, served: repinned.served, pin: PIN });
  assert.equal(j.ok, true);
  assert.equal(j.words, "replay same 2, different 0, not rebuilt here 1 (1 built by another archive); holds");
  // the limit the script's header says: the service's own journal agreeing, an older changed index is not judged here
  const limit = await fleet({ 1: { archive: PREVIOUS, changed: true } });
  assert.deepEqual(states(read(limit.bytes)), ["other-archive", "same", "same"]);
  // without a journal that verifies, the label alone takes nothing out
  const cut = tar(untar(repinned.bytes).filter((x) => x.name !== "journal.jsonl"));
  assert.deepEqual(states(read(cut)), ["label-refused", "same", "same"]);
  assert.match(read(cut).why.join("; "), /no verified journal confirms the archive the entry names/);
  const broken = tar(untar(repinned.bytes).map((x) => (x.name !== "journal.jsonl" ? x : { name: x.name, bytes: Buffer.from(x.bytes.toString("utf8").replace(PREVIOUS, lock.tarballSha256)) })));
  assert.equal(read(broken).journalChainOk, false, "a journal rewritten without its hashes does not verify");
  assert.deepEqual(states(read(broken)), ["label-refused", "same", "same"]);
});

test("C43: an index of another archive after one rebuilt here is red, with its cause: a rollback to an earlier pin", async () => {
  const rolled = await fleet({ 3: { archive: PREVIOUS } });
  const r = read(rolled.bytes);
  assert.deepEqual(states(r), ["same", "same", "other-archive"]);
  assert.equal(r.verdict, "cannot-tell");
  assert.equal(exitCode(r), 2);
  assert.match(r.why.join("; "), /version 3 was built by another archive after version 1 was built by the pinned one: a rollback to an earlier pin, or a label that lies/);
  const j = judge({ archive: rolled.bytes, served: rolled.served, pin: PIN });
  assert.equal(j.ok, false);
  assert.match(j.words, /^replay same 2, different 0, not rebuilt here 1 \(1 built by another archive\); RED: version 3 was built by another archive/);
  assert.equal(/DIFFERENT/.test(j.words), false, "a fleet nothing differs in is never said different");
});

test("C43, C44: the witness reader's words are same, different and not rebuilt here, with counts; it passes the lock's archives to the replay", async () => {
  const genuine = await fleet();
  const g = judge({ archive: genuine.bytes, served: genuine.served, pin: PIN });
  assert.equal(g.ok, true);
  assert.equal(g.words, "replay same 3, different 0, not rebuilt here 0; holds");
  assert.equal(countsLine(g.replay), "same 3, different 0, not rebuilt here 0");
  const notServed = judge({ archive: genuine.bytes, served: genuine.plan.versions[1].indexSha256, pin: PIN });
  assert.equal(notServed.ok, false);
  assert.match(notServed.words, /RED: the served index is not the last one rebuilt here$/);
  assert.equal(judge({ archive: genuine.bytes, served: null, pin: PIN }).ok, false);

  // every index built by the previous archive: these bytes WOULD rebuild the same here (only the recorded
  // archive differs), so a reader that did not pass the lock's archives would say same 3 and pass (K5)
  const allOld = await fleet({ 1: { archive: PREVIOUS }, 2: { archive: PREVIOUS }, 3: { archive: PREVIOUS } });
  assert.deepEqual(states(replay(allOld.bytes, PIN.version, null)), ["same", "same", "same"], "the control: without the archives, all three rebuild");
  const o = judge({ archive: allOld.bytes, served: allOld.served, pin: PIN });
  assert.deepEqual(states(o.replay), ["other-archive", "other-archive", "other-archive"]);
  assert.equal(o.ok, false, "nothing rebuilt is never a pass");
  assert.equal(o.words, "replay same 0, different 0, not rebuilt here 3 (3 built by another archive); RED: nothing was rebuilt here; the served index is not the last one rebuilt here");

  const gone = untar(genuine.bytes).find((x) => x.name.startsWith("exports/")).name;
  const erased = tar(untar(genuine.bytes).filter((x) => x.name !== gone));
  const e = read(erased);
  assert.ok(states(e).includes("not-replayable"), "an index whose export is not in the archive is not rebuilt, and counted");
  assert.equal(e.counts.notRebuilt, states(e).filter((s) => s === "not-replayable").length);
});

test("C44: the replay CLI exits 0 when every index rebuilt here is the same, 1 on a difference, 2 when it cannot tell", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-replay-"));
  try {
    const cli = (name, bytes, ...flags) => {
      const file = join(dir, name);
      writeFileSync(file, bytes);
      return spawnSync(process.execPath, [join(ROOT, "scripts/replay-export.mjs"), file, ...flags], { encoding: "utf8" });
    };
    const genuine = await fleet();
    const same = cli("same.tar", genuine.bytes);
    assert.equal(same.status, 0, same.stderr);
    assert.match(same.stdout, /replay: same 3, different 0, not rebuilt here 0; same\n$/);
    const different = cli("different.tar", (await fleet({ 2: { changed: true } })).bytes);
    assert.equal(different.status, 1, different.stderr);
    assert.match(different.stdout, /version 2: different /);
    const allOld = cli("all-old.tar", (await fleet({ 1: { archive: PREVIOUS }, 2: { archive: PREVIOUS }, 3: { archive: PREVIOUS } })).bytes);
    assert.equal(allOld.status, 2, "nothing rebuilt here: cannot tell, never a mismatch and never a pass");
    assert.match(allOld.stdout, /version 1: other-archive \(built by the runward-fleet archive 99e941a5ea91, packed at 5a9cdf08a769, not the one pinned here\)/);
    assert.match(allOld.stdout, /replay: same 0, different 0, not rebuilt here 3 \(3 built by another archive\); cannot tell: nothing was rebuilt here\n$/);
    const unknown = cli("unknown.tar", relabel(genuine.bytes, (v) => (v.version === 1 ? { ...v, runwardFleetArchiveSha256: "x" } : null)));
    assert.equal(unknown.status, 2);
    assert.match(unknown.stdout, /version 1: label-refused \(the entry names an archive the lock does not know\)/);
    const json = cli("json.tar", genuine.bytes, "--json");
    assert.equal(JSON.parse(json.stdout).verdict, "same");
    assert.equal(cli("empty.tar", tar([])).status, 2);
    assert.equal(spawnSync(process.execPath, [join(ROOT, "scripts/replay-export.mjs")], { encoding: "utf8" }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
