#!/usr/bin/env node
// Is the vendored runward-fleet the code at the pinned commit? (ADR-0003, ADR-0021 of this mission)
//
// Both modes check, from the bytes of the tarball itself (it is never extracted):
//   1. its sha256 and its sha512 are those of vendor/runward-fleet.lock.json, and package-lock.json pins
//      the same integrity;
//   2. every entry is a regular file under package/: an entry under another root, a link (symbolic or
//      hard), a directory, an extended header, a name with an empty, "." or ".." segment, and a name met
//      twice (compared without case) are each refused. npm installs an archive by dropping the first
//      segment of every name, whatever it is: a second root would land over the package's own files;
//   3. the names and the sha256 of the files are exactly the lock's "files": none more, none fewer.
//
// The default mode also checks, against stranxik/runward at the lock's commit:
//   4. the lock's "files" are the names npm packs there: "files" of <path>/package.json, read from
//      raw.githubusercontent.com, applied to the tree of the commit (the GitHub API, or `git fetch` of
//      that commit when the API does not answer), with package.json, README, LICENSE and the "bin" and
//      "main" files npm always adds. A file of that list missing from the tarball, or a file of the
//      tarball outside it, is refused. A shape this reading does not cover (a pattern in "files", an
//      ignore file, a link or a submodule in the tree, bundled dependencies) is a cannot-tell;
//   5. every file is byte for byte the file at that commit, read from raw.githubusercontent.com;
//   6. at least ten files were compared.
//
// --offline stops after 3. It does NOT check that the lock's "files" are the files at the commit (4, 5):
// a lock and a tarball changed together pass it. It is the check a workstation runs; CI runs the default.
// Neither mode reads node_modules: the service compares what is installed with the lock when it starts
// (fleetPin in src/adapters/fleet/assembler.js).
//
// Exit 0 when it holds, 1 when it does not, 2 when it cannot tell (a cannot-tell is never a pass).
// --files <tarball> checks nothing: it prints the "files" object a lock pins for that pack, after point 2.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const BLOCK = 512;
const FLOOR = 10;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const text = (b) => b.toString("utf8").replace(/\0.*$/s, "");
const KINDS = { 1: "hard link", 2: "symbolic link", 3: "character device", 4: "block device", 5: "directory", 6: "fifo", 7: "contiguous file", x: "extended header", g: "global extended header", L: "long-name header", K: "long-link header" };

/** Every entry of a tar archive, as written: { name, type, linkname, bytes }. Throws on a block it cannot read. */
export function tarEntries(buf) {
  const out = [];
  let off = 0;
  for (; off + BLOCK <= buf.length;) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((x) => x === 0)) break;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (parseInt(text(h.subarray(148, 156)).trim(), 8) !== sum) throw new Error(`the header at byte ${off} does not carry its checksum`);
    const sizeField = text(h.subarray(124, 136)).trim();
    if (!/^[0-7]+$/.test(sizeField)) throw new Error(`the header at byte ${off} carries a size that is not octal`);
    const size = parseInt(sizeField, 8);
    const prefix = text(h.subarray(345, 500));
    const name = `${prefix ? `${prefix}/` : ""}${text(h.subarray(0, 100))}`;
    const type = h[156] === 0 ? "0" : String.fromCharCode(h[156]);
    if (off + BLOCK + size > buf.length) throw new Error(`${name} is cut short`);
    out.push({ name, type, linkname: text(h.subarray(157, 257)), bytes: buf.subarray(off + BLOCK, off + BLOCK + size) });
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (!buf.subarray(off).every((x) => x === 0)) throw new Error("there is data after the end of the archive");
  return out;
}

/** Points 2: the files of the package, as npm would write them, or the reasons this archive is refused. */
export function packageFiles(tgz) {
  let entries;
  try { entries = tarEntries(gunzipSync(tgz)); } catch (e) { return { files: new Map(), problems: [`the tarball cannot be read: ${e.message}`] }; }
  const files = new Map();
  const seen = new Set();
  const problems = [];
  for (const e of entries) {
    if (e.type !== "0") { problems.push(`${e.name} is not a regular file (${KINDS[e.type] ?? `type ${JSON.stringify(e.type)}`}${e.linkname ? ` to ${e.linkname}` : ""})`); continue; }
    const parts = e.name.split("/");
    if (e.name.includes("\\") || parts.some((p) => p === "" || p === "." || p === "..")) { problems.push(`${JSON.stringify(e.name)} is not a plain relative name`); continue; }
    if (parts[0] !== "package" || parts.length < 2) { problems.push(`${e.name} is outside package/: npm would install it as ${parts.slice(1).join("/") || "nothing"}`); continue; }
    const rel = parts.slice(1).join("/");
    if (seen.has(rel.toLowerCase())) { problems.push(`${e.name} is in the archive twice`); continue; }
    seen.add(rel.toLowerCase());
    files.set(rel, e.bytes);
  }
  return { files, problems };
}

