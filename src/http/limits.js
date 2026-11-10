// Limits on the public routes (review finding of 2026-11-08: none on /api/v0/auth/options, each call of
// which writes a challenge). A fixed window per minute, counted per client address and for the whole
// instance; the window state is per instance and is lost on a restart, which reopens at most one window
// (the service runs one instance, max_scale 1). The table of addresses is bounded: past `maxAddresses`
// in one window, new addresses share one counter, so a flood of addresses cannot grow memory.
export const PUBLIC_LIMITS = {
  writes: { perAddress: 30, global: 600 },
  reads: { perAddress: 120, global: 3000 },
};

export function rateLimiter({ perAddress, global, windowMs = 60_000, maxAddresses = 10_000, now = () => Date.now() }) {
  let window = -1, counts = new Map(), total = 0;
  return {
    take(address) {
      const t = now();
      const w = Math.floor(t / windowMs);
      if (w !== window) { window = w; counts = new Map(); total = 0; }
      const retryAfter = Math.max(1, Math.ceil(((w + 1) * windowMs - t) / 1000));
      if (total >= global) return { ok: false, scope: "global", retryAfter };
      const key = counts.has(address) || counts.size < maxAddresses ? address : "(overflow)";
      const n = counts.get(key) ?? 0;
      if (n >= perAddress) return { ok: false, scope: "address", retryAfter };
      counts.set(key, n + 1); total++;
      return { ok: true };
    },
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
