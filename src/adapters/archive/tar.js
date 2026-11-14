// The Archive port's format: a POSIX ustar archive, written in memory, deterministic (fixed mtime,
// owner and mode), so the same content gives the same bytes. A name of at most 100 bytes is written as
// it is; a longer one is split at a "/" into ustar's prefix (155 bytes) and name (100 bytes), as POSIX
// says, so every path of an export fits: exports/<mission>/<kind>-<sha256>.json is at most 153 bytes
// (MISSION_ID 63, the longest kind 11). The witness reader's first run in production (2026-11-14) met a
// 105-byte path, exports/runward-demo-renaming/check-<sha256>.json, refused here whole: the export answered 503.
const BLOCK = 512;

/** [prefix, name] of a path: the name alone when it fits, else split at the last "/" that fits both fields. */
function split(path) {
  if (Buffer.byteLength(path) <= 100) return ["", path];
  for (let i = path.lastIndexOf("/"); i > 0; i = path.lastIndexOf("/", i - 1)) {
    const prefix = path.slice(0, i), name = path.slice(i + 1);
    if (Buffer.byteLength(name) > 100) break;
    if (name && Buffer.byteLength(prefix) <= 155) return [prefix, name];
  }
  throw new Error(`tar: name too long: ${path}`);
}

function header(path, size) {
  const h = Buffer.alloc(BLOCK, 0);
  const [prefix, name] = split(path);
  h.write(name, 0, "utf8");
  h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  h.write(`${(0).toString(8).padStart(11, "0")}\0`, 136);
  h.write("        ", 148); h.write("0", 156); h.write("ustar\0", 257); h.write("00", 263);
  if (prefix) h.write(prefix, 345, "utf8");
  let sum = 0; for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return h;
}

/** files: [{ name, bytes }] in the order given. */
export function tar(files) {
  const parts = [];
  for (const f of files) {
    const b = Buffer.isBuffer(f.bytes) ? f.bytes : Buffer.from(f.bytes);
    parts.push(header(f.name, b.length), b, Buffer.alloc((BLOCK - (b.length % BLOCK)) % BLOCK, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(parts);
}

/** Read back a ustar archive written by tar() (for tests and the replay script). */
export function untar(buf) {
  const out = [];
  for (let off = 0; off + BLOCK <= buf.length;) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((x) => x === 0)) break;
    const field = (from, to) => h.subarray(from, to).toString("utf8").replace(/\0.*$/s, "");
    const prefix = field(257, 262) === "ustar" ? field(345, 500) : "";
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = parseInt(h.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim(), 8);
    out.push({ name, bytes: Buffer.from(buf.subarray(off + BLOCK, off + BLOCK + size)) });
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}
