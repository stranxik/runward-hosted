// Migrations are expansion only and run in a closed sequence (PADR-0015 point 3; review finding of
// 2026-11-08: the first guard missed `alter table if exists x drop column y` and a drop that did not
// begin a line, and refused neither a gap nor a reordering).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { contracting, planMigrations, statements } from "../../scripts/migrate.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const DIR = new URL("../../db/migrations/", import.meta.url).pathname;
const REAL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).map((name) => ({ name, text: readFileSync(DIR + name, "utf8") }));
const ok = "create table rw.x (id uuid primary key);";

test("migrations: a contracting statement is refused wherever it sits, in each spelling listed here", () => {
  for (const sql of [
    "alter table if exists rw.repository drop column default_branch;",
    "alter table rw.repository drop default_branch;",
    "create index i on rw.x (id); drop table rw.ledger;",
    "select 1;\n  DROP TABLE rw.ledger;",
    "alter table rw.x rename column a to b;",
    "alter table rw.x rename to y;",
    "truncate rw.ledger;",
    "alter table rw.x alter column a type bigint;",
    "alter table rw.x alter a set data type bigint;",
    "drop index if exists rw.i;",
    "alter table rw.x drop constraint c;",
    "create function rw.f() returns void language plpgsql as $$ begin drop table rw.ledger; end $$;",
  ]) assert.ok(contracting(sql), `not refused: ${sql}`);
});

// Review finding of 2026-11-10: two spellings that hid a drop between two pieces the lexer took for one
// literal. Each is refused now, and each control beside it shows the lexer still reads the same construct
// as data where the server does.
test("migrations: an escape string and a double-quoted identifier, each holding a quote, no longer hide a statement", () => {
  for (const sql of [
    "select E'\\''; drop table rw.ledger; select ' ';",
    "select \"a'b\"; drop table rw.ledger; select \"c'd\";",
    "select e'\\\\'; drop table rw.ledger; select ' ';",
    // é ends an identifier for the server, so caféE'...' is a name then a plain literal, where \ escapes nothing
    "select caféE'\\'; drop table rw.ledger; --'",
    // a dollar-quote tag may hold a non-ASCII letter: the ' inside its body is not a literal
    "select $é$'$é$; drop table rw.ledger; select '1';",
    // the settings that change how the server reads a string are refused wherever they are named
    "set standard_conforming_strings = off;",
    "select set_config('standard_conforming_strings', 'off', false);",
    "set backslash_quote = on;",
  ]) assert.ok(contracting(sql), `not refused: ${sql}`);
  for (const sql of [
    "insert into rw.n values (E'it\\'s; drop table rw.ledger');",
    "create table rw.\"x'y\" (id int);",
    "create table rw.\"drop me\" (\"truncate\" int);",
  ]) assert.equal(contracting(sql), null, `refused, but the contracting words are data or names: ${sql}`);
  assert.deepEqual(statements("select E'\\''; drop x"), ["select E''", "drop x"]);
  assert.deepEqual(statements("select \"a'b\"; drop x; select \"c'd\""), ['select "_"', "drop x", 'select "_"']);
});

// Review finding of 2026-11-10 (independent review): `a$b$` is a column name for the server, and this lexer
// read its `$b$` as the opening of a dollar-quoted body, which ended inside the literal that followed; on
// PostgreSQL 17.11 the hidden statement dropped rw.ledger. A $ inside a word opens nothing now; a $ glued
// to a number is refused whole (the server's versions do not read it alike).
test("migrations: a $ inside a name opens no dollar-quoted body, so the statement after it is read; glued to a number, the file is refused", () => {
  for (const sql of [
    "create table rw.t (a$b$ text default '$b$'); drop table rw.ledger; select '1';",
    "create table rw.t (é$b$ text default '$b$'); drop table rw.ledger; select '1';",
    "select a$$ from rw.t where b = '$$'; drop table rw.ledger; select '1';",
    // a number, then a dollar-quoted body for the server: a lexer that takes the $ for a part of a word sees a literal here
    "select 1$a$ ' $a$; drop table rw.ledger; select $a$ ' $a$;",
    "select 1_000$a$ ' $a$; drop table rw.ledger; select $a$ ' $a$;",
    "select 0x1F$a$ ' $a$; drop table rw.ledger; select $a$ ' $a$;",
    "select 1e3$a$ ' $a$; drop table rw.ledger; select $a$ ' $a$;",
  ]) assert.ok(contracting(sql), `not refused: ${sql}`);
  assert.deepEqual(statements("create table rw.t (a$b$ text default '$b$'); drop x; select '1'"), ["create table rw.t (a$b$ text default '')", "drop x", "select ''"]);
  assert.match(contracting("select 1$a$ x $a$;"), /^spelling: a \$ glued to a number/);
  assert.match(contracting("select 1_000$a$ x $a$;"), /^spelling: a \$ in a word glued to a number/);
  for (const sql of [
    "create table rw.t (a$b$ text default 'x');",
    "create table rw.price$ (id int, cost$eur numeric default 1);",
    "create function rw.f() returns int language sql as $body$ select 1 $body$;",
    "select 'x'$a$ ; $a$;",
  ]) assert.equal(contracting(sql), null, `refused, but nothing contracts: ${sql}`);
});

