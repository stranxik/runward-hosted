// The fleet views are runward-fleet's views.js, served from the pinned package and imported as is
// (PADR-0011 point 4). The server writes the served path of that file in place of the slot below
// (src/http/assets.js); this module is the only one that names it.

export { renderView, renderNav, ROUTES } from "__VIEWS__";
