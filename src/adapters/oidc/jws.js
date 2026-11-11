// The signature check of a CI's identity token, shared by every issuer's adapter (ADR-0029 section 1;
// PADR-0010 point 1, RFC 8725), and the verifier of a public issuer, whose keys are read at a fixed address.
// RS256 only, from a per-issuer list: `none` and every HMAC are refused before a key is looked at. Issuer
// and audience exact, exp / nbf / iat within 60 s, an optional bound on the token's age. The keys are
// cached and refreshed at most once a minute on an unknown key id; `fetch` is the egress-bound fetch.
// Signature check with node:crypto, no JWT library. Nothing a token carries is ever fetched: no `jku`,
// `x5u` or `jwk` header is read, and the address of the keys is the adapter's, never a document's.
//
// Keys that cannot be read are the service's failure, never the token's (review finding of 2026-11-10: the
// refresh time was stamped before the fetch, so for a minute after a failed read every token was refused
// `token-unreadable`, a 401 the send workflow does not retry). Now the minute starts only from a read that
// gave at least one usable key; a failed read is retried at most once every RETRY_MS; and while the keys
// cannot be read the verifier throws an error without a refusal code, which the upload answers 503
// `service-unavailable`, the answer the send workflow retries.
//
// And a token that cannot be read is the token's fault, never the service's (review finding of 2026-11-10:
// a header that decodes to JSON `null` threw a TypeError with no code, answered 503 and counted as a server
// error, so anyone could raise the error-rate alert). A header or claims that are not a JSON object are
// refused `token-unreadable`; only KeysUnavailable, a VerifierUnavailable of the port, says 503.
import { createPublicKey, createVerify, createHash } from "node:crypto";
import { VerifierUnavailable } from "../../ports/errors.js";

export const SKEW_S = 60;
export const KEYS_REFRESH_MS = 60_000;
export const KEYS_RETRY_MS = 5_000;
/** The algorithms an issuer's tokens may be signed with: one list per issuer, and each holds RS256 alone. */
export const RS256_ONLY = Object.freeze(["RS256"]);

export class TokenRefused extends Error {
  /** `detail`: what a caller may journal once a signature held (key-retired), never a token. */
  constructor(code, why, detail = null) { super(`${code}: ${why}`); this.code = code; this.detail = detail; }
}

/** The issuer's keys could not be read: no refusal code, so the caller answers service-unavailable. */
export class KeysUnavailable extends VerifierUnavailable {
  constructor(why) { super(`oidc keys unavailable: ${why}`); }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const b64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** The RFC 7638 thumbprint of an RSA public JSON Web Key. */
export const rsaThumbprint = (jwk) => createHash("sha256").update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })).digest("base64url");

/**
 * Read a compact JWS without trusting it: { header, claims, signed, signature }. Throws TokenRefused
 * `token-missing` or `token-unreadable`. What it returns is unverified: it serves to choose a key set.
 */
export function readCompact(token) {
  if (typeof token !== "string" || !token) throw new TokenRefused("token-missing", "absent");
  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenRefused("token-unreadable", "not a compact JWS");
  let header, claims;
  try { header = JSON.parse(b64url(parts[0]).toString("utf8")); claims = JSON.parse(b64url(parts[1]).toString("utf8")); }
  catch { throw new TokenRefused("token-unreadable", "not JSON"); }
  if (!isObject(header) || !isObject(claims)) throw new TokenRefused("token-unreadable", "header or claims not an object");
  return { header, claims, signed: `${parts[0]}.${parts[1]}`, signature: b64url(parts[2]) };
}

/** Does the header name an admitted algorithm and a key id? `none`, HS256 and the like are not in any list. */
export const namesKey = (header, algorithms = RS256_ONLY) => typeof header.alg === "string" && algorithms.includes(header.alg) && typeof header.kid === "string";

/** Does the RS256 signature hold under this key? */
export function signatureHolds(key, parsed) {
  const v = createVerify("RSA-SHA256");
  v.update(parsed.signed);
  return v.verify(key, parsed.signature);
}

