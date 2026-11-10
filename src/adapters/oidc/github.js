// The WorkloadVerifier port on GitHub Actions' OIDC tokens (PADR-0010 point 1, RFC 8725).
// Issuer pinned, audience exact, RS256 only, exp / nbf / iat within 60 s, the issuer's keys cached and
// refreshed at most once a minute on an unknown key id. The keys are the service's one destination
// outside the hoster; `fetch` is the egress-bound fetch. Signature check with node:crypto, no JWT library.
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
import { createPublicKey, createVerify } from "node:crypto";
import { VerifierUnavailable } from "../../ports/errors.js";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const SKEW_S = 60;
export const KEYS_REFRESH_MS = 60_000;
export const KEYS_RETRY_MS = 5_000;

export class TokenRefused extends Error {
  constructor(code, why) { super(`${code}: ${why}`); this.code = code; }
}

/** The issuer's keys could not be read: no refusal code, so the caller answers service-unavailable. */
export class KeysUnavailable extends VerifierUnavailable {
  constructor(why) { super(`oidc keys unavailable: ${why}`); }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const b64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function githubVerifier({ issuer = GITHUB_ISSUER, jwksUrl = `${issuer}/.well-known/jwks`, fetch, clock }) {
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
      try { next.set(k.kid, createPublicKey({ key: k, format: "jwk" })); } catch { /* one unreadable key is skipped */ }
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

  return {
    /** Verify a compact JWS; returns its claims, throws TokenRefused(code) with a refusal code, or throws
     *  KeysUnavailable (no code) when the issuer's keys cannot be read. */
    async verify(token, { audience }) {
      if (typeof token !== "string" || !token) throw new TokenRefused("token-missing", "absent");
      const parts = token.split(".");
      if (parts.length !== 3) throw new TokenRefused("token-unreadable", "not a compact JWS");
      let header, claims;
      try { header = JSON.parse(b64url(parts[0]).toString("utf8")); claims = JSON.parse(b64url(parts[1]).toString("utf8")); }
      catch { throw new TokenRefused("token-unreadable", "not JSON"); }
      if (!isObject(header) || !isObject(claims)) throw new TokenRefused("token-unreadable", "header or claims not an object");
      if (header.alg !== "RS256" || typeof header.kid !== "string") throw new TokenRefused("token-unreadable", "alg or kid");
      if (!keys.has(header.kid)) await refresh();
      const key = keys.get(header.kid);
      if (!key) throw new TokenRefused("token-unreadable", "unknown key id");
      const v = createVerify("RSA-SHA256");
      v.update(`${parts[0]}.${parts[1]}`);
      if (!v.verify(key, b64url(parts[2]))) throw new TokenRefused("token-unreadable", "signature");
      if (claims.iss !== issuer) throw new TokenRefused("token-unreadable", "issuer");
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (aud.length !== 1 || aud[0] !== audience) throw new TokenRefused("token-audience", "audience");
      const now = Math.floor(clock.now() / 1000);
      if (typeof claims.exp !== "number" || now > claims.exp + SKEW_S) throw new TokenRefused("token-expired", "exp");
      if (typeof claims.nbf === "number" && now + SKEW_S < claims.nbf) throw new TokenRefused("token-expired", "nbf");
      if (typeof claims.iat !== "number" || now + SKEW_S < claims.iat) throw new TokenRefused("token-unreadable", "iat");
      return claims;
    },
  };
}
