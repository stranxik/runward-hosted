#!/usr/bin/env node
// Guards on the workflows (T7, T8, T22, T28; PADR-0010 note): every action pinned by a 40-hex commit;
// no pull_request_target or workflow_run anywhere; in send.yml, only the send job holds id-token, the
// check job never passes --hooks and writes under $RUNNER_TEMP, and the send job runs no third-party
// action besides GitHub's artifact actions. A deploy or rollback workflow stays off unless its repository
// variable is set; push-image runs by hand from main only. A step that runs scripts/smoke.mjs against the
// served origin gives it RW_SERVICE_HOST from vars.RW_SERVICE_HOST, and deploy.yml refuses before it builds
// when that variable is empty (found at the first deploy, 2026-11-10: without that host the hoster's router
// answers in the app's place and the smoke cannot prove the app's 421). No secret in a command line (AGENTS.md,
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

/**
 * What is wrong with the way a workflow runs the smoke: each step that runs scripts/smoke.mjs must carry
 * RW_SERVICE_HOST from vars.RW_SERVICE_HOST, and the workflow must refuse, in a step before the first use
 * of a secret, when that variable is empty.
 */
export function smokeHostFaults(text) {
  const out = [];
  const steps = text.split(/^ {6}- /m).slice(1);
  const smokes = steps.filter((s) => /scripts\/smoke\.mjs/.test(s));
  if (!smokes.length) return out;
  const passes = (s) => /RW_SERVICE_HOST:\s*"?\$\{\{\s*vars\.RW_SERVICE_HOST\s*\}\}"?/.test(s);
  if (!smokes.every(passes)) out.push("a step runs scripts/smoke.mjs without RW_SERVICE_HOST from vars.RW_SERVICE_HOST");
  const refusal = steps.findIndex((s) => passes(s) && /\[ -n "\$RW_SERVICE_HOST" \] \|\| \{[^}]*exit 1; \}/.test(s));
  const firstSecret = steps.findIndex((s) => /secrets\./.test(s));
  if (refusal === -1) out.push("no step refuses when vars.RW_SERVICE_HOST is empty");
  else if (firstSecret !== -1 && firstSecret < refusal) out.push("the refusal of an empty vars.RW_SERVICE_HOST comes after a step that holds a secret (it must come before anything is built or deployed)");
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
console.log("check-workflows: actions pinned, send.yml's id-token held by send alone, no --hooks, output under $RUNNER_TEMP, the smoke given the service's host, no secret in a command line");
