#!/usr/bin/env node
// The hourly probe's verdict (probe.yml, PADR-0018 points 1 and 9): the service is up when /api/health
// answers 200 with its store and object store ok and /api/version names a commit; it is ALERTING when the
// error rate of the last five minutes crosses ERROR_ALERT (at least 20 requests, more than 5 % of them
// answered 500 or more), or when a daily job did not complete or has not run for more than a day
// (DAILY_JOB_MAX_AGE_MS: the jobs run at 03:23 and 03:37 Paris time; review finding of 2026-11-10, a
// failed job was noted in the operator journal and read by nothing). A job that never ran (null) says
// nothing yet. Either way the probe fails, and two failures in a row open the issue.
//   node scripts/probe-verdict.mjs <health.json> <health-status> <version.json>
import { readFileSync } from "node:fs";
import { ERROR_ALERT } from "../src/http/limits.js";

export const DAILY_JOB_MAX_AGE_MS = 26 * 3600 * 1000;

export function probeVerdict({ healthStatus, health, version, now = Date.now() }) {
  const reasons = [];
  if (healthStatus !== 200 || health?.ok !== true) reasons.push(`health answered ${healthStatus}${health?.db ? ` (db ${health.db}, objects ${health.objectStore})` : ""}`);
  if (!version?.commit) reasons.push("version names no commit");
  const e = health?.errors;
  if (e && e.requests >= ERROR_ALERT.minRequests && e.rate > ERROR_ALERT.rate) reasons.push(`error rate ${(e.rate * 100).toFixed(1)} % over the last ${e.windowSeconds / 60} minutes (${e.serverErrors} of ${e.requests})`);
  for (const [job, j] of Object.entries(health?.dailyJobs ?? {})) {
    if (!j?.lastRun) continue;
    if (j.ok === false) reasons.push(`the daily job ${job} did not complete (run of ${j.lastRun}; the operator journal names what failed)`);
    else if (now - Date.parse(j.lastRun) > DAILY_JOB_MAX_AGE_MS) reasons.push(`the daily job ${job} has not run since ${j.lastRun}`);
  }
  return { ok: reasons.length === 0, reasons };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [healthFile, status, versionFile] = process.argv.slice(2);
  const read = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
  const v = probeVerdict({ healthStatus: Number(status), health: read(healthFile), version: read(versionFile) });
  console.log(v.ok ? "probe: ok" : `probe: ${v.reasons.join("; ")}`);
  process.exit(v.ok ? 0 : 1);
}
