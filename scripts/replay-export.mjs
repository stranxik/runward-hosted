#!/usr/bin/env node
// Replay an export (criterion S1 (b), PADR-0011 note 6 bis): for each published index in replay.json,
// rebuild it with runward-fleet from versions/<version>/fleet.json and exports/, exactly as
// `runward-fleet build fleet.json` would, and compare the sha256 of the bytes it writes.
// Usage: node scripts/replay-export.mjs <archive.tar> [--json]
//
// A version does not name one build (ADR-0021: 0.46.0 is three archives, whose indexes differ), so an index
// is rebuilt only by the archive that built it, named by the digest recorded on it. That digest is
// declared by the service whose export is replayed: it takes an index out of the comparison only when
//   - the lock knows it (vendor/runward-fleet.lock.json: the pinned archive and its `previous` chain), and
//   - the export's chained journal, verified here, names the same archive on the entry that published
//     that index (the entry at the index's seq carries indexVersion, indexSha256, fleetArchiveSha256).
// Each index gets one state:
//   same, different   rebuilt here by the pinned archive, and compared;
//   other-archive     built by an earlier archive of the lock, the journal agreeing: not rebuilt here, it
//                     replays with runward-fleet packed at the commit that digest names (ADR-0021);
//   not-replayable    its fleet.json or one of its exports is not in the archive (read from the archive,
//                     not from the entry's own `replayable`);
//   label-refused     no archive digest, a digest the lock does not know, a version that is not the pinned
//                     archive's, or a journal that names another archive or index, or none: never a pass.
// The verdict: `different` when a rebuilt index differs; `cannot-tell` when nothing was rebuilt, when a
// label is refused, or when an index of another archive is more recent than one rebuilt here (a rollback
// to an earlier pin, or a label that lies); `same` otherwise. Exit 0 same, 1 different, 2 cannot tell.
// The counts say how many indexes are same, different and not rebuilt here.
// Limit, said: a service that rewrites its whole journal and replay.json together can still present an
// OLDER changed index as another archive's; the last index cannot hide (the witness reader compares the
// served index with the last one rebuilt here), and the journal's head is what an outside anchor holds.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildIndex } from "runward-fleet";
import { untar } from "../src/adapters/archive/tar.js";
import { verifyChain } from "../src/domain/ledger.js";
import { fleetPin } from "../src/adapters/fleet/assembler.js";

export const LOCK_FILE = new URL("../vendor/runward-fleet.lock.json", import.meta.url).pathname;

/** The archives a lock knows: the pinned one, and every one of its `previous` chain, with its commit. */
export function lockArchives(lock) {
  const known = new Map();
  for (let p = lock; p && typeof p.tarballSha256 === "string"; p = p.previous) known.set(p.tarballSha256, p.commit ?? null);
  return { archiveSha256: lock.tarballSha256, known };
}

/**
 * What replays here: the installed runward-fleet, which fleetPin proves to be the pinned archive (it throws
 * otherwise), and the archives the lock knows.
 */
export function replayPin(lockFile = LOCK_FILE) {
  return { version: fleetPin({ lockFile }).version, archives: lockArchives(JSON.parse(readFileSync(lockFile, "utf8"))) };
}

const parse = (b) => { try { return JSON.parse(b.toString("utf8")); } catch { return null; } };

/**
 * `archives`: lockArchives(lock). Without it (null) every entry of the installed version is rebuilt, as
 * before ADR-0021: kept as the planted control of the tests, never used by the CLI or the witness reader.
 */
