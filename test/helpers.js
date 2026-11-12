// Test harness: the real application on the in-memory store and objects, the real OIDC verifier over a
// key pair made here (its JWKS served by an injected fetch), the real runward-fleet assembler, and an
// authenticator stand-in that checks the challenge (the WebAuthn library itself is tested apart).
import { generateKeyPairSync, createSign, randomUUID, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp } from "../src/application/app.js";
import { memoryStore } from "../src/adapters/store/memory.js";
import { memoryObjects } from "../src/adapters/objects/objects.js";
import { githubVerifier, GITHUB_ISSUER } from "../src/adapters/oidc/github.js";
import { gitlabComVerifier } from "../src/adapters/oidc/gitlab.js";
import { issuerRegistry, decoyCheck } from "../src/adapters/oidc/registry.js";
import { pinDigest, confirmObject } from "../src/domain/forge.js";
import { fleetAssembler, fleetPin } from "../src/adapters/fleet/assembler.js";
import { tar, untar } from "../src/adapters/archive/tar.js";
import { manualClock } from "../src/adapters/system/clock.js";
import { silentLog } from "../src/adapters/system/log.js";
import { ulid } from "../src/adapters/system/ulid.js";

export const ORIGIN = "https://app.runward.dev";
export const SEND_SHA = "5b0c9e2d41aa7f3e9c18d6b2a07e4f51c3d9a8e0";
export const LOCK = new URL("../vendor/runward-fleet.lock.json", import.meta.url).pathname;
export const FIXTURE_CHECK = readFileSync(new URL("./fixtures/check.json", import.meta.url));

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
export const testJwk = () => jwk;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A signed token as GitHub would issue it, for the given claims. */
export function token(claims, { key = privateKey, kid = "test-key", alg = "RS256" } = {}) {
  const head = b64({ alg, kid, typ: "JWT" });
  const body = b64(claims);
  const s = createSign("RSA-SHA256"); s.update(`${head}.${body}`);
  return `${head}.${body}.${s.sign(key).toString("base64url")}`;
}

export function claimsFor(clock, over = {}) {
  const now = Math.floor(clock.now() / 1000);
  const repository = over.repository ?? "stranxik/dropyour";
  return {
    iss: GITHUB_ISSUER, aud: ORIGIN, iat: now, nbf: now, exp: now + 300, jti: randomUUID(),
    repository, repository_id: "1001", repository_owner_id: "2002", repository_owner: repository.split("/")[0],
    workflow_ref: `${repository}/.github/workflows/runward.yml@refs/heads/main`,
    job_workflow_ref: `stranxik/runward-hosted/.github/workflows/send.yml@refs/tags/v0.1.0`, job_workflow_sha: SEND_SHA,
    ref: "refs/heads/main", ref_type: "branch", sha: "9a1f3c5e7b2d4f6a8c0e1b3d5f7a9c2e4b6d8f01", event_name: "push",
    runner_environment: "github-hosted", run_id: "40000000001", run_number: "12", run_attempt: "1",
    ...over,
  };
}

export function fakeAuthn() {
  return {
    async registrationOptions({ exclude = [] }) { return { challenge: randomBytes(16).toString("base64url"), excludeCredentials: exclude.map((p) => ({ id: p.credentialId })) }; },
    async verifyRegistration({ response, expectedChallenge }) {
      if (!response || response.challenge !== expectedChallenge || response.fail) return null;
      return { credentialId: response.id, publicKey: Buffer.from(`pk-${response.id}`), counter: 0, transports: response.transports ?? ["internal"], aaguid: response.aaguid ?? null, deviceType: response.deviceType ?? "multiDevice" };
    },
    async authenticationOptions({ allow = [] } = {}) { return { challenge: randomBytes(16).toString("base64url"), allowCredentials: allow.map((p) => ({ id: p.credentialId })) }; },
    async verifyAuthentication({ response, expectedChallenge, credential }) {
      if (!response || response.challenge !== expectedChallenge || response.id !== credential.credentialId || response.fail) return null;
      return { newCounter: credential.counter + 1 };
    },
  };
}

