// The operator's gateway (ADR-0016): the two barriers' own half (the token), one role per gesture, the
// deadline, the journal, and what leaves the private network (a status and a code, review finding of
// 2026-11-10). Each child here is a real Node process; only the script it runs is replaced by a stand-in
// that reports what it received, in a file of its own, so the environment crossing the process boundary
// is the one measured, not a mock's.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGateway, gatewayProblems, argvOf, childEnv, GESTURES } from "../../src/operator-gateway.js";

const CALL = new URL("../../scripts/operator-call.sh", import.meta.url).pathname;
const DIR = mkdtempSync(join(tmpdir(), "rw-gateway-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

const TOKEN = "op-token-for-tests-only-7f3a";
// Fake credentials, assembled at run time so no line of the repository reads as a connection string with a
// password (the repository's rule, scripts/security-scans.mjs: the secrets scan stays clean, its control proves it live).
const fakeUrl = (user, pw, db) => ["postgres", "://", user, ":", pw, "@", "172.16.16.2:5432/", db].join("");
const URLS = {
  RW_OPERATOR_URL_ADMIN: fakeUrl("rw_admin", "adm%2Fpw-1", "rdb"),
  RW_OPERATOR_URL_OWNER: fakeUrl("rw_owner", "own-pw-2", "runward_hosted"),
  RW_OPERATOR_URL_MAINT: fakeUrl("rw_maint", "mnt-pw-3", "runward_hosted"),
  RW_OPERATOR_URL_APP: fakeUrl("rw_app", "app-pw-4", "runward_hosted"),
};
const ENV = {
  PATH: process.env.PATH, NODE_ENV: "production", DATABASE_SSL: "verify-full", DATABASE_CA: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----",
  RW_OPERATOR_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex"),
  S3_ENDPOINT: "https://s3.fr-par.scw.cloud", S3_REGION: "fr-par", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "AKID", S3_SECRET_ACCESS_KEY: "s3-secret-5",
  RW_WITNESS_TENANTS: "a,b", ...URLS,
};

/** A spawn that runs `script` (Node source) in a real child, with the argv and environment given by the gateway. */
const standIn = (script, seen = []) => (exe, argv, opts) => { seen.push({ argv, env: opts.env }); return spawn(exe, ["-e", script, ...argv], opts); };
const REPORT_FILE = join(DIR, "report.json");
const REPORT = `require("node:fs").writeFileSync(${JSON.stringify(REPORT_FILE)}, JSON.stringify({ argv: process.argv.slice(1), env: process.env }))`;
const reported = () => JSON.parse(readFileSync(REPORT_FILE, "utf8"));

async function gateway(opts) {
  const lines = [];
  const log = { info: (e, f) => lines.push({ level: "info", event: e, ...f }), warn: (e, f) => lines.push({ level: "warn", event: e, ...f }), error: (e, f) => lines.push({ level: "error", event: e, ...f }) };
  const g = createGateway({ env: ENV, log, killGraceMs: 200, ...opts });
  await new Promise((r) => g.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${g.server.address().port}`;
  const call = (path, { token = TOKEN, body } = {}) => fetch(base + path, { method: "POST", headers: { ...(token ? { "x-rw-operator-token": token } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { g, lines, call, base, close: () => new Promise((r) => g.server.close(r)) };
}

test("a call without a valid operator token is refused, journalled, and starts nothing", async () => {
  const seen = [];
  const t = await gateway({ spawn: standIn(REPORT, seen) });
  try {
    for (const token of [null, "", "wrong-token", TOKEN.slice(0, -1)]) {
      const r = await t.call("/gestures/migrate", { token });
      assert.equal(r.status, 401, `token ${JSON.stringify(token)}`);
      assert.deepEqual(await r.json(), { error: "refused" });
    }
    // an unknown gesture is not revealed to a caller without the token
    assert.equal((await t.call("/gestures/no-such", { token: null })).status, 401);
    // the schedule's path reaches the idempotent daily gestures only
    for (const name of ["roles", "migrate", "isolation", "open-bootstrap", "maintenance"]) assert.equal((await t.call(`/scheduled/${name}`, { token: null })).status, 401, name);
    assert.equal(seen.length, 0, "no child was started");
    const refused = t.lines.filter((l) => l.event === "operator.refused");
    assert.equal(refused.length, 10);
    assert.ok(refused.every((l) => l.status === 401 && !JSON.stringify(l).includes(TOKEN.slice(0, 8))), "the journal names the refusal, never a token");
  } finally { await t.close(); }
});

test("each gesture runs under its own role: the child receives that role's URL and no other credential", async () => {
  const t = await gateway({ spawn: standIn(REPORT) });
  try {
    const expect = {
      roles: ["ADMIN_URL", URLS.RW_OPERATOR_URL_ADMIN, false],
      migrate: ["MIGRATE_URL", URLS.RW_OPERATOR_URL_OWNER, false],
      isolation: ["DATABASE_URL", URLS.RW_OPERATOR_URL_APP, false],
      retention: ["DATABASE_URL", URLS.RW_OPERATOR_URL_MAINT, true],
      "verify-chains": ["DATABASE_URL", URLS.RW_OPERATOR_URL_MAINT, true],
    };
    for (const [name, [as, url, s3]] of Object.entries(expect)) {
      rmSync(REPORT_FILE, { force: true }); // each report is this child's own, never the previous one's
      const r = await t.call(`/gestures/${name}`);
      assert.equal(r.status, 200, name);
      assert.deepEqual(await r.json(), { gesture: name, ok: true, exit: 0 }, `${name}: a status and a code, nothing of the child's output`);
      const raw = reported();
      assert.equal(raw.env[as], url, `${name} reads ${as}, the URL of ${GESTURES[name].role}`);
      const creds = Object.keys(raw.env).filter((k) => /URL$|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY/.test(k));
      assert.deepEqual(creds.sort(), [as, ...(s3 ? ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] : [])].sort(), `${name}: exactly its credentials`);
      assert.ok(!Object.keys(raw.env).some((k) => k.startsWith("RW_OPERATOR_")), `${name}: no gateway variable crosses`);
      assert.equal(childEnv(name, ENV)[as], url, `${name}: the URL of ${GESTURES[name].role}`);
    }
    // the scheduled path runs the same gesture, under the same role, without the token
    rmSync(REPORT_FILE, { force: true });
    const s = await t.call("/scheduled/retention", { token: null });
    assert.equal(s.status, 200);
    assert.equal(reported().env.DATABASE_URL, URLS.RW_OPERATOR_URL_MAINT);
    assert.ok(t.lines.some((l) => l.event === "operator.gesture" && l.detail.scheduled && l.detail.gesture === "retention" && l.detail.role === "rw_maint"));
  } finally { await t.close(); }
});