export function replay(archiveBytes, installedVersion, archives = null) {
  const files = new Map(untar(archiveBytes).map((f) => [f.name, f.bytes]));
  const plan = parse(files.get("replay.json") ?? Buffer.from("null"));
  if (!plan || plan.format !== "runward-hosted-replay/0" || !Array.isArray(plan.versions)) return { ok: false, verdict: "cannot-tell", cannotTell: "no replay.json", why: ["no replay.json"], results: [], counts: { same: 0, different: 0, notRebuilt: 0 } };
  const lines = (files.get("journal.jsonl")?.toString("utf8") ?? "").split("\n").filter(Boolean).map((l) => parse(Buffer.from(l)));
  const journalChainOk = lines.length > 0 && lines.every(Boolean) && verifyChain(lines).ok === true;
  const journal = new Map(journalChainOk ? lines.map((e) => [e.seq, e.body?.detail ?? {}]) : []);
  const results = [];
  for (const v of plan.versions) {
    const at = { version: v.version, seq: v.seq };
    const manifest = files.get(`versions/${v.version}/fleet.json`);
    const needs = manifest ? (parse(manifest)?.missions ?? []).flatMap((m) => Object.values(m.exports ?? {}).map((e) => e.file)) : [];
    if (!manifest || needs.some((f) => !files.has(f))) { results.push({ ...at, state: "not-replayable", why: v.why ?? (manifest ? "bytes missing" : "no fleet.json") }); continue; }
    if (archives === null) {
      if (v.runwardFleet !== installedVersion) { results.push({ ...at, state: "other-version", runwardFleet: v.runwardFleet }); continue; }
    } else {
      const label = v.runwardFleetArchiveSha256 ?? null;
      const said = journal.get(v.seq);
      const published = said && said.indexVersion === v.version ? said : null;
      const refused = (why) => results.push({ ...at, state: "label-refused", why, runwardFleet: v.runwardFleet ?? null, runwardFleetArchiveSha256: label });
      if (typeof label !== "string" || !label) { refused("the entry names no archive"); continue; }
      if (!archives.known.has(label)) { refused("the entry names an archive the lock does not know"); continue; }
      if (published && published.indexSha256 !== v.indexSha256) { refused("the journal names another index for this version"); continue; }
      if (published && published.fleetArchiveSha256 !== undefined && published.fleetArchiveSha256 !== label) { refused("the journal names another archive for this index"); continue; }
      if (published && published.fleetVersion !== undefined && published.fleetVersion !== v.runwardFleet) { refused("the journal names another version for this index"); continue; }
      if (label !== archives.archiveSha256) {
        if (!published || published.fleetArchiveSha256 !== label) { refused(journalChainOk ? "the journal does not confirm the archive the entry names" : "no verified journal confirms the archive the entry names"); continue; }
        results.push({ ...at, state: "other-archive", runwardFleet: v.runwardFleet, runwardFleetArchiveSha256: label, commit: archives.known.get(label) });
        continue;
      }
      if (v.runwardFleet !== installedVersion) { refused(`the entry names version ${v.runwardFleet}, the pinned archive is ${installedVersion}`); continue; }
    }
    const index = buildIndex({ manifest: { name: "fleet.json", bytes: manifest }, read: (p) => files.get(p) ?? null, version: installedVersion });
    const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
    const got = createHash("sha256").update(bytes).digest("hex");
    results.push({ ...at, state: got === v.indexSha256 ? "same" : "different", want: v.indexSha256, got });
  }
  const n = (s) => results.filter((r) => r.state === s).length;
  const counts = { same: n("same"), different: n("different"), notRebuilt: results.length - n("same") - n("different") };
  const firstSame = results.find((r) => r.state === "same");
  const why = [];
  if (counts.same === 0 && counts.different === 0) why.push("nothing was rebuilt here");
  for (const r of results.filter((x) => x.state === "label-refused")) why.push(`version ${r.version}: ${r.why}`);
  for (const r of results.filter((x) => x.state === "other-archive" && firstSame && x.version > firstSame.version)) why.push(`version ${r.version} was built by another archive after version ${firstSame.version} was built by the pinned one: a rollback to an earlier pin, or a label that lies`);
  const verdict = counts.different ? "different" : why.length || counts.same === 0 ? "cannot-tell" : "same";
  return { ok: verdict === "same", verdict, why, counts, results, chainOk: plan.chainOk, journalChainOk, head: plan.head };
}

/** same, different and not rebuilt here, with their counts and what the last ones are. */
export function countsLine(r) {
  const by = {};
  for (const x of r.results ?? []) if (x.state !== "same" && x.state !== "different") by[x.state] = (by[x.state] ?? 0) + 1;
  const words = { "other-archive": "built by another archive", "not-replayable": "not replayable", "label-refused": "label refused", "other-version": "another version" };
  const detail = Object.entries(by).map(([k, c]) => `${c} ${words[k] ?? k}`).join(", ");
  return `same ${r.counts.same}, different ${r.counts.different}, not rebuilt here ${r.counts.notRebuilt}${detail ? ` (${detail})` : ""}`;
}

export const exitCode = (r) => (r.verdict === "same" ? 0 : r.verdict === "different" ? 1 : 2);

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, flag] = process.argv.slice(2);
  if (!file) { console.error("usage: replay-export.mjs <archive.tar> [--json]"); process.exit(2); }
  let pin;
  try { pin = replayPin(); } catch (e) { console.error(`replay-export: cannot tell: ${e.message}`); process.exit(2); }
  const r = replay(readFileSync(file), pin.version, pin.archives);
  if (flag === "--json") console.log(JSON.stringify(r, null, 2));
  else {
    for (const x of r.results) console.log(`version ${x.version}: ${x.state}${x.got ? ` ${x.got.slice(0, 12)}` : ""}${x.state === "other-archive" ? ` (built by the runward-fleet archive ${x.runwardFleetArchiveSha256.slice(0, 12)}, packed at ${String(x.commit).slice(0, 12)}, not the one pinned here)` : ""}${x.state === "label-refused" || x.state === "not-replayable" ? ` (${x.why})` : ""}`);
    console.log(`replay: ${countsLine(r)}; ${r.verdict === "cannot-tell" ? `cannot tell: ${r.why.join("; ")}` : r.verdict}`);
  }
  // Exit 2, cannot tell: nothing rebuilt here, a refused label, or another archive after the pinned one.
  process.exit(exitCode(r));
}
