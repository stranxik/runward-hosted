// The API contract does not drift silently (contracts-governance): the routes and refusals of the tree,
// and the digest the running service serves on /api/version, are the ones committed in
// runward/contracts/api-contract.json. A change of contract is a change of that file, in the same diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { describeContract, CONTRACT_FILE } from "../../scripts/api-contract.mjs";
import { routes, apiContract } from "../../src/http/server.js";
import { fakeAuthn, SEND_SHA } from "../helpers.js";

const committed = JSON.parse(readFileSync(CONTRACT_FILE, "utf8"));

test("the API contract served is the committed one: same routes, same refusals, same digest", () => {
  const clock = manualClock(0);
  const c = compose(readConfig({ RW_STORE: "memory", RW_SEND_WORKFLOW_SHAS: SEND_SHA }), { clock, log: silentLog, store: memoryStore({ clock }), objects: memoryObjects(), authn: fakeAuthn(), verifier: { verify: async () => ({}) } });
  const now = describeContract();
  assert.deepEqual(now.routes, committed.routes, "routes changed: run node scripts/api-contract.mjs --write and commit the contract");
  assert.deepEqual(now.refusals, committed.refusals, "refusals changed: run node scripts/api-contract.mjs --write and commit the contract");
  assert.equal(c.version.apiContract, committed.digest, "the digest /api/version serves");
});

test("planted control: one more route, or a route opened to the public, changes the digest", () => {
  const table = routes(new Proxy({}, { get: () => new Proxy({}, { get: () => () => null }) }));
  assert.equal(apiContract(table), committed.digest);
  assert.notEqual(apiContract([...table, ["GET", "/api/v0/extra", "public", null]]), committed.digest);
  assert.notEqual(apiContract(table.map((r) => (r[1] === "/api/v0/access" ? [r[0], r[1], "public", r[3]] : r))), committed.digest);
});

// The rows live in src/http/routes/, one file per domain (lot L0). A file a lot adds there and forgets to
// name in src/http/server.js#routes would serve nothing, silently: every row every file exports is in the table.
test("every row of every file of src/http/routes is in the route table, once", async () => {
  const dir = new URL("../../src/http/routes/", import.meta.url);
  const handlers = new Proxy({}, { get: () => new Proxy({}, { get: () => () => null }) });
  const key = ([m, p, w]) => `${m} ${p} ${w}`;
  const table = routes(handlers).map(key);
  assert.equal(new Set(table).size, table.length, "no row twice");
  const fromFiles = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js")).sort()) {
    const mod = await import(new URL(f, dir));
    for (const [name, fn] of Object.entries(mod)) if (typeof fn === "function") { assert.match(name, /Routes$/, `${f}: ${name}`); fromFiles.push(...fn(handlers).map(key)); }
  }
  assert.ok(fromFiles.length >= 40, "the guard must see the real rows, or it proves nothing");
  assert.deepEqual([...fromFiles].sort(), [...table].sort());
  // planted control: a row a file exports and the table does not carry is seen
  assert.notDeepEqual([...fromFiles, "GET /api/v0/extra public"].sort(), [...table].sort());
});
