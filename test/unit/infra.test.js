// What infra/scaleway/main.tf must hold so that a plan after `roles` and `migrate` proposes nothing (found
// on 2026-11-10, in the first plan after the first deploy): the hoster reports the level of rw_app and
// rw_maint as "custom" once db/grants.sql is applied, and the plan proposed to reset them to "readonly";
// it stores the containers' memory in MB of 10^6 bytes, and the plan proposed to change it back. A text
// check: the plan itself needs the real state and is read by the operator (runward/runbook.md §12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tf = readFileSync(new URL("../../infra/scaleway/main.tf", import.meta.url), "utf8");
/** The body of a resource block, from its header to the closing brace in column 0. */
const block = (type, name) => {
  const m = new RegExp(`^resource "${type}" "${name}" \\{\\n([\\s\\S]*?)\\n\\}$`, "m").exec(tf);
  assert.ok(m, `${type}.${name} is declared`);
  return m[1];
};

test("the privileges of rw_app and rw_maint are set at creation and left alone afterwards; rw_owner's level is still compared", () => {
  for (const user of ["rw_app", "rw_maint"]) {
    const b = block("scaleway_rdb_privilege", user);
    assert.match(b, /^\s*permission\s*=\s*"readonly"/m, `${user} is created readonly, the smallest level that carries CONNECT`);
    assert.match(b, /lifecycle \{\s*ignore_changes = \[permission\]\s*\}/, `${user}: a plan never resets the grants of db/grants.sql`);
  }
  const owner = block("scaleway_rdb_privilege", "rw_owner");
  assert.match(owner, /^\s*permission\s*=\s*"all"/m);
  assert.doesNotMatch(owner, /ignore_changes/, "rw_owner's level is not hidden from a plan");
});

test("the containers' memory is the value the hoster stores, a whole number of MB of 10^6 bytes, and is not ignored", () => {
  for (const name of ["rw", "operator"]) {
    const b = block("scaleway_container", name);
    const bytes = Number(/^\s*memory_limit_bytes\s*=\s*(\d+)/m.exec(b)?.[1]);
    assert.equal(bytes, 536_000_000, `${name}: what the hoster keeps of 512 MiB`);
    assert.equal(bytes % 1_000_000, 0);
    assert.doesNotMatch(/ignore_changes = \[([^\]]*)\]/.exec(b)[1], /memory/, `${name}: a change of the memory still shows in a plan`);
  }
});
