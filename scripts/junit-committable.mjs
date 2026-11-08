#!/usr/bin/env node
// The committed JUnit report of the whole suite, unit and PostgreSQL (the pattern of runward's own
// scripts/junit-committable.mjs, its ADR-0073 and ADR-0112). The manifest rows cite its cases
// (test:reports/junit.xml::<case>); the gate reads it, never runs the tests.
//
// It removes only what a committed file cannot carry (the absolute file= path of whoever ran it, every
// time= and timestamp=, the duration comments) and touches NO verdict: a failing case keeps its failure.
// It exits with the SUITE's status, never its own.
//
// The reference environment: Linux, the Node.js major of .nvmrc, with a PostgreSQL (PG_ADMIN_URL, a
// throwaway server): the environment of the CI test job. Without PG_ADMIN_URL it writes nothing: a report
// without the PostgreSQL cases would vouch for less than the rows cite. The environment is written as a
// comment before the root element; scripts/reports-fresh.mjs refuses a report written anywhere else.
//   PG_ADMIN_URL=postgres://postgres@<throwaway>/postgres node scripts/junit-committable.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const RAW = join(ROOT, "reports", "junit.raw.xml");
export const JUNIT = join(ROOT, "reports", "junit.xml");
export const REFERENCE_PLATFORM = "linux";
export const referenceMajor = () => readFileSync(join(ROOT, ".nvmrc"), "utf8").trim().replace(/^v/, "").split(".")[0];
export const generatedComment = () => `<!-- generated: node ${process.version} ${process.platform} -->`;

/** Why a committed report was not written in the reference environment, or null. */
export function referenceProblem(xml) {
  const m = /<!-- generated: node v(\d+)\.\S* (\S+) -->/.exec(xml ?? "");
  const how = `regenerate it where the CI test job runs: Linux, Node.js ${referenceMajor()}, with PG_ADMIN_URL (npm run test:junit)`;
  if (!m) return `reports/junit.xml says nothing of the environment that wrote it: ${how}`;
  if (m[1] !== referenceMajor() || m[2] !== REFERENCE_PLATFORM) return `reports/junit.xml was written by Node.js ${m[1]} on ${m[2]}: ${how}`;
  return null;
}

/** The test files, in a fixed order: the unit suite, then the PostgreSQL suite. */
export const testFiles = () => ["unit", "pg"].flatMap((d) => readdirSync(join(ROOT, "test", d)).filter((f) => f.endsWith(".test.js")).sort().map((f) => `test/${d}/${f}`));

export function writeJunit() {
  if (!process.env.PG_ADMIN_URL) { console.error("junit-committable: PG_ADMIN_URL is required (a throwaway PostgreSQL): a report without the PostgreSQL cases is not written"); return 2; }
  mkdirSync(join(ROOT, "reports"), { recursive: true });
  const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=junit", `--test-reporter-destination=${RAW}`, ...testFiles()], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
  if (!existsSync(RAW)) { console.error("junit-committable: the suite produced no report"); return run.status ?? 2; }
  const raw = readFileSync(RAW, "utf8");
  rmSync(RAW);
  if (!/<testsuites?\b/.test(raw)) { console.error("junit-committable: the output is not a JUnit report"); return 2; }
  const clean = raw.replace(/\s+file="[^"]*"/g, "").replace(/\s+time="[^"]*"/g, "").replace(/\s+timestamp="[^"]*"/g, "").replace(/^[ \t]*<!--\s*duration_ms[^>]*-->\r?\n/gm, "");
  const decl = /^<\?xml[^>]*\?>\r?\n?/.exec(clean);
  const out = decl ? `${decl[0].trimEnd()}\n${generatedComment()}\n${clean.slice(decl[0].length)}` : `${generatedComment()}\n${clean}`;
  writeFileSync(JUNIT, out);
  console.log(`junit-committable: wrote reports/junit.xml (${(raw.match(/<testcase\b/g) ?? []).length} cases, verdicts untouched)`);
  return run.status ?? 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(writeJunit());
