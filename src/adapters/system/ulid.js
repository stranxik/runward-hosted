// An identifier ordered in time (ULID): the key of the security log, independent of seq so that a seq
// that goes back after a restore never collides (PADR-0014 complement).
import { randomBytes } from "node:crypto";
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(nowMs) {
  let t = BigInt(nowMs), time = "";
  for (let i = 0; i < 10; i++) { time = B32[Number(t % 32n)] + time; t /= 32n; }
  const r = randomBytes(10); let bits = 0n;
  for (const b of r) bits = (bits << 8n) | BigInt(b);
  let rand = "";
  for (let i = 0; i < 16; i++) { rand = B32[Number(bits % 32n)] + rand; bits /= 32n; }
  return time + rand;
}