test("a failing gesture is journalled with its exit and its last line, secrets removed, and answered 500", async () => {
  const fail = `process.stderr.write("connecting to " + process.env.MIGRATE_URL + "\\nmigrate: 0002_x.sql changed after it was applied (own-pw-2)\\n"); process.exit(1)`;
  const t = await gateway({ spawn: standIn(fail) });
  try {
    const r = await t.call("/gestures/migrate");
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { gesture: "migrate", ok: false, exit: 1 }, "the reason stays in the gateway's log line");
    const [line] = t.lines.filter((l) => l.event === "operator.gesture");
    assert.equal(line.level, "error");
    assert.equal(line.status, 500);
    assert.deepEqual({ gesture: line.detail.gesture, role: line.detail.role, exit: line.detail.exit }, { gesture: "migrate", role: "rw_owner", exit: 1 });
    assert.match(line.error, /0002_x\.sql changed after it was applied/);
    assert.doesNotMatch(JSON.stringify(t.lines), /pw-\d|rw_owner:/, "no password, no URL in the journal");
  } finally { await t.close(); }
});

test("a gesture past its deadline is killed, answered 504 and journalled; the next call is not blocked", async () => {
  const t = await gateway({ spawn: standIn("setInterval(() => {}, 1000)"), timeouts: { roles: 300 } });
  try {
    const r = await t.call("/gestures/roles");
    assert.equal(r.status, 504);
    assert.deepEqual(await r.json(), { gesture: "roles", ok: false, exit: null });
    const [line] = t.lines.filter((l) => l.event === "operator.gesture");
    assert.match(line.error, /deadline of 300 ms reached, killed/);
    assert.equal((await t.call("/gestures/roles")).status, 504, "the lock was released");
  } finally { await t.close(); }
});

