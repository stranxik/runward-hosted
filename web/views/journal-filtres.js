// The journal's filters as the address keeps them (ADR-0037 point 2): #/envois[/<cursor>]?app=<mission>&quoi=<kind>
// &periode=<period>&entree=<seq>. A link keeps what the member chose; a reload reads the same page. The filters are the
// service's (GET /api/v0/journal?mission=&kind=&days=, src/domain/journal-filter.js): this module only writes the
// address and reads it back. `entree` is the entry shown in the detail pane: not a filter, never a read. A value this
// page does not know is left out of the address it writes back, so a link never asks the service a filter it refuses.
// Pure: it imports nothing, and runs in a test as it runs in the page.

/** The kinds, by their word in the address, and the service's name of each. */
export const QUOI = Object.freeze({ "envois-acceptes": "sends-accepted", "envois-refuses": "sends-refused", declarations: "declarations", confirmations: "confirmations", connexions: "sign-ins", compte: "account" });
/** The periods, by their word in the address, and their days. */
export const PERIODES = Object.freeze({ "24h": 1, "7j": 7, "30j": 30, "90j": 90, "1an": 365 });
const MISSION = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SEQ = /^[1-9][0-9]{0,14}$/;

/** The filters an address's query names, each null when it names none (or names one this page does not know). */
export function lireFiltres(query = "") {
  const q = new URLSearchParams(String(query ?? ""));
  const v = (k) => q.get(k) || null;
  const app = v("app"), quoi = v("quoi"), periode = v("periode"), entree = v("entree");
  return {
    app: app && MISSION.test(app) ? app : null,
    quoi: quoi && Object.hasOwn(QUOI, quoi) ? quoi : null,
    periode: periode && Object.hasOwn(PERIODES, periode) ? periode : null,
    entree: entree && SEQ.test(entree) ? Number(entree) : null,
  };
}
/** The query of an address for these filters, in a fixed order; the empty filters are left out. */
export function ecrireFiltres(f = {}) {
  const q = new URLSearchParams();
  const g = lireFiltres(new URLSearchParams(Object.entries(f).filter(([, x]) => x !== null && x !== undefined && x !== "").map(([k, x]) => [k, String(x)])).toString());
  for (const k of ["app", "quoi", "periode", "entree"]) if (g[k] !== null) q.set(k, String(g[k]));
  return q.toString();
}
/** The address of the journal: its page (a cursor, or none), its filters. */
export function versJournal(f = {}, cursor = "") {
  const q = ecrireFiltres(f);
  return `#/envois${cursor ? `/${encodeURIComponent(cursor)}` : ""}${q ? `?${q}` : ""}`;
}
/** Is any filter on (the entry shown is not one)? */
export const filtre = (f) => Boolean(f.app || f.quoi || f.periode);
/** The service's query for an address's filters: mission, kind, days (the entry shown is not asked). */
export function journalApiQuery(query = "") {
  const f = lireFiltres(query), q = new URLSearchParams();
  if (f.app) q.set("mission", f.app);
  if (f.quoi) q.set("kind", QUOI[f.quoi]);
  if (f.periode) q.set("days", String(PERIODES[f.periode]));
  return q.toString();
}
/** What makes one read of the journal: the same filters are one read, whatever entry is shown. */
export const journalKey = (query = "") => journalApiQuery(query);
