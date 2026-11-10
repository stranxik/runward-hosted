// Access: gestures that withdraw, then restore. One confirmation box for every gesture that asks one.
import { S, esc } from "./base.js";
import { mk } from "./marks.js";

export const KINDS = {
  passkey: { q: "Retirer cette passkey ?", b: "Retirer la passkey", g: "passkey-remove" },
  session: { q: "Fermer cette session ?", d: "L'appareil qui l'utilise devra se reconnecter avec une passkey.", b: "Fermer la session", g: null },
  repo: { q: "Retirer ce dépôt de l'inventaire ?", d: "Ses prochains envois ne seront plus acceptés (repository-not-declared) et ses missions quittent la flotte au prochain index. Vous pouvez le remettre pendant 30 jours ; ensuite, le contenu reçu est effacé. Les envois arrivés pendant le retrait restent au journal, non publiés.", b: "Retirer le dépôt", g: null },
  consent: { q: "Retirer le consentement au contenu ?", d: "Les prochains envois de ce dépôt ne seront plus acceptés (content-not-consented).", b: "Retirer le consentement", g: "consent-withdraw", choice: true },
  consentir: { q: "Consentir au contenu de ce dépôt ?", d: "Ce service recevra le verdict, les écarts, les livrables et les noms déclarés par la charte. Vous pouvez le retirer à tout moment.", b: "Consentir au contenu", g: "consent" },
  purge: { q: "Effacer le contenu reçu de ce dépôt ?", d: "Les octets reçus sont retirés du stockage et l'index est reconstruit sans eux. Le journal garde les empreintes et la trace de l'effacement. Les sauvegardes l'oublient au plus tard 7 jours après.", b: "Effacer le contenu", g: "content-erase" },
  restore: { q: "Remettre cette passkey ?", d: "Elle pourra de nouveau ouvrir une session. Une autre de vos passkeys vous est demandée.", b: "Remettre la passkey", g: null },
  restorerepo: { q: "Remettre ce dépôt ?", d: "Il retrouve sa place dans l'inventaire, avec ses missions ; ses prochains envois seront acceptés. Les envois arrivés pendant le retrait restent au journal, non publiés.", b: "Remettre le dépôt", g: null },
  reader: { q: "Retirer le lecteur automatique ?", d: "Le job témoin ne pourra plus lire l'index ni l'archive ; les mesures S1 et S2 s'arrêtent.", b: "Retirer le lecteur", g: "reader-withdraw" },
  readeron: { q: "Autoriser le lecteur automatique ?", d: "Le workflow temoin.yml de stranxik/runward-hosted lira l'index et l'archive de cette flotte chaque jour, pour les mesures S1 et S2. Chaque lecture est écrite au journal ; vous pouvez le retirer ici.", b: "Autoriser le lecteur", g: "reader-authorize" },
  closeothers: { q: "Fermer toutes les autres sessions ?", d: "Seule cette session reste ouverte.", b: "Fermer les autres sessions", g: null },
  recovery: { q: "Annuler la reprise d'accès ?", d: "Le lien de reprise ne servira plus. Si vous n'êtes pas à l'origine de cette reprise, retirez aussi les accès que vous ne reconnaissez pas.", b: "Annuler la reprise", g: "recovery-cancel" },
  lang: { q: "Changer la langue de la flotte ?", d: "Elle est écrite dans l'inventaire : la changer reconstruit l'index, et le journal le dit.", b: "Changer la langue", g: null },
};
export function confirmBox(k) {
  if (S.confirming !== k) return "";
  const [kind, id] = k.split(":");
  const t = KINDS[kind];
  let d = t.d;
  if (kind === "passkey" && S.access) {
    const opened = S.access.sessions.filter((s) => s.openedBy === id);
    const cur = opened.some((s) => s.current);
    d = `Vous ne pourrez plus vous connecter avec elle, et les sessions qu'elle a ouvertes se ferment${opened.length ? ` (${opened.map((s) => s.device ?? "appareil").join(", ")})` : ""}.${cur ? " Cette session-ci en fait partie : vous serez déconnecté." : ""} Vous pourrez la remettre pendant 24 heures, avec une autre passkey.`;
  }
  const geste = t.g ? "Votre passkey vous est demandée pour ce geste." : "Votre passkey vous est redemandée si votre dernière vérification date de plus de 5 minutes.";
  if (S.busy === k) return `<div class="confirm" role="group" aria-label="${esc(t.q)}"><p><b>Validez sur votre appareil.</b> ${esc(geste)}</p><div class="charge" role="progressbar" aria-label="En attente de la passkey"></div></div>`;
  const failed = S.failed === k ? `<p class="erreur" role="alert">${mk("inv", "non vérifié")} ${esc(S.failedText ?? "La vérification n'a pas abouti. Rien n'a changé.")}</p>` : "";
  const choice = t.choice ? `<fieldset class="choix"><legend class="k">Le contenu déjà reçu</legend>
      <label class="check"><input type="radio" name="sort" value="garder" checked><span>Le garder jusqu'au retrait du dépôt</span></label>
      <label class="check"><input type="radio" name="sort" value="effacer"><span>L'effacer maintenant</span></label></fieldset>` : "";
  return `<div class="confirm" role="group" aria-label="${esc(t.q)}">${failed}<p><b>${esc(t.q)}</b> ${esc(d)}</p>${choice}
    <p class="small soft">${esc(geste)}</p>
    <div class="actions"><button class="btn" type="button" data-do="confirm" data-k="${esc(k)}" data-focus>${esc(t.b)}</button><button class="btn btn-q" type="button" data-do="cancel">Annuler</button></div></div>`;
}
export const ask = (k, label, q = true) => `<button class="${q ? "btn btn-q" : "lien-btn"}" type="button" data-do="ask" data-k="${esc(k)}" data-focus-key="${esc(k)}">${esc(label)}</button>`;
