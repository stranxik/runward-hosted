// The WorkloadVerifier port on gitlab.com's CI identity tokens (ADR-0029 sections 1 and 3): a public
// issuer, its keys read at a fixed address in this file and cached as GitHub's are. The address is never
// taken from the discovery document, whose `jwks_uri` the witness instance announced under another scheme
// than its `iss`. A token more than ten minutes old is refused whatever its `exp` (rule 1).
// A registered instance is not here: its keys are the tenant's rows (src/adapters/oidc/registry.js).
import { publicIssuerVerifier } from "./jws.js";
import { GITLAB_COM_ISSUER, MAX_TOKEN_AGE_S } from "../../domain/forge.js";

export const GITLAB_COM_KEYS = "https://gitlab.com/oauth/discovery/keys";

export function gitlabComVerifier({ fetch, clock }) {
  return publicIssuerVerifier({ issuer: GITLAB_COM_ISSUER, jwksUrl: GITLAB_COM_KEYS, fetch, clock, maxAgeS: MAX_TOKEN_AGE_S });
}
