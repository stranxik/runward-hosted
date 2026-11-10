// The pre-commit hook (checklist-day-zero-project: pre-commit hooks; review finding of 2026-11-10: none was
// wired). `npm install` points git at .githooks; the hook runs scripts/pre-commit.mjs, which formats, lints
// and runs the unit tests that reach what is staged. Its plan is tested here on the real test files, and the
// hook is run for real in a throwaway clone of this tree, where a staged defect must stop the commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync, cpSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { plan } from "../../scripts/pre-commit.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

test("the pre-commit hook is wired by npm install and runs the repository's own checks", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.scripts.prepare, /git config core\.hooksPath \.githooks/);
  const hook = join(ROOT, ".githooks", "pre-commit");
  assert.ok(statSync(hook).mode & 0o111, "the hook is executable");
  assert.match(readFileSync(hook, "utf8"), /^#!\/bin\/sh\n[\s\S]*exec node scripts\/pre-commit\.mjs\n$/);
});

test("the pre-commit plan: the format always, the lint of staged sources, the workflows' guards, the unit tests that reach what is staged", () => {
  const p1 = plan(["src/adapters/oidc/github.js"]);
  assert.deepEqual(p1.lint, ["src/adapters/oidc/github.js"]);
  assert.ok(p1.tests.includes("test/unit/oidc.test.js") && p1.tests.includes("test/unit/http.test.js"), "the tests that import it");
  assert.equal(p1.tests.includes("test/unit/tokens.test.js"), false, "and not the others");
  assert.deepEqual(plan(["scripts/migrate.mjs"]).tests, ["test/unit/migrations.test.js", "test/unit/tls.test.js"], "its importers, not a test that merely names it");
  assert.ok(plan(["db/migrations/0004_daily_jobs_outcome.sql"]).tests.includes("test/unit/migrations.test.js"), "a file inside a directory a test reads counts");
  const p3 = plan([".github/workflows/send.yml"]);
  assert.equal(p3.workflows, true);
  assert.ok(p3.tests.includes("test/unit/send.test.js"));
  assert.deepEqual(plan(["test/unit/limits.test.js"]).tests, ["test/unit/limits.test.js"]);
  assert.deepEqual(plan(["runward/handover.md"]), { format: true, lint: [], workflows: false, tests: [] }, "a document: the format only");
});

test("the hook, run in a throwaway clone: a staged lint error stops the commit, the fixed file passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-hook-"));
  try {
    const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    for (const p of ["package.json", ".githooks", "scripts", "src", "test", "eslint.config.js", "eslint.security.config.js", "runward/scaffold-lock.json"]) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
    git("init", "-q");
    git("config", "core.hooksPath", ".githooks");
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "base");
    const file = join(dir, "src/adapters/system/clock.js");
    const good = readFileSync(file, "utf8");
    writeFileSync(file, `${good}const unused = 1;\n`);
    git("add", "src/adapters/system/clock.js");
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    const refused = spawnSync("git", ["commit", "-q", "-m", "planted"], { cwd: dir, encoding: "utf8", env });
    assert.notEqual(refused.status, 0, "the planted unused variable stops the commit");
    assert.match(refused.stdout + refused.stderr, /pre-commit: lint failed/);
    writeFileSync(file, good);
    git("add", "src/adapters/system/clock.js");
    writeFileSync(join(dir, "NOTE.md"), "a note\n");
    git("add", "NOTE.md");
    const passed = spawnSync("git", ["commit", "-q", "-m", "fixed"], { cwd: dir, encoding: "utf8", env });
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
