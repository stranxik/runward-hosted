#!/usr/bin/env node
// db/roles.sql on a Scaleway managed PostgreSQL, run once by the database administrator (rw_admin),
// before the first migration. Usage: ADMIN_URL=postgres://rw_admin@host/rdb node scripts/roles.mjs
// The hoster's API has already created rw_owner, rw_app and rw_maint as LOGIN users with their passwords
// (infra/scaleway/main.tf) and granted CONNECT on the service database; it cannot create a NOLOGIN role,
// set an attribute or grant a membership. This script does that part, then CHECKS what roles.sql asks
// for and fails closed when it does not hold: NOBYPASSRLS cannot be set here (PostgreSQL 16 lets only a
// role that has BYPASSRLS change it), so it is verified, never assumed.
// The grants of db/grants.sql are not applied here: they run as rw_owner, the owner of the schema rw, at
// the end of scripts/migrate.mjs.
import postgres from "postgres";

const DATABASE = process.env.RW_DATABASE ?? "runward_hosted";

function tls() {
  const mode = process.env.DATABASE_SSL ?? "verify-full";
  if (mode === "disable") return false;
  if (mode === "verify-full") {
    if (!process.env.DATABASE_CA) throw new Error("DATABASE_SSL=verify-full needs DATABASE_CA");
    return { ca: process.env.DATABASE_CA, rejectUnauthorized: true };
  }
  return mode;
}

export async function roles(url, { log = console.log } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: tls() });
  try {
    await sql.unsafe(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'rw_resolve') then create role rw_resolve nologin; end if;
    end $$`);
    await sql.unsafe("grant rw_resolve to rw_owner");
    const rows = await sql`select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
      from pg_roles where rolname in ('rw_owner', 'rw_resolve', 'rw_app', 'rw_maint')`;
    const by = new Map(rows.map((r) => [r.rolname, r]));
    const problems = [];
    for (const name of ["rw_owner", "rw_resolve", "rw_app", "rw_maint"]) {
      const r = by.get(name);
      if (!r) { problems.push(`${name} does not exist`); continue; }
      if (r.rolsuper) problems.push(`${name} is a superuser`);
      if (r.rolcreaterole || r.rolcreatedb) problems.push(`${name} may create roles or databases`);
    }
    for (const name of ["rw_app", "rw_maint"]) if (by.get(name)?.rolbypassrls) problems.push(`${name} bypasses row level security`);
    for (const name of ["rw_owner", "rw_app", "rw_maint"]) if (by.has(name) && !by.get(name).rolcanlogin) problems.push(`${name} cannot log in`);
    if (by.get("rw_resolve")?.rolcanlogin) problems.push("rw_resolve can log in");
    const [m] = await sql`select pg_has_role('rw_owner', 'rw_resolve', 'member') as member`;
    if (!m.member) problems.push("rw_owner is not a member of rw_resolve");
    const [d] = await sql`select has_database_privilege('rw_owner', ${DATABASE}, 'create') as owner_create,
      has_database_privilege('rw_app', ${DATABASE}, 'connect') as app_connect,
      has_database_privilege('rw_maint', ${DATABASE}, 'connect') as maint_connect`;
    if (!d.owner_create) problems.push(`rw_owner cannot create in ${DATABASE}`);
    if (!d.app_connect) problems.push(`rw_app cannot connect to ${DATABASE}`);
    if (!d.maint_connect) problems.push(`rw_maint cannot connect to ${DATABASE}`);
    if (problems.length) throw new Error(`the roles do not hold:\n  - ${problems.join("\n  - ")}`);
    log("roles: rw_resolve (nologin) exists, rw_owner is its member, rw_app and rw_maint do not bypass RLS");
  } finally { await sql.end({ timeout: 5 }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.ADMIN_URL) { console.error("ADMIN_URL is required"); process.exit(2); }
  roles(process.env.ADMIN_URL).catch((e) => { console.error(`roles: ${e.message}`); process.exit(1); });
}
