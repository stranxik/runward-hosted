// The Archive port's format: a POSIX ustar archive, written in memory, deterministic (fixed mtime,
// owner and mode), so the same content gives the same bytes. Names are at most 100 bytes (ours are).
const BLOCK = 512;

function header(name, size) {
  const h = Buffer.alloc(BLOCK, 0);
  if (Buffer.byteLength(name) > 100) throw new Error(`tar: name too long: ${name}`);
  h.write(name, 0, "utf8");
  h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  h.write(`${(0).toString(8).padStart(11, "0")}\0`, 136);
  h.write("        ", 148); h.write("0", 156); h.write("ustar\0", 257); h.write("00", 263);
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
    const name = h.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(h.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim(), 8);
    out.push({ name, bytes: Buffer.from(buf.subarray(off + BLOCK, off + BLOCK + size)) });
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}
