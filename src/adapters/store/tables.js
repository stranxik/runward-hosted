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
  forge_repository: { key: ["id"], cols: { id: "u", forge: "s", nameKey: "s", name: "s", repositoryId: "s", ownerId: "s", state: "s", removedAt: "t" } },
  repository: { key: ["id"], cols: { id: "u", name: "s", workflow: "s", defaultBranch: "s", epoch: "n", consent: "k", consentAt: "t", declaredAt: "t", confirmedAt: "t", removedAt: "t", pendingSend: "j" } },
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
};

export const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function checkColumns(table, row) {
  const spec = TABLES[table];
  if (!spec) throw new Error(`unknown table: ${table}`);
  for (const k of Object.keys(row)) if (!(k in spec.cols)) throw new Error(`unknown column ${table}.${k}`);
  return spec;
}
