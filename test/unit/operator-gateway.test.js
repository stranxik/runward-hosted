// The operator's gateway (ADR-0016): the two barriers' own half (the token), one role per gesture, the
// deadline, the journal. Each child here is a real Node process; only the script it runs is replaced by a
// stand-in that reports what it received, so the environment crossing the process boundary is the one
// measured, not a mock's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createGateway, gatewayProblems, argvOf, childEnv, GESTURES } from "../../src/operator-gateway.js";

const TOKEN = "op-token-for-tests-only-7f3a";
const URLS = {
  RW_OPERATOR_URL_ADMIN: "postgres://rw_admin:adm%2Fpw-1@172.16.16.2:5432/rdb",
  RW_OPERATOR_URL_OWNER: "postgres://rw_owner:own-pw-2@172.16.16.2:5432/runward_hosted",
  RW_OPERATOR_URL_MAINT: "postgres://rw_maint:mnt-pw-3@172.16.16.2:5432/runward_hosted",
  RW_OPERATOR_URL_APP: "postgres://rw_app:app-pw-4@172.16.16.2:5432/runward_hosted",
};
const ENV = {
  PATH: process.env.PATH, NODE_ENV: "production", DATABASE_SSL: "verify-full", DATABASE_CA: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----",
  RW_OPERATOR_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex"),
  S3_ENDPOINT: "https://s3.fr-par.scw.cloud", S3_REGION: "fr-par", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "AKID", S3_SECRET_ACCESS_KEY: "s3-secret-5",
  RW_WITNESS_TENANTS: "a,b", ...URLS,
};

/** A spawn that runs `script` (Node source) in a real child, with the argv and environment given by the gateway. */
const standIn = (script, seen = []) => (exe, argv, opts) => { seen.push({ argv, env: opts.env }); return spawn(exe, ["-e", script, ...argv], opts); };
const REPORT = "process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), env: process.env }))";

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
      const r = await t.call(`/gestures/${name}`);
      assert.equal(r.status, 200, name);
      const out = await r.json();
      assert.equal(out.role, GESTURES[name].role);
      // the child's report passes through the redactor: the URL itself never comes back to the caller
      assert.doesNotMatch(out.stdout, /pw-\d/, `${name}: no password in the response`);
      const raw = JSON.parse(out.stdout.replace(/"postgres:\/\/\[redacted\]/g, '"R"').replace(/\[redacted\]/g, "R"));
      assert.ok(raw.env[as], `${name} reads ${as}`);
      const creds = Object.keys(raw.env).filter((k) => /URL$|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY/.test(k));
      assert.deepEqual(creds.sort(), [as, ...(s3 ? ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] : [])].sort(), `${name}: exactly its credentials`);
      assert.ok(!Object.keys(raw.env).some((k) => k.startsWith("RW_OPERATOR_")), `${name}: no gateway variable crosses`);
      assert.equal(childEnv(name, ENV)[as], url, `${name}: the URL of ${GESTURES[name].role}`);
    }
    // the scheduled path runs the same gesture, under the same role, without the token
    const s = await t.call("/scheduled/retention", { token: null });
    assert.equal(s.status, 200);
    assert.equal((await s.json()).role, "rw_maint");
    assert.ok(t.lines.some((l) => l.event === "operator.gesture" && l.detail.scheduled && l.detail.gesture === "retention"));
  } finally { await t.close(); }
});

test("a failing gesture is journalled with its exit and its last line, secrets removed, and answered 500", async () => {
  const fail = `process.stderr.write("connecting to " + process.env.MIGRATE_URL + "\\nmigrate: 0002_x.sql changed after it was applied (own-pw-2)\\n"); process.exit(1)`;
  const t = await gateway({ spawn: standIn(fail) });
  try {
    const r = await t.call("/gestures/migrate");
    assert.equal(r.status, 500);
    const out = await r.json();
    assert.deepEqual({ ok: out.ok, exit: out.exit, timedOut: out.timedOut }, { ok: false, exit: 1, timedOut: false });
    assert.doesNotMatch(out.stderr, /own-pw-2/);
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
    assert.equal((await r.json()).timedOut, true);
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
    assert.equal((await t.call("/gestures/verify-chains")).status, 409);
    assert.equal((await first).status, 200);
  } finally { await t.close(); }
});

test("arguments: a closed list per gesture, each checked, passed as argv (never through a shell)", async () => {
  const hash = "a".repeat(64), tenant = "0b9f6b0e-3c2a-4d7e-9f1a-2b3c4d5e6f70";
  assert.deepEqual(argvOf("open-bootstrap", { hash, witness: true, title: "Witness A" }), ["src/operator.js", "open-bootstrap", "--hash", hash, "--witness", "--title", "Witness A"]);
  assert.deepEqual(argvOf("restore-replay", { since: "01JC0000000000000000000000", headBefore: hash }), ["src/operator.js", "restore-replay", "--since", "01JC0000000000000000000000", "--head-before", hash]);
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
    assert.equal((await t.call("/gestures/open-bootstrap", { body: { args: { hash: "nope" } } })).status, 400);
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
