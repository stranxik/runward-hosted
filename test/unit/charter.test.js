// The charter's verification commands are exact (independent review of 2026-11-10: AGENTS.md gave
// `verifier-sur-nas.sh . 'npm test'` for the NAS, red as written because the image node:22 has no jq, and
// named a throwaway PostgreSQL on the NAS without a command). What a unit test can hold of it: the commands
// the charter gives exist, parse, and still carry what made the old ones wrong. That they are green as
// written is proven by running them, word for word, on the NAS (the commit that wrote them says so).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (rel) => readFileSync(`${ROOT}${rel}`, "utf8");
const charter = read("AGENTS.md");
const table = charter.split("\n").filter((l) => l.startsWith("| ") && l.includes("`"));

test("the charter: every script it names exists and can be run, and its shell scripts parse", () => {
  const named = [...new Set([...charter.matchAll(/`(?:node )?(scripts\/[\w.-]+\.(?:sh|mjs))/g)].map((m) => m[1]))];
  assert.ok(named.includes("scripts/on-nas.sh") && named.includes("scripts/reference-env.sh"), named.join(", "));
  for (const s of named) {
    assert.doesNotThrow(() => accessSync(`${ROOT}${s}`, s.endsWith(".sh") ? constants.X_OK : constants.R_OK), s);
    if (s.endsWith(".sh")) assert.equal(spawnSync("bash", ["-n", `${ROOT}${s}`]).status, 0, `${s} does not parse`);
  }
});

test("the charter: the suites' NAS commands go through the reference environment, never the bare image; the PostgreSQL row gives its command", () => {
  const row = (start) => table.find((l) => l.startsWith(`| ${start}`)) ?? "";
  assert.match(row("Unit, application, HTTP"), /`scripts\/on-nas\.sh 'npm test'`/);
  assert.match(row("PostgreSQL"), /`scripts\/on-nas\.sh 'npm run test:pg'`/);
  assert.match(row("PostgreSQL"), /`scripts\/reference-env\.sh 'npm run test:pg'`/);
  assert.match(row("The committed reports"), /`scripts\/on-nas\.sh -r 'npm run test:reports:write'`/);
  // the two defects, as they were written
  assert.doesNotMatch(charter, /verifier-sur-nas\.sh \. '/, "a suite run in the bare node image has no jq");
  assert.doesNotMatch(row("PostgreSQL"), /the NAS with a throwaway PostgreSQL 17 at the digest of `ci\.yml` \|$/, "a throwaway PostgreSQL named without its command");
});

test("the reference environment is the CI test job's: the PostgreSQL digest read from ci.yml, the Node.js major from .nvmrc, jq pinned by sha256", () => {
  const env = read("scripts/reference-env.sh");
  const ci = read(".github/workflows/ci.yml");
  // the same reading as the script's
  const digest = /postgres@sha256:[0-9a-f]{64}/.exec(ci)?.[0];
  assert.ok(digest, "ci.yml pins its PostgreSQL by digest");
  assert.ok(env.includes(`grep -o 'postgres@sha256:[0-9a-f]\\{64\\}' .github/workflows/ci.yml`), "the script reads that digest, it does not copy it");
  assert.equal(env.includes(digest), false, "no second copy of the digest to drift");
  assert.match(env, /node_major=\$\(tr -dc '0-9\.' < \.nvmrc/);
  assert.match(env, /^JQ_SHA256=[0-9a-f]{64}$/m);
  assert.match(env, /sha256sum -c --status/);
  assert.match(env, /docker rm -f -v "\$pg"/, "the throwaway server goes with its volume");
  // on-nas runs the command through it, on the copy the author's script made
  const nas = read("scripts/on-nas.sh");
  assert.match(nas, /verifier-sur-nas\.sh" \. true/);
  assert.match(nas, /bash scripts\/reference-env\.sh -/);
});
