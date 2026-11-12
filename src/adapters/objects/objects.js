// The ExportStore, SecurityLog and Archive ports on one object store (architecture §2, §5).
// Keys are computed here from server values only, never received from a client (PADR-0013 point 4):
//   tenants/<uuid>/sha256/<digest>        the bytes received, addressed by content, written once
//   tenants/<uuid>/security/<ulid>.json   the security log, written before the database commits
//   tenants/<uuid>/archives/<uuid>.tar    a prepared export, kept 24 hours
//   health/witness                        one fixed object without data, written then read back by ping()
// Two adapters: a generic S3 client (aws4fetch: SigV4 on fetch, no hoster SDK) and an in-memory one.
import { AwsClient } from "aws4fetch";
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const need = (re, v, what) => { if (!re.test(String(v))) throw new TypeError(`object key: ${what} is malformed`); return v; };

/** The security log cannot be read whole: the code a caller refuses on. */
export const SECURITY_LOG_UNREADABLE = "security-log-unreadable";
const unreadable = (why) => Object.assign(new Error(`${SECURITY_LOG_UNREADABLE}: ${why}`), { code: SECURITY_LOG_UNREADABLE });

export const keys = {
  bytes: (t, sha) => `tenants/${need(UUID, t, "tenant")}/sha256/${need(HEX64, sha, "digest")}`,
  security: (t, id) => `tenants/${need(UUID, t, "tenant")}/security/${need(ULID, id, "ulid")}.json`,
  securityPrefix: (t) => `tenants/${need(UUID, t, "tenant")}/security/`,
  archive: (t, id) => `tenants/${need(UUID, t, "tenant")}/archives/${need(UUID, id, "archive")}.tar`,
};

function api(raw) {
  return {
    kind: raw.kind,
    async putBytes(tenant, sha256, bytes) {
      if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("object store: bytes do not match their digest");
      await raw.put(keys.bytes(tenant, sha256), bytes, "application/octet-stream");
    },
    getBytes: (tenant, sha256) => raw.get(keys.bytes(tenant, sha256)),
    removeBytes: (tenant, sha256) => raw.del(keys.bytes(tenant, sha256)),
    async writeSecurity(tenant, id, event) { await raw.put(keys.security(tenant, id), Buffer.from(`${JSON.stringify(event)}\n`), "application/json"); },
    async securitySince(tenant, afterUlid = "") {
      const list = await raw.list(keys.securityPrefix(tenant));
      const ids = list.map((k) => k.slice(keys.securityPrefix(tenant).length, -5)).filter((id) => ULID.test(id) && id > afterUlid).sort();
      const out = [];
      for (const id of ids) {
        // a listed object that cannot be read, or is not an event, is a refusal with a code, never a
        // TypeError on null: the caller must not replay a log it read in part (restore drill of 2026-11-10)
        const bytes = await raw.get(keys.security(tenant, id));
        let event = null;
        try { event = bytes === null ? null : JSON.parse(bytes.toString("utf8")); } catch { event = null; }
        if (event === null || typeof event !== "object" || Array.isArray(event)) throw unreadable(`object ${id} is listed and ${bytes === null ? "cannot be read" : "is not an event"}`);
        out.push({ id, event });
      }
      return out;
    },
    putArchive: (tenant, id, bytes) => raw.put(keys.archive(tenant, id), bytes, "application/x-tar"),
    getArchive: (tenant, id) => raw.get(keys.archive(tenant, id)),
    removeArchive: (tenant, id) => raw.del(keys.archive(tenant, id)),
    ping: (options) => raw.ping(options),
  };
}