/**
 * The claims every issuer's token is held to, after its signature: issuer exact, one exact audience, exp
 * and iat required, nbf when present, 60 s of skew, and no older than `maxAgeS` when the issuer has a bound.
 */
export function checkClaims(claims, { issuer, audience, nowMs, maxAgeS = null }) {
  if (claims.iss !== issuer) throw new TokenRefused("token-unreadable", "issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (aud.length !== 1 || aud[0] !== audience) throw new TokenRefused("token-audience", "audience");
  const now = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== "number" || now > claims.exp + SKEW_S) throw new TokenRefused("token-expired", "exp");
  if (typeof claims.nbf === "number" && now + SKEW_S < claims.nbf) throw new TokenRefused("token-expired", "nbf");
  if (typeof claims.iat !== "number" || now + SKEW_S < claims.iat) throw new TokenRefused("token-unreadable", "iat");
  if (maxAgeS !== null && now - claims.iat > maxAgeS) throw new TokenRefused("token-too-old", "iat");
}

/**
 * The verifier of a public issuer: `issuer` is the exact `iss` of its tokens, `jwksUrl` the fixed address
 * of its keys. `verify(token, { audience })` returns the claims; `check(parsed, { audience })` does the
 * same from a token already read and also names the key: { claims, kid, thumbprint }.
 */
export function publicIssuerVerifier({ issuer, jwksUrl, fetch, clock, maxAgeS = null, algorithms = RS256_ONLY }) {
  let keys = new Map();
  let fetchedAt = -Infinity; // the last read that gave at least one usable key
  let failedAt = -Infinity; // the last read that failed
  let pending = null; // one read in flight, shared by the tokens that wait for it

  async function read() {
    let doc;
    try {
      const r = await fetch(jwksUrl, { headers: { accept: "application/json" } });
      if (!r.ok) throw new KeysUnavailable(`status ${r.status}`);
      doc = await r.json();
    } catch (e) {
      throw e instanceof KeysUnavailable ? e : new KeysUnavailable(String(e?.message ?? e).slice(0, 120));
    }
    const next = new Map();
    for (const k of Array.isArray(doc?.keys) ? doc.keys : []) {
      if (k?.kty !== "RSA" || typeof k.kid !== "string" || !k.kid) continue;
      try { next.set(k.kid, { key: createPublicKey({ key: k, format: "jwk" }), thumbprint: rsaThumbprint(k) }); } catch { /* one unreadable key is skipped */ }
    }
    if (next.size === 0) throw new KeysUnavailable("the key set holds no usable RSA key");
    return next;
  }

  async function refresh() {
    const now = clock.now();
    if (now - fetchedAt < KEYS_REFRESH_MS) return; // keys read less than a minute ago: an unknown key id is the token's
    if (now - failedAt < KEYS_RETRY_MS) throw new KeysUnavailable("the last read failed a moment ago");
    pending ??= read().then(
      (next) => { keys = next; fetchedAt = clock.now(); failedAt = -Infinity; },
      (e) => { failedAt = clock.now(); throw e; },
    ).finally(() => { pending = null; });
    return pending;
  }

  async function check(parsed, { audience }) {
    const { header, claims } = parsed;
    if (!namesKey(header, algorithms)) throw new TokenRefused("token-unreadable", "alg or kid");
    if (!keys.has(header.kid)) await refresh();
    const k = keys.get(header.kid);
    if (!k) throw new TokenRefused("token-unreadable", "unknown key id");
    if (!signatureHolds(k.key, parsed)) throw new TokenRefused("token-unreadable", "signature");
    checkClaims(claims, { issuer, audience, nowMs: clock.now(), maxAgeS });
    return { claims, kid: header.kid, thumbprint: k.thumbprint };
  }

  return {
    issuer,
    check,
    /** The thumbprint of a key of the set last read, for the level's basis; null when it is not held. */
    thumbprintOf: (kid) => keys.get(kid)?.thumbprint ?? null,
    /** Verify a compact JWS; returns its claims, throws TokenRefused(code) with a refusal code, or throws
     *  KeysUnavailable (no code) when the issuer's keys cannot be read. */
    async verify(token, { audience }) { return (await check(readCompact(token), { audience })).claims; },
  };
}
