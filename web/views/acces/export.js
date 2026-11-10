// Access, sub-screen: the export archive.
import { S, esc, short } from "../base.js";
import { when } from "../time.js";
import { mk, reqNote, act, head, go } from "../marks.js";

export function viewExport() {
  const x = S.export;
  const body = x?.error ? `<p class="erreur" role="alert">${mk("inv", "non préparée")} ${esc(x.error.message ?? "L'archive n'a pas pu être préparée.")} Rien n'est perdu.${reqNote(x.error)}</p><div class="actions">${act("export", "Réessayer")}</div>`
    : x?.busy ? `<div class="charge" role="progressbar" aria-label="Préparation de l'archive"></div><p class="note">Préparation de l'archive…</p>`
      : x?.ready ? `<p>${mk("full", "prête")} Archive de <b>${esc((x.ready.size / 1024 / 1024).toFixed(1).replace(".", ","))}&nbsp;Mo</b>, empreinte <code>sha256 ${esc(short(x.ready.sha256))}</code>, disponible jusqu'au ${when(x.ready.expiresAt, { sec: false })}.</p>
         <div class="actions"><a class="btn" href="/api/v0/export/${esc(x.ready.id)}" download="runward-hosted-export.tar">Télécharger l'archive</a></div>
         <pre class="term" tabindex="0" lang="en">node scripts/replay-export.mjs runward-hosted-export.tar   # rebuilds every index of replay.json</pre>`
        : `<p class="small">Votre passkey vous est demandée pour ce geste, puis l'archive se prépare.</p><div class="actions">${act("export", "Préparer l'archive")}</div>`;
  return { title: "Exporter", key: "acces", signed: "in", html: `${head("accès · exporter", "vérification par geste")}<h1 class="v">Votre archive.</h1>${body}<div class="actions">${go("#/acces", "Revenir à Accès", { q: true })}</div>` };
}