test("one gesture at a time: a second call while one runs is refused 409", async () => {
  const t = await gateway({ spawn: standIn("setTimeout(() => {}, 400)") });
  try {
    const first = t.call("/gestures/retention");
    await new Promise((r) => setTimeout(r, 100));
    const second = await t.call("/gestures/verify-chains");
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: "busy" });
    assert.equal((await first).status, 200);
  } finally { await t.close(); }
});

test("arguments: a closed list per gesture, each checked, passed as argv (never through a shell)", async () => {
  const hash = "a".repeat(64), tenant = "0b9f6b0e-3c2a-4d7e-9f1a-2b3c4d5e6f70";
  assert.deepEqual(argvOf("open-bootstrap", { hash, witness: true, title: "Witness A" }), ["src/operator.js", "open-bootstrap", "--hash", hash, "--witness", "--title", "Witness A"]);
  assert.deepEqual(argvOf("restore-replay", { since: "01JC0000000000000000000000", recoveryHash: hash }), ["src/operator.js", "restore-replay", "--since", "01JC0000000000000000000000", "--recovery-hash", hash]);
  assert.deepEqual(argvOf("restore-replay", { anchor: true }), ["src/operator.js", "restore-replay", "--anchor"]);
  assert.throws(() => argvOf("restore-replay", { since: "01JC0000000000000000000000", headBefore: hash }), /takes no argument headBefore/, "one head for every tenant is no longer an argument");
  assert.deepEqual(argvOf("maintenance", { off: true }), ["src/operator.js", "maintenance", "--off"]);
  assert.throws(() => argvOf("open-bootstrap", {}), /needs hash/);
  assert.throws(() => argvOf("open-bootstrap", { hash: "x; rm -rf /" }), /expected form/);
  assert.throws(() => argvOf("open-recovery", { hash, tenant }), /needs member/);
  assert.throws(() => argvOf("migrate", { dir: "/tmp" }), /takes no argument dir/);
  assert.throws(() => argvOf("maintenance", { on: true, off: true }), /exactly one/);
  assert.throws(() => argvOf("maintenance", { reason: "a\nb", on: true }), /expected form/);
  const seen = [];
  const t = await gateway({ spawn: standIn(REPORT, seen) });
  try {
    const bad = await t.call("/gestures/open-bootstrap", { body: { args: { hash: "nope" } } });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "arguments" }, "a code; the reason is in the gateway's log");
    assert.match(t.lines.find((l) => l.event === "operator.refused").detail.reason, /hash is not in the expected form/);
    assert.equal(seen.length, 0);
    const r = await t.call("/gestures/reset-access", { body: { args: { hash, tenant } } });
    assert.equal(r.status, 200);
    assert.deepEqual(seen[0].argv, ["src/operator.js", "reset-access", "--hash", hash, "--tenant", tenant]);
  } finally { await t.close(); }
});

test("the gateway refuses to start without the token's hash, a role's URL or the bucket's key", () => {
  const missing = gatewayProblems({ ...ENV, RW_OPERATOR_TOKEN_SHA256: "", RW_OPERATOR_URL_APP: "", S3_SECRET_ACCESS_KEY: "" });
  assert.deepEqual(missing, [
    "RW_OPERATOR_TOKEN_SHA256 must be the sha256 (64 hex) of the operator token",
    "RW_OPERATOR_URL_APP is required",
    "S3_SECRET_ACCESS_KEY is required",
  ]);
  assert.throws(() => createGateway({ env: { ...ENV, RW_OPERATOR_TOKEN_SHA256: TOKEN } }), /refused to start/);
  assert.deepEqual(gatewayProblems(ENV), []);
});


// What a gesture's child can print: identifiers of a tenant, a member and a link, a chain head, an error
// message that names them. None of it may leave the private network.
const TENANT = "0b9f6b0e-3c2a-4d7e-9f1a-2b3c4d5e6f70", MEMBER = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", HEAD = "e".repeat(64);
const CHATTY = `console.log(JSON.stringify({ result: { tenant: "${TENANT}", link: "${MEMBER}", head: "${HEAD}" } })); console.error("no such member ${MEMBER} in tenant ${TENANT}"); process.exit(Number(process.argv.includes("--fail")))`;

