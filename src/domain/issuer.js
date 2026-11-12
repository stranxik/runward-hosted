// A GitLab instance a tenant registers (ADR-0029 section 4), as pure rules: what an issuer's string may be,
// what a key must be, how many of each a tenant holds, and when a key no longer signs.
//
// The service never calls a registered instance: the member pastes the instance's key set, the service
// keeps the one key a CI token's header names. Whoever holds that key can sign any claim, so nothing here
// makes a registered instance more than the level P4 says (src/domain/forge.js).
import { createHash } from "node:crypto";
import { Refusal } from "./refusals/index.js";
import { DAY } from "./identity.js";
import { RESERVED_ISSUER_HOSTS } from "./forge.js";

export const MAX_LIVE_KEYS = 4;
export const MAX_REGISTRATIONS = 5;
/** A key expires 365 days after it was added, or confirmed again; the app warns 30 days before. */
export const KEY_LIFE = 365 * DAY;
export const KEY_WARNING = 30 * DAY;
export const MIN_MODULUS_BITS = 2048;
export const MAX_MODULUS_BITS = 4096;

const B64URL = /^[A-Za-z0-9_-]+$/;
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The bits of a modulus given in base64url, or 0 when it is not the canonical encoding of a positive integer. */
function modulusBits(n) {
  if (typeof n !== "string" || !B64URL.test(n)) return 0;
  const bytes = Buffer.from(n, "base64url");
  if (!bytes.length || bytes[0] === 0 || bytes.toString("base64url") !== n) return 0;
  return (bytes.length - 1) * 8 + (32 - Math.clz32(bytes[0]));
}

/** The RFC 7638 thumbprint of an RSA public key: sha-256 of its required members, in order, base64url. */
export function jwkThumbprint(jwk) {
  return createHash("sha256").update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })).digest("base64url");
}

/** Why a JSON Web Key is not one the service keeps or checks a signature with, or null (section 4, point 2). */
export function keyFault(jwk) {
  if (!isObject(jwk)) return "a key is a JSON object";
  if (jwk.kty !== "RSA") return "kty must be RSA";
  for (const m of PRIVATE_MEMBERS) if (m in jwk) return `a private or symmetric member is present (${m}): paste the public key set only`;
  const bits = modulusBits(jwk.n);
  if (bits < MIN_MODULUS_BITS || bits > MAX_MODULUS_BITS) return "the modulus must be 2048 to 4096 bits, in base64url";
  if (jwk.e !== "AQAB") return "the exponent must be 65537";
  if ("use" in jwk && jwk.use !== "sig") return "use must be absent or sig";
  if ("alg" in jwk && jwk.alg !== "RS256") return "alg must be absent or RS256";
  if (typeof jwk.kid !== "string" || !jwk.kid || jwk.kid.length > 200) return "kid must be a string";
  return null;
}

/** The public members a key is kept with, and nothing else of what was pasted. */
export const keptKey = (jwk) => ({ kty: "RSA", n: jwk.n, e: jwk.e, kid: jwk.kid });
export const keyBits = (jwk) => modulusBits(jwk.n);

/**
 * Read what a member pastes: the instance's key set (`{ keys: [...] }`, or one key) and the `kid` a CI
 * token's header names. Every key of the input must be one the service admits, with no `kid` twice, or the
 * whole input is refused; the key kept is the one named, and its `kid` must be its own RFC 7638
 * thumbprint, as GitLab makes it. Returns { jwk, kid, thumbprint, bits }.
 */
export function readKeyInput(input, kid) {
  const keys = isObject(input) && Array.isArray(input.keys) ? input.keys : isObject(input) ? [input] : null;
  if (!keys || !keys.length || keys.length > 16) throw new Refusal("key-malformed", { why: "paste the key set of the instance (its /oauth/discovery/keys)" });
  const seen = new Set();
  for (const k of keys) {
    const fault = keyFault(k);
    if (fault) throw new Refusal("key-malformed", { why: fault });
    if (seen.has(k.kid)) throw new Refusal("key-malformed", { why: "a kid is present twice" });
    seen.add(k.kid);
  }
  if (typeof kid !== "string" || !kid) throw new Refusal("key-malformed", { why: "name the kid of a CI token's header" });
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) throw new Refusal("key-malformed", { why: "no key of the set carries this kid" });
  const thumbprint = jwkThumbprint(jwk);
  if (jwk.kid !== thumbprint) throw new Refusal("key-malformed", { why: "the kid is not the key's RFC 7638 thumbprint" });
  return { jwk: keptKey(jwk), kid: jwk.kid, thumbprint, bits: modulusBits(jwk.n) };
}

