// The object store's health (finding of the restore drill, 2026-11-10): /api/health said objectStore ok on a
// store whose bucket did not exist. Reproduced on SeaweedFS: writes answered 200, nothing could be read
// back (404), so the security log "written before the commit" was accepted and lost. The ping was a HEAD on
// the bucket, taken for ok below 500. It now writes one fixed object without data and reads it back.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { s3Objects, memoryObjects, WITNESS_KEY, PING_TTL_MS, PING_RETRY_MS } from "../../src/adapters/objects/objects.js";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { fakeAuthn, SEND_SHA } from "../helpers.js";

const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))));

/** A stand-in for an S3 endpoint, behind `fetch`. `mode`: "ok"; "no-bucket" (what SeaweedFS did: every write
 *  answered 200 and kept nowhere, every read 404, HEAD on the bucket 404); "garbled" (reads give other bytes);
 *  "forbidden" (writes answered 403); "down" (no answer). */
function standIn(mode = "ok") {
  const kept = new Map(); const calls = [];
  const state = { mode };
  const fetch = async (url, init = {}) => {
    const key = new URL(url).pathname.replace(/^\/[^/]+\/?/, "");
    const method = init.method ?? "GET";
    calls.push(`${method} ${key}`);
    if (state.mode === "down") throw new Error("connect ECONNREFUSED");
    if (method === "HEAD") return new Response(null, { status: state.mode === "no-bucket" ? 404 : 200 });
    if (method === "PUT") {
      if (state.mode === "forbidden") return new Response("denied", { status: 403 });
      if (state.mode !== "no-bucket") kept.set(key, Buffer.from(init.body));
      return new Response(null, { status: 200 });
    }
    if (method === "GET") {
      if (!kept.has(key)) return new Response("NoSuchKey", { status: 404 });
      return new Response(state.mode === "garbled" ? "other bytes" : kept.get(key), { status: 200 });
    }
    return new Response(null, { status: 405 });
  };
  return { fetch, kept, calls, state };
}
const store = (s3, now) => s3Objects({ endpoint: "http://s3.invalid", region: "fr-par", bucket: "rw-test", accessKeyId: "test", secretAccessKey: "test-only", fetch: s3.fetch, now });

test("the object store is ok only when an object written to the bucket reads back: a bucket that does not exist, though it accepts writes, is down", async () => {
  const missing = standIn("no-bucket");
  assert.equal(await store(missing).ping(), false, "writes answered 200, nothing read back");
  assert.deepEqual(missing.calls, [`PUT ${WITNESS_KEY}`, `GET ${WITNESS_KEY}`]);
  for (const mode of ["garbled", "forbidden", "down"]) assert.equal(await store(standIn(mode)).ping(), false, mode);
  // control: the same check on a store that keeps what it is given
  const ok = standIn("ok");
  assert.equal(await store(ok).ping(), true);
  assert.deepEqual([...ok.kept.keys()], [WITNESS_KEY], "one fixed object");
  assert.equal(/tenant|[0-9a-f]{8}-[0-9a-f]{4}/.test(ok.kept.get(WITNESS_KEY).toString()), false, "which holds no data");
  assert.equal(await memoryObjects().ping(), true);
});

test("the health check costs the store at most one write and one read per period, whatever the traffic; a failure is checked again sooner", async () => {
  let t = 0;
  const s3 = standIn("ok");
  const o = store(s3, () => t);
  const burst = await Promise.all(Array.from({ length: 50 }, () => o.ping()));
  assert.deepEqual([...new Set(burst)], [true]);
  assert.equal(s3.calls.length, 2, "fifty pings at once: one write, one read");
  t = PING_TTL_MS - 1; await o.ping();
  assert.equal(s3.calls.length, 2, "inside the period the verdict is kept");
  s3.state.mode = "no-bucket"; s3.kept.clear();
  t = PING_TTL_MS;
  assert.equal(await o.ping(), false, "after it, the store is asked again");
  assert.equal(s3.calls.length, 4);
  s3.state.mode = "ok";
  t += PING_RETRY_MS - 1; assert.equal(await o.ping(), false);
  t += 1; assert.equal(await o.ping(), true, "a failure is kept for the shorter time");
});

test("/api/health answers 503 with objectStore down when the bucket does not read back", async () => {
  const clock = manualClock(Date.parse("2026-11-10T12:00:00Z"));
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_SEND_WORKFLOW_SHAS: SEND_SHA });
  const s3 = standIn("no-bucket");
  const c = compose(config, { clock, log: silentLog, store: memoryStore({ clock }), objects: store(s3, () => clock.now()), authn: fakeAuthn(), verifier: { async verify() { throw new Error("no upload here"); } } });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  servers.push(c.http.server);
  const health = async () => { const r = await fetch(`http://127.0.0.1:${c.http.server.address().port}/api/health`); return [r.status, (await r.json()).objectStore]; };
  assert.deepEqual(await health(), [503, "down"]);
  s3.state.mode = "ok";
  clock.advance(PING_RETRY_MS);
  assert.deepEqual(await health(), [200, "ok"], "and ok once it does");
});
