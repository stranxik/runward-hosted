// The fleet views are runward-fleet's views.js, served from the pinned package and imported as is
// (PADR-0011 point 4). The server writes the served path of that file in place of the slot below
// (src/http/assets.js); this module is the only one that names it.

// `decide` and `LEXICON` (ADR-0035): the order of the portfolio and the names of the documents, the states and the
// kinds of refusal, as runward-fleet's own reading says them, for the rails of « la piste ».
export { renderView, renderNav, ROUTES, decide, LEXICON } from "__VIEWS__";
