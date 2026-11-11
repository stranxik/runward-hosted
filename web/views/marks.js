// The marks and the small pieces every screen writes with (the views' grammar: shape and word, never
// colour): a state, a relevé, a head, a button that goes somewhere, a button that does something. The few pieces
// with words (the forge note, the passkey said plainly, a request's id, the loading screen) read the lexicon at paint.
import { esc } from "./base.js";
import { mots } from "./lexique.js";

export const mk = (shape, word) => shape === "inv"
  ? `<span class="st chip-inv"><span class="mk mk-full" aria-hidden="true"></span>${esc(word)}</span>`
  : `<span class="st"><span class="mk mk-${shape}" aria-hidden="true"></span>${esc(word)}</span>`;
/** A screen's opening line: where one is, and a measure on the right (the public site's « amorce », no capitals). */
export const head = (l, r) => `<p class="kick"><span>${l}</span>${r ? `<span class="soft">${r}</span>` : ""}</p>`;
/** A window of the public site: a bar with three dots and its title in the mono, then its body; glass unless `plat`. */
export const fenetre = (title, body, { plat = false, cls = "", tag = "section", h = "h2", attrs = "" } = {}) => `<${tag} class="scr ${plat ? "plat" : "verre"}${cls ? ` ${cls}` : ""}"${attrs}><${h} class="scr-bar">${title}</${h}><div class="scr-body">${body}</div></${tag}>`;
export const go = (hash, label, { q = false } = {}) => `<button class="btn${q ? " btn-q" : ""}" type="button" data-go="${esc(hash)}">${esc(label)}</button>`;
export const act = (name, label, { q = false, k = "", extra = "" } = {}) => `<button class="btn${q ? " btn-q" : ""}" type="button" data-do="${name}"${k ? ` data-k="${esc(k)}"` : ""}${extra}>${esc(label)}</button>`;
const ICON_PK = `<svg class="ico" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><circle cx="8" cy="7.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 20c0-3.2 2.5-5.8 5.5-5.8 1.5 0 2.8.5 3.8 1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="17" cy="12.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M17 15.1V21m0-2.6h2m-2 2h1.4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
export const forge = () => `<p class="note">${esc(mots().marks.forge)}</p>`;
export const pkPlain = () => `<div class="explique">${ICON_PK}<p class="small">${esc(mots().marks.pkPlain)}</p></div>`;
export const reqNote = (r) => (r?.requestId ? ` ${esc(mots().marks.request)} <code>${esc(r.requestId)}</code>` : "");
export const MARK = `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="14" width="72" height="72" rx="16"/><path d="M36 36 L50 50 L36 64"/></g><rect x="54" y="43" width="14" height="14" rx="3" fill="currentColor"/></svg>`;
export const etq = (shape, word) => `<span class="etq"><span class="mk mk-${shape}" aria-hidden="true"></span>${esc(word)}</span>`;
/** The screen shown while a screen's reads are made: its title, a line, a quiet skeleton of two sheets. */
export const loadingView = (title) => { const W = mots().marks; return { title, key: "fleet", signed: "in", html: `<h1 class="vh">${esc(W.loading)}</h1><div class="charge" role="progressbar" aria-label="${esc(W.loadingLabel)}"></div><div class="squelette" aria-hidden="true"><span class="sq sq-t"></span><span class="sq sq-l"></span><div class="sq-f"><span class="sq sq-a"></span><span class="sq sq-b"></span></div><div class="sq-f"><span class="sq sq-c"></span><span class="sq sq-d"></span><span class="sq sq-e"></span></div></div>` }; };
