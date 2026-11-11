#!/usr/bin/env node
// What rw_app and rw_maint may do on the deployed base, COMPARED with the grant lines of
// db/schema.snapshot.txt, as the migration role (rw_owner), right after `migrate`, at each deploy
// (deploy.yml). Usage: MIGRATE_URL=postgres://rw_owner@host/runward_hosted node scripts/grants.mjs
// It reads, and changes nothing. It fails when there is one grant more or one fewer (review finding of
// 2026-11-10, C28: the level of these two users at the hoster is ignored by OpenTofu after creation,
// infra/scaleway/main.tf, and nothing read their table rights). What is compared:
//   - every table, view and foreign table of the schemas rw and rw_meta, each privilege PostgreSQL knows
//     for a table (MAINTAIN from version 17), as the role holds it IN EFFECT: granted to it, to PUBLIC or
//     to a role it is a member of, on the table or on any of its columns;
//   - USAGE and CREATE on the schemas rw and rw_meta; CONNECT and CREATE on the service database.
// What is not: TEMPORARY on the database (read and said by scripts/roles.mjs, it depends on what the
// hoster lets its administrator revoke), the schema public and any other schema (the service has nothing
// there), and the rights on functions and sequences (the snapshot holds the functions' owner and settings,
// not their ACL).
// WHO reads, and WHERE (two deploys stopped here on 2026-11-11). pg_class and pg_namespace hold the tables
// and schemas of the database the session is connected to, and of no other; and at the hoster a user
// connects only to a database it holds a privilege on. The comparison was first a flag of the
// administrator's gesture (`roles --grants`). The administrator's URL names the hoster's default database
// (`rdb`): read there, every table and schema line of the snapshot was "fewer" (run 42930736032). Given a
// session of its own on the service database, the administrator was refused by the server: "permission
// denied for database" (run 43018993884), because rw_admin holds no privilege on the service database
// (infra/scaleway/main.tf declares one for rw_owner, rw_app and rw_maint only). So the comparison is a
// gesture of its own, under rw_owner: it holds "all" on the service database, its URL names that database,
// and `migrate` has just run under it. The administrator is granted nothing more. Any role may ask what
// another holds (has_table_privilege and its kin take the role as an argument; pg_roles, pg_class and
// pg_namespace are readable by all), so the owner reads the same answer the administrator would.
// It compares only where it meant to be: a URL that names another database than RW_DATABASE is refused
// before any connection, and a session whose current_database() is not RW_DATABASE is refused before the
// catalog is read. Nothing is ever compared elsewhere, and a refusal there is never a count of grants.
// It fails closed: a snapshot that cannot be read, or that holds no line for one of the two roles, is a
// refusal. What differs is said in ONE line (the gateway keeps the last line of a failed gesture, 300
// characters): names of tables, roles and privileges only, never a row, so never a tenant.
import postgres from "postgres";
import { readFileSync } from "node:fs";
// The one TLS path of the scripts (verify-full checks the URL's host, an IP against the IP SANs).
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
 * the service database: the tables and schemas are read from the catalog of the session's database.
 * Exported for the test's control only (what an unguarded read finds in another database). */
export async function effectiveGrants(sql) {
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

const ELSEWHERE = `nothing compared, refused (the comparison reads the service database ${DATABASE} and no other)`;

/** Compares the grants in effect, as the session `sql` reads them in ITS database, with the snapshot's;
 * throws, in one line, when they differ. It first asks the session where it is, and refuses anywhere but
 * the service database: this is the one place the catalog is read. `grants` is the gesture. */
export async function compareGrants(sql, snapshot) {
  const [{ name }] = await sql`select current_database() as name`;
  if (name !== DATABASE) throw new Error(`the session meant for the service database ${DATABASE} is on another one: ${ELSEWHERE}`);
  const expected = new Set(expectedGrants(snapshot));
  const actual = new Set(await effectiveGrants(sql));
  const more = [...actual].filter((l) => !expected.has(l)).sort(), fewer = [...expected].filter((l) => !actual.has(l)).sort();
  if (more.length || fewer.length) {
    const said = [more.length ? `${more.length} more than the snapshot (${some(more)})` : null, fewer.length ? `${fewer.length} fewer (${some(fewer)})` : null].filter(Boolean).join("; ");
    throw new Error(`the grants of rw_app and rw_maint are not those of db/schema.snapshot.txt: ${said}`);
  }
  return expected.size;
}

/** The database a connection URL names (PostgreSQL's default, when it names none, is the user's name). */
const databaseOf = (u) => decodeURIComponent(u.pathname.replace(/^\//, "")) || decodeURIComponent(u.username);

/** The gesture: compares, under the role of `url` (rw_owner at the hoster), what rw_app and rw_maint may do
 * in the service database with the snapshot's grant lines. `url` must name the service database. */
export async function grants(url, { log = console.log, snapshot = null } = {}) {
  if (!NAME.test(DATABASE)) throw new Error("RW_DATABASE is not a plain database name");
  const u = new URL(url);
  if (databaseOf(u) !== DATABASE) throw new Error(`the URL given for the comparison of the grants names another database than ${DATABASE}: ${ELSEWHERE}`);
  const reference = snapshot ?? readFileSync(SNAPSHOT, "utf8");
  const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: migrationTls(url) });
  try {
    try { await sql`select 1`; } catch (e) {
      throw new Error(`cannot connect to the service database ${DATABASE} as ${decodeURIComponent(u.username)}: ${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 160)}`);
    }
    const compared = await compareGrants(sql, reference);
    log(`grants: the ${compared} table, schema and database grants of rw_app and rw_maint are those of db/schema.snapshot.txt, no more, no fewer (read in the database ${DATABASE})`);
    return { grants: compared };
  } finally { await sql.end({ timeout: 5 }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.MIGRATE_URL) { console.error("MIGRATE_URL is required"); process.exit(2); }
  if (process.argv.length > 2) { console.error(`grants: unknown argument ${process.argv[2]}`); process.exit(2); }
  grants(process.env.MIGRATE_URL).catch((e) => { console.error(`grants: ${e.message}`); process.exit(1); });
}
