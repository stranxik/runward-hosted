#!/usr/bin/env node
// The operator's entry point (PADR-0018 point 7): one gesture of the closed list per run, inside the
// hoster's private network, started by an approved workflow of the private operator repository or by
// the hoster's schedule. It connects as rw_maint (DATABASE_URL of that role). Only a token's sha256 is
// ever passed in; the token itself stays on the author's workstation (scripts/operator-link.mjs).
//   node src/operator.js open-bootstrap --hash <sha256> [--tenant <uuid>] [--witness] [--title <text>]
//   node src/operator.js open-recovery  --hash <sha256> --tenant <uuid> --member <uuid>
//   node src/operator.js reset-access   --hash <sha256> --tenant <uuid>
//   node src/operator.js maintenance    --on [--until <iso>] [--reason <text>] | --off
//   node src/operator.js retention | verify-chains
//   node src/operator.js restore-replay --anchor                                  before the database is replaced
//   node src/operator.js restore-replay --since <ulid> [--recovery-hash <sha256>]  after it
//   node src/operator.js job-note --job retention|verify-chains --why deadline|exit|busy
//                        (the gateway's own call, never a route: a daily job that ended without its note)
import { readConfig, compose } from "./main.js";

export const GESTURES = ["open-bootstrap", "open-recovery", "reset-access", "maintenance", "retention", "verify-chains", "restore-replay"];

/** A daily job that recorded a failed tenant (or a broken chain) ends non-zero, so the hoster's job shows
 *  it; the failure itself is already in the operator journal (operatorCases#eachTenant). */
export const jobIncomplete = (r) => Array.isArray(r) && r.some((x) => x.failed === true || x.ok === false);

/** What a run prints: the gesture and whether it completed, nothing of its result. */
export const gestureStatus = (gesture, r) => ({ gesture, ok: !jobIncomplete(r) });

/** Why a daily job did not complete, for the gateway's log line at the hoster: how many tenants, and the
 *  first reason, never which tenant (the operator journal names it, inside the database). */
export function incompleteReason(gesture, r) {
  if (!jobIncomplete(r)) return null;
  const bad = r.filter((x) => x.failed === true || x.ok === false);
  const first = bad[0];
  const why = first.failed ? first.error : `chain broken at seq ${first.at} (${first.why})`;
  return `operator: ${gesture} did not complete: ${bad.length} tenant(s) failed or broken; first reason: ${String(why ?? "unknown").slice(0, 200)}`;
}

/** The note of a daily job that did not run to its own note (review finding of 2026-11-10: a job killed at
 *  its deadline, or refused because another gesture was running, wrote nothing, and was seen only a day
 *  later by the rule on a job that has not run). It reads as a run that did not complete: /api/health says
 *  ok false for the job, and the hourly probe alerts. Written by the gateway, through this entry point,
 *  under rw_maint; it names no tenant. */
export const JOB_NOTE = { jobs: ["retention", "verify-chains"], whys: ["deadline", "exit", "busy"] };
export async function noteIncomplete(store, job, why) {
  if (!JOB_NOTE.jobs.includes(job)) throw new Error(`job-note: --job must be one of: ${JOB_NOTE.jobs.join(", ")}`);
  if (!JOB_NOTE.whys.includes(why)) throw new Error(`job-note: --why must be one of: ${JOB_NOTE.whys.join(", ")}`);
  return store.tx(null, (tx) => tx.operatorNote(job, { report: [], failed: 1, incomplete: why }));
}

/** The arguments of restore-replay. A head is no longer an argument: one head could not be right for every
 *  tenant, each has its own chain; each tenant's head before the loss is the one `--anchor` wrote for it. */
export function restoreArgs(o) {
  if (o.headBefore !== undefined) throw new Error("--head-before is no longer taken: run restore-replay --anchor before the database is replaced, each tenant's head is read from its own anchor");
  return { since: o.since ?? null, anchor: Boolean(o.anchor), recoveryHash: o.recoveryHash ?? null };
}

export function parse(argv) {
  const [gesture, ...rest] = argv;
  if (!GESTURES.includes(gesture)) throw new Error(`gesture must be one of: ${GESTURES.join(", ")}`);
  const o = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith("--")) throw new Error(`unexpected argument: ${k}`);
    const name = k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (["witness", "on", "off", "anchor"].includes(name)) o[name] = true; else o[name] = rest[++i];
  }
  return { gesture, o };
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "job-note") {
  const a = process.argv.slice(3);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const c = compose(readConfig({ ...process.env, RW_SEND_WORKFLOW_SHAS: process.env.RW_SEND_WORKFLOW_SHAS ?? "" }));
  noteIncomplete(c.store, get("--job"), get("--why"))
    .then(() => { console.log(JSON.stringify({ gesture: "job-note", ok: true })); return c.store.close(); })
    .catch((e) => { console.error(`operator: job-note refused: ${e.message}`); c.store.close().finally(() => process.exit(1)); });
} else if (import.meta.url === `file://${process.argv[1]}`) {
  let parsed;
  try { parsed = parse(process.argv.slice(2)); } catch (e) { console.error(`operator: ${e.message}`); process.exit(2); }
  const { gesture, o } = parsed;
  const c = compose(readConfig({ ...process.env, RW_SEND_WORKFLOW_SHAS: process.env.RW_SEND_WORKFLOW_SHAS ?? "" }));
  const op = c.app.operator;
  const run = {
    "open-bootstrap": () => op.openBootstrap({ hash: o.hash, tenant: o.tenant ?? null, witness: Boolean(o.witness), title: o.title ?? null }),
    "open-recovery": () => op.openRecovery({ hash: o.hash, tenant: o.tenant, member: o.member }),
    "reset-access": () => op.resetAccess({ hash: o.hash, tenant: o.tenant }),
    maintenance: () => op.maintenance({ on: Boolean(o.on) && !o.off, until: o.until ?? null, reason: o.reason ?? "" }),
    retention: () => op.retention(),
    "verify-chains": () => op.verifyChains(),
    "restore-replay": async () => op.restoreReplay(restoreArgs(o)),
  }[gesture];
  // A status, never the result (review finding of 2026-11-10): the result names tenants, members, links and
  // chain heads, and each gesture already writes it to the operator journal in the database. The gateway
  // keeps this output inside the private network; the reason of a refusal goes to stderr, which only its
  // log line at the hoster reads.
  run().then((r) => {
    console.log(JSON.stringify(gestureStatus(gesture, r)));
    const why = incompleteReason(gesture, r);
    if (why) console.error(why);
    return c.store.close().then(() => { if (why) process.exit(1); });
  })
    .catch((e) => { console.error(`operator: ${gesture} refused: ${e.message}`); c.store.close().finally(() => process.exit(1)); });
}
