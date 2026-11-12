// The forge port and GitLab's rules (ADR-0029), on the real application, the real registry of issuers and
// the real runward-fleet assembler, over the in-memory store. Each test names the point of the record's
// security review (section 6) it answers; the planted controls are the cases that must be refused.
// The tokens are signed here, with keys made here; their claims are the real ones of the witness instance
// (test/fixtures/gitlab/), moved to the clock of the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import {
  harness, founder, gesture, send, token, claimsFor, sendToken, gitlabKey, gitlabClaims, registerIssuer, pinnedGitlab, confirmRepository,
  pinnedRepository, GITLAB_COM_KEY, GITLAB_FIXTURES, GITLAB_JWKS, INSTANCE, ORIGIN, FIXTURE_CHECK,
} from "../helpers.js";
import { readClaims, check, definitionMatches, placeUpload } from "../../src/domain/gitlab.js";
import { levelCode, scopedKey, pinDigest, confirmObject, sendAudience, GITHUB_ISSUER_KEY, GITLAB_COM_ISSUER, PUBLIC_ISSUERS, RESERVED_ISSUER_HOSTS } from "../../src/domain/forge.js";
import { readIssuer, readKeyInput, keyFault, jwkThumbprint, keyState, indexNameOf, KEY_LIFE, MAX_LIVE_KEYS, MAX_REGISTRATIONS } from "../../src/domain/issuer.js";
import { REFUSALS, refusal } from "../../src/domain/refusals/index.js";
import { FORGE } from "../../src/domain/refusals/forge.js";
import { GESTURES, DAY, MIN } from "../../src/domain/identity.js";
import { verifyChain } from "../../src/domain/ledger.js";
import { GITLAB_COM_KEYS } from "../../src/adapters/oidc/gitlab.js";
import { replay, replayPin, exitCode } from "../../scripts/replay-export.mjs";

const COM = "https://gitlab.com";
const comSign = (claims, over) => GITLAB_COM_KEY.sign(claims, over);
const comClaims = (h, a = {}, over = {}) => gitlabClaims(h.clock, { issuer: COM, ...a }, over);
const journal = (h, tenant) => h.store.tx(tenant, (tx) => tx.ledgerAll());
const refusals = async (h, tenant) => (await journal(h, tenant)).filter((e) => e.body.what === "send-not-accepted").map((e) => e.body.detail.refusal);
/** A registered instance of tenant `f`, with a pinned project: { reg, repo, sign, claims }. */
async function instance(h, f, { issuer = INSTANCE, name = "temoin/demo", mission = "demo", projectId = "1" } = {}) {
  const reg = await registerIssuer(h, f, { issuer });
  const claims = (a = {}, over = {}) => gitlabClaims(h.clock, { issuer, audience: reg.audience, path: name, projectId, ...a }, over);
  const repo = await pinnedGitlab(h, f, { issuer: reg.id, sign: reg.key.sign, name, mission, claims: { issuer, audience: reg.audience, projectId } });
  assert.equal(repo.first.status, 202, JSON.stringify(repo.first));
  return { reg, repo, sign: reg.key.sign, claims };
}

// ------------------------------------------------------------------ the real instance's tokens (section 3, Context)
test("the claims a real GitLab instance signed are read as the rules expect: typed, with the definition absent when it lives in another project", () => {
  const runs = Object.fromEntries(Object.entries(GITLAB_FIXTURES).map(([k, v]) => [k[0], v]));
  for (const r of Object.values(runs)) {
    const c = readClaims(r.claims);
    assert.ok(c, "a real token's claims are readable");
    assert.equal(typeof c.projectId, "string"); assert.equal(typeof c.refProtected, "string"); assert.equal(c.runnerId, "1");
    assert.ok(!JSON.stringify(c).includes("example.com") && !("userLogin" in c) && !("userEmail" in c), "no login and no e-mail address is kept (ADR-0005)");
    assert.equal(r.header.alg, "RS256");
    const key = GITLAB_JWKS.keys.find((k) => k.kid === r.header.kid);
    assert.equal(jwkThumbprint(key), r.header.kid, "the kid of a CI token is its key's RFC 7638 thumbprint");
  }
  const repo = { state: "pinned", ownerId: "2", definitionRef: "gitlab-temoin.local:8929/temoin/demo//.gitlab-ci.yml@refs/heads/main", workflow: ".gitlab-ci.yml", defaultBranch: "main", protectionLifted: false, missions: ["demo"] };
  const rule = (run) => { try { check(readClaims(run.claims), repo, { mission: "demo" }); return "accepted"; } catch (e) { return e.code; } };
  assert.equal(rule(runs.C), "accepted", "a push on the protected, declared branch, its job brought in by include: local");
  assert.equal(rule(runs.A), "source-not-admitted", "the same claims from a pipeline started through the API");
  assert.equal(rule(runs.B), "definition-not-pinned", "a push on another branch: its definition is that branch's");
  assert.equal(rule(runs.D), "definition-absent", "a definition kept in another project: both claims are absent");
  // the instance's whole key set is admitted, and the one key kept is the one a CI token names
  const kept = readKeyInput(GITLAB_JWKS, runs.C.header.kid);
  assert.equal(kept.bits, 2048); assert.equal(kept.kid, kept.thumbprint);
  assert.deepEqual(Object.keys(kept.jwk).sort(), ["e", "kid", "kty", "n"]);
});

// ------------------------------------------------------------------ point 4: typed claims, absent claims refuse
test("point 4: every claim is typed before it is compared, and an absent claim refuses, never passes", () => {
  const real = GITLAB_FIXTURES["C main push include-local"].claims;
  for (const k of ["project_id", "namespace_id", "project_path", "pipeline_id", "job_id", "sha", "jti", "iat", "exp"]) {
    const { [k]: _gone, ...rest } = real;
    assert.equal(readClaims(rest), null, `without ${k}`);
  }
  assert.equal(readClaims({ ...real, project_id: 1 }), null, "an id is a string of digits, never a number");
  assert.equal(readClaims({ ...real, project_id: "1 or 2" }), null);
  assert.equal(readClaims({ ...real, project_path: "temoin/demo\u0000" }), null, "a control character");
  assert.equal(readClaims({ ...real, project_path: "demo" }), null, "a path has two segments or more");
  assert.equal(readClaims({ ...real, iat: "1794430548" }), null);
  const repo = { state: "pinned", ownerId: "2", definitionRef: real.ci_config_ref_uri, workflow: ".gitlab-ci.yml", defaultBranch: "main", protectionLifted: false, missions: ["demo"] };
  const rule = (over, r = repo) => { try { check(readClaims({ ...real, ...over }), r, { mission: "demo" }); return "accepted"; } catch (e) { return e.code; } };
  assert.equal(rule({}), "accepted");
  assert.equal(rule({ ref_protected: true }), "ref-not-protected", "the boolean true is not the string \"true\"");
  assert.equal(rule({ ref_protected: "TRUE" }), "ref-not-protected");
  assert.equal(rule({ ref_protected: undefined }), "ref-not-protected", "absent");
  assert.equal(rule({ ref_protected: "false" }), "ref-not-protected", "planted: an unprotected branch");
  assert.equal(rule({ ref_protected: "false" }, { ...repo, protectionLifted: true }), "accepted", "the requirement lifted for the repository");
  assert.equal(rule({ ref_type: "tag" }), "ref-not-declared");
  assert.equal(rule({ ref_type: undefined }), "ref-not-declared");
  assert.equal(rule({ ref: "feature/essai" }), "ref-not-declared");
  assert.equal(rule({ pipeline_source: undefined }), "source-not-admitted", "absent");
  for (const s of ["api", "web", "schedule", "trigger", "merge_request_event", "parent_pipeline", "pipeline"]) assert.equal(rule({ pipeline_source: s }), "source-not-admitted", s);
  assert.equal(rule({ ci_config_sha: undefined }), "definition-absent");
  assert.equal(rule({ ci_config_ref_uri: undefined }), "definition-absent");
  assert.equal(rule({ ci_config_sha: "0".repeat(40) }), "commit-mismatch", "the definition is not at the code's commit");
  assert.equal(rule({ namespace_id: "3" }), "owner-changed");
  assert.equal(rule({}, { ...repo, missions: [] }), "mission-not-declared");
});

// ------------------------------------------------------------------ point 5: the definition, whole, and by suffixes
test("point 5: ci_config_ref_uri is compared whole at each upload; the declaration is compared by string suffixes at the confirmation", () => {
  const real = GITLAB_FIXTURES["C main push include-local"].claims;
  const pinned = real.ci_config_ref_uri;
  const repo = { state: "pinned", ownerId: "2", definitionRef: pinned, workflow: ".gitlab-ci.yml", defaultBranch: "main", protectionLifted: false, missions: ["demo"] };
  const rule = (uri, r = repo) => { try { check(readClaims({ ...real, ci_config_ref_uri: uri }), r, { mission: "demo" }); return "accepted"; } catch (e) { return e.code; } };
  for (const other of [`${pinned} `, `x${pinned}`, pinned.toUpperCase(), pinned.replace("8929", "8930"), pinned.replace("//.gitlab-ci.yml", "//ci/.gitlab-ci.yml"), pinned.replace("temoin/demo", "temoin/demo2"), `${pinned}@refs/heads/main`]) {
    assert.equal(rule(other), "definition-not-pinned", other);
  }
  assert.equal(rule(pinned, { ...repo, definitionRef: null }), "definition-not-pinned", "a pinned repository whose definition was unpinned receives nothing");
  assert.equal(rule(pinned, { ...repo, state: "pending", definitionRef: null }), "accepted", "while pending nothing is pinned yet: the confirmation compares");
  const d = { projectPath: "temoin/demo", file: ".gitlab-ci.yml", branch: "main" };
  assert.equal(definitionMatches(pinned, d), true);
  assert.equal(definitionMatches("gitlab.com/temoin/demo//.gitlab-ci.yml@refs/heads/main", d), true);
  assert.equal(definitionMatches(pinned, { ...d, branch: "release" }), false, "another branch than the declared one");
  assert.equal(definitionMatches(pinned, { ...d, file: "ci/pipeline.yml" }), false, "another file than the declared one");
  assert.equal(definitionMatches(pinned, { ...d, projectPath: "moin/demo" }), false, "the project's path is matched from a slash, never from the middle of a segment");
  assert.equal(definitionMatches("temoin/demo//.gitlab-ci.yml@refs/heads/main", d), false, "nothing before the path: no host");
  assert.equal(definitionMatches("host/temoin/demo//.gitlab-ci.yml@refs/heads/main@refs/heads/main", d), false);
  assert.equal(definitionMatches("host/temoin/demo//x//.gitlab-ci.yml@refs/heads/main", d), false);
  assert.equal(definitionMatches(pinned, { ...d, file: "a@b" }), false, "a declared file never holds an @");
  assert.equal(definitionMatches(undefined, d), false);
});

