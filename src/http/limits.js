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
// Past the bound of the table, an address that is not in it is never refused for what the others did
// (code review of 2026-11-10, C11: the addresses past the bound shared one counter, spent after 30
// failures, so 10,030 dead cookies a minute, one per address, refused every valid session that came from
// an address not yet in the table, and 10,060 junk uploads every upload). It is not left unbounded either
// (same review, C14: past the bound the two budgets were off for every key not in the table, and 10,000
// /64s, which fit in one IPv6 /48, filled it with one cheap call each). Two things, one level up:
//   - one prefix (an IPv6 /48, an IPv4 /24: prefixKey) holds at most `maxPerPrefix` keys of the table
//     (256, a whole /24), so a single /48 cannot fill it: 40 prefixes are needed;
//   - a key that has no place in the table, because its prefix holds its share or because the table is
//     full, is counted with its prefix, on a larger allowance (`perPrefix`, eight times the address's by
//     default). It can be refused for what the keys of its own /48 or /24 that had no place did, never for
//     what another prefix did; an address that has its place is never judged on its prefix.
// The table of prefixes is bounded like the table of addresses. Only past it (keys without a place from
// more prefixes than it holds in one window) is a call served untracked, and that state is no longer
// silent: the limiter says so once a window (onUntracked, a log line without an address), and keeps the
// counts of the last OVERFLOW_HISTORY_MINUTES for /api/health, where the hourly probe alerts on them.
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

/** The prefix a key (addressKey) is counted with when it has no place of its own: the /48 of an IPv6 /64,
 *  the /24 of an IPv4 address. What is not an IP address shares one prefix. */
export function prefixKey(key) {
  const v6 = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/.exec(key);
  if (v6) return `${v6[1]}:${v6[2]}:${v6[3]}::/48`;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(key);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  return "(not an address)";
}

/** How long a limiter remembers that calls were counted with their prefix or served untracked: two probes
 *  an hour apart both see it, and two failed probes in a row open the issue (probe.yml). */
export const OVERFLOW_HISTORY_MINUTES = 130;

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
 *  The table holds `maxAddresses` keys a window, at most `maxPerPrefix` of them from one prefix. A key
 *  without a place is counted with its prefix (`counted: "prefix"`, `tracked: false`), in the same way, on
 *  `perPrefix`; past `maxPrefixes` prefixes it is served and not counted (`counted: "none"`), its failure
 *  counting for the instance only, and `onUntracked` is called once a window (C11, C14, above). */
