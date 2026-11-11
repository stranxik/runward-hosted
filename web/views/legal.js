// Legal notice, privacy, security: the app's own. The public site's legal notice is at runward.dev (ADR-0028), linked
// from here in the reader's language.
import { esc, META } from "./base.js";
import { head } from "./marks.js";
import { mots, siteUrl } from "./lexique.js";

export function viewLegal() {
  const L = mots().legal;
  return { title: L.title, key: "panne", signed: "any", html: `${head(L.head, L.headR)}
    <h1 class="v">${L.h1}</h1>
    <div class="grid2">
      <section class="panel"><h2>${L.notice}</h2><p class="small"><span class="k">${L.publisher}</span>${esc(META("runward-publisher") || L.publisherDefault)}</p><p class="small"><span class="k">${L.host}</span>${L.hostName}</p><p class="small"><span class="k">${L.service}</span>${L.serviceText}</p><p class="small"><span class="k">${L.site}</span>${L.siteText(`<a href="${esc(siteUrl("mentions"))}" translate="no">runward.dev/mentions</a>`)}</p></section>
      <section class="panel"><h2>${L.privacy}</h2><ul class="small">${L.privacyItems.map((i) => `<li>${i}</li>`).join("")}</ul></section>
      <section class="panel"><h2>${L.security}</h2><p class="small">${L.report}</p></section>
    </div>` };
}
