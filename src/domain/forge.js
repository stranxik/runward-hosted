// The forge port, the domain's half (ADR-0029 section 1): what is the same for every forge. The issuers
// the code knows (a closed list), the issuer key that enters every key of the store, the audience that
// names a registration, the level of evidence an upload reaches, and the digest a confirmation is bound to.
// GitLab's own rules live in src/domain/gitlab.js, GitHub's in src/domain/workload.js. Pure: no clock, no I/O.
import { createHash } from "node:crypto";
import { Refusal } from "./refusals/index.js";

export const FORGES = ["github", "gitlab"];

/** The issuer key of GitHub's uploads: the issuer's string. RW_OIDC_ISSUER moves the address the keys are
 * read at for a local witness, never this key: the rows of the store carry it since migration 0007. */
export const GITHUB_ISSUER_KEY = "https://token.actions.githubusercontent.com";
export const GITLAB_COM_ISSUER = "https://gitlab.com";
/** The public issuers, by the exact string of their tokens' `iss`: a closed list (ADR-0029 section 1). */
export const PUBLIC_ISSUERS = Object.freeze({ [GITHUB_ISSUER_KEY]: "github", [GITLAB_COM_ISSUER]: "gitlab" });
/** The hosts no tenant may register as an issuer, with every host under them (section 4): the public
 * issuers', and Entra's, which ADR-0030 keeps for a later adapter. The service's own are added at the call. */
export const RESERVED_ISSUER_HOSTS = Object.freeze(["gitlab.com", "token.actions.githubusercontent.com", "login.microsoftonline.com", "sts.windows.net"]);

/** A registration's identifier: 128 random bits, in hexadecimal. It is the issuer key of its uploads. */
export const REGISTRATION_ID = /^[0-9a-f]{32}$/;
/** The audience a registered instance's tokens carry: it names the registration, exactly. */
export const sendAudience = (origin, registrationId) => `${origin}/send/${registrationId}`;
/** A GitLab token older than this is refused whatever its `exp` (section 3 rule 1, section 6 point 13). */
export const MAX_TOKEN_AGE_S = 600;

const isForge = (forge) => { if (!FORGES.includes(forge)) throw new TypeError(`unknown forge: ${forge}`); };

/**
 * The key a repository is resolved by, within its forge and its issuer key (ADR-0031: the store's two
 * unique indexes of 0001 cannot be replaced by an expansion, so the issuer key enters the value they
 * index). GitHub's keys stay bare: its rows are not rewritten. Every other key reads
 * `<forge>:<issuer key>:<value>`: a forge's name holds no colon, a registration's key is 32 hexadecimal
 * digits and a public issuer's is a constant, so two issuer keys never give the same prefix.
 */
export function scopedKey(forge, issuerKey, value) {
  isForge(forge);
  if (typeof value !== "string" || !value) throw new TypeError("scopedKey: a value is required");
  if (forge === "github") {
    if (issuerKey !== GITHUB_ISSUER_KEY) throw new TypeError("scopedKey: GitHub has one issuer key");
    return value;
  }
  if (typeof issuerKey !== "string" || !(issuerKey === GITLAB_COM_ISSUER || REGISTRATION_ID.test(issuerKey))) throw new TypeError("scopedKey: the issuer key is a public issuer's string or a registration's identifier");
  return `${forge}:${issuerKey}:${value}`;
}
/** The key by name: the path in lower case, scoped. */
export const nameKeyOf = (forge, issuerKey, path) => scopedKey(forge, issuerKey, String(path).toLowerCase());

/** Who an upload's journal entry names: `github:<id>` as before, `gitlab:<issuer key>:<id>` (section 1). */
export const workloadId = (forge, issuerKey, repositoryId) => (forge === "github" ? `github:${repositoryId}` : `${forge}:${issuerKey}:${repositoryId ?? "?"}`);
/** The forge an entry's workload names, for a refusal's words. */
export const forgeOfWorkload = (id) => { const f = String(id ?? "").split(":")[0]; return FORGES.includes(f) ? f : "github"; };

// ------------------------------------------------------------------ the levels of evidence (section 2)
/** The codes, from the most to the least proven. The sentences are the shell's (web/views/lexique.js). */
export const LEVELS = ["P1", "P3", "P3b", "P4"];

/**
 * The level an upload reaches: computed from the forge, from whether its issuer is public or registered
 * and from whether the repository requires a protected branch. Never chosen, never raised by a
 * declaration: a registered instance is P4 whatever its token says.
 */
export function levelCode({ forge, issuerKind, protectionRequired }) {
  isForge(forge);
  if (forge === "github") return "P1";
  if (issuerKind !== "public") return "P4";
  return protectionRequired ? "P3" : "P3b";
}

/** The level with what it rests on, as the upload's journal entry keeps it. */
export function levelOf({ forge, issuer, kid, thumbprint, protectionRequired }) {
  const required = forge === "github" ? null : Boolean(protectionRequired);
  return {
    code: levelCode({ forge, issuerKind: issuer.kind, protectionRequired: required }),
    issuerKey: issuer.key, issuer: issuer.kind === "public" ? "public" : "registered",
    kid: kid ?? null, thumbprint: thumbprint ?? null, protectionRequired: required,
  };
}

// ------------------------------------------------------------------ the confirmation (section 1)
/** The digest of the values a confirmation pins: the gesture is bound to it, and the screen shows the values. */
export function pinDigest(values) {
  const text = JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k] ?? null]));
  return createHash("sha256").update(text).digest("hex");
}
/** The object of the gesture `repository-confirm`: the repository's id with the digest of what is pinned. */
export const confirmObject = (repositoryRef, digest) => `${repositoryRef}:${digest}`;

/** The digest a gesture on a registration is bound to: what the screen shows (section 4, point 16). */
export function registrationDigest(gesture, parts) {
  return createHash("sha256").update(JSON.stringify([gesture, ...parts])).digest("hex");
}

/** The refusal of a rule, with the forge whose words answer it. */
export const refuse = (code, forge, extra = {}) => new Refusal(code, { forge, ...extra });
