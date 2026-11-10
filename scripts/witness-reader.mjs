#!/usr/bin/env node
// The witness reader's daily job (PADR-0020), run by .github/workflows/temoin.yml. For each fleet that
// authorized it: read the served index and status, take the export, replay it (S1 b), check that the served
// index is the last one replayed, and compare each declared repository's head of main with the commit of
// its last accepted upload (T26). Writes $RUNNER_TEMP/witness/<fleet>.json and the job summary.
// Its rule for a fleet (judge, below): green only when the replay's verdict is `same` (scripts/replay-export.mjs:
// no index differs, at least one was rebuilt here, no label was refused, no index of another archive is
// more recent than one rebuilt here) and the served index is the last one rebuilt here. The summary counts
// the indexes same, different and not rebuilt here, and says why a fleet is red.
// Limit, said: the head of a private repository needs a read token of that repository, which this public
// job does not hold; such a line reads "not compared".
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { replay, replayPin, countsLine } from "./replay-export.mjs";

/**
 * One fleet's verdict, from its export archive and the sha256 of the index the service serves.
 * `pin` is replayPin(): the installed runward-fleet, proved to be the pinned archive, and the lock's archives.
 */
export function judge({ archive, served, pin }) {
  const r = replay(archive, pin.version, pin.archives);
  const lastSame = [...r.results].reverse().find((x) => x.state === "same");
  const servedIsLastReplayed = typeof served === "string" && served === lastSame?.got;
  const ok = r.verdict === "same" && servedIsLastReplayed;
  const why = [...(r.verdict === "different" ? r.results.filter((x) => x.state === "different").map((x) => `version ${x.version} differs`) : []), ...r.why, ...(servedIsLastReplayed ? [] : ["the served index is not the last one rebuilt here"])];
  return { ok, replay: r, lastReplayed: lastSame?.got ?? null, servedIsLastReplayed, why, words: `replay ${countsLine(r)}; ${ok ? "holds" : `RED: ${why.join("; ")}`}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { FLEETS = "", SERVICE, RUNNER_TEMP, GITHUB_STEP_SUMMARY, GH_TOKEN, ACTIONS_ID_TOKEN_REQUEST_URL: TU, ACTIONS_ID_TOKEN_REQUEST_TOKEN: TT } = process.env;
  const out = join(RUNNER_TEMP, "witness"); mkdirSync(out, { recursive: true });
  const token = async () => (await (await fetch(`${TU}&audience=${encodeURIComponent(`${SERVICE}/read`)}`, { headers: { authorization: `Bearer ${TT}` } })).json()).value;
  // What replays here: the installed runward-fleet, refused if it is not the pinned archive, and the
  // archives the lock knows: an index another archive built is not rebuilt by this one (ADR-0021).
  const pin = replayPin();
  const lines = ["### witness reader", ""];
  let bad = 0;
  for (const fleet of FLEETS.split(",").map((s) => s.trim()).filter(Boolean)) {
    const h = { authorization: `Bearer ${await token()}`, "runward-fleet": fleet };
    const idx = await (await fetch(`${SERVICE}/api/v0/reader/index`, { headers: h })).json();
    const tarRes = await fetch(`${SERVICE}/api/v0/reader/export`, { method: "POST", headers: { ...h, authorization: `Bearer ${await token()}` } });
    const archive = Buffer.from(await tarRes.arrayBuffer());
    const served = idx.index?.sha256 ?? null;
    const j = judge({ archive, served, pin });
    const drift = [];
    for (const l of idx.status?.lines ?? []) {
      const head = await fetch(`https://api.github.com/repos/${l.repository}/commits/main`, { headers: { authorization: `Bearer ${GH_TOKEN}`, accept: "application/vnd.github+json" } }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      drift.push({ mission: l.mission, main: head?.sha ?? "not compared", accepted: l.accepted?.commit ?? null, same: head ? head.sha === l.accepted?.commit : null });
    }
    const res = { fleet, served, ok: j.ok, why: j.why, replay: j.replay, lastReplayed: j.lastReplayed, servedIsLastReplayed: j.servedIsLastReplayed, drift };
    writeFileSync(join(out, `${fleet}.json`), JSON.stringify(res, null, 2));
    if (!j.ok) bad++;
    lines.push(`- fleet ${fleet.slice(0, 8)}: ${j.words}; main vs last accepted: ${drift.map((d) => `${d.mission} ${d.same === null ? "not compared" : d.same ? "same" : "behind"}`).join(", ")}`);
  }
  appendFileSync(GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  process.exit(bad ? 1 : 0);
}