export function failureLimiter({ perAddress, global, everyCall = false, windowMs = 60_000, maxAddresses = 10_000, maxPerPrefix = 256, perPrefix = perAddress * 8, maxPrefixes = maxAddresses, onUntracked = () => {}, now = () => Date.now() }) {
  let window = -1, calls = new Map(), fails = new Map(), totalFails = 0;
  let held = new Map(); // prefix → how many keys of the table are its own
  let pCalls = new Map(), pFails = new Map(); // prefix → the calls and the failures of its keys without a place
  let aggregated = 0, untracked = 0;
  const flying = new Map(); let totalFlying = 0; // entered, not settled yet: they outlive a window
  const history = new Map(); // window → [counted with a prefix, untracked], the last OVERFLOW_HISTORY_MINUTES
  const keep = Math.ceil((OVERFLOW_HISTORY_MINUTES * 60_000) / windowMs);
  const roll = () => {
    const t = now();
    const w = Math.floor(t / windowMs);
    if (w !== window) {
      if (aggregated || untracked) history.set(window, [aggregated, untracked]);
      for (const k of history.keys()) if (k <= w - keep) history.delete(k);
      window = w; calls = new Map(); fails = new Map(); held = new Map(); pCalls = new Map(); pFails = new Map(); totalFails = 0; aggregated = 0; untracked = 0;
    }
    return Math.max(1, Math.ceil(((w + 1) * windowMs - t) / 1000));
  };
  /** Where `key` is counted in this window: under its own name, with its prefix, or nowhere. */
  const place = (key, prefix) => {
    if (calls.has(key)) return "address";
    if (calls.size < maxAddresses && (held.get(prefix) ?? 0) < maxPerPrefix) return "address";
    if (pCalls.has(prefix) || pCalls.size < maxPrefixes) return "prefix";
    return "none";
  };
  const land = (key, prefix) => { if (!calls.has(key)) { calls.set(key, 0); held.set(prefix, (held.get(prefix) ?? 0) + 1); } };
  const takeOff = (k) => { if (everyCall) return; flying.set(k, (flying.get(k) ?? 0) + 1); totalFlying++; };
  const touchDown = (k) => { if (everyCall) return; const n = flying.get(k) - 1; if (n > 0) flying.set(k, n); else flying.delete(k); totalFlying--; };
  return {
    enter(address) {
      const retryAfter = roll();
      const key = addressKey(address), prefix = prefixKey(key);
      const where = place(key, prefix);
      let settled = false;
      if (where === "none") {
        if (untracked++ === 0) onUntracked();
        return { ok: true, tracked: false, counted: "none", settle(didFail) { if (settled) return; settled = true; if (didFail) { roll(); totalFails++; } } };
      }
      if (where === "prefix") {
        // the keys of this prefix that have no place, as one caller with a larger allowance. The instance's
        // budget is not asked here: nothing says this key failed, only that keys of its prefix did
        if ((everyCall ? pCalls.get(prefix) ?? 0 : (pFails.get(prefix) ?? 0) + (flying.get(prefix) ?? 0)) >= perPrefix) return { ok: false, scope: "prefix", retryAfter };
        aggregated++;
        pCalls.set(prefix, (pCalls.get(prefix) ?? 0) + 1);
        takeOff(prefix);
        return {
          ok: true,
          tracked: false,
          counted: "prefix",
          settle(didFail) {
            if (settled) return; settled = true;
            touchDown(prefix);
            if (!didFail) return;
            roll();
            totalFails++;
            // the window may have turned while the call ran, and its table of prefixes be full
            if (!pCalls.has(prefix)) { if (pCalls.size >= maxPrefixes) return; pCalls.set(prefix, 0); }
            pFails.set(prefix, (pFails.get(prefix) ?? 0) + 1);
          },
        };
      }
      const failed = fails.get(key) ?? 0;
      if ((everyCall ? calls.get(key) ?? 0 : failed + (flying.get(key) ?? 0)) >= perAddress) return { ok: false, scope: "address", retryAfter };
      if (totalFails + totalFlying >= global && failed > 0) return { ok: false, scope: "global", retryAfter };
      land(key, prefix);
      calls.set(key, calls.get(key) + 1);
      takeOff(key);
      return {
        ok: true,
        tracked: true,
        counted: "address",
        settle(didFail) {
          if (settled) return; settled = true;
          touchDown(key);
          if (!didFail) return;
          roll();
          totalFails++;
          // the window may have turned while the call ran, and its table be full, or its prefix's share
          // taken: the failure then counts for the instance only
          if (place(key, prefix) !== "address") return;
          land(key, prefix);
          fails.set(key, (fails.get(key) ?? 0) + 1);
        },
      };
    },
    size: () => calls.size,
    /** The calls of this window served without being counted anywhere but for the instance. */
    untracked: () => { roll(); return untracked; },
    /** The calls of this window counted with their prefix. */
    aggregated: () => { roll(); return aggregated; },
    /** The same two counts over the last OVERFLOW_HISTORY_MINUTES, this window included: what /api/health says. */
    overflow() {
      roll();
      let a = aggregated, u = untracked;
      for (const [x, y] of history.values()) { a += x; u += y; }
      return { countedByPrefix: a, untracked: u };
    },
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
