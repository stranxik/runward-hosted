// Test harness: the real application on the in-memory store and objects, the real OIDC verifier over a
// key pair made here (its JWKS served by an injected fetch), the real runward-fleet assembler, and an
// authenticator stand-in that checks the challenge (the WebAuthn library itself is tested apart).
import { generateKeyPairSync, createSign, randomUUID, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp } from "../src/application/app.js";
import { memoryStore } from "../src/adapters/store/memory.js";
import { memoryObjects } from "../src/adapters/objects/objects.js";
import { githubVerifier, GITHUB_ISSUER } from "../src/adapters/oidc/github.js";
import { fleetAssembler, fleetPin } from "../src/adapters/fleet/assembler.js";
import { tar } from "../src/adapters/archive/tar.js";
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
export const digestHeader = (b) => `sha-256=:${createHash("sha256").update(b).digest("base64")}:`;

export function harness({ sendWorkflow = { published: [SEND_SHA], revoked: [] } } = {}) {
  const clock = manualClock(Date.parse("2026-11-06T12:00:00Z"));
  const store = memoryStore({ clock });
  const objects = memoryObjects();
  const fetches = [];
  const fetch = async (url) => { fetches.push(url); return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }); };
  const verifier = githubVerifier({ fetch, clock });
  const assembler = fleetAssembler({ pin: fleetPin({ lockFile: LOCK }) });
  const app = createApp({ store, objects, verifier, authn: fakeAuthn(), assembler, archive: { pack: tar }, clock, log: silentLog, ulid }, { origin: ORIGIN, sendWorkflow });
  return { app, clock, store, objects, fetches };
}

/** Open a tenant with a founder and two passkeys, signed in. Returns the session and credential ids. */
export async function founder(h, { passkeys = 2, prefix = "cred" } = {}) {
  const tokenValue = randomBytes(32).toString("base64url");
  const { tenant } = await h.app.operator.openBootstrap({ hash: sha(Buffer.from(tokenValue)) });
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
  await gesture(h, s, "repository-confirm", d.id);
  const c = await h.app.repositories.confirm(await h.app.identity.sessionFrom(f.token), d.id, {});
  return { id: d.id, first, confirm: c };
}

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