// ------------------------------------------------------------------ section 2: the levels
test("section 2: the level is computed from the forge, the issuer and the protection requirement, never raised by a claim", () => {
  assert.equal(levelCode({ forge: "github" }), "P1");
  assert.equal(levelCode({ forge: "gitlab", issuerKind: "public", protectionRequired: true }), "P3");
  assert.equal(levelCode({ forge: "gitlab", issuerKind: "public", protectionRequired: false }), "P3b");
  assert.equal(levelCode({ forge: "gitlab", issuerKind: "registered", protectionRequired: true }), "P4", "a registered instance is P4 however well it is run");
  assert.equal(levelCode({ forge: "gitlab", issuerKind: "registered", protectionRequired: false }), "P4");
  assert.equal(levelCode({ forge: "gitlab", issuerKind: undefined, protectionRequired: true }), "P4", "an issuer that is not known to be public is not P3");
  assert.throws(() => levelCode({ forge: "bitbucket" }));
});

test("gitlab.com: an upload is bound by its token, shown P3, journaled with what it rests on; protection lifted lowers it to P3b", async () => {
  const h = harness();
  const f = await founder(h);
  const repo = await pinnedGitlab(h, f, { issuer: "gitlab.com", sign: comSign, claims: { issuer: COM } });
  assert.equal(repo.first.status, 202);
  assert.equal(repo.first.body.level, "P3");
  assert.ok(repo.confirm.published);
  const res = await sendToken(h, comSign(comClaims(h, { pipeline: "11", job: "110" })));
  assert.equal(res.status, 201, JSON.stringify(res));
  assert.equal(res.body.level, "P3");
  const entries = await journal(h, f.tenant);
  assert.equal(verifyChain(entries).ok, true);
  const accepted = entries[entries.length - 1].body;
  assert.equal(accepted.what, "send-accepted");
  assert.equal(accepted.who.id, `gitlab:${COM}:1`, "the workload reads gitlab:<issuer key>:<id>");
  assert.deepEqual(accepted.detail.level, { code: "P3", issuerKey: COM, issuer: "public", kid: GITLAB_COM_KEY.kid, thumbprint: GITLAB_COM_KEY.kid, protectionRequired: true });
  assert.ok(!JSON.stringify(accepted).includes("root") && !JSON.stringify(accepted).includes("example.com"), "user_login and user_email are dropped");
  assert.equal(accepted.detail.claims.userAccessLevel, "owner", "informative, journaled, never a pin");
  // the index names the project under gitlab.com, and what it reads stays what the CI declared
  const idx = JSON.parse((await h.app.reading.index(f.tenant)).bytes.toString("utf8"));
  assert.equal(idx.missions[0].repository, "gitlab.com/temoin/demo");
  assert.equal(idx.missions[0].latest.implemented, "ci-declared");
  // the status line carries the level, reached
  let line = (await h.app.reading.status(f.session)).lines[0];
  assert.deepEqual([line.forge, line.level.code, line.level.reached, line.level.protectionRequired], ["gitlab", "P3", true, true]);
  // an unprotected branch is refused until the requirement is lifted, by a gesture bound to the repository
  assert.equal((await sendToken(h, comSign(comClaims(h, { pipeline: "12", job: "120" }, { ref_protected: "false" })))).refusal, "ref-not-protected");
  await assert.rejects(h.app.repositories.protection(await h.app.identity.sessionFrom(f.token), repo.id, true, {}), { code: "gesture-required" });
  await gesture(h, f.session, "protection-lift", repo.id);
  assert.equal((await h.app.repositories.protection(await h.app.identity.sessionFrom(f.token), repo.id, true, {})).protectionRequired, false);
  const lifted = await sendToken(h, comSign(comClaims(h, { pipeline: "13", job: "130" }, { ref_protected: "false" })));
  assert.equal(lifted.status, 201);
  assert.equal(lifted.body.level, "P3b");
  const stillLifted = await sendToken(h, comSign(comClaims(h, { pipeline: "14", job: "140" })));
  assert.equal(stillLifted.body.level, "P3b", "lifted for the repository: P3b even when the token says protected");
  line = (await h.app.reading.status(f.session)).lines[0];
  assert.deepEqual([line.level.code, line.level.protectionRequired], ["P3b", false]);
  await gesture(h, f.session, "protection-restore", repo.id);
  await h.app.repositories.protection(await h.app.identity.sessionFrom(f.token), repo.id, false, {});
  assert.equal((await sendToken(h, comSign(comClaims(h, { pipeline: "15", job: "150" })))).body.level, "P3");
  const whats = (await journal(h, f.tenant)).map((e) => e.body.what);
  assert.ok(whats.includes("protection-lifted") && whats.includes("protection-restored"));
});

test("a registered instance: an upload is shown P4 whatever its claims say, and its entry names the key that signed it (point 8)", async () => {
  const h = harness();
  const f = await founder(h);
  const { reg, repo, sign, claims } = await instance(h, f);
  assert.equal(repo.first.body.level, "P4");
  assert.match(reg.id, /^[0-9a-f]{32}$/);
  assert.equal(reg.audience, `${ORIGIN}/send/${reg.id}`);
  assert.ok(!reg.id.includes(f.tenant.replaceAll("-", "").slice(0, 8)), "the registration's identifier is not the tenant's");
  const res = await sendToken(h, sign(claims({ pipeline: "11", job: "110" })));
  assert.equal(res.status, 201, JSON.stringify(res));
  assert.equal(res.body.level, "P4");
  const accepted = (await journal(h, f.tenant)).pop().body;
  assert.equal(accepted.who.id, `gitlab:${reg.id}:1`);
  assert.deepEqual(accepted.detail.level, { code: "P4", issuerKey: reg.id, issuer: "registered", kid: reg.key.kid, thumbprint: reg.key.kid, protectionRequired: true });
  const idx = JSON.parse((await h.app.reading.index(f.tenant)).bytes.toString("utf8"));
  assert.equal(idx.missions[0].repository, "gitlab.example.test/temoin/demo");
  const line = (await h.app.reading.status(f.session)).lines[0];
  assert.deepEqual([line.level.code, line.level.issuer, line.level.kid], ["P4", "registered", reg.key.kid]);
  // the access view shows the registration, its audience, its key and the repository's level before any upload
  const view = await h.app.identity.accessView(await h.app.identity.sessionFrom(f.token));
  assert.equal(view.issuers[0].audience, reg.audience);
  assert.deepEqual([view.issuers[0].keys.length, view.issuers[0].keys[0].state, view.issuers[0].receiving], [1, "live", true]);
  assert.ok(!JSON.stringify(view.issuers).includes(reg.key.jwk.n), "a key's material is not shown, its thumbprint is");
  const shownRepo = view.repositories.find((r) => r.id === repo.id);
  assert.deepEqual([shownRepo.forge, shownRepo.level, shownRepo.issuer.kind, shownRepo.audience], ["gitlab", "P4", "registered", reg.audience]);
});

// ------------------------------------------------------------------ points 1, 9, 15: which keys check a token
test("points 1 and 9: a key set is chosen by exact equality; every other token is token-unreadable after one signature check, nothing journaled", async () => {
  const h = harness();
  const f = await founder(h);
  const { reg, sign, claims } = await instance(h, f);
  const other = await registerIssuer(h, f, { issuer: "https://gitlab.other.test" });
  const before = (await journal(h, f.tenant)).length;
  const stranger = gitlabKey();
  const cases = {
    "an unknown issuer, the service's own audience": stranger.sign(gitlabClaims(h.clock, { issuer: "https://gitlab.unknown.test" })),
    "an unknown registration": sign(claims({}, { aud: sendAudience(ORIGIN, "0".repeat(32)) })),
    "an issuer that is not the registration's": sign(claims({}, { iss: "https://gitlab.other.test" })),
    "another registration's audience (planted)": sign(claims({}, { aud: other.audience })),
    "an unknown kid": sign(claims(), { kid: stranger.kid }),
    "an audience that only begins as a registration's": sign(claims({}, { aud: `${reg.audience}/x` })),
    "an audience under another origin": sign(claims({}, { aud: `https://app.runward.dev.evil.test/send/${reg.id}` })),
    "the registration's identifier in upper case": sign(claims({}, { aud: sendAudience(ORIGIN, reg.id.toUpperCase()) })),
    "two audiences": sign(claims({}, { aud: [reg.audience, ORIGIN] })),
    "no kid": sign(claims(), { kid: undefined }),
  };
  for (const [name, t] of Object.entries(cases)) {
    const n = h.decoys.n;
    const r = await sendToken(h, t);
    assert.equal(r.refusal, "token-unreadable", name);
    assert.deepEqual(r.extra, {}, `${name}: one code, one text, no forge named`);
    assert.equal(h.decoys.n, n + 1, `${name}: exactly one signature check, the decoy's`);
  }
  // a bad signature under a key that exists costs the real check, and no decoy
  const good = sign(claims({ pipeline: "20", job: "200" }));
  const n = h.decoys.n;
  assert.equal((await sendToken(h, `${good.slice(0, -6)}AAAAAA`)).refusal, "token-unreadable");
  assert.equal((await sendToken(h, stranger.sign(claims(), { kid: reg.key.kid }))).refusal, "token-unreadable", "the right kid, another key's signature");
  assert.equal(h.decoys.n, n);
  assert.equal((await journal(h, f.tenant)).length, before, "nothing was written in the tenant's journal (T18)");
  assert.equal((await sendToken(h, good)).status, 201, "and the same token, whole, is accepted");
  // a public issuer's string is matched exactly: never by prefix, never normalised
  for (const iss of ["https://gitlab.com/", "https://GITLAB.com", "https://gitlab.com:443", "http://gitlab.com", "https://gitlab.com.", " https://gitlab.com"]) {
    assert.equal((await sendToken(h, comSign(comClaims(h, {}, { iss })))).refusal, "token-unreadable", JSON.stringify(iss));
  }
});

test("point 15: a gitlab.com token carries exactly the service's audience; with a registration's it is refused token-audience, and the answer gives the value", async () => {
  const h = harness();
  const f = await founder(h);
  const { reg } = await instance(h, f);
  await pinnedGitlab(h, f, { issuer: "gitlab.com", sign: comSign, claims: { issuer: COM }, name: "group/app", mission: "app" });
  const r = await sendToken(h, comSign(comClaims(h, { path: "group/app" }, { aud: reg.audience })), { mission: "app" });
  assert.equal(r.refusal, "token-audience");
  assert.deepEqual(r.extra, { forge: "gitlab", audience: ORIGIN });
  assert.match(refusal("token-audience", "en", r.extra).action, /id_tokens/);
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/app" }, { aud: `${ORIGIN}/read` })), { mission: "app" })).refusal, "token-audience", "the reader's audience is not an upload's");
  // and a gitlab.com token is never read with a registration's keys: the tenant's key signs nothing for gitlab.com
  assert.equal((await sendToken(h, reg.key.sign(comClaims(h, { path: "group/app" })), { mission: "app" })).refusal, "token-unreadable");
  // GitHub's reader stays GitHub's alone: a GitLab token is no reader
  await assert.rejects(h.app.reader.readIndex({ authorization: `Bearer ${comSign(comClaims(h, {}, { aud: `${ORIGIN}/read` }))}`, fleet: f.tenant, requestId: "r" }), { code: "token-unreadable" });
});

