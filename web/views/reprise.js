// Recovery, explained to someone who lost every passkey.
import { head } from "./marks.js";

export function viewReprise() {
  return { title: "Reprendre l'accès", key: "entree", signed: "out", html: `${head("runward hébergé · reprise d'accès", "après la perte de toutes vos passkeys")}
    <h1 class="v">Vous avez perdu toutes vos passkeys.</h1>
    <p class="face lede">La reprise vous rend la flotte en trois gestes. Elle prend 24 heures, pour que personne ne puisse la faire à votre place sans que vous le voyiez.</p>
    <ol class="steps">
      <li><div class="body"><h3>Tirez un lien de reprise sur votre poste</h3><pre class="term" tabindex="0" lang="en">npm run operateur:reprise -- --tenant &lt;flotte&gt; --member &lt;membre&gt;</pre>
        <p class="note">Le lien s'affiche sur votre poste, et seulement là. Seule son empreinte part vers le service, par un run d'opérateur que vous approuvez.</p></div></li>
      <li><div class="body"><h3>Attendez 24 heures</h3><p>Pendant ce délai, toute session encore ouverte de votre flotte affiche la reprise et peut l'annuler. Un ticket du dépôt d'opérateur vous en avertit.</p></div></li>
      <li><div class="body"><h3>Ouvrez le lien et créez une passkey</h3><p>Toutes les sessions se ferment et vos anciennes passkeys sont retirées. Ajoutez ensuite une seconde passkey, dans un autre trousseau si possible.</p></div></li>
    </ol>
    <p class="note">Limite, dite telle quelle : un agent qui a accès à votre poste et à votre compte GitHub peut lui aussi tirer et approuver une reprise. Le délai, l'avis dans vos sessions et la notification la rendent visible et annulable ; ils ne l'empêchent pas.</p>` };
}
