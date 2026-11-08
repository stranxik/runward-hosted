// The service's only way out (PADR-0016 point 3, T12): a fetch bound to a closed list of hosts. The
// OIDC issuer's keys are the one destination outside the hoster; the object store is the hoster's own.
// Any other destination is refused before a socket opens, and the refusal is logged by the caller.
//
// Bounded in time and in insistence (review finding of 2026-11-08: no timeout on these fetches). Each
// call has an explicit deadline (timeoutMs, combined with the caller's own signal), and each host has a
// simple circuit breaker: after `failures` consecutive failures (a network error, a timeout or a 5xx),
// the host is open for `openMs` and every call to it is refused at once, without a socket; after that,
// one call is let through (half open): its success closes the circuit, its failure opens it again.
export class EgressRefused extends Error {
  constructor(host) { super(`egress refused: ${host}`); this.host = host; }
}
export class EgressUnavailable extends Error {
  constructor(host, why) { super(`egress unavailable: ${host} (${why})`); this.host = host; this.why = why; }
}

export const EGRESS_DEFAULTS = { timeoutMs: 10_000, failures: 5, openMs: 30_000 };

export function boundFetch(allowedHosts, fetchImpl = globalThis.fetch, { timeoutMs = EGRESS_DEFAULTS.timeoutMs, failures = EGRESS_DEFAULTS.failures, openMs = EGRESS_DEFAULTS.openMs, now = () => Date.now() } = {}) {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  const circuits = new Map(); // host → { failed, openUntil, trial }
  const circuit = (host) => { if (!circuits.has(host)) circuits.set(host, { failed: 0, openUntil: 0, trial: false }); return circuits.get(host); };
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && allowed.has(host))) throw new EgressRefused(u.host);
    if (!allowed.has(host)) throw new EgressRefused(u.host);
    const c = circuit(host);
    if (c.openUntil > now()) throw new EgressUnavailable(u.host, "circuit open");
    if (c.openUntil && c.trial) throw new EgressUnavailable(u.host, "circuit half open, a trial is in flight");
    const half = c.openUntil !== 0;
    if (half) c.trial = true;
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    const failed = (why) => {
      c.failed++; c.trial = false;
      if (half || c.failed >= failures) { c.openUntil = now() + openMs; c.failed = 0; }
      return new EgressUnavailable(u.host, why);
    };
    let r;
    try { r = await fetchImpl(url, { ...init, signal, redirect: "error" }); }
    catch (e) {
      // the caller gave up: not the host's failure, the circuit is left as it was
      if (init.signal?.aborted && !deadline.aborted) { if (half) c.trial = false; throw e; }
      throw failed(deadline.aborted ? `no answer within ${timeoutMs} ms` : String(e?.message ?? e).slice(0, 120)); }
    if (r.status >= 500) { failed(`status ${r.status}`); return r; }
    c.failed = 0; c.openUntil = 0; c.trial = false;
    return r;
  };
  f.allowed = [...allowed];
  f.circuits = () => Object.fromEntries([...circuits].map(([h, c]) => [h, { open: c.openUntil > now(), failed: c.failed }]));
  return f;
}
