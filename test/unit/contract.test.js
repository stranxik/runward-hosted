// The API contract does not drift silently (contracts-governance): the routes and refusals of the tree,
// and the digest the running service serves on /api/version, are the ones committed in
// runward/contracts/api-contract.json. A change of contract is a change of that file, in the same diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
