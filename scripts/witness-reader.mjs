#!/usr/bin/env node
// The witness reader's daily job (PADR-0020), run by .github/workflows/temoin.yml. For each fleet that
// authorized it: read the served index and status, take the export, replay it (S1 b), check that the served
// index is the last one replayed, and compare each declared repository's head of main with the commit of
// its last accepted upload (T26). Writes $RUNNER_TEMP/witness/<fleet>.json and the job summary.
// Limit, said: the head of a private repository needs a read token of that repository, which this public
// job does not hold; such a line reads "not compared".
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { replay } from "./replay-export.mjs";

const { FLEETS = "", SERVICE, RUNNER_TEMP, GITHUB_STEP_SUMMARY, GH_TOKEN, ACTIONS_ID_TOKEN_REQUEST_URL: TU, ACTIONS_ID_TOKEN_REQUEST_TOKEN: TT } = process.env;
const out = join(RUNNER_TEMP, "witness"); mkdirSync(out, { recursive: true });
const token = async () => (await (await fetch(`${TU}&audience=${encodeURIComponent(`${SERVICE}/read`)}`, { headers: { authorization: `Bearer ${TT}` } })).json()).value;
// The archive pinned here: an index another archive built is not replayed by this one (ADR-0021).
const PINNED = JSON.parse(readFileSync(new URL("../vendor/runward-fleet.lock.json", import.meta.url), "utf8")).tarballSha256;
const lines = ["### witness reader", ""];
let bad = 0;
for (const fleet of FLEETS.split(",").map((s) => s.trim()).filter(Boolean)) {
  const h = { authorization: `Bearer ${await token()}`, "runward-fleet": fleet };
  const idx = await (await fetch(`${SERVICE}/api/v0/reader/index`, { headers: h })).json();
  const tarRes = await fetch(`${SERVICE}/api/v0/reader/export`, { method: "POST", headers: { ...h, authorization: `Bearer ${await token()}` } });
  const archive = Buffer.from(await tarRes.arrayBuffer());
  const r = replay(archive, "0.46.0", PINNED);
  const served = idx.index?.sha256 ?? null;
  const lastSame = [...(r.results ?? [])].reverse().find((x) => x.state === "same");
  const drift = [];
  for (const l of idx.status?.lines ?? []) {
    const head = await fetch(`https://api.github.com/repos/${l.repository}/commits/main`, { headers: { authorization: `Bearer ${GH_TOKEN}`, accept: "application/vnd.github+json" } }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    drift.push({ mission: l.mission, main: head?.sha ?? "not compared", accepted: l.accepted?.commit ?? null, same: head ? head.sha === l.accepted?.commit : null });
  }
  const res = { fleet, served, replay: r, lastReplayed: lastSame?.got ?? null, servedIsLastReplayed: served !== null && served === lastSame?.got, drift };
  writeFileSync(join(out, `${fleet}.json`), JSON.stringify(res, null, 2));
  const ok = r.ok && res.servedIsLastReplayed;
  if (!ok) bad++;
  lines.push(`- fleet ${fleet.slice(0, 8)}: replay ${r.ok ? "same" : "DIFFERENT"} (${(r.results ?? []).filter((x) => x.state === "same").length} index(es)), served index ${res.servedIsLastReplayed ? "is" : "is NOT"} the last replayed; main vs last accepted: ${drift.map((d) => `${d.mission} ${d.same === null ? "not compared" : d.same ? "same" : "behind"}`).join(", ")}`);
}
appendFileSync(GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
process.exit(bad ? 1 : 0);
