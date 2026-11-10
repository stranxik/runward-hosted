#!/usr/bin/env node
// Guards on the workflows (T7, T8, T22, T28; PADR-0010 note): every action pinned by a 40-hex commit;
// no pull_request_target or workflow_run anywhere; in send.yml, only the send job holds id-token, the
// check job never passes --hooks and writes under $RUNNER_TEMP, and the send job runs no third-party
// action besides GitHub's artifact actions. A deploy or rollback workflow stays off unless its repository
// variable is set; push-image runs by hand from main only. A step that runs scripts/smoke.mjs against the
// served origin gives it RW_SERVICE_HOST from vars.RW_SERVICE_HOST, and deploy.yml refuses before it builds
// when that variable is empty (found at the first deploy, 2026-11-10: without that host the hoster's router
// answers in the app's place and the smoke cannot prove the app's 421); that refusal is read by job (the
// job that holds a secret, or one it needs), cannot carry if: or continue-on-error:, and no secret sits in
// the workflow-level env. deploy.yml compares the grants of rw_app and rw_maint with the snapshot right
// after migrate, and vars.RW_SERVICE_HOST with the hostname the hoster reports. No secret in a command line (AGENTS.md,
// never-rule 5; review finding of 2026-11-10): in a workflow and in a shell script of scripts/, a header or
// a user option of curl never expands a variable that names a secret, a token, a key or a password, on the
// curl line or in an array built for it; the value goes through a file curl reads (-H @<(printf ...)).
// Exit 1 with the list of faults.
import { readFileSync, readdirSync } from "node:fs";

/** The lines of a shell text that put a secret in a command line: `-H "Name: $SECRET"`, `-u "$TOKEN"`. */
export function secretsInArgv(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    // what a process substitution holds is written by the shell itself, never an argument of curl
    const outside = line.replace(/<\([^)]*\)/g, "");
    if (/(?:-H|--header|-u|--user|--oauth2-bearer|--proxy-user)[ =]*["']?[^"'|;]*\$\{?\w*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD)\w*/i.test(outside)) out.push(i + 1);
  });
  return out;
}

/** A workflow's text read as far as these guards need: what stands before `jobs:` (the workflow-level
 * keys, `env` among them), then each job with its name, the jobs it needs, its own keys, and its steps. No
 * YAML parser (this script has no dependency): the layout is the one of this repository's workflows, block
 * style for jobs and steps, at any indentation. */
export function jobsOf(text) {
  const at = text.search(/^jobs:[ \t]*$/m);
  if (at === -1) return { head: text, jobs: [] };
  const head = text.slice(0, at), body = text.slice(at).replace(/^jobs:[ \t]*\n/, "");
  const indent = /^( +)[\w-]+:/m.exec(body)?.[1] ?? "  ";
  const jobs = body.split(new RegExp(`^${indent}(?=[\\w-]+:)`, "m")).slice(1).map((t) => {
    const name = /^([\w-]+):/.exec(t)[1];
    const stepsAt = t.search(/^ +steps:[ \t]*$/m);
    const own = stepsAt === -1 ? t : t.slice(0, stepsAt), rest = stepsAt === -1 ? "" : t.slice(stepsAt).replace(/^ +steps:[ \t]*\n/, "");
    const item = /^( +)- /m.exec(rest)?.[1];
    const steps = item === undefined ? [] : rest.split(new RegExp(`^${item}- `, "m")).slice(1);
    const inline = /^ +needs:[ \t]*(\[[^\]]*\]|[\w-]+)[ \t]*(?:#.*)?$/m.exec(own)?.[1];
    const block = /^ +needs:[ \t]*\n((?: +- *[\w-]+[ \t]*\n)+)/m.exec(own)?.[1];
    const needs = (inline ?? block ?? "").match(/[\w][\w-]*/g) ?? [];
    return { name, text: t, own, steps, needs };
  });
  return { head, jobs };
}

// The scripts of package.json, to follow `npm run <name>` to what it runs (a test points it elsewhere).
const PACKAGE = process.env.RW_PACKAGE_JSON ?? new URL("../package.json", import.meta.url).pathname;
function npmScripts() { try { return JSON.parse(readFileSync(PACKAGE, "utf8")).scripts ?? {}; } catch { return {}; } }
const SMOKE = /(?<!image-)smoke\.mjs/;

/** Does this step run the smoke against a served origin? By its path, or through an npm script whose name
 * or command names it (scripts/image-smoke.mjs, the CI's check of the image over plain http, is another
 * script). A step that reached it some other way (a shell function, a second script) is not seen. */
