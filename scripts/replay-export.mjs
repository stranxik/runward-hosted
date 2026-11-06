#!/usr/bin/env node
// Replay an export (criterion S1 (b), PADR-0011 note 6 bis): for each published index in replay.json,
// rebuild it with runward-fleet from versions/<version>/fleet.json and exports/, exactly as
// `runward-fleet build fleet.json` would, and compare the sha256 of the bytes it writes.
// Usage: node scripts/replay-export.mjs <archive.tar> [--json]
// Exit 0 every replayable index matches, 1 a mismatch, 2 cannot tell. The runward-fleet version used is
// the one installed here; an entry naming another version is reported "other-version", never matched.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildIndex } from "runward-fleet";
import { untar } from "../src/adapters/archive/tar.js";

export function replay(archiveBytes, installedVersion) {
  const files = new Map(untar(archiveBytes).map((f) => [f.name, f.bytes]));
  const plan = JSON.parse(files.get("replay.json")?.toString("utf8") ?? "null");
  if (!plan || plan.format !== "runward-hosted-replay/0") return { ok: false, cannotTell: "no replay.json" };
  const results = [];
  for (const v of plan.versions) {
    if (!v.replayable) { results.push({ version: v.version, state: "not-replayable", why: v.why }); continue; }
    if (v.runwardFleet !== installedVersion) { results.push({ version: v.version, state: "other-version", runwardFleet: v.runwardFleet }); continue; }
    const manifest = files.get(`versions/${v.version}/fleet.json`);
    const index = buildIndex({ manifest: { name: "fleet.json", bytes: manifest }, read: (p) => files.get(p) ?? null, version: installedVersion });
    const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
    const got = createHash("sha256").update(bytes).digest("hex");
    results.push({ version: v.version, seq: v.seq, state: got === v.indexSha256 ? "same" : "different", want: v.indexSha256, got });
  }
  const checked = results.filter((r) => r.state === "same" || r.state === "different");
  return { ok: checked.length > 0 && checked.every((r) => r.state === "same"), results, chainOk: plan.chainOk, head: plan.head };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, flag] = process.argv.slice(2);
  if (!file) { console.error("usage: replay-export.mjs <archive.tar> [--json]"); process.exit(2); }
  const version = JSON.parse(readFileSync(new URL("../node_modules/runward-fleet/package.json", import.meta.url), "utf8")).version;
  const r = replay(readFileSync(file), version);
  if (flag === "--json") console.log(JSON.stringify(r, null, 2));
  else for (const x of r.results ?? []) console.log(`version ${x.version}: ${x.state}${x.got ? ` ${x.got.slice(0, 12)}` : ""}`);
  process.exit(r.cannotTell ? 2 : r.ok ? 0 : 1);
}
