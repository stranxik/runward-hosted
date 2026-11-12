// The in-memory TenantStore: the reference adapter for the unit and application tests, and the store of
// the local witness when no PostgreSQL is reachable (said on screen and in the log). It mirrors the
// PostgreSQL adapter: the same tables, the same unique constraints, a tenant set per transaction that
// filters every read and stamps every write (the RLS of PADR-0013, in code), the same resolution
// functions by exact key, the same append-only journal. One transaction at a time; a failing
// transaction leaves nothing behind (rows are replaced, never mutated, so a snapshot is a shallow copy).
import { randomUUID } from "node:crypto";
import { TABLES, DEFAULTS, NOW_ON_INSERT, checkColumns } from "./tables.js";
import { StoreConflict } from "./errors.js";
import { LINK_DURATIONS } from "../../domain/identity.js";
import { scopedKey, GITHUB_ISSUER_KEY, GITLAB_COM_ISSUER } from "../../domain/forge.js";

const UNIQUE = {
  passkey: [{ name: "passkey_credential_id_key", global: true, cols: ["credentialId"] }],
  session: [{ name: "session_token_hash_key", global: true, cols: ["tokenHash"] }],
  link: [{ name: "link_token_hash_key", global: true, cols: ["tokenHash"] }],
  forge_repository: [
    { name: "forge_repository_pending_name", global: true, cols: ["forge", "nameKey"], where: (r) => r.state === "pending" && !r.removedAt },
    { name: "forge_repository_pinned_id", global: true, cols: ["forge", "repositoryId"], where: (r) => r.repositoryId != null },
  ],
  member: [{ name: "member_one_founder", cols: [], where: (r) => r.founder }],
  issuer: [{ name: "issuer_pkey", global: true, cols: ["id"] }],
  issuer_key: [{ name: "issuer_key_issuer_ref_kid_key", cols: ["issuerRef", "kid"] }],
  upload: [{ name: "upload_idempotence", cols: ["runId", "runAttempt", "mission", "kind"] }],
};

