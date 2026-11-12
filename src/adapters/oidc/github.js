// The WorkloadVerifier port on GitHub Actions' OIDC tokens (PADR-0010 point 1, RFC 8725): the verifier of
// a public issuer (src/adapters/oidc/jws.js, where the signature check and the key cache live since the
// forge port, ADR-0029) at GitHub's issuer and its fixed key address. The rules are unchanged: issuer
// pinned, audience exact, RS256 only, exp / nbf / iat within 60 s, and no bound on a token's age.
// `issuer` moves for a local witness only (RW_OIDC_ISSUER); the keys are then read under it.
import { publicIssuerVerifier } from "./jws.js";

export { TokenRefused, KeysUnavailable, KEYS_REFRESH_MS, KEYS_RETRY_MS } from "./jws.js";
export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";

export function githubVerifier({ issuer = GITHUB_ISSUER, jwksUrl = `${issuer}/.well-known/jwks`, fetch, clock }) {
  return publicIssuerVerifier({ issuer, jwksUrl, fetch, clock });
}
