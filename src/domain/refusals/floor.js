// The refusals of the floor (H0): the upload, humans, links, repositories and access. One meaning per code
// (architecture note §3.2, C8). src/domain/refusals/index.js merges this file with the others of this folder
// into the one catalogue the service reads; a code declared twice is refused at start.
//
// Pure data: no import, no clock, no I/O.

/** @typedef {{ status: number, fr: [string, string], en: [string, string], retry?: boolean }} RefusalDef */

/** @type {Record<string, RefusalDef>} */
export const FLOOR = {
  // ---- the upload (PADR-0010)
  "token-missing": { status: 401, fr: ["Aucun jeton d'identité de charge n'accompagne l'envoi.", "Appeler le workflow d'envoi avec id-token: write sur le job appelant."], en: ["No workload identity token came with the upload.", "Call the send workflow with id-token: write on the calling job."] },
  "token-unreadable": { status: 401, fr: ["Le jeton d'identité de charge est illisible.", "Appeler le workflow d'envoi avec id-token: write sur le job appelant."], en: ["The workload identity token cannot be read.", "Call the send workflow with id-token: write on the calling job."] },
  "token-audience": { status: 401, fr: ["Le jeton ne vise pas ce service.", "Ne pas modifier l'audience : le workflow d'envoi la fixe."], en: ["The token is not addressed to this service.", "Do not change the audience: the send workflow sets it."] },
  "token-expired": { status: 401, fr: ["Le jeton est périmé.", "Relancer le job (re-run failed jobs)."], en: ["The token has expired.", "Re-run the job (re-run failed jobs)."] },
  "token-replayed": { status: 401, fr: ["Ce jeton a déjà servi.", "Relancer le job (re-run failed jobs)."], en: ["This token was already used.", "Re-run the job (re-run failed jobs)."] },
  "duplicate-in-run": { status: 409, fr: ["Un autre envoi de même run, tentative, mission et type, d'une autre empreinte, est déjà arrivé.", "N'appeler le workflow d'envoi qu'une fois par mission."], en: ["Another upload of the same run, attempt, mission and kind, with another digest, already arrived.", "Call the send workflow once per mission."] },
  "called-workflow-revoked": { status: 403, fr: ["Cette release du workflow d'envoi a été retirée.", "Monter à la release indiquée."], en: ["This release of the send workflow was withdrawn.", "Move to the release named."] },
  "called-workflow-not-pinned": { status: 403, fr: ["L'envoi ne vient pas du workflow d'envoi du produit à un SHA publié.", "Appeler stranxik/runward-hosted/.github/workflows/send.yml à un SHA publié."], en: ["The upload does not come from the product's send workflow at a published SHA.", "Call stranxik/runward-hosted/.github/workflows/send.yml at a published SHA."] },
  "workflow-not-pinned": { status: 403, fr: ["Le workflow appelant n'est pas celui déclaré pour ce dépôt.", "Appeler depuis le workflow déclaré, ou changer la déclaration dans l'app."], en: ["The calling workflow is not the one declared for this repository.", "Call from the declared workflow, or change the declaration in the app."] },
  "ref-not-main": { status: 403, fr: ["La référence n'est pas refs/heads/main.", "Rien : seul main envoie."], en: ["The ref is not refs/heads/main.", "Nothing: only main uploads."] },
  "event-not-push": { status: 403, fr: ["L'événement n'est pas un push.", "Rien : seul un push envoie."], en: ["The event is not a push.", "Nothing: only a push uploads."] },
  "runner-not-hosted": { status: 403, fr: ["Le runner n'est pas hébergé par GitHub.", "Utiliser un runner hébergé par GitHub."], en: ["The runner is not hosted by GitHub.", "Use a GitHub-hosted runner."] },
  "repository-not-declared": { status: 404, fr: ["Ce dépôt n'est pas déclaré dans ce service.", "Le déclarer, ou le remettre, dans l'app."], en: ["This repository is not declared in this service.", "Declare it, or restore it, in the app."] },
  "repository-pending": { status: 202, fr: ["Premier envoi d'un dépôt en attente : gardé, non publié.", "Confirmer le dépôt dans l'app."], en: ["First upload of a pending repository: kept, not published.", "Confirm the repository in the app."] },
  "owner-changed": { status: 409, fr: ["Le propriétaire du dépôt a changé depuis la confirmation.", "Confirmer le nouveau propriétaire dans l'app, ou retirer le dépôt."], en: ["The repository's owner changed since it was confirmed.", "Confirm the new owner in the app, or remove the repository."] },
  "mission-not-declared": { status: 404, fr: ["Cette mission n'est pas déclarée pour ce dépôt.", "Déclarer la mission, ou corriger l'entrée mission."], en: ["This mission is not declared for this repository.", "Declare the mission, or fix the mission input."] },
  "kind-unknown": { status: 400, fr: ["Ce type d'export n'est pas lu par ce service.", "Mettre à jour le workflow d'envoi à la dernière release."], en: ["This export kind is not one this service reads.", "Update the send workflow to the latest release."] },
  "too-large": { status: 413, fr: ["Le fichier dépasse 2 Mo.", "Mettre à jour le workflow d'envoi à la dernière release."], en: ["The file is larger than 2 MB.", "Update the send workflow to the latest release."] },
  "digest-mismatch": { status: 400, fr: ["L'empreinte annoncée ne correspond pas aux octets reçus.", "Mettre à jour le workflow d'envoi à la dernière release."], en: ["The announced digest does not match the bytes received.", "Update the send workflow to the latest release."] },
  "private-path": { status: 422, fr: ["Un chemin sous un répertoire personnel arriverait dans la vue.", "Envoyer depuis un runner hébergé."], en: ["A path under a home directory would reach the view.", "Upload from a hosted runner."] },
  "content-not-consented": { status: 403, fr: ["Le contenu de ce dépôt n'est pas consenti ; l'attestation et l'historique sont du contenu.", "Consentir au contenu dans l'app."], en: ["The content of this repository is not consented; the attestation and the history are content.", "Consent to the content in the app."] },
  "index-build-refused": { status: 422, fr: ["runward-fleet ne sait pas assembler cet export : il est gardé en quarantaine, la flotte continue.", "Voir le champ nommé ; si le format est plus récent que la version épinglée, attendre la mise à jour du service."], en: ["runward-fleet cannot assemble this export: it is kept in quarantine, the fleet goes on.", "See the field named; if the format is newer than the pinned version, wait for the service update."] },
  "index-rule-broken": { status: 422, fr: ["L'index assemblé casserait une règle de vue : rien n'est publié.", "Rien côté CI ; l'entrée est au journal."], en: ["The assembled index would break a view rule: nothing is published.", "Nothing on the CI side; the entry is in the journal."] },
  "rate-limited": { status: 429, retry: true, fr: ["Plus de 30 runs par heure pour ce dépôt.", "Relancer après l'heure indiquée par Retry-After."], en: ["More than 30 runs in an hour for this repository.", "Re-run after the time given by Retry-After."] },
  "too-many-requests": { status: 429, retry: true, fr: ["Trop de demandes depuis cette adresse, ou vers le service, en une minute.", "Réessayer après le délai indiqué par Retry-After."], en: ["Too many requests from this address, or to the service, within a minute.", "Try again after the time given by Retry-After."] },
  "service-unavailable": { status: 503, retry: true, fr: ["Le service ne répond pas pour l'instant.", "Réessayer dans un moment."], en: ["The service is not answering right now.", "Try again in a moment."] },
  "maintenance": { status: 503, retry: true, fr: ["Le service est en maintenance annoncée.", "Relancer après Retry-After."], en: ["The service is under announced maintenance.", "Re-run after Retry-After."] },

  // ---- humans (PADR-0012)
  "signed-out": { status: 401, fr: ["Vous n'êtes pas connecté.", "Se connecter avec votre passkey."], en: ["You are not signed in.", "Sign in with your passkey."] },
  "passkey-unknown": { status: 401, fr: ["Cette passkey n'ouvre aucun compte ici.", "Essayer une autre passkey, ou demander une invitation."], en: ["This passkey opens no account here.", "Try another passkey, or ask for an invitation."] },
  "challenge-invalid": { status: 400, fr: ["Le défi a expiré ou a déjà servi.", "Recommencer la connexion."], en: ["The challenge expired or was already used.", "Start the sign-in again."] },
  "ceremony-failed": { status: 400, fr: ["La passkey n'a pas pu être vérifiée.", "Réessayer, ou utiliser la passkey de votre téléphone."], en: ["The passkey could not be verified.", "Try again, or use your phone's passkey."] },
  "fresh-required": { status: 403, fr: ["Ce geste demande une vérification de moins de 5 minutes.", "Confirmer avec votre passkey."], en: ["This gesture needs a verification less than 5 minutes old.", "Confirm with your passkey."] },
  "gesture-required": { status: 403, fr: ["Ce geste demande une vérification liée à ce geste.", "Confirmer ce geste avec votre passkey."], en: ["This gesture needs a verification bound to it.", "Confirm this gesture with your passkey."] },
  "fresh-failed": { status: 403, fr: ["La vérification n'a pas abouti.", "Réessayer."], en: ["The verification did not succeed.", "Try again."] },
  "passkey-exists": { status: 409, fr: ["Cet appareil porte déjà une de vos passkeys.", "Utiliser une clé de sécurité, un autre gestionnaire de passkeys ou un téléphone sous un autre compte."], en: ["This device already holds one of your passkeys.", "Use a security key, another passkey manager or a phone under another account."] },
  "last-passkey": { status: 409, fr: ["C'est votre dernière passkey : elle ne se retire pas.", "Ajouter d'abord une autre passkey."], en: ["This is your last passkey: it cannot be removed.", "Add another passkey first."] },
  "restore-window-closed": { status: 409, fr: ["Le délai pour remettre est passé.", "Rien : le retrait est définitif."], en: ["The window to restore has passed.", "Nothing: the removal is final."] },
  "last-owner": { status: 409, fr: ["C'est le dernier propriétaire de cette flotte : il ne se retire pas.", "Donner d'abord le rôle de propriétaire à un autre membre."], en: ["This is the last owner of this fleet: it cannot be removed.", "Give the owner role to another member first."] },
  "not-found": { status: 404, fr: ["Rien à cette adresse.", "Revenir à la flotte."], en: ["Nothing at this address.", "Go back to the fleet."] },
  "same-origin": { status: 403, fr: ["Cette écriture ne vient pas de cette origine.", "Refaire le geste depuis l'app."], en: ["This write does not come from this origin.", "Make the gesture again from the app."] },
  "host-not-allowed": { status: 421, fr: ["Cet hôte n'est pas servi ici.", "Utiliser l'adresse du service."], en: ["This host is not served here.", "Use the service's address."] },
  "body-invalid": { status: 400, fr: ["La requête est mal formée.", "Recharger la page et refaire le geste."], en: ["The request is malformed.", "Reload the page and make the gesture again."] },
  "method-not-allowed": { status: 405, fr: ["Cette méthode n'est pas permise ici.", "Utiliser l'app."], en: ["This method is not allowed here.", "Use the app."] },

  // ---- links (PADR-0012 note 5 bis)
  "link-not-yet": { status: 409, fr: ["Ce lien n'est pas encore utilisable.", "Revenir à l'heure indiquée."], en: ["This link cannot be used yet.", "Come back at the time given."] },
  "link-signed-in": { status: 409, fr: ["Vous êtes déjà connecté à cette flotte : ce lien ne change rien.", "Revenir à la flotte."], en: ["You are already signed in to this fleet: this link changes nothing.", "Go back to the fleet."] },
  "link-used": { status: 410, fr: ["Ce lien a déjà servi.", "Demander un nouveau lien à l'opérateur."], en: ["This link was already used.", "Ask the operator for a new link."] },
  "link-expired": { status: 410, fr: ["Ce lien a expiré.", "Demander un nouveau lien à l'opérateur."], en: ["This link has expired.", "Ask the operator for a new link."] },
  "link-cancelled": { status: 410, fr: ["Ce lien a été annulé.", "Demander un nouveau lien à l'opérateur."], en: ["This link was cancelled.", "Ask the operator for a new link."] },
  "link-invalid": { status: 404, fr: ["Ce lien n'ouvre rien.", "Vérifier le lien reçu, entier."], en: ["This link opens nothing.", "Check the link you received, in full."] },

  // ---- repositories and access (architecture §3.1)
  "repository-malformed": { status: 400, fr: ["Le nom du dépôt doit se lire propriétaire/dépôt.", "Corriger le nom."], en: ["The repository name must read owner/repository.", "Fix the name."] },
  "repository-exists": { status: 409, fr: ["Ce dépôt est déjà déclaré dans cette flotte.", "Le retrouver dans Accès."], en: ["This repository is already declared in this fleet.", "Find it in Access."] },
  "repository-unavailable": { status: 409, fr: ["Ce dépôt ne peut pas être déclaré ici.", "Vérifier le nom, ou écrire au contact sécurité."], en: ["This repository cannot be declared here.", "Check the name, or write to the security contact."] },
  "workflow-malformed": { status: 400, fr: ["Le workflow appelant doit être un fichier de .github/workflows/.", "Corriger le chemin."], en: ["The calling workflow must be a file under .github/workflows/.", "Fix the path."] },
  "branch-malformed": { status: 400, fr: ["Ce nom de branche n'est pas valide.", "Écrire la branche par défaut du dépôt, par exemple main."], en: ["This branch name is not valid.", "Write the repository's default branch, for example main."] },
  "mission-malformed": { status: 400, fr: ["L'identifiant de mission doit être en minuscules, chiffres et tirets.", "Corriger l'identifiant."], en: ["The mission id must be lowercase letters, digits and hyphens.", "Fix the id."] },
  "mission-exists": { status: 409, fr: ["Cette mission existe déjà dans cette flotte.", "Choisir un autre identifiant."], en: ["This mission already exists in this fleet.", "Choose another id."] },
  "mission-has-sends": { status: 409, fr: ["Cette mission a des envois : ils restent au journal.", "Confirmer le retrait en le sachant."], en: ["This mission has uploads: they stay in the journal.", "Confirm the removal knowing it."] },
  "nothing-to-confirm": { status: 409, fr: ["Aucun envoi n'attend de confirmation pour ce dépôt.", "Attendre le premier envoi de la CI."], en: ["No upload awaits confirmation for this repository.", "Wait for the CI's first upload."] },
  "declaration-expired": { status: 410, fr: ["La déclaration a expiré : 7 jours sans envoi.", "Déclarer le dépôt de nouveau."], en: ["The declaration expired: 7 days without an upload.", "Declare the repository again."] },
  "cursor-invalid": { status: 400, fr: ["Cette page du journal n'existe pas.", "Revenir à la première page."], en: ["This page of the journal does not exist.", "Go back to the first page."] },
  "export-too-large": { status: 413, fr: ["L'archive dépasserait 512 Mo.", "Écrire au contact sécurité : l'export par morceaux n'est pas encore là."], en: ["The archive would exceed 512 MB.", "Write to the security contact: chunked export is not there yet."] },
  "reader-not-authorized": { status: 403, fr: ["Ce lecteur n'est pas autorisé pour cette flotte.", "L'autoriser dans Accès."], en: ["This reader is not authorized for this fleet.", "Authorize it in Access."] },
};