export function runsSmoke(step, scripts = npmScripts()) {
  if (SMOKE.test(step)) return true;
  for (const m of step.matchAll(/\bnpm[ \t]+(?:run(?:-script)?[ \t]+)?([\w:.-]+)/g)) {
    const name = m[1];
    if (/smoke/i.test(name) && !/image-smoke/i.test(name)) return true;
    if (typeof scripts[name] === "string" && SMOKE.test(scripts[name])) return true;
  }
  return false;
}

/**
 * What is wrong with the way a workflow runs the smoke. Each step that runs it must carry RW_SERVICE_HOST
 * from vars.RW_SERVICE_HOST. And the workflow must refuse when that variable is empty, before a secret is
 * held, by the order the JOBS RUN IN, not the order of the text (review finding of 2026-11-10, C30):
 *   - every job that holds a secret has the refusal among its own steps, before its first step that holds
 *     one, or needs (directly or through other jobs) a job that has it;
 *   - the refusing step has no `if:` and no `continue-on-error:`, and neither has its job a
 *     `continue-on-error:`: a refusal that may be skipped, or that does not stop the job, is none;
 *   - no secret in the workflow-level `env`, nor in the `env` of the refusing job itself: every step
 *     would hold it, the refusal included.
 */
export function smokeHostFaults(text, scripts = npmScripts()) {
  const out = [];
  const { head, jobs } = jobsOf(text);
  const steps = jobs.flatMap((j) => j.steps);
  const smokes = steps.filter((s) => runsSmoke(s, scripts));
  if (!smokes.length) return out;
  const passes = (s) => /RW_SERVICE_HOST:\s*"?\$\{\{\s*vars\.RW_SERVICE_HOST\s*\}\}"?/.test(s);
  if (!smokes.every(passes)) out.push("a step runs scripts/smoke.mjs without RW_SERVICE_HOST from vars.RW_SERVICE_HOST");
  const refuses = (s) => passes(s) && /\[ -n "\$RW_SERVICE_HOST" \] \|\| \{[^}]*exit 1; \}/.test(s);
  const weakened = (s) => /^\s*(?:if|continue-on-error):/m.test(s);
  const all = steps.filter(refuses);
  if (!all.length) { out.push("no step refuses when vars.RW_SERVICE_HOST is empty"); return out; }
  if (all.some(weakened)) out.push("the step that refuses an empty vars.RW_SERVICE_HOST carries if: or continue-on-error: (it may be skipped, or not stop the job)");
  if (/secrets\./.test(head.replace(/^\s*#.*$/gm, ""))) out.push("a secret in the workflow-level env: every step holds it, the refusal of an empty vars.RW_SERVICE_HOST included");
  const by = new Map(jobs.map((j) => [j.name, j]));
  const sound = (j) => !/^\s*continue-on-error:/m.test(j.own) && j.steps.some((s) => refuses(s) && !weakened(s));
  const behind = (j, seen = new Set()) => j.needs.some((n) => { const d = by.get(n); if (!d || seen.has(n)) return false; seen.add(n); return sound(d) || behind(d, seen); });
  for (const j of jobs) {
    if (!/secrets\./.test(j.text.replace(/^\s*#.*$/gm, ""))) continue;
    if (sound(j)) {
      const refusal = j.steps.findIndex((s) => refuses(s) && !weakened(s)), firstSecret = j.steps.findIndex((s) => /secrets\./.test(s));
      if (/secrets\./.test(j.own)) out.push(`the job ${j.name} holds a secret in its own env, before its refusal of an empty vars.RW_SERVICE_HOST`);
      else if (firstSecret !== -1 && firstSecret < refusal) out.push("the refusal of an empty vars.RW_SERVICE_HOST comes after a step that holds a secret (it must come before anything is built or deployed)");
    } else if (!behind(j)) out.push(`the job ${j.name} holds a secret and neither refuses an empty vars.RW_SERVICE_HOST first nor needs a job that does`);
  }
  return out;
}

/** What is wrong with the way deploy.yml checks the database rights and the service's host:
 *   - `roles` is called again, with grants, right after `migrate`, in the same step, which has no `if:`
 *     and no `continue-on-error:` (C28: the comparison with db/schema.snapshot.txt needs the migrated base);
 *   - the step that reads the service's container at the hoster compares vars.RW_SERVICE_HOST with the
 *     hostname the hoster reports, before it writes its outputs (C31: a refusal there leaves `previous`
 *     empty, so the rollback job does not run). */
export function deployChecksFaults(text) {
  const out = [];
  const steps = jobsOf(text).jobs.flatMap((j) => j.steps);
  const weakened = (s) => /^\s*(?:if|continue-on-error):/m.test(s);
  const grants = steps.filter((s) => /scripts\/operator-call\.sh migrate[ \t]*\n\s*scripts\/operator-call\.sh roles '\{"grants":true\}'[ \t]*(?:\n|$)/.test(s));
  if (!grants.length || grants.some(weakened)) out.push("no step compares the grants of rw_app and rw_maint with the snapshot right after migrate (scripts/operator-call.sh roles '{\"grants\":true}', without if: or continue-on-error:)");
  const host = steps.filter((s) => /scripts\/service-host-check\.sh "\$RW_SERVICE_HOST" <<<"\$svc"[ \t]*\n/.test(s) && /RW_SERVICE_HOST:\s*"?\$\{\{\s*vars\.RW_SERVICE_HOST\s*\}\}"?/.test(s));
  if (!host.length || host.some(weakened)) out.push("no step compares vars.RW_SERVICE_HOST with the hostname the hoster reports for the service's container (scripts/service-host-check.sh, without if: or continue-on-error:)");
  else if (host.some((s) => { const w = s.indexOf("GITHUB_OUTPUT"); return w !== -1 && w < s.indexOf("service-host-check.sh"); })) out.push("the comparison of vars.RW_SERVICE_HOST with the hoster's hostname comes after the step wrote its outputs (a refusal must leave the rollback targets empty)");
  return out;
}

const DIR = process.env.RW_WORKFLOWS_DIR ?? new URL("../.github/workflows/", import.meta.url).pathname;
const faults = [];
for (const f of readdirSync(DIR).filter((x) => /\.ya?ml$/.test(x))) {
  const t = readFileSync(DIR + f, "utf8");
  for (const m of t.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    const u = m[1];
    if (u.startsWith("./")) continue;
    if (!/@[0-9a-f]{40}$/.test(u)) faults.push(`${f}: ${u} is not pinned by commit`);
  }
  if (/pull_request_target|workflow_run/.test(t)) faults.push(`${f}: pull_request_target or workflow_run`);
  if (/self-hosted/.test(t)) faults.push(`${f}: a self-hosted runner in a public repository`);
  if (/^(deploy|rollback)\.yml$/.test(f) && !/vars\.RW_DEPLOY_ENABLED == 'true'/.test(t)) faults.push(`${f}: not gated by vars.RW_DEPLOY_ENABLED`);
  for (const fault of smokeHostFaults(t)) faults.push(`${f}: ${fault}`);
  if (f === "deploy.yml") for (const fault of deployChecksFaults(t)) faults.push(`${f}: ${fault}`);
  // push-image builds and pushes before any container exists (ADR-0016): by hand only, from main only
  if (f === "push-image.yml" && (!/^on:\n  workflow_dispatch:\n(?! )/m.test(t) || !/github\.ref == 'refs\/heads\/main'/.test(t))) faults.push(`${f}: not manual-only from main`);
}
const SCRIPTS = process.env.RW_SCRIPTS_DIR ?? new URL("./", import.meta.url).pathname;
for (const [dir, files] of [[DIR, readdirSync(DIR).filter((x) => /\.ya?ml$/.test(x))], [SCRIPTS, readdirSync(SCRIPTS).filter((x) => x.endsWith(".sh"))]]) {
  for (const f of files) for (const n of secretsInArgv(readFileSync(dir + f, "utf8"))) faults.push(`${f}:${n}: a secret in a command line (pass it to curl through a file: -H @<(printf ...))`);
}
const send = readFileSync(DIR + "send.yml", "utf8");
const jobs = send.split(/^  (?=[a-z]+:\s*$)/m);
const job = (name) => jobs.find((j) => j.startsWith(`${name}:`)) ?? "";
const invocations = [...send.matchAll(/\.bin\/runward"\s+check\b[^\n]*/g)].map((m) => m[0]);
if (!invocations.length) faults.push("send.yml: no runward check invocation found (the guard would prove nothing)");
if (invocations.some((l) => /--hooks/.test(l))) faults.push("send.yml: --hooks is passed to runward check");
if (/id-token/.test(job("check")) || /id-token/.test(job("verdict"))) faults.push("send.yml: a job other than send holds id-token");
if (!/permissions: \{ id-token: write \}/.test(job("send"))) faults.push("send.yml: the send job does not hold id-token alone");
if (!/\$RUNNER_TEMP\/rw\/check\.json/.test(job("check"))) faults.push("send.yml: check does not write under $RUNNER_TEMP");
for (const m of job("send").matchAll(/uses:\s*([^@\s]+)@/g)) if (!["actions/download-artifact", "actions/upload-artifact"].includes(m[1])) faults.push(`send.yml: the send job runs ${m[1]}`);
if (faults.length) { console.error(`check-workflows:\n  - ${faults.join("\n  - ")}`); process.exit(1); }
console.log("check-workflows: actions pinned, send.yml's id-token held by send alone, no --hooks, output under $RUNNER_TEMP, the smoke given the service's host and refused by job before any secret, the grants and the service's host compared in deploy.yml, no secret in a command line");
