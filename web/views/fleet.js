// Fleet: provenance and the status line, then views.js, in the reader's language (the pinned views read the
// index's `lang`: the index the reader reads is the same one with the reader's language, as on the decision reading).
import { S, esc, short } from "./base.js";
import { when } from "./time.js";
import { mk, head, reqNote, act, go, loadingView } from "./marks.js";
import { lang, mots } from "./lexique.js";
import { renderView } from "./fleet-views.js";
import { viewFlotte } from "./flotte.js";
import { viewMissionDetail } from "./mission.js";
import { niveau } from "./claims.js";

/**
 * The level of evidence of every declared mission (ADR-0029 section 2), the missions that reach the same one said
 * together: the sentence, what it does not prove, the code, then the missions, each reached or to come. A mission
 * with no level shown is a defect: every line of the status carries one.
 */
function niveaux(lines) {
  const L = mots().forge.level;
  const codes = [...new Set(lines.map((m) => m.level?.code).filter(Boolean))].sort();
  if (!codes.length) return "";
  return `<div class="niveaux" role="group" aria-label="${esc(L.byLevel)}"><h3 class="k">${esc(L.byLevel)}</h3><p class="small soft">${L.lead}</p>${codes.map((code) => {
    const of = lines.filter((m) => m.level?.code === code);
    const list = of.map((m) => `<li><span data-verbatim translate="no">${esc(m.mission)}</span> <span class="soft">${esc(m.level.reached ? L.reached : L.willReach)}${m.level.keyRetiredAt ? ` · ${esc(L.retiredMark)}` : ""}</span></li>`).join("");
    return niveau(code, { extra: `<ul class="small" aria-label="${esc(L.missions)}">${list}</ul>` });
  }).join("")}</div>`;
}

function fleetHead() {
  const W = mots(), F = W.fleet, C = W.common;
  const st = S.status;
  if (!st) return "";
  const lines = st.lines.map((m) => {
    const last = m.accepted ? `${mk("full", W.lines.entry(m.accepted.seq))}<div class="small">${when(m.accepted.receivedAt)}</div>` : m.state === "pending" ? mk("half", F.waiting) : mk("void", F.noAccepted);
    const cur = m.accepted ? `<span class="small">${m.forge === "gitlab" ? W.forge.fleetRun(esc(m.accepted.runNumber), esc(m.accepted.runAttempt)) : F.run(esc(m.accepted.runNumber), esc(m.accepted.runAttempt))}</span><div><code>${esc(String(m.accepted.commit ?? "").slice(0, 12))}</code></div>` : `<span class="soft small">${F.nothing}</span>`;
    const since = m.notAcceptedSince ? `${mk("inv", F.notAcceptedSince(m.notAcceptedSince))}<div class="small"><code>${esc(m.lastRefusal)}</code> · <a href="#/envois">${F.seeUploads}</a></div>` : `<span class="small soft">${F.zeroSince}</span>`;
    return `<tr><th scope="row"><span data-verbatim translate="no">${esc(m.mission)}</span><div class="small soft" translate="no">${esc(m.repository)}</div></th><td>${last}</td><td>${cur}</td><td>${since}</td></tr>`;
  }).join("");
  const idx = st.index;
  return `${head(idx ? F.head(esc(short(idx.sha256)), esc(idx.fleetVersion), when(idx.publishedAt), esc(idx.seq)) : C.noIndex, F.headR)}
    ${idx ? `<div class="prov-tete small"><a href="/f/${esc(S.session.tenant.id)}/index.json">${F.asServed}</a> · ${F.recompute('<code translate="no">runward-fleet build fleet.json --out site</code>', `<code>${esc(short(idx.sha256))}</code>`)}</div>` : ""}
    ${st.quarantined ? `<p class="avert">${mk("inv", C.notPublished)} ${C.quarantined(esc(st.quarantined))} <a href="#/envois">${C.seeUploads}</a></p>` : ""}
    ${lines ? `<section class="blk releve" aria-label="${esc(F.byMission)}"><details class="releve-d"${matchMedia("(min-width: 760px)").matches ? " open" : ""}>
      <summary><h2 class="h-releve">${F.h2}</h2> <span class="small soft">${F.summary(st.lines.length, st.lines.filter((m) => m.notAcceptedSince).length, st.lines.filter((m) => !m.accepted).length)}</span></summary>
      <div class="tw" tabindex="0" role="region" aria-label="${esc(F.table)}"><table class="t"><thead><tr>${F.th.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${lines}</tbody></table></div>
      <p class="small soft">${F.legend}</p>${niveaux(st.lines)}</details></section>` : ""}`;
}
export function viewFleet(route, sub) {
  const W = mots(), F = W.fleet, C = W.common;
  if (S.fleetError) return { title: F.errorTitle, key: "fleet", signed: "in", html: `${head(C.statusHead, "")}<h1 class="v">${F.errorH1}</h1><p class="face">${mk("inv", F.errorMk)} ${F.errorFace}${reqNote(S.fleetError)}</p><div class="actions">${act("reload-screen", C.retry)}${go("#/envois", C.seeUploads, { q: true })}</div>` };
  if (!S.status) return loadingView(F.title);
  if (route === "flotte") return viewFlotte();
  if (route === "mission") return viewMissionDetail(sub);
  if (!S.index) return { title: F.title, key: "fleet", signed: "in", fleetRoute: route, html: `${fleetHead()}<h1 class="v">${C.noMission}</h1><p>${C.noMissionText}</p><div class="actions">${go("#/declarer", C.declare)}</div>` };
  const L = lang(), idx = S.index.lang !== L ? { ...S.index, lang: L } : S.index;
  return { title: Object.hasOwn(W.frame.views, route) ? W.frame.views[route] : F.title, key: "fleet", signed: "in", fleetRoute: route, html: `${fleetHead()}${renderView(idx, route === "vue" ? "" : route, sub || undefined)}` };
}
