// The upload path (PADR-0010, PADR-0011 note 1 bis, PADR-0017 point 8), on the real application, the real
// OIDC verifier and the real runward-fleet assembler, over the in-memory store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, founder, pinnedRepository, send, gesture, token, claimsFor, FIXTURE_CHECK, sha } from "../helpers.js";
import { verifyChain } from "../../src/domain/ledger.js";

test("a first upload of a pending repository is kept, not published; the confirmation publishes it", async () => {
  const h = harness();
  const f = await founder(h);
  const r = await pinnedRepository(h, f);
  assert.equal(r.first.status, 202);
  assert.equal(r.first.body.pending, true);
  assert.ok(r.confirm.published, "the confirmation publishes the kept upload");
  const idx = await h.app.reading.index(f.tenant);
  const doc = JSON.parse(idx.bytes.toString("utf8"));
  assert.equal(doc.missions[0].id, "dropyour");
  assert.equal(doc.missions[0].latest.verdict, "gaps");
  assert.equal(doc.missions[0].latest.implemented, "ci-declared", "nothing is raised (PADR-0011 point 2)");
});

test("an accepted upload answers 201 with seq, head and the index digest the service then serves", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  const res = await send(h, { run_number: "13", run_id: "40000000002" });
  assert.equal(res.status, 201);
  assert.equal(res.body.current, true);
  const idx = await h.app.reading.index(f.tenant);
  assert.equal(res.body.indexSha256, idx.sha256, "S1 (a): the anchor is the index served");
  assert.equal(res.body.indexSha256, sha(idx.bytes));
  const entries = await h.store.tx(f.tenant, (tx) => tx.ledgerAll());
  assert.equal(verifyChain(entries).ok, true);
  assert.equal(entries[entries.length - 1].hash, res.body.head);
});

test("an old run re-run later is kept as history, never as the current upload (T23)", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  const a = await send(h, { run_number: "20", run_id: "40000000020" });
  const other = Buffer.from(FIXTURE_CHECK.toString("utf8").replace('"gaps"', '"clean"'));
  const old = await send(h, { run_number: "15", run_id: "40000000015", run_attempt: "3" }, { bytes: other });
  assert.equal(old.status, 201);
  assert.equal(old.body.current, false);
  assert.equal(old.body.indexSha256, a.body.indexSha256, "the index does not move");
  const rerun = await send(h, { run_number: "20", run_id: "40000000020", run_attempt: "2" }, { bytes: other });
  assert.equal(rerun.body.current, true, "a re-run of the latest run (higher attempt) becomes current");
});

test("refusals before the repository write nothing to any tenant's journal (T18)", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  const before = (await h.store.tx(f.tenant, (tx) => tx.ledgerAll())).length;
  assert.equal((await send(h, { event_name: "pull_request" })).refusal, "event-not-push");
  assert.equal((await send(h, { ref: "refs/heads/feature" })).refusal, "ref-not-main");
  assert.equal((await send(h, { runner_environment: "self-hosted" })).refusal, "runner-not-hosted");
  assert.equal((await send(h, { job_workflow_ref: "evil/repo/.github/workflows/send.yml@refs/heads/main" })).refusal, "called-workflow-not-pinned");
  assert.equal((await send(h, { job_workflow_sha: "0".repeat(40) })).refusal, "called-workflow-not-pinned");
  assert.equal((await send(h, { repository: "someone/else", repository_id: "999" })).refusal, "repository-not-declared");
  const after = (await h.store.tx(f.tenant, (tx) => tx.ledgerAll())).length;
  assert.equal(after, before);
});

test("the token: audience, expiry, replay, signature", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  assert.equal((await send(h, {}, { auth: "" })).refusal, "token-missing");
  assert.equal((await send(h, { aud: "https://elsewhere.example" })).refusal, "token-audience");
  assert.equal((await send(h, { exp: Math.floor(h.clock.now() / 1000) - 120 })).refusal, "token-expired");
  const c = claimsFor(h.clock, { run_number: "30", run_id: "40000000030" });
  const t = `Bearer ${token(c)}`;
  assert.equal((await send(h, { run_number: "30", run_id: "40000000030" }, { auth: t })).status, 201);
  assert.equal((await send(h, {}, { auth: t })).refusal, "token-replayed");
  const forged = t.slice(0, -4) + (t.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal((await send(h, {}, { auth: forged })).refusal, "token-unreadable");
});

