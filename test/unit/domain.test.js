// The pure domain: canonical encoding and the chain, the order of uploads, link states, claims, refusals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, nextEntry, verifyChain, entryBody, GENESIS } from "../../src/domain/ledger.js";
import { placeUpload, readClaims, checkUploadHeaders, cleanClaim } from "../../src/domain/workload.js";
import { linkState, linkWindow, sessionOpen, DAY, HOUR, sameProvider } from "../../src/domain/identity.js";
import { REFUSALS, refusal, mergeRefusals } from "../../src/domain/refusals/index.js";
import { FLOOR } from "../../src/domain/refusals/floor.js";
import { FORGE } from "../../src/domain/refusals/forge.js";
import { readDeclaration } from "../../src/domain/repository.js";

test("canonical encoding: sorted keys, no whitespace, non-negative integers only", () => {
  assert.equal(canonical({ b: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"b":1}');
  assert.throws(() => canonical({ x: 1.5 }));
  assert.throws(() => canonical({ x: -1 }));
  assert.equal(canonical({ s: "\u0001é" }), '{"s":"\\u0001é"}');
});

test("the chain detects a changed entry, a gap and a reordering", () => {
  const body = (i) => entryBody({ who: { type: "workload", id: "x" }, what: "send-accepted", received: "2026-11-06T12:00:00.000Z", detail: { i } });
  const es = []; let head = null;
  for (let i = 1; i <= 4; i++) { const e = nextEntry(head, body(i)); es.push(e); head = { seq: e.seq, hash: e.hash }; }
  assert.equal(es[0].prev, GENESIS);
  assert.equal(verifyChain(es).ok, true);
  const changed = es.map((e) => (e.seq === 2 ? { ...e, body: { ...e.body, detail: { i: 99 } } } : e));
  assert.equal(verifyChain(changed).ok, false);
  assert.equal(verifyChain([es[0], es[2], es[3]]).ok, false);
  assert.equal(verifyChain([es[1], es[0]]).ok, false);
});

test("the current upload: the highest run_number, then run_attempt; a regression of run_number opens an epoch", () => {
  const cur = { runId: "100", runNumber: "10", runAttempt: "1", epoch: 0 };
  assert.equal(placeUpload(null, cur).rank, "current");
  assert.equal(placeUpload(cur, { runId: "90", runNumber: "9", runAttempt: "5" }).rank, "historical");
  assert.equal(placeUpload(cur, { runId: "100", runNumber: "10", runAttempt: "2" }).rank, "current");
  assert.equal(placeUpload(cur, { runId: "101", runNumber: "11", runAttempt: "1" }).rank, "current");
  const p = placeUpload(cur, { runId: "200", runNumber: "1", runAttempt: "1" });
  assert.equal(p.rank, "current"); assert.equal(p.epoch, 1); assert.equal(p.epochOpened, true);
  assert.equal(placeUpload(cur, { runId: "300", runNumber: "2", runAttempt: "1" }, 3).epoch, 3, "a workflow change opens its epoch");
});

test("link states: seven, each by its rule", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const w = linkWindow("recovery", now);
  assert.equal(w.usableFrom - now, DAY); assert.equal(w.expiresAt - now, 2 * DAY);
  const l = { tenantId: "t", ...w };
  assert.equal(linkState(null, now), "link-invalid");
  assert.equal(linkState(l, now), "link-not-yet");
  assert.equal(linkState(l, now + DAY), "link-live");
  assert.equal(linkState(l, now + 2 * DAY), "link-expired");
  assert.equal(linkState({ ...l, usedAt: now }, now + DAY), "link-used");
  assert.equal(linkState({ ...l, cancelledAt: now }, now + DAY), "link-cancelled");
  assert.equal(linkState(l, now + DAY, { signedInTenant: "t" }), "link-signed-in");
  assert.equal(linkWindow("invitation", now).expiresAt - now, 3 * DAY);
});

test("sessions: idle 12 h, absolute 7 days, closed", () => {
  const t = 1_000_000;
  assert.equal(sessionOpen({ createdAt: t, lastSeenAt: t }, t + 12 * HOUR - 1), true);
  assert.equal(sessionOpen({ createdAt: t, lastSeenAt: t }, t + 12 * HOUR), false);
  assert.equal(sessionOpen({ createdAt: t, lastSeenAt: t + 7 * DAY - 1 }, t + 7 * DAY), false);
  assert.equal(sessionOpen({ createdAt: t, lastSeenAt: t, closedAt: t }, t), false);
});

test("claims are untrusted data: bounded, control characters removed; malformed ones refused", () => {
  assert.equal(cleanClaim("a\u0000b c\u001bd"), "abcd");
  assert.equal(cleanClaim("x".repeat(500)).length, 200);
  assert.equal(readClaims({ repository: "a/b", repository_id: "12", jti: "j", run_id: "1", run_number: "2", run_attempt: "x" }), null);
  assert.equal(readClaims({ repository: "a/b", repository_id: "1e3", jti: "j", run_id: "1", run_number: "2", run_attempt: "1" }), null);
});

test("upload headers: digest as RFC 9530, size announced", () => {
  const ok = checkUploadHeaders({ kind: "check", mission: "m", contentLength: "10", contentDigest: `sha-256=:${Buffer.alloc(32, 1).toString("base64")}:` });
  assert.equal(ok.sha256, "01".repeat(32));
  assert.throws(() => checkUploadHeaders({ kind: "check", mission: "m", contentLength: "10", contentDigest: "sha-512=:x:" }), /digest-mismatch/);
});

test("every refusal has French and English, a message and an action, and one status", () => {
  for (const [code, d] of Object.entries(REFUSALS)) {
    assert.ok(d.fr[0] && d.fr[1] && d.en[0] && d.en[1], code);
    assert.ok(Number.isInteger(d.status), code);
    assert.equal(/—/.test(d.fr.join(" ")), false, `${code}: no em dash in French`);
  }
  assert.equal(refusal("ref-not-main", "en").message, "The ref is not refs/heads/main.");
});

test("the catalogue of refusals is merged from one file per domain: every code of every file, and a code declared twice is refused", () => {
  assert.deepEqual(Object.keys(REFUSALS), [...Object.keys(FLOOR), ...Object.keys(FORGE)], "the floor's file, then the forge port's (ADR-0029): same codes, same order");
  for (const code of Object.keys(FLOOR)) assert.equal(REFUSALS[code], FLOOR[code], code);
  for (const code of Object.keys(FORGE)) assert.equal(REFUSALS[code], FORGE[code], code);
  const def = { status: 400, fr: ["a", "b"], en: ["a", "b"] };
  assert.deepEqual(Object.keys(mergeRefusals([["floor", { "one": def }], ["lot", { "two": def }]])), ["one", "two"]);
  // planted control: the same code in two files
  assert.throws(() => mergeRefusals([["floor", { "one": def }], ["lot", { "one": def }]]), /refusal code declared twice: one \(floor, lot\)/);
});

test("the words the product never says are absent from every text it shows", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  // every script under web/, served or not: web/app.js and the modules of web/views/
  const web = new URL("../../web/", import.meta.url);
  const scripts = readdirSync(web, { recursive: true }).filter((f) => f.endsWith(".js")).sort();
  assert.ok(scripts.includes("app.js") && scripts.length >= 25, "the guard must see the shell's modules, or it proves nothing");
  const texts = [JSON.stringify(REFUSALS), ...scripts.map((f) => readFileSync(new URL(f, web), "utf8")), readFileSync(new URL("index.html", web), "utf8")].join("\n");
  for (const w of [/\bcompliant\b/i, /\bcertif(y|ied|ication)\b/i, /\bguarantee/i, /tamper-proof/i, /no human/i, /\bplatform\b/i, /\bsovereign/i, /\bplateforme\b/i, /\bsouverain/i, /garanti/i, /certifi/i, /conforme\b/i]) assert.equal(w.test(texts), false, String(w));
});

test("declarations: owner/repo, a workflow file, missions", () => {
  assert.equal(readDeclaration({ name: "Org/Repo" }).nameKey, "org/repo");
  assert.equal(readDeclaration({ name: "a/b" }).missions[0].id, "b");
  assert.throws(() => readDeclaration({ name: "a/b", missions: [{ id: "x", path: "../up" }] }), /mission-malformed/);
  assert.throws(() => readDeclaration({ name: "github.com/a/b" }), /repository-malformed/);
});

test("same provider: two passkeys of one known provider", () => {
  const i = "fbfc3007-154e-4ecc-8c0b-6e020557d7bd";
  assert.equal(sameProvider([{ aaguid: i }, { aaguid: i }]), true);
  assert.equal(sameProvider([{ aaguid: i }, { aaguid: null }]), false);
});
