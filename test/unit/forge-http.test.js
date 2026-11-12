// The forge port over HTTP and after a restore (ADR-0029): `/send/` serves nothing (section 6 point 15), the
// routes of a registered instance are session routes checked same-origin, an upload from a registered
// instance travels the machine route, and the gestures that withdraw an access are replayed (point 8, T24).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { githubVerifier } from "../../src/adapters/oidc/github.js";
import { ulid } from "../../src/adapters/system/ulid.js";
import { harness, founder, gesture, fakeAuthn, testJwk, sha, digestHeader, FIXTURE_CHECK, SEND_SHA, gitlabKey, gitlabClaims, registerIssuer, pinnedGitlab, sendToken, INSTANCE, GITLAB_COM_KEY } from "../helpers.js";

let c, base, clock;
const fetched = [];
before(async () => {
  clock = manualClock(Date.now());
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_COMMIT: "c0ffee", RW_IMAGE: "sha256:abc", RW_SEND_WORKFLOW_SHAS: SEND_SHA, RW_GITLAB_COM: "1" });
  const fetchImpl = async (url) => { fetched.push(String(url)); return new Response(JSON.stringify({ keys: [String(url).startsWith("https://gitlab.com/") ? GITLAB_COM_KEY.jwk : testJwk()] })); };
  c = compose(config, { clock, log: silentLog, store: memoryStore({ clock }), objects: memoryObjects(), authn: fakeAuthn(), fetchImpl, verifier: githubVerifier({ fetch: fetchImpl, clock }) });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${c.http.server.address().port}`;
});
after(() => new Promise((r) => c.http.server.close(r)));

const H = { origin: "https://app.runward.dev", "content-type": "application/json" };
const call = (method, path, { body, headers = {}, cookie } = {}) => fetch(`${base}${path}`, { method, headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body), redirect: "manual" });

test("point 15: /send/ is a reserved prefix of the origin: nothing is served under it, whatever the method", async () => {
  for (const path of ["/send", "/send/", `/send/${"a".repeat(32)}`, "/send/index.html", "/send/api/version"]) {
    for (const method of ["GET", "HEAD", "POST", "DELETE"]) {
      const r = await call(method, path, method === "POST" ? { body: {}, headers: H } : {});
      assert.equal(r.status, 404, `${method} ${path}`);
      if (method !== "HEAD") assert.equal((await r.json()).refusal, "not-found", `${method} ${path}`);
    }
  }
  assert.ok(!c.http.table.some((r) => r.re.source.includes("/send")), "no route is declared under /send");
});

test("the egress list holds the two public issuers' key hosts (gitlab.com's once opened) and nothing of a registered instance (section 1)", () => {
  assert.deepEqual([...c.egress.allowed].sort(), ["gitlab.com", "token.actions.githubusercontent.com"]);
});

test("a registered instance over HTTP: registered by a gesture, its token travels the machine route, shown P4; the routes are the session's, same origin", async () => {
  // a signed-in founder
  const tok = randomBytes(32).toString("base64url");
  const { tenant } = await c.app.operator.openBootstrap({ hash: sha(Buffer.from(tok)) });
  const o = await (await call("POST", "/api/v0/links/options", { body: { token: tok }, headers: H })).json();
  const red = await call("POST", "/api/v0/links/redeem", { body: { token: tok, challengeId: o.challengeId, response: { id: "fh-1", challenge: o.options.challenge } }, headers: H });
  const cookie = red.headers.get("set-cookie").split(";")[0];
  const verify = async (g, object) => {
    const go = await (await call("POST", "/api/v0/auth/fresh/options", { body: g ? { gesture: g, object } : {}, headers: H, cookie })).json();
    assert.equal((await call("POST", "/api/v0/auth/fresh", { body: { challengeId: go.challengeId, response: { id: "fh-1", challenge: go.options.challenge } }, headers: H, cookie })).status, 200);
  };
  const key = gitlabKey();
  const input = { issuer: INSTANCE, keys: { keys: [key.jwk] }, kid: key.kid };
  // signed out, or from another origin: refused before anything
  assert.equal((await call("POST", "/api/v0/issuers/preview", { body: input, headers: H })).status, 401);
  assert.equal((await call("POST", "/api/v0/issuers", { body: input, headers: { ...H, origin: "https://evil.example" }, cookie })).status, 403);
  let r = await call("POST", "/api/v0/issuers/preview", { body: input, headers: H, cookie });
  assert.equal(r.status, 200);
  const shown = await r.json();
  assert.equal(shown.thumbprint, key.kid);
  r = await call("POST", "/api/v0/issuers", { body: { ...input, digest: shown.digest }, headers: H, cookie });
  assert.equal((await r.json()).refusal, "gesture-required");
  await verify("issuer-register", shown.digest);
  r = await call("POST", "/api/v0/issuers", { body: { ...input, digest: shown.digest }, headers: H, cookie });
  assert.equal(r.status, 201);
  const reg = await r.json();
  assert.equal(reg.audience, `https://app.runward.dev/send/${reg.id}`);
  // refused inputs answer their code, with the reason
  r = await call("POST", "/api/v0/issuers/preview", { body: { ...input, issuer: "https://gitlab.com" }, headers: H, cookie });
  assert.deepEqual([r.status, (await r.json()).refusal], [400, "issuer-not-allowed"]);
  r = await call("POST", "/api/v0/issuers/preview", { body: { ...input, keys: { keys: [{ ...key.jwk, d: "AAAA" }] } }, headers: H, cookie });
  const bad = await r.json();
  assert.deepEqual([r.status, bad.refusal], [400, "key-malformed"]);
  assert.match(bad.why, /private or symmetric/);
  // declare, send, confirm, send: the level is in the answers and on the status line
  await verify(null);
  r = await call("POST", "/api/v0/repositories", { body: { forge: "gitlab", issuer: reg.id, name: "temoin/demo", missions: [{ id: "demo" }] }, headers: H, cookie });
  assert.equal(r.status, 201);
  const repo = await r.json();
  await verify("consent", repo.id);
  assert.equal((await call("POST", `/api/v0/repositories/${repo.id}/consent`, { body: {}, headers: H, cookie })).status, 200);
  const upload = (claims) => call("POST", "/api/v0/exports", { body: FIXTURE_CHECK, headers: { authorization: `Bearer ${key.sign(claims)}`, "runward-mission": "demo", "runward-export-kind": "check", "content-digest": digestHeader(FIXTURE_CHECK), "content-type": "application/octet-stream" } });
  const claims = (a) => gitlabClaims(clock, { issuer: INSTANCE, audience: reg.audience, ...a });
  r = await upload(claims({ pipeline: "1", job: "10" }));
  assert.equal(r.status, 202);
  assert.equal((await r.json()).level, "P4");
  const pending = (await (await call("GET", "/api/v0/access", { cookie })).json()).repositories.find((x) => x.id === repo.id).pending;
  assert.equal(pending.values.issuerKey, reg.id);
  await verify("repository-confirm", `${repo.id}:${pending.digest}`);
  assert.equal((await call("POST", `/api/v0/repositories/${repo.id}/confirm`, { body: { digest: pending.digest }, headers: H, cookie })).status, 200);
  r = await upload(claims({ pipeline: "2", job: "20" }));
  assert.equal(r.status, 201);
  const status = await (await call("GET", "/api/v0/fleet/status", { cookie })).json();
  assert.deepEqual([status.lines[0].forge, status.lines[0].level.code, status.lines[0].level.reached], ["gitlab", "P4", true]);
  // a GitLab refusal answers in GitLab's words, and the journal's page too
  r = await upload(claims({ pipeline: "3", job: "30" }));
  r = await call("POST", "/api/v0/exports", { body: FIXTURE_CHECK, headers: { authorization: `Bearer ${key.sign({ ...claims({ pipeline: "4", job: "40" }), exp: Math.floor(clock.now() / 1000) - 600 })}`, "runward-mission": "demo", "runward-export-kind": "check", "content-digest": digestHeader(FIXTURE_CHECK), "accept-language": "en" } });
  const expired = await r.json();
  assert.deepEqual([r.status, expired.refusal, expired.action], [401, "token-expired", "Retry the send job."]);
  r = await upload({ ...claims({ pipeline: "5", job: "50" }), pipeline_source: "web" });
  assert.deepEqual([r.status, (await r.json()).refusal], [403, "source-not-admitted"]);
  // retire the key: by its gesture, over its route; the next upload is told so
  const keyId = (await (await call("GET", "/api/v0/access", { cookie })).json()).issuers[0].keys[0].id;
  await verify("issuer-key-retire", keyId);
  r = await call("DELETE", `/api/v0/issuers/${reg.id}/keys/${keyId}`, { headers: H, cookie });
  assert.deepEqual([r.status, (await r.json()).receiving], [200, false]);
  r = await upload(claims({ pipeline: "6", job: "60" }));
  assert.deepEqual([r.status, (await r.json()).refusal], [401, "key-retired"]);
  // the gestures of a GitLab repository
  await verify("protection-lift", repo.id);
  assert.equal((await (await call("POST", `/api/v0/repositories/${repo.id}/protection/lift`, { body: {}, headers: H, cookie })).json()).protectionRequired, false);
  await verify("protection-restore", repo.id);
  assert.equal((await (await call("POST", `/api/v0/repositories/${repo.id}/protection/restore`, { body: {}, headers: H, cookie })).json()).protectionRequired, true);
  await verify("order-epoch-open", repo.id);
  assert.equal((await (await call("POST", `/api/v0/repositories/${repo.id}/epoch`, { body: {}, headers: H, cookie })).json()).epoch, 1);
  // removal refused while the repository is declared
  await verify("issuer-remove", reg.id);
  r = await call("DELETE", `/api/v0/issuers/${reg.id}`, { headers: H, cookie });
  assert.deepEqual([r.status, (await r.json()).refusal], [409, "issuer-in-use"]);
  assert.ok(fetched.every((u) => !u.includes("gitlab.example.test")), "the registered instance was never called");
  assert.ok(tenant);
});

