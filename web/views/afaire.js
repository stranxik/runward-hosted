// « À faire »: what waits for a gesture of the member, the first block of the first screen after the sign-in
// (ADR-0034). Since the fixed shell (ADR-0036): a compact strip at the head of the list of applications
// (web/views/decision.js), the whole block in the drawer the top bar's « À faire » opens (web/views/shell.js), its count
// on the sidebar's « Applications », on the top bar and on the phone's tab bar, and an application's own item in its
// reading. One item per action, each with what to do, its reason in one sentence, its deadline and its button; an item
// goes away once its gesture is done (the next read no longer carries it).
//
// Everything is read from what the router already loaded: the session and GET /api/v0/fleet/status, whose lines carry
// the repository's id, its declaration's expiry and the date of the upload that waits (src/application/reading.js).
// No example data, and no deadline that the service does not hold: a declaration expires only while nothing has
// arrived (operator.js#retention); once a first upload arrived it waits, with no date (expiresAt is then null).
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { go } from "./marks.js";
import { mots } from "./lexique.js";
import { premierEnvoi, versConfirmer, versAttente, versDepot } from "./liens.js";

/** Is this account the service's own control account (the session's tenant view says it, ADR-0034)? */
export const compteTemoin = () => Boolean(S.session?.tenant?.witness);

/** Are the items known? The status lines are read on the portfolio; before that, only the account's own items are. */
export const aFaireConnu = () => Boolean(S.session) && (Boolean(S.status) || compteTemoin());

/**
 * The items, in order: a check that arrived and waits for a confirmation first, then a declaration that expires (the
 * nearest first), then a consent, then the account's own (one gesture for all of a repository's applications). Each item: { kind, name, at, deadline, href }; `kind` is one of confirm, owner, definition,
 * install, consent, passkey. On the control account the applications' items are none: its first upload waits on
 * purpose (the banner says so).
 */
export function aFaire() {
  const s = S.session;
  if (!s) return [];
  const out = [];
  const lines = compteTemoin() ? [] : (S.status?.lines ?? []);
  const byRepo = new Map();
  for (const l of lines) {
    const k = l.repositoryRef ?? l.repository;
    if (!byRepo.has(k)) byRepo.set(k, []);
    byRepo.get(k).push(l);
  }
  for (const [key, ls] of byRepo) {
    const l = ls[0];
    const name = ls.length === 1 ? l.mission : l.repository;
    if (l.state === "pending") {
      const first = premierEnvoi(l);
      const at = l.pendingReceivedAt ?? first?.at ?? null;
      if (at) out.push({ kind: "confirm", name, key, at, deadline: l.expiresAt ?? null, href: versConfirmer(key) });
      else if (l.expiresAt) out.push({ kind: "install", name, key, at: null, deadline: l.expiresAt, href: versAttente(key) });
      continue;
    }
    const again = ls.find((x) => x.lastRefusal === "owner-changed" || (x.lastRefusal === "definition-not-pinned" && x.pendingReceivedAt));
    if (again) { out.push({ kind: again.lastRefusal === "owner-changed" ? "owner" : "definition", name, key, at: again.pendingReceivedAt ?? again.lastRefusalAt ?? null, deadline: null, href: versConfirmer(key) }); continue; }
    if (l.consent === false) out.push({ kind: "consent", name, key, at: null, deadline: null, href: versDepot(key, "accord") });
  }
  if (s.passkeys === 1) out.push({ kind: "passkey", name: null, key: null, at: null, deadline: null, href: s.arrivalDone ? "#/acces/ajout" : "#/arrivee" });
  // what holds a check that already arrived first, then what has a deadline (the nearest first), then the rest
  const RANG = { confirm: 0, owner: 0, definition: 0, install: 1, consent: 2, passkey: 3 };
  return out.map((it, i) => [it, i]).sort(([a, i], [b, j]) => RANG[a.kind] - RANG[b.kind] || String(a.deadline ?? "").localeCompare(String(b.deadline ?? "")) || i - j).map(([it]) => it);
}

/** How many items wait, or null while they are not known (the menu then shows no count of them). */
export const nombreAFaire = () => (aFaireConnu() ? aFaire().length : null);

/** One item: what to do, why (unless `bref`), its deadline, its button. Every value from the API is escaped here. */
function item(it, { bref = false } = {}) {
  const A = mots().afaire, W = A[it.kind];
  const name = it.name ? `<span translate="no">${esc(it.name)}</span>` : "";
  const at = it.at ? when(it.at, { sec: false }) : "";
  const delai = it.deadline ? A.deadline(when(it.deadline, { sec: false })) : esc(A.none);
  return `<li class="af-i"><div class="af-t"><p class="af-q"><b>${W.q(name)}</b></p>${bref ? "" : `<p class="af-p">${W.p(at)}</p>`}<p class="af-d"><span class="mk mk-delai" aria-hidden="true"></span><span>${delai}</span></p></div><div class="actions">${go(it.href, W.act)}</div></li>`;
}
/** The block (`id` names its heading), or nothing when no item waits. */
function bloc(cls, id, { bref = false } = {}) {
  if (!aFaireConnu()) return "";
  const items = aFaire();
  if (!items.length) return "";
  const A = mots().afaire;
  return `<section class="${cls}" aria-labelledby="${id}"><h2 class="af-h" id="${id}"><span class="af-n num" aria-hidden="true">${items.length}</span>${esc(A.title)}<span class="vh">${esc(A.count(items.length))}</span></h2><ul class="af-l">${items.map((it) => item(it, { bref })).join("")}</ul></section>`;
}
/** The whole block: each item with its reason (the drawer of the top bar opens on it, web/views/shell.js). */
export const blocAFaire = () => bloc("afaire", "h-afaire");
/** The compact strip at the head of the list of applications (ADR-0036): what to do, its deadline, its button. */
export const bandeAFaire = () => bloc("afaire af-strip", "h-af-strip", { bref: true });
/** The item of a status line's repository, with its reason, for the reading of that application; or nothing. */
export function aFairePour(line) {
  if (!aFaireConnu() || !line) return "";
  const k = line.repositoryRef ?? line.repository;
  const it = aFaire().find((x) => x.key === k);
  return it ? `<ul class="af-l">${item(it)}</ul>` : "";
}
