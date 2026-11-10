// Configuration and observability: the service does not start half configured and says what is missing
// without a value; a log line carries only its schema's fields; the error rate of the last five minutes
// is counted and shown by /api/health, and the hourly probe raises the alert on it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { jsonLog, silentLog } from "../../src/adapters/system/log.js";
import { githubVerifier } from "../../src/adapters/oidc/github.js";
import { errorWindow } from "../../src/http/limits.js";
import { probeVerdict } from "../../scripts/probe-verdict.mjs";
import { fakeAuthn, testJwk, SEND_SHA } from "../helpers.js";

const MAIN = new URL("../../src/main.js", import.meta.url).pathname;
const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))));

test("the service refuses to start half configured: exit 78, each missing variable named, no value echoed", () => {
  const planted = ["planted", "value", "4f1c"].join("-"); // assembled at run time: no literal secret in the tree
  const env = { PATH: process.env.PATH, NODE_ENV: "production", DATABASE_URL: `postgres://rw_app@10.0.0.4/db?application_name=${planted}`, S3_BUCKET: "b", S3_SECRET_ACCESS_KEY: planted, RW_SEND_WORKFLOW_SHAS: planted };
  const r = spawnSync(process.execPath, [MAIN], { env, encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 78, r.stderr);
  for (const name of ["S3_ENDPOINT", "S3_REGION", "S3_ACCESS_KEY_ID", "DATABASE_CA or DATABASE_CA_FILE", "RW_SEND_WORKFLOW_SHAS"]) assert.match(r.stderr, new RegExp(name), name);
  assert.equal(r.stderr.includes(planted) || r.stdout.includes(planted), false, "no value is echoed");
  assert.throws(() => readConfig({}), (e) => e.problems.some((p) => /DATABASE_URL is required/.test(p)));
});

test("a log line keeps only the fields of its schema: no body, no token, no secret, no path", () => {
  const lines = [];
  const log = jsonLog({ write: (s) => lines.push(s), clock: { now: () => 0 } });
  log.info("http", { requestId: "r-1", status: 200, authorization: "Bearer eyJplanted", body: "{}", secretAccessKey: "k", path: "/home/x" });
  const line = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(line).sort(), ["at", "event", "level", "requestId", "status"]);
  assert.ok(lines[0].endsWith("\n") && lines.length === 1, "one JSON line per event");
});

// Review finding of 2026-11-10: `detail` and `error` were written as given, whatever a caller put in them.
test("a log line's free fields are bounded and scrubbed: no credential, address, path, identifier or second line in detail and error", () => {
  const lines = [];
  const log = jsonLog({ write: (s) => lines.push(s), clock: { now: () => 0 } });
  const planted = {
    url: ["postgres://rw_app:", "pw-9", "@10.0.0.4/db"].join(""), // assembled at run time: no literal credential in the tree
    bearer: ["Bearer eyJhbGciOiJSUzI1NiJ9", "eyJzdWIiOiJ4In0", "c2ln"].join("."),
    email: ["someone", "example.org"].join("@"),
    path: "/home/someone/secret/file.txt",
    id: "0b9f6b0e-3c2a-4d7e-9f1a-2b3c4d5e6f70",
  };
  const text = `failed for ${planted.id} at ${planted.path} by ${planted.email}\nwith ${planted.bearer} on ${planted.url}`;
  log.error("x", { error: `${text} ${"z".repeat(5000)}`, detail: { reason: text, token: "tok-1", nested: { deeper: { deepest: { gone: 1 } } }, list: Array.from({ length: 50 }, (_, i) => i), password: "p" } });
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  for (const v of [...Object.values(planted), "pw-9", "tok-1"]) assert.equal(lines[0].includes(v), false, `${v} reached the log`);
  assert.ok(line.error.length <= 300 && !line.error.includes("\n"), "error: one line, bounded");
  assert.match(line.error, /\[id\] at \[path\] by \[email\] with Bearer \[redacted\] on postgres:\/\/\[redacted\]/);
  assert.deepEqual(Object.keys(line.detail).sort(), ["list", "nested", "reason"], "a key that names a credential is dropped");
  assert.equal(line.detail.list.length, 20);
  assert.equal(line.detail.nested.deeper.deepest, "[nested]");
  log.info("y", { detail: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "v".repeat(300)])) });
  assert.equal(JSON.parse(lines[1]).detail, "[detail too large: cut]");
  // the service's own lines still read as they did
  const start = { origin: "https://app.runward.dev", egress: ["token.actions.githubusercontent.com"], sendWorkflow: 1 };
  log.info("start", { detail: start });
  assert.deepEqual(JSON.parse(lines[2]).detail, start);
});

test("the error rate: answers at 500 or more over five minutes, shown by /api/health", async () => {
  const clock = manualClock(Date.parse("2026-11-08T12:00:00Z"));
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_SEND_WORKFLOW_SHAS: SEND_SHA });
  const broken = { ...fakeAuthn(), async authenticationOptions() { throw new Error("planted failure"); } };
  const c = compose(config, { clock, log: silentLog, store: memoryStore({ clock }), objects: memoryObjects(), authn: broken, verifier: githubVerifier({ fetch: async () => new Response(JSON.stringify({ keys: [testJwk()] })), clock }) });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  servers.push(c.http.server);
  const base = `http://127.0.0.1:${c.http.server.address().port}`;
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${base}/api/v0/auth/options`, { method: "POST", headers: { origin: "https://app.runward.dev" } })).status, 503);
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(h.errors.serverErrors, 3);
  assert.equal(h.errors.requests, 3, "the three answers before this read (the read counts once answered)");
  assert.equal(h.errors.windowSeconds, 300);
  clock.advance(6 * 60_000);
  const later = await (await fetch(`${base}/api/health`)).json();
  assert.equal(later.errors.serverErrors, 0, "five minutes later the window has moved on");
});

test("the error window counts by minute and forgets after five", () => {
  let t = 0;
  const w = errorWindow({ now: () => t });
  for (let i = 0; i < 19; i++) w.record(200);
  w.record(503);
  assert.deepEqual(w.read(), { windowSeconds: 300, requests: 20, serverErrors: 1, rate: 0.05 });
  t = 5 * 60_000;
  assert.equal(w.read().requests, 0);
});

test("the probe alerts on an unavailable service and on an error rate above 5 % over at least 20 requests", () => {
  const up = { ok: true, db: "ok", objectStore: "ok", errors: { windowSeconds: 300, requests: 100, serverErrors: 5, rate: 0.05 } };
  assert.deepEqual(probeVerdict({ healthStatus: 200, health: up, version: { commit: "abc" } }), { ok: true, reasons: [] });
  const erring = { ...up, errors: { windowSeconds: 300, requests: 100, serverErrors: 6, rate: 0.06 } };
  assert.match(probeVerdict({ healthStatus: 200, health: erring, version: { commit: "abc" } }).reasons.join(), /error rate 6\.0 %/);
  const few = { ...up, errors: { windowSeconds: 300, requests: 10, serverErrors: 5, rate: 0.5 } };
  assert.equal(probeVerdict({ healthStatus: 200, health: few, version: { commit: "abc" } }).ok, true, "below 20 requests a rate says nothing");
  assert.match(probeVerdict({ healthStatus: 503, health: { ok: false, db: "down", objectStore: "ok" }, version: { commit: "abc" } }).reasons.join(), /health answered 503 \(db down/);
  assert.match(probeVerdict({ healthStatus: 0, health: null, version: null }).reasons.join(), /version names no commit/);
});