/** scripts/operator-call.sh, run for real (bash, curl, jq) against `url`; its output is a runner's log. */
function operatorCall(url, gesture, args) {
  return new Promise((resolve) => {
    const env = { PATH: process.env.PATH, SCW_SECRET_KEY: ["stand", "in"].join("-"), RW_OPERATOR_TOKEN: TOKEN, RW_OPERATOR_URL: url };
    const child = spawn("bash", [CALL, gesture, ...(args ? [JSON.stringify(args)] : [])], { env });
    let out = "";
    child.stdout.on("data", (c) => (out += c)); child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("what leaves the private network is a status and a code: no identifier, no head, no message, in the answer or in the runner's log", async () => {
  const t = await gateway({ spawn: standIn(CHATTY) });
  try {
    for (const [name, status] of [["verify-chains", 200], ["retention", 200]]) {
      const r = await t.call(`/gestures/${name}`);
      const text = await r.text();
      assert.equal(r.status, status);
      assert.deepEqual(JSON.parse(text), { gesture: name, ok: true, exit: 0 });
      for (const id of [TENANT, MEMBER, HEAD]) assert.ok(!text.includes(id), `${name}: ${id} left in the answer`);
    }
    const call = await operatorCall(t.base, "verify-chains");
    assert.equal(call.code, 0);
    assert.equal(call.out.trim(), "operator-call: verify-chains answered HTTP 200 (gesture=verify-chains ok=true exit=0)");
    const failed = await operatorCall(t.base, "restore-replay", { since: "01JC0000000000000000000000" });
    assert.equal(failed.code, 0, "the stand-in succeeds without --fail");
    // the reason of a failure stays in the gateway's log line at the hoster
    const t2 = await gateway({ spawn: (exe, argv, opts) => spawn(exe, ["-e", CHATTY, ...argv, "--fail"], opts) });
    try {
      const f = await operatorCall(t2.base, "open-recovery", { hash: "a".repeat(64), tenant: TENANT, member: MEMBER });
      assert.equal(f.code, 1);
      assert.equal(f.out.trim(), "operator-call: open-recovery answered HTTP 500 (gesture=open-recovery ok=false exit=1)");
      assert.match(t2.lines.find((l) => l.event === "operator.gesture").error, /no such member/);
    } finally { await t2.close(); }
  } finally { await t.close(); }
});

test("operator-call.sh prints only the closed fields, even from a gateway that answers more (an older image after a rollback)", async () => {
  const older = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ gesture: "open-bootstrap", role: "rw_maint", ok: true, exit: 0, stdout: `{"tenant":"${TENANT}","link":"${MEMBER}"}`, stderr: `head ${HEAD}`, error: `tenant ${TENANT}` }));
    });
  });
  await new Promise((r) => older.listen(0, "127.0.0.1", r));
  try {
    const r = await operatorCall(`http://127.0.0.1:${older.address().port}`, "open-bootstrap", { hash: "a".repeat(64), tenant: TENANT, witness: true });
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "operator-call: open-bootstrap answered HTTP 200 (gesture=open-bootstrap ok=true exit=0)");
    for (const id of [TENANT, MEMBER, HEAD]) assert.ok(!r.out.includes(id), `${id} reached the runner's log`);
  } finally { await new Promise((r) => older.close(r)); }
});

// Review finding of 2026-11-10 (independent review, async-job-guardrails): a daily job killed at its
// deadline, or one that ended before it could write, wrote no note; a job refused 409 because the other
// still ran wrote none either. Each was seen only a day later, by the rule on a job that has not run.
// The gateway now has the note written by a second, short child; the answer to the caller does not change.
const NOTES = (seen) => seen.filter((s) => s.argv[1] === "job-note").map((s) => s.argv.slice(2).join(" "));
// a stand-in that hangs as a job, and ends at once as the note's child
const HANG = `if (process.argv.includes("job-note")) process.exit(0); setInterval(() => {}, 1000)`;

