// Where the jobs run. send.yml takes an optional `runner` input (a JSON string read by fromJSON in runs-on):
// three customers run their CI on a self-hosted runner, and the workflow forced ubuntu-24.04 on its three
// jobs. The other workflows are this public repository's own: scripts/check-workflows.mjs refuses any
// runs-on that is, or could resolve to, a self-hosted runner. What the service answers to a token minted on
// a self-hosted runner is in test/unit/ingest.test.js (runner-not-hosted).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const SEND = readFileSync(join(ROOT, ".github/workflows/send.yml"), "utf8");

test("send.yml: the three jobs run where the `runner` input says, a JSON string, ubuntu-24.04 by default", () => {
  const input = /^      runner: \{ type: string, default: '([^']+)'/m.exec(SEND);
  assert.ok(input, "send.yml declares a `runner` input, a string with a default");
  assert.equal(JSON.parse(input[1]), "ubuntu-24.04", "the default is the hosted runner the jobs had");
  assert.doesNotMatch(SEND, /^      runner: \{[^}]*required: true/m, "the input is optional");
  const runsOn = [...SEND.matchAll(/^    runs-on:\s*(.*)$/gm)].map((m) => m[1]);
  assert.deepEqual(runsOn, Array(3).fill("${{ fromJSON(inputs.runner) }}"), "check, send and verdict: each reads the input through fromJSON");
  // the input reaches runs-on only: never an env, a script or a step, where it would be text for a shell
  assert.equal(SEND.split("\n").filter((l) => !/^\s*#/.test(l) && /inputs\.runner/.test(l)).length, 3);
  // the example the header gives to a customer is the JSON it says it is
  const example = /runner: '(\[[^']+\])'/.exec(SEND);
  assert.deepEqual(JSON.parse(example[1]), ["self-hosted", "nas"]);
});

test("the guard: check-workflows refuses a runs-on that is or could become a self-hosted runner in this repository, and passes the tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-runner-"));
  const wf = join(dir, "workflows/"), sh = join(dir, "scripts/");
  const check = (env = {}) => spawnSync(process.execPath, [join(ROOT, "scripts/check-workflows.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  /** The guard's answer on a copy of the workflows where `file` went through `change`. */
  const planted = (file, change) => {
    rmSync(wf, { recursive: true, force: true });
    cpSync(join(ROOT, ".github/workflows"), wf, { recursive: true });
    const before = readFileSync(join(wf, file), "utf8"), now = change(before);
    assert.notEqual(now, before, `the control: ${file} was changed`);
    writeFileSync(join(wf, file), now);
    return check({ RW_WORKFLOWS_DIR: wf, RW_SCRIPTS_DIR: sh });
  };
  try {
    mkdirSync(sh);
    // the tree: send.yml names a self-hosted runner in its header, as an example for its callers
    assert.match(SEND, /self-hosted/);
    const clean = check();
    assert.equal(clean.status, 0, clean.stderr);
    const hosted = "    runs-on: ubuntu-24.04\n";
    const cases = [
      ["ci.yml", (t) => t.replace(hosted, "    runs-on: [self-hosted, nas]\n"), /ci\.yml: a self-hosted runner in a public repository/],
      ["ci.yml", (t) => t.replace(hosted, "    runs-on: ${{ fromJSON(vars.CI_RUNNER || '\"ubuntu-24.04\"') }}\n"), /ci\.yml: runs-on is an expression/],
      ["temoin.yml", (t) => t.replace(hosted, "    runs-on: ${{ fromJSON(inputs.runner) }}\n"), /temoin\.yml: runs-on is an expression/],
      ["send.yml", (t) => t.replace("${{ fromJSON(inputs.runner) }}", "${{ fromJSON(vars.CI_RUNNER) }}"), /send\.yml: runs-on is an expression/],
      ["send.yml", (t) => t.replace("default: '\"ubuntu-24.04\"'", "default: '[\"self-hosted\"]'"), /send\.yml: the `runner` input does not default to "ubuntu-24\.04"/],
      ["ci.yml", (t) => `${t}  hosted:\n    uses: ./.github/workflows/send.yml\n    with:\n      mission: runward-hosted\n      runner: '["self-hosted"]'\n`, /ci\.yml: this repository calls send\.yml with a runner/],
    ];
    for (const [file, change, fault] of cases) {
      const r = planted(file, change);
      assert.equal(r.status, 1, `${file}: ${fault}`);
      assert.match(r.stderr, fault);
    }
    // a send job kept on a hosted runner, written out, is not a fault
    assert.equal(planted("send.yml", (t) => t.replace("${{ fromJSON(inputs.runner) }}", "ubuntu-24.04")).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
