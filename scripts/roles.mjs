#!/usr/bin/env node
// db/roles.sql on a Scaleway managed PostgreSQL, run once by the database administrator (rw_admin),
// before the first migration. Usage: ADMIN_URL=postgres://rw_admin@host/rdb node scripts/roles.mjs
// (the URL may name any database of the server the administrator can connect to)
// The hoster's API has already created rw_owner, rw_app and rw_maint as LOGIN users with their passwords
// (infra/scaleway/main.tf) and granted CONNECT on the service database; it cannot create a NOLOGIN role,
// set an attribute or grant a membership. This script does that part, then CHECKS what roles.sql asks
// for and fails closed when it does not hold: NOBYPASSRLS cannot be set here (PostgreSQL 16 lets only a
// role that has BYPASSRLS change it), so it is verified, never assumed.
// It also takes TEMPORARY on the service database away from PUBLIC (review finding of 2026-11-10, C1: a
// role that may create temporary objects can plant a type in pg_temp; the definer functions' search_path
// is the control, 0005, this is the second net). Only the database's owner or a superuser can: db/grants.sql
// runs as rw_owner, which is neither, so the revoke is here, under the administrator. Whether the hoster
// lets its administrator do it is not known before the first call against it: the revoke is attempted,
// then what rw_app and rw_maint may do is READ and said in this script's one line; it does not fail the
// gesture (the search_path does not depend on it).
// The grants of db/grants.sql are not applied here: they run as rw_owner, the owner of the schema rw, at
// the end of scripts/migrate.mjs.
// With --grants (after `migrate`, at each deploy: deploy.yml), it also COMPARES what rw_app and rw_maint
// may do on the deployed base with the grant lines of db/schema.snapshot.txt, and fails when they differ
// (review finding of 2026-11-10, C28: the level of these two users at the hoster is ignored by OpenTofu
// after creation, infra/scaleway/main.tf, and nothing read their table rights). What is compared:
//   - every table, view and foreign table of the schemas rw and rw_meta, each privilege PostgreSQL knows
//     for a table (MAINTAIN from version 17), as the role holds it IN EFFECT: granted to it, to PUBLIC or
//     to a role it is a member of, on the table or on any of its columns;
//   - USAGE and CREATE on the schemas rw and rw_meta; CONNECT and CREATE on the service database.
// What is not: TEMPORARY on the database (read and said above, it depends on what the hoster lets its
// administrator revoke), the schema public and any other schema (the service has nothing there), and the
// rights on functions and sequences (the snapshot holds the functions' owner and settings, not their ACL).
// WHERE it reads (found on 2026-11-11, deploy run 42930736032): pg_class and pg_namespace hold the tables
// and schemas of the database the session is connected to, and of no other. The administrator's URL at
// the hoster names the hoster's default database (`rdb`, infra/scaleway/main.tf), where the schema rw does
// not exist: read there, every table and schema line of the snapshot was "fewer" and the deploy stopped.
// So the comparison opens its OWN session on the service database (RW_DATABASE, the one name used for the
// database lines too), with the credentials and host of ADMIN_URL, whatever database that URL names,
// checks that it is where it meant to be, and closes it. Whether the hoster lets its administrator
// connect to the service database is not known before the first call against it: when it does not, the
// gesture fails and says "cannot connect to the service database ... as ...", never a count of grants.
// Everything else in this script reads or changes what the whole server shares (pg_roles, memberships,
// has_database_privilege and `revoke ... on database` by the database's NAME), so it holds from any
// database, the hoster's default one included.
// It fails closed: a snapshot that cannot be read, or that holds no line for one of the two roles, is a
// refusal. What differs is said in ONE line (the gateway keeps the last line of a failed gesture, 300
// characters): names of tables, roles and privileges only, never a row, so never a tenant.
import postgres from "postgres";
import { readFileSync } from "node:fs";
// The one TLS path of the scripts (verify-full checks the URL's host, an IP against the IP SANs; a bare
// { ca, rejectUnauthorized } would check "localhost" and refuse the real instance).
import { migrationTls } from "./migrate.mjs";

const DATABASE = process.env.RW_DATABASE ?? "runward_hosted";
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const SNAPSHOT = new URL("../db/schema.snapshot.txt", import.meta.url).pathname;
const CHECKED = ["rw_app", "rw_maint"];
const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

/** The grant lines of a snapshot for rw_app and rw_maint: `grant <schema>.<table> <role> <PRIVILEGE>`,
 * `grant schema <schema> <role> <PRIVILEGE>`, `grant database <role> <PRIVILEGE>`. Throws when one of
 * the two roles has no table, schema or database line: such a snapshot proves nothing. */
export function expectedGrants(text) {
  const lines = text.split("\n").filter((l) => l.startsWith("grant ") && CHECKED.includes(l.split(" ").at(-2)));
  for (const role of CHECKED) {
    for (const [kind, re] of [["table", /^grant [a-z_]+\.[a-z_0-9]+ /], ["schema", /^grant schema /], ["database", /^grant database /]]) {
      if (!lines.some((l) => re.test(l) && l.split(" ").at(-2) === role)) throw new Error(`db/schema.snapshot.txt holds no ${kind} grant line for ${role}: nothing to compare with, refused`);
    }
  }
  return lines;
}

/** What rw_app and rw_maint may do on this base, in the snapshot's own lines. `sql` MUST be a session on
 * the service database: the tables and schemas are read from the catalog of the session's database. */