const ALWAYS = /^(package\.json|readme(\.[^/]*)?|licen[cs]e(\.[^/]*)?)$/i;
const NPM_DROPS = /(^|\/)(\.git|\.svn|\.hg|CVS|node_modules|\.DS_Store|\.npmrc|\.lock-wscript|npm-debug\.log|\.wafpickle-[^/]*|\._[^/]*|\.[^/]*\.swp|[^/]*\.orig|config\.gypi)(\/|$)/;

/**
 * Point 4: the names npm packs from `tree` ([{ path, mode }], relative to the package) under `pkg`
 * (its package.json). Returns { names } or { cannotTell }.
 */
export function packList(pkg, tree) {
  if (!Array.isArray(pkg.files)) return { cannotTell: 'package.json at the commit has no "files"' };
  if (pkg.bundleDependencies || pkg.bundledDependencies) return { cannotTell: "the package bundles dependencies" };
  const odd = tree.find((t) => t.mode !== "100644" && t.mode !== "100755");
  if (odd) return { cannotTell: `${odd.path} at the commit is not a regular file (mode ${odd.mode})` };
  const ignore = tree.find((t) => /(^|\/)\.(npmignore|gitignore)$/.test(t.path));
  if (ignore) return { cannotTell: `${ignore.path} at the commit changes what npm packs` };
  const roots = [];
  for (const f of pkg.files) {
    if (typeof f !== "string" || /[*?[\]{}!]/.test(f)) return { cannotTell: `"files" carries ${JSON.stringify(f)}, a pattern this check does not read` };
    roots.push(f.replace(/^\.?\//, "").replace(/\/+$/, ""));
  }
  const fixed = new Set([pkg.main, ...Object.values(typeof pkg.bin === "string" ? { bin: pkg.bin } : pkg.bin ?? {})].filter(Boolean).map((p) => String(p).replace(/^\.\//, "")));
  const names = tree.map((t) => t.path).filter((p) => (!p.includes("/") && ALWAYS.test(p)) || fixed.has(p) || roots.some((r) => p === r || p.startsWith(`${r}/`)));
  const dropped = names.find((p) => NPM_DROPS.test(p) || p === "package-lock.json");
  if (dropped) return { cannotTell: `${dropped} at the commit is a name npm leaves out of a pack` };
  return { names: names.sort() };
}

/**
 * The whole check. `remote` gives the commit: file(rel) the bytes of a file of the package or null,
 * tree() the [{ path, mode }] of the package or null. Returns { exit, message }.
 */
export async function verify({ lock, tgz, packageLock, offline = false, remote = null }) {
  const no = (message) => ({ exit: 1, message });
  const unknown = (message) => ({ exit: 2, message });
  if (sha256(tgz) !== lock.tarballSha256) return no(`${lock.tarball} sha256 ${sha256(tgz)} is not the pinned ${lock.tarballSha256}`);
  if (`sha512-${createHash("sha512").update(tgz).digest("base64")}` !== lock.integrity) return no("the tarball's sha512 is not the pinned integrity");
  if (packageLock.packages?.["node_modules/runward-fleet"]?.integrity !== lock.integrity) return no("package-lock.json does not pin the same integrity");
  const { files, problems } = packageFiles(tgz);
  if (problems.length) return no(`${lock.tarball} is not a pack npm installs as its files alone:\n  ${problems.join("\n  ")}`);
  const pinned = lock.files;
  if (!pinned || typeof pinned !== "object" || Array.isArray(pinned)) return no('the lock pins no "files"');
  const have = [...files.keys()].sort();
  const want = Object.keys(pinned).sort();
  const extra = have.filter((f) => !want.includes(f));
  const missing = want.filter((f) => !have.includes(f));
  if (extra.length || missing.length) return no(`the tarball's files are not the lock's "files"${extra.length ? `; in the tarball only: ${extra.join(", ")}` : ""}${missing.length ? `; in the lock only: ${missing.join(", ")}` : ""}`);
  for (const f of have) if (sha256(files.get(f)) !== pinned[f]) return no(`${f} in the tarball is not the file the lock pins`);
  if (offline) return { exit: 0, message: `tarball, lockfile and the ${have.length} pinned files agree for ${lock.version} at ${lock.commit.slice(0, 12)} (offline: the files are NOT compared with the commit)` };

  const manifest = await remote.file("package.json");
  if (!manifest) return unknown(`cannot read package.json at ${lock.commit}`);
  let pkg;
  try { pkg = JSON.parse(manifest.toString("utf8")); } catch { return unknown(`package.json at ${lock.commit} is not JSON`); }
  const tree = await remote.tree();
  if (!tree) return unknown(`cannot list ${lock.path} at ${lock.commit}`);
  const list = packList(pkg, tree);
  if (list.cannotTell) return unknown(list.cannotTell);
  const absent = list.names.filter((f) => !have.includes(f));
  const foreign = have.filter((f) => !list.names.includes(f));
  if (absent.length || foreign.length) return no(`the tarball is not the pack of ${lock.path} at ${lock.commit}${absent.length ? `; packed there and missing here: ${absent.join(", ")}` : ""}${foreign.length ? `; here and not packed there: ${foreign.join(", ")}` : ""}`);
  let checked = 0;
  for (const f of have) {
    const at = f === "package.json" ? manifest : await remote.file(f);
    if (!at) return unknown(`cannot read ${f} at ${lock.commit}`);
    if (sha256(at) !== sha256(files.get(f))) return no(`${f} in the tarball is not the file at ${lock.commit}`);
    checked++;
  }
  if (checked < FLOOR) return no(`only ${checked} files checked: the guard would prove nothing`);
  return { exit: 0, message: `the ${checked} files of ${lock.tarball} are the files npm packs from ${lock.path} at ${lock.commit}, byte for byte, and nothing else is in it` };
}

/** The commit, read from GitHub: raw files, and the tree by the API or, failing that, by git. */
function github(lock, env) {
  const slug = new URL(lock.repository).pathname.replace(/^\/|\/$/g, "");
  const key = env.GH_TOKEN || env.GITHUB_TOKEN;
  const under = `${lock.path}/`;
  const inPackage = (rows) => rows.filter((r) => r.path.startsWith(under)).map((r) => ({ path: r.path.slice(under.length), mode: r.mode }));
  return {
    async file(rel) {
      const r = await fetch(`https://raw.githubusercontent.com/${slug}/${lock.commit}/${under}${rel}`).catch(() => null);
      return r && r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    },
    async tree() {
      const r = await fetch(`https://api.github.com/repos/${slug}/git/trees/${lock.commit}?recursive=1`, { headers: { accept: "application/vnd.github+json", "user-agent": "verify-runward-fleet", ...(key ? { authorization: `Bearer ${key}` } : {}) } }).catch(() => null);
      if (r && r.ok) {
        const body = await r.json();
        if (body.truncated !== true && Array.isArray(body.tree)) return inPackage(body.tree.filter((t) => t.type !== "tree"));
      }
      const dir = mkdtempSync(join(tmpdir(), "rwf-"));
      try {
        const git = (...args) => execFileSync("git", ["-C", dir, "-c", "credential.helper=", ...args], { stdio: ["ignore", "pipe", "ignore"], env: { ...env, GIT_TERMINAL_PROMPT: "0" } }).toString("utf8");
        git("init", "-q");
        git("fetch", "-q", "--depth", "1", "--filter=blob:none", `https://github.com/${slug}`, lock.commit);
        if (git("rev-parse", "FETCH_HEAD").trim() !== lock.commit) return null;
        return inPackage(git("ls-tree", "-r", "FETCH_HEAD", "--", lock.path).split("\n").filter(Boolean).map((l) => ({ mode: l.split(/\s+/)[0], path: l.slice(l.indexOf("\t") + 1) })));
      } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL("..", import.meta.url).pathname;
  // --files <tarball>: print the "files" a lock pins for that pack (a re-pin, runbook section 6); it proves nothing.
  const listed = process.argv.indexOf("--files");
  if (listed > 0) {
    const { files, problems } = packageFiles(readFileSync(process.argv[listed + 1]));
    if (problems.length) { console.error(`verify-runward-fleet: ${problems.join("\n  ")}`); process.exit(1); }
    console.log(JSON.stringify(Object.fromEntries([...files.keys()].sort().map((f) => [f, sha256(files.get(f))])), null, 2));
    process.exit(0);
  }
  const lock = JSON.parse(readFileSync(join(root, "vendor/runward-fleet.lock.json"), "utf8"));
  const r = await verify({
    lock, tgz: readFileSync(join(root, lock.tarball)), packageLock: JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")),
    offline: process.argv.includes("--offline"), remote: github(lock, process.env),
  });
  (r.exit ? console.error : console.log)(`verify-runward-fleet: ${r.message}`);
  process.exit(r.exit);
}
