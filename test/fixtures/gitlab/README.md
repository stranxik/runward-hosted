# GitLab fixtures

What a self-managed GitLab CE 17.11.1 signs and publishes, read on 2026-11-11 for ADR-0029 (its Context). Public data only: decoded headers and claims, the instance's public key set, its discovery document. No token and no signature is kept here; the tests sign their own tokens with keys they make.

- `claims_runs.json`: the header and claims of four pipelines of the witness instance (A: started through the API on `main`; B: a push on an unprotected branch; C: a push on `main` whose job comes from `include: local`; D: a push on `main` of a project whose definition lives in another project, so both `ci_config_*` claims are absent).
- `jwks.json`: the instance's `/oauth/discovery/keys`: two RSA keys, of 4096 and 2048 bits; the CI tokens are signed by the 2048-bit one; each `kid` is the key's RFC 7638 thumbprint.
- `openid_configuration.json`: the discovery document, whose `jwks_uri` reads `https` while `issuer` reads `http`. The service never reads an address from it.
