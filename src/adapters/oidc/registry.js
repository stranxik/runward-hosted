// The WorkloadVerifier port as a registry of issuers (ADR-0029 section 1): several issuers in one process.
//
// Two values of a token are read before its signature, only to choose a key set: `iss`, and for a
// registered instance `aud`. Both are compared by exact string equality, never by prefix, never
// normalised; the signature is then checked with that set only, and `iss` and `aud` are compared again
// after it (section 6 point 1).
//   - A token whose `iss` is a public issuer's (GitHub's, gitlab.com's: a closed list) is checked with
//     that issuer's keys and must carry the service's own audience; the registrations are never read for it.
//   - Any other token must carry the audience of a registration, `<origin>/send/<id>`, and is checked with
//     that registration's keys, read from the store by that exact identifier.
//   - Everything else is `token-unreadable`: an unknown issuer, an unknown registration, an issuer that is
//     not the registration's, an unknown `kid`, a bad signature. One code, and every failing case of this
//     path goes through exactly one RSA check, against a fixed decoy key of the largest size admitted where
//     no key was found. The equal time is a best effort; what keeps registrations from being listed is the
//     128 random bits of their identifier.
// `key-retired` is thrown only after the signature held under the retired or expired key, with what the
// caller journals in the registration's tenant (section 3).
// The witness reader (audience `/read`, ADR-0012) stays GitHub's alone.
import { createPublicKey } from "node:crypto";
import { VerifierUnavailable } from "../../ports/errors.js";
import { TokenRefused, readCompact, namesKey, signatureHolds, checkClaims, RS256_ONLY } from "./jws.js";
import { GITHUB_ISSUER_KEY, GITLAB_COM_ISSUER, REGISTRATION_ID, MAX_TOKEN_AGE_S, sendAudience } from "../../domain/forge.js";
import { keyFault, keyState, jwkThumbprint } from "../../domain/issuer.js";

// A public key made once for this purpose and whose private half was never kept: it verifies nothing.
const DECOY = createPublicKey({ format: "jwk", key: { kty: "RSA", e: "AQAB", n: "r4P5AVmPcmdZp0apj_KzWdQFQV6JUvo_2bo0W8FQ_5RQFr0okmb445q688GCO3rj0d3J0wF4W_l2J75yLxt1VGj2FGcnY9DUj6QjZ2dYOZx3UPDXvmcXZyznuQoOOs2oCxdgXlayhbpR2IaUnSk-nsF0H7kT5jrMME5a4ezaJjE0HgQ98hk02a6S1HHmrsCrFFRT8p-1GK-tdBy_TAlMysG-wG54IXkXrflt6ZUKPmO28F1ltoIPAhsyR1B6X0YTbb4NkD7qP7XQDUVPMblWz8Y34KPgkf3Tzq3ZVxq0VaRbfuy9EdtgyVCu_Rz_LZSmxWltd-RqCt0wLD-FoaCbr4eotY3DdKRCkok1fDGHQSv1Bk4Ip06xX7b4TIZYv6WAAzTGAE4nDEc3z7OE1NpwrbvZh-qp-nqhYO2BT0Q4xxo__FqJ_XqKNit6wa5z1Ksh2KGZ_TuEkBf7elhmQUW5OUFpShVe-qWDociFWHzEpzqGIMdgA5swmmeJuFE84OvtivvuNcXau4rmCkF0IzXJNGF2HN2AczQ4A1HClFQ6ZXTVJPDRl2mJwwF6whmGJZ1xJ9YLudhEEQwX6g8oblT7_jhq9Akr283iJiIfvWxxIhgpJdbiNuS9zUJLAqon_hkIDEUqOhenOBBTAXiPS3DvDxxNDVTuSr8XCvA6P8C883U" } });
const DECOY_SIGNATURE = Buffer.alloc(512, 1);
/** One RSA check that can only fail, so that a token no key was found for costs what a wrong signature costs. */
export function decoyCheck() { return signatureHolds(DECOY, { signed: "decoy", signature: DECOY_SIGNATURE }); }

/**
 * `github`: the GitHub adapter (verify(token, { audience }) -> claims). `githubIssuer`: the exact `iss` of
 * its tokens (RW_OIDC_ISSUER for a local witness). `gitlabCom`: the gitlab.com adapter, or null.
 * `store`: the TenantStore, for `resolveIssuer`. `origin`: the service's origin.
 */
