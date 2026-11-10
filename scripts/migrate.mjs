#!/usr/bin/env node
// Apply the migrations, then the grants, as the migration role (rw_owner), never as the service.
// Usage: MIGRATE_URL=postgres://rw_owner@host/db node scripts/migrate.mjs
// Expansion only (PADR-0015 point 3): the files form a closed sequence (no gap, no reordering), and a
// migration that contracts the schema is refused before it runs.
// The guard is lexical: it reads the text of a migration, never what that text does once it runs.
// What is refused, wherever it sits in a statement, a dollar-quoted body included (CONTRACTING):
//   - any `drop`, but `drop not null` and `drop default`;
//   - any `rename`;
//   - `set schema`: `alter table x set schema attic` moves the table away, a rename in effect (code review
//     of 2026-11-10, C13); the session setting `set schema 'x'` is refused with it;
//   - `truncate` as a command (a trigger's event, `before truncate`, is not one);
//   - a column's type change (`alter [column] c [set data] type`).
// What is refused because the text does not hold what will run (DYNAMIC; same review, C13:
// `do $$ begin execute 'dr' || 'op table x'; end $$` passed):
//   - every `execute` inside a dollar-quoted body, whatever follows it. A body is code, and PL/pgSQL's
//     `execute` runs a text; `function` and `procedure` may be names of variables there, so no form of it
//     is let through (`execute function || ('op table x')` dropped a table past the first version of
//     this rule);
//   - every `execute` outside a body, but two: the privilege (`grant execute on`, `revoke execute on`), and
//     the clause `execute function f(` / `execute procedure f(` of a statement that begins with
//     `create [or replace] [constraint] trigger`. A prepared statement run by its name is refused with it;
//   - code given as a quoted string (`do '...'`, `as '...'`), which this lexer empties like any literal; a
//     body is dollar-quoted, where it is read whole.
// One file is exempt from DYNAMIC, never from CONTRACTING, by the sha256 of its bytes (DYNAMIC_READ
// below): it was read by a person, and it was applied before this rule.
// What is NOT refused, said here and claimed nowhere:
//   - a call to a function that already exists and runs a text it is given or builds (an earlier
//     migration's, an extension's, the server's own such as query_to_xml, which the server itself stops
//     from dropping a table);
//   - a contraction that uses none of the words above (a column made `not null`, a constraint added, a
//     privilege revoked, rows deleted or updated, an owner changed);
//   - db/grants.sql, which is not a migration and is not read by this guard.
// Each file runs once, in a transaction, and is recorded with its sha256 in rw_meta.migration; a file
// whose content changed after it ran stops everything.
// TLS as the service: verify-full by default, the instance's authority in DATABASE_CA or DATABASE_CA_FILE.
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { databaseTls, databaseTlsProblems } from "../src/adapters/store/tls.js";

const DIR = new URL("../db/migrations/", import.meta.url).pathname;
const GRANTS = new URL("../db/grants.sql", import.meta.url).pathname;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** A character the server reads as part of an identifier (its scanner's ident_cont: letters, digits, _,
 * $, and every byte of a non-ASCII character), and one that may begin it (ident_start: no digit, no $). */
const identChar = (ch) => ch !== undefined && (/[A-Za-z0-9_$]/.test(ch) || ch.charCodeAt(0) >= 0x80);
const identStart = (ch) => ch !== undefined && (/[A-Za-z_]/.test(ch) || ch.charCodeAt(0) >= 0x80);
const digit = (ch) => ch !== undefined && ch >= "0" && ch <= "9";
const near = (sql, from, to) => sql.slice(Math.max(0, from - 12), to).replace(/\s+/g, " ");

/** Where a literal that closed right before `from` goes on, or -1: the server joins two literals that only
 * white space holding at least one newline separates (its scanner's quotecontinue; a `--` comment up to
 * its newline counts as white space there), and reads the second piece as it read the first. */
