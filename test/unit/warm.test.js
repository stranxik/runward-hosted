// The warm-up before the port is bound, and what health says of a dependency that turns down (deploys of
// 2026-11-11 and 2026-11-12: a new instance answered /api/health 503, the database "down" once, the object
// store once, seconds after the hoster called it ready; production was sound minutes later). The service
// asks its database and its object store before it binds, again until each answers or a budget is spent,
// says the outcome in one line, and binds whatever the outcome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, connect } from "node:net";
import { readConfig, compose, warm, warmBudget, faultName, WARM_DEFAULTS } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects, s3Objects } from "../../src/adapters/objects/objects.js";
import { systemClock, manualClock } from "../../src/adapters/system/clock.js";
import { jsonLog } from "../../src/adapters/system/log.js";
import { fakeAuthn, SEND_SHA } from "../helpers.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const FAST = { budgetMs: 400, pauseMs: 5, pauseMaxMs: 20, objectPauseMs: 5, objectPauseMaxMs: 20 };
const capture = () => { const lines = []; return { lines, log: jsonLog({ write: (s) => lines.push(JSON.parse(s)) }) }; };
/** A connection error as the database client throws it: a code, and a message that carries the address. */
const unreachable = () => Object.assign(new Error("connect EHOSTUNREACH 10.0.0.5:5432"), { code: "EHOSTUNREACH" });
/** A dependency whose ping answers what `script` says, call after call (the last entry for ever). */
const scripted = (script) => { let n = 0; return { calls: () => n, ping: async () => { const step = script[Math.min(n++, script.length - 1)]; if (step instanceof Error) throw step; if (step === "hang") return new Promise(() => {}); return step; } }; };

test("both dependencies answer at once: one try each, one info line", async () => {
  const { lines, log } = capture();
  const db = scripted([true]), obj = scripted([true]);
  const r = await warm({ store: db, objects: obj, log, clock: systemClock }, FAST);
  assert.equal(r.ok, true);
  assert.deepEqual([db.calls(), obj.calls()], [1, 1]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, "warm"); assert.equal(lines[0].level, "info");
  assert.deepEqual([lines[0].detail.db.ok, lines[0].detail.db.tries, lines[0].detail.objectStore.ok, lines[0].detail.objectStore.tries], [true, 1, true, 1]);
});

test("a dependency that fails in the instance's first moments is asked again until it answers", async () => {
  const { lines, log } = capture();
  const db = scripted([unreachable(), unreachable(), true]), obj = scripted([false, true]);
  const r = await warm({ store: db, objects: obj, log, clock: systemClock }, FAST);
  assert.equal(r.ok, true);
  assert.deepEqual([r.db.tries, r.objectStore.tries], [3, 2]);
  assert.equal(lines[0].level, "info");
  assert.equal(lines[0].detail.db.why, undefined, "an outcome that is ok keeps no fault");
});

test("the failure path: a dependency down for the whole budget is said, with its code and never its address, and the warm-up ends", async () => {
  const { lines, log } = capture();
  const db = scripted([unreachable()]), obj = scripted([true]);
  const started = Date.now();
  const r = await warm({ store: db, objects: obj, log, clock: systemClock }, FAST);
  const took = Date.now() - started;
  assert.equal(r.ok, false);
  assert.equal(r.db.ok, false); assert.equal(r.db.why, "EHOSTUNREACH"); assert.equal(r.objectStore.ok, true);
  assert.ok(r.db.tries > 2, `asked again: ${r.db.tries}`);
  assert.ok(took >= FAST.budgetMs - 20 && took < FAST.budgetMs + 300, `bounded by the budget: ${took} ms`);
  assert.equal(lines.length, 1); assert.equal(lines[0].level, "warn"); assert.equal(lines[0].event, "warm");
  assert.equal(lines[0].detail.budgetMs, FAST.budgetMs);
  assert.doesNotMatch(JSON.stringify(lines), /10\.0\.0\.5|5432/, "the address the client dialled is not written");
  // the object store that answers down (its ping never throws) is said too
  const down = await warm({ store: scripted([true]), objects: scripted([false]), log: capture().log, clock: systemClock }, FAST);
  assert.deepEqual([down.ok, down.objectStore.ok, down.objectStore.why, down.objectStore.tries], [false, false, "answered down", WARM_DEFAULTS.objectTries]);
  // with what its adapter reported, when it reported
  const told = await warm({ store: scripted([true]), objects: scripted([false]), log: capture().log, clock: systemClock, objectFault: () => "witness GET 404" }, FAST);
  assert.equal(told.objectStore.why, "witness GET 404");
});

