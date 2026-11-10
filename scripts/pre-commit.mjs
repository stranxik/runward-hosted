#!/usr/bin/env node
// The repository's pre-commit hook (checklist-day-zero-project: pre-commit hooks), run by .githooks/pre-commit,
// which `npm install` wires (package.json `prepare` sets core.hooksPath to .githooks; `npm ci --ignore-scripts`,
// as in CI and in the image, wires nothing). Fast and local, on what is staged:
//   - the format of the tree (scripts/format-check.mjs), always;
//   - the hexagon's lint and the security scan of the staged files of src/;
//   - the guards on the workflows when a workflow is staged (scripts/check-workflows.mjs);
//   - the unit tests that reach a staged file: a staged test, a test that imports or reads a staged file (its
//     import specifiers and its new URL(..., import.meta.url), resolved), the test named after it. The whole
//     suite, the PostgreSQL suite and the reports run in CI.
// The runward gate is not run here: `runward check --strict` is red by design until the proposed rows are
// ratified, and a hook that is always red is a hook everyone skips. It runs in CI (ci.yml, job runward).
// Exit 1 on the first failing step; `git commit --no-verify` skips the hook, knowingly.
//   node scripts/pre-commit.mjs [--plan]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const UNIT = "test/unit";

/** The repository files a test file names: its relative import specifiers and its new URL(..., import.meta.url). */
export function reached(testPath, text) {
  const out = new Set();
  for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\(\s*|\bnew URL\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) out.add(relative(ROOT, resolve(ROOT, dirname(testPath), m[1])));
  return out;
}

/** What the hook runs for these staged paths (repository-relative), given the unit test files and their text. */
export function plan(staged, tests = unitTests()) {
  const run = new Set();
  for (const f of staged) {
    if (f.startsWith(`${UNIT}/`) && f.endsWith(".test.js") && tests.has(f)) { run.add(f); continue; }
    // a file the test names, or one inside a directory it reads (db/migrations/, for one)
    for (const [t, text] of tests) if ([...reached(t, text)].some((r) => f === r || f.startsWith(`${r}/`))) run.add(t);
    const named = `${UNIT}/${basename(f).replace(/\.m?js$/, "")}.test.js`;
    if (/\.m?js$/.test(f) && tests.has(named)) run.add(named);
  }
  return {
    format: true,
    lint: staged.filter((f) => f.startsWith("src/") && f.endsWith(".js")),
    workflows: staged.some((f) => f.startsWith(".github/workflows/")),
    tests: [...run].sort(),
  };
}

function unitTests() {
  const dir = join(ROOT, UNIT);
  return new Map(readdirSync(dir).filter((f) => f.endsWith(".test.js")).map((f) => [`${UNIT}/${f}`, readFileSync(join(dir, f), "utf8")]));
}

const staged = () => execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = plan(staged());
  if (process.argv.includes("--plan")) { console.log(JSON.stringify(p, null, 2)); process.exit(0); }
  const eslint = join(ROOT, "node_modules", ".bin", "eslint");
  const steps = [
    ["format", process.execPath, ["scripts/format-check.mjs"]],
    ...(p.lint.length ? [["lint", eslint, p.lint], ["security scan", eslint, ["-c", "eslint.security.config.js", ...p.lint]]] : []),
    ...(p.workflows ? [["workflows", process.execPath, ["scripts/check-workflows.mjs"]]] : []),
    ...(p.tests.length ? [["unit tests", process.execPath, ["--test", "--test-reporter=dot", ...p.tests]]] : []),
  ];
  if (p.lint.length && !existsSync(eslint)) { console.error("pre-commit: node_modules/.bin/eslint is missing: run npm install"); process.exit(1); }
  for (const [name, cmd, args] of steps) {
    console.log(`pre-commit: ${name}${name === "unit tests" ? ` (${p.tests.length} file(s) that reach what is staged)` : ""}`);
    const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) { console.error(`pre-commit: ${name} failed; fix it, or commit with --no-verify knowingly`); process.exit(1); }
  }
}