function continuation(sql, from) {
  let k = from, newline = false;
  for (;;) {
    const ch = sql[k];
    if (ch === "\n" || ch === "\r") { newline = true; k++; }
    else if (ch === " " || ch === "\t" || ch === "\f" || ch === "\v") k++;
    else if (sql.startsWith("--", k)) { const e = sql.indexOf("\n", k); if (e < 0) return -1; k = e; }
    else break;
  }
  return newline && sql[k] === "'" ? k : -1;
}

/** The index after the single-quoted literal that opens at `open`, its continuations included; `escapes`:
 * a backslash escapes the next character (an escape string), in every piece of it. */
function literalEnd(sql, open, escapes) {
  let j = open + 1;
  for (;;) {
    while (j < sql.length) { if (escapes && sql[j] === "\\") j += 2; else if (sql[j] === "'" && sql[j + 1] === "'") j += 2; else if (sql[j] === "'") break; else j++; }
    const next = continuation(sql, j + 1);
    if (next < 0) return j + 1;
    j = next + 1;
  }
}

/** The text as the server reads it: comments removed, single-quoted literals emptied (an escape string
 * E'...' read with its backslash escapes, as the server reads it), double-quoted identifiers reduced to
 * "_" (a word inside an identifier is a name, never a command); dollar-quoted bodies are kept whole and
 * raw (a function body is code: a contracting word in it, even in a comment, is refused, the safe side).
 * Split on the ; that end a statement, never on one inside a literal, an identifier or a dollar-quoted
 * body. A word is read whole, as the server's scanner reads it: a $ inside it is part of the name and
 * opens nothing.
 * Review findings of 2026-11-10: an escape string holding \' and a double-quoted identifier holding a '
 * each opened what this lexer took for one long literal; then `a$b$`, a column name, was read as the
 * opening of a dollar-quoted body, whose end fell inside a later literal; then an escape string continued
 * after a newline was read as a plain literal from its second piece on. Each time a drop between the two
 * was hidden (the cases are in test/unit/migrations.test.js).
 * Returns the statements, the same statements with each dollar-quoted body emptied (`outer`: a
 * statement's own text, outside any body), and, in `ambiguous`, the first spelling this lexer will not claim to read as
 * every version of the server does (the file is then refused whole): a $ glued to a number (`1$a$`), or
 * in a word glued to a number (`1_000$a$`, `0x1F$a$`, `1e3$a$`: one number with a separator, a radix or
 * an exponent for one version, a number then a name for another). */
export function lex(sql) {
  const out = [], outer = []; let cur = "", own = ""; let i = 0; let ambiguous = null;
  const add = (text, outside = text) => { cur += text; own += outside; };
  const end = () => { if (cur.trim()) { out.push(cur.trim()); outer.push(own.trim()); } cur = ""; own = ""; };
  while (i < sql.length) {
    const c = sql[i], two = sql.slice(i, i + 2);
    if (two === "--") { const e = sql.indexOf("\n", i); i = e < 0 ? sql.length : e; continue; }
    if (two === "/*") { let depth = 0; do { if (sql.startsWith("/*", i)) { depth++; i += 2; } else if (sql.startsWith("*/", i)) { depth--; i += 2; } else i++; } while (depth > 0 && i < sql.length); add(" "); continue; }
    if (identStart(c)) {
      let j = i + 1; while (identChar(sql[j])) j++;
      const word = sql.slice(i, j);
      if (digit(sql[i - 1]) && word.includes("$")) ambiguous ??= `a $ in a word glued to a number: ${near(sql, i, j)}`;
      // an escape string: the word E or e, alone, right before the quote
      if (sql[j] === "'") { add(`${word}''`); i = literalEnd(sql, j, word === "E" || word === "e"); continue; }
      add(word); i = j; continue;
    }
    if (c === "'") { add("''"); i = literalEnd(sql, i, false); continue; }
    if (c === '"') { let j = i + 1; while (j < sql.length) { if (sql[j] === '"' && sql[j + 1] === '"') j += 2; else if (sql[j] === '"') break; else j++; } add('"_"'); i = j + 1; continue; }
    if (c === "$") {
      // a tag as the server reads it: a letter or _ (any non-ASCII character counts as a letter), then letters, digits, _
      const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(sql.slice(i));
      if (m) {
        if (digit(sql[i - 1])) ambiguous ??= `a $ glued to a number: ${near(sql, i, i + m[0].length)}`;
        const end = sql.indexOf(m[0], i + m[0].length); const stop = end < 0 ? sql.length : end;
        add(`$$${sql.slice(i + m[0].length, stop)}$$`, "$$$$"); i = stop + m[0].length; continue;
      }
    }
    if (c === ";") { end(); i++; continue; }
    add(c); i++;
  }
  end();
  return { statements: out, outer, ambiguous };
}

