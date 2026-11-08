#!/usr/bin/env node
// The committed reports describe this tree (the pattern of runward's scripts/reports-fresh.mjs, its
// RWD-2026-0113): the gate reads a committed report and never runs the tool, so CI proves the report is
// current, or a row could stay green on a test that no longer exists.
//
//   reports/eslint.json, reports/eslint-security.sarif, reports/secretlint.sarif,
//   reports/secretlint-control.json   regenerated in memory and compared BYTE for byte (each generator
//                                     sorts and relativises, so a difference is staleness);
//   reports/junit.xml                 regenerated (unit and PostgreSQL suites, PG_ADMIN_URL required) and
//                                     compared by CENSUS: the same case names, each with the same verdict;
//                                     the order of cases and the spelling of entities may differ between
//                                     two honest runs, the cases and their verdicts may not. The committed
//                                     report must name the reference environment and record no red case.
// Exit 0 when every report is current; 1 with the list of what is stale.
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { eslintReport } from "./eslint-committable.mjs";
import { securityReports } from "./security-scans.mjs";
import { writeJunit, referenceProblem, JUNIT } from "./junit-committable.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const read = (rel) => { const p = join(ROOT, rel); return existsSync(p) ? readFileSync(p, "utf8") : null; };

const decode = (v) => v.replace(/&amp;quot;/g, '"').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** Every case of a JUnit report: classname::name → "pass" | "fail" | "skip" (a homonym that is red reddens). */
export function census(xml) {
  const out = new Map();
  const re = /<testcase\b([^>]*?)(\/?)>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const attrs = m[1];
    const name = decode(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? "");
    const cls = decode(/\bclassname="([^"]*)"/.exec(attrs)?.[1] ?? "");
    let verdict = "pass";
    if (m[2] !== "/") {
      const end = xml.indexOf("</testcase>", re.lastIndex);
      const body = xml.slice(re.lastIndex, end === -1 ? undefined : end);
      verdict = /<(failure|error)\b/.test(body) ? "fail" : /<skipped\b/.test(body) ? "skip" : "pass";
    }
    const key = `${cls}::${name}`;
    out.set(key, out.get(key) === "fail" ? "fail" : verdict);
  }
  return out;
}

const problems = [];
const was = { eslint: read("reports/eslint.json"), junit: read("reports/junit.xml") };
const lint = await eslintReport();
if (was.eslint !== lint.text) problems.push("reports/eslint.json is stale: run npm run test:eslint and commit it");
if (lint.errors) problems.push(`the hexagon's lint has ${lint.errors} error(s): fix them before the report can be evidence`);
const sec = await securityReports();
for (const [rel, body] of Object.entries(sec.files)) if (read(rel) !== body) problems.push(`${rel} is stale: run npm run test:security and commit it`);
if (sec.findings.eslint || sec.findings.secrets) problems.push(`the security scans are not clean (${sec.findings.eslint} in src/, ${sec.findings.secrets} secret(s))`);

if (was.junit === null) problems.push("reports/junit.xml is not committed: the rows that cite it point at nothing");
else {
  const env = referenceProblem(was.junit);
  if (env) problems.push(env);
  const committed = census(was.junit);
  const red = [...committed].filter(([, v]) => v !== "pass").map(([k]) => k);
  if (red.length) problems.push(`reports/junit.xml records ${red.length} case(s) that are not green, which no row may cite: ${red.slice(0, 5).join("; ")}`);
  const status = writeJunit();
  if (status !== 0) problems.push(`the suite is not green (exit ${status})`);
  const now = existsSync(JUNIT) ? census(readFileSync(JUNIT, "utf8")) : new Map();
  const gone = [...committed.keys()].filter((k) => !now.has(k));
  const added = [...now.keys()].filter((k) => !committed.has(k));
  const changed = [...now.keys()].filter((k) => committed.has(k) && committed.get(k) !== now.get(k));
  if (gone.length) problems.push(`${gone.length} case(s) of the committed report are no longer in the suite: ${gone.slice(0, 5).join("; ")}`);
  if (added.length) problems.push(`${added.length} case(s) of the suite are not in the committed report: ${added.slice(0, 5).join("; ")}`);
  if (changed.length) problems.push(`${changed.length} case(s) changed verdict: ${changed.slice(0, 5).map((k) => `${k} ${committed.get(k)} → ${now.get(k)}`).join("; ")}`);
}

if (!problems.length) { console.log("reports-fresh: the committed reports describe this tree (every case cited exists, green; the lint and the scans are current and clean)"); process.exit(0); }
console.error(`reports-fresh: the committed reports are not current:\n  - ${problems.join("\n  - ")}\nRegenerate them where the CI test job runs (Linux, Node.js of .nvmrc, PG_ADMIN_URL): npm run test:reports:write, then commit reports/.`);
process.exit(1);
