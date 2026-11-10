// Each job of send.yml carries its own deadline: a caller cannot set timeout-minutes on a reusable
// workflow's jobs, and a job stuck on a runner would hold the caller's concurrency group for six hours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deadlines = (text) => {
  const out = {};
  let job = null;
  for (const line of text.split("\n")) {
    const j = /^ {2}([a-z-]+):$/.exec(line);
    if (j) job = j[1];
    const t = /^ {4}timeout-minutes: (\d+)$/.exec(line);
    if (job && t) out[job] = Number(t[1]);
  }
  return out;
};

test("send.yml: each of its three jobs has a deadline of fifteen minutes or less", () => {
  const d = deadlines(readFileSync(new URL("../../.github/workflows/send.yml", import.meta.url), "utf8"));
  for (const job of ["check", "send", "verdict"]) {
    assert.ok(Number.isInteger(d[job]), `${job} has no timeout-minutes`);
    assert.ok(d[job] > 0 && d[job] <= 15, `${job}: ${d[job]} minutes`);
  }
});

test("send.yml deadlines: the reader sees a job that has none (planted)", () => {
  const planted = "jobs:\n  check:\n    runs-on: x\n  send:\n    runs-on: x\n    timeout-minutes: 5\n";
  const d = deadlines(planted);
  assert.equal(d.check, undefined);
  assert.equal(d.send, 5);
});
