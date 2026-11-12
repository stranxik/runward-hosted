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
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { buildIndex, BuildError, MANIFEST_FORMAT } from "runward-fleet";
import { checkIndex } from "runward-fleet/rules";
import { renderPage } from "runward-fleet/site";

// The package root: the directory above src/build.js, its "." export.
const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.resolve("runward-fleet"))));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** The files under `dir`, by relative name, with their sha256; anything that is not a file or a directory is named. */
function installedFiles(dir) {
  const files = new Map();
  const odd = [];
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const rel = relative(dir, join(e.parentPath, e.name)).split(sep).join("/");
    if (e.isDirectory()) continue;
    if (e.isFile()) files.set(rel, sha256(readFileSync(join(dir, rel))));
    else odd.push(rel);
  }
  return { files, odd };
}

/**
 * What is pinned (PADR-0011 point 6): version, the release archive's digest, the digest of views.js served.
 * The archive digest is written on every published index and names the build that replays it (ADR-0021),
 * so it is returned only when what is installed IS that archive, and the service does not start otherwise:
 * the integrity npm recorded at install (node_modules/.package-lock.json) is the lock's, and the installed
 * files are the lock's "files", name for name and digest for digest. The version alone names four archives.
 */
export function fleetPin({ lockFile, pkgDir = PKG_DIR }) {
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  if (pkg.version !== lock.version) throw new Error(`runward-fleet: installed ${pkg.version}, pinned ${lock.version}`);
  const refuse = (why) => new Error(`runward-fleet: the installed package is not the pinned archive ${String(lock.tarballSha256).slice(0, 12)}: ${why}. Nothing is served or published with it; install again with npm ci`);
  let recorded = null;
  try { recorded = JSON.parse(readFileSync(join(dirname(pkgDir), ".package-lock.json"), "utf8")).packages?.["node_modules/runward-fleet"]?.integrity ?? null; } catch { recorded = null; }
  if (typeof lock.integrity !== "string" || recorded !== lock.integrity) throw refuse(recorded ? `npm installed an archive of integrity ${recorded}, the lock pins ${lock.integrity}` : "npm recorded no integrity for it in node_modules/.package-lock.json");
  const pinned = lock.files;
  if (!pinned || typeof pinned !== "object" || !Object.keys(pinned).length) throw refuse('the lock pins no "files"');
  const { files, odd } = installedFiles(pkgDir);
  if (odd.length) throw refuse(`${odd[0]} is neither a file nor a directory`);
  const extra = [...files.keys()].filter((f) => !Object.hasOwn(pinned, f));
  const missing = Object.keys(pinned).filter((f) => !files.has(f));
  const changed = [...files.keys()].filter((f) => Object.hasOwn(pinned, f) && files.get(f) !== pinned[f]);
  if (extra.length || missing.length || changed.length) throw refuse([changed.length ? `changed: ${changed.join(", ")}` : "", missing.length ? `missing: ${missing.join(", ")}` : "", extra.length ? `not of the archive: ${extra.join(", ")}` : ""].filter(Boolean).join("; "));
  const views = readFileSync(join(pkgDir, "ui", "views.js"));
  return { version: pkg.version, commit: lock.commit, archiveSha256: lock.tarballSha256, viewsSha256: sha256(views), dir: pkgDir };
}

export const exportPath = (mission, kind, digest) => `exports/${mission}/${kind}-${digest}.json`;

export function fleetAssembler({ pin }) {
  return {
    pin,
    exportPath,
    /**
     * Can the pinned runward-fleet carry this repository name (`host[:port]/full/path`)? Asked of the
     * library itself, on an inventory of one silent mission, so that the answer moves with the pin: a name
     * it refuses is refused at declaration, never truncated (ADR-0029 section 1).
     */
    admits(repository) {
      const doc = { format: MANIFEST_FORMAT, title: "probe", asOf: "2026-01-01 00:00 UTC", lang: "en", missions: [{ id: "probe", name: "probe", repository, expects: ["check"], exports: {} }] };
      try { buildIndex({ manifest: { name: "fleet.json", bytes: Buffer.from(`${JSON.stringify(doc, null, 2)}\n`) }, read: () => null, version: pin.version }); return true; } catch (e) {
        if (e instanceof BuildError) return false;
        throw e;
      }
    },
    /**
     * Assemble an index. `missions`: [{ id, name, repository ("owner/repo", or a GitLab project's full path), host (the forge's
     * host, "github.com" when absent), forge, path, commit, uploads: { kind: sha256 },
     * received: { kind: label } }]. `received` is the date the service accepted each upload, written as the export's
     * `at` label: the decision reading of runward-fleet says it as the date of the last check received (runward's
     * ADR-0125, docs/spec/runward-fleet-decision.md §8); a mission with no label for a kind writes none.
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
          repository: `${m.host ?? "github.com"}/${m.repository}`,
          ...(m.path && m.path !== "." ? { path: m.path } : {}),
          ...(m.commit ? { commit: m.commit, commitSource: "the sha claim of the upload's workload identity token" } : {}),
          expects: ["check"],
          exports: Object.fromEntries(Object.entries(m.uploads).map(([kind, digest]) => [kind, { file: exportPath(m.id, kind, digest), producedBy: m.forge === "gitlab" ? "runward check --strict --json (the repository's GitLab pipeline)" : "runward check --strict --json (send.yml)", ...(m.received?.[kind] ? { at: m.received[kind] } : {}) }])),
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