test("a daily job killed at its deadline gets its note from the gateway, written under rw_maint; the answer is still 504", async () => {
  const seen = [];
  const t = await gateway({ spawn: standIn(HANG, seen), timeouts: { retention: 300, roles: 300 } });
  try {
    const r = await t.call("/scheduled/retention", { token: null });
    assert.equal(r.status, 504);
    assert.deepEqual(await r.json(), { gesture: "retention", ok: false, exit: null }, "the answer is the one of a killed gesture");
    assert.deepEqual(NOTES(seen), ["--job retention --why deadline"]);
    const note = seen.find((s) => s.argv[1] === "job-note");
    assert.equal(note.env.DATABASE_URL, URLS.RW_OPERATOR_URL_MAINT, "the note's child holds rw_maint's URL");
    for (const k of ["ADMIN_URL", "MIGRATE_URL", "RW_OPERATOR_TOKEN_SHA256"]) assert.equal(k in note.env, false, k);
    assert.deepEqual(t.lines.filter((l) => l.event === "operator.job-note").map((l) => [l.level, l.detail.gesture, l.detail.why]), [["info", "retention", "deadline"]]);
    // control: a gesture that is not a daily job is killed without a note
    assert.equal((await t.call("/gestures/roles")).status, 504);
    assert.equal(NOTES(seen).length, 1);
  } finally { await t.close(); }
});

test("a daily job that ended without saying its status gets the note; one that said it wrote its own, and gets none", async () => {
  const seen = [];
  const crash = `if (process.argv.includes("job-note")) process.exit(0); console.error("operator: verify-chains refused: connect ECONNREFUSED"); process.exit(1)`;
  const t = await gateway({ spawn: standIn(crash, seen) });
  try {
    assert.equal((await t.call("/scheduled/verify-chains", { token: null })).status, 500);
    assert.deepEqual(NOTES(seen), ["--job verify-chains --why exit"]);
  } finally { await t.close(); }
  const seen2 = [];
  const said = `console.log(JSON.stringify({ gesture: "retention", ok: false })); console.error("operator: retention did not complete: 1 tenant(s) failed or broken"); process.exit(1)`;
  const t2 = await gateway({ spawn: standIn(said, seen2) });
  try {
    assert.equal((await t2.call("/scheduled/retention", { token: null })).status, 500);
    assert.deepEqual(NOTES(seen2), [], "the job wrote its own note, with the tenants that failed: the gateway adds nothing");
    assert.equal((await t2.call("/gestures/retention")).status, 500);
    assert.deepEqual(NOTES(seen2), []);
  } finally { await t2.close(); }
});

test("a daily job refused because another gesture runs gets its note; the note that cannot be written is journalled and changes no answer", async () => {
  const seen = [];
  const slow = `if (process.argv.includes("job-note")) process.exit(0); setTimeout(() => { console.log(JSON.stringify({ gesture: process.argv[2], ok: true })); }, 400)`;
  const t = await gateway({ spawn: standIn(slow, seen) });
  try {
    const first = t.call("/scheduled/retention", { token: null });
    await new Promise((r) => setTimeout(r, 100));
    const second = await t.call("/scheduled/verify-chains", { token: null });
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: "busy" });
    assert.deepEqual(NOTES(seen), ["--job verify-chains --why busy"]);
    assert.equal((await first).status, 200);
    // a gesture that is not a daily job, refused busy, gets none
    const again = t.call("/scheduled/retention", { token: null });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await t.call("/gestures/roles")).status, 409);
    await again;
    assert.equal(NOTES(seen).length, 1);
  } finally { await t.close(); }
  // the note's child fails (the database cannot be reached): said in the gateway's log, the answer unchanged
  const failing = `if (process.argv.includes("job-note")) { console.error("operator: job-note refused: connect ECONNREFUSED " + process.env.DATABASE_URL); process.exit(1); } setInterval(() => {}, 1000)`;
  const t2 = await gateway({ spawn: standIn(failing), timeouts: { retention: 300 } });
  try {
    const r = await t2.call("/scheduled/retention", { token: null });
    assert.deepEqual([r.status, await r.json()], [504, { gesture: "retention", ok: false, exit: null }]);
    const [line] = t2.lines.filter((l) => l.event === "operator.job-note");
    assert.deepEqual([line.level, line.detail.why, line.detail.exit], ["error", "deadline", 1]);
    assert.match(line.error, /job-note refused/);
    assert.doesNotMatch(JSON.stringify(t2.lines), /pw-\d/, "no password in the journal");
  } finally { await t2.close(); }
});
