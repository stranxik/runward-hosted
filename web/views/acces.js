// Access: who enters, and who sends; then its sub-screens: add a passkey, the export archive, the erasure
// of the account.
import { S, esc, short } from "./base.js";
import { when, DTF } from "./time.js";
import { head, mk, reqNote, act, loadingView, go, PK_PLAIN } from "./marks.js";
import { ask, confirmBox } from "./confirm.js";

export function viewAcces(sub) {
  if (sub === "export") return viewExport();
  if (sub === "effacer") return viewEffacer();
  if (sub === "ajout") return viewAjout();
  if (sub) return null;
  const a = S.access;
  if (S.accessError) return { title: "Accès", key: "acces", signed: "in", html: `${head("accès", "")}<h1 class="v">${mk("inv", "non affiché")} Accès ne s'affiche pas.</h1><p class="face">Le service n'a pas répondu.${reqNote(S.accessError)}</p><div class="actions">${act("reload-screen", "Réessayer")}</div>` };
  if (!a) return loadingView("Accès");
  const live = a.passkeys.filter((p) => !p.removedAt);
  const pk = a.passkeys.map((p) => {
    const name = p.provider ?? p.device ?? "Passkey";
    const removed = Boolean(p.removedAt);
    const right = removed
      ? `<div>${mk("void", "retirée")} ${ask(`restore:${p.id}`, "Remettre")}<div class="small soft">possible jusqu'au ${when(p.restorableUntil, { sec: false })}</div></div>`
      : live.length === 1 ? `<div class="small soft">Votre dernière passkey ne se retire pas : ajoutez-en une autre d'abord.</div>` : `<div>${ask(`passkey:${p.id}`, "Retirer")}</div>`;
    return `<div class="arow"><div><div class="nm">${esc(name)}${p.current ? " · ouvre cette session" : ""}</div><span class="k">${[p.phone ? "téléphone, par QR code" : null, p.synced === true ? "synchronisée" : p.synced === false ? "liée à cet appareil" : null, `ajoutée le ${DTF.format(new Date(p.createdAt)).slice(0, 10)}`].filter(Boolean).map(esc).join(" · ")}</span></div>
      <div class="small"><span class="k">dernière utilisation, heure du service (déclarée)</span>${when(p.lastUsedAt, { sec: false })}</div>${right}${confirmBox(`passkey:${p.id}`)}${confirmBox(`restore:${p.id}`)}</div>`;
  }).join("");
  const same = a.sameProvider ? `<p class="avert">Vos deux passkeys sont dans le même trousseau : perdre ce compte vous fermerait les deux. Ajoutez une clé de sécurité, ou une passkey d'un autre gestionnaire.</p>` : "";
  const ss = a.sessions.map((s) => `<div class="arow"><div><div class="nm">${esc(s.device ?? "Navigateur")}${s.current ? " · cette session" : ""}</div><span class="k">ouverte par la passkey ${esc(s.openedByLabel ?? "")}</span></div>
      <div class="small"><span class="k">ouverte, heure du service (déclarée)</span>${when(s.createdAt, { sec: false })}</div>
      ${s.current ? `<div>${act("logout", "Se déconnecter", { q: true })}</div>` : `<div>${ask(`session:${s.id}`, "Fermer")}</div>`}${confirmBox(`session:${s.id}`)}</div>`).join("");
  const rp = a.repositories.map((r) => {
    const removed = r.state === "removed";
    const missions = r.missions.map((m) => `<code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span>`).join(", ");
    const consentBtn = removed ? "" : r.consent ? ask(`consent:${r.id}`, "Retirer le consentement", false) : ask(`consentir:${r.id}`, "Consentir au contenu", false);
    const state = removed ? "" : r.state === "pending" ? `${mk("half", "en attente du premier envoi")}${r.pendingSend ? ` · <a href="#/declarer/confirmer/${esc(r.id)}">confirmer le premier envoi</a>` : ""}<br>` : r.pendingSend?.reason === "owner-changed" ? `${mk("inv", "owner-changed")} · <a href="#/declarer/confirmer/${esc(r.id)}">confirmer le nouveau propriétaire</a><br>` : "";
    return `<div class="arow"><div><div class="nm" data-verbatim translate="no">${esc(r.name)}</div><span class="k">missions</span>${missions}${r.repositoryId ? `<span class="k">identifiant épinglé</span><code>${esc(r.repositoryId)}</code>` : ""}</div>
      <div class="small">${state}<span class="k">workflow appelant</span><code>${esc(r.workflow)}</code> sur <code>main</code><br>${removed ? "" : r.consent ? mk("full", "contenu consenti") : mk("void", "contenu non consenti : aucun envoi accepté")}<br>${consentBtn}${removed ? "" : ` · ${ask(`purge:${r.id}`, "Effacer le contenu reçu", false)} · <button class="lien-btn" type="button" data-go="#/declarer/modifier/${esc(r.id)}">Modifier</button>`}</div>
      ${removed ? `<div>${mk("void", "retiré")} ${ask(`restorerepo:${r.id}`, "Remettre")}<div class="small soft">possible jusqu'au ${when(r.restorableUntil, { sec: false })}</div></div>` : `<div>${ask(`repo:${r.id}`, "Retirer")}</div>`}
      ${confirmBox(`repo:${r.id}`)}${confirmBox(`restorerepo:${r.id}`)}${confirmBox(`consent:${r.id}`)}${confirmBox(`consentir:${r.id}`)}${confirmBox(`purge:${r.id}`)}</div>`;
  }).join("") || `<p class="small soft">Aucun dépôt déclaré.</p>`;
  const otherOpen = a.sessions.some((s) => !s.current);
  const other = a.lang === "fr" ? "en" : "fr";
  return { title: "Accès", key: "acces", signed: "in", html: `${head(`accès · ${esc(S.session.tenant.title)}`, "toute modification demande une passkey récente, ou une vérification par geste")}
    <h1 class="v">Qui entre, et qui envoie.</h1>
    <p class="face lede">Vos passkeys et vos sessions ouvrent la lecture. Les dépôts déclarés sont les seuls à pouvoir écrire dans votre flotte.</p>
    <section class="blk"><h2>Passkeys</h2>${pk}${same}<div class="actions" style="margin-top:12px">${go("#/acces/ajout", "Ajouter une passkey", { q: true })}</div></section>
    <section class="blk"><h2>Sessions ouvertes</h2>${ss}${otherOpen ? `<div class="actions" style="margin-top:12px">${ask("closeothers:all", "Fermer toutes les autres sessions")}</div>${confirmBox("closeothers:all")}` : ""}</section>
    <section class="blk"><h2>Dépôts déclarés</h2>${rp}<div class="actions" style="margin-top:12px">${go("#/declarer", "Déclarer un dépôt", { q: true })}</div></section>
    <section class="blk"><h2>Langue et lecteur automatique</h2>
      <div class="arow"><div><div class="nm">Langue de la flotte</div><span class="k">écrite dans l'inventaire ; la changer reconstruit l'index</span></div><div class="small">${a.lang === "fr" ? "français" : "anglais"}</div><div>${ask(`lang:${other}`, other === "en" ? "Passer en anglais" : "Passer en français")}</div>${confirmBox(`lang:${other}`)}</div>
      <div class="arow"><div><div class="nm">Lecteur automatique</div><span class="k">stranxik/runward-hosted, temoin.yml : lit l'index et l'archive pour les mesures S1 et S2, chaque lecture au journal</span></div><div class="small">${a.reader ? mk("full", "autorisé") : mk("void", "non autorisé")}</div><div>${a.reader ? ask("reader:1", "Retirer") : ask("readeron:1", "Autoriser")}</div>${confirmBox("reader:1")}${confirmBox("readeron:1")}</div></section>
    <section class="blk"><h2>Membres</h2>
      <div class="arow"><div><div class="nm">Vous</div><span class="k">propriétaire</span></div><div class="small soft">Le dernier propriétaire ne se retire pas.</div><div class="small soft">L'invitation d'un second membre s'ouvre à son arrivée.</div></div></section>
    <section class="blk"><h2>Partir avec vos données</h2>
      <div class="panel"><p>L'archive contient l'inventaire <code>fleet.json</code> dans toutes ses versions, les fichiers reçus tels quels, le journal et <code>replay.json</code>, qui dit quelle version de runward-fleet redonne chaque index. Rejouée chez vous par <code>runward-fleet build</code>, elle redonne la même vue.</p>
        <div class="actions" style="margin:0">${go("#/acces/export", "Préparer l'archive")}${go("#/acces/effacer", "Effacer ce compte", { q: true })}</div></div></section>
    <section class="blk"><h2>Ce que ce service garde, et ses limites</h2>
      <ul class="small limites">
        <li>Le contenu reçu d'un dépôt est gardé tant qu'il est déclaré, puis ${a.retention.removedRepositoryDays} jours. Les sauvegardes de la base sont gardées ${a.retention.backupDays} jours.</li>
        <li>Tout ce qui pilote ce navigateur, un agent compris, peut lire votre flotte tant que la session est ouverte. Les gestes lourds redemandent votre passkey à chaque fois, l'ajout d'une passkey compris ; chaque ajout s'affiche dans vos autres sessions.</li>
        <li>Le workflow de votre dépôt décide d'appeler ou non l'envoi : le relevé donne le commit du dernier envoi accepté, et le lecteur automatique signale un écart avec <code>main</code>.</li>
        <li>Un agent qui a accès à votre poste et à votre compte GitHub peut ouvrir une reprise d'accès : elle attend 24 heures et s'affiche ici pour que vous l'annuliez.</li>
        <li>Ce que prouve l'envoi : il vient du workflow du service, dans la CI de ce dépôt, sur <code>main</code>, à tel commit. Le contenu jugé reste déclaré par la CI (<code>ci-declared</code>).</li>
        <li>Votre accès ne dépend pas de votre compte de forge : vos passkeys suffisent.</li>
      </ul></section>` };
}
function viewAjout() {
  const err = S.addError ? `<p class="erreur" role="alert">${S.addError === "exists" ? `${mk("inv", "déjà là")} Cet appareil porte déjà une passkey de votre compte.` : `${mk("void", "rien d'ajouté")} La création a été annulée sur l'appareil, ou n'a pas été vérifiée. Rien n'a changé.`}</p>` : "";
  return { title: "Ajouter une passkey", key: "acces", signed: "in", html: `${head("accès · ajouter une passkey", "vérification par geste")}
    <h1 class="v">Ajoutez une passkey.</h1>
    <p class="face lede">Choisissez de préférence un autre trousseau que celui de vos passkeys actuelles, ou une clé de sécurité. Votre passkey actuelle vous est d'abord demandée pour ce geste.</p>${err}
    <div class="actions">${act("addpk", "Sur mon téléphone, par code QR", { k: "phone" })}${act("addpk", "Une clé de sécurité", { q: true, k: "key" })}${act("addpk", "Sur cet appareil", { q: true, k: "device" })}</div>
    ${PK_PLAIN}<div class="actions">${go("#/acces", "Revenir à Accès", { q: true })}</div>` };
}
function viewExport() {
  const x = S.export;
  const body = x?.error ? `<p class="erreur" role="alert">${mk("inv", "non préparée")} ${esc(x.error.message ?? "L'archive n'a pas pu être préparée.")} Rien n'est perdu.${reqNote(x.error)}</p><div class="actions">${act("export", "Réessayer")}</div>`
    : x?.busy ? `<div class="charge" role="progressbar" aria-label="Préparation de l'archive"></div><p class="note">Préparation de l'archive…</p>`
      : x?.ready ? `<p>${mk("full", "prête")} Archive de <b>${esc((x.ready.size / 1024 / 1024).toFixed(1).replace(".", ","))}&nbsp;Mo</b>, empreinte <code>sha256 ${esc(short(x.ready.sha256))}</code>, disponible jusqu'au ${when(x.ready.expiresAt, { sec: false })}.</p>
         <div class="actions"><a class="btn" href="/api/v0/export/${esc(x.ready.id)}" download="runward-hosted-export.tar">Télécharger l'archive</a></div>
         <pre class="term" tabindex="0" lang="en">node scripts/replay-export.mjs runward-hosted-export.tar   # rebuilds every index of replay.json</pre>`
        : `<p class="small">Votre passkey vous est demandée pour ce geste, puis l'archive se prépare.</p><div class="actions">${act("export", "Préparer l'archive")}</div>`;
  return { title: "Exporter", key: "acces", signed: "in", html: `${head("accès · exporter", "vérification par geste")}<h1 class="v">Votre archive.</h1>${body}<div class="actions">${go("#/acces", "Revenir à Accès", { q: true })}</div>` };
}
function viewEffacer() {
  return { title: "Effacer ce compte", key: "acces", signed: "in", html: `${head("accès · effacer", "geste d'opérateur dans cette version")}
    <h1 class="v">Effacer ce compte.</h1>
    <p class="face lede">Tout le contenu de la flotte est effacé : dépôts, contenu reçu, index, journal, membres et passkeys.</p>
    <ul class="effets"><li>Exportez d'abord l'archive si vous voulez garder la vue.</li><li>L'effacement est fait dans les 30 jours de la demande. Les sauvegardes l'oublient au plus tard 7 jours après.</li><li>Reste seulement, au journal de l'opérateur : l'empreinte du compte, la date et la dernière tête du journal, sans aucun nom.</li></ul>
    <p>Pour l'instant, l'opérateur du service fait ce geste, par un run approuvé du dépôt d'opérateur.</p>
    <div class="actions">${go("#/acces/export", "Exporter d'abord")}${go("#/acces", "Revenir à Accès", { q: true })}</div>` };
}
