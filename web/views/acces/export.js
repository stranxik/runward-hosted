// Access, sub-screen: the export archive.
import { S, esc, short } from "../base.js";
import { when } from "../time.js";
import { mk, reqNote, act, head, go } from "../marks.js";
import { mots } from "../lexique.js";
import { retour, retourMot, versSection } from "../liens.js";

/** Back where the member came from, else to « Récupérer vos données » in Compte. */
const back = () => { const to = retour(versSection("donnees")); return go(to, retourMot(to), { q: true }); };

export function viewExport() {
  const W = mots(), X = W.acces.export, C = W.common;
  const x = S.export;
  const body = x?.error ? `<p class="erreur" role="alert">${mk("inv", X.notPrepared)} ${esc(x.error.message ?? X.failed)}${X.nothingLost}${reqNote(x.error)}</p><div class="actions">${act("export", C.retry)}</div>`
    : x?.busy ? `<div class="charge" role="progressbar" aria-label="${esc(X.preparing)}"></div><p class="note">${X.preparingText}</p>`
      : x?.ready ? `<p>${mk("full", X.ready)} ${X.archive(esc((x.ready.size / 1024 / 1024).toFixed(1).replace(".", X.decimal)), esc(short(x.ready.sha256)), when(x.ready.expiresAt, { sec: false }))}</p>
         <div class="actions"><a class="btn" href="/api/v0/export/${esc(x.ready.id)}" download="runward-hosted-export.tar">${X.download}</a></div>
         <pre class="term" tabindex="0" lang="en">node scripts/replay-export.mjs runward-hosted-export.tar   # rebuilds every index of replay.json</pre>`
        : `<p class="small">${X.asked}</p><div class="actions">${act("export", X.prepare)}</div>`;
  return { title: X.title, key: "acces", signed: "in", html: `${head(X.head, C.gestureCheck)}<h1 class="v">${X.h1}</h1>${body}<div class="actions">${back()}</div>` };
}
