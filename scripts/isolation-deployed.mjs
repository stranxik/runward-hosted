#!/usr/bin/env node
// The isolation suite on the deployed base (PADR-0013 point 5, S4), run after each deploy as a hoster job in
// the private network, under rw_app (DATABASE_URL of that role), never rw_owner, never from the Internet.
// RW_WITNESS_TENANTS names the two witness tenants (reserved identities, excluded from every measure).
// Reads every tenant table from each witness, counts what belongs to the other, tries a write that names
// the other, checks the catalog it can see. Exit 0 when 0 rows cross, 1 otherwise, 2 when it cannot tell
// (two witnesses with no row at all would prove nothing: the positive control).
import postgres from "postgres";
import { migrationTls } from "./migrate.mjs";
const T = ["member", "passkey", "session", "link", "forge_repository", "repository", "mission", "upload", "blob", "fleet_index", "reader", "archive", "ledger", "issuer", "issuer_key"];
const [a, b] = (process.env.RW_WITNESS_TENANTS ?? "").split(",");
if (!a || !b) { console.error("RW_WITNESS_TENANTS must name two tenants"); process.exit(2); }
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {}, ssl: migrationTls(process.env.DATABASE_URL) });
const faults = []; let seen = 0;
for (const [me, other] of [[a, b], [b, a]]) {
  for (const t of T) await sql.begin(async (q) => {
    await q`select set_config('app.tenant', ${me}, true)`;
    const [{ n }] = await q.unsafe(`select count(*)::int as n from rw.${t} where tenant_id = $1`, [other]);
    const [{ all, mine }] = await q.unsafe(`select count(*)::int as all, count(*) filter (where tenant_id = $1)::int as mine from rw.${t}`, [me]);
    seen += mine;
    if (n || all !== mine) faults.push(`${t}: rows of another tenant visible from ${me.slice(0, 8)}`);
  });
  await sql.begin(async (q) => { await q`select set_config('app.tenant', ${me}, true)`; await q`insert into rw.reader (tenant_id) values (${other})`; faults.push("a write naming another tenant passed"); }).catch(() => {});
}
const [{ rolbypassrls }] = await sql`select rolbypassrls from pg_roles where rolname = current_user`;
if (rolbypassrls) faults.push("the service role bypasses RLS");
// every security definer function resolves its names in pg_catalog, then rw, and in pg_temp last (0005)
const loose = await sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'rw' and p.prosecdef and (p.proconfig is null or not p.proconfig @> array['search_path=pg_catalog, rw, pg_temp'])`;
if (loose.length) faults.push(`security definer functions without the search_path pg_catalog, rw, pg_temp: ${loose.map((r) => r.proname).join(", ")}`);
await sql.end();
if (!seen) { console.error("isolation-deployed: the witnesses hold no row: cannot tell"); process.exit(2); }
if (faults.length) { console.error(`isolation-deployed:\n  - ${faults.join("\n  - ")}`); process.exit(1); }
console.log(`isolation-deployed: 0 row crossed between the two witnesses (${seen} of their own seen)`);
