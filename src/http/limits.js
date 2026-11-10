// Rate limits (review findings of 2026-11-08: none on /api/v0/auth/options, each call of which writes a
// challenge; of 2026-11-10: none on the requests of the other routes that are not authenticated yet). A
// fixed window per minute, counted per client address and for the whole instance; the window state is per
// instance and is lost on a restart, which reopens at most one window (the service runs one instance,
// max_scale 1). The table of addresses is bounded: past `maxAddresses` in one window, new addresses share
// one counter, so a flood of addresses cannot grow memory.
//   writes, reads  the public routes, each call, before anything is read;
//   machine        the machine routes (an upload, the witness reader), each call, before its token's RSA
//                  signature is checked: none of them is authenticated before that check;
//   signedOut      the session cookies that resolved to no session (and the session routes called without
//                  a cookie); past the budget, a cookie is refused before the database is read for it.
export const RATE_LIMITS = {
  writes: { perAddress: 30, global: 600 },
  reads: { perAddress: 120, global: 3000 },
  machine: { perAddress: 60, global: 1200 },
  signedOut: { perAddress: 30, global: 600 },
};

export function rateLimiter({ perAddress, global, windowMs = 60_000, maxAddresses = 10_000, now = () => Date.now() }) {
  let window = -1, counts = new Map(), total = 0;
  /** Where `address` stands in this window, without counting it. */
  const look = (address) => {
    const t = now();
    const w = Math.floor(t / windowMs);
    if (w !== window) { window = w; counts = new Map(); total = 0; }
    const retryAfter = Math.max(1, Math.ceil(((w + 1) * windowMs - t) / 1000));
    const key = counts.has(address) || counts.size < maxAddresses ? address : "(overflow)";
    if (total >= global) return { ok: false, scope: "global", retryAfter, key };
    if ((counts.get(key) ?? 0) >= perAddress) return { ok: false, scope: "address", retryAfter, key };
    return { ok: true, key };
  };
  return {
    /** Count one call of `address`, or refuse it when its budget or the instance's is spent. */
    take(address) {
      const { key, ...v } = look(address);
      if (v.ok) { counts.set(key, (counts.get(key) ?? 0) + 1); total++; }
      return v;
    },
    /** Would a call of `address` be refused now? Nothing is counted. */
    peek(address) { const { key, ...v } = look(address); return v; },
    size: () => counts.size,
  };
}

/** The client address: the socket's peer, or, behind the hoster's proxies (trustProxy = the number of
 *  proxies in front of the service, each appending the address it received from), the entry of
 *  X-Forwarded-For that the outermost trusted proxy appended: the `trustProxy`-th from the end. The
 *  entries before it are the client's own claim and never choose a counter. */
export function clientAddress(req, trustProxy) {
  const hops = trustProxy === true ? 1 : Number(trustProxy) || 0;
  if (hops > 0) {
    const xff = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (xff.length >= hops) return xff[xff.length - hops];
  }
  return req.socket?.remoteAddress ?? "?";
}

/** The error rate of the last five minutes (checklist-pre-production-observability): requests and
 *  answers of status 500 or more, in one-minute buckets. Read by /api/health; the hourly probe raises
 *  the alert when the rate crosses ERROR_ALERT (scripts/probe-verdict.mjs). */
export const ERROR_ALERT = { minRequests: 20, rate: 0.05 };
export function errorWindow({ minutes = 5, now = () => Date.now() } = {}) {
  const buckets = new Map(); // minute → [requests, serverErrors]
  const prune = (m) => { for (const k of buckets.keys()) if (k <= m - minutes) buckets.delete(k); };
  return {
    record(status) {
      const m = Math.floor(now() / 60_000); prune(m);
      const b = buckets.get(m) ?? [0, 0]; b[0]++; if (status >= 500) b[1]++; buckets.set(m, b);
    },
    read() {
      prune(Math.floor(now() / 60_000));
      let requests = 0, serverErrors = 0;
      for (const [r, e] of buckets.values()) { requests += r; serverErrors += e; }
      return { windowSeconds: minutes * 60, requests, serverErrors, rate: requests ? Math.round((serverErrors / requests) * 10_000) / 10_000 : 0 };
    },
  };
}