export function memoryStore({ clock }) {
  const state = { rows: Object.fromEntries(Object.keys(TABLES).map((t) => [t, []])), ledger: [], challenges: new Map(), jti: new Map(), rate: new Map(), refused: new Map(), operator: [], maintenance: null };
  // as the checks and triggers of db/migrations/0007: a row's keys are scoped by its forge and issuer key,
  // a registered issuer key is a live registration of the row's own tenant, and what a registration and
  // its keys are is written once (a removal and a retirement are final)
  const forgeRow = (row, was) => {
    const github = row.forgeName === "github";
    if (github ? row.issuerKey !== GITHUB_ISSUER_KEY || String(row.nameKey).includes(":") || String(row.repositoryId ?? "").includes(":") : !["gitlab"].includes(row.forgeName)) throw new Error("forge_repository_keys_scoped");
    const prefix = github ? "" : `${row.forgeName}:${row.issuerKey}:`;
    if (!github && (!String(row.nameKey).startsWith(prefix) || (row.repositoryId != null && !String(row.repositoryId).startsWith(prefix)))) throw new Error("forge_repository_keys_scoped");
    if (!github && row.issuerKey !== GITLAB_COM_ISSUER && (!was || was.issuerKey !== row.issuerKey) && !state.rows.issuer.some((i) => i.tenantId === row.tenantId && i.id === row.issuerKey && !i.removedAt)) throw new Error("a repository's issuer key is a public issuer or a live registration of its own tenant");
  };
  const frozen = (table, was, next) => {
    const cols = table === "issuer" ? ["id", "forge", "issuer", "addedAt"] : ["id", "issuerRef", "kid", "jwk", "thumbprint", "addedAt"];
    const end = table === "issuer" ? "removedAt" : "retiredAt";
    if (cols.some((c) => JSON.stringify(was[c]) !== JSON.stringify(next[c])) || (was[end] != null && was[end] !== next[end])) throw new Error(`${table}: written once; a removal or a retirement is final`);
  };
  let queue = Promise.resolve();

  const keyOf = (table, row) => TABLES[table].key.map((k) => row[k]).join("\u0000");
  const pick = (row) => { if (!row) return null; const { tenantId, ...rest } = row; return { ...rest }; };

  function tx(tenantId) {
    const mine = (r) => r.tenantId === tenantId;
    const need = () => { if (!tenantId) throw new Error("this operation needs a tenant (app.tenant is not set)"); };
    const conflict = (table, row, exceptKey) => {
      for (const u of UNIQUE[table] ?? []) {
        if (u.where && !u.where(row)) continue;
        const clash = state.rows[table].find((r) => (u.global || r.tenantId === row.tenantId) && keyOf(table, r) !== exceptKey && (!u.where || u.where(r)) && u.cols.every((c) => r[c] === row[c]));
        if (clash) throw new StoreConflict(u.name);
      }
      if (exceptKey === undefined && state.rows[table].some((r) => r.tenantId === row.tenantId && keyOf(table, r) === keyOf(table, row))) throw new StoreConflict(`${table}_pkey`);
    };
    const match = (r, where) => Object.entries(where).every(([k, v]) => (v === null ? r[k] == null : r[k] === v));
    return {
      tenantId,
      get(table, key) {
        need(); checkColumns(table, key);
        return pick(state.rows[table].find((r) => mine(r) && match(r, key)));
      },
      list(table, where = {}) {
        need(); checkColumns(table, where);
        return state.rows[table].filter((r) => mine(r) && match(r, where)).map(pick);
      },
      insert(table, row) {
        need(); checkColumns(table, row);
        const now = clock.now();
        const full = { ...Object.fromEntries(Object.keys(TABLES[table].cols).map((c) => [c, null])), ...structuredClone(DEFAULTS[table] ?? {}), ...row, tenantId };
        for (const c of NOW_ON_INSERT[table] ?? []) if (full[c] == null) full[c] = now;
        if (table === "tenant") full.id = tenantId;
        if (table === "link") { const d = LINK_DURATIONS[full.kind]; full.openedAt = now; full.usableFrom = now + d.delay; full.expiresAt = full.usableFrom + d.life; }
        if (table === "forge_repository") forgeRow(full, null);
        if (table === "issuer_key" && !state.rows.issuer.some((i) => i.tenantId === tenantId && i.id === full.issuerRef)) throw new Error("issuer_key_issuer_fkey");
        conflict(table, full);
        state.rows[table] = [...state.rows[table], full];
        return pick(full);
      },
      update(table, key, patch) {
        need(); checkColumns(table, key); checkColumns(table, patch);
        if (table === "link" && ["openedAt", "usableFrom", "expiresAt", "kind", "tokenHash"].some((c) => c in patch)) throw new Error("a link's dates, kind and token are written once");
        const i = state.rows[table].findIndex((r) => mine(r) && match(r, key));
        if (i < 0) return null;
        // as the trigger of db/migrations/0006: a published version is written once, its only change is the
        // erasure of its bytes, and the date of an erasure is the store's own, whatever date is given
        if (table === "fleet_index") {
          const was = state.rows[table][i];
          const erasure = Object.keys(patch).every((c) => c === "bytes" || c === "erasedAt") && patch.bytes?.length === 0 && patch.erasedAt != null && (was.erasedAt == null || was.erasedAt === patch.erasedAt);
          if (!erasure) throw new Error("a published index version is written once: only its bytes are erased");
          if (was.erasedAt == null) patch = { ...patch, erasedAt: clock.now() };
        }
        const next = { ...state.rows[table][i], ...patch };
        if (table === "forge_repository") forgeRow(next, state.rows[table][i]);
        if (table === "issuer" || table === "issuer_key") frozen(table, state.rows[table][i], next);
        conflict(table, next, keyOf(table, state.rows[table][i]));
        state.rows[table] = state.rows[table].map((r, j) => (j === i ? next : r));
        return pick(next);
      },
      lockTenant() { need(); },
      // the versions not yet erased, by number: the number and the fleet.json only, never the bytes
      indexVersionsWhole() {
        need();
        return state.rows.fleet_index.filter((r) => mine(r) && r.erasedAt == null).sort((a, b) => a.version - b.version).map((r) => ({ version: r.version, manifest: r.manifest }));
      },
      // ---- the journal: append only
      ledgerHead() {
        need();
        const mineL = state.ledger.filter(mine);
        const last = mineL[mineL.length - 1];
        return last ? { seq: last.seq, hash: last.hash } : null;
      },
      ledgerAppend(e) {
        need();
        const head = this.ledgerHead();
        if (e.seq !== (head ? head.seq + 1 : 1)) throw new StoreConflict("ledger_pkey");
        state.ledger = [...state.ledger, { tenantId, seq: e.seq, prev: e.prev, hash: e.hash, body: structuredClone(e.body), at: clock.now() }];
      },
      ledgerPage({ before = null, limit = 50 } = {}) {
        need();
        const all = state.ledger.filter((r) => mine(r) && (before === null || r.seq < before));
        return all.slice(-limit).reverse().map(pick);
      },
      ledgerAll() { need(); return state.ledger.filter(mine).map(pick); },
      // ---- resolution, by exact key (rw_resolve functions)
      // `repositoryId` and `nameKey` are the forge's own values; the issuer key enters both keys here
      // (GitHub's stay bare). Within an issuer key only: a registration's rows are its tenant's alone.
      resolveRepository({ forge, issuerKey = GITHUB_ISSUER_KEY, repositoryId, nameKey }) {
        const idKey = scopedKey(forge, issuerKey, repositoryId), nKey = scopedKey(forge, issuerKey, nameKey);
        const all = state.rows.forge_repository.filter((r) => r.issuerKey === issuerKey);
        const pinned = all.find((r) => r.repositoryId === idKey);
        if (pinned) return { tenantId: pinned.tenantId, id: pinned.id, state: pinned.state, removed: Boolean(pinned.removedAt) };
        const pending = all.find((r) => r.state === "pending" && !r.removedAt && r.nameKey === nKey);
        return pending ? { tenantId: pending.tenantId, id: pending.id, state: "pending", removed: false } : null;
      },
      nameTaken({ forge, issuerKey = GITHUB_ISSUER_KEY, nameKey }) {
        const nKey = scopedKey(forge, issuerKey, nameKey);
        const hits = state.rows.forge_repository.filter((r) => r.issuerKey === issuerKey && r.nameKey === nKey && !r.removedAt);
        if (hits.some((r) => r.tenantId === tenantId)) return "here";
        return hits.length ? "elsewhere" : "free";
      },
      // a registration and its keys, by its exact identifier, before the tenant is known (rw.resolve_issuer)
      resolveIssuer(id) {
        const i = state.rows.issuer.find((r) => r.id === id);
        if (!i) return null;
        const keys = state.rows.issuer_key.filter((k) => k.tenantId === i.tenantId && k.issuerRef === i.id).map((k) => ({ id: k.id, kid: k.kid, jwk: structuredClone(k.jwk), thumbprint: k.thumbprint, addedAt: k.addedAt, confirmedAt: k.confirmedAt, retiredAt: k.retiredAt }));
        return { tenantId: i.tenantId, forge: i.forge, issuer: i.issuer, removed: Boolean(i.removedAt), keys };
      },
      resolveCredential(credentialId) {
        const p = state.rows.passkey.find((r) => r.credentialId === credentialId);
        return p ? { tenantId: p.tenantId, passkeyId: p.id } : null;
      },
      resolveSession(tokenHash) {
        const s = state.rows.session.find((r) => r.tokenHash === tokenHash && !r.closedAt);
        return s ? { tenantId: s.tenantId, id: s.id } : null;
      },
      resolveLink(tokenHash) {
        const l = state.rows.link.find((r) => r.tokenHash === tokenHash);
        return l ? { tenantId: l.tenantId, id: l.id } : null;
      },
      putChallenge(c) {
        const now = clock.now();
        for (const [k, v] of state.challenges) if (v.expiresAt < now) state.challenges.delete(k);
        state.challenges.set(c.id, { ...c, expiresAt: now + 5 * 60_000 });
      },
      takeChallenge(id) {
        const c = state.challenges.get(id);
        if (!c) return null;
        state.challenges.delete(id);
        return { ...c, live: c.expiresAt > clock.now() };
      },
      // a replay id is used once within its issuer key, and a counter is its issuer key's (ADR-0029 section 1)
      useJti(jti, expiresAt, issuerKey = GITHUB_ISSUER_KEY) {
        const now = clock.now();
        for (const [k, v] of state.jti) if (v < now - 120_000) state.jti.delete(k);
        const key = `${issuerKey}\u0000${jti}`;
        if (state.jti.has(key)) return false;
        state.jti.set(key, expiresAt);
        return true;
      },
      takeRate(repositoryId, bucket, runId, limit, issuerKey = GITHUB_ISSUER_KEY) {
        const k = `${issuerKey}\u0000${repositoryId}\u0000${bucket}`;
        const runs = state.rate.get(k) ?? new Set();
        if (runs.has(runId)) return true;
        if (runs.size >= limit) return false;
        runs.add(runId);
        state.rate.set(k, runs);
        return true;
      },
      countRefused(repositoryId, bucket, issuerKey = GITHUB_ISSUER_KEY) {
        for (const key of state.refused.keys()) if (Number(key.split("\u0000")[2]) < bucket - 2) state.refused.delete(key);
        const k = `${issuerKey}\u0000${repositoryId ?? "?"}\u0000${bucket}`;
        state.refused.set(k, (state.refused.get(k) ?? 0) + 1);
        return state.refused.get(k);
      },
      maintenance() { return state.maintenance; },
      setMaintenance(m) { state.maintenance = m; },
      tenantIds() { return state.rows.tenant.map((t) => t.tenantId); },
      operatorNote(what, detail) { state.operator.push({ seq: state.operator.length + 1, at: clock.now(), what, detail }); return state.operator.length; },
      // as rw.daily_jobs(): per daily job, its last note's time and whether that run completed
      dailyJobs() {
        const out = {};
        for (const n of state.operator) {
          if (n.what !== "retention" && n.what !== "verify-chains") continue;
          const report = Array.isArray(n.detail?.report) ? n.detail.report : [];
          out[n.what] = { at: n.at, ok: !(Number(n.detail?.failed ?? 0) > 0) && !report.some((e) => e?.ok === false || e?.failed === true) };
        }
        return out;
      },
    };
  }

  return {
    kind: "memory",
    /** Run fn in one transaction, under a tenant (or none, for the resolution functions only). */
    tx(tenantId, fn) {
      const run = async () => {
        const snapshot = { rows: { ...state.rows }, ledger: state.ledger, maintenance: state.maintenance };
        try { return await fn(tx(tenantId ?? null)); } catch (e) {
          state.rows = snapshot.rows; state.ledger = snapshot.ledger; state.maintenance = snapshot.maintenance;
          throw e;
        }
      };
      const p = queue.then(run, run);
      queue = p.then(() => undefined, () => undefined);
      return p;
    },
    newId: () => randomUUID(),
    async ping() { return true; },
    async close() {},
    _state: state,
  };
}
