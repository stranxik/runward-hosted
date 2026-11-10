// The registry purge (ADR-0016): the 5 newest stay, a digest still served or named for rollback stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toPurge } from "../../scripts/registry-purge.mjs";

const d = (n) => `sha256:${String(n).padStart(64, "0")}`;
const tags = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, name: `c${i}`, digest: d(i), created_at: new Date(Date.UTC(2026, 10, 1 + i)).toISOString() }));

test("the 5 newest tags stay, the older ones go, whatever order the API answers in", () => {
  assert.deepEqual(toPurge([...tags].reverse(), { keep: 5, protect: [`rg.fr-par.scw.cloud/runward/runward-hosted@${d(8)}`] }).map((t) => t.id).sort(), ["t0", "t1", "t2", "t3"]);
});

test("a digest still named by a container or the rollback target is never deleted", () => {
  const out = toPurge(tags, { keep: 5, protect: [`x@${d(8)}`, `x@${d(1)}`] });
  assert.deepEqual(out.map((t) => t.id).sort(), ["t0", "t2", "t3"]);
});

test("nothing is guessed: an unreadable tag or protection stops the purge", () => {
  assert.throws(() => toPurge([...tags, { id: "z", name: "z", digest: "", created_at: "2026-11-01" }], { protect: [`x@${d(1)}`] }), /no readable digest/);
  assert.throws(() => toPurge(tags, { protect: ["latest"] }), /not a digest reference/);
  assert.throws(() => toPurge(tags, { keep: 0, protect: [] }), /keep must be at least 1/);
  assert.deepEqual(toPurge(tags.slice(0, 5), { protect: [`x@${d(1)}`] }), [], "5 or fewer: nothing to delete");
});
