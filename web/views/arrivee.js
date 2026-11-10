// First arrival. Kept plain on purpose: its layout is being redesigned by the author (2026-11-06); its
// routes, data and states are complete.
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { loadingView, mk, act, go, head } from "./marks.js";
import { snippet } from "./workflow.js";
import { declareForm } from "./declarer.js";

export function viewArrivee(sub) {
  const s = S.session, a = S.access;
  if (!a) return loadingView("Première arrivée");
  const live = a.passkeys.filter((p) => !p.removedAt);
  const open = s.arrivalOpen;
  const pinned = a.repositories.filter((r) => r.state === "pinned");
  const pkLine = (p) => `${mk("full", [p.provider ?? p.device ?? "passkey", p.phone ? "téléphone, par QR code" : p.synced === false ? "liée à cet appareil" : p.synced ? "synchronisée" : null].filter(Boolean).join(" · "))} <span class="soft">enregistrée</span>`;
  const msg = sub === "seconde-annulee" ? `<p class="erreur" role="alert">${mk("void", "rien d'ajouté")} La création a été annulée sur l'appareil. Réessayez, ou choisissez une autre voie.</p>`
    : sub === "seconde-existe" ? `<p class="erreur" role="alert">${mk("inv", "déjà là")} Cet appareil porte déjà la passkey de votre compte, par son trousseau synchronisé. Choisissez une clé de sécurité ou un autre gestionnaire.</p>` : "";
  const WAYS = `<div class="actions">${act("addpk", "Ajouter une clé de sécurité", { k: "key" })}${act("addpk", "Utiliser un autre gestionnaire de passkeys", { q: true, k: "device" })}${act("addpk", "Sur mon téléphone, par code QR", { q: true, k: "phone" })}</div>
      <p class="note">Votre téléphone partage sans doute le trousseau de cette passkey (iCloud, ou le gestionnaire de Google) : il porte déjà la même, et ne peut pas en ajouter une seconde distincte. Ce qui marche : une clé de sécurité, un autre gestionnaire (celui de Chrome, 1Password), ou un téléphone connecté à un autre compte.</p>`;
  let step1;
  if (sub === "seule") step1 = `<div class="confirm" role="group" aria-label="Continuer avec une seule passkey"><p><b>Continuer avec une seule passkey ?</b> Si vous perdez cet appareil ou ce trousseau, la seule voie sera la reprise d'accès, qui prend 24 heures. Ce choix est écrit au journal, et chaque écran vous le rappellera jusqu'à l'ajout d'une seconde passkey.</p>
      <p class="small soft">Votre passkey vous est demandée pour ce geste.</p><div class="actions">${act("single", "Continuer avec une seule passkey")}${go("#/arrivee", "Revenir aux voies possibles", { q: true })}</div></div>`;
  else if (live.length >= 2) {
    // "two providers" is said only when both providers are known and differ; the AAGUID is declared, often absent
    const known = live.map((p) => p.provider);
    const distinct = known.every(Boolean) && new Set(known).size === known.length;
    step1 = `<p>${live.map(pkLine).join("<br>")}</p>${s.sameProvider ? `<p class="avert">Vos deux passkeys sont dans le même trousseau : perdre ce compte vous ferme les deux.</p>` : distinct ? `<p class="note">Deux fournisseurs : perdre l'un ne vous ferme pas la porte.</p>` : `<p class="note">Deux passkeys enregistrées. Leur fournisseur n'est pas toujours connu : si elles sont dans le même trousseau, perdre ce compte vous ferme les deux.</p>`}`;
  }
  else if (s.single) step1 = `<p>${live.map(pkLine).join("")} <span class="soft">seule passkey, choix écrit au journal</span></p>${WAYS}`;
  else step1 = `<p>${live.map(pkLine).join("")}</p>${msg}${WAYS}<p class="small"><button class="lien-btn" type="button" data-go="#/arrivee/seule">Je n'ai aucune seconde voie : continuer avec une seule passkey</button></p>
      <p class="note">${pinned.length ? "La flotte s'ouvre après ce choix." : "Les étapes suivantes s'ouvrent après ce choix."} Si vous fermez cette page avant, vous reviendrez ici à la prochaine connexion.</p>`;
  const ferme = `<p class="note ferme-note">S'ouvre après la seconde passkey, ou le choix d'une seule.</p>`;
  if (pinned.length) {
    return { title: "Bienvenue", key: "arrivee", signed: "in", html: `${head(`arrivée · ${esc(s.tenant.title)}`, `${live.length} passkey${live.length > 1 ? "s" : ""} · ${pinned.length} dépôt${pinned.length > 1 ? "s" : ""} déclaré${pinned.length > 1 ? "s" : ""}`)}
      <h1 class="v">Retrouvez votre flotte.</h1><p class="face lede">Ajoutez une seconde passkey, puis retrouvez la flotte telle qu'elle est : ses dépôts sont déjà déclarés.</p>
      <ol class="steps"><li><div class="body"><h3>Ajoutez une seconde passkey</h3>${step1}</div></li>
        <li class="${open ? "" : "ferme"}"><div class="body"><h3>Ouvrez la flotte</h3>${open ? `<div class="actions">${go("#/", "Ouvrir la flotte")}</div>` : ferme}</div></li></ol>` };
  }
  const declared = a.repositories.filter((r) => r.state === "pending")[0];
  const step2 = !open ? ferme : declared
    ? `<p>${mk("half", "en attente du premier envoi")} <span data-verbatim translate="no">${esc(declared.name)}</span>, mission${declared.missions.length > 1 ? "s" : ""} ${declared.missions.map((m) => `<code>${esc(m.id)}</code>`).join(", ")}, workflow appelant <code>${esc(declared.workflow)}</code>, ${declared.consent ? "contenu consenti" : "contenu non consenti"}.</p>
       <p class="note">La déclaration expire le ${when(declared.expiresAt, { sec: false })} si rien n'arrive. Sans consentement au contenu, le premier envoi sert seulement à confirmer le dépôt : ses octets ne sont pas gardés.</p>`
    : declareForm();
  const step4 = !open ? ferme : declared?.pendingSend
    ? `<p>${mk("half", "à confirmer")} Le premier envoi de <span data-verbatim translate="no">${esc(declared.name)}</span> est arrivé.</p><div class="actions">${go(`#/declarer/confirmer/${declared.id}`, "Confirmer le premier envoi")}</div>`
    : `<p class="note">La mission apparaît après la fin du job de CI et votre confirmation. Cette page ne se met pas à jour seule : revenez-y après votre fusion.</p><div class="actions">${act("reload-screen", "Vérifier l'arrivée du premier envoi", { q: true })}</div>`;
  return { title: "Première arrivée", key: "arrivee", signed: "in", html: `${head(`première arrivée · ${esc(s.tenant.title)}`, `${live.length} passkey${live.length > 1 ? "s" : ""} · ${declared ? 1 : 0} dépôt déclaré`)}
    <h1 class="v">Préparez votre flotte.</h1>
    <p class="face lede">Quatre gestes, puis votre prochaine fusion sur <code>main</code> fait arriver le premier envoi, que vous confirmez ici.</p>
    <ol class="steps">
      <li><div class="body"><h3>Ajoutez une seconde passkey</h3>${step1}</div></li>
      <li class="${open ? "" : "ferme"}"><div class="body"><h3>Déclarez le dépôt</h3>${step2}</div></li>
      <li class="${open ? "" : "ferme"}"><div class="body"><h3>Appelez le workflow d'envoi dans votre CI</h3>${open ? snippet(declared) : ferme}</div></li>
      <li class="${open ? "" : "ferme"}"><div class="body"><h3>Fusionnez sur main, puis confirmez le premier envoi</h3>${step4}</div></li>
    </ol>` };
}
