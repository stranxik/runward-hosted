// The warm-up before the port is bound, and what health says of a dependency that turns down (deploys of
// 2026-11-11 and 2026-11-12: a new instance answered /api/health 503, the database "down" once, the object
// store once, seconds after the hoster called it ready; production was sound minutes later). The service
// asks its database and its object store before it binds, again until each answers or a budget is spent,
// says the outcome in one line, and binds whatever the outcome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { readConfig, compose, warm, faultName, WARM_DEFAULTS } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects, s3Objects } from "../../src/adapters/objects/objects.js";
import { systemClock, manualClock } from "../../src/adapters/system/clock.js";
import { jsonLog } from "../../src/adapters/system/log.js";
import { fakeAuthn, SEND_SHA } from "../helpers.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const FAST = { budgetMs: 400, pauseMs: 5, pauseMaxMs: 20 };
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
  assert.deepEqual([down.ok, down.objectStore.ok, down.objectStore.why], [false, false, "answered down"]);
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
  assert.ok(WARM_DEFAULTS.budgetMs > 0 && WARM_DEFAULTS.budgetMs <= 60_000, "the budget of production is a bounded number of seconds");
});

test("through the real S3 adapter: a first call that fails, then a store that answers; the adapter says why its check failed", async () => {
  const kept = new Map(); let failing = 1; const why = [];
  const fetch = async (url, init = {}) => {
    if (failing-- > 0) throw Object.assign(new Error("egress unavailable: s3.test (no answer within 10000 ms)"), { why: "no answer within 10000 ms" });
    const key = new URL(url).pathname;
    if ((init.method ?? "GET") === "PUT") { kept.set(key, Buffer.from(init.body)); return new Response(null, { status: 200 }); }
    return kept.has(key) ? new Response(kept.get(key), { status: 200 }) : new Response(null, { status: 404 });
  };
  let t = 0; // each look at the time is 6 s later: a failed verdict (kept 5 s) is never read twice
  const objects = s3Objects({ endpoint: "https://s3.test", region: "r", bucket: "b", accessKeyId: "k", secretAccessKey: "s", fetch, now: () => (t += 6000), onPingFault: (e) => why.push(faultName(e)) });
  const r = await warm({ store: memoryStore({ clock: systemClock }), objects, log: capture().log, clock: systemClock }, FAST);
  assert.deepEqual([r.ok, r.objectStore.tries], [true, 2]);
  assert.deepEqual(why, ["no answer within 10000 ms"]);
  // a store that answers and keeps nothing says so in words
  const said = [];
  const lost = s3Objects({ endpoint: "https://s3.test", region: "r", bucket: "b", accessKeyId: "k", secretAccessKey: "s", fetch: async (_u, init = {}) => new Response(null, { status: (init.method ?? "GET") === "PUT" ? 200 : 404 }), onPingFault: (e) => said.push(faultName(e)) });
  assert.equal(await lost.ping(), false);
  assert.deepEqual(said, ["witness GET 404"]);
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
    assert.equal((await get()).status, 200);
    assert.deepEqual(lines.filter((l) => l.event === "health.dependency"), [], "a dependency that is ok from the start writes nothing");
    dbDown = true;
    for (let i = 0; i < 3; i++) { const h = await get(); assert.equal(h.status, 503); assert.equal(h.body.db, "down"); }
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

test("the service as it starts: the warm-up's line is written after start and before the port answers; the entry binds after the warm-up", async () => {
  const src = readFileSync(`${ROOT}src/main.js`, "utf8");
  const entry = src.slice(src.indexOf("if (import.meta.url === `file://${process.argv[1]}`)"));
  assert.ok(entry.indexOf("await warm(") > 0 && entry.indexOf("await warm(") < entry.indexOf(".listen("), "the port is bound after the warm-up");
  assert.ok(entry.indexOf('process.on("SIGTERM"') < entry.indexOf("await warm("), "a stop asked during the warm-up is heard");
  const probe = createServer(); await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port; await new Promise((r) => probe.close(r));
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