test("the repository's pins: calling workflow, owner, mission, consent", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  assert.equal((await send(h, { workflow_ref: "stranxik/dropyour/.github/workflows/other.yml@refs/heads/main" })).refusal, "workflow-not-pinned");
  assert.equal((await send(h, { repository_owner_id: "7777" })).refusal, "owner-changed");
  assert.equal((await send(h, {}, { mission: "unknown" })).refusal, "mission-not-declared");
  const entries = await h.store.tx(f.tenant, (tx) => tx.ledgerAll());
  const codes = entries.filter((e) => e.body.what === "send-not-accepted").map((e) => e.body.detail.refusal);
  assert.deepEqual(codes, ["workflow-not-pinned", "owner-changed", "mission-not-declared"], "each refusal of its own repository is in its own journal");
});

test("headers before the body: kind, size, digest", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  assert.equal((await send(h, {}, { kind: "secrets" })).refusal, "kind-unknown");
  assert.equal((await send(h, {}, { length: 3 * 1024 * 1024 })).refusal, "too-large");
  assert.equal((await send(h, {}, { digest: "sha-256=:AAAA:" })).refusal, "digest-mismatch");
  assert.equal((await send(h, { run_id: "40000000040" }, { digest: `sha-256=:${Buffer.alloc(32).toString("base64")}:` })).refusal, "digest-mismatch");
});

test("a retry of an accepted upload replays the first answer; another digest in the same run is refused", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  const a = await send(h, { run_number: "50", run_id: "40000000050" });
  const again = await send(h, { run_number: "50", run_id: "40000000050" });
  assert.deepEqual(again.body, a.body);
  const other = Buffer.from(FIXTURE_CHECK.toString("utf8").replace('"gaps"', '"clean"'));
  assert.equal((await send(h, { run_number: "50", run_id: "40000000050" }, { bytes: other })).refusal, "duplicate-in-run");
});

test("without consent every upload is refused content-not-consented, its claims kept for the confirmation", async () => {
  const h = harness();
  const f = await founder(h);
  await gesture(h, f.session, null, null);
  const d = await h.app.repositories.declare(await h.app.identity.sessionFrom(f.token), { name: "stranxik/hitpoint", missions: [{ id: "hitpoint" }] }, {});
  const r = await send(h, { repository: "stranxik/hitpoint", repository_id: "3003" }, { mission: "hitpoint" });
  assert.equal(r.refusal, "content-not-consented");
  const repo = await h.store.tx(f.tenant, (tx) => tx.get("repository", { id: d.id }));
  assert.equal(repo.pendingSend.bytesKept, false);
  assert.equal(repo.pendingSend.claims.repositoryId, "3003");
  assert.equal(h.objects._map.size > 0 ? [...h.objects._map.keys()].some((k) => k.includes("/sha256/")) : false, false, "no byte kept");
});

test("the rate limit counts runs, not files (T17)", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  for (let i = 0; i < 29; i++) assert.equal((await send(h, { run_number: String(100 + i), run_id: String(41000000000 + i) })).status, 201);
  const limited = await send(h, { run_number: "200", run_id: "42000000000" });
  assert.equal(limited.refusal, "rate-limited");
  assert.ok(limited.extra.retryAfter > 0);
});

test("a removed repository's uploads are written to its own journal, not accepted", async () => {
  const h = harness();
  const f = await founder(h);
  const r = await pinnedRepository(h, f);
  await gesture(h, f.session, null, null);
  await h.app.repositories.remove(await h.app.identity.sessionFrom(f.token), r.id, {});
  assert.equal((await send(h, { run_number: "60", run_id: "40000000060" })).refusal, "repository-not-declared");
  const entries = await h.store.tx(f.tenant, (tx) => tx.ledgerAll());
  assert.equal(entries[entries.length - 1].body.detail.refusal, "repository-not-declared");
  await gesture(h, f.session, null, null);
  await h.app.repositories.restore(await h.app.identity.sessionFrom(f.token), r.id, {});
  assert.equal((await send(h, { run_number: "61", run_id: "40000000061" })).status, 201);
});

test("maintenance answers 503 maintenance to every upload", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  await h.app.operator.maintenance({ on: true, reason: "test" });
  assert.equal((await send(h, { run_number: "70", run_id: "40000000070" })).refusal, "maintenance");
});

test("the verifier fetches the issuer's keys and nothing else", async () => {
  const h = harness();
  const f = await founder(h);
  await pinnedRepository(h, f);
  assert.ok(h.fetches.length >= 1);
  assert.ok(h.fetches.every((u) => u === "https://token.actions.githubusercontent.com/.well-known/jwks"));
});
