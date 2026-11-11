// The marks and the small pieces every screen writes with (the views' grammar: shape and word, never
// colour): a state, a relevé, a head, a button that goes somewhere, a button that does something.
import { esc } from "./base.js";

export const mk = (shape, word) => shape === "inv"
  ? `<span class="st chip-inv"><span class="mk mk-full" aria-hidden="true"></span>${esc(word)}</span>`
  : `<span class="st"><span class="mk mk-${shape}" aria-hidden="true"></span>${esc(word)}</span>`;
const rv = (html) => `<span class="rv">${html}</span>`;
export const head = (l, r) => `<div class="head">${rv(l)}${rv(r)}</div>`;
export const go = (hash, label, { q = false } = {}) => `<button class="btn${q ? " btn-q" : ""}" type="button" data-go="${esc(hash)}">${esc(label)}</button>`;
export const act = (name, label, { q = false, k = "", extra = "" } = {}) => `<button class="btn${q ? " btn-q" : ""}" type="button" data-do="${name}"${k ? ` data-k="${esc(k)}"` : ""}${extra}>${esc(label)}</button>`;
const ICON_PK = `<svg class="ico" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><circle cx="8" cy="7.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 20c0-3.2 2.5-5.8 5.5-5.8 1.5 0 2.8.5 3.8 1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="17" cy="12.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M17 15.1V21m0-2.6h2m-2 2h1.4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
export const FORGE = `<p class="note">Votre accès ne dépend pas de votre compte de forge : vos passkeys suffisent. Ainsi, la clé de vos preuves n'est jamais un compte tenu ailleurs.</p>`;
export const PK_PLAIN = `<div class="explique">${ICON_PK}<p class="small">Une passkey, c'est le déverrouillage de votre appareil (empreinte, visage ou code) qui sert de clé pour ce site, et pour lui seul. Rien à retenir, rien à recopier, et elle ne fonctionne sur aucun autre site.</p></div>`;
export const reqNote = (r) => (r?.requestId ? ` requête <code>${esc(r.requestId)}</code>` : "");
export const MARK = `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="14" width="72" height="72" rx="16"/><path d="M36 36 L50 50 L36 64"/></g><rect x="54" y="43" width="14" height="14" rx="3" fill="currentColor"/></svg>`;
/** The theme switch's icon, the landing's (web/site/gabarit.html): a half-filled circle. */
export const THEME_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor"/></svg>`;
export const etq = (shape, word) => `<span class="etq"><span class="mk mk-${shape}" aria-hidden="true"></span>${esc(word)}</span>`;
export const loadingView = (title) => ({ title, key: "fleet", signed: "in", html: `<h1 class="v">Chargement…</h1><div class="charge" role="progressbar" aria-label="Chargement"></div><div class="squelette"></div><div class="squelette"></div>` });