// ------------------------------------------------------------------ point 2: algorithms and keys
test("point 2: RS256 only, for every issuer: none and HMAC are refused; a key's type, size and exponent are checked when it is read", async () => {
  const h = harness();
  const f = await founder(h);
  const { reg, sign, claims } = await instance(h, f);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const forge = (c, header, secret) => { const head = b64(header), body = b64(c); return `${head}.${body}.${secret ? createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url") : ""}`; };
  // the SPKI PEM of a public key: the text an algorithm-confusion attack uses as an HMAC secret
  const pem = (jwk) => createPublicKey({ format: "jwk", key: { kty: jwk.kty, n: jwk.n, e: jwk.e } }).export({ type: "spki", format: "pem" });
  for (const [name, c, kid, pub] of [["a registration", claims(), reg.key.kid, reg.key.jwk], ["gitlab.com", comClaims(h), GITLAB_COM_KEY.kid, GITLAB_COM_KEY.jwk]]) {
    assert.equal((await sendToken(h, `${b64({ alg: "none", kid })}.${b64(c)}.AAAA`)).refusal, "token-unreadable", `${name}: alg none`);
    assert.equal((await sendToken(h, forge(c, { alg: "HS256", kid }, pem(pub)))).refusal, "token-unreadable", `${name}: HS256 keyed by the public key`);
    assert.equal((await sendToken(h, forge(c, { alg: "RS256", kid }, pem(pub)))).refusal, "token-unreadable", `${name}: an HMAC under the name RS256`);
    for (const alg of ["RS384", "RS512", "PS256", "ES256", "rs256", ["RS256"]]) assert.equal((await sendToken(h, sign(c, { alg }))).refusal, "token-unreadable", `${name}: ${JSON.stringify(alg)}`);
  }
  assert.equal((await sendToken(h, token(claimsFor(h.clock), { alg: "none" }))).refusal, "token-unreadable", "GitHub: alg none");
  // when it is read: a kept key that is no longer one the service admits checks nothing (planted in the store)
  const weak = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const wjwk = weak.publicKey.export({ format: "jwk" });
  const wkid = jwkThumbprint(wjwk);
  await h.store.tx(f.tenant, (tx) => tx.insert("issuer_key", { id: h.store.newId(), issuerRef: reg.id, kid: wkid, jwk: { kty: "RSA", n: wjwk.n, e: wjwk.e, kid: wkid }, thumbprint: wkid }));
  const n = h.decoys.n;
  assert.equal((await sendToken(h, token(claims({ pipeline: "21", job: "210" }), { key: weak.privateKey, kid: wkid }))).refusal, "token-unreadable", "a 1024-bit key planted beside the registered one");
  assert.equal(h.decoys.n, n + 1);
});

