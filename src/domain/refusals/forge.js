// The refusals of the forge port (ADR-0029): GitLab's rules for an upload, the confirmation bound to what
// the screen shows, and the gestures on a registered instance. One meaning per code; none of GitHub's rule
// codes is ever answered to a GitLab token, and none of these to a GitHub one, `confirmation-stale` apart.
//
// Pure data: no import, no clock, no I/O.

/** @type {Record<string, import("./floor.js").RefusalDef>} */
export const FORGE = {
  // ---- the upload from GitLab (section 3)
  "token-too-old": { status: 401, fr: ["Le jeton a plus de 10 minutes.", "Garder le job d'envoi séparé du job qui calcule, sans clone et sur une image légère ; vérifier aussi l'horloge de l'instance."], en: ["The token is more than 10 minutes old.", "Keep the send job apart from the job that computes, with no clone and a light image; check the instance's clock too."] },
  "key-retired": { status: 401, fr: ["La clé qui a signé ce jeton a été retirée, ou a expiré.", "Enregistrer la clé courante de l'instance dans l'app, ou confirmer la clé de nouveau."], en: ["The key that signed this token was retired, or has expired.", "Register the instance's current key in the app, or confirm the key again."] },
  "definition-absent": { status: 403, fr: ["Le jeton ne nomme pas la définition du pipeline.", "Garder la définition du pipeline dans le dépôt : une définition placée dans un autre projet n'envoie pas."], en: ["The token does not name the pipeline definition.", "Keep the pipeline definition in the repository: a definition kept in another project does not upload."] },
  "definition-not-pinned": { status: 403, fr: ["La définition du pipeline n'est pas celle confirmée pour ce dépôt.", "Confirmer la définition dans l'app : projet renommé ou déplacé, branche ou fichier déclarés changés."], en: ["The pipeline definition is not the one confirmed for this repository.", "Confirm the definition in the app: a renamed or moved project, a declared branch or file that changed."] },
  "commit-mismatch": { status: 403, fr: ["La définition du pipeline n'est pas au commit du code.", "Rien : seul un pipeline dont la définition est au commit envoyé est reçu."], en: ["The pipeline definition is not at the code's commit.", "Nothing: only a pipeline whose definition is at the commit sent is received."] },
  "ref-not-declared": { status: 403, fr: ["La référence n'est pas la branche déclarée.", "Rien : seule la branche déclarée envoie ; elle se change dans l'app."], en: ["The ref is not the declared branch.", "Nothing: only the declared branch uploads; it is changed in the app."] },
  "ref-not-protected": { status: 403, fr: ["La branche déclarée n'est pas protégée.", "Protéger la branche dans GitLab, ou lever cette exigence pour ce dépôt dans l'app."], en: ["The declared branch is not protected.", "Protect the branch in GitLab, or lift this requirement for this repository in the app."] },
  "source-not-admitted": { status: 403, fr: ["Ce pipeline n'a pas été lancé par un push.", "Rien : seul un push envoie."], en: ["This pipeline was not started by a push.", "Nothing: only a push uploads."] },

  // ---- the confirmation, for every forge (section 1)
  "confirmation-stale": { status: 409, fr: ["Les valeurs à épingler ne sont plus celles affichées.", "Relire les nouvelles valeurs, puis confirmer."], en: ["The values to pin are no longer the ones shown.", "Read the new values, then confirm."] },

  // ---- the declaration on another forge
  "issuer-unknown": { status: 404, fr: ["Cette instance n'est pas enregistrée dans cette flotte, ou ce service ne reçoit pas encore d'elle.", "Enregistrer l'instance dans Accès."], en: ["This instance is not registered in this fleet, or this service does not receive from it yet.", "Register the instance in Access."] },
  "repository-path-unsupported": { status: 400, fr: ["La vue ne sait pas encore nommer ce dépôt : son chemin a plus de deux segments, ou l'hôte de son instance porte un port.", "Rien pour l'instant : il se déclarera quand le service aura épinglé une version de runward-fleet qui lit ces noms."], en: ["The view cannot name this repository yet: its path has more than two segments, or its instance's host carries a port.", "Nothing for now: it can be declared once the service pins a runward-fleet version that reads such names."] },

  // ---- a registered instance (section 4)
  "issuer-malformed": { status: 400, fr: ["L'adresse de l'émetteur n'est pas lisible.", "L'écrire comme le champ iss des jetons de l'instance : http ou https, l'hôte, le port s'il y en a un."], en: ["The issuer's address cannot be read.", "Write it as the iss claim of the instance's tokens reads: http or https, the host, the port if there is one."] },
  "issuer-not-allowed": { status: 400, fr: ["Cet émetteur ne s'enregistre pas.", "Les forges publiques (gitlab.com, github.com) ne s'enregistrent pas comme instance : seule une instance de votre organisation s'enregistre ici."], en: ["This issuer cannot be registered.", "Public forges (gitlab.com, github.com) are not registered as an instance: only an instance of your organisation is registered here."] },
  "issuer-limit": { status: 409, fr: ["Cette flotte a déjà 5 instances enregistrées.", "Retirer une instance qui ne sert plus."], en: ["This fleet already has 5 registered instances.", "Remove an instance no longer in use."] },
  "issuer-in-use": { status: 409, fr: ["Un dépôt est déclaré sur cette instance.", "Retirer d'abord ses dépôts."], en: ["A repository is declared on this instance.", "Remove its repositories first."] },
  "key-malformed": { status: 400, fr: ["Cette clé n'est pas une clé publique RSA que le service admet.", "Coller le jeu de clés publiques de l'instance (/oauth/discovery/keys) et le kid de l'en-tête d'un jeton de CI."], en: ["This key is not an RSA public key the service admits.", "Paste the instance's public key set (/oauth/discovery/keys) and the kid of a CI token's header."] },
  "key-exists": { status: 409, fr: ["Cette clé a été retirée de cette instance.", "Une clé retirée ne revient pas : enregistrer une clé neuve de l'instance."], en: ["This key was retired from this instance.", "A retired key does not come back: register a new key of the instance."] },
  "key-limit": { status: 409, fr: ["Cette instance a déjà 4 clés actives.", "Retirer une clé qui ne signe plus."], en: ["This instance already has 4 live keys.", "Retire a key that no longer signs."] },
};
