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

test("migrations: a contracting statement is refused wherever it sits, in any spelling", () => {
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
