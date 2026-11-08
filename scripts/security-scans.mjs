#!/usr/bin/env node
// Two committed security scans (the pattern of runward's scripts/security-scans.mjs, its ADR-0075 part 2):
//
//   reports/eslint-security.sarif: src/ under eslint.security.config.js (eslint-plugin-security, and the
//     configuration boundary: process.env read by the composition roots only). The rules listed are the
//     ones ESLint itself resolved for a file of src/, never a list typed here: an author's list is an
//     assertion about what ran, the tool's is a fact. Cited by checklist-pre-production-security and
//     config-secrets-boundary, one rule id per pointer (the scan knows the rule and records no finding).
//
//   reports/secretlint.sarif and reports/secretlint-control.json: a secrets scan of the repository,
//     with its sensitivity proved in the same run. secretlint lists no rule when nothing fires, so a clean
//     report cannot tell "nothing" from "blind": this script first plants FAKE credentials in a temporary
//     directory (assembled at run time, never written in the tree) and refuses to write anything unless
//     the scanner sees every one; the rules it fired on are written to the control file.
//
// Deterministic, because committed: relative paths, sorted rules and results, no clock. Re-derived and
// compared byte for byte by scripts/reports-fresh.mjs. Exits non-zero when either scan finds something.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { ESLint } from "eslint";

const ROOT = resolve(import.meta.dirname, "..");
const require_ = createRequire(import.meta.url);
const posix = (p) => p.split("\\").join("/");
const SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
export const SECURITY_REPORTS = ["reports/eslint-security.sarif", "reports/secretlint.sarif", "reports/secretlint-control.json"];
const text = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function eslintSecuritySarif() {
  const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: join(ROOT, "eslint.security.config.js") });
  const results = await eslint.lintFiles(["src"]);
  const resolved = await eslint.calculateConfigForFile(join(ROOT, "src", "adapters", "store", "postgres.js"));
  const level = (cfg) => (Array.isArray(cfg) ? cfg[0] : cfg);
  const rules = Object.entries(resolved.rules ?? {})
    .filter(([, cfg]) => level(cfg) !== "off" && level(cfg) !== 0)
    .map(([id, cfg]) => ({ id, defaultConfiguration: { level: level(cfg) === "error" || level(cfg) === 2 ? "error" : "warning" } }))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  const findings = [];
  for (const file of results) for (const m of file.messages) {
    if (!m.ruleId) continue;
    findings.push({ ruleId: m.ruleId, level: m.severity === 2 ? "error" : "warning", message: { text: m.message },
      locations: [{ physicalLocation: { artifactLocation: { uri: posix(relative(ROOT, file.filePath)) }, region: { startLine: m.line ?? 1, startColumn: m.column ?? 1 } } }] });
  }
  findings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
  const plugin = require_("eslint-plugin-security/package.json");
  const eslintPkg = require_("eslint/package.json");
  return { findings: findings.length, text: text({ $schema: SCHEMA, version: "2.1.0", runs: [{
    tool: { driver: { name: "eslint", version: eslintPkg.version, informationUri: "https://eslint.org", rules,
      properties: { config: "eslint.security.config.js", plugins: { "eslint-plugin-security": plugin.version }, files: results.length } } },
    results: findings }] }) };
}

function secretlint(targets, cwd) {
  const run = spawnSync(process.execPath, [join(ROOT, "node_modules", "secretlint", "bin", "secretlint.js"), "--format", "@secretlint/secretlint-formatter-sarif",
    "--secretlintrc", join(ROOT, "secretlint.config.json"), ...targets], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw run.error;
  try { return JSON.parse(run.stdout); } catch { throw new Error(`secretlint did not emit SARIF: ${(run.stdout || run.stderr).slice(0, 500)}`); }
}

/** Fake credentials, one per rule the control must prove live, assembled at run time so no line of the
 *  tree matches a pattern (this file is inside the scanned perimeter). None is a real credential. */
const PLANTED = [
  ["@secretlint/secretlint-rule-aws", "planted-aws.txt", `AKIA${"3QK7ZR2VLXN8TMJD"}\nAWS_SECRET_ACCESS_KEY=${"kP7mXq2LbN4vZs9TrW1cYh6JdF8gA3eU5oI0nQxB"}`],
  ["@secretlint/secretlint-rule-github", "planted-gh.txt", `gh${"p_"}${"AbCdEf0123456789AbCdEf0123456789AbCd"}`],
  ["@secretlint/secretlint-rule-npm", "planted-npm.txt", `npm${"_"}${"AbCdEf0123456789AbCdEf0123456789AbCd"}`],
  ["@secretlint/secretlint-rule-basicauth", "planted-url.txt", `DATABASE_URL=https://rw_app:${"Zq8vN2kLp4XtR7"}@db.example.org/runward_hosted`],
];

export function secretlintSarif() {
  const probe = mkdtempSync(join(tmpdir(), "rw-secret-control-"));
  let control;
  try {
    for (const [, name, body] of PLANTED) writeFileSync(join(probe, name), `${body}\n`);
    const log = secretlint(PLANTED.map(([, name]) => name), probe);
    const fired = new Set();
    for (const run of log.runs ?? []) for (const r of run.results ?? []) if (r.ruleId) fired.add(r.ruleId);
    const blind = PLANTED.filter(([id]) => ![...fired].some((f) => f.includes(id)));
    if (blind.length) throw new Error(`the secrets scanner did not see ${blind.length} of ${PLANTED.length} planted credentials (${blind.map(([id]) => id).join(", ")}): its silence on the repository would prove nothing, so nothing is written`);
    control = text({ what: "Rules the secrets scanner demonstrably fires on, proved in the run that wrote reports/secretlint.sarif: an empty scan there means clean only because the scanner still sees these planted credentials.", rulesProvenLive: [...fired].sort((a, b) => a.localeCompare(b, "en")) });
  } finally { rmSync(probe, { recursive: true, force: true }); }
  const log = secretlint(["src/**/*.js", "scripts/**/*.mjs", "test/**/*.js", "db/**/*.sql", "web/**/*.{js,html,css}", "infra/**/*", ".github/**/*.yml", "runward/**/*.md", "*.json", "*.md", "*.js", "Dockerfile", ".env.example"], ROOT);
  for (const run of log.runs ?? []) {
    for (const r of run.results ?? []) for (const loc of r.locations ?? []) {
      const a = loc.physicalLocation?.artifactLocation;
      if (a?.uri) a.uri = posix(relative(ROOT, a.uri.replace(/^file:\/\//, "")));
    }
    (run.results ?? []).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
    delete run.artifacts;
  }
  log.$schema = SCHEMA;
  return { findings: (log.runs ?? []).reduce((n, r) => n + (r.results?.length ?? 0), 0), text: text(log), control };
}

export async function securityReports() {
  const e = await eslintSecuritySarif();
  const s = secretlintSarif();
  return { files: { "reports/eslint-security.sarif": e.text, "reports/secretlint.sarif": s.text, "reports/secretlint-control.json": s.control }, findings: { eslint: e.findings, secrets: s.findings } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { files, findings } = await securityReports();
    for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(ROOT, rel)), { recursive: true }); writeFileSync(join(ROOT, rel), body); }
    console.log(`security scans: ${findings.eslint} finding(s) in src/, ${findings.secrets} secret(s) in the repository`);
    process.exit(findings.eslint || findings.secrets ? 1 : 0);
  } catch (e) { console.error(`security-scans: ${e.message}`); process.exit(2); }
}