export const statements = (sql) => lex(sql).statements;

// What contracts the schema, anywhere in a statement (inside a function body too): any DROP but the
// relaxing `drop not null` and `drop default`; any RENAME; SET SCHEMA; TRUNCATE as a command (a trigger
// event `before truncate` is not one); a column type change.
const CONTRACTING = [
  ["drop", /\bdrop\s+(?!not\s+null\b|default\b)/i],
  ["rename", /\brename\b/i],
  // a table moved to another schema is gone from where the service reads it: a rename in effect
  ["set schema", /\bset\s+schema\b/i],
  ["truncate", /(?<!\b(?:before|after|or|of)\s+)\btruncate\b/i],
  // the column's name as the lexer reads a word (letters of any script, digits, _, $), or a quoted name
  ["type change", /\balter\s+(?:column\s+)?(?:"[^"]+"|[A-Za-z_\u0080-￿][\w$\u0080-￿]*)\s+(?:set\s+data\s+)?type\b/i],
];

// What runs a statement the text does not hold (the header says what is and is not refused).
//   `execute`: every one inside a dollar-quoted body; outside a body, every one but the privilege
//   (`execute on`) and a trigger's clause, in a statement that begins with create trigger (code review of
//   2026-11-10, C13: the exemption `execute function f(` was read anywhere, a body included, where
//   `function` may be a variable's name: `execute function || ('op table x')` passed and dropped the table).
//   Code as a quoted string: a DO whose code is not dollar-quoted, and `as '...'`, a function's body (the
//   lexer has emptied the literal: what is refused is the place it stands in).
const TRIGGER = /^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\b/i;
const TRIGGER_CLAUSE = /\bexecute\s+(?:function|procedure)\s+[^\s(;]+\s*\(/gi;
const PRIVILEGE = /\bexecute\s+on\b/gi;
const executes = (text) => text.match(/\bexecute\b/gi)?.length ?? 0;
/** Does this statement run a text? `st`: the statement, bodies included; `outer`: the same, bodies emptied. */
function runsText(st, outer) {
  // an `execute` the statement holds and its own text does not is inside a body
  if (executes(st) > executes(outer)) return true;
  const own = (TRIGGER.test(outer) ? outer.replace(TRIGGER_CLAUSE, " ") : outer).replace(PRIVILEGE, " ");
  return executes(own) > 0;
}
const DYNAMIC = [
  ["dynamic statement", runsText],
  ["code in a quoted string", (st) => /^do\b(?!(?:\s+language\s+[A-Za-z_]\w*)?\s*\$\$)|\bas\s*(?:[A-Za-z]&?)?''/i.test(st)],
];
// The files whose dynamic statements were read by a person, by the sha256 of their bytes: a byte changed,
// and the file is judged like any other.
//   0001_floor.sql: one DO loop that enables and forces row level security and creates the tenant policy
//   on thirteen tables named in a fixed array, through format('%I').
export const DYNAMIC_READ = new Set(["161187ed2712ef61c92e6b492e714d282864ba5d860ff7dca2725f174d9acc51"]);

/** The first contracting statement of a migration, as "<kind>: <statement>", or null. A file that names
 * a setting that changes how the server reads a string (standard_conforming_strings, backslash_quote) is
 * refused whole, wherever the name sits, a literal included: the lexer above could no longer read the file
 * as the server does, so it does not try. So is a file with a spelling the lexer calls ambiguous. A
 * statement that runs a text built at run time, or code given as a quoted string, is refused as one that
 * could contract (DYNAMIC), in every file but those of DYNAMIC_READ. */
export function contracting(sql) {
  const reading = /standard_conforming_strings|backslash_quote/i.exec(sql);
  if (reading) return `string reading: the file names ${reading[0].toLowerCase()}`;
  const read = lex(sql);
  if (read.ambiguous) return `spelling: ${read.ambiguous}`;
  const kinds = DYNAMIC_READ.has(sha(sql)) ? CONTRACTING : [...CONTRACTING, ...DYNAMIC];
  for (const [n, st] of read.statements.entries()) {
    for (const [kind, rule] of kinds) if (typeof rule === "function" ? rule(st, read.outer[n]) : rule.test(st)) return `${kind}: ${st.replace(/\s+/g, " ").slice(0, 120)}`;
  }
  return null;
}

/** The migrations to apply, in order, or a refusal: names NNNN_name.sql numbered 0001.. without a gap or
 * a duplicate; every applied file still present and unchanged; nothing new numbered before an applied
 * file (a reordering); nothing new that contracts the schema. */
export function planMigrations(files, applied) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach((f, k) => {
    const m = NAME.exec(f.name);
    if (!m) throw new Error(`${f.name}: a migration is named NNNN_name.sql (lower case)`);
    if (Number(m[1]) !== k + 1) throw new Error(`${f.name}: the numbering has a gap or a duplicate (expected ${String(k + 1).padStart(4, "0")})`);
  });
  const names = new Set(sorted.map((f) => f.name));
  for (const name of applied.keys()) if (!names.has(name)) throw new Error(`${name} was applied and is no longer in db/migrations`);
  const lastApplied = Math.max(0, ...sorted.map((f, k) => (applied.has(f.name) ? k + 1 : 0)));
  const plan = [];
  sorted.forEach((f, k) => {
    if (applied.has(f.name)) { if (applied.get(f.name) !== sha(f.text)) throw new Error(`${f.name} changed after it was applied`); return; }
    if (k + 1 < lastApplied) throw new Error(`${f.name} is new and numbered before an applied migration: a reordering, refused`);
    const why = contracting(f.text);
    if (why) throw new Error(`${f.name} ${/^(dynamic statement|code in a quoted string)/.test(why) ? "could contract" : "contracts"} the schema (${why}): refused, migrations are expansion only`);
    plan.push(f);
  });
  return plan;
}

export function migrationTls(url, env = process.env) {
  const ca = env.DATABASE_CA ?? (env.DATABASE_CA_FILE ? readFileSync(env.DATABASE_CA_FILE, "utf8") : null);
  const mode = env.DATABASE_SSL ?? "verify-full";
  const problems = databaseTlsProblems({ url, mode, ca, production: env.NODE_ENV === "production" });
  if (problems.length) throw new Error(problems.join("; "));
  return databaseTls(url, { mode, ca });
}

export async function migrate(url, { log = console.log } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: migrationTls(url) });
  try {
    await sql`create schema if not exists rw_meta`;
    await sql`create table if not exists rw_meta.migration (name text primary key, sha256 text not null, applied_at timestamptz not null default now())`;
    const done = new Map((await sql`select name, sha256 from rw_meta.migration`).map((r) => [r.name, r.sha256]));
    const files = readdirSync(DIR).filter((x) => x.endsWith(".sql")).map((name) => ({ name, text: readFileSync(DIR + name, "utf8") }));
    const applied = [];
    for (const f of planMigrations(files, done)) {
      await sql.begin(async (q) => { await q.unsafe(f.text); await q`insert into rw_meta.migration (name, sha256) values (${f.name}, ${sha(f.text)})`; });
      applied.push(f.name);
      log(`migrate: applied ${f.name}`);
    }
    await sql.unsafe(readFileSync(GRANTS, "utf8"));
    log("migrate: grants applied");
    return { applied };
  } finally { await sql.end({ timeout: 5 }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.MIGRATE_URL) { console.error("MIGRATE_URL is required"); process.exit(2); }
  migrate(process.env.MIGRATE_URL).catch((e) => { console.error(`migrate: ${e.message}`); process.exit(1); });
}