test("point 2 and section 4: what a key must be, or the whole input is refused", () => {
  const good = gitlabKey().jwk;
  const fault = (over, drop = []) => { const k = { ...good, ...over }; for (const d of drop) delete k[d]; return keyFault(k); };
  assert.equal(keyFault(good), null);
  assert.equal(fault({}, ["use", "alg"]), null, "use and alg may be absent");
  assert.match(fault({ kty: "EC" }), /kty/);
  assert.match(fault({ kty: "oct" }), /kty/);
  assert.match(fault({ e: "Aw" }), /exponent/, "e = 3");
  assert.match(fault({ e: "AQAC" }), /exponent/);
  assert.match(fault({ use: "enc" }), /use/);
  assert.match(fault({ alg: "RS512" }), /alg/);
  assert.match(fault({ alg: "none" }), /alg/);
  for (const m of ["d", "p", "q", "dp", "dq", "qi", "oth", "k"]) assert.match(fault({ [m]: "AAAA" }), /private or symmetric/, m);
  assert.match(fault({ n: gitlabKey(1024).jwk.n }), /modulus/, "1024 bits");
  assert.match(fault({ n: randomBytes(1024).toString("base64url").replace(/^./, "_") }), /modulus/, "8192 bits");
  assert.match(fault({ n: `${good.n}=` }), /modulus/, "padding");
  assert.match(fault({ n: Buffer.concat([Buffer.from([0]), Buffer.from(good.n, "base64url")]).toString("base64url") }), /modulus/, "a leading zero byte: not the canonical encoding");
  assert.match(fault({ kid: "" }), /kid/);
  assert.match(fault({ kid: 7 }), /kid/);
  assert.equal(keyFault(null), "a key is a JSON object");
  // the whole input
  const other = gitlabKey().jwk;
  const refused = (input, kid) => { try { readKeyInput(input, kid); return "accepted"; } catch (e) { return `${e.code}: ${e.extra.why}`; } };
  assert.equal(refused({ keys: [good, other] }, good.kid), "accepted");
  assert.equal(refused(good, good.kid), "accepted", "one key, pasted alone");
  assert.match(refused({ keys: [good, good] }, good.kid), /key-malformed: a kid is present twice/);
  assert.match(refused({ keys: [good, { ...other, d: "AAAA" }] }, good.kid), /key-malformed: a private/, "one bad key refuses the whole input, even when it is not the key named");
  assert.match(refused({ keys: [good, { ...other, kty: "EC" }] }, good.kid), /key-malformed: kty/);
  assert.match(refused({ keys: [good] }, other.kid), /key-malformed: no key of the set/);
  assert.match(refused({ keys: [{ ...good, kid: "chosen-by-hand" }] }, "chosen-by-hand"), /key-malformed: the kid is not the key's RFC 7638 thumbprint/);
  assert.match(refused({ keys: [] }, good.kid), /key-malformed/);
  assert.match(refused("a string", good.kid), /key-malformed/);
  assert.match(refused({ keys: [good] }, undefined), /key-malformed/);
});

// ------------------------------------------------------------------ point 3: nothing becomes an address
test("point 3: no value of a token becomes an address: the only reads are the two fixed key addresses", async () => {
  const h = harness();
  const f = await founder(h);
  const { sign, claims } = await instance(h, f);
  await pinnedGitlab(h, f, { issuer: "gitlab.com", sign: comSign, claims: { issuer: COM }, name: "group/app", mission: "app" });
  const evil = { jku: "https://evil.test/keys", x5u: "https://evil.test/cert", jwk: gitlabKey().jwk };
  await sendToken(h, sign(claims({ pipeline: "22", job: "220" }), evil));
  await sendToken(h, comSign(comClaims(h, { path: "group/app", pipeline: "23", job: "230" }), evil), { mission: "app" });
  await sendToken(h, gitlabKey().sign(gitlabClaims(h.clock, { issuer: "https://evil.test" }), evil));
  await send(h, {});
  const read = [...new Set(h.fetches)].sort();
  assert.deepEqual(read, [GITLAB_COM_KEYS, "https://token.actions.githubusercontent.com/.well-known/jwks"].sort(), "a registered instance is never called, and no jku, x5u or jwks_uri is fetched");
});

// ------------------------------------------------------------------ point 13: the token's age
test("point 13: a GitLab token more than 10 minutes old is refused whatever its exp, and its replay id is kept until exp; GitHub's has no bound", async () => {
  const h = harness();
  const f = await founder(h);
  const { sign, claims } = await instance(h, f);
  await pinnedGitlab(h, f, { issuer: "gitlab.com", sign: comSign, claims: { issuer: COM }, name: "group/app", mission: "app" });
  const reg = sign(claims({ pipeline: "24", job: "240" }));
  const com = comSign(comClaims(h, { path: "group/app", pipeline: "25", job: "250" }));
  const used = sign(claims({ pipeline: "26", job: "260" }));
  assert.equal((await sendToken(h, used)).status, 201);
  h.clock.advance(9 * MIN + 59_000);
  assert.equal((await sendToken(h, used)).refusal, "token-replayed", "used once within its issuer key");
  h.clock.advance(MIN + 2000);
  const late = await sendToken(h, reg);
  assert.equal(late.refusal, "token-too-old", "planted: a token 11 minutes old, 49 minutes before its exp");
  assert.equal(late.extra.forge, "gitlab");
  assert.match(refusal("token-too-old", "en").action, /send job apart .* instance's clock/, "the remedy names both causes");
  assert.equal((await sendToken(h, com, { mission: "app" })).refusal, "token-too-old", "gitlab.com too");
  h.clock.advance(40 * MIN);
  assert.equal((await sendToken(h, used)).refusal, "token-too-old", "and a used token, replayed before its exp, is still refused");
  // GitHub: unchanged, no bound on a token's age
  await pinnedRepository(h, f);
  const now = Math.floor(h.clock.now() / 1000);
  assert.equal((await send(h, { iat: now - 11 * 60, nbf: now - 11 * 60, exp: now + 60, run_number: "40", run_id: "40000000040" })).status, 201);
});

// ------------------------------------------------------------------ point 8: a retired key
test("point 8: key-retired is answered and journaled only after the signature holds under the retired key; a retired kid with a bad signature is token-unreadable", async () => {
  const h = harness();
  const f = await founder(h);
  const { reg, sign, claims } = await instance(h, f);
  assert.equal((await sendToken(h, sign(claims({ pipeline: "30", job: "300" })))).status, 201);
  const view = async () => (await h.app.identity.accessView(await h.app.identity.sessionFrom(f.token))).issuers[0];
  const keyId = (await view()).keys[0].id;
  // retiring is a gesture bound to the key; the last key may be retired (a stolen key is stopped at once)
  await assert.rejects(h.app.issuers.keyRetire(await h.app.identity.sessionFrom(f.token), reg.id, keyId, {}), { code: "gesture-required" });
  await gesture(h, f.session, "issuer-key-retire", keyId);
  const out = await h.app.issuers.keyRetire(await h.app.identity.sessionFrom(f.token), reg.id, keyId, {});
  assert.equal(out.receiving, false, "a registration with no live key receives nothing, and the app says so");
  assert.deepEqual([(await view()).keys[0].state, (await view()).receiving], ["retired", false]);
  const before = (await journal(h, f.tenant)).length;
  // planted: the retired key's kid with a bad signature: one answer, nothing journaled
  const stranger = gitlabKey();
  assert.equal((await sendToken(h, stranger.sign(claims({ pipeline: "31", job: "310" }), { kid: reg.key.kid }))).refusal, "token-unreadable");
  assert.equal((await journal(h, f.tenant)).length, before, "whoever holds a registration's identifier and a kid writes nothing into the tenant's journal");
  // the signature holds under the retired key: key-retired, journaled in the tenant
  const r = await sendToken(h, sign(claims({ pipeline: "32", job: "320" })));
  assert.equal(r.refusal, "key-retired");
  const entry = (await journal(h, f.tenant)).pop().body;
  assert.deepEqual([entry.what, entry.detail.refusal, entry.detail.key.kid, entry.detail.key.state, entry.who.id], ["send-not-accepted", "key-retired", reg.key.kid, "retired", `gitlab:${reg.id}:1`]);
  // at most 30 such entries an hour for one key: a stolen, retired key does not fill the journal
  for (let i = 0; i < 40; i++) assert.equal((await sendToken(h, sign(claims({ pipeline: String(100 + i), job: String(1000 + i) })))).refusal, "key-retired");
  assert.equal((await refusals(h, f.tenant)).filter((c) => c === "key-retired").length, 30);
  // what the retired key signed stays, marked with the date
  const line = (await h.app.reading.status(f.session)).lines[0];
  assert.equal(line.level.kid, reg.key.kid);
  assert.ok(line.level.keyRetiredAt, "the upload is marked as signed by a key since retired");
  assert.ok(line.accepted, "and it keeps its place");
  // a retired key does not come back; a new key is added by a gesture bound to the key shown (point 16)
  const s = () => h.app.identity.sessionFrom(f.token);
  const again = { keys: { keys: [reg.key.jwk] }, kid: reg.key.kid };
  const shownAgain = await h.app.issuers.keyPreview(await s(), reg.id, again);
  await gesture(h, f.session, "issuer-key-add", shownAgain.digest);
  await assert.rejects(h.app.issuers.keyAdd(await s(), reg.id, { ...again, digest: shownAgain.digest }, {}), { code: "key-exists" });
  const next = gitlabKey();
  const input = { keys: { keys: [next.jwk] }, kid: next.kid };
  const shown = await h.app.issuers.keyPreview(await s(), reg.id, input);
  assert.equal(shown.thumbprint, next.kid);
  await gesture(h, f.session, "issuer-key-add", shown.digest);
  const swapped = gitlabKey();
  await assert.rejects(h.app.issuers.keyAdd(await s(), reg.id, { keys: { keys: [swapped.jwk] }, kid: swapped.kid, digest: shown.digest }, {}), { code: "confirmation-stale" }, "another key than the one shown");
  await h.app.issuers.keyAdd(await s(), reg.id, { ...input, digest: shown.digest }, {});
  assert.equal((await sendToken(h, next.sign(claims({ pipeline: "200", job: "2000" })))).status, 201, "the new key signs");
  assert.equal((await sendToken(h, sign(claims({ pipeline: "201", job: "2010" })))).refusal, "key-retired", "the retired one still does not");
});

test("a key expires 365 days after it was added unless confirmed again; an expired key is told key-retired, and the app warns 30 days before", async () => {
  const h = harness();
  const f = await founder(h);
  const { reg, sign, claims } = await instance(h, f);
  const view = async () => (await h.app.identity.accessView(await h.app.identity.sessionFrom(f.token))).issuers[0].keys[0];
  assert.equal((await view()).expiresSoon, false);
  h.clock.advance(336 * DAY);
  await signInAgain(h, f);
  assert.deepEqual([(await view()).state, (await view()).expiresSoon], ["live", true]);
  h.clock.advance(29 * DAY);
  assert.equal(keyState({ addedAt: 0, confirmedAt: 0 }, KEY_LIFE), "expired");
  assert.equal(keyState({ addedAt: 0, confirmedAt: 0 }, KEY_LIFE - 1), "live");
  const f2 = { session: await signInAgain(h, f), token: f.token };
  assert.equal((await view()).state, "expired");
  assert.equal((await sendToken(h, sign(claims({ pipeline: "40", job: "400" })))).refusal, "key-retired");
  assert.equal((await journal(h, f.tenant)).pop().body.detail.key.state, "expired");
  // confirmed again by the gesture that adds it: the same key, shown, moves its expiry
  const input = { keys: { keys: [reg.key.jwk] }, kid: reg.key.kid };
  const shown = await h.app.issuers.keyPreview(f2.session, reg.id, input);
  await gesture(h, f2.session, "issuer-key-add", shown.digest, "cred-1");
  const out = await h.app.issuers.keyAdd(await h.app.identity.sessionFrom(f2.token), reg.id, { ...input, digest: shown.digest }, {});
  assert.equal(out.confirmed, true);
  assert.equal((await sendToken(h, sign(claims({ pipeline: "41", job: "410" })))).status, 201);
});
/** A session opened again after the first one's seven days: sign in with the founder's first passkey. */
async function signInAgain(h, f) {
  const o = await h.app.identity.signInOptions();
  const r = await h.app.identity.signIn({ challengeId: o.challengeId, response: { id: f.creds[0], challenge: o.options.challenge }, ua: "Chrome/130 Macintosh" });
  f.token = r.token;
  return h.app.identity.sessionFrom(r.token);
}

// ------------------------------------------------------------------ section 4: the registration
test("section 4 and point 16: registering is a gesture bound to the digest of the issuer and the key shown; look-alike issuers are refused", async () => {
  const h = harness({ config: { hosts: ["app.runward.dev", "runward.dev"] } });
  const f = await founder(h);
  const s = () => h.app.identity.sessionFrom(f.token);
  const key = gitlabKey();
  const input = { issuer: "http://gitlab-temoin.local:8929", keys: { keys: [key.jwk] }, kid: key.kid };
  const shown = await h.app.issuers.preview(await s(), input);
  assert.deepEqual([shown.issuer, shown.thumbprint, shown.bits], [input.issuer, key.kid, 2048]);
  await assert.rejects(h.app.issuers.register(await s(), { ...input, digest: shown.digest }, {}), { code: "gesture-required" });
  await gesture(h, f.session, "issuer-register", shown.digest);
  // the gesture verified for one key does not register another, nor another issuer
  const other = gitlabKey();
  await assert.rejects(h.app.issuers.register(await s(), { ...input, keys: { keys: [other.jwk] }, kid: other.kid, digest: shown.digest }, {}), { code: "confirmation-stale" });
  await assert.rejects(h.app.issuers.register(await s(), { ...input, issuer: "http://gitlab-temoin.local:8930", digest: shown.digest }, {}), { code: "confirmation-stale" });
  const otherShown = await h.app.issuers.preview(await s(), { ...input, keys: { keys: [other.jwk] }, kid: other.kid });
  await assert.rejects(h.app.issuers.register(await s(), { ...input, keys: { keys: [other.jwk] }, kid: other.kid, digest: otherShown.digest }, {}), { code: "gesture-required" }, "a digest that matches its key, but not the gesture verified");
  await gesture(h, f.session, "issuer-register", shown.digest);
  const reg = await h.app.issuers.register(await s(), { ...input, digest: shown.digest }, {});
  assert.equal(reg.issuer, "http://gitlab-temoin.local:8929", "the string kept is the one given, unchanged");
  const entry = (await journal(h, f.tenant)).pop().body;
  assert.deepEqual([entry.what, entry.object, entry.detail.thumbprint], ["issuer-registered", reg.id, key.kid]);
  assert.ok([...h.objects._map.keys()].some((k) => k.startsWith(`tenants/${f.tenant}/`) && h.objects._map.get(k).toString().includes("issuer-registered")), "written to the security log");
  // look-alikes of the public issuers, of Entra and of the service; and what is not a plain address
  const refused = (issuer) => { try { readIssuer(issuer, { serviceHosts: ["app.runward.dev", "runward.dev", "localhost:8080"] }); return "accepted"; } catch (e) { return e.code; } };
  for (const i of ["https://gitlab.com", "http://gitlab.com", "https://GITLAB.COM", "https://gitlab.com:443", "https://gitlab.com:8443/x", "https://ci.gitlab.com", "https://a.b.gitlab.com",
    "https://token.actions.githubusercontent.com", "https://x.token.actions.githubusercontent.com", "https://login.microsoftonline.com/tenant/v2.0", "https://sts.windows.net/tenant",
    // every host under which the index names a public forge: a registration under github.com would be named as GitHub's own are
    "https://github.com", "http://github.com", "https://www.github.com", "https://api.github.com", "https://GitHub.com:8443",
    "https://app.runward.dev", "https://APP.runward.dev/send", "https://runward.dev", "https://x.runward.dev", "http://localhost:8080"]) assert.equal(refused(i), "issuer-not-allowed", i);
  // a trailing dot and an empty label are refused, never taken off: one string each
  for (const i of ["https://gitlab.com.", "https://gitlab.com..", "https://github.com.", "https://github.com..", "https://www.github.com.", "https://gitlab.example.test.", "https://.gitlab.example.test", "https://gitlab.example.test.:8443"]) assert.equal(refused(i), "issuer-malformed", i);
  for (const i of ["", "gitlab.example.test", "ftp://gitlab.example.test", "https://", "https://user@gitlab.example.test", "https://user:pw@gitlab.example.test", "https://gitlab.example.test@gitlab.com",
    "https://gitlab.example.test/?a=1", "https://gitlab.example.test?a=1", "https://gitlab.example.test#x", "https://gitlab.example.test/", "https://gitlab.example.test//x", "https://gitlab.example.test:port",
    "https://gitlab.example.test:1:2", "https://gıtlab.com", "https://xn--gtlab-zva.com", "https://gitlab.com​.evil.test", "https://gitlab.example.test /x", " https://gitlab.example.test",
    "https://gitlab.example.test\\@gitlab.com", "https://[::1]", "https://gitlab%2ecom", "https://-gitlab.example.test", "https://gitlab..example.test", "x".repeat(300), 42, null, ["https://gitlab.example.test"]]) assert.equal(refused(i), "issuer-malformed", JSON.stringify(i));
  for (const i of ["https://gitlab.example.test", "http://gitlab-temoin.local:8929", "https://gitlab.example.test/gitlab", "https://10.0.0.5:8443", "https://notgitlab.com", "https://gitlab.com.example.test"]) assert.equal(refused(i), "accepted", i);
  assert.deepEqual(Object.keys(PUBLIC_ISSUERS), [GITHUB_ISSUER_KEY, GITLAB_COM_ISSUER], "the public issuers are a closed list");
  assert.ok(RESERVED_ISSUER_HOSTS.includes("login.microsoftonline.com") && RESERVED_ISSUER_HOSTS.includes("sts.windows.net"), "Entra's hosts (ADR-0030) are in the guard");
  for (const g of ["issuer-register", "issuer-key-add", "issuer-key-retire", "issuer-remove", "protection-lift", "protection-restore", "order-epoch-open"]) assert.ok(GESTURES.includes(g), g);
});

test("section 4: at most 5 registrations a tenant and 4 live keys a registration; a registration is removed only when no repository is declared on it", async () => {
  const h = harness();
  const f = await founder(h);
  const s = () => h.app.identity.sessionFrom(f.token);
  const { reg } = await instance(h, f);
  for (let i = 2; i <= MAX_REGISTRATIONS; i++) await registerIssuer(h, f, { issuer: `https://gitlab${i}.example.test` });
  await assert.rejects(registerIssuer(h, f, { issuer: "https://gitlab6.example.test" }), { code: "issuer-limit" });
  for (let i = 2; i <= MAX_LIVE_KEYS; i++) {
    const k = gitlabKey();
    const input = { keys: { keys: [k.jwk] }, kid: k.kid };
    const shown = await h.app.issuers.keyPreview(await s(), reg.id, input);
    await gesture(h, f.session, "issuer-key-add", shown.digest);
    await h.app.issuers.keyAdd(await s(), reg.id, { ...input, digest: shown.digest }, {});
  }
  const fifth = gitlabKey();
  const input = { keys: { keys: [fifth.jwk] }, kid: fifth.kid };
  const shown = await h.app.issuers.keyPreview(await s(), reg.id, input);
  await gesture(h, f.session, "issuer-key-add", shown.digest);
  await assert.rejects(h.app.issuers.keyAdd(await s(), reg.id, { ...input, digest: shown.digest }, {}), { code: "key-limit" });
  // removal
  await gesture(h, f.session, "issuer-remove", reg.id);
  await assert.rejects(h.app.issuers.remove(await s(), reg.id, {}), { code: "issuer-in-use" });
  const view = await h.app.identity.accessView(await s());
  const empty = view.issuers.find((i) => i.id !== reg.id);
  await assert.rejects(h.app.issuers.remove(await s(), empty.id, {}), { code: "gesture-required" });
  await gesture(h, f.session, "issuer-remove", empty.id);
  await h.app.issuers.remove(await s(), empty.id, {});
  assert.equal((await h.app.identity.accessView(await s())).issuers.length, MAX_REGISTRATIONS - 1);
  // a removed registration is an unknown one: its tokens are unreadable, and nothing can be declared on it
  await gesture(h, f.session, null, null);
  await assert.rejects(h.app.repositories.declare(await s(), { forge: "gitlab", issuer: empty.id, name: "temoin/autre" }, {}), { code: "issuer-unknown" });
  await assert.rejects(h.app.repositories.declare(await s(), { forge: "gitlab", issuer: "f".repeat(32), name: "temoin/autre" }, {}), { code: "issuer-unknown" });
});

// ------------------------------------------------------------------ point 6: the issuer key in every key of the store
test("point 6, planted control: two tenants register the same issuer string and declare the same project_id: both pin, no upload crosses, no counter and no replay id is shared", async () => {
  const h = harness();
  const A = await founder(h, { prefix: "a" });
  const B = await founder(h, { prefix: "b" });
  const a = await instance(h, A, { issuer: INSTANCE });
  const b = await instance(h, B, { issuer: INSTANCE });
  assert.notEqual(a.reg.id, b.reg.id, "two tenants that register the same string hold two issuer keys");
  assert.ok(a.repo.confirm.published && b.repo.confirm.published, "both pin the same project_id of the same issuer string");
  const rows = async (t) => h.store.tx(t, (tx) => tx.list("forge_repository"));
  assert.equal((await rows(A.tenant))[0].repositoryId, scopedKey("gitlab", a.reg.id, "1"));
  assert.equal((await rows(B.tenant))[0].repositoryId, scopedKey("gitlab", b.reg.id, "1"));
  // no upload crosses: A's key with B's audience, B's key with A's audience, are unreadable; each lands in its tenant
  const lenA = (await journal(h, A.tenant)).length, lenB = (await journal(h, B.tenant)).length;
  assert.equal((await sendToken(h, a.sign(a.claims({ pipeline: "50", job: "500" }, { aud: b.reg.audience })))).refusal, "token-unreadable");
  assert.equal((await sendToken(h, b.sign(b.claims({ pipeline: "50", job: "500" }, { aud: a.reg.audience })))).refusal, "token-unreadable");
  assert.deepEqual([(await journal(h, A.tenant)).length, (await journal(h, B.tenant)).length], [lenA, lenB]);
  // the same replay id, used by both, is not shared; neither is the hour's counter of runs
  const jti = "shared-jti-0001";
  assert.equal((await sendToken(h, a.sign(a.claims({ pipeline: "51", job: "510" }, { jti })))).status, 201);
  assert.equal((await sendToken(h, b.sign(b.claims({ pipeline: "51", job: "510" }, { jti })))).status, 201, "B's upload with the same jti is its own");
  assert.equal((await sendToken(h, a.sign(a.claims({ pipeline: "52", job: "520" }, { jti })))).refusal, "token-replayed");
  for (let i = 0; i < 28; i++) assert.equal((await sendToken(h, a.sign(a.claims({ pipeline: String(60 + i), job: String(600 + i) })))).status, 201, `A's run ${i}`);
  assert.equal((await sendToken(h, a.sign(a.claims({ pipeline: "99", job: "990" })))).refusal, "rate-limited", "A spent its 30 runs of the hour");
  assert.equal((await sendToken(h, b.sign(b.claims({ pipeline: "53", job: "530" })))).status, 201, "B's counter is untouched by A's");
  assert.equal(h.store._state.refused.size, 0);
  // each tenant's index holds its own upload only
  const mine = async (t) => (await h.store.tx(t, (tx) => tx.list("upload"))).length;
  assert.deepEqual([await mine(A.tenant), await mine(B.tenant)], [30, 3]);
  // a tenant cannot declare on another's registration, even knowing its identifier; nor learn that the project is declared there
  await gesture(h, B.session, null, null);
  await assert.rejects(h.app.repositories.declare(await h.app.identity.sessionFrom(B.token), { forge: "gitlab", issuer: a.reg.id, name: "temoin/demo", missions: [{ id: "other" }] }, {}), { code: "issuer-unknown" });
  await assert.rejects(h.store.tx(B.tenant, (tx) => tx.insert("forge_repository", { id: h.store.newId(), forgeName: "gitlab", issuerKey: a.reg.id, nameKey: scopedKey("gitlab", a.reg.id, "temoin/x"), name: "temoin/x", state: "pending" })), /live registration of its own tenant/, "the store refuses it too");
  await assert.rejects(h.store.tx(B.tenant, (tx) => tx.insert("forge_repository", { id: h.store.newId(), forgeName: "gitlab", issuerKey: b.reg.id, nameKey: "temoin/x", name: "temoin/x", state: "pending" })), /forge_repository_keys_scoped/, "a key that does not carry its issuer key is refused by the store");
  // and a GitHub repository of the same name and the same id is another repository
  await pinnedRepository(h, A, { name: "temoin/demo", mission: "gh-demo", claims: { repository_id: "1" } });
  assert.equal((await rows(A.tenant)).length, 2);
});

// ------------------------------------------------------------------ point 14: the confirmation
test("point 14: the confirmation is bound to the values shown; values that changed refuse confirmation-stale; a new push with the same values changes nothing", async () => {
  const h = harness();
  const f = await founder(h);
  const s = () => h.app.identity.sessionFrom(f.token);
  const pendingOf = async (id) => (await h.app.identity.accessView(await s())).repositories.find((r) => r.id === id).pending;
  // ---- GitLab
  await gesture(h, f.session, "declare-with-consent", "gitlab:gitlab.com:group/app");
  const d = await h.app.repositories.declare(await s(), { forge: "gitlab", name: "group/app", consent: true, missions: [{ id: "app" }] }, {});
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/app", projectId: "77", pipeline: "1", job: "10" })), { mission: "app" })).status, 202);
  const shown = await pendingOf(d.id);
  assert.deepEqual(shown.values, { forge: "gitlab", issuerKey: COM, projectId: "77", namespaceId: "2", projectPath: "group/app", definitionRef: "gitlab.com/group/app//.gitlab-ci.yml@refs/heads/main" });
  assert.equal(shown.digest, pinDigest(shown.values)); assert.equal(shown.confirmable, true);
  // a page opened before the deploy binds its gesture to the repository alone: asked once more (the one change that reaches GitHub)
  await gesture(h, f.session, "repository-confirm", d.id);
  await assert.rejects(h.app.repositories.confirm(await s(), d.id, {}, {}), { code: "gesture-required" });
  // the gesture is verified for the values shown; a new push carrying the same values changes nothing
  await gesture(h, f.session, "repository-confirm", confirmObject(d.id, shown.digest));
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/app", projectId: "77", pipeline: "2", job: "20" })), { mission: "app" })).status, 202);
  assert.equal((await pendingOf(d.id)).digest, shown.digest);
  // planted: another project takes the name before the member confirms: the values to pin are no longer those shown
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/app", projectId: "666", pipeline: "3", job: "30" })), { mission: "app" })).status, 202);
  await assert.rejects(h.app.repositories.confirm(await s(), d.id, { digest: shown.digest }, {}), { code: "confirmation-stale" });
  const now = await pendingOf(d.id);
  assert.equal(now.values.projectId, "666", "the screen then shows the new ones");
  // and the gesture verified for the first values does not confirm the second
  await assert.rejects(h.app.repositories.confirm(await s(), d.id, { digest: now.digest }, {}), { code: "gesture-required" });
  assert.equal((await h.store.tx(f.tenant, (tx) => tx.get("forge_repository", { id: d.id }))).state, "pending", "nothing was pinned");
  await gesture(h, f.session, "repository-confirm", confirmObject(d.id, now.digest));
  await h.app.repositories.confirm(await s(), d.id, { digest: now.digest }, {});
  const row = await h.store.tx(f.tenant, (tx) => tx.get("forge_repository", { id: d.id }));
  assert.deepEqual([row.state, row.repositoryId, row.ownerId, row.definitionRef], ["pinned", scopedKey("gitlab", COM, "666"), "2", "gitlab.com/group/app//.gitlab-ci.yml@refs/heads/main"]);
  // ---- GitHub: the same binding
  await gesture(h, f.session, "declare-with-consent", "stranxik/dropyour");
  const g = await h.app.repositories.declare(await s(), { name: "stranxik/dropyour", consent: true, missions: [{ id: "dropyour" }] }, {});
  assert.equal((await send(h, { run_number: "1", run_id: "39000000001" })).status, 202);
  const gh = await pendingOf(g.id);
  assert.deepEqual(gh.values, { forge: "github", repositoryId: "1001", ownerId: "2002" });
  await gesture(h, f.session, "repository-confirm", confirmObject(g.id, gh.digest));
  assert.equal((await send(h, { run_number: "2", run_id: "39000000002", repository_id: "9999" })).status, 202, "another repository of the same name sends before the confirmation");
  await assert.rejects(h.app.repositories.confirm(await s(), g.id, { digest: gh.digest }, {}), { code: "confirmation-stale" });
  await assert.rejects(h.app.repositories.confirm(await s(), g.id, {}, {}), { code: "gesture-required" }, "without the digest shown, the gesture verified for other values confirms nothing");
  assert.equal((await h.store.tx(f.tenant, (tx) => tx.get("forge_repository", { id: g.id }))).repositoryId, null);
});

test("rule 3: a definition that does not name the declared file and branch is shown and cannot be confirmed; a changed declaration unpins it", async () => {
  const h = harness();
  const f = await founder(h);
  const s = () => h.app.identity.sessionFrom(f.token);
  const view = async (id) => (await h.app.identity.accessView(await s())).repositories.find((r) => r.id === id);
  await gesture(h, f.session, "declare-with-consent", "gitlab:gitlab.com:group/app");
  const d = await h.app.repositories.declare(await s(), { forge: "gitlab", name: "group/app", workflow: "ci/pipeline.yml", consent: true, missions: [{ id: "app" }] }, {});
  // the pipeline's root definition is .gitlab-ci.yml, the declaration says ci/pipeline.yml
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/app", pipeline: "1", job: "10" })), { mission: "app" })).status, 202);
  const shown = (await view(d.id)).pending;
  assert.equal(shown.confirmable, false);
  await gesture(h, f.session, "repository-confirm", confirmObject(d.id, shown.digest));
  await assert.rejects(h.app.repositories.confirm(await s(), d.id, { digest: shown.digest }, {}), { code: "definition-not-pinned" });
  // the declaration is corrected, a new send arrives, and it confirms
  await gesture(h, f.session, null, null);
  await h.app.repositories.patch(await s(), d.id, { workflow: ".gitlab-ci.yml" }, {});
  assert.equal((await view(d.id)).pending.confirmable, true);
  await confirmRepository(h, f, d.id);
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/app", pipeline: "2", job: "20" })), { mission: "app" })).status, 201);
  // changing the declared branch unpins the definition: every upload is refused until a member confirms again
  await gesture(h, f.session, null, null);
  const patched = await h.app.repositories.patch(await s(), d.id, { defaultBranch: "release" }, {});
  assert.equal(patched.changes.definitionUnpinned, true, "the app says so when the declaration is changed");
  assert.equal((await view(d.id)).definitionPinned, false);
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/app", pipeline: "3", job: "30" })), { mission: "app" })).refusal, "definition-not-pinned", "the old branch");
  assert.equal((await view(d.id)).pending, null, "a definition that does not name the declared branch is not offered for confirmation");
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/app", branch: "release", pipeline: "4", job: "40" })), { mission: "app" })).refusal, "definition-not-pinned", "the new branch, not confirmed yet");
  const again = (await view(d.id)).pending;
  assert.equal(again.values.definitionRef, "gitlab.com/group/app//.gitlab-ci.yml@refs/heads/release");
  await confirmRepository(h, f, d.id);
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/app", branch: "release", pipeline: "5", job: "50" })), { mission: "app" })).status, 201);
  // a renamed project: its definition changes, it waits for a new confirmation, and is then named by its new path
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/renamed", branch: "release", pipeline: "6", job: "60" })), { mission: "app" })).refusal, "definition-not-pinned");
  await confirmRepository(h, f, d.id);
  assert.equal((await view(d.id)).name, "group/renamed");
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "group/renamed", branch: "release", pipeline: "7", job: "70" })), { mission: "app" })).status, 201);
  assert.equal(JSON.parse((await h.app.reading.index(f.tenant)).bytes.toString("utf8")).missions[0].repository, "gitlab.com/group/renamed");
  // the declared file is a bounded path
  await gesture(h, f.session, null, null);
  for (const w of ["a@b", "ci//x.yml", "/abs.yml", "ci/", "ci/../x.yml@", "a b.yml"]) await assert.rejects(h.app.repositories.patch(await s(), d.id, { workflow: w }, {}), { code: "workflow-malformed" }, w);
});

