#!/usr/bin/env node
// The API contract, committed (contracts-governance): the route table (method, path, who may call it) and
// the refusal catalogue (code, status), with the digest /api/version serves. A change to either is a
// change of this file in the same diff; test/unit/contract.test.js fails while they differ.
//   node scripts/api-contract.mjs          print what the tree describes
//   node scripts/api-contract.mjs --write  write runward/contracts/api-contract.json
import { writeFileSync } from "node:fs";
import { routes, apiContract } from "../src/http/server.js";
import { REFUSALS, statusOf } from "../src/domain/refusals.js";

export const CONTRACT_FILE = new URL("../runward/contracts/api-contract.json", import.meta.url).pathname;

export function describeContract() {
  const handlers = new Proxy({}, { get: () => new Proxy({}, { get: () => () => null }) });
  const table = routes(handlers);
  return {
    what: "The HTTP contract of runward hosted: routes and refusals. The digest is the one /api/version serves as apiContract.",
    digest: apiContract(table),
    routes: table.map(([m, p, w]) => `${m} ${p} ${w}`),
    refusals: Object.keys(REFUSALS).sort().map((c) => `${c} ${statusOf(c)}`),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = `${JSON.stringify(describeContract(), null, 2)}\n`;
  if (process.argv.includes("--write")) { writeFileSync(CONTRACT_FILE, text); console.log(`wrote ${CONTRACT_FILE}`); } else process.stdout.write(text);
}