test("bounded even when a call never answers: the warm-up does not wait for it beyond the budget", async () => {
  const { lines, log } = capture();
  const started = Date.now();
  const r = await warm({ store: scripted(["hang"]), objects: scripted([true]), log, clock: systemClock }, FAST);
  const took = Date.now() - started;
  assert.ok(took >= FAST.budgetMs - 20 && took < FAST.budgetMs + 300, `${took} ms`);
  assert.deepEqual([r.ok, r.db.tries, r.db.why], [false, 1, "no answer within the budget"]);
  assert.equal(lines[0].level, "warn");
  // planted: without a budget left, nothing is asked
  const none = scripted([true]);
  const spent = await warm({ store: none, objects: scripted([true]), log: capture().log, clock: systemClock }, { ...FAST, budgetMs: 0 });
  assert.deepEqual([spent.ok, none.calls()], [false, 0]);
  assert.ok(WARM_DEFAULTS.budgetMs > 0 && WARM_DEFAULTS.budgetMs <= 15_000, "the budget of production is a bounded number of seconds");
  // RW_WARM_BUDGET_MS shortens it, never lengthens it
  assert.equal(warmBudget(undefined), WARM_DEFAULTS.budgetMs);
  assert.equal(warmBudget("1500"), 1500);
  for (const more of ["600000", "15001", "1e9", "-1", "forever"]) assert.equal(warmBudget(more), WARM_DEFAULTS.budgetMs, more);
  assert.equal(readConfig({ RW_STORE: "memory", RW_WARM_BUDGET_MS: "200" }).warmBudgetMs, 200);
});

test("through the real S3 adapter: a first call that fails, then a store that answers; the warm-up asks past the kept verdict", async () => {
  const kept = new Map(); let failing = 1; const why = [];
  const fetch = async (url, init = {}) => {
    if (failing-- > 0) throw Object.assign(new Error("egress unavailable: s3.test (no answer within 10000 ms)"), { why: "no answer within 10000 ms" });
    const key = new URL(url).pathname;
    if ((init.method ?? "GET") === "PUT") { kept.set(key, Buffer.from(init.body)); return new Response(null, { status: 200 }); }
    return kept.has(key) ? new Response(kept.get(key), { status: 200 }) : new Response(null, { status: 404 });
  };
  // the time does not move: a failed verdict is kept, and only a `fresh` ask goes past it
  const objects = s3Objects({ endpoint: "https://s3.test", region: "r", bucket: "b", accessKeyId: "k", secretAccessKey: "s", fetch, now: () => 0, onPingFault: (e) => why.push(faultName(e)) });
  const r = await warm({ store: memoryStore({ clock: systemClock }), objects, log: capture().log, clock: systemClock }, FAST);
  assert.deepEqual([r.ok, r.objectStore.tries], [true, 2]);
  assert.deepEqual(why, ["no answer within 10000 ms"]);
  // planted: without `fresh`, the kept verdict answers and the store is not asked
  failing = 1;
  const keptVerdict = s3Objects({ endpoint: "https://s3.test", region: "r", bucket: "b", accessKeyId: "k", secretAccessKey: "s", fetch, now: () => 0 });
  assert.deepEqual([await keptVerdict.ping(), await keptVerdict.ping(), await keptVerdict.ping({ fresh: true })], [false, false, true]);
  // a store that answers and keeps nothing says so in words
  const said = [];
  const lost = s3Objects({ endpoint: "https://s3.test", region: "r", bucket: "b", accessKeyId: "k", secretAccessKey: "s", fetch: async (_u, init = {}) => new Response(null, { status: (init.method ?? "GET") === "PUT" ? 200 : 404 }), onPingFault: (e) => said.push(faultName(e)) });
  assert.equal(await lost.ping(), false);
  assert.deepEqual(said, ["witness GET 404"]);
});

