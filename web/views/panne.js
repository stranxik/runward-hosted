// Outage, offline, slow start.
import { S, esc } from "./base.js";
import { mk, reqNote, act, head } from "./marks.js";

export function viewPanne(sub) {
  const r = S.error;
  const V = {
    "": ["Service injoignable", "Le service ne répond pas.", `<p class="face">${mk("inv", "injoignable")} La page n'a pas pu lire votre session. Vos données ne sont pas perdues.${reqNote(r)}</p><div class="actions">${act("reload-screen", "Réessayer")}</div>
      <p class="note">Côté CI : l'étape d'envoi réessaie, puis le dit dans le résumé du job sans faire échouer votre CI. Un envoi qui n'est pas parti se renvoie en relançant le job.</p>`],
    "hors-ligne": ["Hors ligne", "Votre navigateur est hors ligne.", `<p class="face">${mk("void", "hors ligne")} Aucune vérification par passkey n'est lancée tant que la connexion n'est pas revenue. Ce qui est affiché reste lisible.</p><div class="actions">${act("reload-screen", "Réessayer")}</div>`],
    lent: ["Réveil lent", "Le service met plus de temps que d'habitude.", `<p class="face">Le service redémarre après une période sans visite ; cela prend d'habitude quelques secondes, et cette fois plus de 20.</p><div class="charge" role="progressbar" aria-label="En attente du service"></div><div class="actions">${act("reload-screen", "Réessayer")}</div>`],
  };
  const v = V[sub];
  if (!v) return null;
  return { title: v[0], key: "panne", signed: "any", html: `${head("runward hébergé · état du service", "lu sur /api/health")}<h1 class="v">${esc(v[1])}</h1>${v[2]}` };
}