export const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---------------------------------------------------------------- GitLab (ADR-0029)
export const GITLAB_FIXTURES = JSON.parse(readFileSync(new URL("./fixtures/gitlab/claims_runs.json", import.meta.url), "utf8"));
export const GITLAB_JWKS = JSON.parse(readFileSync(new URL("./fixtures/gitlab/jwks.json", import.meta.url), "utf8"));
/** An issuer as a GitLab instance's tokens name it, without a port: a name the pinned runward-fleet carries. */
export const INSTANCE = "https://gitlab.example.test";

/** An RSA key as GitLab publishes one: its `kid` is its RFC 7638 thumbprint. `sign(claims, header)` signs a token. */
export function gitlabKey(bits = 2048) {
  const pair = generateKeyPairSync("rsa", { modulusLength: bits });
  const pub = pair.publicKey.export({ format: "jwk" });
  const kid = createHash("sha256").update(JSON.stringify({ e: pub.e, kty: pub.kty, n: pub.n })).digest("base64url");
  const key = { jwk: { ...pub, kid, alg: "RS256", use: "sig" }, kid, privateKey: pair.privateKey };
  key.sign = (claims, over = {}) => token(claims, { key: pair.privateKey, kid, ...over });
  return key;
}
/** The key gitlab.com's fixed address answers with in the harness. */
export const GITLAB_COM_KEY = gitlabKey();

/**
 * Claims as GitLab signs them, from the real ones of the witness instance (run C: a push on a protected
 * `main`), for a project and at the clock's time. `issuer`: the instance, or "https://gitlab.com".
 */