// Review finding of 2026-11-10 (code review C3): the server joins two literals that white space with a
// newline separates, and keeps reading the second with the backslash escapes of the first. This lexer read
// the second piece as a plain literal, so its \' closed it early and the drop after it was hidden.
test("migrations: an escape string continued after a newline is read whole, so the statement after it is read", () => {
  for (const sql of [
    "select E'a'\n'\\' ' ; drop table rw.ledger; select '';",
    "select e'a' \t\r\n  '\\' ' ; drop table rw.ledger; select '';",
    // a -- comment up to its newline is white space between the two pieces
    "select E'a' -- note\n '\\' ' ; drop table rw.ledger; select '';",
    "select E'a'\n-- note\n'\\' ' ; drop table rw.ledger; select '';",
    // three pieces
    "select E'a'\n'b'\n'\\' ' ; drop table rw.ledger; select '';",
  ]) assert.ok(contracting(sql), `not refused: ${sql}`);
  assert.deepEqual(statements("select E'a'\n'\\' ' ; drop x; select ''"), ["select E''", "drop x", "select ''"]);
  // controls: without a newline between them, two literals are two literals, and the server reads the second plain
  assert.deepEqual(statements("select E'a' '\\' ; drop x; select '"), ["select E'' ''", "drop x", "select ''"]);
  for (const sql of [
    "insert into rw.n values (E'a'\n'\\'; drop table rw.ledger');",
    "insert into rw.n values ('a'\n  'b; drop table rw.ledger');",
  ]) assert.equal(contracting(sql), null, `refused, but the contracting words are data: ${sql}`);
});

// Review finding of 2026-11-10 (code review C9): the type-change pattern matched the column's name with
// ASCII word characters only.
test("migrations: a type change is refused whatever the column's name: non-ASCII, with a $, quoted", () => {
  for (const sql of [
    "alter table rw.x alter column café type integer using 1;",
    "alter table rw.x alter café set data type integer;",
    "alter table rw.x alter column prix$ type integer;",
    "alter table rw.x alter column \"le prix\" type integer;",
    "alter table rw.x alter column a type integer;",
  ]) assert.match(contracting(sql) ?? "", /^type change/, `not refused: ${sql}`);
  assert.equal(contracting("alter table rw.x alter column café set default 1;"), null);
});

test("migrations: comments and quoted strings are not statements, and expansion passes", () => {
  for (const sql of [
    "-- drop table rw.ledger\ncreate table rw.y (id int);",
    "/* rename everything */ create table rw.y (id int);",
    "insert into rw.n values ('drop table rw.ledger; truncate x');",
    "create trigger t before truncate on rw.ledger for each statement execute function rw.f();",
    "alter table rw.x add column b text not null default 'main';",
    "alter table rw.x alter column b drop not null;",
  ]) assert.equal(contracting(sql), null, sql);
  assert.deepEqual(statements("a; $$ b; c $$; d"), ["a", "$$ b; c $$", "d"], "a ; inside a dollar-quoted body ends nothing");
});

test("migrations: every committed migration is expansion only and the directory is a closed sequence", () => {
  assert.ok(REAL.length >= 3);
  assert.deepEqual(planMigrations(REAL, new Map()).map((f) => f.name), REAL.map((f) => f.name).sort());
  for (const f of REAL) assert.equal(contracting(f.text), null, f.name);
});

test("migrations: a gap, a duplicate number, a bad name, a reordering, a vanished or changed file are refused", () => {
  const f = (name, text = ok) => ({ name, text });
  assert.throws(() => planMigrations([f("0001_a.sql"), f("0003_c.sql")], new Map()), /gap/);
  assert.throws(() => planMigrations([f("0001_a.sql"), f("0001_b.sql")], new Map()), /gap or a duplicate/);
  assert.throws(() => planMigrations([f("0001_A.sql")], new Map()), /NNNN_name\.sql/);
  // 0002 is applied, 0001 is new: a file inserted before an applied one
  assert.throws(() => planMigrations([f("0001_a.sql"), f("0002_b.sql")], new Map([["0002_b.sql", sha(ok)]])), /reordering/);
  assert.throws(() => planMigrations([f("0001_a.sql")], new Map([["0001_a.sql", sha(ok)], ["0002_b.sql", "x"]])), /no longer in db\/migrations/);
  assert.throws(() => planMigrations([f("0001_a.sql", `${ok} `)], new Map([["0001_a.sql", sha(ok)]])), /changed after it was applied/);
  assert.throws(() => planMigrations([f("0001_a.sql"), f("0002_b.sql", "alter table if exists rw.x drop column y;")], new Map([["0001_a.sql", sha(ok)]])), /contracts the schema/);
  assert.deepEqual(planMigrations([f("0001_a.sql"), f("0002_b.sql")], new Map([["0001_a.sql", sha(ok)]])).map((x) => x.name), ["0002_b.sql"]);
});
