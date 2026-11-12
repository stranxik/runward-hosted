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
import { statusOf, REFUSALS } from "../../src/domain/refusals/index.js";
import { harness, send, token, claimsFor, testJwk, ORIGIN, SEND_SHA, fakeAuthn } from "../helpers.js";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { VerifierUnavailable } from "../../src/ports/errors.js";
import { probeVerdict } from "../../scripts/probe-verdict.mjs";

// the key cache and its refresh live in the module every public issuer's adapter shares since the forge
// port (ADR-0029 section 1): the planted control moved there with refresh()
const SOURCE = new URL("../../src/adapters/oidc/jws.js", import.meta.url);
const GITHUB = "https://token.actions.githubusercontent.com";
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
    // the copy lives outside the tree: its one relative import (the port's errors) is given its real address
    const port = '"../../ports/errors.js"';
    assert.equal(src.split(port).length, 2, "the adapter imports the port's errors once");
    writeFileSync(file, src.replace(port, JSON.stringify(new URL("../../src/ports/errors.js", import.meta.url).href)).replace(anchor, `${anchor}    fetchedAt = now; // planted: stamped before the read\n`));
    const { publicIssuerVerifier } = await import(pathToFileURL(file).href);
    // GitHub's adapter (src/adapters/oidc/github.js) is this verifier at GitHub's issuer and key address
    const planted = (o) => publicIssuerVerifier({ issuer: GITHUB, jwksUrl: `${GITHUB}/.well-known/jwks`, ...o });
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

// Review finding of 2026-11-10 (code review C5, reproduced by the independent review): a token whose header
// decodes to JSON `null` threw a TypeError without a code; the upload answered 503 and counted it as a server
// error, so 25 anonymous requests gave an error rate of 96 % and a failing probe. The caller's fault was
// charged to the service.
test("a token whose header or claims are not a JSON object is the token's fault: refused token-unreadable, never a server error", async () => {
  const clock = manualClock(Date.parse("2026-11-10T09:00:00Z"));
  let reads = 0;
  const v = githubVerifier({ fetch: async () => { reads++; return keySet(); }, clock });
  const b64 = (text) => Buffer.from(text).toString("base64url");
  for (const [head, claims] of [["null", "null"], ["null", "{}"], ["[]", "{}"], ["7", "{}"], ['"x"', "{}"], ['{"alg":"RS256","kid":"test-key"}', "null"], ['{"alg":"RS256","kid":"test-key"}', "[]"]]) {
    await assert.rejects(v.verify(`${b64(head)}.${b64(claims)}.AAAA`, { audience: ORIGIN }), (e) => e.code === "token-unreadable", `${head}.${claims}`);
  }
  assert.equal(reads, 0, "no key read was made for them");
});

test("uploads with an unreadable token are answered 401 and leave the error rate at zero; only a verifier that says it is unavailable is answered 503", async () => {
  const servers = [];
  try {
    const serve = async (verifier) => {
      const clock = manualClock(Date.parse("2026-11-10T09:00:00Z"));
      const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: ORIGIN, RW_EXTRA_HOSTS: "127.0.0.1", RW_SEND_WORKFLOW_SHAS: SEND_SHA });
      const c = compose(config, { clock, log: silentLog, store: memoryStore({ clock }), objects: memoryObjects(), authn: fakeAuthn(), verifier: verifier(clock) });
      await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
      servers.push(c.http.server);
      const base = `http://127.0.0.1:${c.http.server.address().port}`;
      return {
        upload: (bearer) => fetch(`${base}/api/v0/exports`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "runward-mission": "m", "runward-export-kind": "check" } }),
        health: async () => (await fetch(`${base}/api/health`)).json(),
      };
    };
    // the finding's token, 25 times, through the real verifier
    const real = await serve((clock) => githubVerifier({ fetch: async () => keySet(), clock }));
    const answers = {};
    for (let i = 0; i < 25; i++) { const r = await real.upload("bnVsbA.bnVsbA.x"); const b = await r.json(); const k = `${r.status} ${b.refusal}`; answers[k] = (answers[k] ?? 0) + 1; }
    assert.deepEqual(answers, { "401 token-unreadable": 25 });
    const health = await real.health();
    assert.equal(health.errors.serverErrors, 0);
    assert.equal(probeVerdict({ healthStatus: 200, health, version: { commit: "c0ffee" } }).ok, true, "the probe does not alert on them");
    // a verifier that throws something else on a token: still the token's
    const odd = await serve(() => ({ async verify() { throw new TypeError("Cannot read properties of null"); } }));
    assert.equal((await odd.upload("a.b.c")).status, 401);
    // the control: the port's VerifierUnavailable is the service's failure
    const down = await serve(() => ({ async verify() { throw new VerifierUnavailable("planted"); } }));
    const r = await down.upload("a.b.c");
    assert.deepEqual([r.status, (await r.json()).refusal], [503, "service-unavailable"]);
  } finally { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); }
});