// ---------------------------------------------------------------- after a restore (point 8, T24)
test("T24: a key retired, a registration removed and a protection required again after the backup are replayed by a restore", async () => {
  const h = harness();
  const f = await founder(h);
  const s = () => h.app.identity.sessionFrom(f.token);
  const reg = await registerIssuer(h, f);
  const spare = await registerIssuer(h, f, { issuer: "https://gitlab.spare.test" });
  const claims = (a = {}, over = {}) => gitlabClaims(h.clock, { issuer: INSTANCE, audience: reg.audience, ...a }, over);
  const repo = await pinnedGitlab(h, f, { issuer: reg.id, sign: reg.key.sign, claims: { issuer: INSTANCE, audience: reg.audience } });
  await gesture(h, f.session, "protection-lift", repo.id);
  await h.app.repositories.protection(await s(), repo.id, true, {});
  // ---- the backup: the key is live, the spare registration exists, the protection is lifted
  h.clock.advance(1000);
  const since = ulid(h.clock.now()).slice(0, 10) + "0".repeat(16);
  h.clock.advance(1000);
  const st = h.store._state;
  const saved = { rows: { ...st.rows }, ledger: st.ledger, operator: [...st.operator] };
  // ---- after it: the key is retired (believed stolen), the spare registration removed, the protection required again
  const keyId = (await h.app.identity.accessView(await s())).issuers.find((i) => i.id === reg.id).keys[0].id;
  await gesture(h, f.session, "issuer-key-retire", keyId);
  await h.app.issuers.keyRetire(await s(), reg.id, keyId, {});
  await gesture(h, f.session, "issuer-remove", spare.id);
  await h.app.issuers.remove(await s(), spare.id, {});
  await gesture(h, f.session, "protection-restore", repo.id);
  await h.app.repositories.protection(await s(), repo.id, false, {});
  assert.equal((await sendToken(h, reg.key.sign(claims({ pipeline: "11", job: "110" })))).refusal, "key-retired");
  // ---- the loss: the database is the backup again; the object store kept the security log
  st.rows = { ...saved.rows }; st.ledger = saved.ledger; st.operator = [...saved.operator];
  // planted: without the replay, the restore brought everything back
  assert.equal((await sendToken(h, reg.key.sign(claims({ pipeline: "12", job: "120" }, { ref_protected: "false" })))).status, 201, "the stolen key signs again, on an unprotected branch");
  assert.equal((await sendToken(h, spare.key.sign(gitlabClaims(h.clock, { issuer: "https://gitlab.spare.test", audience: spare.audience })))).refusal, "repository-not-declared", "the removed registration reads tokens again");
  await h.app.operator.restoreReplay({ since });
  const row = (t, k) => h.store.tx(f.tenant, (tx) => tx.get(t, k));
  assert.ok((await row("issuer_key", { id: keyId })).retiredAt, "the key is retired again");
  assert.ok((await row("issuer", { id: spare.id })).removedAt, "the registration is removed again");
  assert.equal((await row("repository", { id: repo.id })).protectionLiftedAt, null, "the protection is required again");
  assert.equal((await sendToken(h, reg.key.sign(claims({ pipeline: "13", job: "130" })))).refusal, "key-retired");
  assert.equal((await sendToken(h, spare.key.sign(gitlabClaims(h.clock, { issuer: "https://gitlab.spare.test", audience: spare.audience })))).refusal, "token-unreadable");
  // replayed twice, it changes nothing
  const before = JSON.stringify([await row("issuer_key", { id: keyId }), await row("issuer", { id: spare.id })]);
  await h.app.operator.restoreReplay({ since });
  assert.equal(JSON.stringify([await row("issuer_key", { id: keyId }), await row("issuer", { id: spare.id })]), before);
  // and what the store holds of a registration and its keys is written once
  await assert.rejects(h.store.tx(f.tenant, (tx) => tx.update("issuer_key", { id: keyId }, { retiredAt: null })), /written once/, "a retirement is final");
  await assert.rejects(h.store.tx(f.tenant, (tx) => tx.update("issuer_key", { id: keyId }, { jwk: gitlabKey().jwk })), /written once/, "a key's material never changes");
  await assert.rejects(h.store.tx(f.tenant, (tx) => tx.update("issuer", { id: reg.id }, { issuer: "https://elsewhere.test" })), /written once/);
});