// ------------------------------------------------------------------ the path the pinned runward-fleet cannot carry
// runward-fleet pinned at main@c9a886a (ADR-0033, refining ADR-0024; runward's ADR-0130): a repository identity
// is a host with an optional port and a path of 2 to 8 segments. The refusal is the library's own answer, so
// it fell away for nested groups and a host with a port without a line of the declaration changing.
test("a name the pinned runward-fleet cannot carry is refused at declaration with its reason, never truncated: nested groups and a port are carried, nine segments and an address are not", async () => {
  const h = harness();
  const f = await founder(h);
  const s = () => h.app.identity.sessionFrom(f.token);
  await gesture(h, f.session, null, null);
  const declare = async (input) => { try { return (await h.app.repositories.declare(await s(), { forge: "gitlab", missions: [{ id: `m${randomBytes(3).toString("hex")}` }], ...input }, {})).state; } catch (e) { return e.code; } };
  assert.equal(await declare({ name: "group/project" }), "pending");
  assert.equal(await declare({ name: "group/subgroup/project" }), "pending", "a path of three segments");
  assert.equal(await declare({ name: "a/b/c/d/e/f/g/h" }), "pending", "eight segments, the most the pinned library reads");
  assert.equal(await declare({ name: "a/b/c/d/e/f/g/h/i" }), "repository-path-unsupported", "nine segments: GitLab admits them, the view cannot name them");
  const port = await registerIssuer(h, f, { issuer: "http://gitlab-temoin.local:8929" });
  await gesture(h, f.session, null, null);
  assert.equal(await declare({ issuer: port.id, name: "temoin/demo" }), "pending", "an instance whose host carries a port");
  assert.equal(await declare({ issuer: port.id, name: "temoin/sub/demo" }), "pending");
  assert.equal((await h.store.tx(f.tenant, (tx) => tx.list("forge_repository"))).length, 5, "nothing was declared under a shortened name");
  assert.match(refusal("repository-path-unsupported", "en").message, /its path has more than eight segments\.$/);
  assert.match(refusal("repository-path-unsupported", "fr").message, /son chemin a plus de huit segments\.$/);
  // the answer is the pinned library's own: what it admits is declared; the control names what it refuses
  assert.deepEqual(["github.com/a/b", "gitlab.com/g/p", "gitlab.com/g/s/p", "gitlab-temoin.local:8929/temoin/demo", "gitlab.com/a/b/c/d/e/f/g/h"].map((n) => h.assembler.admits(n)), [true, true, true, true, true]);
  assert.deepEqual(["gitlab.com/a/b/c/d/e/f/g/h/i", "10.0.0.7:8929/temoin/demo", "gitlab.internal:0/g/p", "gitlab.internal:65536/g/p"].map((n) => h.assembler.admits(n)), [false, false, false, false]);
  for (const name of ["project", "group/", "/group/project", "group//project", "group/pro ject", "group/..", "group/pro@ject"]) assert.equal(await declare({ name }), "repository-malformed", name);
  assert.match(refusal("repository-malformed", "en", { forge: "gitlab" }).message, /group\/project/);
  assert.equal(await declare({ forge: "bitbucket", name: "a/b" }), "body-invalid");
});

