// The service's only way out (PADR-0016 point 3, T12): a fetch bound to a closed list of hosts. The
// OIDC issuer's keys are the one destination outside the hoster; the object store is the hoster's own.
// Any other destination is refused before a socket opens, and the refusal is logged by the caller.
export class EgressRefused extends Error {
  constructor(host) { super(`egress refused: ${host}`); this.host = host; }
}

export function boundFetch(allowedHosts, fetchImpl = globalThis.fetch) {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  const f = async (url, init) => {
    const u = new URL(url);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && allowed.has(u.host.toLowerCase()))) throw new EgressRefused(u.host);
    if (!allowed.has(u.host.toLowerCase())) throw new EgressRefused(u.host);
    return fetchImpl(url, { ...init, redirect: "error" });
  };
  f.allowed = [...allowed];
  return f;
}
