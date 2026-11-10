// The named refusals: one meaning per code (architecture note §3.2, C8). Every refusal the service
// returns is { refusal, message, action }, in French and English, and is written to the journal with
// its reason (rule R5). The ingestion says "not accepted"; "refused" stays the verdict of runward.
//
// The catalogue is one object, merged from one file per domain of the product, so that two lots never
// write the same file: a lot adds its codes in its own file beside floor.js (pure data, no import) and
// one line to PARTS below. A code declared in two files is a programming error, refused when this module
// loads. The API contract's digest reads the codes sorted: adding a file changes it only by its codes.
import { FLOOR } from "./floor.js";

/** @typedef {import("./floor.js").RefusalDef} RefusalDef */

/** The parts of the catalogue, one line per file of this folder: [name, codes]. */
const PARTS = [
  ["floor", FLOOR],
];

/**
 * One catalogue from its parts. A code that two parts declare throws, naming both.
 * @param {Array<[string, Record<string, RefusalDef>]>} parts
 * @returns {Record<string, RefusalDef>}
 */
export function mergeRefusals(parts) {
  const all = {}, from = new Map();
  for (const [name, codes] of parts) for (const [code, def] of Object.entries(codes)) {
    if (from.has(code)) throw new Error(`refusal code declared twice: ${code} (${from.get(code)}, ${name})`);
    from.set(code, name);
    all[code] = def;
  }
  return all;
}

/** @type {Record<string, RefusalDef>} */
export const REFUSALS = mergeRefusals(PARTS);

/** A refusal object as the API returns it, in one language. Unknown codes are a programming error. */
export function refusal(code, lang = "fr", extra = {}) {
  const def = REFUSALS[code];
  if (!def) throw new Error(`unknown refusal code: ${code}`);
  const [message, action] = lang === "en" ? def.en : def.fr;
  return { refusal: code, message, action, ...extra };
}

export function statusOf(code) {
  const def = REFUSALS[code];
  if (!def) throw new Error(`unknown refusal code: ${code}`);
  return def.status;
}

/** A refusal as a value the application layer returns (never thrown across a port). */
export class Refusal extends Error {
  constructor(code, extra = {}) {
    super(code);
    if (!REFUSALS[code]) throw new Error(`unknown refusal code: ${code}`);
    this.code = code;
    this.extra = extra;
  }
}
