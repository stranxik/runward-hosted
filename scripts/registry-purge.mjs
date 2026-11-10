#!/usr/bin/env node
// The registry keeps the 5 most recent images (ADR-0016; runbook §7): after a green deploy, the tags of
// runward-hosted beyond the 5 newest are deleted, EXCEPT any tag whose digest is still named by a
// container (the service, the operator's gateway) or by the rollback target. Run by deploy.yml.
//   SCW_SECRET_KEY=... node scripts/registry-purge.mjs --keep 5 --protect <ref>[,<ref>...]
// A digest that cannot be read, or an API answer that is not understood, stops the purge (it deletes
// nothing rather than guess).
const API = `https://api.scaleway.com/registry/v1/regions/${process.env.REGION ?? "fr-par"}`;
const DIGEST = /sha256:[0-9a-f]{64}/;

/** The tags to delete: the newest `keep` stay, and so does every tag whose digest is protected. */
export function toPurge(tags, { keep = 5, protect = [] } = {}) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error("keep must be at least 1");
  const guarded = new Set(protect.map((p) => { const m = DIGEST.exec(p ?? ""); if (!m) throw new Error(`not a digest reference: ${p}`); return m[0]; }));
  const newest = [...tags].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const t of newest) if (!DIGEST.test(t.digest ?? "") || Number.isNaN(Date.parse(t.created_at))) throw new Error(`tag ${t.name} has no readable digest or date`);
  return newest.slice(keep).filter((t) => !guarded.has(DIGEST.exec(t.digest)[0]));
}

async function api(path, init = {}) {
  const r = await fetch(API + path, { ...init, headers: { "X-Auth-Token": process.env.SCW_SECRET_KEY, ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path.split("?")[0]}: HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
}

async function main(argv) {
  const opt = (k) => { const i = argv.indexOf(k); return i === -1 ? null : argv[i + 1]; };
  const keep = Number(opt("--keep") ?? 5);
  const protect = (opt("--protect") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!process.env.SCW_SECRET_KEY) throw new Error("SCW_SECRET_KEY is required");
  if (!protect.length) throw new Error("--protect names at least the digest being served");
  const { images } = await api(`/images?name=${encodeURIComponent(opt("--image") ?? "runward-hosted")}&page_size=100`);
  const image = (images ?? []).find((i) => i.name === (opt("--image") ?? "runward-hosted"));
  if (!image) throw new Error("image runward-hosted not found in the registry");
  const tags = [];
  for (let page = 1; ; page++) {
    const { tags: some, total_count: total } = await api(`/images/${image.id}/tags?order_by=created_at_desc&page_size=100&page=${page}`);
    tags.push(...some);
    if (!some.length || tags.length >= total) break;
  }
  const doomed = toPurge(tags, { keep, protect });
  for (const t of doomed) await api(`/tags/${t.id}`, { method: "DELETE" });
  console.log(`registry-purge: ${tags.length} tags, kept ${tags.length - doomed.length}, deleted ${doomed.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(`registry-purge: ${e.message}`); process.exit(1); });
