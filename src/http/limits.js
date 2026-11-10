// Rate limits (review findings of 2026-11-08: none on /api/v0/auth/options, each call of which writes a
// challenge; of 2026-11-10: none on the requests of the other routes that are not authenticated yet). A
// fixed window per minute, counted per client address and for the whole instance; the window state is per
// instance and is lost on a restart, which reopens at most one window (the service runs one instance,
// max_scale 1). An address is counted under its key (addressKey): an IPv4 address as it is, an IPv6 address
// by its /64, the unit one subscriber is given, so one /64 is one caller and not 2^64 of them. The table
// of addresses is bounded, so a flood of addresses cannot grow memory: past `maxAddresses` in one window,
// the public routes' limiter (rateLimiter) counts the new addresses on one shared counter, and the budgets
// of failures (failureLimiter) do not: see below.
//   writes, reads  the public routes, each call, before anything is read (rateLimiter);
//   machine        the machine routes (an upload, the witness reader): each call is counted for its address
//                  before its token's RSA signature is checked, none of them being authenticated before
//                  that check; the instance's budget counts the calls whose token was refused (401);
//   signedOut      the session cookies that resolved to no session (and the session routes called without
//                  a cookie), for their address and for the instance; past its address's budget, a cookie
//                  is refused before the database is read for it.
// The instance's budget of the last two refuses only what failed (failureLimiter; review finding of
// 2026-11-10: once strangers had spent it, every cookie and every upload was refused, the valid ones
// included, public routes too). Once it is spent, an address that has failed in this window is refused,
// and an address that has not is still served: a valid session or a valid upload is never refused because
// of someone else's traffic. What a flood of addresses can then cost is one failure each, and the table of
// addresses is bounded. A session cookie that resolved a moment ago is not asked at all (recentlyValid),
// so a signed-in person is not refused either for the failures of whoever shares their address.
// Past the bound of the table, an address that is not in it is served untracked, at the cost of one lookup
// (code review of 2026-11-10, C11: the addresses past the bound shared one counter, spent after 30
// failures, so 10,030 dead cookies a minute, one per address, refused every valid session that came from
// an address not yet in the table, and 10,060 junk uploads every upload). Nothing is known against such an
// address, so nothing is held against it: the budgets of failures refuse an address for what it did, never
// for what the others did. What is given up is said: past 10,000 keys in one minute, a caller that is not
// in the table is no longer bounded by these two budgets (each of its calls still costs it a request, and
// costs the service one RSA check or one read), which a caller holding that many addresses already was
// not: 10,000 keys already buy 300,000 dead cookies or 600,000 junk uploads a minute.
export const RATE_LIMITS = {
  writes: { perAddress: 30, global: 600 },
  reads: { perAddress: 120, global: 3000 },
  machine: { perAddress: 60, global: 1200 },
  signedOut: { perAddress: 30, global: 600 },
};

