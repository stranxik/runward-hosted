// The PostgreSQL TenantStore (PADR-0013). The service connects as rw_app (no owner, no BYPASSRLS); each
// transaction sets app.tenant with set_config(..., true), which does not outlive the transaction, so a
// pooled connection never carries a tenant into the next one. Reads and writes go through row level
// security; nothing here adds a tenant predicate of its own, so the isolation suite tests the database,
// not this file. Identifiers come from the closed table list (tables.js), never from a request.
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { TABLES, checkColumns, snake } from "./tables.js";
import { StoreConflict } from "./errors.js";
import { scopedKey, GITHUB_ISSUER_KEY } from "../../domain/forge.js";

// jsonb goes in as text and is cast by the server: a JSON text sent as a jsonb parameter would be
// encoded a second time and stored as a JSON string (a defect found on PostgreSQL, guarded in test/pg).
const CAST = { t: "timestamptz", j: "text::jsonb", b: "bytea", n: "bigint", k: "boolean", s: "text", u: "uuid" };

function toDb(type, v) {
  if (v === null || v === undefined) return null;
  if (type === "t") return new Date(v).toISOString();
  if (type === "j") return JSON.stringify(v);
  if (type === "b") return Buffer.from(v);
  if (type === "n") return String(v);
  if (type === "k") return Boolean(v);
  return String(v);
}
function fromDb(type, v) {
  if (v === null || v === undefined) return null;
  if (type === "t") return new Date(v).getTime();
  if (type === "n") return Number(v);
  if (type === "b") return Buffer.from(v);
  if (type === "j") return typeof v === "string" ? JSON.parse(v) : v;
  return v;
}
const rowOut = (table, r) => {
  if (!r) return null;
  const cols = TABLES[table].cols;
  return Object.fromEntries(Object.entries(cols).map(([c, t]) => [c, fromDb(t, r[snake(c)])]));
};

function wrapConflict(e) {
  if (e?.code === "23505") throw new StoreConflict(e.constraint_name ?? e.constraint ?? "unique");
  throw e;
}