export function memoryObjects() {
  const m = new Map();
  return Object.assign(api({
    kind: "memory",
    async put(k, b) { m.set(k, Buffer.from(b)); },
    async get(k) { return m.has(k) ? Buffer.from(m.get(k)) : null; },
    async del(k) { m.delete(k); },
    async list(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
    async ping() { return true; },
  }), { _map: m });
}

// ping(): the store is "ok" when an object written to the bucket is read back, byte for byte (finding of
// the restore drill, 2026-11-10: the ping was a HEAD on the bucket, taken for ok below 500; on a store whose
// bucket did not exist, writes were answered 200 and nothing could be read back, so the security log
// "written before the commit" was accepted and lost while /api/health said objectStore ok). One fixed key,
// a constant body without data; /api/health is public, so the verdict is kept PING_TTL_MS (a failure
// PING_RETRY_MS) and one check runs at a time: at most two calls to the store per period, whatever the traffic.
// The warm-up alone asks past the kept verdict (`fresh`), a bounded number of times, before any traffic.
export const WITNESS_KEY = "health/witness";
const WITNESS = Buffer.from("runward-hosted: the health witness, written then read back; it holds no data\n");
export const PING_TTL_MS = 30_000;
export const PING_RETRY_MS = 5_000;

/** S3 path-style on any compatible endpoint. `fetch` is the egress-bound fetch (system/egress.js). */
/** `onPingFault(why)`: told why a check of the witness failed (an error, or a sentence without data), for the log. */
export function s3Objects({ endpoint, region, bucket, accessKeyId, secretAccessKey, fetch, now = () => Date.now(), onPingFault = () => {} }) {
  let last = null; // { ok, at }
  let checking = null;
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region });
  const base = `${endpoint.replace(/\/$/, "")}/${bucket}`;
  const call = async (method, key, body, type, query = "") => {
    const req = await aws.sign(`${base}/${key}${query}`, { method, body, headers: type ? { "content-type": type } : {} });
    return fetch(req.url, { method, body, headers: Object.fromEntries(req.headers) });
  };
  return api({
    kind: "s3",
    async put(k, b, type) { const r = await call("PUT", k, b, type); if (!r.ok) throw new Error(`object store: PUT ${r.status}`); },
    async get(k) { const r = await call("GET", k); if (r.status === 404) return null; if (!r.ok) throw new Error(`object store: GET ${r.status}`); return Buffer.from(await r.arrayBuffer()); },
    async del(k) { const r = await call("DELETE", k); if (!r.ok && r.status !== 404) throw new Error(`object store: DELETE ${r.status}`); },
    async list(prefix) {
      const out = []; let token = null;
      do {
        const q = `?list-type=2&prefix=${encodeURIComponent(prefix)}${token ? `&continuation-token=${encodeURIComponent(token)}` : ""}`;
        const r = await call("GET", "", undefined, undefined, q.replace(/^\?/, "?"));
        if (!r.ok) throw new Error(`object store: LIST ${r.status}`);
        const xml = await r.text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) out.push(m[1].replace(/&amp;/g, "&"));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)</.exec(xml)?.[1] ?? null) : null;
      } while (token);
      return out;
    },
    // `fresh`: the store is asked now, whatever verdict is kept (the warm-up before the port is bound,
    // src/main.js#warm, which counts its own calls); a check already in flight is joined, never doubled.
    async ping({ fresh = false } = {}) {
      if (!fresh && last && now() - last.at < (last.ok ? PING_TTL_MS : PING_RETRY_MS)) return last.ok;
      checking ??= (async () => {
        const put = await call("PUT", WITNESS_KEY, WITNESS, "text/plain");
        if (!put.ok) { onPingFault(`witness PUT ${put.status}`); return false; }
        const got = await call("GET", WITNESS_KEY);
        if (!got.ok) { onPingFault(`witness GET ${got.status}`); return false; }
        const same = Buffer.from(await got.arrayBuffer()).equals(WITNESS);
        if (!same) onPingFault("witness read back differs");
        return same;
      })().then((ok) => ok, (e) => { onPingFault(e); return false; }).then((ok) => { last = { ok, at: now() }; checking = null; return ok; });
      return checking;
    },
  });
}