test("an object store that fails for the whole warm-up: four real calls, the egress circuit is not opened by the warm-up, and the line says the fault by its code", async () => {
  const { lines, log } = capture();
  const calls = [];
  // what fetch throws when the socket is refused: a message, and the socket's error as its cause
  const refused = async (url) => { calls.push(String(url)); throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 203.0.113.7:443"), { code: "ECONNREFUSED" }) }); };
  const config = readConfig({ RW_STORE: "memory", S3_ENDPOINT: "https://s3.hoster.test", S3_REGION: "r", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", RW_SEND_WORKFLOW_SHAS: SEND_SHA });
  const c = compose(config, { clock: systemClock, log, store: memoryStore({ clock: systemClock }), fetchImpl: refused, authn: fakeAuthn() });
  assert.equal(c.objects.kind, "s3");
  const r = await warm({ store: c.store, objects: c.objects, log, clock: systemClock, objectFault: c.objectFault }, { ...FAST, budgetMs: 2000 });
  assert.deepEqual([r.ok, r.objectStore.ok, r.objectStore.tries, r.objectStore.why], [false, false, 4, "ECONNREFUSED"]);
  assert.equal(calls.length, WARM_DEFAULTS.objectTries, "one real call a try, no more");
  assert.ok(WARM_DEFAULTS.objectTries < 5, "below the circuit's 5 consecutive failures");
  assert.deepEqual(c.egress.circuits()["s3.hoster.test"], { open: false, failed: 4 }, "the circuit is not open when the port is bound");
  const line = lines.find((l) => l.event === "warm");
  assert.equal(line.level, "warn"); assert.equal(line.detail.objectStore.why, "ECONNREFUSED");
  assert.doesNotMatch(JSON.stringify(lines), /203\.0\.113\.7|fetch failed/, "a code, never a message nor the address dialled");
  assert.ok(r.objectStore.ms < 2000, "the tries end before the budget when the store fails fast");
});

test("health says once, in the log, that a dependency turned down and why, and once that it is back", async () => {
  const { lines, log } = capture();
  const clock = manualClock(Date.now());
  const store = memoryStore({ clock }); let dbDown = false;
  store.ping = async () => { if (dbDown) throw unreachable(); return true; };
  // asked as a client asks: the route, on a real socket (the port is known first: the origin names it)
  const probe = createServer(); await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port; await new Promise((r) => probe.close(r));
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: `http://127.0.0.1:${port}`, RW_SEND_WORKFLOW_SHAS: SEND_SHA });
  const c = compose(config, { clock, log, store, objects: memoryObjects(), authn: fakeAuthn() });
  const server = c.http.server; await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const get = async () => { const r = await fetch(`http://127.0.0.1:${port}/api/health`); return { status: r.status, body: await r.json() }; };
  try {
    const sound = await get();
    assert.equal(sound.status, 200); assert.equal(sound.body.commit, config.commit, "health says which revision answers");
    assert.deepEqual(lines.filter((l) => l.event === "health.dependency"), [], "a dependency that is ok from the start writes nothing");
    dbDown = true;
    for (let i = 0; i < 3; i++) { const h = await get(); assert.equal(h.status, 503); assert.equal(h.body.db, "down"); assert.equal(h.body.commit, config.commit); }
    const down = lines.filter((l) => l.event === "health.dependency");
    assert.equal(down.length, 1, "three answers down, one line");
    assert.equal(down[0].level, "warn");
    assert.deepEqual(down[0].detail, { dependency: "db", state: "down", why: "EHOSTUNREACH" });
    assert.doesNotMatch(JSON.stringify(lines), /10\.0\.0\.5/);
    dbDown = false;
    assert.equal((await get()).status, 200); assert.equal((await get()).status, 200);
    const all = lines.filter((l) => l.event === "health.dependency");
    assert.equal(all.length, 2);
    assert.deepEqual([all[1].level, all[1].detail], ["info", { dependency: "db", state: "ok" }]);
  } finally { await new Promise((r) => { server.close(r); server.closeAllConnections?.(); }); }
});

/** A database that accepts the connection and never answers: the client waits (its connect deadline is 10 s). */
async function silentDatabase() {
  const sockets = new Set();
  const server = createServer((so) => { sockets.add(so); so.on("error", () => {}); so.on("close", () => sockets.delete(so)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, close: () => new Promise((r) => { for (const so of sockets) so.destroy(); server.close(r); }) };
}
const freePort = async () => { const probe = createServer(); await new Promise((r) => probe.listen(0, "127.0.0.1", r)); const port = probe.address().port; await new Promise((r) => probe.close(r)); return port; };
/** Is the port bound? true when a connection is accepted, false when it is refused. */
const accepts = (port) => new Promise((res) => { const so = connect(port, "127.0.0.1"); so.on("connect", () => { so.destroy(); res(true); }); so.on("error", () => res(false)); });
/** The service as the image starts it, on a database that never answers. */
function service(port, dbPort, env = {}) {
  const p = spawn(process.execPath, [`${ROOT}src/main.js`], { env: { PATH: process.env.PATH, DATABASE_URL: `postgres://rw_app@127.0.0.1:${dbPort}/rw`, DATABASE_SSL: "disable", RW_OBJECTS: "memory", RW_ORIGIN: `http://127.0.0.1:${port}`, PORT: String(port), RW_BIND: "127.0.0.1", ...env } });
  const state = { out: "", exit: null };
  p.stdout.on("data", (d) => { state.out += d; });
  const closed = new Promise((r) => p.on("close", (code, signal) => { state.exit = { code, signal }; r(state.exit); }));
  const events = () => state.out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { p, state, closed, events };
}

test("the port is bound after the warm-up: while a dependency does not answer, connections are refused; once the line is written, the service answers", async () => {
  const db = await silentDatabase(); const port = await freePort();
  const s = service(port, db.port, { RW_WARM_BUDGET_MS: "1500" });
  try {
    const before = [];
    for (let i = 0; i < 400 && !s.events().some((e) => e.event === "warm") && s.state.exit === null; i++) { before.push(await accepts(port)); await new Promise((r) => setTimeout(r, 25)); }
    const line = s.events().find((e) => e.event === "warm");
    assert.ok(line, `the warm-up's line: ${s.state.out}`);
    assert.ok(before.length >= 10, `the port was asked while the warm-up ran: ${before.length}`);
    assert.ok(before.slice(0, -1).every((bound) => bound === false), "refused before the line (the last ask may cross it)");
    assert.deepEqual([line.level, line.detail.db.ok, line.detail.db.why, line.detail.objectStore.ok, line.detail.budgetMs], ["warn", false, "no answer within the budget", true, 1500]);
    assert.ok(line.ms >= 1400 && line.ms < 4000, `the budget, no more: ${line.ms} ms`);
    assert.deepEqual(s.events().map((e) => e.event).slice(0, 2), ["start", "warm"]);
    // bound whatever the outcome: the service answers, and says which revision it is
    let version = null;
    for (let i = 0; i < 100 && !version; i++) { version = await fetch(`http://127.0.0.1:${port}/api/version`).then((r) => r.json(), () => null); if (!version) await new Promise((r) => setTimeout(r, 25)); }
    assert.equal(typeof version?.commit, "string");
  } finally { s.p.kill("SIGKILL"); await s.closed; await db.close(); }
});

test("a stop asked during the warm-up: the process exits, the port is never bound", async () => {
  const db = await silentDatabase(); const port = await freePort();
  const s = service(port, db.port); // the budget of production: 15 s
  try {
    for (let i = 0; i < 200 && !s.events().some((e) => e.event === "start"); i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await accepts(port), false, "warming up, not bound");
    const asked = Date.now();
    s.p.kill("SIGTERM");
    const bound = [];
    while (s.state.exit === null && Date.now() - asked < 9000) { bound.push(await accepts(port)); await new Promise((r) => setTimeout(r, 25)); }
    const exit = await Promise.race([s.closed, new Promise((r) => setTimeout(() => r(null), 1000))]);
    assert.deepEqual(exit, { code: 0, signal: null }, "exited by itself, status 0");
    assert.ok(Date.now() - asked < 7000, `well before the warm-up's budget: ${Date.now() - asked} ms`);
    assert.ok(bound.every((b) => b === false), "never bound after the stop");
    assert.equal(s.events().some((e) => e.event === "http"), false);
  } finally { s.p.kill("SIGKILL"); await s.closed; await db.close(); }
});

test("the service as it starts on dependencies that answer: start, then the warm-up's line, then it serves", async () => {
  const port = await freePort();
  const p = spawn(process.execPath, [`${ROOT}src/main.js`], { env: { PATH: process.env.PATH, RW_STORE: "memory", RW_ORIGIN: `http://127.0.0.1:${port}`, PORT: String(port), RW_BIND: "127.0.0.1" } });
  let out = ""; p.stdout.on("data", (d) => { out += d; });
  try {
    let answer = null;
    for (let i = 0; i < 100 && !answer; i++) { answer = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json(), () => null); if (!answer) await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(answer?.ok, true);
    const events = out.trim().split("\n").map((l) => JSON.parse(l).event);
    assert.deepEqual(events.slice(0, 3), ["start", "store.memory", "warm"]);
    const line = JSON.parse(out.trim().split("\n")[2]);
    assert.deepEqual([line.level, line.detail.db.ok, line.detail.objectStore.ok], ["info", true, true]);
  } finally { p.kill("SIGTERM"); await new Promise((r) => p.on("close", r)); }
});
