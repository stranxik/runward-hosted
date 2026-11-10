// The issuer's keys (review finding of 2026-11-10, reproduced): the refresh time was stamped before the
// read, so after one failed read (a cold start, a deadline) every token was refused `token-unreadable` for a
// minute, a 401 the send workflow never retries: the upload was lost, with a wrong advice. A failed or empty
// read is now the service's failure (no refusal code, answered 503 `service-unavailable`, which the send
// workflow retries), and the minute starts only from a read that gave a usable key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { githubVerifier, KeysUnavailable, KEYS_RETRY_MS, KEYS_REFRESH_MS } from "../../src/adapters/oidc/github.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { statusOf, REFUSALS } from "../../src/domain/refusals.js";
import { harness, send, token, claimsFor, testJwk, ORIGIN } from "../helpers.js";

const SOURCE = new URL("../../src/adapters/oidc/github.js", import.meta.url);
const keySet = () => new Response(JSON.stringify({ keys: [testJwk()] }));

/** The scenario of the finding, on a verifier made by `make`: the first read of the keys fails, the second
 *  succeeds; the same token is presented at once, then KEYS_RETRY_MS later (well inside the minute). */
async function failThenSucceed(make) {
  const clock = manualClock(Date.parse("2026-11-10T09:00:00Z"));
  let reads = 0;
  const v = make({ fetch: async () => { reads++; if (reads === 1) throw new Error("connect ETIMEDOUT"); return keySet(); }, clock });
  const t = token(claimsFor(clock));
  const outcome = (p) => p.then(() => "accepted", (e) => e.code ?? "no refusal code");
  const first = await outcome(v.verify(t, { audience: ORIGIN }));
  clock.advance(KEYS_RETRY_MS);
  const second = await outcome(v.verify(t, { audience: ORIGIN }));
  return { first, second, reads };
}

test("the issuer's keys: a failed read is the service's failure, and the next read is made, not refused for a minute", async () => {
  assert.ok(KEYS_RETRY_MS < KEYS_REFRESH_MS);
  assert.deepEqual(await failThenSucceed(githubVerifier), { first: "no refusal code", second: "accepted", reads: 2 });
});

test("planted control: with the refresh time stamped before the read (the defect of a4ede14), the same scenario refuses the token token-unreadable", async () => {
  const src = readFileSync(SOURCE, "utf8");
  const anchor = "    if (now - fetchedAt < KEYS_REFRESH_MS) return; // keys read less than a minute ago: an unknown key id is the token's\n";
  assert.equal(src.split(anchor).length, 2, "the anchor of the planted defect is in the adapter (move the control with refresh())");
  const dir = mkdtempSync(join(tmpdir(), "rw-oidc-planted-"));
  try {
    const file = join(dir, "github-planted.mjs");
    writeFileSync(file, src.replace(anchor, `${anchor}    fetchedAt = now; // planted: stamped before the read\n`));
    const { githubVerifier: planted } = await import(pathToFileURL(file).href);
    assert.deepEqual(await failThenSucceed(planted), { first: "no refusal code", second: "token-unreadable", reads: 1 }, "the scenario sees the defect");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a key set that is empty, unreadable or answered 5xx is the service's failure; with fresh keys, an unknown key id stays the token's", async () => {
  const clock = manualClock(Date.parse("2026-11-10T09:00:00Z"));
  const t = token(claimsFor(clock));
  for (const answer of [() => new Response(JSON.stringify({ keys: [] })), () => new Response("not json"), () => new Response(JSON.stringify({ keys: [{ kty: "RSA", kid: "broken" }, { kty: "EC", kid: "not-rsa" }] })), () => new Response("{}", { status: 503 })]) {
    const v = githubVerifier({ fetch: async () => answer(), clock });
    await assert.rejects(v.verify(t, { audience: ORIGIN }), (e) => e instanceof KeysUnavailable && e.code === undefined);
  }
  const v = githubVerifier({ fetch: async () => keySet(), clock });
  await v.verify(t, { audience: ORIGIN });
  await assert.rejects(v.verify(token(claimsFor(clock), { kid: "rotated-away" }), { audience: ORIGIN }), (e) => e.code === "token-unreadable", "keys read a moment ago: the unknown key id is the token's");
});

test("an upload while the issuer's keys cannot be read is answered service-unavailable (503, retried by send.yml), and the next attempt reads them", async () => {
  let down = true;
  const h = harness({ keysFetch: async () => (down ? new Response("bad gateway", { status: 502 }) : keySet()) });
  const first = await send(h, { run_id: "40000000081" });
  assert.equal(first.refusal, "service-unavailable");
  assert.deepEqual({ status: statusOf(first.refusal), retry: REFUSALS[first.refusal].retry }, { status: 503, retry: true });
  down = false;
  h.clock.advance(KEYS_RETRY_MS);
  assert.equal((await send(h, { run_id: "40000000082" })).refusal, "repository-not-declared", "the token was read with the keys of the second read, not refused token-unreadable");
  assert.equal(h.fetches.length, 2);
});
