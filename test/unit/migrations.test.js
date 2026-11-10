// Migrations are expansion only and run in a closed sequence (PADR-0015 point 3; review finding of
// 2026-11-08: the first guard missed `alter table if exists x drop column y` and a drop that did not
// begin a line, and refused neither a gap nor a reordering).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { contracting, planMigrations, statements, DYNAMIC_READ } from "../../scripts/migrate.mjs";

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

// Code review of 2026-11-10, C13: the guard reads the text, so a contraction assembled at run time inside
// a dollar-quoted body passed (`contracting() = null` on the first statement below). And, found while
// closing it: a body given as a quoted string was emptied by the lexer like any literal, so a plain drop
// inside `do '...'` passed too. What builds or hides a statement is refused as such.
test("migrations: a statement built at run time, and code given as a quoted string, are refused; a trigger's execute function and the execute privilege are not", () => {
  for (const sql of [
    "do $$ begin execute 'dr' || 'op table public.victim'; end $$;",
    "do $do$ declare q text := 'dr' || 'op table rw.ledger'; begin EXECUTE q; end $do$;",
    "create function rw.f(q text) returns void language plpgsql as $$ begin execute q; end $$;",
    "create function rw.f(q text) returns setof int language plpgsql as $$ begin return query execute q; end $$;",
    "do $$ begin execute format('%s table %I', 'dr' || 'op', 'ledger'); end $$;",
    // a variable named like the trigger's keyword does not pass for a trigger's clause
    "do $$ declare function text := 'dr' || 'op table rw.ledger'; begin execute function; end $$;",
    "do $$ begin execute function || ' table rw.ledger'; end $$;",
    "prepare p as select 1; execute p;",
  ]) assert.match(contracting(sql) ?? "", /^dynamic statement: /, `not refused: ${sql}`);
  for (const sql of [
    "do 'begin drop table public.victim; end';",
    "do language plpgsql 'begin drop table public.victim; end';",
    "do E'begin drop table public.victim; end';",
    "do/* */'begin drop table public.victim; end' language plpgsql;",
    "create function rw.f() returns void language plpgsql as 'begin drop table rw.ledger; end';",
    "create function rw.f() returns void as\n  'begin truncate rw.ledger; end' language plpgsql;",
    "create function rw.f() returns void language plpgsql as e'begin drop table rw.ledger; end';",
    "create function rw.f() returns void language plpgsql as U&'begin drop table rw.ledger; end';",
  ]) assert.match(contracting(sql) ?? "", /^code in a quoted string: /, `not refused: ${sql}`);
  // the control: what the server does not build at run time still passes
  for (const sql of [
    "create trigger t before insert on rw.x for each row execute function rw.f();",
    "create trigger t before insert on rw.x for each row execute procedure rw.f();",
    "grant execute on function rw.f() to rw_app;",
    "revoke execute on all functions in schema rw from public;",
    "do $$ begin perform 1; end $$;",
    "do language plpgsql $x$ begin perform 1; end $x$;",
    "create function rw.f() returns int language sql as $$ select 1 $$;",
    "create view rw.v as select '' as empty, cast('' as text) as t;",
    "create table rw.execute_log (id int); comment on table rw.execute_log is 'execute';",
  ]) assert.equal(contracting(sql), null, sql);
  assert.throws(() => planMigrations([{ name: "0001_a.sql", text: "do $$ begin execute 'dr' || 'op table public.victim'; end $$;" }], new Map()), /0001_a\.sql could contract the schema \(dynamic statement: /);
});

// Code review of 2026-11-10 (of d569c95), C13: the exemption for a trigger's `execute function f(` was
// read anywhere, a body included, where `function` and `procedure` may be a variable's or a parameter's
// name. Each of the four statements below gave `contracting() = null`, was planned, and dropped
// public.victim on PostgreSQL 17. The exemption now holds only in a statement that begins with create
// trigger, and never inside a dollar-quoted body.
test("C13: no `execute` passes inside a body, and a trigger's clause passes only in a create trigger statement (the four reproductions that dropped a table)", () => {
  const dropped = [
    "do $$ declare function text := 'dr'; begin execute function || ('op table public.victim'); end $$;",
    "do $$ declare procedure text := 'dr' || 'op table public.victim'; begin execute procedure || (''); end $$;",
    "create function public.g(function text) returns void language plpgsql as $$ begin execute function || (''); end $$; select public.g('drop table public.victim');",
    "do $$ declare function text := 'dr' || 'op table public.victim'; begin execute function ::text||(''); end $$;",
  ];
  for (const sql of dropped) {
    assert.match(contracting(sql) ?? "", /^dynamic statement: /, `not refused: ${sql}`);
    assert.throws(() => planMigrations([{ name: "0001_a.sql", text: sql }], new Map()), /0001_a\.sql could contract the schema \(dynamic statement: /, sql);
  }
  for (const sql of [
    // the clause's shape, where it is not a trigger's
    "do $$ begin execute function f(); end $$;",
    "do $body$ begin execute procedure rw.f('x'); end $body$;",
    "create function rw.f() returns void language plpgsql as $$ begin execute function rw.g(); end $$;",
    "prepare function as select 1; execute function (1);",
    "select 1; execute procedure rw.f();",
    // a trigger statement whose own text is fine does not cover what a body beside it holds
    "create trigger t before insert on rw.x for each row execute function rw.f($$ execute $$);",
    // inside a body, the privilege's shape is not let through either
    "do $$ begin execute on || ' table rw.ledger'; end $$;",
    // a second `execute` in a trigger statement, past its clause
    "create trigger t before insert on rw.x for each row execute function rw.f() execute q;",
  ]) assert.match(contracting(sql) ?? "", /^dynamic statement: /, `not refused: ${sql}`);
  // the control: a real trigger, in each form the server has, and the privilege
  for (const sql of [
    "create trigger t before insert on rw.x for each row execute function rw.f();",
    "CREATE TRIGGER t BEFORE INSERT ON rw.x FOR EACH ROW EXECUTE FUNCTION rw.f('a', 'b');",
    "create or replace trigger t after update on rw.x for each row when (old.a is distinct from new.a) execute function rw.f();",
    "create constraint trigger t after insert on rw.x deferrable initially deferred for each row execute procedure rw.f();",
    "create function rw.f() returns trigger language plpgsql as $$ begin return new; end $$; create trigger t before insert on rw.x for each row execute function rw.f();",
    "grant execute on function rw.f() to rw_app;",
    "alter default privileges in schema rw grant execute on functions to rw_app;",
  ]) assert.equal(contracting(sql), null, sql);
});

test("C13: a table moved to another schema is refused, a rename in effect", () => {
  for (const sql of [
    "alter table public.victim set schema attic;",
    "ALTER TABLE IF EXISTS rw.ledger\n  SET   SCHEMA attic;",
    "alter function rw.f() set schema attic;",
    "create function rw.f() returns void language plpgsql as $$ begin alter table rw.ledger set schema attic; end $$;",
  ]) {
    assert.match(contracting(sql) ?? "", /^set schema: /, `not refused: ${sql}`);
    assert.throws(() => planMigrations([{ name: "0001_a.sql", text: sql }], new Map()), /0001_a\.sql contracts the schema \(set schema: /);
  }
  // the control: a schema created, a search path set, a column named schema
  for (const sql of ["create schema attic;", "alter function rw.f() set search_path = pg_catalog, rw, pg_temp;", "create table rw.x (schema text, set_schema text);", "comment on table rw.x is 'set schema';"]) assert.equal(contracting(sql), null, sql);
});

test("migrations: the one file exempt from the dynamic-statement rule is exempt by the sha256 of its bytes, and only as committed", () => {
  const floor = REAL.find((f) => f.name === "0001_floor.sql");
  assert.match(floor.text, /\bexecute format\(/, "the control: 0001 builds statements at run time");
  assert.equal(contracting(floor.text), null, "as committed, it was read and is exempt");
  assert.match(contracting(`${floor.text}\n`), /^dynamic statement: /, "one byte more, and it is judged like any other file");
  // the exemption covers the dynamic statements only, never a contraction
  assert.deepEqual([...DYNAMIC_READ], [sha(floor.text)], "one exemption, and it is a committed file's");
  for (const f of REAL.filter((x) => x !== floor)) assert.equal(DYNAMIC_READ.has(sha(f.text)), false);
});

// Code review of 2026-11-10 (the second one, on 144211b), C30: ten statements passed the guard and
// contracted the schema on PostgreSQL 17.11. Inside a dollar-quoted body a comment was kept raw, so
// `drop/**/table` had no white space for a rule to match; a line comment that ended with `before` passed a
// `truncate` for a trigger's event; and a column written U&"c" kept its `U&` and passed the type rule.
test("C30: a comment glued to a keyword inside a body, a comment read as a trigger's event, and a U&\"...\" column are refused (the ten reproductions)", () => {
  const fn = (body, lang = "sql") => `create function public.f() returns void language ${lang} as $$ ${body} $$; select public.f();`;
  for (const [sql, kind] of [
    ["do $$ begin drop/**/table public.victim; end $$;", "drop"],
    ["do $$ begin drop--\n table public.victim; end $$;", "drop"],
    ["do $$ begin alter table public.victim drop/**/column c; end $$;", "drop"],
    [fn("drop/**/table public.victim"), "drop"],
    ["do $$ begin\n -- the rows we no longer think of\n truncate public.victim;\nend $$;", "truncate"],
    [fn("begin\n -- what was there before\n truncate public.victim;\nend", "plpgsql"), "truncate"],
    ["do $$ begin alter table public.victim set/**/schema attic; end $$;", "set schema"],
    ["do $$ begin alter table public.victim alter column c/**/type integer using 0; end $$;", "type change"],
    ["alter table public.victim alter U&\"c\" type integer using 0;", "type change"],
    ["alter table public.victim alter column U&\"\\0063\" set data type integer using 0;", "type change"],
  ]) {
    assert.match(contracting(sql) ?? "", new RegExp(`^${kind}: `), `not refused as ${kind}: ${sql}`);
    assert.throws(() => planMigrations([{ name: "0001_a.sql", text: sql }], new Map()), /0001_a\.sql contracts the schema/, sql);
  }
});

// The same class, found while fixing C30: each of these passed the three fixes above taken alone.
test("C30: the spellings next to the ten: a comment the other reading hides, a nested body, a name glued to its keyword, uescape, code handed to `do` or `as` inside a body", () => {
  for (const [sql, kind] of [
    // a literal that holds `--` hides the rest of the line from the reading that ignores literals
    ["do $$ begin perform '--'; alter table public.victim set/**/schema attic; end $$;", "set schema"],
    // a text in a literal of a body is refused as it was when spelled with a space (the safe side)
    ["do $$ begin perform set_config('rw.note', 'alter table public.victim set/**/schema attic', true); end $$;", "set schema"],
    // a body in a body
    ["do $$ begin create function public.g() returns void language sql as $g$ select '--'; alter table public.victim set/**/schema attic $g$; end $$;", "set schema"],
    ["do $$ begin create function public.g() returns void language sql as $g$ alter table public.victim alter c/**/type integer $g$; end $$;", "type change"],
    ["do $a$ begin create function public.g() returns void language sql as $b$ select 1 -- before\n truncate public.victim $b$; end $a$;", "truncate"],
    // a quoted name needs no white space around it
    ["alter table public.victim drop\"c\";", "drop"],
    ["alter table public.victim alter\"c\"type integer using 0;", "type change"],
    ["alter table public.victim alter column\"c\"set data type integer;", "type change"],
    ["alter table public.victim alter U&\"c\"type integer;", "type change"],
    // the escape character named after the name, a comment in between
    ["alter table public.victim alter U&\"!0063\" uescape '!' type integer using 0;", "type change"],
    ["alter table public.victim alter column U&\"!0063\"/* */UESCAPE/* */'!' set data type integer;", "type change"],
    // a truncate is an event only in the own text of a create trigger
    ["create trigger t after insert on rw.x for each row when ($$ before truncate $$ <> '') execute function rw.f();", "truncate"],
    ["create function rw.f() returns trigger language plpgsql as $$ begin /* fired before truncate */ return null; end $$;", "truncate"],
    ["select 1 -- or\n; truncate rw.x;", "truncate"],
  ]) assert.match(contracting(sql) ?? "", new RegExp(`^${kind}: `), `not refused as ${kind}: ${sql}`);
  // a body that hands a text to `do` or to `create function ... as`: the escape string spells the drop
  for (const sql of [
    "do $$ begin do E'begin dr\\157p table public.victim; end'; end $$;",
    "do $$ begin do language plpgsql E'begin dr\\157p table public.victim; end'; end $$;",
    "do $$ begin create function public.g() returns void language sql as E'dr\\157p table public.victim'; perform public.g(); end $$;",
    "do $a$ begin do $b$ begin null; end $b$; end $a$;",
  ]) {
    assert.match(contracting(sql) ?? "", /^code run from inside a body: /, `not refused: ${sql}`);
    assert.throws(() => planMigrations([{ name: "0001_a.sql", text: sql }], new Map()), /0001_a\.sql could contract the schema/, sql);
  }
  // a spelling the lexer will not claim to read is refused in a body as it is outside
  assert.match(contracting("do $$ begin perform 1$a$ x $a$; end $$;") ?? "", /^spelling: /);
});

test("C30: ordinary expansion still passes: a body with comments, a trigger on truncate, on conflict in a body, a U&\"...\" name that changes no type", () => {
  for (const sql of [
    "create function rw.f() returns trigger language plpgsql as $$\n-- sets the dates\nbegin /* nothing else */ new.at := now(); return new; end $$;",
    "create function rw.f() returns void language sql as $$ insert into rw.x (id) values (1) on conflict do nothing $$;",
    "create function rw.f() returns void language sql as $$ insert into rw.x (id) values (1) on conflict (id) do update set id = excluded.id $$;",
    "create function rw.f() returns int language sql as $$ select cast('1' as int) as n $$;",
    "create trigger t before truncate on rw.ledger for each statement execute function rw.f();",
    "create or replace trigger t before insert or truncate on rw.ledger for each statement execute function rw.f();",
    "create constraint trigger t after insert on rw.x deferrable for each row execute function rw.f();",
    "alter table rw.x add column U&\"c\" text;",
    "alter table rw.x add column \"type\" text, add column kind text;",
    "alter table rw.x alter column b drop not null, alter column b drop default;",
    "create table rw.y (id uuid primary key, dropped_at timestamptz, renamed boolean, truncated int);",
    "create index y_i on rw.y (id); grant select on rw.y to rw_app;",
    "create type rw.kind as enum ('a', 'b');",
    "create view rw.v as select id from rw.y;",
  ]) assert.equal(contracting(sql), null, sql);
  for (const f of REAL) assert.equal(contracting(f.text), null, f.name);
  assert.ok(REAL.length >= 5, "the committed migrations, the five of this review included");
});