// The review of PR #31, finding 1: the pinned library names hosts and ports by its own grammar (runward's ADR-0130),
// which refuses some issuers readIssuer reads. Such an instance is refused at registration, asked of the library,
// so that no repository is declared on it and no tenant's whole assembly is refused after a re-pin.
test("an instance the pinned runward-fleet cannot name is refused at registration (issuer-malformed), asked of the library; a nameable one is registered", async () => {
  const h = harness();
  const f = await founder(h);
  const s = () => h.app.identity.sessionFrom(f.token);
  const key = gitlabKey();
  const preview = async (issuer) => { try { await h.app.issuers.preview(await s(), { issuer, keys: { keys: [key.jwk] }, kid: key.kid }); return "shown"; } catch (e) { return e.code; } };
  // readIssuer reads every one of them: the refusal is the library's
  for (const issuer of ["http://10.0.0.7", "http://10.0.0.7:8929", "https://gitlab.1corp", "https://1gitlab", "https://gitlab.example.test:0", "https://gitlab.example.test:08443", `https://${"a".repeat(64)}.example.test`]) {
    assert.doesNotThrow(() => readIssuer(issuer, { serviceHosts: ["app.runward.dev"] }), issuer);
    assert.equal(await preview(issuer), "issuer-malformed", issuer);
  }
  assert.match(refusal("issuer-malformed", "en").message, /cannot be read/);
  for (const issuer of ["http://gitlab-temoin.local:8929", "https://gitlab.example.test", "https://gitlab.example.test:443", "https://gitlab.c0rp", "https://1a.gitlab.example.test"]) assert.equal(await preview(issuer), "shown", issuer);
  // the control: the registration that passes is a name the library admits, the one refused is not
  assert.deepEqual([indexNameOf("http://10.0.0.7", "g/p"), indexNameOf("https://1gitlab", "g/p")].map((n) => h.assembler.admits(n)), [false, false]);
  await assert.rejects(registerIssuer(h, f, { issuer: "http://10.0.0.7" }), { code: "issuer-malformed" });
  assert.equal((await h.store.tx(f.tenant, (tx) => tx.list("issuer"))).length, 0, "nothing registered");
});

// The review of PR #31, finding 3: the library drops `:443`; the app names the instance the same way in the inventory
// it writes, and the registration keeps its issuer string as given (compared with `iss` by exact equality).
test("an instance registered with :443 is named without it, in fleet.json and in the index alike; its issuer string is kept as given", async () => {
  assert.equal(indexNameOf("https://gitlab.example.test:443", "temoin/demo"), "gitlab.example.test/temoin/demo");
  assert.equal(indexNameOf("http://gitlab.example.test:443", "temoin/demo"), "gitlab.example.test/temoin/demo", "the library drops :443 whatever the scheme");
  assert.equal(indexNameOf("https://gitlab.example.test:8443", "temoin/demo"), "gitlab.example.test:8443/temoin/demo");
  const h = harness();
  const f = await founder(h);
  const issuer = "https://gitlab.example.test:443";
  const reg = await registerIssuer(h, f, { issuer });
  assert.equal(reg.issuer ?? reg.shown.issuer, issuer, "the string stored is the one given");
  await gesture(h, f.session, null, null);
  const manifests = [];
  const assemble = h.assembler.assemble;
  h.assembler.assemble = (input) => { const r = assemble(input); if (r.ok) manifests.push(JSON.parse(r.manifest.toString("utf8"))); return r; };
  const repo = await pinnedGitlab(h, f, { issuer: reg.id, sign: reg.key.sign, claims: { issuer, audience: reg.audience } });
  assert.ok(repo.confirm.published);
  const index = JSON.parse((await h.app.reading.index(f.tenant)).bytes.toString("utf8"));
  assert.equal(index.missions[0].repository, "gitlab.example.test/temoin/demo");
  assert.equal(manifests.at(-1).missions[0].repository, "gitlab.example.test/temoin/demo", "the inventory the app writes says it the way the index does");
  // a token of that instance still carries the string as given: anything else is not this registration
  const other = await sendToken(h, reg.key.sign(gitlabClaims(h.clock, { issuer: "https://gitlab.example.test", audience: reg.audience, pipeline: "11", job: "110" })));
  assert.equal(other.refusal, "token-unreadable", "iss compared by exact equality: https://h is not https://h:443");
});

// ADR-0029 section 5, step b: an index with a path of three levels, on an instance whose host carries a port,
// published, exported and replayed byte for byte by scripts/replay-export.mjs under the pin.
test("step b: a GitLab project of nested groups on an instance with a port is named host:port/full/path in the index, and its export replays the same", async () => {
  const h = harness();
  const f = await founder(h);
  const issuer = "http://gitlab-temoin:8929";
  const reg = await registerIssuer(h, f, { issuer });
  await gesture(h, f.session, null, null);
  const repo = await pinnedGitlab(h, f, { issuer: reg.id, sign: reg.key.sign, name: "temoin/Groupe/demo", claims: { issuer, audience: reg.audience } });
  assert.equal(repo.first.status, 202, "the first send is kept, to confirm");
  assert.ok(repo.confirm.published, "confirmed: the kept send is published");
  const second = await sendToken(h, reg.key.sign(gitlabClaims(h.clock, { issuer, audience: reg.audience, path: "temoin/Groupe/demo", sha: "2b7f0c9e5d1a4386b0f2e9c7a5d3b1e8f6a4c2d0", pipeline: "11", job: "110" })));
  assert.equal(second.status, 201);
  assert.equal(second.body.level, "P4", "a registered instance is shown P4");
  const index = JSON.parse((await h.app.reading.index(f.tenant)).bytes.toString("utf8"));
  assert.equal(index.missions[0].repository, "gitlab-temoin:8929/temoin/groupe/demo", "the identity the library names: the host, its port, every segment, in lower case");
  await gesture(h, f.session, "export", "");
  const archive = await h.app.reading.prepareExport(await h.app.identity.sessionFrom(f.token), {});
  const r = replay(archive.bytes, h.assembler.pin.version, replayPin().archives);
  assert.deepEqual(r.results.map((x) => x.state), ["same", "same"], "both publications rebuild to their bytes");
  assert.equal(r.verdict, "same");
  assert.equal(exitCode(r), 0);
});