/** The four hextets of an IPv6 address's /64 from its text, or null when the text is not one. */
function hextets(text) {
  let t = text;
  // a dotted quad at the end (::ffff:192.0.2.1) is two hextets
  const quad = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t);
  if (quad) {
    const b = quad.slice(2).map(Number);
    if (b.some((x) => x > 255)) return null;
    t = `${quad[1]}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = t.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [], tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!all.every((h) => /^[0-9a-f]{1,4}$/i.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}

/** The key an address is counted under: an IPv6 address by its /64 (`2001:db8:1:2::/64`), an IPv4 address
 *  as it is, and so is an IPv4 address written as IPv6 (`::ffff:192.0.2.1`, as a dual-stack socket names
 *  its peer): it is that IPv4 address, never one of a /64 every IPv4 caller would share. A zone (`%eth0`)
 *  and the brackets with a port (`[2001:db8::1]:443`) are not part of the address. What is not an IP
 *  address is its own key. */
export function addressKey(address) {
  const text = String(address);
  if (!text.includes(":")) return text;
  let bare = text;
  if (text.startsWith("[")) {
    const close = text.indexOf("]"), port = text.slice(close + 1);
    if (close < 0 || (port && !/^:\d+$/.test(port))) return text;
    bare = text.slice(1, close);
  }
  const h = hextets(bare.split("%")[0]);
  if (!h) return text;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
  return `${h.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

export function rateLimiter({ perAddress, global, windowMs = 60_000, maxAddresses = 10_000, now = () => Date.now() }) {
  let window = -1, counts = new Map(), total = 0;
  /** Where `address` stands in this window, without counting it. */
  const look = (from) => {
    const address = addressKey(from);
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

/** A budget of failures. `enter(address)` refuses an address that spent its own budget, or, once the
 *  instance's budget of failures is spent, an address that has failed in this window; otherwise it returns
 *  `settle(failed)`, to call once with what the call turned out to be. `everyCall`: the address's budget
 *  counts each of its calls (the machine routes); without it, its failures only (the session cookies),
 *  and the calls that entered and are not settled yet count as failures until they are (review finding of
 *  2026-11-10: the budget was looked at, the session awaited, the failure counted after, so a burst of
 *  dead cookies sent at once all passed before any was counted).
 *  The table holds `maxAddresses` keys a window. A key that is not in it once it is full is served and not
 *  tracked (`tracked: false`): its failure counts for the instance and against no one (C11, above). */
export function failureLimiter({ perAddress, global, everyCall = false, windowMs = 60_000, maxAddresses = 10_000, now = () => Date.now() }) {
  let window = -1, calls = new Map(), fails = new Map(), totalFails = 0, untracked = 0;
  const flying = new Map(); let totalFlying = 0; // entered, not settled yet: they outlive a window
  const roll = () => {
    const t = now();
    const w = Math.floor(t / windowMs);
    if (w !== window) { window = w; calls = new Map(); fails = new Map(); totalFails = 0; untracked = 0; }
    return Math.max(1, Math.ceil(((w + 1) * windowMs - t) / 1000));
  };
  /** Is `key` in the table, or is there room to put it there? */
  const holds = (key) => calls.has(key) || calls.size < maxAddresses;
  return {
    enter(address) {
      const retryAfter = roll();
      const key = addressKey(address);
      let settled = false;
      if (!holds(key)) {
        untracked++;
        return { ok: true, tracked: false, settle(didFail) { if (settled) return; settled = true; if (didFail) { roll(); totalFails++; } } };
      }
      const failed = fails.get(key) ?? 0;
      if ((everyCall ? calls.get(key) ?? 0 : failed + (flying.get(key) ?? 0)) >= perAddress) return { ok: false, scope: "address", retryAfter };
      if (totalFails + totalFlying >= global && failed > 0) return { ok: false, scope: "global", retryAfter };
      calls.set(key, (calls.get(key) ?? 0) + 1);
      if (!everyCall) { flying.set(key, (flying.get(key) ?? 0) + 1); totalFlying++; }
      return {
        ok: true,
        tracked: true,
        settle(didFail) {
          if (settled) return; settled = true;
          if (!everyCall) { const n = flying.get(key) - 1; if (n > 0) flying.set(key, n); else flying.delete(key); totalFlying--; }
          if (!didFail) return;
          roll();
          totalFails++;
          // the window may have turned while the call ran, and its table be full: the failure then counts
          // for the instance only
          if (!holds(key)) return;
          if (!calls.has(key)) calls.set(key, 0);
          fails.set(key, (fails.get(key) ?? 0) + 1);
        },
      };
    },
    size: () => calls.size,
    /** The calls of this window served without a place in the table. */
    untracked: () => { roll(); return untracked; },
  };
}

/** The session cookies (by their hash) that resolved to a session less than `ttlMs` ago. It exempts a
 *  cookie from the budget of failures, never from the read of its session: a closed session is still
 *  refused at once. Bounded: past `max` entries, the oldest go. */
export function recentlyValid({ ttlMs = 60_000, max = 10_000, now = () => Date.now() } = {}) {
  const until = new Map();
  return {
    has(hash) { const u = until.get(hash); if (u === undefined) return false; if (u > now()) return true; until.delete(hash); return false; },
    add(hash) {
      until.delete(hash); until.set(hash, now() + ttlMs);
      while (until.size > max) until.delete(until.keys().next().value);
    },
    drop(hash) { until.delete(hash); },
    size: () => until.size,
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
