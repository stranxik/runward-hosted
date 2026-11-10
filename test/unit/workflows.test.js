// Where the jobs run. send.yml takes an optional `runner` input (a JSON string read by fromJSON in runs-on):
// three customers run their CI on a self-hosted runner, and the workflow forced ubuntu-24.04 on its three
// jobs. The other workflows are this public repository's own: scripts/check-workflows.mjs refuses any
// runs-on that is not one of a closed list of hosted labels, written out (C16: a quoted key, an alias, a
// group and an own label passed a guard that looked for the word). What the service answers to a token minted on
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

test("C16: the guard reads where a job runs from a closed list, so no other spelling passes (quoted key, alias, quoted `runner`, group, own label)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-runner-"));
  const wf = join(dir, "workflows/"), sh = join(dir, "scripts/");
  const planted = (file, change) => {
    rmSync(wf, { recursive: true, force: true });
    cpSync(join(ROOT, ".github/workflows"), wf, { recursive: true });
    const before = readFileSync(join(wf, file), "utf8"), now = change(before);
    assert.notEqual(now, before, `the control: ${file} was changed`);
    writeFileSync(join(wf, file), now);
    return spawnSync(process.execPath, [join(ROOT, "scripts/check-workflows.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH, RW_WORKFLOWS_DIR: wf, RW_SCRIPTS_DIR: sh } });
  };
  const hosted = "    runs-on: ubuntu-24.04\n";
  const call = (withBlock) => (t) => `${t}  hosted:\n    uses: ./.github/workflows/send.yml\n${withBlock}`;
  // each line: the file, the change, the fault. The first five are the review's reproductions: each one
  // passed the guard of d569c95 (exit 0, "hosted runners only").
  const cases = [
    ["ci.yml", (t) => t.replace(hosted, '    "runs-on": [self-hosted, nas]\n'), /ci\.yml: a self-hosted runner in a public repository/],
    ["ci.yml", (t) => t.replace(hosted, "    runs-on: *own\n").replace(/^jobs:$/m, "x-own: &own [self-hosted, nas]\njobs:"), /ci\.yml: an anchor or an alias/],
    ["ci.yml", call(`    with: { mission: runward-hosted, "runner": '["self-hosted"]' }\n`), /ci\.yml: this repository calls send\.yml with a runner/],
    ["ci.yml", call(`    with:\n      mission: runward-hosted\n      "runner": '["self-hosted"]'\n`), /ci\.yml: this repository calls send\.yml with a runner/],
    ["ci.yml", call(`    with:\n      mission: runward-hosted\n      'runner': '"nas"'\n`), /ci\.yml: this repository calls send\.yml with a runner/],
    // never caught before: a group, an own label, with no word to look for
    ["ci.yml", (t) => t.replace(hosted, "    runs-on:\n      group: own-machines\n"), /ci\.yml: runs-on is not a hosted label of the closed list \(a block/],
    ["ci.yml", (t) => t.replace(hosted, "    runs-on: nas\n"), /ci\.yml: runs-on is not a hosted label of the closed list \(nas/],
    ["ci.yml", (t) => t.replace(hosted, "    runs-on: { group: own-machines }\n"), /ci\.yml: runs-on is not a hosted label of the closed list/],
    ["ci.yml", (t) => t.replace(hosted, "    runs-on: [ubuntu-24.04, nas]\n"), /ci\.yml: runs-on is not a hosted label of the closed list/],
    // the same key in spellings a line reader would not see: quoted, escaped, in a flow job, behind an alias
    ["ci.yml", (t) => t.replace(hosted, '    "runs-on": nas\n'), /ci\.yml: job \w+: where it runs is not written out[^\n]*\n[^\n]*`runs-on` outside a job's own line/],
    ["ci.yml", (t) => t.replace(hosted, "    'runs-on': nas\n"), /ci\.yml: job \w+: where it runs is not written out/],
    ["ci.yml", (t) => t.replace(hosted, '    "runs\\x2don": nas\n'), /ci\.yml: an escaped character/],
    ["ci.yml", (t) => t.replace(hosted, '    "runs\\u002don": nas\n'), /ci\.yml: an escaped character/],
    ["ci.yml", (t) => `${t}  own: { runs-on: nas, steps: [{ run: "true" }] }\n`, /ci\.yml: a job that is not a block mapping/],
    ["ci.yml", (t) => `${t}  own: *job\n`.replace(/^jobs:$/m, "x-job: &job\n  runs-on: nas\njobs:"), /ci\.yml: an anchor or an alias/],
    ["ci.yml", (t) => t.replace(hosted, `${hosted}    "runs-on": nas\n`), /ci\.yml: `runs-on` outside a job's own line/],
    ["ci.yml", (t) => t.replace(hosted, "    runs-on: &hosted ubuntu-24.04\n"), /ci\.yml: an anchor or an alias/],
    // send.yml's exemption is its `runner` input and nothing else, and it holds in send.yml only
    ["send.yml", (t) => t.replace("    runs-on: ${{ fromJSON(inputs.runner) }}\n", "    runs-on: nas\n"), /send\.yml: runs-on is not a hosted label of the closed list \(nas/],
    ["send.yml", (t) => t.replace("    runs-on: ${{ fromJSON(inputs.runner) }}\n", "    runs-on: [self-hosted, nas]\n"), /send\.yml: a self-hosted runner in a public repository/],
    ["deploy.yml", (t) => t.replace(hosted, "    runs-on: ${{ fromJSON(inputs.runner) }}\n"), /deploy\.yml: runs-on is an expression/],
  ];
  try {
    mkdirSync(sh);
    for (const [file, change, fault] of cases) {
      const r = planted(file, change);
      assert.equal(r.status, 1, `${file}: ${fault} (stdout: ${r.stdout})`);
      assert.match(r.stderr, fault);
    }
    // what passes: a comment after the label, and a comment line that names a self-hosted runner in send.yml
    assert.equal(planted("ci.yml", (t) => t.replace(hosted, "    runs-on: ubuntu-24.04  # hosted\n")).status, 0);
    assert.match(SEND, /^#.*self-hosted/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Code review of 2026-11-10 on 144211b. C31: the `runner` input still reached send.yml past the guard, by
// a key the line rule did not read (`? runner`, `Runner:`, `RUNNER:`) and by a default read from a line
// that was not the input's. C32: a job that called a workflow of another repository counted as "where it
// runs is written out". C33: a line break this guard did not read as one, and a label continued on the
// next line.
test("C31 to C33: a call's `with:` and send.yml's `runner` input are read from closed lists; a workflow of another repository, a foreign line break and a continued label are refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-runner-"));
  const wf = join(dir, "workflows/"), sh = join(dir, "scripts/");
  const planted = (file, change) => {
    rmSync(wf, { recursive: true, force: true });
    cpSync(join(ROOT, ".github/workflows"), wf, { recursive: true });
    const before = readFileSync(join(wf, file), "utf8"), now = change(before);
    assert.notEqual(now, before, `the control: ${file} was changed`);
    writeFileSync(join(wf, file), now);
    return spawnSync(process.execPath, [join(ROOT, "scripts/check-workflows.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH, RW_WORKFLOWS_DIR: wf, RW_SCRIPTS_DIR: sh } });
  };
  const hosted = "    runs-on: ubuntu-24.04\n";
  const call = (withBlock, uses = "./.github/workflows/send.yml") => (t) => `${t}  hosted:\n    uses: ${uses}\n${withBlock}`;
  const input = /^ {6}runner: \{.*\}\n/m.exec(SEND)[0];
  const closed = /`with:` is not read from the closed list/;
  const one = /send\.yml: the `runner` input is not named by exactly one line, inside on\.workflow_call\.inputs/;
  const notDefault = /send\.yml: the `runner` input does not default to "ubuntu-24\.04"/;
  const brk = /ci\.yml: a line break that is not LF or CR LF/;
  const cases = [
    // C31, the review's reproductions: each passed the guard of 144211b
    ["ci.yml", call("    with:\n      mission: runward-hosted\n      ? runner\n      : '\"nas\"'\n"), closed],
    ["ci.yml", call("    with: { mission: runward-hosted, Runner: '\"nas\"' }\n"), closed],
    ["ci.yml", call("    with:\n      mission: runward-hosted\n      RUNNER: '\"nas\"'\n"), closed],
    ["send.yml", (t) => t.replace(input, input.replace("'\"ubuntu-24.04\"'", "'\"nas\"'")).replace("permissions: {}\njobs:", `x-note: |\n${input}permissions: {}\njobs:`), one],
    ["send.yml", (t) => t.replace(input, input.replace("'\"ubuntu-24.04\"'", "'\"nas\"'")).replace("permissions: {}\njobs:", `x-note: |\n${input}permissions: {}\njobs:`), notDefault],
    // the word rule alone, in each case and as an explicit key, whatever the closed list says
    ["ci.yml", call("    with:\n      mission: runward-hosted\n      ? runner\n      : '\"nas\"'\n"), /ci\.yml: this repository calls send\.yml with a runner/],
    ["ci.yml", call("    with: { mission: runward-hosted, Runner: '\"nas\"' }\n"), /ci\.yml: this repository calls send\.yml with a runner/],
    ["ci.yml", call("    with:\n      mission: runward-hosted\n      RUNNER: '\"nas\"'\n"), /ci\.yml: this repository calls send\.yml with a runner/],
    // the closed list alone: a name that is not an input, a value that could hold a second key, a key of the job spelled another way
    ["ci.yml", call("    with: { mission: runward-hosted, where: nas }\n"), closed],
    ["ci.yml", call("    with: { mission: \"a, where: nas\" }\n"), closed],
    ["ci.yml", call("    with: { mission: runward-hosted, path: { a: b } }\n"), closed],
    ["ci.yml", call("    with: { mission: runward-hosted }\n      where: nas\n"), closed],
    ["ci.yml", call("    with:\n      mission: runward-hosted\n        where: nas\n"), closed],
    ["ci.yml", call("    with:\n      mission:\n        where: nas\n"), closed],
    ["ci.yml", call("    with: nas\n"), closed],
    ["ci.yml", call("    \"with\": { mission: runward-hosted }\n"), /ci\.yml: job hosted: a key this guard does not read in a job that calls a workflow/],
    ["ci.yml", call("    ? with\n    : { mission: runward-hosted }\n"), /ci\.yml: job hosted: a key this guard does not read in a job that calls a workflow/],
    ["ci.yml", call("    strategy: { matrix: { where: [nas] } }\n    with: { mission: runward-hosted }\n"), /ci\.yml: job hosted: a key this guard does not read in a job that calls a workflow/],
    // send.yml's input: one line names it, the expected one, whole, among inputs written one per line
    ["send.yml", (t) => t.replace(input, input.replace("default: '\"ubuntu-24.04\"',", "default: '\"ubuntu-24.04\"', default: '\"nas\"',")), notDefault],
    ["send.yml", (t) => t.replace(input, `${input}      runner: { type: string, default: '"nas"' }\n`), one],
    ["send.yml", (t) => t.replace(input, `${input}      "Runner": { type: string, default: '"nas"' }\n`), one],
    ["send.yml", (t) => t.replace(input, `${input}      ? runner\n      : { type: string, default: '"nas"' }\n`), one],
    ["send.yml", (t) => t.replace(input, "      runner:\n        type: string\n        default: '\"nas\"'\n"), /send\.yml: an input that is not one flow mapping on its line/],
    ["send.yml", (t) => t.replace(input, `${input}      where: { type: string, default: nas }\n`), /send\.yml: an input that is not one flow mapping on its line, or not of the closed list/],
    ["send.yml", (t) => t.replace(input, ""), /send\.yml: the inputs are not exactly mission, path, send-strict, runward-version, runner/],
    ["send.yml", (t) => t.replace("    inputs:\n", "    inputs: # the five\n"), /send\.yml: `on: workflow_call: inputs:` is not written on three lines/],
    // C32
    ["ci.yml", call("    with: { mission: runward-hosted }\n", `stranxik/elsewhere/.github/workflows/send.yml@${"a".repeat(40)}`), /ci\.yml: job hosted calls a workflow that is not one of this directory/],
    ["ci.yml", call("    with: { mission: runward-hosted }\n", "./.github/workflows/../../elsewhere/send.yml"), /ci\.yml: job hosted calls a workflow that is not one of this directory/],
    // C33: a job on a line this guard would read as part of another, and a label continued
    ["ci.yml", (t) => t.replace(hosted, "    runs-on: ubuntu-24.04\r  own:\r    runs-on: nas\n"), brk],
    ...[0x85, 0x2028, 0x2029].map((c) => ["ci.yml", (t) => t.replace(hosted, `    runs-on: ubuntu-24.04${String.fromCharCode(c)}  own:${String.fromCharCode(c)}    steps: []\n`), brk]),
    ["ci.yml", (t) => t.replace(hosted, "    runs-on: ubuntu-24.04\n      nas\n"), /ci\.yml: runs-on is continued on the next line \(nas\)/],
    ["ci.yml", (t) => t.replace(hosted, "    runs-on: ubuntu-24.04\n\n      # a comment\n      nas\n"), /ci\.yml: runs-on is continued on the next line \(nas\)/],
    ["send.yml", (t) => t.replace("    runs-on: ${{ fromJSON(inputs.runner) }}\n", "    runs-on: ${{ fromJSON(inputs.runner) }}\n      nas\n"), /send\.yml: runs-on is continued on the next line \(nas\)/],
  ];
  try {
    mkdirSync(sh);
    for (const [file, change, fault] of cases) {
      const r = planted(file, change);
      assert.equal(r.status, 1, `${file}: ${fault} (stdout: ${r.stdout})`);
      assert.match(r.stderr, fault);
    }
    // what passes: the inputs of the closed list, in flow style and one per line; the tree's own call
    assert.equal(planted("ci.yml", call("    with: { mission: runward-hosted, path: ., send-strict: true, runward-version: \"0.46.0\" }\n")).status, 0);
    assert.equal(planted("ci.yml", call("    needs: test\n    permissions: { contents: read, id-token: write }\n    with:\n      mission: runward-hosted\n      send-strict: true\n")).status, 0);
    assert.match(readFileSync(join(ROOT, ".github/workflows/deploy.yml"), "utf8"), /^ {4}uses: \.\/\.github\/workflows\/send\.yml\n {4}with: \{ mission: runward-hosted, send-strict: true \}$/m);
    // the closed list of a call is send.yml's inputs but `runner`
    const inputs = [...SEND.matchAll(/^ {6}([a-z-]+): \{ type: /gm)].map((m) => m[1]);
    assert.deepEqual(inputs, ["mission", "path", "send-strict", "runward-version", "runner"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
