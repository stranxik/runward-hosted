#!/usr/bin/env node
// Apply the migrations, then the grants, as the migration role (rw_owner), never as the service.
// Usage: MIGRATE_URL=postgres://rw_owner@host/db node scripts/migrate.mjs
// Expansion only (PADR-0015 point 3): a migration that drops or renames is refused before it runs.
// Each file runs once, in a transaction, and is recorded with its sha256 in rw_meta.migration; a file
// whose content changed after it ran stops everything.
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("../db/migrations/", import.meta.url).pathname;
const GRANTS = new URL("../db/grants.sql", import.meta.url).pathname;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const CONTRACTING = /^\s*(drop\s+(table|column|schema|function|view|index|type)|alter\s+table\s+\S+\s+(rename|drop)|truncate)\b/im;

export async function migrate(url, { log = console.log } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: process.env.DATABASE_SSL === "disable" ? false : process.env.DATABASE_SSL ?? "prefer" });
  try {
    await sql`create schema if not exists rw_meta`;
    await sql`create table if not exists rw_meta.migration (name text primary key, sha256 text not null, applied_at timestamptz not null default now())`;
    const done = new Map((await sql`select name, sha256 from rw_meta.migration`).map((r) => [r.name, r.sha256]));
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
      const text = readFileSync(DIR + f, "utf8");
      if (done.has(f)) { if (done.get(f) !== sha(text)) throw new Error(`${f} changed after it was applied`); continue; }
      if (CONTRACTING.test(text.replace(/--[^\n]*/g, ""))) throw new Error(`${f} contracts the schema (drop, rename, truncate): refused, migrations are expansion only`);
      await sql.begin(async (q) => { await q.unsafe(text); await q`insert into rw_meta.migration (name, sha256) values (${f}, ${sha(text)})`; });
      log(`migrate: applied ${f}`);
    }
    await sql.unsafe(readFileSync(GRANTS, "utf8"));
    log("migrate: grants applied");
  } finally { await sql.end({ timeout: 5 }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.MIGRATE_URL) { console.error("MIGRATE_URL is required"); process.exit(2); }
  migrate(process.env.MIGRATE_URL).catch((e) => { console.error(`migrate: ${e.message}`); process.exit(1); });
}