export function postgresStore({ url, max = 4, ssl }) {
  // false or a verifying object (tls.js#databaseTls); a string mode would let the client skip the check.
  if (ssl !== false && (typeof ssl !== "object" || ssl === null || ssl.rejectUnauthorized !== true)) throw new Error("postgresStore: ssl must be false or a verifying TLS configuration (databaseTls)");
  const sql = postgres(url, { max, ssl, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => {}, connection: { application_name: "runward-hosted", statement_timeout: 10_000 } });

  function tx(q, tenantId) {
    const need = () => { if (!tenantId) throw new Error("this operation needs a tenant (app.tenant is not set)"); };
    const where = (table, w, params) => {
      const cols = TABLES[table].cols;
      const parts = Object.entries(w).map(([k, v]) => {
        if (v === null) return `${snake(k)} is null`;
        params.push(toDb(cols[k], v));
        return `${snake(k)} = $${params.length}::${CAST[cols[k]]}`;
      });
      return parts.length ? `where ${parts.join(" and ")}` : "";
    };
    const q1 = async (text, params) => { try { return await q.unsafe(text, params); } catch (e) { return wrapConflict(e); } };
    return {
      tenantId,
      async get(table, key) {
        need(); checkColumns(table, key);
        const p = []; const rows = await q1(`select * from rw.${table} ${where(table, key, p)} limit 1`, p);
        return rowOut(table, rows[0]);
      },
      async list(table, w = {}) {
        need(); checkColumns(table, w);
        const p = []; const order = TABLES[table].key[0] ? ` order by ${snake(TABLES[table].key[0])}` : "";
        const rows = await q1(`select * from rw.${table} ${where(table, w, p)}${table === "upload" ? " order by received_at, id" : order}`, p);
        return rows.map((r) => rowOut(table, r));
      },
      async insert(table, row) {
        need(); checkColumns(table, row);
        const cols = TABLES[table].cols; const keys = Object.keys(row).filter((k) => row[k] !== undefined);
        const p = keys.map((k) => toDb(cols[k], row[k]));
        const text = keys.length
          ? `insert into rw.${table} (${keys.map((k) => `"${snake(k)}"`).join(", ")}) values (${keys.map((k, i) => `$${i + 1}::${CAST[cols[k]]}`).join(", ")}) returning *`
          : `insert into rw.${table} default values returning *`;
        const rows = await q1(text, p);
        return rowOut(table, rows[0]);
      },
      async update(table, key, patch) {
        need(); checkColumns(table, key); checkColumns(table, patch);
        const cols = TABLES[table].cols; const p = [];
        const sets = Object.entries(patch).map(([k, v]) => { p.push(toDb(cols[k], v)); return `"${snake(k)}" = $${p.length}::${CAST[cols[k]]}`; });
        if (!sets.length) return this.get(table, key);
        const rows = await q1(`update rw.${table} set ${sets.join(", ")} ${where(table, key, p)} returning *`, p);
        return rowOut(table, rows[0]);
      },
      async lockTenant() { need(); await q`select pg_advisory_xact_lock(hashtext(${tenantId}))`; },
      // the versions not yet erased, by number: the number and the fleet.json only. The bytes of every
      // version of a tenant are never read together here: their sum grows with each upload.
      async indexVersionsWhole() {
        need();
        const rows = await q`select version, manifest from rw.fleet_index where erased_at is null order by version`;
        return rows.map((r) => ({ version: Number(r.version), manifest: Buffer.from(r.manifest) }));
      },
      async ledgerHead() {
        need();
        const [r] = await q`select seq, hash from rw.ledger order by seq desc limit 1`;
        return r ? { seq: Number(r.seq), hash: r.hash } : null;
      },
      async ledgerAppend(e) {
        need();
        await q1("insert into rw.ledger (seq, prev, hash, body) values ($1::bigint, $2::text, $3::text, $4::text::jsonb)", [String(e.seq), e.prev, e.hash, JSON.stringify(e.body)]);
      },
      async ledgerPage({ before = null, limit = 50 } = {}) {
        need();
        const rows = before === null
          ? await q`select seq, prev, hash, body, at from rw.ledger order by seq desc limit ${limit}`
          : await q`select seq, prev, hash, body, at from rw.ledger where seq < ${before} order by seq desc limit ${limit}`;
        return rows.map((r) => ({ seq: Number(r.seq), prev: r.prev, hash: r.hash, body: r.body, at: new Date(r.at).getTime() }));
      },
      async ledgerAll() {
        need();
        const rows = await q`select seq, prev, hash, body, at from rw.ledger order by seq`;
        return rows.map((r) => ({ seq: Number(r.seq), prev: r.prev, hash: r.hash, body: r.body, at: new Date(r.at).getTime() }));
      },
      // ---- resolution functions (SECURITY DEFINER, owned by rw_resolve, exact key)
      // `repositoryId` and `nameKey` are the forge's own values; the issuer key enters both keys here
      // (GitHub's stay bare), and the functions of 0007 read within that issuer key only
      async resolveRepository({ forge, issuerKey = GITHUB_ISSUER_KEY, repositoryId, nameKey }) {
        const [r] = await q`select * from rw.resolve_forge_repository(${issuerKey}, ${scopedKey(forge, issuerKey, repositoryId)}, ${scopedKey(forge, issuerKey, nameKey)})`;
        return r ? { tenantId: r.tenant_id, id: r.id, state: r.state, removed: r.removed } : null;
      },
      async nameTaken({ forge, issuerKey = GITHUB_ISSUER_KEY, nameKey }) { const [r] = await q`select rw.name_key_taken(${issuerKey}, ${scopedKey(forge, issuerKey, nameKey)}) as v`; return r.v; },
      // a registration and its keys, by its exact identifier, before the tenant is known
      async resolveIssuer(id) {
        const rows = await q`select * from rw.resolve_issuer(${id})`;
        if (!rows.length) return null;
        const at = (v) => (v == null ? null : new Date(v).getTime());
        return {
          tenantId: rows[0].tenant_id, forge: rows[0].forge, issuer: rows[0].issuer, removed: rows[0].removed,
          keys: rows.filter((r) => r.key_id).map((r) => ({ id: r.key_id, kid: r.kid, jwk: typeof r.jwk === "string" ? JSON.parse(r.jwk) : r.jwk, thumbprint: r.thumbprint, addedAt: at(r.added_at), confirmedAt: at(r.confirmed_at), retiredAt: at(r.retired_at) })),
        };
      },
      async resolveCredential(id) { const [r] = await q`select * from rw.resolve_credential(${id})`; return r ? { tenantId: r.tenant_id, passkeyId: r.passkey_id } : null; },
      async resolveSession(h) { const [r] = await q`select * from rw.resolve_session(${h})`; return r ? { tenantId: r.tenant_id, id: r.id } : null; },
      async resolveLink(h) { const [r] = await q`select * from rw.resolve_link(${h})`; return r ? { tenantId: r.tenant_id, id: r.id } : null; },
      async putChallenge(c) { await q`select rw.put_challenge(${c.id}::uuid, ${c.challenge}, ${c.purpose}, ${c.sessionId ?? null}::uuid, ${c.linkId ?? null}::uuid, ${c.gesture ?? null}, ${c.object ?? null})`; },
      async takeChallenge(id) {
        const [r] = await q`select * from rw.take_challenge(${id}::uuid)`;
        return r ? { challenge: r.challenge, purpose: r.purpose, sessionId: r.session_id, linkId: r.link_id, gesture: r.gesture, object: r.object, live: r.live } : null;
      },
      // a replay id is used once within its issuer key, and a counter is its issuer key's. A GitHub replay id
      // is also written where the image before 0007 looks (rw.oidc_jti), so that a token used on one image
      // is not accepted by the other while both run during a deploy.
      async useJti(jti, expiresAt, issuerKey = GITHUB_ISSUER_KEY) { const [r] = await q`select rw.use_token(${issuerKey}, ${jti}, ${new Date(expiresAt).toISOString()}::timestamptz, ${issuerKey === GITHUB_ISSUER_KEY}) as ok`; return r.ok; },
      async takeRate(repositoryId, bucket, runId, limit, issuerKey = GITHUB_ISSUER_KEY) { const [r] = await q`select rw.take_send_rate(${issuerKey}, ${repositoryId}, ${bucket}, ${runId}, ${limit}) as ok`; return r.ok; },
      async countRefused(repositoryId, bucket, issuerKey = GITHUB_ISSUER_KEY) { const [r] = await q`select rw.count_send_refused(${issuerKey}, ${repositoryId ?? "?"}, ${bucket}) as n`; return r.n; },
      async maintenance() { const [r] = await q`select rw.maintenance() as m`; return r.m ?? null; },
      async setMaintenance(m) { await q`select rw.set_maintenance(${m === null ? null : JSON.stringify(m)}::text::jsonb)`; },
      async tenantIds() { const rows = await q`select * from rw.tenant_ids() as id`; return rows.map((r) => r.id); },
      async operatorNote(what, detail) { const [r] = await q`select rw.operator_note(${what}, ${JSON.stringify(detail)}::text::jsonb) as seq`; return Number(r.seq); },
      // the last outcome of each daily job: { <job>: { at, ok } }, never a tenant, an error or a head
      async dailyJobs() {
        const [r] = await q`select rw.daily_jobs() as j`;
        return Object.fromEntries(Object.entries(r.j ?? {}).map(([job, v]) => [job, { at: new Date(v.at).getTime(), ok: v.ok === true }]));
      },
    };
  }

  return {
    kind: "postgres",
    async tx(tenantId, fn) {
      return sql.begin(async (q) => {
        await q`select set_config('app.tenant', ${tenantId ?? ""}, true)`;
        return fn(tx(q, tenantId ?? null));
      });
    },
    newId: () => randomUUID(),
    async ping() { await sql`select 1`; return true; },
    async close() { await sql.end({ timeout: 5 }); },
    sql,
  };
}
