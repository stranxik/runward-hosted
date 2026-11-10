#!/usr/bin/env node
// Guards on the workflows (T7, T8, T22, T28; PADR-0010 note): every action pinned by a 40-hex commit;
// no pull_request_target or workflow_run anywhere; in send.yml, only the send job holds id-token, the
// check job never passes --hooks and writes under $RUNNER_TEMP, and the send job runs no third-party
// action besides GitHub's artifact actions. No job of this public repository runs on a self-hosted runner:
// runs-on is one of a closed list of hosted labels, written out on the job's own line; a list, a group, an
// own label, an expression, an alias, an anchor and a quoted or escaped key are refused (runnerFaults). The
// one exemption is send.yml's `runner` input (it runs in the caller's repository; its default is
// ubuntu-24.04 and no workflow here passes it, in any spelling of the key). A deploy or rollback
// workflow stays off unless its repository variable is set; push-image runs by hand from main only. No
// secret in a command line (AGENTS.md,
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

const RUNNER_INPUT = "${{ fromJSON(inputs.runner) }}";
/** The GitHub-hosted labels this repository's own workflows run on: a closed list. */
export const HOSTED_LABELS = ["ubuntu-24.04"];

/**
 * Where the jobs of one workflow run: the faults, without the file's name. The reading is closed, not a
 * search for a bad word (review findings C16, 2026-11-10: a quoted key, an alias and a quoted `runner`
 * passed a guard that looked for `runs-on:` lines naming self-hosted):
 * - every job is a block mapping under `jobs:` and holds, at its own indent, exactly one `runs-on` line
 *   or one `uses` line (a call to a reusable workflow); a job in flow style, a job that is an alias and a
 *   job whose `runs-on` key is quoted or escaped have neither, and are refused for that;
 * - the value of `runs-on` is one of HOSTED_LABELS, as written, on the same line. A list, a group, a label
 *   of one's own (`nas`), an alias and an expression are all outside the list. The one exemption is
 *   send.yml's `${{ fromJSON(inputs.runner) }}`: that workflow runs in its caller's repository;
 * - the text `runs-on` appears nowhere else outside a comment, so no second spelling of the key exists;
 * - no anchor, no alias, and no \x, \u or \U escape anywhere outside a comment: each one is a way to
 *   write a key or a value the lines above would not read;
 * - the word self-hosted appears nowhere (in send.yml: nowhere outside a comment, its header gives the
 *   word as an example for its callers);
 * - outside send.yml, no `runner` key in any spelling: this repository never passes send.yml's input.
 */
export function runnerFaults(f, t) {
  const out = [];
  const isSend = f === "send.yml";
  const lines = t.split("\n");
  const comment = (l) => /^\s*#/.test(l);
  const code = lines.filter((l) => !comment(l));
  if (/self-hosted/.test(isSend ? code.join("\n") : t)) out.push("a self-hosted runner in a public repository");
  for (const l of code) {
    if (/(?:^|:\s+|-\s+|[[{,]\s*)[&*][^\s,[\]{}&*]+(?=\s|$|[,\]}])/.test(l)) out.push(`an anchor or an alias (${l.trim()}): what it stands for is not read where it is used`);
    if (/\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})/.test(l)) out.push(`an escaped character (${l.trim()}): a key or a value could be spelled past the guard`);
    if (!isSend && /(?:^|[\s{,])["']?runner["']?\s*:/.test(l)) out.push("this repository calls send.yml with a runner (it is public: hosted runners only)");
  }
  const start = lines.findIndex((l) => /^jobs:\s*(?:#.*)?$/.test(l));
  if (start < 0) { out.push("no `jobs:` block found (the guard would prove nothing)"); return out; }
  let end = lines.findIndex((l, i) => i > start && /^\S/.test(l) && !comment(l));
  if (end < 0) end = lines.length;
  const accepted = new Set();
  let job = null;
  const close = () => {
    if (!job) return;
    if (job.runsOn + job.uses !== 1) out.push(`job ${job.name}: where it runs is not written out (one \`runs-on\` or one \`uses\` at the job's indent, found ${job.runsOn} and ${job.uses})`);
  };
  for (let i = start + 1; i < end; i++) {
    const l = lines[i];
    if (!l.trim() || comment(l)) continue;
    if (/^ {2}\S/.test(l)) {
      close();
      const m = /^ {2}([A-Za-z_][\w-]*):\s*(?:#.*)?$/.exec(l);
      if (!m) { out.push(`a job that is not a block mapping (${l.trim()}): its runs-on is not read`); job = null; continue; }
      job = { name: m[1], runsOn: 0, uses: 0 };
      continue;
    }
    if (/^ ?\S/.test(l)) { out.push(`a line of \`jobs:\` at an odd indent (${l.trim()})`); continue; }
    if (!job) continue;
    if (/^ {4}uses:\s*\S/.test(l)) job.uses++;
    const r = /^ {4}runs-on:(.*)$/.exec(l);
    if (!r) continue;
    job.runsOn++;
    accepted.add(i);
    const v = r[1].replace(/\s+#.*$/, "").trim();
    if (isSend && v === RUNNER_INPUT) continue;
    if (HOSTED_LABELS.includes(v)) continue;
    if (/self-hosted/.test(v)) continue; // named above
    if (/\$\{\{/.test(v)) out.push(`runs-on is an expression (${v}): it could resolve to a self-hosted runner`);
    else out.push(`runs-on is not a hosted label of the closed list (${v || "a block"}; accepted: ${HOSTED_LABELS.join(", ")})`);
  }
  close();
  lines.forEach((l, i) => { if (!comment(l) && /runs-on/.test(l) && !accepted.has(i)) out.push(`\`runs-on\` outside a job's own line (${l.trim()}): a second spelling of the key`); });
  if (isSend) {
    if (!accepted.size) out.push("no runs-on found (the guard would prove nothing)");
    if (!/^      runner: \{ type: string, default: '"ubuntu-24\.04"',/m.test(t)) out.push("the `runner` input does not default to \"ubuntu-24.04\"");
  }
  return [...new Set(out)];
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
  // where a job runs (see runnerFaults): a hosted label of the closed list, written out in block style
  for (const fault of runnerFaults(f, t)) faults.push(`${f}: ${fault}`);
  if (/^(deploy|rollback)\.yml$/.test(f) && !/vars\.RW_DEPLOY_ENABLED == 'true'/.test(t)) faults.push(`${f}: not gated by vars.RW_DEPLOY_ENABLED`);
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
console.log("check-workflows: actions pinned, hosted runners only (send.yml's runner input defaults to ubuntu-24.04), send.yml's id-token held by send alone, no --hooks, output under $RUNNER_TEMP, no secret in a command line");