// ------------------------------------------------------------------ rule 7: the order of uploads
test("rule 7: pipeline_id then job_id order the uploads; an upload issued later and ranked historical is signalled; a member opens a new epoch", async () => {
  assert.deepEqual(placeUpload(null, { pipelineId: "5", jobId: "50", iat: 100 }, 0), { rank: "current", epoch: 0, epochOpened: false, issuedLater: false });
  const cur = { epoch: 0, runNumber: "5", runAttempt: "50", issuedAt: 100 };
  assert.equal(placeUpload(cur, { pipelineId: "5", jobId: "51", iat: 90 }, 0).rank, "current", "job_id orders within a pipeline, whatever iat says");
  assert.equal(placeUpload(cur, { pipelineId: "6", jobId: "1", iat: 90 }, 0).rank, "current");
  assert.deepEqual(placeUpload(cur, { pipelineId: "4", jobId: "99", iat: 200 }, 0), { rank: "historical", epoch: 0, epochOpened: false, issuedLater: true });
  assert.equal(placeUpload(cur, { pipelineId: "4", jobId: "99", iat: 50 }, 0).issuedLater, false, "a late job of an old pipeline");
  assert.equal(placeUpload(cur, { pipelineId: "1", jobId: "1", iat: 200 }, 1).rank, "current", "a new epoch");
  const h = harness();
  const f = await founder(h);
  const { repo, sign, claims } = await instance(h, f);
  assert.equal((await sendToken(h, sign(claims({ pipeline: "500", job: "5000" })))).body.current, true);
  // the instance was restored from a backup: its pipelines count again from lower numbers
  h.clock.advance(5 * MIN);
  const back = await sendToken(h, sign(claims({ pipeline: "12", job: "120" })));
  assert.deepEqual([back.status, back.body.current], [201, false], "ranked historical: no rule tells a restore from a late job");
  const hist = (await journal(h, f.tenant)).pop().body;
  assert.deepEqual([hist.what, hist.detail.issuedLater, hist.detail.currentRunNumber, hist.detail.currentRunAttempt], ["send-historical", true, "500", "5000"]);
  const line = (await h.app.reading.status(f.session)).lines[0];
  assert.deepEqual([line.orderSignal.current.pipelineId, line.orderSignal.later.pipelineId, line.orderSignal.repository], ["500", "12", repo.id], "the screen says so, with both orders");
  await assert.rejects(h.app.repositories.openEpoch(await h.app.identity.sessionFrom(f.token), repo.id, {}), { code: "gesture-required" });
  await gesture(h, f.session, "order-epoch-open", repo.id);
  assert.equal((await h.app.repositories.openEpoch(await h.app.identity.sessionFrom(f.token), repo.id, {})).epoch, 1);
  assert.equal((await journal(h, f.tenant)).pop().body.what, "order-epoch-opened");
  const next = await sendToken(h, sign(claims({ pipeline: "13", job: "130" })));
  assert.equal(next.body.current, true, "the next upload is the current one of the new epoch");
  assert.equal((await h.app.reading.status(f.session)).lines[0].orderSignal, null);
  // GitHub's repositories have neither gesture
  const gh = await pinnedRepository(h, f);
  await gesture(h, f.session, "order-epoch-open", gh.id);
  await assert.rejects(h.app.repositories.openEpoch(await h.app.identity.sessionFrom(f.token), gh.id, {}), { code: "not-found" });
  await gesture(h, f.session, "protection-lift", gh.id);
  await assert.rejects(h.app.repositories.protection(await h.app.identity.sessionFrom(f.token), gh.id, true, {}), { code: "not-found" });
});

// ------------------------------------------------------------------ points 11 and 12: GitHub unchanged, the contract by addition
test("point 11: none of GitHub's rule codes is answered to a GitLab token, none of GitLab's to a GitHub one; refusals after the repository are journaled in its tenant", async () => {
  const h = harness();
  const f = await founder(h);
  const { sign, claims } = await instance(h, f);
  const GITHUB_RULES = ["ref-not-main", "called-workflow-not-pinned", "called-workflow-revoked", "runner-not-hosted", "event-not-push", "workflow-not-pinned"];
  const GITLAB_RULES = ["token-too-old", "key-retired", "definition-absent", "definition-not-pinned", "commit-mismatch", "ref-not-declared", "ref-not-protected", "source-not-admitted"];
  const seen = [];
  let n = 70;
  for (const over of [{ pipeline_source: "api" }, { ref_protected: "false" }, { ref: "other", ref_path: "refs/heads/other" }, { ref_type: "tag" }, { ci_config_ref_uri: undefined, ci_config_sha: undefined },
    { ci_config_sha: "1".repeat(40) }, { ci_config_ref_uri: "gitlab.example.test/temoin/demo//.gitlab-ci.yml@refs/heads/other" }, { namespace_id: "9" }, { runner_environment: "self-hosted" }, { event_name: "pull_request" }]) {
    const r = await sendToken(h, sign(claims({ pipeline: String(++n), job: String(n * 10) }, over)));
    seen.push(r.refusal ?? `accepted ${r.status}`);
  }
  assert.deepEqual(seen, ["source-not-admitted", "ref-not-protected", "ref-not-declared", "ref-not-declared", "definition-absent", "commit-mismatch", "definition-not-pinned", "owner-changed", "accepted 201", "accepted 201"]);
  assert.ok(seen.every((c) => !GITHUB_RULES.includes(c)));
  assert.deepEqual((await refusals(h, f.tenant)).slice(-8), seen.slice(0, 8), "each is written in the tenant's journal, with its code");
  await pinnedRepository(h, f);
  const gh = [];
  for (const over of [{ event_name: "pull_request" }, { ref: "refs/heads/feature" }, { runner_environment: "self-hosted" }, { job_workflow_sha: "0".repeat(40) }, { workflow_ref: "stranxik/dropyour/.github/workflows/other.yml@refs/heads/main" },
    { pipeline_source: "api", ref_protected: "false", ci_config_ref_uri: "x", ci_config_sha: "y" }]) gh.push((await send(h, { run_number: String(++n), run_id: `400000000${n}`, ...over })).refusal ?? "accepted");
  assert.deepEqual(gh, ["event-not-push", "ref-not-main", "runner-not-hosted", "called-workflow-not-pinned", "workflow-not-pinned", "accepted"]);
  assert.ok(gh.every((c) => !GITLAB_RULES.includes(c)));
  // a GitHub answer carries no forge and no level: its bodies are those of before the port
  const ok = await send(h, { run_number: "900", run_id: "40000000900" });
  assert.deepEqual(Object.keys(ok.body).sort(), ["current", "entry", "head", "indexSha256", "seq"]);
  assert.equal((await journal(h, f.tenant)).pop().body.who.id, "github:1001", "and its workload still reads github:<id>");
  assert.equal((await journal(h, f.tenant)).pop().body.detail.level.code, "P1");
});

test("point 12: the API contract changes by addition, with two exceptions: two remedies that name no forge, and the object of repository-confirm", async () => {
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const hash = (x) => createHash("sha256").update(x).digest("hex");
  const contract = JSON.parse(readFileSync(new URL("../../runward/contracts/api-contract.json", import.meta.url), "utf8"));
  // the contract of before the port (docs/adr-forge-port@85285c1): 40 routes, 62 refusals
  assert.equal(hash(contract.routes.slice(0, 40).join("\n")), "f4d02480639ed30fb3191a7c1d10aafd4979c22da4414b7bdb8affb763852ce6", "the routes of before are there, in their order");
  const added = Object.keys(FORGE).map((c) => `${c} ${REFUSALS[c].status}`);
  assert.equal(hash(JSON.stringify(contract.refusals.filter((r) => !added.includes(r)))), "9f4b9416cb581b1b37b72ea19671fd5634d90f6a9c1744bb487f5b8320b0cf5a", "the refusals of before keep their codes and statuses");
  assert.equal(contract.routes.length, 49); assert.equal(contract.refusals.length, 62 + added.length);
  for (const c of ["token-too-old", "definition-absent", "definition-not-pinned", "commit-mismatch", "ref-not-declared", "ref-not-protected", "source-not-admitted", "key-retired", "confirmation-stale"]) assert.ok(c in FORGE, `ADR-0029's code ${c}`);
  // exception 1: the two refusals answered before a forge is known name none
  for (const code of ["token-missing", "token-unreadable"]) for (const lang of ["fr", "en"]) {
    const t = refusal(code, lang);
    assert.doesNotMatch(`${t.message} ${t.action}`, /github|gitlab|workflow|id-token|id_tokens|pipeline/i, `${code} ${lang}`);
    assert.deepEqual(refusal(code, lang, { forge: "gitlab" }).action, t.action, "one text, whatever the forge");
  }
  // the remedies chosen by the forge; GitHub's are the default, unchanged
  for (const code of ["token-expired", "token-replayed", "token-audience", "repository-malformed"]) {
    assert.notEqual(refusal(code, "en", { forge: "gitlab" }).action + refusal(code, "en", { forge: "gitlab" }).message, refusal(code, "en").action + refusal(code, "en").message, code);
    assert.equal(refusal(code, "fr", { forge: "github" }).action, refusal(code, "fr").action);
  }
  assert.equal(refusal("token-expired", "en").action, "Re-run the job (re-run failed jobs).");
  assert.equal(refusal("token-audience", "en").action, "Do not change the audience: the send workflow sets it.");
});

// ------------------------------------------------------------------ before the repository: T18
test("T18 for GitLab: a verified token of a project nobody declared is answered repository-not-declared, and nothing is written in any journal", async () => {
  const h = harness();
  const f = await founder(h);
  const { sign, claims } = await instance(h, f);
  const before = (await journal(h, f.tenant)).length;
  assert.equal((await sendToken(h, sign(claims({ path: "temoin/autre", projectId: "2" })))).refusal, "repository-not-declared");
  assert.equal((await sendToken(h, comSign(comClaims(h, { path: "temoin/demo" })))).refusal, "repository-not-declared", "the same path and id on gitlab.com is another repository, undeclared");
  assert.equal((await send(h, { repository: "temoin/demo", repository_id: "1" })).refusal, "repository-not-declared", "and on GitHub");
  // a definition in another project, undeclared: the repository comes first in GitLab's order, so one answer
  assert.equal((await sendToken(h, sign(claims({ path: "temoin/demo-externe", projectId: "3" }, { ci_config_ref_uri: undefined, ci_config_sha: undefined })))).refusal, "repository-not-declared");
  assert.equal((await journal(h, f.tenant)).length, before);
  assert.equal(FIXTURE_CHECK.length > 0, true);
});

