#!/usr/bin/env node
// Is the vendored runward-fleet the code at the pinned commit? (ADR-0003 of this mission)
//   --offline : the tarball's sha256 and the lockfile's integrity are those the pin names.
//   (default) : also, every file in the tarball is byte for byte the file at that commit of
//               stranxik/runward, read from raw.githubusercontent.com; and no file of the package's
//               "files" at that commit is missing from the tarball.
// Exit 0 when it holds, 1 when it does not, 2 when it cannot tell (a cannot-tell is never a pass).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const lock = JSON.parse(readFileSync(join(root, "vendor/runward-fleet.lock.json"), "utf8"));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const fail = (m) => { console.error(`verify-runward-fleet: ${m}`); process.exit(1); };

const tgz = readFileSync(join(root, lock.tarball));
if (sha256(tgz) !== lock.tarballSha256) fail(`${lock.tarball} sha256 ${sha256(tgz)} is not the pinned ${lock.tarballSha256}`);
const integrity = `sha512-${createHash("sha512").update(tgz).digest("base64")}`;
if (integrity !== lock.integrity) fail("the tarball's sha512 is not the pinned integrity");
const plock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
if (plock.packages?.["node_modules/runward-fleet"]?.integrity !== lock.integrity) fail("package-lock.json does not pin the same integrity");
if (process.argv.includes("--offline")) { console.log(`verify-runward-fleet: tarball and lockfile pin ${lock.version} at ${lock.commit.slice(0, 12)} (offline)`); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), "rwf-"));
try {
  execFileSync("tar", ["-xzf", join(root, lock.tarball), "-C", dir]);
  const pkgDir = join(dir, "package");
  const walk = (d) => readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]));
  const files = walk(pkgDir).map((f) => relative(pkgDir, f)).sort();
  let checked = 0;
  for (const f of files) {
    const url = `https://raw.githubusercontent.com/stranxik/runward/${lock.commit}/${lock.path}/${f}`;
    const r = await fetch(url).catch(() => null);
    if (!r || !r.ok) { console.error(`verify-runward-fleet: cannot read ${f} at ${lock.commit} (${r?.status ?? "network"})`); process.exit(2); }
    const want = Buffer.from(await r.arrayBuffer());
    if (sha256(want) !== sha256(readFileSync(join(pkgDir, f)))) fail(`${f} in the tarball is not the file at ${lock.commit}`);
    checked++;
  }
  if (checked < 10) fail(`only ${checked} files checked: the guard would prove nothing`);
  console.log(`verify-runward-fleet: ${checked} files of ${lock.tarball} are the files of ${lock.path} at ${lock.commit}`);
} finally { rmSync(dir, { recursive: true, force: true }); }
