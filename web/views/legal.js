// Legal notice, privacy, security.
import { esc, META } from "./base.js";
import { head } from "./marks.js";
import { mots } from "./lexique.js";

export function viewLegal() {
  const L = mots().legal;
  return { title: L.title, key: "panne", signed: "any", html: `${head(L.head, L.headR)}
    <h1 class="v">${L.h1}</h1>
    <div class="grid2">
      <section class="panel"><h2>${L.notice}</h2><p class="small"><span class="k">${L.publisher}</span>${esc(META("runward-publisher") || L.publisherDefault)}</p><p class="small"><span class="k">${L.host}</span>${L.hostName}</p><p class="small"><span class="k">${L.service}</span>${L.serviceText}</p></section>
      <section class="panel"><h2>${L.privacy}</h2><ul class="small">${L.privacyItems.map((i) => `<li>${i}</li>`).join("")}</ul></section>
      <section class="panel"><h2>${L.security}</h2><p class="small">${L.report}</p></section>
    </div>` };
}
