// No secret in a command line (AGENTS.md, never-rule 5; review finding of 2026-11-10: the operator's token
// and the hoster's key were arguments of curl in scripts/operator-call.sh, scripts/container-deploy.sh and
// deploy.yml, where every process of the machine reads them). Two proofs: the scripts run for real with a
// curl that records its arguments, and the guard of scripts/check-workflows.mjs refuses the old spelling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const KEY = ["hoster", "key", "9f3a"].join("-"), OPERATOR = ["operator", "token", "c41d"].join("-");
const ID = "11111111-2222-4333-8444-555555555555";
const DIGEST = `rg.fr-par.scw.cloud/runward/runward-hosted@sha256:${"2".repeat(64)}`;

/** A directory holding a `curl` that writes each of its arguments to `log`, then runs the real curl. */
function recordingCurl() {
  const dir = mkdtempSync(join(tmpdir(), "rw-argv-"));
  const real = spawnSync("bash", ["-c", "command -v curl"], { encoding: "utf8" }).stdout.trim();
  assert.ok(real, "curl is required by the scripts and by this test");
  const log = join(dir, "argv.log");
  writeFileSync(join(dir, "curl"), `#!/bin/bash\nprintf '%s\\n' "$@" >> "${log}"\nexec "${real}" "$@"\n`);
  chmodSync(join(dir, "curl"), 0o755);
  return { dir, argv: () => readFileSync(log, "utf8"), remove: () => rmSync(dir, { recursive: true, force: true }) };
}

function run(script, args, env, pathFirst) {
  return new Promise((resolve) => {
    const child = spawn("bash", [join(ROOT, script), ...args], { env: { PATH: `${pathFirst}:${process.env.PATH}`, ...env } });
    let out = "";
    child.stdout.on("data", (c) => (out += c)); child.stderr.on("data", (c) => (out += c));
    const kill = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", (code) => { clearTimeout(kill); resolve({ code, out }); });
  });
}

/** A stand-in that answers only a request carrying the expected headers, and keeps what it received. */
async function standIn(expect, answer) {
  const seen = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push(req.headers);
      const ok = Object.entries(expect).every(([k, v]) => req.headers[k] === v);
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" }).end(JSON.stringify(ok ? answer(req) : { error: "refused" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

test("operator-call.sh: the hoster's key and the operator's token reach the gateway, and neither is an argument of curl", async () => {
  const curl = recordingCurl();
  const gw = await standIn({ "x-auth-token": KEY, "x-rw-operator-token": OPERATOR }, () => ({ gesture: "verify-chains", ok: true, exit: 0 }));
  try {
    const r = await run("scripts/operator-call.sh", ["verify-chains"], { SCW_SECRET_KEY: KEY, RW_OPERATOR_TOKEN: OPERATOR, RW_OPERATOR_URL: gw.url }, curl.dir);
    assert.equal(r.code, 0, r.out);
    assert.equal(gw.seen.length, 1, "the gateway received the call with both headers");
    const argv = curl.argv();
    assert.match(argv, /\/gestures\/verify-chains/, "the recording curl is the one the script ran");
    for (const secret of [KEY, OPERATOR]) { assert.equal(argv.includes(secret), false, "a secret is an argument of curl"); assert.equal(r.out.includes(secret), false); }
  } finally { await gw.close(); curl.remove(); }
});

test("container-deploy.sh: the hoster's key reaches the API on every call, and is never an argument of curl", async () => {
  const curl = recordingCurl();
  const state = { registry_image: DIGEST.replace(/2/g, "1"), status: "ready", environment_variables: { NODE_ENV: "production", RW_IMAGE: "x" } };
  const api = await standIn({ "x-auth-token": KEY }, (req) => {
    if (req.method === "PATCH") { state.registry_image = DIGEST; state.environment_variables.RW_IMAGE = DIGEST; }
    return state;
  });
  try {
    const r = await run("scripts/container-deploy.sh", [ID, DIGEST], { SCW_SECRET_KEY: KEY, SCW_API_URL: api.url }, curl.dir);
    assert.equal(r.code, 0, r.out);
    assert.ok(api.seen.length >= 4, "read, patch, deploy, read");
    const argv = curl.argv();
    assert.match(argv, /containers\/v1beta1/);
    assert.equal(argv.includes(KEY), false, "the key is an argument of curl");
  } finally { await api.close(); curl.remove(); }
});

test("the guard: check-workflows refuses a secret in a curl header or user option, in a workflow or a script, and passes the tree", () => {
  const check = (env = {}) => spawnSync(process.execPath, [join(ROOT, "scripts/check-workflows.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  const clean = check();
  assert.equal(clean.status, 0, clean.stderr);
  const dir = mkdtempSync(join(tmpdir(), "rw-guard-"));
  try {
    const wf = join(dir, "workflows/"), sh = join(dir, "scripts/");
    cpSync(join(ROOT, ".github/workflows"), wf, { recursive: true });
    mkdirSync(sh);
    // each spelling of the defect, as it was written before this fix or could be written again
    const planted = [
      'curl -sS -H "X-Auth-Token: $SCW_SECRET_KEY" "$url"',
      'h=(-H "X-Auth-Token: $SCW_SECRET_KEY")',
      "curl -H \"X-RW-Operator-Token: ${RW_OPERATOR_TOKEN}\" \"$url\"",
      'curl --header "authorization: Bearer $GH_TOKEN" "$url"',
      'curl -u "user:$DB_PASSWORD" "$url"',
    ];
    writeFileSync(join(sh, "planted.sh"), `#!/bin/bash\n${planted.join("\n")}\n# a comment may name -H "X: $SCW_SECRET_KEY"\ncurl -H @<(printf 'X-Auth-Token: %s\\n' "$SCW_SECRET_KEY") -H 'content-type: application/json' "$url"\n`);
    const scripts = check({ RW_WORKFLOWS_DIR: wf, RW_SCRIPTS_DIR: sh });
    assert.equal(scripts.status, 1);
    for (let n = 2; n <= 6; n++) assert.match(scripts.stderr, new RegExp(`planted\\.sh:${n}: a secret in a command line`));
    assert.doesNotMatch(scripts.stderr, /planted\.sh:[78]:/, "a comment and the file form are not faults");
    // in a workflow
    writeFileSync(join(sh, "planted.sh"), "#!/bin/bash\ntrue\n");
    const deploy = readFileSync(join(wf, "deploy.yml"), "utf8");
    const form = `-H @<(printf 'X-Auth-Token: %s\\n' "$SCW_SECRET_KEY")`;
    assert.ok(deploy.includes(form), "deploy.yml passes the key through a file");
    writeFileSync(join(wf, "deploy.yml"), deploy.split(form).join('-H "X-Auth-Token: $SCW_SECRET_KEY"'));
    const workflow = check({ RW_WORKFLOWS_DIR: wf, RW_SCRIPTS_DIR: sh });
    assert.equal(workflow.status, 1);
    assert.match(workflow.stderr, /deploy\.yml:\d+: a secret in a command line/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
