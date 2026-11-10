// The send step of .github/workflows/send.yml, run for real: the script is extracted from the workflow
// file as GitHub runs it, against a local service and a local token endpoint. Its timers are recorded
// (and not waited for) by a preload, which touches only the timers the script sets itself; its deadlines
// (AbortSignal.timeout) are recorded and shortened the same way. It retries an unavailable service with
// backoff 2 s, 8 s, 30 s, four attempts in all; it never retries a named refusal; a failed upload warns
// without failing the customer's CI unless send-strict is set (checklist-pre-production-resilience); a
// token endpoint that does not answer is cut at its own deadline and retried (review finding of 2026-11-10).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKFLOW = new URL("../../.github/workflows/send.yml", import.meta.url).pathname;
let dir, server, base, answers = [], posts = 0, tokenHangs = 0;

/** The heredoc the send job writes to $RUNNER_TEMP/send.mjs, dedented as the shell writes it. */
function sendScript() {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");
  const start = lines.findIndex((l) => /cat > "\$RUNNER_TEMP\/send\.mjs" <<'SEND'/.test(l));
  const end = lines.findIndex((l, i) => i > start && l.trim() === "SEND");
  assert.ok(start > 0 && end > start, "the send script is in send.yml");
  const body = lines.slice(start + 1, end);
  const indent = body[0].match(/^ */)[0].length;
  return body.map((l) => l.slice(indent)).join("\n");
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "rw-send-"));
  writeFileSync(join(dir, "send.mjs"), sendScript());
  writeFileSync(join(dir, "timers.mjs"), [
    "import { writeFileSync } from 'node:fs';",
    "const real = globalThis.setTimeout, waits = [], deadlines = [], realDeadline = AbortSignal.timeout.bind(AbortSignal);",
    // only the timers the send script itself sets (the HTTP client keeps its own, left untouched)
    "globalThis.setTimeout = (fn, ms, ...a) => { if (!/send\\.mjs/.test(new Error().stack)) return real(fn, ms, ...a); waits.push(ms ?? 0); return real(fn, 0, ...a); };",
    // the script's deadlines, recorded as written and cut to one second, so a test of a hang lasts seconds
    "AbortSignal.timeout = (ms) => { if (!/send\\.mjs/.test(new Error().stack)) return realDeadline(ms); deadlines.push(ms); return realDeadline(Math.min(ms, 1000)); };",
    "process.on('exit', () => writeFileSync(process.env.WAITS_FILE, JSON.stringify({ waits, deadlines })));",
  ].join("\n"));
  server = createServer((req, res) => {
    if (req.url.startsWith("/token")) {
      if (tokenHangs > 0) { tokenHangs--; return; } // a token endpoint that never answers
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ value: "a-token" })); return;
    }
    req.resume();
    req.on("end", () => {
      posts++;
      const [status, body] = answers.shift() ?? [503, {}];
      res.writeHead(status, { "content-type": "application/json", "runward-request-id": "r-test" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.closeAllConnections?.(); server?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

async function runSend(scenario, { strict = false, hangs = 0 } = {}) {
  answers = scenario.slice(); posts = 0; tokenHangs = hangs;
  const run = mkdtempSync(join(dir, "run-"));
  mkdirSync(join(run, "rw", "artifact"), { recursive: true });
  const bytes = Buffer.from('{"verdict":"red"}');
  writeFileSync(join(run, "rw", "artifact", "check.json"), bytes);
  const summary = join(run, "summary.md"); writeFileSync(summary, "");
  const env = {
    PATH: process.env.PATH, MISSION: "m", STRICT: String(strict), SERVICE: base, RUNNER_TEMP: run, GITHUB_STEP_SUMMARY: summary,
    WANT_SHA256: createHash("sha256").update(bytes).digest("hex"), ACTIONS_ID_TOKEN_REQUEST_URL: `${base}/token?api-version=2.0`, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t",
    WAITS_FILE: join(run, "waits.json"),
  };
  const code = await new Promise((resolve) => execFile(process.execPath, ["--import", join(dir, "timers.mjs"), join(dir, "send.mjs")], { env, timeout: 30_000 }, (e) => resolve(e ? e.code : 0)));
  const { waits, deadlines } = JSON.parse(readFileSync(env.WAITS_FILE, "utf8"));
  return { code, posts, waits, deadlines, summary: readFileSync(summary, "utf8") };
}

test("send.yml: an unavailable service is retried with backoff 2 s, 8 s, 30 s, four attempts, then the CI is warned, not failed", async () => {
  const r = await runSend([[503, {}], [503, {}], [502, {}], [503, {}]]);
  assert.equal(r.posts, 4);
  assert.deepEqual(r.waits, [0, 2000, 8000, 30000]);
  assert.equal(r.code, 0, "a failed upload never fails the customer's CI by default");
  assert.match(r.summary, /not sent: service unavailable after 4 attempts/);
});

test("send.yml: a named refusal is never retried, and fails the run only under send-strict", async () => {
  const refused = [403, { refusal: "workflow-not-pinned", message: "m", action: "a" }];
  const r = await runSend([refused]);
  assert.equal(r.posts, 1);
  assert.equal(r.code, 0);
  assert.match(r.summary, /not accepted[\s\S]*workflow-not-pinned/);
  assert.equal((await runSend([refused], { strict: true })).code, 1);
});

test("send.yml: a 429 is retried like an unavailable service, and a later success is sent", async () => {
  const r = await runSend([[429, {}], [503, {}], [201, { entry: "e", seq: 3, head: "h", indexSha256: "i" }]]);
  assert.equal(r.posts, 3);
  assert.deepEqual(r.waits, [0, 2000, 8000]);
  assert.equal(r.code, 0);
  assert.match(r.summary, /runward hosted: sent[\s\S]*seq: 3/);
});

test("send.yml: a token endpoint that does not answer is cut at its own deadline (10 s) and retried like an unavailable service", async () => {
  const r = await runSend([[201, { entry: "e", seq: 4, head: "h", indexSha256: "i" }]], { hangs: 1 });
  assert.equal(r.posts, 1, "the first attempt never reached the service; the second sent");
  assert.deepEqual(r.waits, [0, 2000]);
  assert.equal(r.deadlines.filter((ms) => ms === 10000).length, 2, "each token request carries its deadline");
  assert.equal(r.code, 0);
  assert.match(r.summary, /runward hosted: sent[\s\S]*seq: 4/);
});

// Code review of 2026-11-10, C15: the send job ran `node` and installed none (only the check job has
// setup-node, and the guard forbids a third-party step in the send job). On a caller's runner without
// Node.js the step ended 127 and the run was red whatever send-strict said; with an old one, fetch was
// missing and the summary said "service unavailable after 4 attempts". The job's first step now looks,
// run here as GitHub runs it: the step's script, by bash, with a PATH of our own.
function nodeStep() {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");
  const send = lines.findIndex((l) => l === "  send:"), steps = lines.findIndex((l, i) => i > send && l === "    steps:");
  const first = lines.findIndex((l, i) => i > steps && /^ {6}- /.test(l));
  assert.equal(lines[first], "      - id: node", "the Node.js check is the send job's first step");
  const run = lines.findIndex((l, i) => i > first && l === "        run: |");
  const end = lines.findIndex((l, i) => i > run && !/^ {10}/.test(l) && l.trim() !== "");
  return { script: lines.slice(run + 1, end).map((l) => l.slice(10)).join("\n"), lines, first };
}

async function runNodeStep(pathDir, strict) {
  const run = mkdtempSync(join(dir, "node-"));
  const summary = join(run, "summary.md"), output = join(run, "output.txt");
  writeFileSync(summary, ""); writeFileSync(output, "");
  writeFileSync(join(run, "step.sh"), nodeStep().script);
  const env = { PATH: pathDir, STRICT: String(strict), GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output };
  const r = await new Promise((resolve) => execFile("/bin/bash", ["-e", join(run, "step.sh")], { env, timeout: 30_000 }, (e, stdout) => resolve({ code: e ? e.code : 0, stdout })));
  return { ...r, summary: readFileSync(summary, "utf8"), output: readFileSync(output, "utf8") };
}

test("C15, send.yml: on a runner without Node.js 22 the send job says \"not sent: this runner has no Node.js 22\" and keeps runward's verdict; it fails only with send-strict", async () => {
  const { lines, first } = nodeStep();
  // every later step of the job that needs the file or node runs only when the check passed
  const sendJob = lines.slice(first, lines.findIndex((l, i) => i > first && l === "  verdict:"));
  const stepHeads = sendJob.map((l, i) => [l, i]).filter(([l]) => /^ {6}- /.test(l));
  assert.equal(stepHeads.length, 4);
  for (const [, i] of stepHeads.slice(1, 3)) assert.equal(sendJob[i + 1], "        if: ${{ steps.node.outputs.ok == 'true' }}");
  assert.doesNotMatch(sendJob.join("\n"), /setup-node/, "the send job still installs nothing");

  // a PATH with no node at all
  const none = join(dir, "path-none"); mkdirSync(none);
  // a PATH whose node is too old: the real one, saying it is 18.19.0
  const old = join(dir, "path-old"); mkdirSync(old);
  writeFileSync(join(old, "as-18.cjs"), "Object.defineProperty(process.versions, 'node', { value: '18.19.0' });\n");
  writeFileSync(join(old, "node"), `#!/bin/sh\nexec "${process.execPath}" -r "${join(old, "as-18.cjs")}" "$@"\n`, { mode: 0o755 });
  // a PATH with this very Node.js
  const real = join(dir, "path-real"); mkdirSync(real);
  writeFileSync(join(real, "node"), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });

  for (const [name, path] of [["no node", none], ["Node.js 18", old]]) {
    const lax = await runNodeStep(path, false);
    assert.equal(lax.code, 0, `${name}: the run keeps runward's verdict`);
    assert.match(lax.summary, /^runward hosted: not sent: this runner has no Node\.js 22$/m, name);
    assert.doesNotMatch(lax.summary, /service unavailable/, name);
    assert.equal(lax.output, "ok=false\n", name);
    assert.match(lax.stdout, /^::warning title=runward hosted not sent::this runner has no Node\.js 22$/m);
    const strict = await runNodeStep(path, true);
    assert.equal(strict.code, 1, `${name}: send-strict fails the run`);
    assert.match(strict.summary, /not sent: this runner has no Node\.js 22/);
  }
  for (const strict of [false, true]) {
    const ok = await runNodeStep(real, strict);
    assert.deepEqual([ok.code, ok.output, ok.summary], [0, "ok=true\n", ""], "a runner with Node.js 22 or later goes on, and says nothing");
  }
});
