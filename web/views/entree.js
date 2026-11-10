// Entry (signed out): the sign-in and its states. Kept plain on purpose: its layout is being redesigned by
// the author (2026-11-06); its routes, data and states are complete.
import { S, esc } from "./base.js";
import { act, FORGE, PK_PLAIN, mk, go, head } from "./marks.js";
import { viewAccueil } from "./accueil.js";

export function viewEntree(sub) {
  const intent = S.intent && sub === "connexion" ? `<p class="intent" role="note">Connectez-vous pour ouvrir cette page : <code>${esc(S.intent)}</code>. Vous y reviendrez juste après.</p>` : "";
  const signin = `<div class="actions">${act("signin", "Se connecter avec ma passkey", { k: "device" })}${act("signin", "Ma passkey est sur mon téléphone", { q: true, k: "phone" })}</div>`;
  if (sub === "") return viewAccueil();
  const V = {
    connexion: ["Connexion", `<h1 class="v">Ce que vos missions prouvent, au même endroit.</h1>
      <p class="face">Chaque CI envoie ce que runward a écrit. Vous lisez la vue de runward-fleet, la même que chez vous, derrière votre passkey.</p>
      ${intent}${signin}${FORGE}${PK_PLAIN}
      <p class="note">Plus aucune passkey ? <a href="#/reprise">Reprendre l'accès</a>. Pas encore d'accès ? <a href="#/entree/sans-compte">Comment on entre</a>.</p>`],
    attente: ["Connexion en cours", `<h1 class="v">Validez sur votre appareil.</h1>
      <p class="face">Votre navigateur vous demande votre passkey. Rien n'est accordé tant que vous ne l'avez pas validée.</p>
      <div class="charge" role="progressbar" aria-label="En attente de la passkey"></div><p class="note">La demande reste valable 5 minutes.</p>`],
    echec: ["Passkey non acceptée", `<h1 class="v">La validation n'a pas abouti.</h1>
      <p class="face">${mk("inv", "non acceptée")} Elle a été annulée sur l'appareil, ou elle n'a pas répondu. Rien n'a été accordé.</p>
      <div class="actions">${act("signin", "Réessayer avec ma passkey", { k: "device" })}${act("signin", "Utiliser mon téléphone", { q: true, k: "phone" })}</div>
      <p class="note">Plus aucune passkey ? <a href="#/reprise">Reprendre l'accès</a>.</p>`],
    inconnue: ["Passkey inconnue", `<h1 class="v">Cette passkey n'ouvre aucun accès ici.</h1>
      <p class="face">${mk("inv", "inconnue")} Elle n'est enregistrée pour aucun membre de ce service. Elle a peut-être été retirée, ou créée pour un autre site.</p>
      <div class="actions">${act("signin", "Essayer une autre passkey", { k: "device" })}${act("signin", "Utiliser mon téléphone", { q: true, k: "phone" })}</div>
      <p class="note">Vous étiez membre et n'avez plus de passkey valable ? <a href="#/reprise">Reprendre l'accès</a>. Sinon, <a href="#/entree/sans-compte">comment on entre</a>.</p>`],
    expiree: ["Demande expirée", `<h1 class="v">La demande a expiré.</h1><p class="face">${mk("void", "expirée")} Elle a duré plus de 5 minutes. Rien n'a été accordé.</p><div class="actions">${go("#/entree/connexion", "Recommencer")}</div>`],
    "sans-passkey": ["Navigateur sans passkey", `<h1 class="v">Ce navigateur ne propose pas de passkey.</h1>
      <p class="face">Il ne sait pas créer ni utiliser de passkey ici : navigation privée, poste partagé, ou navigateur trop ancien.</p>
      <p class="note">Ouvrez cette page dans votre navigateur habituel ; s'il propose les passkeys, il affiche aussi un code QR pour valider avec votre téléphone.</p>`],
    "sans-compte": ["Comment on entre", `<h1 class="v">L'accès est ouvert par l'opérateur du service.</h1>
      <p class="face">runward hébergé rassemble ce que les missions d'une équipe prouvent. Chaque accès est ouvert par l'opérateur, avec un lien à usage unique ; il n'y a pas d'inscription en libre-service.</p>
      <p>Pour lire vos propres missions sans compte, runward-fleet construit la même vue chez vous, à partir des mêmes fichiers : <a href="https://runward.dev" rel="noreferrer">runward.dev</a>.</p>
      <div class="actions">${go("#/entree/connexion", "Revenir à la connexion", { q: true })}</div>`],
    sortie: ["Déconnecté", `<h1 class="v">Vous êtes déconnecté.</h1>
      <p class="face">${mk("void", "session fermée")} Cette session est fermée sur ce navigateur. Vos autres sessions restent ouvertes ; vous pouvez les fermer depuis Accès.</p>
      <div class="actions">${go("#/entree/connexion", "Se reconnecter")}</div>`],
    "session-fermee": ["Session fermée", `<h1 class="v">Votre session s'est fermée.</h1>
      <p class="face">${mk("void", "fermée")} La passkey qui l'avait ouverte vient d'être retirée, comme annoncé. Connectez-vous avec une passkey qui vous reste.</p>${signin}`],
    fin: ["Session expirée", `<h1 class="v">Votre session a pris fin.</h1>
      <p class="face">Après 12 heures sans activité, ou 7 jours au plus, la session se ferme. Reconnectez-vous ; vous reviendrez où vous étiez.</p>${signin}`],
  };
  const v = V[sub];
  if (!v) return null;
  return { title: v[0], key: "entree", signed: "out", html: `${head("runward hébergé · connexion", "par passkey")}<section>${v[1]}</section>` };
}
