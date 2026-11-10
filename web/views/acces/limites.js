// Access, section: what the service keeps, and its limits, said as they are.

/** What is kept, and what the service does not protect from. */
export function sectionLimites(a) {
  return `<section class="blk"><h2>Ce que ce service garde, et ses limites</h2>
      <ul class="small limites">
        <li>Le contenu reçu d'un dépôt est gardé tant qu'il est déclaré, puis ${a.retention.removedRepositoryDays} jours. Les sauvegardes de la base sont gardées ${a.retention.backupDays} jours.</li>
        <li>Tout ce qui pilote ce navigateur, un agent compris, peut lire votre flotte tant que la session est ouverte. Les gestes lourds redemandent votre passkey à chaque fois, l'ajout d'une passkey compris ; chaque ajout s'affiche dans vos autres sessions.</li>
        <li>Le workflow de votre dépôt décide d'appeler ou non l'envoi : le relevé donne le commit du dernier envoi accepté, et le lecteur automatique signale un écart avec <code>main</code>.</li>
        <li>Un agent qui a accès à votre poste et à votre compte GitHub peut ouvrir une reprise d'accès : elle attend 24 heures et s'affiche ici pour que vous l'annuliez.</li>
        <li>Ce que prouve l'envoi : il vient du workflow du service, dans la CI de ce dépôt, sur <code>main</code>, à tel commit. Le contenu jugé reste déclaré par la CI (<code>ci-declared</code>).</li>
        <li>Votre accès ne dépend pas de votre compte de forge : vos passkeys suffisent.</li>
      </ul></section>`;
}
