// The public home (signed out). Data-free on purpose: no example fleet is shown on the service's screens.
import { chipOf, MAILTO } from "./lexique.js";

export function viewAccueil() {
  const etat = (v, txt) => `<div class="etat-a">${chipOf(v)}<p>${txt}</p></div>`;
  const wf = `<pre class="term" lang="en" tabindex="0">name: runward
on:
  push: { branches: [main] }
  pull_request:
permissions: {}
jobs:
  runward:
    permissions: { contents: read, id-token: write }
    uses: stranxik/runward-hosted/.github/workflows/send.yml@&lt;release&gt;
    with:
      mission: &lt;mission&gt;
<span class="c" lang="fr"># aucun « secrets. » : la CI se présente par OIDC</span></pre>`;
  const journal = `<dl class="cl"><dt>dépôt</dt><dd>propriétaire/dépôt, par son identifiant</dd><dt>workflow appelant</dt><dd>celui que vous avez déclaré</dd><dt>workflow d'envoi</dt><dd>celui du service, à son commit</dd><dt>run</dt><dd>numéro, tentative</dd><dt>commit</dt><dd>celui qui a été jugé</dd><dt>émetteur</dt><dd translate="no">token.actions.githubusercontent.com</dd></dl>`;
  const attend = `<dl class="cl"><dt>état</dt><dd>l'un des quatre, par sa forme et son mot</dd><dt>mission</dt><dd>son nom déclaré</dd><dt>cause</dt><dd>la porte où elle bute, ou l'envoi qui n'a pas été accepté</dd><dt>source</dt><dd>le fichier, le commit et l'entrée du journal</dd><dt>geste suivant</dt><dd>la commande à lancer dans le dépôt, ou l'écran où agir</dd></dl>`;
  const etats = `${etat("gaps", "la porte où la mission bute, et le livrable qui manque")}${etat("level-not-met", "les portes franchies, mais rien n'y est vérifié mécaniquement")}${etat("not-observed", "aucun envoi accepté, et pourquoi")}${etat("clean", "toutes les portes franchies, sans écart")}`;
  const etapes = [
    ["1", "La CI envoie", "Un workflow publié par le service, épinglé par son commit, lance <code>runward check</code> sur votre commit et envoie ce que runward a écrit. Votre CI se présente par OIDC : aucun secret n'est rangé.", wf],
    ["2", "Le service assemble", "Il lit qui envoie dans le jeton signé par GitHub, écrit chaque envoi au journal, accepté ou non, avec ce qu'il retient :", journal],
    ["3", "Vous lisez", "En tête, ce qui vous attend, mission par mission, dans l'un de quatre états, et chaque nombre renvoie à son fichier source. Chaque ligne dit :", attend],
  ];
  return { title: "Accueil", key: "entree", signed: "out", public: true, html: `<div class="acc">
    <section class="hero"><div class="hero-g">
      <div><h1>Ce que vos missions prouvent, au même endroit.</h1>
        <p class="lede">Chaque CI envoie ce que runward a jugé. Vous voyez quelle mission est refusée, laquelle n'atteint pas son niveau, laquelle se tait, et d'où vient chaque nombre.</p>
        <div class="actions"><a class="btn btn-l" href="${MAILTO}">Demander l'accès à la préversion</a><button class="btn btn-q btn-l" type="button" data-do="scroll" data-k="marche">Voir comment ça marche</button></div>
        <p class="note">L'accès s'ouvre sur invitation. Déjà membre ? <button class="lien-btn" type="button" data-go="#/entree/connexion">Se connecter</button>. Sans compte, <code>runward-fleet</code> construit la même vue chez vous.</p></div>
      <div class="etats-a hero-etats" aria-label="Les quatre états d'une mission">${etats}</div></div></section>
    <section class="bp" id="marche">
      <h2 class="ts">Trois gestes, et aucun n'est à vous.</h2>
      <p class="intro">Vous ajoutez un workflow une fois. Ensuite, chaque commit sur la branche principale met la vue à jour.</p>
      <div class="pas-a">${etapes.map(([n, h, p, e]) => `<div class="pas"><span class="rv">0${n}</span><h3>${h}</h3><p>${p}</p><div class="pas-e">${e}</div></div>`).join("")}</div></section>
    <section class="bp inverse" id="confiance"><div class="inv-w">
      <h2 class="ts">Ce que vous pouvez vérifier sans nous croire.</h2>
      <div class="conf-g">
        <div><h3>Aucun secret dans votre CI</h3><p>Le service lit qui envoie dans le jeton OIDC que GitHub signe pour votre run. Votre workflow ne contient aucune ligne <code>secrets.</code> : il n'y a rien à voler ni à renouveler.</p></div>
        <div><h3>La même vue que chez vous</h3><p>La vue est assemblée par <code>runward-fleet</code>, la bibliothèque MIT que vous lancez déjà. Sur l'archive exportée, <code>runward-fleet build</code> redonne le même index, octet pour octet.</p></div>
        <div><h3>Tout s'exporte</h3><p>Une archive rassemble les envois, le journal et l'index. Elle se relit sans le service, et vous la gardez si vous partez.</p></div>
        <div><h3>Une passkey pour entrer</h3><p>Ni mot de passe, ni compte de forge : le déverrouillage de votre appareil ouvre la vue, et rien d'autre.</p></div></div>
      <div class="empr"><pre class="term" lang="en" tabindex="0"><span class="c">$</span> runward-fleet build fleet.json --out site
<span class="c">$</span> shasum -a 256 site/index.json</pre>
        <div class="compare"><div class="row"><span class="soft-i">en ligne</span><span>l'empreinte de l'index servi, dans la flotte</span></div>
          <div class="row"><span class="soft-i">chez vous</span><span>l'empreinte de l'index reconstruit</span></div>
          <div class="ok"><span class="or" aria-hidden="true">✓</span>même empreinte, donc même vue</div></div></div>
    </div></section>
    <section class="bp final" id="acces-final"><div class="final-g">
      <div><h2 class="ts">Vos dépôts, dans la même vue.</h2><p class="intro">La préversion sert aujourd'hui les dépôts de son mainteneur. Écrivez-nous : l'accès s'ouvre par invitation, avec un lien à usage unique.</p></div>
      <div class="actions"><a class="btn btn-l" href="${MAILTO}">Demander l'accès à la préversion</a><a class="btn btn-q btn-l" href="https://runward.dev" rel="noreferrer">Construire la vue chez moi</a></div></div></section>
  </div>` };
}
