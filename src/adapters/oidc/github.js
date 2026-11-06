// The WorkloadVerifier port on GitHub Actions' OIDC tokens (PADR-0010 point 1, RFC 8725).
// Issuer pinned, audience exact, RS256 only, exp / nbf / iat within 60 s, the issuer's keys cached and
// refreshed at most once a minute on an unknown key id. The keys are the service's one destination
// outside the hoster; `fetch` is the egress-bound fetch. Signature check with node:crypto, no JWT library.
import { createPublicKey, createVerify } from "node:crypto";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const SKEW_S = 60;

export class TokenRefused extends Error {
  constructor(code, why) { super(`${code}: ${why}`); this.code = code; }
}

const b64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function githubVerifier({ issuer = GITHUB_ISSUER, jwksUrl = `${issuer}/.well-known/jwks`, fetch, clock }) {
  let keys = new Map();
  let fetchedAt = -Infinity;
  async function refresh() {
    const now = clock.now();
    if (now - fetchedAt < 60_000) return;
    fetchedAt = now;
    const r = await fetch(jwksUrl, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`jwks ${r.status}`);
    const doc = await r.json();
    const next = new Map();
    for (const k of doc.keys ?? []) if (k.kty === "RSA" && k.kid) next.set(k.kid, createPublicKey({ key: k, format: "jwk" }));
    keys = next;
  }
  return {
    /** Verify a compact JWS; returns its claims, or throws TokenRefused(code) with a refusal code. */
    async verify(token, { audience }) {
      if (typeof token !== "string" || !token) throw new TokenRefused("token-missing", "absent");
      const parts = token.split(".");
      if (parts.length !== 3) throw new TokenRefused("token-unreadable", "not a compact JWS");
      let header, claims;
      try { header = JSON.parse(b64url(parts[0]).toString("utf8")); claims = JSON.parse(b64url(parts[1]).toString("utf8")); }
      catch { throw new TokenRefused("token-unreadable", "not JSON"); }
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
