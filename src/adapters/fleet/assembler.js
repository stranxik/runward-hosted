// The IndexAssembler port: the anti-corruption layer (architecture §2). It turns what the service holds
// (declared missions, current uploads, their bytes) into a runward-fleet-manifest/0 inventory and a read
// function, calls the pinned runward-fleet library without a trust policy (nothing is raised, PADR-0011
// point 2), and lets back into the service only opaque bytes, their digests and the list of problems.
// The service never reads a field of the index: the browser does, through views.js.
//
// The bytes are those `runward-fleet build` writes (JSON.stringify(index, null, 2) and a line feed), the
// inventory is named fleet.json, and each export is at exports/<mission>/<kind>-<sha256>.json: an export
// of the tenant, with that fleet.json, rebuilds the same index on a clean machine (S1, PADR-0011 6 bis).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildIndex, BuildError, MANIFEST_FORMAT } from "runward-fleet";
import { checkIndex } from "runward-fleet/rules";
import { renderPage } from "runward-fleet/site";

// The package root: the directory above src/build.js, its "." export.
const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.resolve("runward-fleet"))));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** What is pinned (PADR-0011 point 6): version, the release archive's digest, the digest of views.js served. */
export function fleetPin({ lockFile }) {
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  const pkg = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
  if (pkg.version !== lock.version) throw new Error(`runward-fleet: installed ${pkg.version}, pinned ${lock.version}`);
  const views = readFileSync(join(PKG_DIR, "ui", "views.js"));
  return { version: pkg.version, commit: lock.commit, archiveSha256: lock.tarballSha256, viewsSha256: sha256(views), dir: PKG_DIR };
}

export const exportPath = (mission, kind, digest) => `exports/${mission}/${kind}-${digest}.json`;

export function fleetAssembler({ pin }) {
  return {
    pin,
    exportPath,
    /**
     * Assemble an index. `missions`: [{ id, name, repository ("owner/repo"), path, commit, uploads: { kind: sha256 } }].
     * `read(sha256)` returns the bytes kept for that digest. Returns { ok: true, index bytes and digests }
     * or { ok: false, refusal: "index-build-refused" | "index-rule-broken", field }.
     */
    assemble({ title, lang, asOf, missions, read }) {
      const doc = {
        format: MANIFEST_FORMAT,
        title,
        asOf,
        lang,
        missions: missions.map((m) => ({
          id: m.id,
          name: m.path && m.path !== "." ? `${m.repository} · ${m.path}` : m.repository,
          repository: `github.com/${m.repository}`,
          ...(m.path && m.path !== "." ? { path: m.path } : {}),
          ...(m.commit ? { commit: m.commit, commitSource: "the sha claim of the upload's workload identity token" } : {}),
          expects: ["check"],
          exports: Object.fromEntries(Object.entries(m.uploads).map(([kind, digest]) => [kind, { file: exportPath(m.id, kind, digest), producedBy: "runward check --strict --json (send.yml)" }])),
        })),
      };
      const manifest = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`);
      const files = new Map();
      for (const m of missions) for (const [kind, digest] of Object.entries(m.uploads)) files.set(exportPath(m.id, kind, digest), digest);
      let index;
      try {
        index = buildIndex({ manifest: { name: "fleet.json", bytes: manifest }, read: (p) => (files.has(p) ? read(files.get(p)) : null), version: pin.version });
      } catch (e) {
        if (e instanceof BuildError) return { ok: false, refusal: "index-build-refused", field: String(e.message).slice(0, 300) };
        throw e;
      }
      const problems = checkIndex(index);
      if (problems.length) return { ok: false, refusal: "index-rule-broken", field: problems[0].slice(0, 300) };
      try { renderPage(index); } catch (e) {
        if (e instanceof BuildError) return { ok: false, refusal: "index-rule-broken", field: String(e.message).split("\n")[1]?.trim().slice(0, 300) ?? "view rule" };
        throw e;
      }
      const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
      return { ok: true, bytes, sha256: sha256(bytes), manifest, manifestSha256: sha256(manifest) };
    },
  };
}
