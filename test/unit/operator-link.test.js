// scripts/operator-link.mjs (finding of 2026-11-10): the command it printed, `gh workflow run amorcage.yml
// --repo <the private operator repository>`, could not work: that repository holds no workflow. It prints
// the command that works from the author's workstation, scripts/operator-call.sh with the arguments the
// gateway accepts. Proven here by running the printed command, as printed, against a real gateway.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGateway, argvOf } from "../../src/operator-gateway.js";
import { linkAndCommand } from "../../scripts/operator-link.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const TENANT = "0b9f6b0e-3c2a-4d7e-9f1a-2b3c4d5e6f70", MEMBER = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const OPERATOR = ["operator", "token", "for", "tests"].join("-");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const link = (...args) => spawnSync(process.execPath, [join(ROOT, "scripts/operator-link.mjs"), ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });

/** What a run printed: the token of the link, the digest, the command line. */
function read(out) {
  const tokens = [...out.matchAll(/\/lien#t=([A-Za-z0-9_-]{43})/g)].map((m) => m[1]);
  const command = /^ {2}(scripts\/operator-call\.sh ([a-z-]+) '(.*)')$/m.exec(out);
  return { tokens, command: command?.[1] ?? null, gesture: command?.[2] ?? null, args: command ? JSON.parse(command[3]) : null };
}

test("operator-link: the command printed is a gesture the gateway accepts, with the digest of the link printed, and names no workflow", () => {
  const boot = link("bootstrap");
  assert.equal(boot.status, 0, boot.stderr);
  const b = read(boot.stdout);
  assert.equal(b.tokens.length, 1, "the link is printed once");
  assert.equal(boot.stdout.split(b.tokens[0]).length, 2, "and its token nowhere else");
  assert.deepEqual([b.gesture, b.args], ["open-bootstrap", { hash: sha(b.tokens[0]) }]);
  assert.deepEqual(argvOf(b.gesture, b.args), ["src/operator.js", "open-bootstrap", "--hash", sha(b.tokens[0])], "the gateway's own check accepts it");

  const witness = read(link("bootstrap", "--tenant", TENANT, "--witness", "--title", "Flotte témoin").stdout);
  assert.deepEqual(witness.args, { hash: sha(witness.tokens[0]), tenant: TENANT, witness: true, title: "Flotte témoin" });
  assert.doesNotThrow(() => argvOf(witness.gesture, witness.args));

  const rec = read(link("recovery", "--tenant", TENANT, "--member", MEMBER).stdout);
  assert.deepEqual([rec.gesture, rec.args], ["open-recovery", { hash: sha(rec.tokens[0]), tenant: TENANT, member: MEMBER }]);
  assert.doesNotThrow(() => argvOf(rec.gesture, rec.args));

  const inv = link("invitation");
  assert.deepEqual([inv.status, read(inv.stdout).command, read(inv.stdout).tokens.length], [0, null, 1], "an invitation is opened in the product: a link, no command");

  for (const run of [boot, inv, link("recovery", "--tenant", TENANT, "--member", MEMBER)]) {
    assert.doesNotMatch(run.stdout + run.stderr, /gh workflow run|runward-hosted-ops|\.yml/, "no workflow, no private repository");
  }
});

test("operator-link: arguments the gateway would refuse are refused here, before a link is drawn or a command printed", () => {
  for (const args of [["recovery"], ["recovery", "--tenant", TENANT], ["recovery", "--tenant", "<tenant>", "--member", MEMBER], ["bootstrap", "--tenant", "not-a-uuid"], ["bootstrap", "--title", "two\nlines"], ["bootstrap", "--title", "it's"], ["nothing"]]) {
    const r = link(...args);
    assert.equal(r.status, 2, args.join(" "));
    assert.deepEqual(read(r.stdout), { tokens: [], command: null, gesture: null, args: null }, args.join(" "));
  }
  assert.throws(() => linkAndCommand("recovery", { token: "t", origin: "https://app.runward.dev", tenant: TENANT }), /needs member/);
});

test("operator-link: the printed command, run as printed from the repository's root, is answered 200 by a real gateway, which runs the gesture with the digest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-link-"));
  const report = join(dir, "argv.json");
  const env = {
    PATH: process.env.PATH, RW_OPERATOR_TOKEN_SHA256: sha(OPERATOR),
    ...Object.fromEntries(["ADMIN", "OWNER", "MAINT", "APP"].map((r) => [`RW_OPERATOR_URL_${r}`, ["postgres", "://", "role", "@", "172.16.16.2/db"].join("")])),
    S3_ENDPOINT: "https://s3.invalid", S3_REGION: "fr-par", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "local-only",
  };
  const silent = { info() {}, warn() {}, error() {} };
  // the gesture's script is replaced by a stand-in that reports the argv it received; the gateway is the real one
  const g = createGateway({ env, log: silent, spawn: (exe, argv, opts) => spawn(exe, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(report)}, JSON.stringify(process.argv.slice(1)))`, ...argv], opts) });
  await new Promise((r) => g.server.listen(0, "127.0.0.1", r));
  try {
    for (const args of [["bootstrap"], ["recovery", "--tenant", TENANT, "--member", MEMBER]]) {
      const printed = read(link(...args).stdout);
      // (not spawnSync: the gateway that answers lives in this process)
      const run = await new Promise((resolve) => {
        const child = spawn("bash", ["-c", printed.command], { cwd: ROOT, env: { PATH: process.env.PATH, SCW_SECRET_KEY: "stand-in", RW_OPERATOR_TOKEN: OPERATOR, RW_OPERATOR_URL: `http://127.0.0.1:${g.server.address().port}` } });
        let stdout = "", stderr = "";
        child.stdout.on("data", (c) => (stdout += c)); child.stderr.on("data", (c) => (stderr += c));
        const kill = setTimeout(() => child.kill("SIGKILL"), 20_000);
        child.on("close", (status) => { clearTimeout(kill); resolve({ status, stdout, stderr }); });
      });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stdout, new RegExp(`operator-call: ${printed.gesture} answered HTTP 200 \\(gesture=${printed.gesture} ok=true exit=0\\)`));
      const argv = JSON.parse(readFileSync(report, "utf8"));
      assert.deepEqual(argv.slice(0, 4), ["src/operator.js", printed.gesture, "--hash", sha(printed.tokens[0])], "the gesture ran with the digest of the link that was printed");
      assert.equal(run.stdout.includes(printed.tokens[0]), false, "the link's token never leaves");
    }
  } finally { await new Promise((r) => g.server.close(r)); rmSync(dir, { recursive: true, force: true }); }
});
