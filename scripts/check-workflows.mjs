#!/usr/bin/env node
// Guards on the workflows (T7, T8, T22, T28; PADR-0010 note): every action pinned by a 40-hex commit;
// no pull_request_target or workflow_run anywhere; in send.yml, only the send job holds id-token, the
// check job never passes --hooks and writes under $RUNNER_TEMP, and the send job runs no third-party
// action besides GitHub's artifact actions. No job of this public repository runs on a self-hosted runner:
// runs-on is one of a closed list of hosted labels, written out on the job's own line; a list, a group, an
// own label, an expression, an alias, an anchor and a quoted or escaped key are refused (runnerFaults). The
// one exemption is send.yml's `runner` input (it runs in the caller's repository; its default is
// ubuntu-24.04, read from the one line that declares it, and no workflow here passes it: a job that calls
// a workflow calls one of this directory, and its `with:` holds names of a closed list). A reading of the
// lines, not of the YAML: what it cannot read as written it refuses, so a spelling GitHub would accept may
// be refused here, never the other way (code review of 2026-11-10 on 144211b, C31 to C33). A deploy or rollback
// workflow stays off unless its repository variable is set; push-image runs by hand from main only. A step that runs scripts/smoke.mjs against the
// served origin gives it RW_SERVICE_HOST from vars.RW_SERVICE_HOST, and deploy.yml refuses before it builds
// when that variable is empty (found at the first deploy, 2026-11-10: without that host the hoster's router
// answers in the app's place and the smoke cannot prove the app's 421); that refusal is read by job (the
// job that holds a secret, or one it needs), cannot carry if: or continue-on-error:, and no secret sits in
// the workflow-level env. deploy.yml compares the grants of rw_app and rw_maint with the snapshot right
// after migrate, and vars.RW_SERVICE_HOST with the hostname the hoster reports. No
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

const RUNNER_INPUT = "${{ fromJSON(inputs.runner) }}";
/** The GitHub-hosted labels this repository's own workflows run on: a closed list. */
export const HOSTED_LABELS = ["ubuntu-24.04"];
/** What a job of this repository may pass to send.yml: its inputs but `runner` (send.yml's own
 *  on.workflow_call.inputs, held equal to this list plus `runner` by sendInputFaults). */
