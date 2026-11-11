// The public pages that left this origin (ADR-0028): runward.dev is the one public site since 2026-11-11 (the same
// pages, with the documentation and the news); app.runward.dev carries the app only. Every address the app served as
// a public page (ADR-0022) answers 308 to the same page of runward.dev, its query string kept: a link already sent, a
// bookmark and the printed QR code of /stand keep working. The table is closed: a path that is not in it is not moved.
//
// The site says French at /<page> and English at /en/<page>. The pages this origin served held both languages in one
// document, English chosen by ?lang=en: that choice names the English page. /en and /en/<page> never existed here;
// they are answered the same way, so an address of runward.dev typed on this host finds its page.

/** The origin of the public site. Written here and in web/views/lexique.js (the shell's links), nowhere else. */
export const PUBLIC_SITE = "https://runward.dev";

/** The pages that moved, by their name on both sites: /<name> here was /<name> there. */
export const MOVED_PAGES = Object.freeze(["pourquoi", "comment", "pour-qui", "formats", "donnees", "stand", "releve", "mentions"]);

/**
 * Where a path of this origin moved to, or null when it did not move. `path` is a parsed pathname, `search` a parsed
 * query ("" or "?..."), both from the URL parser: nothing of the request is copied raw into the answer's header.
 * The root is not in the table: / is the app (its sign-in when signed out). /index.html was the landing's other name.
 */
export function movedTo(path, search = "") {
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  let en = false, page = null;
  if (p === "/index.html") page = "";
  else if (p === "/en") { en = true; page = ""; }
  else {
    const m = /^(\/en)?\/([a-z-]+)$/.exec(p);
    if (m && MOVED_PAGES.includes(m[2])) { en = Boolean(m[1]); page = m[2]; }
  }
  if (page === null) return null;
  if (!en && new URLSearchParams(search).get("lang") === "en") en = true;
  const target = en ? `/en${page ? `/${page}` : ""}` : `/${page}`;
  return `${PUBLIC_SITE}${target}${search}`;
}

/** The redirect table as it is written in ADR-0028 and checked by test/unit/moved.test.js: [source, target]. */
export const MOVED_TABLE = Object.freeze([
  ["/index.html", `${PUBLIC_SITE}/`],
  ...MOVED_PAGES.map((n) => [`/${n}`, `${PUBLIC_SITE}/${n}`]),
  ["/en", `${PUBLIC_SITE}/en`],
  ...MOVED_PAGES.map((n) => [`/en/${n}`, `${PUBLIC_SITE}/en/${n}`]),
]);