async function effectiveGrants(sql) {
  const [{ version }] = await sql`select current_setting('server_version_num')::int as version`;
  const privileges = version >= 170000 ? [...TABLE_PRIVILEGES, "MAINTAIN"] : TABLE_PRIVILEGES;
  const rows = await sql`
    with r as (select oid, rolname from pg_roles where rolname in ${sql(CHECKED)}),
         n as (select oid, nspname from pg_namespace where nspname in ('rw', 'rw_meta'))
    select format('grant %s.%s %s %s', n.nspname, c.relname, r.rolname, p) as l
      from pg_class c join n on n.oid = c.relnamespace cross join r cross join unnest(${privileges}::text[]) as p
      where c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (has_table_privilege(r.oid, c.oid, p) or (p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') and has_any_column_privilege(r.oid, c.oid, p)))
    union all select format('grant schema %s %s %s', n.nspname, r.rolname, p)
      from n cross join r cross join unnest(array['USAGE', 'CREATE']) as p where has_schema_privilege(r.oid, n.oid, p)
    union all select format('grant database %s %s', r.rolname, p)
      from r cross join unnest(array['CONNECT', 'CREATE']) as p where has_database_privilege(r.oid, ${DATABASE}::text, p)`;
  return rows.map((x) => x.l);
}

const some = (lines) => `${lines.slice(0, 4).map((l) => l.slice("grant ".length)).join(", ")}${lines.length > 4 ? ", ..." : ""}`;

/** Compares the grants in effect, as the session `sql` reads them in ITS database, with the snapshot's;
 * throws, in one line, when they differ. Exported for the test's control only: `roles` is the gesture. */
export async function compareGrants(sql, snapshot) {
  const expected = new Set(expectedGrants(snapshot));
  const actual = new Set(await effectiveGrants(sql));
  const more = [...actual].filter((l) => !expected.has(l)).sort(), fewer = [...expected].filter((l) => !actual.has(l)).sort();
  if (more.length || fewer.length) {
    const said = [more.length ? `${more.length} more than the snapshot (${some(more)})` : null, fewer.length ? `${fewer.length} fewer (${some(fewer)})` : null].filter(Boolean).join("; ");
    throw new Error(`the grants of rw_app and rw_maint are not those of db/schema.snapshot.txt: ${said}`);
  }
  return expected.size;
}

/** Runs `fn` with a session on the service database, under the credentials and host of `url`, whatever
 * database `url` names; the session is closed whatever happens. Refuses, in one line, when the service
 * database cannot be reached under that user, or when the session is not on it. */
async function inServiceDatabase(url, fn) {
  const u = new URL(url);
  u.pathname = `/${DATABASE}`;
  const db = postgres(u.toString(), { max: 1, onnotice: () => {}, ssl: migrationTls(u.toString()) });
  try {
    let name;
    try { [{ name }] = await db`select current_database() as name`; } catch (e) {
      throw new Error(`cannot connect to the service database ${DATABASE} as ${decodeURIComponent(u.username)}: ${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 160)}`);
    }
    if (name !== DATABASE) throw new Error(`the session meant for the service database ${DATABASE} is on another one: nothing compared, refused`);
    return await fn(db);
  } finally { await db.end({ timeout: 5 }); }
}

export async function roles(url, { log = console.log, grants = false, snapshot = null } = {}) {
  if (!NAME.test(DATABASE)) throw new Error("RW_DATABASE is not a plain database name");
  const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: migrationTls(url) });
  try {
    await sql.unsafe(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'rw_resolve') then create role rw_resolve nologin; end if;
    end $$`);
    await sql.unsafe("grant rw_resolve to rw_owner");
    // a role that does not own the database gets a warning here, not an error: the check below tells
    await sql.unsafe(`revoke temporary on database ${DATABASE} from public`).catch(() => {});
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
    const [t] = await sql`select has_database_privilege('rw_app', ${DATABASE}, 'temporary') as app, has_database_privilege('rw_maint', ${DATABASE}, 'temporary') as maint`;
    const temporary = t.app || t.maint ? "TEMPORARY NOT revoked (the administrator may not: the definer functions' search_path remains the control)" : "no temporary objects for rw_app and rw_maint";
    const said = `roles: rw_resolve (nologin) exists, rw_owner is its member, rw_app and rw_maint do not bypass RLS; ${temporary}`;
    if (!grants) { log(said); return { temporaryRevoked: !(t.app || t.maint) }; }
    const reference = snapshot ?? readFileSync(SNAPSHOT, "utf8");
    // in the service database, never in the one this session is on (the hoster's default one, at the hoster)
    const compared = await inServiceDatabase(url, (db) => compareGrants(db, reference));
    log(`${said}; the ${compared} table, schema and database grants of rw_app and rw_maint are those of db/schema.snapshot.txt, no more, no fewer (read in the database ${DATABASE})`);
    return { temporaryRevoked: !(t.app || t.maint), grants: compared };
  } finally { await sql.end({ timeout: 5 }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.ADMIN_URL) { console.error("ADMIN_URL is required"); process.exit(2); }
  const extra = process.argv.slice(2).filter((a) => a !== "--grants");
  if (extra.length) { console.error(`roles: unknown argument ${extra[0]}`); process.exit(2); }
  roles(process.env.ADMIN_URL, { grants: process.argv.includes("--grants") }).catch((e) => { console.error(`roles: ${e.message}`); process.exit(1); });
}
