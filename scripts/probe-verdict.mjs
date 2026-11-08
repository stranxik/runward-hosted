#!/usr/bin/env node
// The hourly probe's verdict (probe.yml, PADR-0018 points 1 and 9): the service is up when /api/health
// answers 200 with its store and object store ok and /api/version names a commit; it is ALERTING when the
// error rate of the last five minutes crosses ERROR_ALERT (at least 20 requests, more than 5 % of them
// answered 500 or more). Either way the probe fails, and two failures in a row open the issue.
//   node scripts/probe-verdict.mjs <health.json> <health-status> <version.json>
import { readFileSync } from "node:fs";
import { ERROR_ALERT } from "../src/http/limits.js";

export function probeVerdict({ healthStatus, health, version }) {
  const reasons = [];
  if (healthStatus !== 200 || health?.ok !== true) reasons.push(`health answered ${healthStatus}${health?.db ? ` (db ${health.db}, objects ${health.objectStore})` : ""}`);
  if (!version?.commit) reasons.push("version names no commit");
  const e = health?.errors;
  if (e && e.requests >= ERROR_ALERT.minRequests && e.rate > ERROR_ALERT.rate) reasons.push(`error rate ${(e.rate * 100).toFixed(1)} % over the last ${e.windowSeconds / 60} minutes (${e.serverErrors} of ${e.requests})`);
  return { ok: reasons.length === 0, reasons };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [healthFile, status, versionFile] = process.argv.slice(2);
  const read = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
  const v = probeVerdict({ healthStatus: Number(status), health: read(healthFile), version: read(versionFile) });
  console.log(v.ok ? "probe: ok" : `probe: ${v.reasons.join("; ")}`);
  process.exit(v.ok ? 0 : 1);
}
