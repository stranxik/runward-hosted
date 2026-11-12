// The API, same origin only, and the reads of each screen. The budget of architecture §6 (4 reads at most
// per screen) is held here and in the router: a screen reads through one of these loaders, once per opening.
import { S, COMMIT } from "./base.js";
import { lang } from "./lexique.js";
import { journalApiQuery } from "./journal-filtres.js";

export async function api(method, path, body) {
  let res;
  const started = Date.now();
  const slow = setTimeout(() => { if (!S.slow) { S.slow = true; render(); } }, 20_000);
  try {
    // the reader's language: the service already says its refusals in the one Accept-Language names (src/http/server.js)
    const headers = { "accept-language": lang(), ...(body !== undefined ? { "content-type": "application/json" } : {}) };
    res = await fetch(path, { method, credentials: "same-origin", headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    clearTimeout(slow);
    return { ok: false, status: 0, network: true, refusal: navigator.onLine === false ? "offline" : "network" };
  }
  clearTimeout(slow);
  S.slow = false;
  const v = res.headers.get("runward-version");
  if (v && COMMIT && v !== COMMIT && !S.newVersion) { S.newVersion = true; }
  const requestId = res.headers.get("runward-request-id");
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 401 && data?.refusal === "signed-out" && path !== "/api/v0/session") { S.session = null; }
  return { ok: res.ok, status: res.status, data, refusal: data?.refusal ?? null, message: data?.message, action: data?.action, requestId, ms: Date.now() - started };
}

// ------------------------------------------------------------- loading each screen's reads
export async function loadSession() {
  const r = await api("GET", "/api/v0/session");
  if (r.ok) S.session = r.data;
  else if (r.status === 401) S.session = null;
  else { S.session = undefined; S.error = r; }
  return r;
}
export async function loadFleet() {
  const [i, st] = await Promise.all([api("GET", `/f/${encodeURIComponent(S.session.tenant.id)}/index.json`), api("GET", "/api/v0/fleet/status")]);
  S.index = i.ok ? i.data : null; S.status = st.ok ? st.data : null;
  S.fleetError = !i.ok && i.status !== 404 ? i : null;
}
export async function loadAccess() { const r = await api("GET", "/api/v0/access"); S.access = r.ok ? r.data : null; S.accessError = r.ok ? null : r; }
/** The journal: a page (its cursor) and its filters (the address's query, web/views/journal-filtres.js, ADR-0037). */
export async function loadJournal(cursor, query = "") {
  const q = new URLSearchParams(journalApiQuery(query));
  if (cursor) q.set("cursor", cursor);
  const qs = q.toString();
  const r = await api("GET", `/api/v0/journal${qs ? `?${qs}` : ""}`);
  S.journal = r.ok ? r.data : null; S.journalError = r.ok ? null : r;
}
/** The status lines alone (the journal names its applications by them). */
export async function loadStatus() { const r = await api("GET", "/api/v0/fleet/status"); if (r.ok) S.status = r.data; }
/** The connect flow's reads (ADR-0037): the access view, then the index and the status lines, made together. */
export async function loadFlux() { await Promise.all([loadAccess(), loadFleet()]); }