export const CALL_INPUTS = ["mission", "path", "send-strict", "runward-version"];
/** The keys a job that calls a workflow may hold at its own indent. */
const CALL_KEYS = ["name", "needs", "if", "permissions", "uses", "with", "secrets", "concurrency"];
/** A line that names `runner` as a key, in any case, quoted or not, or as an explicit key (`? runner`). */
const RUNNER_KEY = /(?:^|[\s{,?"'])runner["']?\s*:|^\s*\?\s*["']?runner\b/i;
const indent = (l) => /^ */.exec(l)[0].length;

/**
 * Where the jobs of one workflow run: the faults, without the file's name. The reading is closed, not a
 * search for a bad word (review findings C16, 2026-11-10: a quoted key, an alias and a quoted `runner`
 * passed a guard that looked for `runs-on:` lines naming self-hosted):
 * - every job is a block mapping under `jobs:` and holds, at its own indent, exactly one `runs-on` line
 *   or one `uses` line (a call to a reusable workflow); a job in flow style, a job that is an alias and a
 *   job whose `runs-on` key is quoted or escaped have neither, and are refused for that;
 * - the value of `runs-on` is one of HOSTED_LABELS, as written, on the same line, and the line after it
 *   is not indented deeper (a scalar continued on the next line is another label; C33). A list, a group,
 *   a label of one's own (`nas`), an alias and an expression are all outside the list. The one exemption
 *   is send.yml's `${{ fromJSON(inputs.runner) }}`: that workflow runs in its caller's repository;
 * - a job's `uses` names a workflow of this directory (`./.github/workflows/<file>`), which this guard
 *   reads too; where a workflow of another repository runs is read by nothing here (C32);
 * - a job that calls a workflow holds, at its own indent, keys of CALL_KEYS only, each written plainly,
 *   and its `with:` is read from a closed list (CALL_INPUTS): one flow mapping on the line, or one line
 *   per name. `? runner`, `Runner:` and `RUNNER:` are none of them (C31);
 * - the text `runs-on` appears nowhere else outside a comment, so no second spelling of the key exists;
 * - no anchor, no alias, and no \x, \u or \U escape anywhere outside a comment: each one is a way to
 *   write a key or a value the lines above would not read;
 * - no line break but LF and CR LF: a lone CR, U+0085, U+2028 or U+2029 is a line break for some YAML
 *   reader and none for this one, so a job could sit on a line this guard reads as part of another (C33;
 *   scripts/format-check.mjs refuses any CR in a tracked file, this guard no longer relies on it);
 * - the word self-hosted appears nowhere (in send.yml: nowhere outside a comment, its header gives the
 *   word as an example for its callers);
 * - outside send.yml, no `runner` key in any spelling or case: this repository never passes send.yml's
 *   input. In send.yml, see sendInputFaults.
 */
export function runnerFaults(f, t) {
  const out = [];
  const isSend = f === "send.yml";
  if (/\r(?!\n)|[\u0085\u2028\u2029]/.test(t)) out.push("a line break that is not LF or CR LF (a lone CR, U+0085, U+2028 or U+2029): a line this guard reads as one could be two");
  const lines = t.split("\n").map((l) => l.replace(/\r$/, ""));
  const comment = (l) => /^\s*#/.test(l);
  const code = lines.filter((l) => !comment(l));
  if (/self-hosted/.test(isSend ? code.join("\n") : t)) out.push("a self-hosted runner in a public repository");
  for (const l of code) {
    if (/(?:^|:\s+|-\s+|[[{,]\s*)[&*][^\s,[\]{}&*]+(?=\s|$|[,\]}])/.test(l)) out.push(`an anchor or an alias (${l.trim()}): what it stands for is not read where it is used`);
    if (/\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})/.test(l)) out.push(`an escaped character (${l.trim()}): a key or a value could be spelled past the guard`);
    if (!isSend && RUNNER_KEY.test(l)) out.push("this repository calls send.yml with a runner (it is public: hosted runners only)");
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
    if (job.uses) out.push(...callFaults(job));
  };
  for (let i = start + 1; i < end; i++) {
    const l = lines[i];
    if (!l.trim() || comment(l)) continue;
    if (/^ {2}\S/.test(l)) {
      close();
      const m = /^ {2}([A-Za-z_][\w-]*):\s*(?:#.*)?$/.exec(l);
      if (!m) { out.push(`a job that is not a block mapping (${l.trim()}): its runs-on is not read`); job = null; continue; }
      job = { name: m[1], runsOn: 0, uses: 0, lines: [] };
      continue;
    }
    if (/^ ?\S/.test(l)) { out.push(`a line of \`jobs:\` at an odd indent (${l.trim()})`); continue; }
    if (!job) continue;
    job.lines.push(l);
    if (/^ {4}uses:\s*\S/.test(l)) {
      job.uses++;
      if (!/^ {4}uses: \.\/\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml\s*(?:#.*)?$/.test(l)) out.push(`job ${job.name} calls a workflow that is not one of this directory (${l.trim()}): where it runs is not read here`);
    }
    const r = /^ {4}runs-on:(.*)$/.exec(l);
    if (!r) continue;
    job.runsOn++;
    accepted.add(i);
    // the value ends on its line: a line indented deeper right after it would continue it
    const next = lines.slice(i + 1, end).find((x) => x.trim() && !comment(x));
    if (next !== undefined && indent(next) > 4) out.push(`runs-on is continued on the next line (${next.trim()}): its value is not the one written on its line`);
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
    out.push(...sendInputFaults(lines.filter((l) => !comment(l))));
  }
  return [...new Set(out)];
}

/** A job that calls a workflow: its keys and what it passes, read from two closed lists (C31). `job.lines`:
 *  its lines but the comments and the blank ones. */
function callFaults(job) {
  const out = [];
  const named = (text) => /^([A-Za-z][A-Za-z-]*): +\S/.exec(text)?.[1];
  const refuse = (what) => out.push(`job ${job.name}: \`with:\` is not read from the closed list (${what}; accepted: ${CALL_INPUTS.join(", ")})`);
  job.lines.forEach((l, k) => {
    if (indent(l) !== 4) return;
    const key = /^ {4}([a-z-]+):(?: |$)/.exec(l)?.[1];
    if (!CALL_KEYS.includes(key)) { out.push(`job ${job.name}: a key this guard does not read in a job that calls a workflow (${l.trim()}; accepted: ${CALL_KEYS.join(", ")})`); return; }
    if (key !== "with") return;
    const flow = /^ {4}with: \{(.*)\}\s*$/.exec(l);
    const block = [];
    for (let j = k + 1; j < job.lines.length && indent(job.lines[j]) > 4; j++) block.push(job.lines[j]);
    if (flow) {
      // one flow mapping on the line: a value that holds a comma, a brace or a comment is not read, so refused
      if (block.length) refuse(`lines under a flow mapping: ${block[0].trim()}`);
      for (const piece of flow[1].split(",")) if (!CALL_INPUTS.includes(named(piece.trim())) || /[{}[\]#]/.test(piece)) refuse(piece.trim() || "an empty entry");
      return;
    }
    if (!/^ {4}with:\s*$/.test(l) || !block.length) { refuse(l.trim()); return; }
    for (const b of block) if (indent(b) !== 6 || !CALL_INPUTS.includes(named(b.trim()))) refuse(b.trim());
  });
  return out;
}

/** send.yml's `runner` input: the lines of the file but its comments. The block on.workflow_call.inputs is
 *  read as written: one flow mapping per input, on its own line, the names being CALL_INPUTS and `runner`;
 *  `runner` is named by exactly one line of the file, that one, whole, with its default (C31: a second
 *  `default:` and a look-alike line inside a block scalar each passed a guard that looked for the line
 *  anywhere in the file). */
function sendInputFaults(code) {
  const out = [];
  const EXPECTED = /^ {6}runner: \{ type: string, default: '"ubuntu-24\.04"', description: "[^"\\]*" \}$/;
  const at = code.findIndex((l, i) => /^on:$/.test(l) && /^ {2}workflow_call:$/.test(code[i + 1] ?? "") && /^ {4}inputs:$/.test(code[i + 2] ?? ""));
  const inputs = [];
  if (at < 0) out.push("`on: workflow_call: inputs:` is not written on three lines, each key alone (the `runner` input is not read)");
  else for (let i = at + 3; i < code.length && (!code[i].trim() || indent(code[i]) >= 6); i++) if (code[i].trim()) inputs.push(code[i]);
  const names = [];
  for (const l of inputs) {
    const m = /^ {6}([a-z-]+): \{ .* \}$/.exec(l);
    if (!m || ![...CALL_INPUTS, "runner"].includes(m[1])) out.push(`an input that is not one flow mapping on its line, or not of the closed list (${l.trim().slice(0, 60)}; accepted: ${[...CALL_INPUTS, "runner"].join(", ")})`);
    else names.push(m[1]);
  }
  if (at >= 0 && [...names].sort().join() !== [...CALL_INPUTS, "runner"].sort().join()) out.push(`the inputs are not exactly ${[...CALL_INPUTS, "runner"].join(", ")} (found ${names.join(", ") || "none"})`);
  const naming = code.filter((l) => RUNNER_KEY.test(l));
  if (naming.length !== 1 || !inputs.includes(naming[0])) out.push(`the \`runner\` input is not named by exactly one line, inside on.workflow_call.inputs (found ${naming.length} line(s) naming it)`);
  if (!inputs.some((l) => EXPECTED.test(l))) out.push("the `runner` input does not default to \"ubuntu-24.04\"");
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
  // where a job runs (see runnerFaults): a hosted label of the closed list, written out in block style
  for (const fault of runnerFaults(f, t)) faults.push(`${f}: ${fault}`);
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
console.log("check-workflows: actions pinned, hosted runners only (send.yml's runner input defaults to ubuntu-24.04), send.yml's id-token held by send alone, no --hooks, output under $RUNNER_TEMP, the smoke given the service's host and refused by job before any secret, the grants and the service's host compared in deploy.yml, no secret in a command line");