// ------------------------------------------------------------------ the review of the pull request (2026-11-12)
test("review 1: a registration under a public forge's host cannot be made, so the index never names a tenant's key github.com/<owner>/<repo>", async () => {
  const h = harness();
  const f = await founder(h);
  const key = gitlabKey();
  for (const issuer of ["https://github.com", "https://www.github.com", "https://gitlab.com..", "https://gitlab.com."]) {
    await assert.rejects(h.app.issuers.preview(await h.app.identity.sessionFrom(f.token), { issuer, keys: { keys: [key.jwk] }, kid: key.kid }), (e) => ["issuer-not-allowed", "issuer-malformed"].includes(e.code), issuer);
  }
  assert.equal((await h.store.tx(f.tenant, (tx) => tx.list("issuer"))).length, 0);
});

test("review 2: a retired key's token is held to its own times first, written once, and never breaks the service", async () => {
  const h = harness();
  const f = await founder(h);
  const { reg, sign, claims } = await instance(h, f);
  const old = sign(claims({ pipeline: "20", job: "200" }));        // signed while the key lived, never sent
  const keyId = (await h.app.identity.accessView(await h.app.identity.sessionFrom(f.token))).issuers[0].keys[0].id;
  await gesture(h, f.session, "issuer-key-retire", keyId);
  await h.app.issuers.keyRetire(await h.app.identity.sessionFrom(f.token), reg.id, keyId, {});
  const count = async () => (await refusals(h, f.tenant)).filter((c) => c === "key-retired").length;
  // (A) one fresh token replayed five times is written once
  const fresh = sign(claims({ pipeline: "21", job: "210" }));
  for (let i = 0; i < 5; i++) assert.equal((await sendToken(h, fresh)).refusal, "key-retired");
  assert.equal(await count(), 1, "one entry for one token, however often it is replayed");
  // planted: the token of before the retirement, replayed later: its own age answers, and nothing is written
  h.clock.advance(11 * MIN);
  for (let i = 0; i < 5; i++) assert.equal((await sendToken(h, old)).refusal, "token-too-old");
  h.clock.advance(60 * MIN);
  assert.equal((await sendToken(h, old)).refusal, "token-expired");
  assert.equal(await count(), 1, "an old token signed when the key lived writes nothing");
  // (B) planted: dates no calendar holds, signed by the retired key: refused as a token, no server error, nothing written
  const now = Math.floor(h.clock.now() / 1000);
  for (const over of [{ iat: Number.MAX_SAFE_INTEGER, exp: Number.MAX_SAFE_INTEGER }, { iat: Number.MAX_SAFE_INTEGER, exp: now + 3600 }, { iat: -Number.MAX_SAFE_INTEGER }, { iat: 1e300, exp: 1e300 }, { exp: Number.MAX_SAFE_INTEGER }]) {
    const r = await sendToken(h, sign(claims({ pipeline: "22", job: "220" }, over)));
    assert.ok(["token-unreadable", "token-too-old", "key-retired"].includes(r.refusal), `${JSON.stringify(over)}: ${JSON.stringify(r)}`);
  }
  assert.ok(await count() <= 2);
  // the same dates under a live key: refused too, never an error
  const live = await registerIssuer(h, f, { issuer: "https://gitlab.live.test" });
  for (const over of [{ iat: Number.MAX_SAFE_INTEGER, exp: Number.MAX_SAFE_INTEGER }, { exp: Number.MAX_SAFE_INTEGER }]) {
    const r = await sendToken(h, live.key.sign(gitlabClaims(h.clock, { issuer: "https://gitlab.live.test", audience: live.audience }, over)));
    assert.ok(["token-unreadable", "repository-not-declared"].includes(r.refusal), JSON.stringify(r));
  }
});

test("review 3: gitlab.com is closed unless the service opens it: its tokens are unreadable, it cannot be declared, and registered instances stay", async () => {
  const h = harness({ config: { gitlabCom: false } });
  const f = await founder(h);
  await gesture(h, f.session, null, null);
  const s = () => h.app.identity.sessionFrom(f.token);
  await assert.rejects(h.app.repositories.declare(await s(), { forge: "gitlab", issuer: "gitlab.com", name: "group/app" }, {}), { code: "issuer-unknown" });
  await assert.rejects(h.app.repositories.declare(await s(), { forge: "gitlab", name: "group/app" }, {}), { code: "issuer-unknown" }, "gitlab.com is the default issuer of the body: closed too");
  assert.equal((await h.app.identity.accessView(await s())).gitlabCom, false);
  assert.equal((await sendToken(h, comSign(comClaims(h)))).refusal, "token-unreadable");
  assert.ok(!h.fetches.some((u) => String(u).includes("gitlab.com")), "its keys are not read");
  const { sign, claims } = await instance(h, f);
  assert.equal((await sendToken(h, sign(claims({ pipeline: "11", job: "110" })))).status, 201);
  // the service's own default is closed; RW_GITLAB_COM=1 opens it, and adds its key host to the egress list
  const { readConfig, compose } = await import("../../src/main.js");
  const { memoryStore } = await import("../../src/adapters/store/memory.js");
  const { memoryObjects } = await import("../../src/adapters/objects/objects.js");
  const { silentLog } = await import("../../src/adapters/system/log.js");
  const made = (env) => compose(readConfig({ RW_STORE: "memory", ...env }), { clock: h.clock, log: silentLog, store: memoryStore({ clock: h.clock }), objects: memoryObjects(), authn: { } });
  assert.equal(readConfig({ RW_STORE: "memory" }).gitlabCom, false);
  assert.deepEqual(made({}).egress.allowed, ["token.actions.githubusercontent.com"]);
  assert.deepEqual([...made({ RW_GITLAB_COM: "1" }).egress.allowed].sort(), ["gitlab.com", "token.actions.githubusercontent.com"]);
  for (const v of ["0", "true", "yes", ""]) assert.equal(readConfig({ RW_STORE: "memory", RW_GITLAB_COM: v }).gitlabCom, false, JSON.stringify(v));
});

test("review 4: after a new order epoch, a send whose pipeline and job numbers were already received is accepted, not a duplicate for ever", async () => {
  const h = harness();
  const f = await founder(h);
  const { repo, sign, claims } = await instance(h, f);
  assert.equal((await sendToken(h, sign(claims({ pipeline: "500", job: "5000" })))).status, 201);
  // the instance was restored: the same numbers come back, on another commit, with other bytes
  const other = Buffer.from(FIXTURE_CHECK.toString("utf8").replace('"gaps"', '"clean"'));
  h.clock.advance(MIN);
  const again = () => sendToken(h, sign(claims({ pipeline: "500", job: "5000" })), { bytes: other });
  assert.equal((await again()).refusal, "duplicate-in-run", "planted: in the same epoch it is the same run, with another digest");
  await gesture(h, f.session, "order-epoch-open", repo.id);
  await h.app.repositories.openEpoch(await h.app.identity.sessionFrom(f.token), repo.id, {});
  const r = await again();
  assert.deepEqual([r.status, r.body.current], [201, true], JSON.stringify(r));
  const ups = await h.store.tx(f.tenant, (tx) => tx.list("upload", { runAttempt: "5000" }));
  assert.deepEqual(ups.map((u) => [u.runId, u.runNumber, u.epoch]).sort(), [["500", "500", 0], ["500@1", "500", 1]]);
  assert.equal((await sendToken(h, sign(claims({ pipeline: "501", job: "5010" })))).body.current, true, "and the order goes on in the new epoch");
});

test("review 6, 8, 9, 10, 11, 12: a GitHub key holds no colon; the refusal counter is purged; Access shows the forge's identifier; a GitHub upload of before the levels is reached; the consent gesture is bound to the forge and the issuer; a pinned GitLab repository without an owner is refused", async () => {
  const h = harness();
  const f = await founder(h);
  const s = () => h.app.identity.sessionFrom(f.token);
  // 6
  await assert.rejects(h.store.tx(f.tenant, (tx) => tx.insert("forge_repository", { id: h.store.newId(), nameKey: "gitlab:https://gitlab.com:x/y", name: "x/y", state: "pending" })), /forge_repository_keys_scoped/);
  // 11: a verification made for a GitHub name is not spent on a GitLab project of that name, nor one issuer's on another's
  const { reg, repo, sign, claims } = await instance(h, f);
  const declare = async (object, input) => { await gesture(h, f.session, "declare-with-consent", object); try { return (await h.app.repositories.declare(await s(), { consent: true, ...input }, {})).state; } catch (e) { return e.code; } };
  assert.equal(await declare("group/app", { forge: "gitlab", issuer: "gitlab.com", name: "group/app", missions: [{ id: "m1" }] }), "gesture-required");
  assert.equal(await declare(`gitlab:${reg.id}:group/app`, { forge: "gitlab", issuer: "gitlab.com", name: "group/app", missions: [{ id: "m1" }] }), "gesture-required");
  assert.equal(await declare("gitlab:gitlab.com:group/app", { name: "group/app", missions: [{ id: "m1" }] }), "gesture-required");
  assert.equal(await declare("gitlab:gitlab.com:group/app", { forge: "gitlab", issuer: "gitlab.com", name: "group/app", missions: [{ id: "m1" }] }), "pending");
  assert.equal(await declare("group/app", { name: "group/app", missions: [{ id: "m2" }] }), "pending", "GitHub's object is the name, as before");
  // 9
  const shown = (await h.app.identity.accessView(await s())).repositories.find((r) => r.id === repo.id);
  assert.equal(shown.repositoryId, "1", "the project's identifier, not the store's scoped key");
  // 8: a refusal counted three hours ago is gone at the next count
  await h.store.tx(null, (tx) => tx.countRefused("77", 100, reg.id));
  await h.store.tx(null, (tx) => tx.countRefused("78", 103, reg.id));
  assert.deepEqual([...h.store._state.refused.keys()].map((k) => k.split("\u0000")[1]), ["78"]);
  // 12
  await h.store.tx(f.tenant, (tx) => tx.update("forge_repository", { id: repo.id }, { ownerId: null }));
  assert.equal((await sendToken(h, sign(claims({ pipeline: "12", job: "120" })))).refusal, "owner-changed", "planted: a pinned repository whose owner is not held receives nothing");
  // 10: a GitHub upload accepted before the levels were journaled carries none: it reached P1 all the same
  await pinnedRepository(h, f);
  assert.equal((await send(h, { run_number: "13", run_id: "40000000013" })).status, 201);
  const cur = (await h.store.tx(f.tenant, (tx) => tx.list("upload", { rank: "current", mission: "dropyour" })))[0];
  const { level: _level, ...before } = cur.claims;
  await h.store.tx(f.tenant, (tx) => tx.update("upload", { id: cur.id }, { claims: before }));
  const line = (await h.app.reading.status(await s())).lines.find((l) => l.mission === "dropyour");
  assert.deepEqual([line.level.code, line.level.reached], ["P1", true]);
  // the journal's brief names the forge of a workload's line, for the shell's words
  const recent = (await h.app.reading.status(await s())).recent;
  assert.ok(recent.some((e) => e.forge === "github") && (await h.app.reading.status(await s())).lines.some((l) => l.activity.some((e) => e.forge === "gitlab")));
});