export function gitlabClaims(clock, { issuer = INSTANCE, audience = ORIGIN, path = "temoin/demo", projectId = "1", branch = "main", file = ".gitlab-ci.yml", sha: commit = "1445c1bb17ed487793419fe073f1afd1c5308c41", pipeline = "30", job = "300" } = {}, over = {}) {
  const now = Math.floor(clock.now() / 1000);
  const real = GITLAB_FIXTURES["C main push include-local"].claims;
  const host = issuer.replace(/^https?:\/\//, "");
  return {
    ...real, project_id: projectId, project_path: path, namespace_path: path.split("/").slice(0, -1).join("/"), pipeline_id: pipeline, job_id: job,
    ref: branch, ref_path: `refs/heads/${branch}`, sha: commit, ci_config_sha: commit, ci_config_ref_uri: `${host}/${path}//${file}@refs/heads/${branch}`,
    jti: randomUUID(), iat: now, nbf: now - 5, exp: now + 3600, iss: issuer, sub: `project_path:${path}:ref_type:branch:ref:${branch}`, aud: audience,
    ...over,
  };
}

/** Register a GitLab instance as the shell does: preview, the gesture bound to the digest shown, register. */
export async function registerIssuer(h, f, { issuer = INSTANCE, key = gitlabKey(), keys = null } = {}) {
  const input = { issuer, keys: keys ?? { keys: [key.jwk] }, kid: key.kid };
  const s = await h.app.identity.sessionFrom(f.token);
  const shown = await h.app.issuers.preview(s, input);
  await gesture(h, s, "issuer-register", shown.digest);
  const r = await h.app.issuers.register(await h.app.identity.sessionFrom(f.token), { ...input, digest: shown.digest }, {});
  return { ...r, key, shown };
}

/** Upload with a given bearer token. Returns { status, body } or { refusal, extra }. */
export async function sendToken(h, bearer, { mission = "demo", kind = "check", bytes = FIXTURE_CHECK } = {}) {
  const headers = { authorization: `Bearer ${bearer}`, "runward-mission": mission, "runward-export-kind": kind, "content-length": String(bytes.length), "content-digest": digestHeader(bytes) };
  try { return await h.app.ingest.upload({ headers, readBody: async () => bytes, requestId: `req-${randomBytes(4).toString("hex")}` }); } catch (e) {
    if (e.code && e.constructor.name === "Refusal") return { refusal: e.code, extra: e.extra };
    throw e;
  }
}

/**
 * Declare a GitLab project with consent, upload once (kept, pending), confirm: pinned. `issuer`: "gitlab.com"
 * or a registration's id; `sign(claims)` signs its tokens; `claims`: what gitlabClaims takes.
 */
export async function pinnedGitlab(h, f, { issuer = "gitlab.com", sign, claims = {}, name = "temoin/demo", mission = "demo", branch = "main" }) {
  await gesture(h, f.session, "declare-with-consent", `gitlab:${issuer}:${name.toLowerCase()}`);
  const d = await h.app.repositories.declare(await h.app.identity.sessionFrom(f.token), { forge: "gitlab", issuer, name, defaultBranch: branch, consent: true, missions: [{ id: mission, path: "." }] }, {});
  const first = await sendToken(h, sign(gitlabClaims(h.clock, { path: name, branch, pipeline: "10", job: "100", ...claims })), { mission });
  const confirm = first.status === 202 ? await confirmRepository(h, f, d.id) : null;
  return { id: d.id, first, confirm };
}
export const digestHeader = (b) => `sha-256=:${createHash("sha256").update(b).digest("base64")}:`;

export function harness({ sendWorkflow = { published: [SEND_SHA], revoked: [] }, store: given = null, realTime = false, config = {}, keysFetch = null, wrapStore = (s) => s } = {}) {
  const clock = realTime ? { now: () => Date.now(), set() {}, advance() { throw new Error("real time: cannot advance"); } } : manualClock(Date.parse("2026-11-06T12:00:00Z"));
  const store = wrapStore(given ?? memoryStore({ clock }));
  const objects = memoryObjects();
  const fetches = [];
  // `keysFetch`: how the issuer answers for its keys (default: the test key set, every time)
  // gitlab.com's fixed key address answers the test's gitlab.com key set; every other address, GitHub's
  const fetch = async (url, init) => { fetches.push(url); return keysFetch ? keysFetch(url, init) : new Response(JSON.stringify({ keys: [String(url).startsWith("https://gitlab.com/") ? GITLAB_COM_KEY.jwk : jwk] }), { status: 200 }); };
  // the registry of issuers around the real GitHub adapter, as src/main.js#compose builds it (ADR-0029)
  // `decoys.n`: how many times the decoy signature check ran (one per failing case of a registration's path)
  const decoys = { n: 0 };
  const verifier = issuerRegistry({ github: githubVerifier({ fetch, clock }), gitlabCom: config.gitlabCom === false ? null : gitlabComVerifier({ fetch, clock }), store, clock, origin: config.origin ?? ORIGIN, checks: { decoy: () => { decoys.n++; return decoyCheck(); } } });
  const assembler = fleetAssembler({ pin: fleetPin({ lockFile: LOCK }) });
  // gitlab.com is open in the harness (the service's default is closed: RW_GITLAB_COM), unless a test closes it
  const app = createApp({ store, objects, verifier, authn: fakeAuthn(), assembler, archive: { pack: tar }, clock, log: silentLog, ulid }, { origin: ORIGIN, sendWorkflow, gitlabCom: true, ...config });
  // `assembler` is the one the app holds: a test that plays an earlier pin changes its `pin.archiveSha256`
  return { app, clock, store, objects, fetches, assembler, decoys };
}

/** Open a tenant with a founder and two passkeys, signed in. Returns the session and credential ids. */
export async function founder(h, { passkeys = 2, prefix = "cred", token: given = null, tenant: opened = null } = {}) {
  const tokenValue = given ?? randomBytes(32).toString("base64url");
  const tenant = opened ?? (await h.app.operator.openBootstrap({ hash: sha(Buffer.from(tokenValue)) })).tenant;
  const o = await h.app.identity.linkOptions({ token: tokenValue });
  const r = await h.app.identity.redeemLink({ token: tokenValue, challengeId: o.challengeId, response: { id: `${prefix}-1`, challenge: o.options.challenge, aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd" }, ua: "Chrome/130 Macintosh" });
  let s = await h.app.identity.sessionFrom(r.token);
  const creds = [`${prefix}-1`];
  for (let i = 2; i <= passkeys; i++) {
    await gesture(h, s, "passkey-add", "", `${prefix}-1`);
    const ao = await h.app.identity.passkeyAddOptions(s);
    await h.app.identity.passkeyAdd(s, { challengeId: ao.challengeId, response: { id: `${prefix}-${i}`, challenge: ao.options.challenge, aaguid: "bada5566-a7aa-401f-bd96-45619a55120d" } });
    creds.push(`${prefix}-${i}`);
  }
  s = await h.app.identity.sessionFrom(r.token);
  return { tenant, token: r.token, session: s, creds };
}

/** A fresh, or per-gesture, verification with the given credential. */
export async function gesture(h, s, g, object, cred = null) {
  cred ??= (await h.store.tx(s.tenantId, (tx) => tx.get("passkey", { id: s.passkeyId })))?.credentialId;
  const o = await h.app.identity.freshOptions(s, g ? { gesture: g, object } : {});
  return h.app.identity.fresh(s, { challengeId: o.challengeId, response: { id: cred, challenge: o.options.challenge } });
}

/** Declare a repository with consent, upload once (pending), confirm: the repository is pinned. */
export async function pinnedRepository(h, f, { name = "stranxik/dropyour", mission = "dropyour", claims = {} } = {}) {
  await gesture(h, f.session, "declare-with-consent", name.toLowerCase());
  const s = await h.app.identity.sessionFrom(f.token);
  const d = await h.app.repositories.declare(s, { name, consent: true, missions: [{ id: mission, path: "." }] }, {});
  const first = await send(h, { repository: name, run_number: "1", run_id: "39000000001", ...claims }, { mission });
  const c = await confirmRepository(h, f, d.id);
  return { id: d.id, first, confirm: c };
}

/**
 * Confirm a repository as the shell does: read the values to pin and their digest on the access view, verify
 * the gesture bound to the repository and that digest, then confirm with the digest shown (ADR-0029 section 1).
 */
export async function confirmRepository(h, f, id) {
  const s = await h.app.identity.sessionFrom(f.token);
  const shown = (await h.app.identity.accessView(s)).repositories.find((r) => r.id === id).pending;
  await gesture(h, s, "repository-confirm", confirmObject(id, shown.digest));
  return h.app.repositories.confirm(await h.app.identity.sessionFrom(f.token), id, { digest: shown.digest }, {});
}
/** The digest a GitHub confirmation is bound to, for the given identifiers. */
export const githubPinDigest = (repositoryId, ownerId) => pinDigest({ forge: "github", repositoryId, ownerId });

/** Upload bytes as the send workflow would. Returns { status, body } or { refusal }. */
export async function send(h, over = {}, { mission = "dropyour", kind = "check", bytes = FIXTURE_CHECK, digest = null, length = null, auth = null } = {}) {
  const claims = claimsFor(h.clock, over);
  const headers = {
    authorization: auth ?? `Bearer ${token(claims)}`, "runward-mission": mission, "runward-export-kind": kind,
    "content-length": String(length ?? bytes.length), "content-digest": digest ?? digestHeader(bytes),
  };
  try {
    return await h.app.ingest.upload({ headers, readBody: async () => bytes, requestId: "req-test" });
  } catch (e) {
    if (e.code && e.constructor.name === "Refusal") return { refusal: e.code, extra: e.extra };
    throw e;
  }
}

// ---------------------------------------------------------------- erasure (ADR-0009, db/migrations/0006)
/** A check.json whose content carries a marker the index projects (a deliverable's name): bytes a test can look for. */
export function markedCheck(marker) {
  const doc = JSON.parse(FIXTURE_CHECK.toString("utf8"));
  doc.deliverables[0].artifact = `Framing note ${marker}`;
  return Buffer.from(`${JSON.stringify(doc, null, 2)}\n`);
}

/**
 * Where bytes of a content still are, for a tenant: each place that holds one of the markers. The places
 * are everything the service keeps: every version of the index (its bytes and its fleet.json), the
 * journal, every object of the tenant (the bytes received, the security log, the prepared archives), and,
 * when given, an archive just prepared (file by file). Empty when nothing is left.
 */
export async function contentLeft(h, tenant, markers, archive = null) {
  const has = (bytes, m) => Buffer.from(bytes ?? "").includes(m);
  const out = [];
  const { versions, ledger } = await h.store.tx(tenant, async (tx) => ({ versions: await tx.list("fleet_index"), ledger: await tx.ledgerAll() }));
  for (const m of markers) {
    for (const v of versions) {
      if (has(v.bytes, m)) out.push(`fleet_index version ${v.version} bytes: ${m}`);
      if (has(v.manifest, m)) out.push(`fleet_index version ${v.version} manifest: ${m}`);
    }
    if (has(JSON.stringify(ledger.map((e) => e.body)), m)) out.push(`journal: ${m}`);
    for (const [key, bytes] of h.objects._map) if (key.startsWith(`tenants/${tenant}/`) && has(bytes, m)) out.push(`object ${key.slice(`tenants/${tenant}/`.length).split("/")[0]}: ${m}`);
    if (archive) for (const f of untar(archive)) if (has(f.bytes, m)) out.push(`archive ${f.name}: ${m}`);
  }
  return out;
}

/**
 * The planted control of the erasure: a store whose index versions are never emptied while `plant.on`,
 * which is the erasure as it was before 0006 (the uploads' bytes went, every published version stayed
 * whole). A test that passes on it proves nothing.
 */
export function withoutIndexErasure(store, plant = { on: true }) {
  const tx = (tenant, fn) => store.tx(tenant, (t) => fn(new Proxy(t, {
    get(target, k) {
      if (k === "update") return (table, key, patch) => (plant.on && table === "fleet_index" ? target.get(table, key) : target.update(table, key, patch));
      const v = target[k];
      return typeof v === "function" ? v.bind(target) : v;
    },
  })));
  return Object.assign(Object.create(store), { tx, plant });
}

export const GONE = ["GONE-RUN-1", "GONE-RUN-2"], KEEP = ["KEEP-RUN-1"], BRAVO = ["BRAVO-RUN-1"];
/**
 * The scenario of the erasure tests, for two founders. Tenant A declares two repositories: `keep`
 * (versions 1 and 2 of its index), then `gone` (versions 3, 4 and 5, each built from the upload of `gone`
 * current then: its first one, GONE-RUN-1, GONE-RUN-2). Tenant B declares one. Every upload after a
 * repository's first carries a marker. `ids`: the forge's repository ids, distinct per test on a shared base.
 */
export async function erasureScenario(h, A, B, { ids = ["8101", "8102", "8201"], org = "org" } = {}) {
  const ok = async (claims, opts) => { const r = await send(h, claims, opts); if (r.status !== 201) throw new Error(`upload not accepted: ${JSON.stringify(r)}`); };
  const [k, g, b] = ids;
  const keep = await pinnedRepository(h, A, { name: `${org}-a/keep`, mission: `${org}-keep`, claims: { repository_id: k, run_id: `39${k}` } });
  await ok({ repository: `${org}-a/keep`, repository_id: k, run_number: "2", run_id: `41${k}` }, { mission: `${org}-keep`, bytes: markedCheck(KEEP[0]) });
  const gone = await pinnedRepository(h, A, { name: `${org}-a/gone`, mission: `${org}-gone`, claims: { repository_id: g, run_id: `39${g}` } });
  await ok({ repository: `${org}-a/gone`, repository_id: g, run_number: "2", run_id: `42${g}` }, { mission: `${org}-gone`, bytes: markedCheck(GONE[0]) });
  await ok({ repository: `${org}-a/gone`, repository_id: g, run_number: "3", run_id: `43${g}` }, { mission: `${org}-gone`, bytes: markedCheck(GONE[1]) });
  const bravo = await pinnedRepository(h, B, { name: `${org}-b/bravo`, mission: `${org}-bravo`, claims: { repository_id: b, run_id: `39${b}` } });
  await ok({ repository: `${org}-b/bravo`, repository_id: b, run_number: "2", run_id: `41${b}` }, { mission: `${org}-bravo`, bytes: markedCheck(BRAVO[0]) });
  return { keep, gone, bravo };
}
