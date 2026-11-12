// The tenant tables the TenantStore port reaches, shared by the PostgreSQL and the in-memory adapters so
// both read the same shape. Columns are camelCase here and snake_case in db/migrations/0001_floor.sql.
// Types: t = timestamp (milliseconds in the app), j = jsonb, b = bytes, n = integer, k = boolean,
// s = text, u = uuid. The tenant column is never written by the app: the database defaults it from app.tenant.

export const TABLES = {
  tenant: { key: ["id"], cols: { id: "u", title: "s", lang: "s", witness: "k", createdAt: "t" } },
  member: { key: ["id"], cols: { id: "u", role: "s", founder: "k", label: "s", addedAt: "t", removedAt: "t", singlePasskeyAt: "t" } },
  passkey: { key: ["id"], cols: { id: "u", memberId: "u", credentialId: "s", publicKey: "b", counter: "n", transports: "j", aaguid: "s", device: "s", via: "s", createdAt: "t", lastUsedAt: "t", removedAt: "t", lost: "k", addedBySession: "u" } },
  session: { key: ["id"], cols: { id: "u", tokenHash: "s", memberId: "u", passkeyId: "u", device: "s", createdAt: "t", lastSeenAt: "t", freshAt: "t", freshBy: "u", grant: "j", closedAt: "t" } },
  link: { key: ["id"], cols: { id: "u", tokenHash: "s", kind: "s", memberId: "u", openedAt: "t", usableFrom: "t", expiresAt: "t", usedAt: "t", cancelledAt: "t", meta: "j" } },
  // `forge` is the column of 0001, frozen at 'github' by its check, which an expansion cannot widen: never
  // read it. The forge is `forgeName`; `issuerKey` is the issuer's string for a public issuer and the
  // tenant's registration for a registered one; `nameKey` and `repositoryId` are the keys a repository is
  // resolved by, scoped by forge and issuer key for every forge but GitHub (src/domain/forge.js#scopedKey,
  // db/migrations/0007, ADR-0031); `definitionRef` is GitLab's pinned ci_config_ref_uri.
  forge_repository: { key: ["id"], cols: { id: "u", forge: "s", forgeName: "s", issuerKey: "s", nameKey: "s", name: "s", repositoryId: "s", ownerId: "s", definitionRef: "s", state: "s", removedAt: "t" } },
  repository: { key: ["id"], cols: { id: "u", name: "s", workflow: "s", defaultBranch: "s", epoch: "n", consent: "k", consentAt: "t", declaredAt: "t", confirmedAt: "t", removedAt: "t", pendingSend: "j", protectionLiftedAt: "t" } },
  // a GitLab instance a tenant registered (ADR-0029 section 4): `id` is the registration, 128 random bits,
  // and the issuer key of its uploads; `issuer` is the string of its tokens' iss, as given
  issuer: { key: ["id"], cols: { id: "s", forge: "s", issuer: "s", addedAt: "t", removedAt: "t" } },
  issuer_key: { key: ["id"], cols: { id: "u", issuerRef: "s", kid: "s", jwk: "j", thumbprint: "s", addedAt: "t", confirmedAt: "t", retiredAt: "t" } },
  mission: { key: ["id"], cols: { id: "s", repositoryRef: "u", path: "s", addedAt: "t", removedAt: "t" } },
  upload: { key: ["id"], cols: { id: "u", repositoryRef: "u", mission: "s", kind: "s", runId: "s", runNumber: "s", runAttempt: "s", epoch: "n", sha256: "s", size: "n", rank: "s", seq: "n", commit: "s", claims: "j", receivedAt: "t", erasedAt: "t" } },
  blob: { key: ["sha256"], cols: { sha256: "s", refs: "n", erasedAt: "t" } },
  fleet_index: { key: ["version"], cols: { version: "n", sha256: "s", bytes: "b", manifestSha256: "s", manifest: "b", fleetVersion: "s", fleetArchiveSha256: "s", seq: "n", publishedAt: "t", erasedAt: "t" } },
  reader: { key: [], cols: { authorizedAt: "t", withdrawnAt: "t" } },
  archive: { key: ["id"], cols: { id: "u", preparedAt: "t", size: "n", sha256: "s", contains: "j", erasedAt: "t" } },
};

/** Defaults the database writes when a column is omitted (kept identical in the memory adapter). */
export const DEFAULTS = {
  tenant: { title: "runward hébergé", lang: "fr", witness: false },
  member: { founder: false },
  passkey: { counter: 0, transports: [], lost: false },
  forge_repository: { forge: "github", forgeName: "github", issuerKey: "https://token.actions.githubusercontent.com" },
  repository: { epoch: 0, consent: false, defaultBranch: "main" },
  mission: { path: "." },
  upload: { epoch: 0 },
  blob: { refs: 0 },
  archive: { contains: [] },
  link: { meta: {} },
};
/** Columns stamped with now() on insert when omitted. */
export const NOW_ON_INSERT = {
  tenant: ["createdAt"], member: ["addedAt"], passkey: ["createdAt"], session: ["createdAt", "lastSeenAt"],
  repository: ["declaredAt"], mission: ["addedAt"], upload: ["receivedAt"], fleet_index: ["publishedAt"], archive: ["preparedAt"],
  issuer: ["addedAt"], issuer_key: ["addedAt", "confirmedAt"],
};

export const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function checkColumns(table, row) {
  const spec = TABLES[table];
  if (!spec) throw new Error(`unknown table: ${table}`);
  for (const k of Object.keys(row)) if (!(k in spec.cols)) throw new Error(`unknown column ${table}.${k}`);
  return spec;
}