/**
 * The parts of an issuer's string, read by its characters: scheme, host, port, path segments. Null when it
 * is not `http(s)://host[:port][/segment]*` with nothing else: no user info (an `@`), no query, no
 * fragment, no empty segment, no trailing slash.
 */
function splitIssuer(s) {
  const scheme = s.startsWith("https://") ? "https" : s.startsWith("http://") ? "http" : null;
  if (!scheme) return null;
  const [authority, ...path] = s.slice(scheme.length + 3).split("/");
  const [host, port, ...more] = authority.split(":");
  if (more.length || !/^[A-Za-z0-9.-]+$/.test(host) || (port !== undefined && !/^[0-9]{1,5}$/.test(port))) return null;
  if (path.some((x) => !/^[A-Za-z0-9._~-]+$/.test(x))) return null;
  return { scheme, host, port: port ?? null, path };
}

/**
 * The issuer's string, guarded at registration and only there (section 4): http or https, no user info,
 * no query, no fragment, an ASCII host; and a host that is, or is under, a public issuer's, Entra's or
 * the service's own is refused. Two readings must agree, the pattern below and the URL parser's, so that
 * no string one of them reads another way gets through. The string returned is the one given, unchanged:
 * it is compared with a token's `iss` by exact equality, never parsed again.
 */
export function readIssuer(input, { serviceHosts = [] } = {}) {
  const s = typeof input === "string" ? input : "";
  const malformed = (why) => new Refusal("issuer-malformed", { why });
  // every character printable ASCII: an internationalised name, a space or a control character is refused
  if (!s || s.length > 200 || !/^[\x21-\x7e]+$/.test(s)) throw malformed("the issuer is an address in ASCII, as the tokens' iss reads");
  const m = splitIssuer(s);
  if (!m) throw malformed("scheme http or https, a host, an optional port, an optional path; no user info, query, fragment or trailing slash");
  let parsed;
  try { parsed = new URL(s); } catch { throw malformed("not an address"); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw malformed("no user info, query or fragment");
  // no label is empty: a trailing dot, a leading one and two dots in a row are refused, never taken off
  // (`gitlab.com..` would otherwise read `gitlab.com.` once one dot is removed)
  const host = m.host.toLowerCase();
  if (host.split(".").some((l) => !l || l.startsWith("xn--") || l.startsWith("-") || l.endsWith("-"))) throw malformed("the host is not a plain ASCII name: no empty label, no trailing dot");
  if (parsed.hostname !== host) throw malformed("the host reads two ways");
  const reserved = [...RESERVED_ISSUER_HOSTS, ...serviceHosts.map((h) => String(h).toLowerCase().replace(/:\d+$/, ""))];
  if (reserved.some((r) => host === r || host.endsWith(`.${r}`))) throw new Refusal("issuer-not-allowed");
  return { issuer: s, host, port: m.port, authority: m.port ? `${host}:${m.port}` : host };
}

/** A key's state now: `live`, `retired` (by a gesture) or `expired` (365 days without a confirmation). */
export function keyState(k, nowMs) {
  if (k.retiredAt) return "retired";
  return nowMs - (k.confirmedAt ?? k.addedAt) >= KEY_LIFE ? "expired" : "live";
}
export const keyExpiresAt = (k) => (k.confirmedAt ?? k.addedAt) + KEY_LIFE;
export const keyWarned = (k, nowMs) => keyState(k, nowMs) === "live" && keyExpiresAt(k) - nowMs <= KEY_WARNING;

/** May one more key be added to this registration? At most four live keys; a `kid` is kept once. */
export function checkKeyAddable(keys, kid, nowMs) {
  const same = keys.find((k) => k.kid === kid);
  if (same && same.retiredAt) throw new Refusal("key-exists", { why: "retired" });
  if (!same && keys.filter((k) => keyState(k, nowMs) === "live").length >= MAX_LIVE_KEYS) throw new Refusal("key-limit");
  return same ?? null;
}

/** May one more instance be registered by this tenant? At most five, removed ones apart. */
export function checkRegistrable(issuers) {
  if (issuers.filter((i) => !i.removedAt).length >= MAX_REGISTRATIONS) throw new Refusal("issuer-limit");
}

/** The address a registered repository is named by in the index: host[:port]/full/path (section 1). */
export function indexNameOf(issuerString, path) {
  const m = splitIssuer(issuerString);
  if (!m) throw new TypeError("indexNameOf: not a registered issuer's string");
  const host = m.host.toLowerCase();
  return `${m.port ? `${host}:${m.port}` : host}/${path}`;
}
