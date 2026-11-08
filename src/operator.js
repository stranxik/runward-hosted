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
//   node src/operator.js restore-replay --since <ulid> [--head-before <hash>] [--recovery-hash <sha256>]
import { readConfig, compose } from "./main.js";

export const GESTURES = ["open-bootstrap", "open-recovery", "reset-access", "maintenance", "retention", "verify-chains", "restore-replay"];

/** A daily job that recorded a failed tenant (or a broken chain) ends non-zero, so the hoster's job shows
 *  it; the failure itself is already in the operator journal (operatorCases#eachTenant). */
export const jobIncomplete = (r) => Array.isArray(r) && r.some((x) => x.failed === true || x.ok === false);

export function parse(argv) {
  const [gesture, ...rest] = argv;
  if (!GESTURES.includes(gesture)) throw new Error(`gesture must be one of: ${GESTURES.join(", ")}`);
  const o = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith("--")) throw new Error(`unexpected argument: ${k}`);
    const name = k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (["witness", "on", "off"].includes(name)) o[name] = true; else o[name] = rest[++i];
  }
  return { gesture, o };
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
    "restore-replay": () => op.restoreReplay({ since: o.since, headBefore: o.headBefore ?? null, recoveryHash: o.recoveryHash ?? null }),
  }[gesture];
  run().then((r) => { console.log(JSON.stringify({ gesture, result: r }, null, 2)); return c.store.close().then(() => { if (jobIncomplete(r)) process.exit(1); }); })
    .catch((e) => { console.error(`operator: ${gesture} refused: ${e.message}`); c.store.close().finally(() => process.exit(1)); });
}