export function issuerRegistry({ github, githubIssuer = GITHUB_ISSUER_KEY, gitlabCom = null, store, clock, origin, checks = { decoy: decoyCheck } }) {
  const unreadable = (why) => new TokenRefused("token-unreadable", why);
  /** A refusal answered after the signature held names its forge, whose words answer it; `token-unreadable` names none. */
  const named = (e, forge) => { if (e instanceof TokenRefused && e.code !== "token-unreadable") e.forge = forge; return e; };

  async function fromGithub(token, parsed, audience) {
    const claims = await github.verify(token, { audience });
    return { claims, forge: "github", issuer: { key: GITHUB_ISSUER_KEY, kind: "public" }, kid: parsed.header.kid, thumbprint: github.thumbprintOf?.(parsed.header.kid) ?? null };
  }

  async function fromRegistration(parsed) {
    const { header, claims } = parsed;
    const fail = (why) => { checks.decoy(); return unreadable(why); };
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const aud = auds.length === 1 && typeof auds[0] === "string" ? auds[0] : null;
    const id = aud ? aud.slice(aud.lastIndexOf("/") + 1) : "";
    // the audience names a registration only when it is, whole, the string the app wrote for it
    if (!aud || !REGISTRATION_ID.test(id) || aud !== sendAudience(origin, id)) throw fail("no issuer for this token");
    let reg;
    try { reg = await store.tx(null, (tx) => tx.resolveIssuer(id)); } catch (e) { throw new VerifierUnavailable(`the registration cannot be read: ${String(e?.message ?? e).slice(0, 120)}`); }
    if (!reg || reg.removed || typeof claims.iss !== "string" || reg.issuer !== claims.iss) throw fail("unknown registration, or not its issuer");
    if (!namesKey(header, RS256_ONLY)) throw fail("alg or kid");
    const row = reg.keys.find((k) => k.kid === header.kid);
    if (!row) throw fail("unknown key id");
    // a key's type, size and exponent are checked when it is registered, and again when it is read
    let key = null;
    if (!keyFault({ ...row.jwk, kid: row.kid }) && jwkThumbprint(row.jwk) === row.thumbprint) { try { key = createPublicKey({ format: "jwk", key: { kty: "RSA", n: row.jwk.n, e: row.jwk.e } }); } catch { key = null; } }
    if (!key) throw fail("a kept key is no longer one the service admits");
    if (!signatureHolds(key, parsed)) throw unreadable("signature");
    // ---- the signature holds under a key of this registration: its tenant may now be named
    const issuer = { key: id, kind: "registered", tenantId: reg.tenantId, issuer: reg.issuer };
    // the token's own times first, for a retired key as for a live one: an expired or old token signed
    // when the key lived is `token-expired` or `token-too-old`, and writes nothing (the review of the pull
    // request: one old token replayed wrote into the tenant's journal for ever)
    try { checkClaims(claims, { issuer: reg.issuer, audience: sendAudience(origin, id), nowMs: clock.now(), maxAgeS: MAX_TOKEN_AGE_S }); } catch (e) { throw named(e, reg.forge); }
    const state = keyState(row, clock.now());
    if (state !== "live") throw new TokenRefused("key-retired", state, { issuer, forge: reg.forge, kid: row.kid, thumbprint: row.thumbprint, state, since: row.retiredAt ?? null, claims });
    return { claims, forge: reg.forge, issuer, kid: row.kid, thumbprint: row.thumbprint };
  }

  return {
    /**
     * Verify a token for an upload (`purpose: "send"`, any issuer) or for the witness reader
     * (`purpose: "read"`, GitHub alone, `audience` given). Returns { claims, forge, issuer: { key, kind,
     * tenantId? }, kid, thumbprint }; throws TokenRefused(code) or a VerifierUnavailable.
     */
    async verify(token, { purpose = "send", audience = origin } = {}) {
      let parsed;
      // a token that cannot even be read is refused by the GitHub adapter, with its codes, as before the port
      try { parsed = readCompact(token); } catch { parsed = { header: {}, claims: {} }; await github.verify(token, { audience }); throw new TokenRefused("token-unreadable", "not a compact JWS"); }
      if (purpose === "read") return fromGithub(token, parsed, audience);
      const iss = parsed.claims.iss;
      if (iss === githubIssuer) return fromGithub(token, parsed, origin);
      if (gitlabCom && iss === GITLAB_COM_ISSUER) {
        try { return { ...(await gitlabCom.check(parsed, { audience: origin })), forge: "gitlab", issuer: { key: GITLAB_COM_ISSUER, kind: "public" } }; } catch (e) { throw named(e, "gitlab"); }
      }
      return fromRegistration(parsed);
    },
  };
}
