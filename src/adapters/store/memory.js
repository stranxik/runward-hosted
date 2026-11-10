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

const UNIQUE = {
  passkey: [{ name: "passkey_credential_id_key", global: true, cols: ["credentialId"] }],
  session: [{ name: "session_token_hash_key", global: true, cols: ["tokenHash"] }],
  link: [{ name: "link_token_hash_key", global: true, cols: ["tokenHash"] }],
  forge_repository: [
    { name: "forge_repository_pending_name", global: true, cols: ["forge", "nameKey"], where: (r) => r.state === "pending" && !r.removedAt },
    { name: "forge_repository_pinned_id", global: true, cols: ["forge", "repositoryId"], where: (r) => r.repositoryId != null },
  ],
  member: [{ name: "member_one_founder", cols: [], where: (r) => r.founder }],
  upload: [{ name: "upload_idempotence", cols: ["runId", "runAttempt", "mission", "kind"] }],
};

export function memoryStore({ clock }) {
  const state = { rows: Object.fromEntries(Object.keys(TABLES).map((t) => [t, []])), ledger: [], challenges: new Map(), jti: new Map(), rate: new Map(), refused: new Map(), operator: [], maintenance: null };
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
        conflict(table, full);
        state.rows[table] = [...state.rows[table], full];
        return pick(full);
      },
      update(table, key, patch) {
        need(); checkColumns(table, key); checkColumns(table, patch);
        if (table === "link" && ["openedAt", "usableFrom", "expiresAt", "kind", "tokenHash"].some((c) => c in patch)) throw new Error("a link's dates, kind and token are written once");
        const i = state.rows[table].findIndex((r) => mine(r) && match(r, key));
        if (i < 0) return null;
        // as the trigger of db/migrations/0006: a published version is written once, its only change is the erasure of its bytes
        if (table === "fleet_index") {
          const was = state.rows[table][i];
          const erasure = Object.keys(patch).every((c) => c === "bytes" || c === "erasedAt") && patch.bytes?.length === 0 && patch.erasedAt != null && (was.erasedAt == null || was.erasedAt === patch.erasedAt);
          if (!erasure) throw new Error("a published index version is written once: only its bytes are erased");
        }
        const next = { ...state.rows[table][i], ...patch };
        conflict(table, next, keyOf(table, state.rows[table][i]));
        state.rows[table] = state.rows[table].map((r, j) => (j === i ? next : r));
        return pick(next);
      },
      lockTenant() { need(); },
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
      resolveRepository({ forge, repositoryId, nameKey }) {
        const all = state.rows.forge_repository;
        const pinned = all.find((r) => r.forge === forge && r.repositoryId === repositoryId);
        if (pinned) return { tenantId: pinned.tenantId, id: pinned.id, state: pinned.state, removed: Boolean(pinned.removedAt) };
        const pending = all.find((r) => r.forge === forge && r.state === "pending" && !r.removedAt && r.nameKey === nameKey);
        return pending ? { tenantId: pending.tenantId, id: pending.id, state: "pending", removed: false } : null;
      },
      nameTaken({ forge, nameKey }) {
        const hits = state.rows.forge_repository.filter((r) => r.forge === forge && r.nameKey === nameKey && !r.removedAt);
        if (hits.some((r) => r.tenantId === tenantId)) return "here";
        return hits.length ? "elsewhere" : "free";
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
      useJti(jti, expiresAt) {
        const now = clock.now();
        for (const [k, v] of state.jti) if (v < now - 120_000) state.jti.delete(k);
        if (state.jti.has(jti)) return false;
        state.jti.set(jti, expiresAt);
        return true;
      },
      takeRate(repositoryId, bucket, runId, limit) {
        const k = `${repositoryId}\u0000${bucket}`;
        const runs = state.rate.get(k) ?? new Set();
        if (runs.has(runId)) return true;
        if (runs.size >= limit) return false;
        runs.add(runId);
        state.rate.set(k, runs);
        return true;
      },
      countRefused(repositoryId, bucket) {
        const k = `${repositoryId ?? "?"}\u0000${bucket}`;
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
