// The service shell of runward hosted (PADR-0016 point 4), ported from the preview of 2026-11-06 onto the
// live API. The fleet views are runward-fleet's views.js, served from the pinned package and imported as is
// (PADR-0011 point 4); this file renders the service screens around them (entry, links, first arrival,
// declare, uploads, access, recovery, outage). Every HTML string goes through one Trusted Types policy;
// every value from the API is escaped here or by views.js. Times are kept in UTC and shown in Paris time
// with their offset. Reads per screen stay within the budget of architecture §6 (4 at most).
// The entry screen and the first signed-in screen are kept plain on purpose: their layout is being
// redesigned by the author (2026-11-06); their routes, data and states are complete.
import { renderView, renderNav, ROUTES } from "__VIEWS__";

const META = (n) => document.querySelector(`meta[name="${n}"]`)?.content ?? "";
const COMMIT = META("runward-commit");
const tt = window.trustedTypes ? window.trustedTypes.createPolicy("runward", { createHTML: (s) => s }) : null;
const setHTML = (el, html) => { el.innerHTML = tt ? tt.createHTML(html) : html; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
const main = $("main"), stampEl = $("stamp"), latEl = $("lat"), mobEl = $("mob"), mobNavEl = $("mobnav"), pubEl = $("pub"), topActEl = $("topact");
const bandEl = $("bandeaux"), piedEl = $("pied"), annonceEl = $("annonce");
const short = (h) => (h ? `${String(h).slice(0, 12)}…` : "");

// ------------------------------------------------------------- times: UTC kept, Paris shown, offset said
const TZ = "Europe/Paris";
const DTF = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const OFF = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, timeZoneName: "longOffset" });
function when(iso, { sec = true } = {}) {
  if (!iso) return `<span class="soft">à dater</span>`;
  const d = new Date(iso);
  let s = DTF.format(d);
  if (!sec) s = s.slice(0, 16);
  const o = (OFF.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT").replace("GMT", "") || "+00:00";
  return `<time datetime="${esc(iso)}">${esc(s)}&nbsp;${esc(o)}</time>`;
}

// ------------------------------------------------------------- marks (the views' grammar: shape and word, never colour)
const mk = (shape, word) => shape === "inv"
  ? `<span class="st chip-inv"><span class="mk mk-full" aria-hidden="true"></span>${esc(word)}</span>`
  : `<span class="st"><span class="mk mk-${shape}" aria-hidden="true"></span>${esc(word)}</span>`;
const rv = (html) => `<span class="rv">${html}</span>`;
const head = (l, r) => `<div class="head">${rv(l)}${rv(r)}</div>`;
const go = (hash, label, { q = false } = {}) => `<button class="btn${q ? " btn-q" : ""}" type="button" data-go="${esc(hash)}">${esc(label)}</button>`;
const act = (name, label, { q = false, k = "", extra = "" } = {}) => `<button class="btn${q ? " btn-q" : ""}" type="button" data-do="${name}"${k ? ` data-k="${esc(k)}"` : ""}${extra}>${esc(label)}</button>`;
const ICON_PK = `<svg class="ico" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><circle cx="8" cy="7.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 20c0-3.2 2.5-5.8 5.5-5.8 1.5 0 2.8.5 3.8 1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="17" cy="12.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M17 15.1V21m0-2.6h2m-2 2h1.4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const FORGE = `<p class="note">Votre accès ne dépend pas de votre compte de forge : vos passkeys suffisent. Ainsi, la clé de vos preuves n'est jamais un compte tenu ailleurs.</p>`;
const PK_PLAIN = `<div class="explique">${ICON_PK}<p class="small">Une passkey, c'est le déverrouillage de votre appareil (empreinte, visage ou code) qui sert de clé pour ce site, et pour lui seul. Rien à retenir, rien à recopier, et elle ne fonctionne sur aucun autre site.</p></div>`;
const reqNote = (r) => (r?.requestId ? ` requête <code>${esc(r.requestId)}</code>` : "");

// ------------------------------------------------------------- the API, same origin only
const S = { session: undefined, index: null, status: null, access: null, journal: null, intent: null, link: null, linkInfo: null, newVersion: false, confirming: null, busy: null, failed: null, error: null, export: null, offline: false };

async function api(method, path, body) {
  let res;
  const started = Date.now();
  const slow = setTimeout(() => { if (!S.slow) { S.slow = true; render(); } }, 20_000);
  try {
    res = await fetch(path, { method, credentials: "same-origin", headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    clearTimeout(slow);
    return { ok: false, status: 0, network: true, refusal: navigator.onLine === false ? "offline" : "network" };
  }
  clearTimeout(slow);
  S.slow = false;
  const v = res.headers.get("runward-version");
  if (v && COMMIT && v !== COMMIT && !S.newVersion) { S.newVersion = true; }
  const requestId = res.headers.get("runward-request-id");
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 401 && data?.refusal === "signed-out" && path !== "/api/v0/session") { S.session = null; }
  return { ok: res.ok, status: res.status, data, refusal: data?.refusal ?? null, message: data?.message, action: data?.action, requestId, ms: Date.now() - started };
}

// ------------------------------------------------------------- WebAuthn in the browser (JSON options from the server)
const b64u = { dec: (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)), enc: (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
const hasPasskeys = () => typeof window.PublicKeyCredential === "function" && !!navigator.credentials;
function creationOptions(o, hints) {
  if (PublicKeyCredential.parseCreationOptionsFromJSON) return PublicKeyCredential.parseCreationOptionsFromJSON({ ...o, ...(hints ? { hints } : {}) });
  return { ...o, challenge: b64u.dec(o.challenge), user: { ...o.user, id: b64u.dec(o.user.id) }, excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ ...c, id: b64u.dec(c.id) })), ...(hints ? { hints } : {}) };
}
function requestOptions(o, hints) {
  if (PublicKeyCredential.parseRequestOptionsFromJSON) return PublicKeyCredential.parseRequestOptionsFromJSON({ ...o, ...(hints ? { hints } : {}) });
  return { ...o, challenge: b64u.dec(o.challenge), allowCredentials: (o.allowCredentials ?? []).map((c) => ({ ...c, id: b64u.dec(c.id) })), ...(hints ? { hints } : {}) };
}
function credJSON(c) {
  if (typeof c.toJSON === "function") return c.toJSON();
  const r = c.response;
  return {
    id: c.id, rawId: b64u.enc(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment ?? undefined, clientExtensionResults: c.getClientExtensionResults?.() ?? {},
    response: r.attestationObject
      ? { clientDataJSON: b64u.enc(r.clientDataJSON), attestationObject: b64u.enc(r.attestationObject), transports: r.getTransports?.() ?? [] }
      : { clientDataJSON: b64u.enc(r.clientDataJSON), authenticatorData: b64u.enc(r.authenticatorData), signature: b64u.enc(r.signature), userHandle: r.userHandle ? b64u.enc(r.userHandle) : undefined },
  };
}
/** A ceremony: { ok, response } or { ok: false, why: cancelled | exists | unsupported | offline }. */
async function ceremony(kind, options, hints) {
  if (!hasPasskeys()) return { ok: false, why: "unsupported" };
  if (navigator.onLine === false) return { ok: false, why: "offline" };
  try {
    const c = kind === "create" ? await navigator.credentials.create({ publicKey: creationOptions(options, hints) }) : await navigator.credentials.get({ publicKey: requestOptions(options, hints) });
    return c ? { ok: true, response: credJSON(c) } : { ok: false, why: "cancelled" };
  } catch (e) {
    return { ok: false, why: e?.name === "InvalidStateError" ? "exists" : "cancelled" };
  }
}
const HINT = { phone: ["hybrid"], key: ["security-key"], device: ["client-device"] };

// ------------------------------------------------------------- loading each screen's reads
async function loadSession() {
  const r = await api("GET", "/api/v0/session");
  if (r.ok) S.session = r.data;
  else if (r.status === 401) S.session = null;
  else { S.session = undefined; S.error = r; }
  return r;
}
async function loadFleet() {
  const [i, st] = await Promise.all([api("GET", `/f/${encodeURIComponent(S.session.tenant.id)}/index.json`), api("GET", "/api/v0/fleet/status")]);
  S.index = i.ok ? i.data : null; S.status = st.ok ? st.data : null;
  S.fleetError = !i.ok && i.status !== 404 ? i : null;
}
async function loadAccess() { const r = await api("GET", "/api/v0/access"); S.access = r.ok ? r.data : null; S.accessError = r.ok ? null : r; }
async function loadJournal(cursor) { const r = await api("GET", `/api/v0/journal${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`); S.journal = r.ok ? r.data : null; S.journalError = r.ok ? null : r; }

// ------------------------------------------------------------- entry (signed out) — plain, to be redesigned
function viewEntree(sub) {
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

// ------------------------------------------------------------- links: bootstrap, recovery, invitation (seven states)
function viewLien(sub) {
  const info = S.linkInfo;
  const frame = (title, h1, body) => ({ title, key: "lien", signed: "out", html: `${head("runward hébergé · lien d'accès", "le lien reste dans votre navigateur : il n'est jamais envoyé dans l'adresse")}<section class="lien"><h1 class="v">${h1}</h1>${body}</section>` });
  if (!S.link) return frame("Lien à rouvrir", "Rouvrez le lien reçu.", `<p class="face">${mk("void", "lien absent")} Le lien n'est gardé que le temps de cette page : il n'est jamais écrit dans l'adresse ni dans l'historique. Ouvrez de nouveau le lien complet que vous avez reçu.</p>`);
  if (!info) return frame("Lien d'accès", "Lecture du lien…", `<div class="charge" role="progressbar" aria-label="Lecture du lien"></div>`);
  const until = when(info.expiresAt, { sec: false });
  const kind = info.kind;
  const create = (label) => `<div class="actions">${act("redeem", label, { k: "device" })}${act("redeem", "La créer sur mon téléphone", { q: true, k: "phone" })}</div>`;
  if (sub === "attente") return frame("Création en cours", "Validez sur votre appareil.", `<p class="face">Votre navigateur vous propose d'enregistrer une passkey pour ce service. Le compte n'existe qu'une fois qu'elle est enregistrée par le service.</p><div class="charge" role="progressbar" aria-label="En attente de la création de la passkey"></div>`);
  if (sub === "annulee") return frame("Création annulée", "La passkey n'a pas été créée.", `<p class="face">${mk("void", "rien de créé")} La création a été annulée sur l'appareil. Le lien reste valable jusqu'au ${until}.</p>${create("Réessayer")}`);
  if (sub === "panne") return frame("Service perdu pendant la création", "Le service n'a pas reçu votre passkey.", `<p class="face">${mk("inv", "non enregistrée")} Votre appareil a peut-être créé une passkey, mais le service ne l'a pas enregistrée : aucun compte n'existe encore, et le lien reste valable.</p>${create("Réessayer")}<p class="note">Si votre appareil affiche une passkey de ce service qui ne fonctionne pas, supprimez-la de son trousseau ; ce navigateur a été prié de l'oublier.${reqNote(S.lastError)}</p>`);
  const st = info.state;
  if (st === "link-invalid") return frame("Lien invalide", "Ce lien ne mène à rien.", `<p class="face">${mk("void", "invalide")} Il est incomplet, ou il n'a jamais été ouvert par ce service. Vérifiez que vous l'avez copié en entier.</p><div class="actions">${go("#/entree/connexion", "Aller à la connexion", { q: true })}</div>`);
  if (st === "link-signed-in") return frame("Déjà connecté", kind === "invitation" ? "Vous êtes déjà membre de cette flotte." : "Vous êtes déjà dans cette flotte.", `<p class="face">${mk("full", "connecté")} Ce navigateur a une session de membre de ${esc(info.fleet)}. Ce lien ne change rien pour vous.</p><div class="actions">${go("#/", "Ouvrir la flotte")}</div>`);
  if (st === "link-used") return frame("Lien déjà servi", "Ce lien a déjà servi.", `<p class="face">${mk("void", "fermé")} Une passkey a déjà été créée avec lui.${kind === "bootstrap" ? " L'amorçage de cette flotte est fermé pour toujours." : ""}</p><div class="actions">${go("#/entree/connexion", "Se connecter avec ma passkey")}</div><p class="note">Si ce n'était pas vous : l'ouverture est écrite au journal et notifiée à l'opérateur. L'opérateur du service peut retirer ce membre ; la reprise d'accès vous rend ensuite la flotte.</p>`);
  if (st === "link-expired") return frame("Lien expiré", kind === "recovery" ? "Ce lien de reprise a expiré." : kind === "invitation" ? "Cette invitation a expiré." : "Ce lien a expiré.", `<p class="face">${mk("void", "expiré")} Il valait jusqu'au ${until} et n'a pas servi. Rien n'a changé.</p><p class="note">${kind === "invitation" ? "Demandez un nouveau lien à la personne qui vous l'a transmise." : `Tirez un nouveau lien sur votre poste : <code>npm run ${kind === "recovery" ? "operateur:reprise" : "operateur:amorcage"}</code>, puis approuvez le run.`}</p>`);
  if (st === "link-cancelled") return frame(kind === "recovery" ? "Reprise annulée" : "Lien fermé", kind === "recovery" ? "Cette reprise a été annulée." : "Ce lien a été fermé.", `<p class="face">${mk("void", "annulé")} ${kind === "recovery" ? "Une session ouverte de cette flotte l'a annulée. Rien n'a changé." : "Il a été fermé avant de servir, ou remplacé par un plus récent. Rien n'a été créé."}</p>${kind === "recovery" ? `<p class="note">Si vous avez bien perdu toutes vos passkeys, tirez un nouveau lien de reprise. <a href="#/reprise">Comment faire</a></p>` : ""}`);
  if (st === "link-not-yet") return frame("Reprise pas encore utilisable", `Cette reprise s'ouvrira le ${when(info.usableFrom, { sec: false })}.`, `<p class="face">${mk("half", "en délai")} Pendant 24 heures, toute session encore ouverte de cette flotte la voit et peut l'annuler.</p><p class="note">Rien à faire d'ici là : revenez à ce même lien après l'heure dite. Ce délai protège le titulaire si quelqu'un d'autre a ouvert la reprise.</p>`);
  if (kind === "recovery") return frame("Reprendre l'accès", `Reprenez l'accès à ${esc(info.fleet)}.`, `<p class="face">Le délai est passé sans annulation. En créant une passkey ici :</p><ul class="effets"><li>toutes les sessions ouvertes de votre compte se ferment ;</li><li>vos anciennes passkeys sont retirées, et ne pourront pas être remises ;</li><li>la reprise est écrite au journal.</li></ul><p class="small">Ce lien vaut jusqu'au ${until}, une seule fois.</p>${create("Créer ma passkey et reprendre l'accès")}`);
  if (kind === "invitation") return frame("Invitation reçue", `Vous êtes invité à lire ${esc(info.fleet)}.`, `<p class="face">Vous rejoindrez la flotte comme propriétaire. L'invitation vaut jusqu'au ${until}, une seule fois.</p>${create("Créer ma passkey et rejoindre")}${PK_PLAIN}${FORGE}`);
  return frame("Lien d'amorçage", "Créez la première passkey de cette flotte.", `<p class="face">Ce lien ouvre le compte fondateur de cette flotte. Il sert une seule fois et vaut jusqu'au ${until}.</p>${create("Créer ma passkey sur cet appareil")}${PK_PLAIN}<p class="note">Ensuite, vous en ajouterez une seconde, si possible dans un autre trousseau : avec deux passkeys, la perte d'un appareil ne vous ferme pas la porte.</p>`);
}

function viewReprise() {
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

// ------------------------------------------------------------- the send workflow call, as the app shows it
// The install path without any right (PADR-0021 point 7, proposed): the extract, a button that opens GitHub's
// create-file page for this repository and its default branch with the path and the content prefilled, and a
// copy button. The prefill by query parameter is not documented by GitHub; it was checked for real in Chrome on
// 2026-11-08 (/new/<branch>?filename=…&value=… fills both; /new/HEAD answers 404, hence the declared branch).
// Nothing is sent to GitHub by the service: the browser opens the page, the member commits it, or not.
function workflowText(repo) {
  const sha = (S.session?.sendWorkflow ?? [])[0] ?? null;
  const branch = repo?.defaultBranch ?? "main";
  const mission = repo?.missions?.[0]?.id ?? "<mission>";
  return { sha, branch, text: `name: runward
on:
  push: { branches: [${branch}] }
  pull_request:
permissions: {}
jobs:
  runward:
    permissions: { contents: read, id-token: write }
    uses: stranxik/runward-hosted/.github/workflows/send.yml@${sha ?? "<sha of the first release>"}
    with:
      mission: ${mission}
` };
}
/** GitHub's create-file page for this repository and branch, with the workflow's path and content prefilled. */
function installUrl(repo, text) {
  const [owner, name] = String(repo.name).split("/");
  const branch = String(repo.defaultBranch ?? "main").split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/new/${branch}?filename=${encodeURIComponent(".github/workflows/runward.yml")}&value=${encodeURIComponent(text)}`;
}
function snippet(repo) {
  const w = workflowText(repo);
  const install = repo?.name ? `<div class="actions install">
      ${w.sha ? `<a class="btn" href="${esc(installUrl(repo, w.text))}" target="_blank" rel="noopener noreferrer" data-install>Ajouter le workflow</a>` : `<button class="btn" type="button" disabled>Ajouter le workflow</button>`}
      <button class="btn btn-q" type="button" data-do="copy" data-copy-target="extrait" aria-describedby="copie-etat">Copier l'extrait</button>
      <span class="small soft" id="copie-etat" role="status" aria-live="polite"></span></div>
    <p class="note">« Ajouter le workflow » ouvre, dans un nouvel onglet, la page de GitHub qui crée <code>.github/workflows/runward.yml</code> sur la branche <code>${esc(w.branch)}</code> de <span translate="no">${esc(repo.name)}</span>, déjà remplie : il ne vous reste qu'à valider le commit. Ce service n'écrit rien dans votre dépôt et n'y demande aucun droit.</p>
    ${w.branch !== "main" ? `<p class="avert">Votre branche par défaut est <code>${esc(w.branch)}</code>. Aujourd'hui, seul un push sur <code>main</code> envoie : le workflow jugera vos commits, l'envoi attend l'acceptation des autres branches par défaut.</p>` : ""}` : "";
  return `<pre class="term" tabindex="0" id="extrait" aria-label="Extrait du workflow à ajouter dans votre dépôt" lang="en">${esc(w.text.trimEnd())}</pre>
${install}
${w.sha ? "" : `<p class="note">${mk("void", "aucune release")} Le workflow d'envoi n'a pas encore de release publiée : l'appel s'écrira avec son commit dès la première, et le bouton s'ouvrira alors.</p>`}
<p class="note">Ce workflow, publié par le service et épinglé par son commit, lance <code>runward check</code> sur votre commit et envoie ce que runward a écrit : aucun fichier de votre dépôt n'est envoyé à sa place, aucun secret n'est rangé. Sur une PR, il juge sans rien envoyer. Un refus de runward est envoyé aussi, et votre CI reste à la couleur de runward. Si le service ne répond pas, votre CI ne casse pas : le résumé du job dit ce qui n'est pas parti.</p>`;
}

// ------------------------------------------------------------- first arrival
function viewArrivee(sub) {
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

function declareForm() {
  const err = S.formError;
  const e = (field) => (err && err.field === field ? ` aria-invalid="true" aria-describedby="e-${field}"` : "");
  const em = (field) => (err && err.field === field ? `<span class="err" id="e-${field}">${esc(err.message)} ${esc(err.action)}</span>` : "");
  const top = err && !err.field ? `<p class="erreur" role="alert" id="e-top">${mk("inv", "non déclaré")} ${esc(err.message)} <span class="soft">${esc(err.action)}</span>${reqNote(err)}</p>` : "";
  const v = S.formValues ?? { repo: "", wf: ".github/workflows/runward.yml", mission: "", path: ".", branch: "main" };
  return `<form id="declare" novalidate>${top}
      <label class="f"><span class="k">Dépôt (propriétaire/dépôt)</span><input class="in" name="repo" value="${esc(v.repo)}" placeholder="stranxik/dropyour" autocomplete="off" spellcheck="false" translate="no"${e("repo")}>${em("repo")}</label>
      <label class="f"><span class="k">Workflow appelant, celui qui appelle le workflow d'envoi</span><input class="in" name="wf" value="${esc(v.wf)}" autocomplete="off" spellcheck="false" translate="no"${e("wf")}>${em("wf")}</label>
      <div class="mis"><label class="f"><span class="k">Mission</span><input class="in" name="mission" value="${esc(v.mission)}" placeholder="dropyour" autocomplete="off" spellcheck="false" translate="no"${e("mission")}>${em("mission")}</label>
        <label class="f"><span class="k">Chemin dans le dépôt</span><input class="in" name="path" value="${esc(v.path)}" autocomplete="off" spellcheck="false" translate="no"></label></div>
      <label class="f"><span class="k">Branche par défaut du dépôt</span><input class="in" name="branch" value="${esc(v.branch ?? "main")}" autocomplete="off" spellcheck="false" translate="no"${e("branch")}>${em("branch")}</label>
      <p class="small soft">Vous la déclarez : GitHub ne la donne pas sans jeton pour un dépôt privé, et ce service n'en tient aucun. Elle sert au bouton qui ouvre la page de création du workflow. Aujourd'hui, seul <code>main</code> envoie.</p>
      <label class="check"><input type="checkbox" name="content"><span>J'accepte que ce service reçoive le contenu des exports de ce dépôt : verdict, écarts, livrables et noms déclarés par la charte. Sans cet accord, aucun envoi de ce dépôt n'est accepté, attestation comprise. Je peux le retirer à tout moment dans Accès. Cocher cette case vous redemande votre passkey pour ce geste.</span></label>
      <div class="actions"><button class="btn" type="submit">Déclarer ce dépôt</button></div>
      <p class="note">Votre passkey vous est redemandée si votre dernière vérification date de plus de 5 minutes. Le dépôt reste en attente jusqu'à son premier envoi, que vous confirmerez.</p>
    </form>`;
}
const FIELD_OF = { "repository-malformed": "repo", "workflow-malformed": "wf", "mission-malformed": "mission", "mission-exists": "mission", "branch-malformed": "branch" };

// ------------------------------------------------------------- declare, confirm, modify
function viewDeclarer(sub) {
  const a = S.access;
  if (!a) return loadingView("Déclarer");
  const [what, id] = sub.split("/");
  const repo = id ? a.repositories.find((r) => r.id === id) : null;
  if (what === "attente" && repo) return { title: "Dépôt en attente", key: "declarer", signed: "in", focus: "h1", html: `${head("déclarer", "en attente du premier envoi")}
    <h1 class="v" tabindex="-1">${esc(repo.name)} est déclaré.</h1>
    <p class="face lede">${mk("half", "en attente du premier envoi")} Ajoutez l'appel du workflow d'envoi, puis fusionnez sur <code>main</code>. Le premier envoi sera gardé sans être publié jusqu'à ce que vous le confirmiez ici.</p>
    <p class="small">Cette déclaration expire le ${when(repo.expiresAt, { sec: false })} si aucun envoi n'arrive. Sans consentement au contenu, le premier envoi sert seulement à confirmer le dépôt : ses octets ne sont pas gardés.</p>
    ${snippet(repo)}<div class="actions">${go("#/acces", "Revenir à Accès", { q: true })}</div>` };
  if (what === "confirmer" && repo) {
    if (!repo.pendingSend || repo.pendingSend.reason === "owner-changed" && repo.state !== "pinned") {
      return { title: "Rien à confirmer", key: "declarer", signed: "in", html: `${head("déclarer · confirmer", "")}<h1 class="v">Il n'y a rien à confirmer.</h1><p class="face">${repo.state === "pinned" ? `${mk("full", "déjà épinglé")} ${esc(repo.name)} a été confirmé le ${when(repo.confirmedAt, { sec: false })}. Rien n'a changé.` : `${mk("half", "en attente du premier envoi")} Aucun envoi n'est encore arrivé de ${esc(repo.name)}.`}</p><div class="actions">${go("#/acces", "Voir Accès")}</div>` };
    }
    const owner = repo.pendingSend.reason === "owner-changed";
    const c = repo.pendingSend.claims;
    return { title: owner ? "Nouveau propriétaire à confirmer" : "Confirmer le premier envoi", key: "declarer", signed: "in", html: `${head("déclarer · confirmer", "vérification par geste")}
      <h1 class="v">${owner ? `${esc(repo.name)} a changé de propriétaire.` : `Le premier envoi de ${esc(repo.name)} est arrivé.`}</h1>
      <p class="face lede">${owner ? `${mk("inv", "owner-changed")} Le même dépôt (identifiant ${esc(c.repositoryId)}) arrive maintenant sous le propriétaire ${esc(c.repositoryOwnerId)}, au lieu de ${esc(repo.ownerId)}. Si vous avez transféré ce dépôt, confirmez le nouveau propriétaire. Sinon, retirez le dépôt.` : "Vérifiez qu'il vient bien de votre dépôt. En le confirmant, le service retient l'identifiant du dépôt et celui de son propriétaire : un dépôt recréé sous le même nom, ou transféré, ne pourra plus écrire dans votre flotte."}</p>
      ${claimsTable(c)}
      ${S.failed === `confirm:${repo.id}` ? `<p class="erreur" role="alert">${mk("inv", "non vérifié")} La vérification n'a pas abouti. Rien n'a changé.</p>` : ""}
      <div class="actions">${act("gesture", owner ? "Confirmer le nouveau propriétaire" : "Confirmer ce dépôt", { k: `confirm:${repo.id}` })}${act("ask", "Ce n'est pas mon dépôt : retirer la déclaration", { q: true, k: `repo:${repo.id}` })}</div>
      ${confirmBox(`repo:${repo.id}`)}
      <p class="note">Votre passkey vous est demandée pour ce geste. Rien n'est publié avant.</p>` };
  }
  if (what === "modifier" && repo) {
    const ms = repo.missions;
    return { title: "Modifier un dépôt", key: "declarer", signed: "in", html: `${head("déclarer · modifier", "passkey récente")}<h1 class="v">Modifier ${esc(repo.name)}.</h1>
      <form id="modify" data-id="${esc(repo.id)}" novalidate>${S.formError ? `<p class="erreur" role="alert">${mk("inv", "non enregistré")} ${esc(S.formError.message)} <span class="soft">${esc(S.formError.action)}</span></p>` : ""}
      <label class="f"><span class="k">Workflow appelant</span><input class="in" name="wf" value="${esc(repo.workflow)}" autocomplete="off" spellcheck="false" translate="no"></label>
      <label class="f"><span class="k">Branche par défaut du dépôt</span><input class="in" name="branch" value="${esc(repo.defaultBranch ?? "main")}" autocomplete="off" spellcheck="false" translate="no"></label>
      <p class="small soft">Changer de workflow ouvre une nouvelle série dans l'ordre des envois ; les envois de l'ancien restent au journal.</p>
      ${ms.map((m) => `<p class="small"><code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span> · <label><input type="checkbox" name="remove" value="${esc(m.id)}"> retirer (ses envois restent au journal)</label></p>`).join("")}
      <div class="mis"><label class="f"><span class="k">Ajouter une mission</span><input class="in" name="mission" autocomplete="off" spellcheck="false" translate="no"></label><label class="f"><span class="k">Chemin dans le dépôt</span><input class="in" name="path" value="." autocomplete="off" spellcheck="false" translate="no"></label></div>
      <p class="note">Le chemin est une déclaration : le jeton de la CI ne le porte pas.</p>
      <div class="actions"><button class="btn" type="submit">Enregistrer</button>${go("#/acces", "Annuler", { q: true })}</div></form>` };
  }
  if (id && !repo) return null;
  return { title: S.formError ? "Déclaration refusée" : "Déclarer un dépôt", key: "declarer", signed: "in", focus: S.formError ? (S.formError.field ? `#e-${S.formError.field}` : "#e-top") : null, html: `${head("déclarer", `${a.repositories.filter((r) => r.state !== "removed").length} dépôt(s) déclaré(s)`)}
    <h1 class="v">Déclarez un dépôt.</h1>
    <p class="face lede">Un dépôt déclaré est le seul à pouvoir écrire dans votre flotte, depuis son workflow appelant, sur <code>main</code>.</p>${declareForm()}` };
}

function claimsTable(c) {
  if (!c) return "";
  const row = (k, v, note) => `<tr><th scope="row"><code>${esc(k)}</code></th><td><code translate="no">${esc(v)}</code>${note ? `<div class="small soft">${esc(note)}</div>` : ""}</td></tr>`;
  const run = c.repository && c.runId ? `https://github.com/${c.repository}/actions/runs/${c.runId}/attempts/${c.runAttempt}` : "";
  return `<div class="tw" tabindex="0" role="region" aria-label="Revendications vérifiées du jeton, défilable"><table class="t claims"><tbody>
    ${row("repository", c.repository)}${row("repository_id", c.repositoryId, "épinglé à la confirmation")}${row("repository_owner_id", c.repositoryOwnerId, "épinglé à la confirmation")}
    ${row("workflow_ref", c.workflowRef, "le workflow appelant, déclaré")}${row("job_workflow_ref", c.jobWorkflowRef, "le workflow d'envoi du service, épinglé par commit")}
    ${row("event_name", c.eventName)}${row("ref", c.ref)}${row("sha", c.sha)}${row("runner_environment", c.runnerEnvironment)}
    ${row("run_number · run_attempt", `${c.runNumber} · ${c.runAttempt}`, "l'ordre des envois")}${run ? row("run", run) : ""}
  </tbody></table></div>`;
}

// ------------------------------------------------------------- uploads: the journal
const WHAT = {
  "send-accepted": "envoi accepté", "send-historical": "envoi accepté, plus ancien que le courant", "send-pending": "premier envoi gardé, à confirmer", "send-not-accepted": "envoi non accepté", "send-quarantined": "envoi gardé en quarantaine",
  "repository-declared": "dépôt déclaré", "repository-changed": "dépôt modifié", "repository-confirmed": "dépôt confirmé", "repository-removed": "dépôt retiré", "repository-restored": "dépôt remis", "repository-expired": "déclaration expirée",
  "consent-given": "contenu consenti", "consent-withdrawn": "consentement retiré", "content-erased": "contenu effacé", "member-founded": "membre créé", "member-recovered": "accès repris",
  "signed-in": "connexion", "signed-out": "déconnexion", "session-closed": "session fermée", "sessions-closed-others": "autres sessions fermées", "passkey-added": "passkey ajoutée", "passkey-removed": "passkey retirée",
  "passkey-restored": "passkey remise", "passkey-single-chosen": "choix : une seule passkey", "recovery-opened": "reprise d'accès ouverte", "recovery-cancelled": "reprise d'accès annulée", "access-reset": "accès réinitialisé par l'opérateur",
  "bootstrap-opened": "amorçage ouvert par l'opérateur", "export-prepared": "archive préparée", "settings-changed": "réglage changé", "reader-authorized": "lecteur automatique autorisé", "reader-withdrawn": "lecteur automatique retiré", "reader-read": "lecture du lecteur automatique", "restore-replayed": "restauration rejouée",
};
const WHO = { human: "identité humaine", workload: "identité de charge", operator: "opérateur du service", reader: "lecteur automatique" };
function jrow(e) {
  const b = e.body, d = b.detail ?? {};
  const state = { "send-accepted": mk("full", "accepté, courant"), "send-historical": mk("half", "accepté, historique"), "send-pending": mk("half", "gardé, à confirmer"), "send-not-accepted": mk("inv", "non accepté"), "send-quarantined": mk("inv", "non publié") }[b.what] ?? mk("void", b.who.type === "operator" ? "geste d'opérateur" : "acte");
  const who = b.who.type === "workload" && d.claims ? `<span class="k">${WHO.workload}</span><span data-verbatim translate="no">${esc(d.claims.repository)}</span>${d.mission ? `<span class="k">mission</span><code>${esc(d.mission)}</code>` : ""}` : `<span class="k">${esc(WHO[b.who.type] ?? b.who.type)}</span>`;
  const what = `<span class="k">quoi</span>${esc(WHAT[b.what] ?? b.what)}${d.kind ? ` · ${esc(d.kind)}` : ""}${d.sha256 ? `<div><code>sha256 ${esc(short(d.sha256))}</code></div>` : ""}${d.indexSha256 ? `<div class="small soft">index <code>${esc(short(d.indexSha256))}</code></div>` : ""}`;
  const dates = `<span class="k">reçu, heure du service (déclarée)</span>${when(b.dates?.received?.at)}${b.dates?.issued ? `<span class="k">émis, jeton OIDC</span>${when(b.dates.issued.at)}` : ""}${b.who.type === "workload" ? `<span class="k">commit</span>${d.commit ? `<code>${esc(String(d.commit).slice(0, 12))}</code>` : `<span class="soft">à dater</span>`}` : ""}${b.requestId ? `<span class="k">requête</span><code>${esc(b.requestId)}</code>` : ""}`;
  const refusal = d.refusal ? `<div class="jref small"><code>${esc(d.refusal)}</code> ${esc(e.text?.message ?? "")} <span class="soft">${esc(e.text?.action ?? "")}</span></div>` : "";
  const note = b.what === "send-historical" ? `<div class="jref small">Relance d'un run plus ancien que l'envoi courant (run n° ${esc(d.currentRunNumber)}) : gardé comme historique, jamais comme courant.</div>` : "";
  const prov = d.claims ? `<details class="prov"><summary>Provenance, claim par claim</summary>${claimsTable(d.claims)}</details>` : "";
  return `<li class="jrow"><div class="rv">n° <b>${e.seq}</b></div><div><span class="k">état</span>${state}</div><div>${who}</div><div>${what}</div><div class="small">${dates}</div>${refusal}${note}${prov}</li>`;
}
function viewEnvois() {
  const j = S.journal;
  if (S.journalError) return { title: "Envois", key: "envois", signed: "in", html: `${head("journal du locataire", "")}<h1 class="v">${mk("inv", "non affiché")} Le journal ne s'affiche pas.</h1><p class="face">Le service n'a pas répondu. Vos envois ne sont pas perdus : ils sont écrits avant toute réponse.${reqNote(S.journalError)}</p><div class="actions">${act("reload-screen", "Réessayer")}</div>` };
  if (!j) return loadingView("Envois");
  const n = j.head?.seq ?? 0;
  const list = j.entries.length ? `<ol class="journal" aria-label="Entrées du journal, de la plus récente à la plus ancienne">${j.entries.map(jrow).join("")}</ol>`
    : `<h2>Aucun envoi reçu pour l'instant.</h2><p>Le premier arrive après la fin du job de CI qui suit votre fusion sur <code>main</code>, si le workflow d'envoi est appelé.</p>`;
  return { title: "Envois", key: "envois", signed: "in", html: `${head(`journal du locataire · ${n} entrée${n > 1 ? "s" : ""} · tête <b>${esc(short(j.head?.hash))}</b>`, "chaîné par empreinte · tête recopiée dans chaque résumé de job")}
    <h1 class="v">Ce que vos CI ont envoyé.</h1>${list}
    <div class="actions">${j.end ? `<p class="small soft fin" role="note">Début du journal : entrée n° 1.</p>` : go(`#/envois/${j.next}`, "Entrées plus anciennes", { q: true })}</div>
    <p class="note">${esc(j.note)} Comparer la tête servie à la dernière tête d'un résumé de job montre une troncature. Les résumés des dépôts publics laissent voir le rythme des envois de vos dépôts privés ; c'est accepté tant que cette flotte n'a que vos dépôts.</p>` };
}

// ------------------------------------------------------------- fleet: provenance and the status line, then views.js
function fleetHead() {
  const st = S.status;
  if (!st) return "";
  const lines = st.lines.map((m) => {
    const last = m.accepted ? `${mk("full", `entrée ${m.accepted.seq}`)}<div class="small">${when(m.accepted.receivedAt)}</div>` : m.state === "pending" ? mk("half", "en attente de confirmation") : mk("void", "aucun envoi accepté");
    const cur = m.accepted ? `<span class="small">run <b>${esc(m.accepted.runNumber)}</b> · tentative ${esc(m.accepted.runAttempt)}</span><div><code>${esc(String(m.accepted.commit ?? "").slice(0, 12))}</code></div>` : `<span class="soft small">rien</span>`;
    const since = m.notAcceptedSince ? `${mk("inv", `${m.notAcceptedSince} non accepté${m.notAcceptedSince > 1 ? "s" : ""} depuis`)}<div class="small"><code>${esc(m.lastRefusal)}</code> · <a href="#/envois">voir les envois</a></div>` : `<span class="small soft">0 non accepté depuis</span>`;
    return `<tr><th scope="row"><span data-verbatim translate="no">${esc(m.mission)}</span><div class="small soft" translate="no">${esc(m.repository)}</div></th><td>${last}</td><td>${cur}</td><td>${since}</td></tr>`;
  }).join("");
  const idx = st.index;
  return `${head(idx ? `index servi · sha256 <b>${esc(short(idx.sha256))}</b> · runward-fleet ${esc(idx.fleetVersion)} · assemblé le <b>${when(idx.publishedAt)}</b>, heure du service (déclarée), à l'entrée ${idx.seq}` : "aucun index publié", "rien n'est élevé par ce service : ci-declared au plus")}
    ${idx ? `<div class="prov-tete small"><a href="/f/${esc(S.session.tenant.id)}/index.json">index.json, tel que servi</a> · recalculer chez vous depuis l'archive : <code translate="no">runward-fleet build fleet.json --out site</code> redonne <code>${esc(short(idx.sha256))}</code></div>` : ""}
    ${st.quarantined ? `<p class="avert">${mk("inv", "non publié")} ${st.quarantined} envoi${st.quarantined > 1 ? "s" : ""} en quarantaine : la flotte montre le dernier index publié. <a href="#/envois">Voir les envois</a></p>` : ""}
    ${lines ? `<section class="blk releve" aria-label="Relevé des envois par mission"><details class="releve-d"${matchMedia("(min-width: 760px)").matches ? " open" : ""}>
      <summary><h2 class="h-releve">Envois par mission</h2> <span class="small soft">${st.lines.length} mission${st.lines.length > 1 ? "s" : ""}, ${st.lines.filter((m) => m.notAcceptedSince).length} avec un envoi non accepté, ${st.lines.filter((m) => !m.accepted).length} sans aucun envoi accepté</span></summary>
      <div class="tw" tabindex="0" role="region" aria-label="Relevé des envois par mission, défilable"><table class="t"><thead><tr><th scope="col">Mission</th><th scope="col">Dernier envoi accepté</th><th scope="col">Envoi courant</th><th scope="col">Non acceptés depuis</th></tr></thead><tbody>${lines}</tbody></table></div>
      <p class="small soft">« Non accepté » parle de l'envoi au service ; « refusée » parle du verdict de runward, dans la vue ci-dessous. L'envoi courant est celui du plus grand numéro de run : une relance d'un run ancien reste historique.</p></details></section>` : ""}`;
}
function viewFleet(route, sub) {
  if (S.fleetError) return { title: "Flotte injoignable", key: "fleet", signed: "in", html: `${head("runward hébergé · état du service", "")}<h1 class="v">La flotte ne s'affiche pas.</h1><p class="face">${mk("inv", "non affichée")} Votre session est ouverte, mais l'index n'a pas pu être lu. Le journal, lui, s'affiche.${reqNote(S.fleetError)}</p><div class="actions">${act("reload-screen", "Réessayer")}${go("#/envois", "Voir les envois", { q: true })}</div>` };
  if (!S.status) return loadingView("Flotte");
  if (route === "") return viewFlotte();
  if (route === "mission") return viewMissionDetail(sub);
  if (!S.index) return { title: "Flotte", key: "fleet", signed: "in", fleetRoute: route, html: `${fleetHead()}<h1 class="v">Aucune mission publiée.</h1><p>Votre flotte compte les dépôts que vous déclarez, et seulement ceux-là. Une mission apparaît après son premier envoi confirmé.</p><div class="actions">${go("#/declarer", "Déclarer un dépôt")}</div>` };
  const titles = { vue: "Vue complète", history: "Historique", proof: "Preuve", signatures: "Signatures", pr: "Dans la PR", sources: "Sources" };
  return { title: titles[route] ?? "Flotte", key: "fleet", signed: "in", fleetRoute: route, html: `${fleetHead()}${renderView(S.index, route === "vue" ? "" : route, sub || undefined)}` };
}

// ------------------------------------------------------------- the shell of direction A (« la coque »), its dashboard and a mission's page
// Everything is read from the index served and from GET /api/v0/fleet/status, already loaded for the screen:
// opening a mission costs 0 more read (architecture §6). No example data: what is shown is the tenant's.
const MAILTO = "mailto:contact@runward.dev?subject=Acc%C3%A8s%20%C3%A0%20la%20pr%C3%A9version%20de%20runward%20h%C3%A9berg%C3%A9";
const MARK = `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="14" width="72" height="72" rx="16"/><path d="M36 36 L50 50 L36 64"/></g><rect x="54" y="43" width="14" height="14" rx="3" fill="currentColor"/></svg>`;
const VERDICT_FR = { gaps: ["inv", "refusée"], "level-not-met": ["inv", "niveau non atteint"], "not-observed": ["void", "silencieuse"], clean: ["full", "sans écart"] };
const ORDER = { gaps: 0, "level-not-met": 1, "not-observed": 2, clean: 3 };
const PHASE_FR = { frame: "Cadrer", architect: "Architecturer", floor: "Plancher", iterate: "Itérer", govern: "Gouverner", handover: "Transmettre" };
const GATE_KEY = { frame: "frame", architect: "architect", floor: "floor", iterate: "iterate", govern: "govern", hand: "handover" };
const ART_FR = {
  "Framing note": "note de cadrage", "Steering contract": "contrat de pilotage", "Architecture note": "note d'architecture",
  "Execution topology": "topologie d'exécution", "Decision matrix": "matrice de décision", "Decision journal (≥1 ADR)": "journal de décisions",
  "Port contracts (≥1 filled)": "contrats de ports", "Floor note (measured proof)": "note de plancher, preuve mesurée", "Threat model": "modèle de menaces",
  "Evaluation rubric": "grille d'évaluation", "Observability schema": "schéma d'observabilité", "Recovery runbook": "runbook de reprise",
  "Hand-over note (the kit, proven)": "note de passation",
};
const REFUS_FR = { "workflow-not-pinned": "workflow appelant non déclaré", "content-not-consented": "contenu non consenti", "repository-pending": "dépôt en attente de votre confirmation", "repository-not-declared": "dépôt non déclaré ou retiré", "owner-changed": "propriétaire changé", "private-path": "chemin privé", "index-build-refused": "export que runward-fleet ne sait pas assembler", "index-rule-broken": "règle de vue cassée" };
const HM = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAY_FR = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const hm = (iso) => (iso ? `<time datetime="${esc(iso)}">${esc(HM.format(new Date(iso)))}</time>` : `<span class="soft">à dater</span>`);
const etq = (shape, word) => `<span class="etq"><span class="mk mk-${shape}" aria-hidden="true"></span>${esc(word)}</span>`;
const chipOf = (v) => { const [sh, w] = VERDICT_FR[v] ?? VERDICT_FR["not-observed"]; return sh === "inv" ? mk("inv", w) : etq(sh, w); };
const verdictOf = (m) => (m && typeof m.latest === "object" && m.latest ? m.latest.verdict : "not-observed");
const nomLong = (m) => m.name;
const nomCourt = (m) => (m.path && m.path !== "." ? m.path.split("/").pop() : m.name.split("/").pop());
const triees = () => (S.index ? [...S.index.missions].sort((a, b) => (ORDER[verdictOf(a)] ?? 9) - (ORDER[verdictOf(b)] ?? 9)) : []);
const ligne = (id) => S.status?.lines.find((l) => l.mission === id) ?? null;
function porteFr(gate) {
  if (!gate || gate === "all gates passed") return "toutes les portes";
  const g = /^(\d+)\s*·\s*([A-Za-z]+)/.exec(gate);
  return g ? `porte ${g[1]}, ${PHASE_FR[GATE_KEY[g[2].toLowerCase()]] ?? g[2]}` : gate;
}
const manquants = (m) => (typeof m.latest === "object" ? (m.latest.deliverables?.list ?? []).filter((d) => d.state !== "filled") : []);
const sourceDe = (m) => (typeof m.latest === "object" ? S.index.sources.find((s) => s.id === m.latest.src)?.path : null);
function cause(m) {
  const v = verdictOf(m), st = ligne(m.id);
  if (v === "gaps") {
    const mq = manquants(m);
    return mq.length ? `Bloquée à la ${esc(porteFr(m.latest.currentGate))} : ${mq.length} livrable${mq.length > 1 ? "s" : ""} absent${mq.length > 1 ? "s" : ""}, dont ${mq.slice(0, 2).map((d) => `<code>${esc(d.relPath)}</code>`).join(" et ")}.` : `Refusée à la ${esc(porteFr(m.latest.currentGate))} : des lignes de conformité restent ouvertes.`;
  }
  if (v === "level-not-met") return "Toutes les portes sont franchies, mais rien n'y est vérifié mécaniquement : le niveau demandé n'est pas atteint.";
  if (v === "not-observed") {
    if (st?.lastRefusal) return `Aucun envoi accepté. Le dernier, à ${hm(st.lastRefusalAt)} (entrée ${esc(st.lastRefusalSeq)}), n'a pas été accepté : ${esc(REFUS_FR[st.lastRefusal] ?? st.lastRefusal)}.`;
    return "Aucun envoi accepté pour cette mission déclarée : c'est un constat, pas un filtre.";
  }
  return "Toutes les portes sont franchies, sans écart.";
}
function sourceLigne(m) {
  const st = ligne(m.id);
  if (!st || !st.accepted) return `source : journal${st?.lastRefusalSeq ? `, entrée ${esc(st.lastRefusalSeq)}` : ""}`;
  return `source : <code>${esc(sourceDe(m) ?? "")}</code>, commit ${esc(String(st.accepted.commit ?? "").slice(0, 12))}, entrée ${esc(st.accepted.seq)} à ${hm(st.accepted.receivedAt)}`;
}
function geste(m) {
  const v = verdictOf(m), st = ligne(m.id);
  if (v === "gaps" && m.latest.next?.command) return `<span class="k">ensuite, dans le dépôt</span><code class="cmd" translate="no">${esc(m.latest.next.command)}</code>`;
  if (v === "level-not-met") return go(`#/mission/${m.id}`, "Voir ce qui n'est que déclaré", { q: true });
  if (v === "not-observed") return st?.consent ? `<span class="small">${etq("full", "contenu consenti")} Le prochain envoi de ce dépôt sera lu.</span>` : go("#/acces", "Consentir dans Accès", { q: true });
  return "";
}
function comptes() {
  const by = Object.fromEntries((S.index?.fleet.byVerdict ?? []).map((g) => [g.state, g.n]));
  return { N: S.index?.fleet.declared ?? 0, gaps: by.gaps ?? 0, lnm: by["level-not-met"] ?? 0, silent: by["not-observed"] ?? 0, clean: by.clean ?? 0 };
}
const QUOI = {
  "send-accepted": (e) => `envoi accepté (entrée ${e.seq})`, "send-historical": (e) => `relance gardée comme historique, jamais comme courant (entrée ${e.seq})`,
  "send-pending": (e) => `premier envoi, gardé jusqu'à votre confirmation (entrée ${e.seq})`, "send-not-accepted": (e) => `envoi non accepté : ${REFUS_FR[e.refusal] ?? e.refusal} (entrée ${e.seq})`,
  "send-quarantined": (e) => `envoi gardé en quarantaine : ${REFUS_FR[e.refusal] ?? e.refusal} (entrée ${e.seq})`,
};
function jLigne(e) {
  if (e.who === "workload") {
    const shape = e.what === "send-accepted" ? "full" : e.what === "send-not-accepted" || e.what === "send-quarantined" ? "inv" : "void";
    return `<li><span class="h">${hm(e.at)}</span><span class="m"><span class="mk mk-${shape}" aria-hidden="true"></span></span><span><span translate="no">${esc(e.repository ?? "")}</span>${e.runNumber ? `, run ${esc(e.runNumber)}` : ""}<span class="sub">${esc((QUOI[e.what] ?? ((x) => `${WHAT[x.what] ?? x.what} (entrée ${x.seq})`))(e))}</span></span></li>`;
  }
  return `<li><span class="h">${hm(e.at)}</span><span class="m"><span class="mk mk-void" aria-hidden="true"></span></span><span>${esc(WHAT[e.what] ?? e.what)}${e.repository ? ` · <span translate="no">${esc(e.repository)}</span>` : ""}<span class="sub">${esc(WHO[e.who] ?? e.who)} (entrée ${e.seq})</span></span></li>`;
}
const provLigne = () => {
  const i = S.status?.index;
  return i ? `relevé du <b>${esc(S.index?.asOf?.label ?? "")}</b> · index <b>${esc(String(i.sha256).slice(0, 12))}</b> · runward-fleet ${esc(i.fleetVersion)} · assemblé à <b>${hm(i.publishedAt)}</b>, heure du service (déclarée), à l'entrée ${esc(i.seq)}` : "aucun index publié";
};

// --- the shell: the sidebar (desktop) and the menu (phone), the same links
function liensCoque(route, sub) {
  const cur = (cond) => (cond ? ' aria-current="page"' : "");
  const exp = route === "acces" && /^export/.test(sub);
  const N = comptes();
  const a = (h, w, n, c) => `<a class="it" href="${h}"${cur(c)}>${w}${n != null ? `<span class="n0">${n}</span>` : ""}</a>`;
  const principaux = [a("#/", "Flotte", S.index ? N.N : null, route === ""), a("#/envois", "Envois", S.status?.head?.seq ?? S.journal?.head?.seq ?? null, route === "envois"), a("#/acces", "Accès", null, route === "acces" && !exp), a("#/acces/export", "Export", null, exp)].join("");
  const missions = triees().map((m) => { const [sh] = VERDICT_FR[verdictOf(m)] ?? ["void"]; return `<a class="it mis" href="#/mission/${esc(m.id)}"${cur(route === "mission" && sub === m.id)}>${etq(sh, nomCourt(m))}</a>`; }).join("");
  const vues = [["vue", "Vue complète"], ["history", "Historique"], ["proof", "Preuve"], ["signatures", "Signatures"], ["pr", "Dans la PR"], ["sources", "Sources"]].map(([r, w]) => a(`#/${r}`, w, null, route === r)).join("");
  return { principaux, missions, vues };
}
function renderLat(route, sub) {
  const L = liensCoque(route, sub);
  const s = S.session;
  setHTML(latEl, `<div class="lat-in"><a class="marque" href="#/" translate="no">${MARK}runward<span> hébergé</span></a>
    <nav aria-label="Vues du service">${L.principaux}</nav>
    ${L.missions ? `<p class="sec">Missions</p><nav aria-label="Missions, dans l'ordre de ce qui attend">${L.missions}</nav>` : `<p class="sec">Missions</p><nav aria-label="Missions"><a class="it" href="#/">dans la flotte</a></nav>`}
    <p class="sec">Vues runward-fleet</p><nav aria-label="Vues runward-fleet">${L.vues}</nav>
    <div class="bas"><span><b>${esc(s.tenant.title)}</b><br>vous · ${esc(s.member.role === "owner" ? "propriétaire" : s.member.role)} · ${s.passkeys} passkey${s.passkeys > 1 ? "s" : ""}</span>
      <span class="bas-act"><button class="lien-btn" type="button" data-do="logout">Se déconnecter</button><button class="theme" type="button" data-theme-btn aria-label="Changer de thème">thème</button></span></div></div>`);
  setHTML(mobNavEl, `${L.principaux}${L.missions ? `<p class="sec">Missions</p>${L.missions}` : ""}<p class="sec">Vues runward-fleet</p>${L.vues}<button class="lien-btn" type="button" data-do="logout">Se déconnecter</button>`);
}

// --- the public home (signed out). Data-free on purpose: no example fleet is shown on the service's screens.
function viewAccueil() {
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

// --- the dashboard of the fleet (signed in)
function viewFlotte() {
  const s = S.session;
  if (!S.index) {
    return { title: "Flotte", key: "fleet", signed: "in", fleetRoute: "", html: `<div class="dash"><div class="titre-d"><div><h1>${esc(s.tenant.title)}</h1><p class="rv">${provLigne()}</p></div><div class="actions">${go("#/declarer", "Déclarer un dépôt")}</div></div>
      <section class="sect"><h2>Aucune mission publiée.</h2><p class="note">Votre flotte compte les dépôts que vous déclarez, et seulement ceux-là. Une mission apparaît après son premier envoi confirmé.</p></section>
      ${S.status?.recent?.length ? `<section class="sect" aria-labelledby="h-act"><header><h2 id="h-act">Activité récente</h2><a href="#/envois">Tout le journal</a></header><ul class="journal-d">${S.status.recent.map(jLigne).join("")}</ul></section>` : ""}</div>` };
  }
  const N = comptes();
  const attente = triees().filter((m) => verdictOf(m) !== "clean");
  const lignesAtt = attente.map((m) => `<div class="att-r">
      <div>${chipOf(verdictOf(m))}</div>
      <div><p class="nm"><a href="#/mission/${esc(m.id)}" translate="no">${esc(nomLong(m))}</a></p><p class="cause">${cause(m)}</p><p class="src">${sourceLigne(m)}</p></div>
      <div class="geste">${geste(m)}</div></div>`).join("");
  const lignesMis = triees().map((m) => {
    const v = verdictOf(m), [sh, w] = VERDICT_FR[v] ?? VERDICT_FR["not-observed"], st = ligne(m.id), l = typeof m.latest === "object" ? m.latest : null;
    const sous = l ? `${porteFr(l.currentGate)} · ${l.adrCount ?? 0} ADR` : "aucun verdict reçu";
    const env = st?.accepted ? `entrée ${esc(st.accepted.seq)}, ${hm(st.accepted.receivedAt)}<span class="sub hash">${esc(String(st.accepted.commit ?? "").slice(0, 12))}</span>` : `<span class="soft">aucun</span>`;
    const niv = l ? etq("half", l.implemented) : etq("void", "non observé");
    return `<a class="r" href="#/mission/${esc(m.id)}"><span><span class="nm" translate="no">${esc(nomLong(m))}</span><span class="sub">${esc(sous)}</span></span><span>${etq(sh, w)}</span><span class="soft">${env}</span><span class="soft">${niv}</span></a>`;
  }).join("");
  const first = (v) => attente.find((m) => verdictOf(m) === v)?.id;
  const cpt = (v, n, chip) => { const id = first(v); return id ? `<a href="#/mission/${esc(id)}"><span class="v">${n}</span>${chip}</a>` : `<span class="cpt"><span class="v">${n}</span>${chip}</span>`; };
  const recent = S.status?.recent ?? [];
  const jour = recent[0]?.at ? DAY_FR.format(new Date(recent[0].at)) : "";
  return { title: "Flotte", key: "fleet", signed: "in", fleetRoute: "", html: `<div class="dash">
    <div class="titre-d"><div><h1>${esc(s.tenant.title)}</h1><p class="rv">${provLigne()}</p></div>
      <div class="actions">${go("#/acces/export", "Exporter", { q: true })}${go("#/declarer", "Déclarer un dépôt")}</div></div>
    ${S.status?.quarantined ? `<p class="avert">${mk("inv", "non publié")} ${S.status.quarantined} envoi${S.status.quarantined > 1 ? "s" : ""} en quarantaine : la flotte montre le dernier index publié. <a href="#/envois">Voir les envois</a></p>` : ""}
    <nav class="compteurs" aria-label="Missions par état">
      ${cpt("gaps", N.gaps, etq("inv", N.gaps > 1 ? "refusées" : "refusée"))}${cpt("level-not-met", N.lnm, etq("inv", "niveau non atteint"))}${cpt("not-observed", N.silent, etq("void", N.silent > 1 ? "silencieuses" : "silencieuse"))}
      <a href="#/vue"><span class="v">${N.clean}</span>${etq("full", "sans écart")}</a></nav>
    <section class="sect" aria-labelledby="h-att"><header><h2 id="h-att">Ce qui vous attend <span>${attente.length}</span></h2></header>
      ${attente.length ? `<div class="attente">${lignesAtt}</div>` : `<p class="note">Rien ne vous attend : chaque mission déclarée est sans écart.</p>`}</section>
    <div class="duo-d">
      <section class="sect" aria-labelledby="h-mis"><header><h2 id="h-mis">Missions <span>${N.N}</span></h2><a href="#/history">Historique</a></header>
        <div class="ml"><div class="r h" aria-hidden="true"><span>Mission</span><span>État</span><span>Dernier envoi accepté</span><span>Preuve</span></div>${lignesMis}</div></section>
      <section class="sect" aria-labelledby="h-act"><header><h2 id="h-act">Activité récente</h2><a href="#/envois">Tout le journal</a></header>
        ${jour ? `<p class="jour">${esc(jour)}</p>` : ""}<ul class="journal-d">${recent.map(jLigne).join("")}</ul></section>
    </div>
    <div class="recalc"><p class="small soft">Cette vue est l'index <code>${esc(short(S.status?.index?.sha256))}</code>, servi tel quel : <a href="/f/${esc(s.tenant.id)}/index.json">index.json</a>. Sur l'archive exportée, <code translate="no">runward-fleet build fleet.json --out site</code> le reconstruit chez vous. La vue runward-fleet complète : <a href="#/vue">Vue complète</a>. Rien n'est élevé par ce service : ci-declared au plus.</p></div>
  </div>` };
}

// --- a mission: cause, the next gesture, what is missing gate by gate, where the verdict comes from, its activity, then its runward-fleet view
function viewMissionDetail(id) {
  if (!S.index) return null;
  const m = S.index.missions.find((x) => x.id === id);
  if (!m) return null;
  const v = verdictOf(m), st = ligne(m.id), l = typeof m.latest === "object" ? m.latest : null;
  let portes = "";
  if (l) {
    const groupes = [];
    (l.deliverables?.list ?? []).forEach((d) => { let g = groupes.find((x) => x.id === d.phaseId); if (!g) { g = { id: d.phaseId, n: String(d.phase ?? "").split("·")[0].trim(), items: [] }; groupes.push(g); } g.items.push(d); });
    portes = groupes.map((g) => {
      const ok = g.items.filter((d) => d.state === "filled"), ko = g.items.filter((d) => d.state !== "filled");
      const nom = `${g.n}, ${PHASE_FR[g.id] ?? g.id}`;
      const lignes = ko.map((d) => `<div class="r"><span>${esc(nom)}</span><span><code>${esc(d.relPath)}</code> <span class="soft small">${esc(ART_FR[d.artifact] ?? d.artifact)}</span></span><span>${mk("inv", "manquant")}</span></div>`).join("");
      return `${ok.length ? `<div class="r"><span>${esc(nom)}</span><span class="soft">${ok.length} livrable${ok.length > 1 ? "s" : ""} rempli${ok.length > 1 ? "s" : ""}</span><span class="soft">${etq("full", "rempli")}</span></div>` : ""}${lignes}`;
    }).join("");
  }
  let suivant = "";
  if (v === "gaps" && l?.next?.command) suivant = `<div class="suivant"><div><h3>Geste suivant</h3><p>Écrire le livrable qui manque à la porte où la mission bute, puis relancer <code>runward check --strict</code>.</p>${l.next.text ? `<p class="small soft" lang="en">runward : ${esc(l.next.text)}</p>` : ""}</div><code class="cmd" translate="no">${esc(l.next.command)}</code></div>`;
  if (v === "level-not-met") suivant = `<div class="suivant"><div><h3>Geste suivant</h3><p>Ouvrir la preuve de la flotte : elle sépare ce qui est vérifié mécaniquement de ce qui n'est que déclaré par la CI.</p></div>${go("#/proof", "Ouvrir la preuve", { q: true })}</div>`;
  if (v === "not-observed") suivant = `<div class="suivant"><div><h3>Geste suivant</h3><p>${st?.consent ? "Le contenu de ce dépôt est consenti : le prochain envoi accepté fera entrer la mission dans l'index." : "Consentir au contenu de ce dépôt. Sans cet accord, aucun envoi n'est accepté, attestation comprise."}</p></div>${st?.consent ? etq("full", "contenu consenti") : go("#/acces", "Consentir dans Accès", { q: true })}</div>`;
  const a = st?.accepted;
  const prov = a ? `<dl class="cl2"><dt>fichier</dt><dd><code>${esc(sourceDe(m) ?? "")}</code>${l?.runward ? `, écrit par runward ${esc(l.runward)}` : ""}</dd>
      <dt>envoi</dt><dd>entrée ${esc(a.seq)}, reçue le ${when(a.receivedAt)}</dd><dt>run</dt><dd>${esc(a.runId)}, n° ${esc(a.runNumber)}, tentative ${esc(a.runAttempt)}</dd>
      <dt>workflow appelant</dt><dd><code>${esc(a.workflow)}</code></dd><dt>commit</dt><dd><code>${esc(a.commit ?? "")}</code></dd>
      <dt>niveau de preuve</dt><dd>${etq("half", `${l?.implemented ?? "ci-declared"} : déclaré par la CI, rien de plus`)}</dd></dl>`
    : `<p class="note">Aucun envoi accepté : il n'y a pas encore de verdict, donc pas de provenance à montrer.</p>`;
  const attendus = (m.findings ?? []).filter((f) => f.file).map((f) => `<li><span class="h">attendu</span><span class="m"><span class="mk mk-void" aria-hidden="true"></span></span><span>${esc(f.what)} attendu par l'inventaire, absent<span class="sub"><code>${esc(f.file)}</code></span></span></li>`).join("");
  const hist = (st?.activity ?? []).map(jLigne).join("");
  return { title: `Mission ${nomCourt(m)}`, key: "fleet", signed: "in", fleetRoute: "mission", html: `<div class="dash mission-d">
    <p class="fil-d small soft"><a href="#/">Flotte</a> / <span translate="no">${esc(nomLong(m))}</span></p>
    <div>${chipOf(v)}<h1 translate="no">${esc(nomLong(m))}</h1><p class="cause-g">${cause(m)}</p><p class="src">${sourceLigne(m)}</p></div>
    ${suivant}
    ${l && portes ? `<section class="sect" aria-labelledby="h-pp"><header><h2 id="h-pp">${v === "gaps" ? "Ce qui manque, porte par porte" : "Livrables, porte par porte"}</h2></header><div class="manque">${portes}</div></section>` : ""}
    <section class="sect" aria-labelledby="h-prov"><header><h2 id="h-prov">D'où vient ce verdict</h2></header>${prov}</section>
    <section class="sect" aria-labelledby="h-hist"><header><h2 id="h-hist">Activité de la mission</h2><a href="#/envois">Tout le journal</a></header>${hist || attendus ? `<ul class="journal-d">${hist}${attendus}</ul>` : `<p class="note">Aucune activité pour cette mission.</p>`}</section>
    <section class="sect vue-fleet" aria-labelledby="h-vf"><header><h2 id="h-vf">La vue runward-fleet de cette mission</h2><span class="rv">telle que runward-fleet build la construit</span></header>${renderView(S.index, "mission", m.id)}</section>
  </div>` };
}

// ------------------------------------------------------------- access: gestures that withdraw, then restore
const KINDS = {
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
function confirmBox(k) {
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
const ask = (k, label, q = true) => `<button class="${q ? "btn btn-q" : "lien-btn"}" type="button" data-do="ask" data-k="${esc(k)}" data-focus-key="${esc(k)}">${esc(label)}</button>`;

function viewAcces(sub) {
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

// ------------------------------------------------------------- outage, maintenance, legal, 404
function viewPanne(sub) {
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
function viewLegal() {
  return { title: "Mentions et sécurité", key: "panne", signed: "any", html: `${head("runward hébergé · mentions", "écran public, non indexé")}
    <h1 class="v">Mentions, confidentialité, sécurité.</h1>
    <div class="grid2">
      <section class="panel"><h2>Mentions légales</h2><p class="small"><span class="k">éditeur</span>${esc(META("runward-publisher") || "Thibault Souris, personne physique")}</p><p class="small"><span class="k">hébergeur</span>Scaleway, région Paris</p><p class="small"><span class="k">service</span>runward hébergé, sous licence FSL-1.1-MIT ; la vue est runward-fleet, sous licence MIT.</p></section>
      <section class="panel"><h2>Confidentialité</h2><ul class="small"><li>Pour vous connecter : la clé publique de vos passkeys et vos sessions, rien d'autre. Aucune adresse e-mail, aucun mot de passe.</li><li>Pour vos missions : le contenu des exports des dépôts que vous avez consentis, gardé tant que le dépôt est déclaré, puis 30 jours.</li><li>Un seul cookie, celui de la session. Aucune mesure d'audience, aucun service tiers dans la page.</li><li>Tout est hébergé dans l'Union européenne. Effacement dans Accès, ou sur demande.</li></ul></section>
      <section class="panel"><h2>Sécurité</h2><p class="small">Pour signaler une faille : le contact de <a href="/.well-known/security.txt"><code>/.well-known/security.txt</code></a> (RFC 9116).</p></section>
    </div>` };
}
function view404(hash) {
  return { title: "Adresse inconnue", key: "panne", signed: "any", html: `${head("runward hébergé", "404")}<h1 class="v">Cette adresse n'existe pas.</h1><p class="face">${mk("void", "introuvable")} <code>${esc(hash)}</code> ne mène à aucune page de ce service. Le lien est peut-être incomplet.</p><div class="actions">${S.session ? go("#/", "Ouvrir la flotte") : go("#/entree/connexion", "Aller à la connexion")}</div>` };
}
const loadingView = (title) => ({ title, key: "fleet", signed: "in", html: `<h1 class="v">Chargement…</h1><div class="charge" role="progressbar" aria-label="Chargement"></div><div class="squelette"></div><div class="squelette"></div>` });

// ------------------------------------------------------------- banners and shell
function renderBandeaux() {
  const b = [], s = S.session;
  if (s?.recovery) b.push(`<div class="bandeau" role="alert"><p><b>Une reprise d'accès est en cours pour votre compte.</b> Ouverte le ${when(s.recovery.openedAt, { sec: false })}, elle deviendra utilisable le ${when(s.recovery.usableFrom, { sec: false })}. Si ce n'est pas vous, annulez-la.</p><div class="actions">${ask(`recovery:${s.recovery.id}`, "Annuler la reprise", false)}</div>${confirmBox(`recovery:${s.recovery.id}`)}</div>`);
  if (s && s.passkeys === 1) b.push(`<div class="bandeau"><p><b>Vous n'avez qu'une passkey.</b> Si vous perdez cet appareil, il faudra passer par la reprise d'accès, qui prend 24 heures.</p><div class="actions">${go(s.arrivalDone ? "#/acces/ajout" : "#/arrivee", "Ajouter une passkey", { q: true })}</div></div>`);
  for (const p of s?.addedElsewhere ?? []) b.push(`<div class="bandeau" role="alert"><p><b>Une passkey a été ajoutée à votre compte</b> le ${when(p.createdAt, { sec: false })}${p.device ? `, depuis ${esc(p.device)}` : ""}${p.provider ? ` : « ${esc(p.provider)} »` : ""}. Si ce n'est pas vous, retirez-la et fermez les sessions que vous ne reconnaissez pas.</p><div class="actions">${go("#/acces", "Voir mes passkeys", { q: true })}</div></div>`);
  if (S.newVersion) b.push(`<div class="bandeau"><p><b>Une nouvelle version du service est en ligne.</b> Cette page a été chargée avec la précédente.</p><div class="actions">${act("reload", "Recharger", { q: true })}</div></div>`);
  if (s?.maintenance) b.push(`<div class="bandeau"><p><b>Maintenance${s.maintenance.until ? ` jusqu'au ${when(s.maintenance.until, { sec: false })}` : ""}.</b> La lecture reste ouverte ; les gestes qui écrivent attendent la fin.</p></div>`);
  setHTML(bandEl, b.join(""));
}
function shell(signedIn, route, sub, v) {
  const pub = !signedIn && Boolean(v.public);
  document.body.classList.toggle("connecte", signedIn);
  document.body.classList.toggle("public", pub);
  latEl.hidden = !signedIn; mobEl.hidden = !signedIn && !pub; mobEl.open = false;
  const PUB_LINKS = `<button class="lien-nav" type="button" data-do="scroll" data-k="marche">Comment ça marche</button><button class="lien-nav" type="button" data-do="scroll" data-k="confiance">Confiance</button><a class="lien-nav" href="https://runward.dev" rel="noreferrer">Documentation</a>`;
  if (signedIn) renderLat(route, sub); else { setHTML(latEl, ""); setHTML(mobNavEl, pub ? `${PUB_LINKS}<button class="lien-btn theme-m" type="button" data-theme-btn>Changer de thème</button>` : ""); }
  setHTML(stampEl, signedIn ? esc(S.session.tenant.title) : v.public ? "" : esc(location.host));
  setHTML(pubEl, pub ? PUB_LINKS : "");
  setHTML(topActEl, !signedIn && v.public ? `${go("#/entree/connexion", "Se connecter", { q: true })}<a class="btn" href="${MAILTO}">Demander l'accès</a>` : "");
  setHTML(piedEl, `<div class="wrap"><a href="#/legal">Mentions légales</a> · <a href="#/legal">Confidentialité</a> · <a href="#/legal">Sécurité</a> · <span class="soft">heures affichées à l'heure de Paris, avec leur décalage</span></div>`);
}

// ------------------------------------------------------------- router
const parts = () => { const h = location.hash.replace(/^#\/?/, ""); const p = h.split("/"); return { h, route: p[0], sub: p.slice(1).join("/") }; };
const PROTECTED = new Set(["arrivee", "declarer", "envois", "acces", "vue", ...ROUTES]);
function resolve() {
  const { route, sub } = parts();
  if (route === "entree") return viewEntree(sub);
  if (route === "lien") return viewLien(sub);
  if (route === "reprise") return sub ? null : viewReprise();
  if (route === "arrivee") return viewArrivee(sub);
  if (route === "declarer") return viewDeclarer(sub);
  if (route === "envois") return viewEnvois();
  if (route === "acces") return viewAcces(sub);
  if (route === "panne") return viewPanne(sub);
  if (route === "legal") return sub ? null : viewLegal();
  if (route === "" || route === "vue" || ROUTES.includes(route)) return viewFleet(route, sub ? decodeURIComponent(sub) : "");
  return null;
}

let loadedFor = null;
async function show() {
  const { h, route, sub } = parts();
  if (S.session === undefined && !S.error) await loadSession();
  if (S.session === undefined && S.error) { if (route !== "panne") { location.replace(navigator.onLine === false ? "#/panne/hors-ligne" : "#/panne"); return; } }
  if (S.session && route === "entree" && sub !== "sortie") { location.replace(S.session.arrivalDone ? "#/" : "#/arrivee"); return; }
  // signed out: the root opens the public home; any other protected address opens the sign-in, with its intent
  if (!S.session && PROTECTED.has(route)) {
    S.intent = route === "" ? null : location.hash;
    location.replace(S.session === null && S.closedBy === "passkey" ? "#/entree/session-fermee" : route === "" ? "#/entree" : "#/entree/connexion");
    return;
  }
  if (S.session && !S.session.arrivalDone && (route === "" || route === "vue" || ROUTES.includes(route))) { location.replace("#/arrivee"); return; }
  // the reads of this screen, once per opening (switching fleet views reuses the index: 0 more reads)
  // the sidebar lists the missions from the index once this page has read it; a screen opened cold
  // (Envois, Accès) does not read the index for its sidebar, so its budget stays its own (architecture §6)
  const key = route === "" || route === "vue" || ROUTES.includes(route) ? "fleet" : ["arrivee", "declarer", "acces"].includes(route) ? "access" : route === "envois" ? `journal:${sub}` : null;
  if (S.session && key && loadedFor !== key) {
    loadedFor = key;
    paint(loadingView(""));
    if (key === "fleet") await loadFleet(); else if (key === "access") await loadAccess(); else await loadJournal(sub);
  }
  paint(resolve() ?? view404(location.hash || "#/"));
}
function paint(v) {
  const { route, sub } = parts();
  shell(Boolean(S.session) && v.signed !== "out", v.fleetRoute ?? route, sub, v);
  renderBandeaux();
  setHTML(main, v.html);
  document.title = `${v.title ? `${v.title} · ` : ""}runward hébergé`;
  after(v);
}
function nbsp(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (n.parentElement?.closest("code,pre,script,style,[lang='en']")) continue;
    const t = n.textContent.replace(/ ([:;?!»])/g, " $1").replace(/« /g, "« ");
    if (t !== n.textContent) n.textContent = t;
  }
}
function after(v) {
  [main, bandEl, piedEl].forEach(nbsp);
  main.querySelectorAll("[data-verbatim], .md").forEach((el) => { if (/\b(the|and|is|not|of|to|does|it|no|that|this|are|be|has|by|for|or)\b/i.test(el.textContent)) el.setAttribute("lang", "en"); });
  main.querySelectorAll(".tw:not([tabindex])").forEach((el) => { el.tabIndex = 0; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Tableau, défilable"); });
  const f = document.querySelector("[data-focus]") || (S.focusKey ? document.querySelector(`[data-focus-key="${CSS.escape(S.focusKey)}"]`) : null) || (v.focus ? main.querySelector(v.focus) : null);
  (f ?? main).focus({ preventScroll: true });
  S.focusKey = null;
}
function say(msg) { annonceEl.textContent = ""; setTimeout(() => { annonceEl.textContent = msg; }, 60); }
const rerender = () => paint(resolve() ?? view404(location.hash));
const refreshScreen = async () => { loadedFor = null; await loadSession(); await show(); };

// ------------------------------------------------------------- gestures
async function signIn(mode) {
  location.hash = "#/entree/attente";
  const o = await api("POST", "/api/v0/auth/options", {});
  if (!o.ok) { S.error = o; location.hash = "#/panne"; return; }
  const c = await ceremony("get", o.data.options, HINT[mode]);
  if (!c.ok) { location.hash = c.why === "unsupported" ? "#/entree/sans-passkey" : c.why === "offline" ? "#/panne/hors-ligne" : "#/entree/echec"; return; }
  const r = await api("POST", "/api/v0/auth/verify", { challengeId: o.data.challengeId, response: c.response });
  if (!r.ok) { location.hash = r.refusal === "passkey-unknown" ? "#/entree/inconnue" : r.refusal === "challenge-invalid" ? "#/entree/expiree" : "#/entree/echec"; return; }
  await loadSession(); loadedFor = null;
  const back = S.intent; S.intent = null;
  location.hash = !S.session.arrivalDone ? "#/arrivee" : back && !back.startsWith("#/entree") ? back : "#/";
}

/** A fresh verification, bound to a gesture and its object when one is named. */
async function verify(gesture = null, object = null) {
  const o = await api("POST", "/api/v0/auth/fresh/options", gesture ? { gesture, object } : {});
  if (!o.ok) return { ok: false, r: o };
  const c = await ceremony("get", o.data.options);
  if (!c.ok) return { ok: false, why: c.why };
  const r = await api("POST", "/api/v0/auth/fresh", { challengeId: o.data.challengeId, response: c.response });
  if (r.ok && !gesture) S.freshUntil = Date.parse(r.data.until);
  return r.ok ? { ok: true } : { ok: false, r };
}
/** Run a write: per-gesture verification when `gesture`, else a fresh one when the server asks for it. */
async function write(method, path, body, { gesture = null, object = "" } = {}) {
  if (gesture) { const v = await verify(gesture, object); if (!v.ok) return { ok: false, verify: v }; }
  // every other write asks a verification less than 5 minutes old: ask it first when this page knows it lapsed
  else if (!(S.freshUntil > Date.now() + 15_000)) { const v = await verify(); if (!v.ok) return { ok: false, verify: v }; }
  let r = await api(method, path, body);
  if (r.refusal === "fresh-required") { const v = await verify(); if (!v.ok) return { ok: false, verify: v }; r = await api(method, path, body); }
  return r;
}

async function addPasskey(mode) {
  S.addError = null;
  const v = await verify("passkey-add", "");
  if (!v.ok) { S.addError = "cancelled"; return refreshAfterAdd(); }
  const o = await api("POST", "/api/v0/passkeys/options", {});
  if (!o.ok) { S.addError = o.refusal === "passkey-exists" ? "exists" : "cancelled"; return refreshAfterAdd(); }
  const c = await ceremony("create", o.data.options, HINT[mode]);
  if (!c.ok) { S.addError = c.why === "exists" ? "exists" : "cancelled"; return refreshAfterAdd(); }
  const r = await api("POST", "/api/v0/passkeys", { challengeId: o.data.challengeId, response: c.response });
  if (!r.ok) S.addError = r.refusal === "passkey-exists" ? "exists" : "cancelled";
  else say("Passkey ajoutée.");
  return refreshAfterAdd();
}
async function refreshAfterAdd() {
  const onArrival = parts().route === "arrivee";
  await refreshScreen();
  if (onArrival && S.addError) location.hash = S.addError === "exists" ? "#/arrivee/seconde-existe" : "#/arrivee/seconde-annulee";
  else if (!onArrival && !S.addError) location.hash = "#/acces";
  else rerender();
}

async function redeem(mode) {
  const token = S.link;
  location.hash = "#/lien/attente";
  const o = await api("POST", "/api/v0/links/options", { token });
  if (!o.ok) { S.linkInfo = { ...S.linkInfo, state: o.refusal?.startsWith("link-") ? o.refusal : S.linkInfo.state }; location.hash = "#/lien"; return; }
  const c = await ceremony("create", o.data.options, HINT[mode]);
  if (!c.ok) { location.hash = c.why === "unsupported" ? "#/entree/sans-passkey" : "#/lien/annulee"; return; }
  const r = await api("POST", "/api/v0/links/redeem", { token, challengeId: o.data.challengeId, response: c.response });
  if (!r.ok) {
    if (r.network || r.status >= 500) {
      S.lastError = r;
      try { await PublicKeyCredential.signalUnknownCredential?.({ rpId: location.hostname, credentialId: c.response.id }); } catch { /* the browser may not offer it */ }
      location.hash = "#/lien/panne"; return;
    }
    S.linkInfo = { ...S.linkInfo, state: r.refusal?.startsWith("link-") ? r.refusal : "link-live" };
    location.hash = r.refusal?.startsWith("link-") ? "#/lien" : "#/lien/annulee"; return;
  }
  S.link = null;
  await loadSession(); loadedFor = null;
  location.hash = "#/arrivee";
}

const ROUTE_OF = {
  passkey: (id) => ["DELETE", `/api/v0/passkeys/${id}`], restore: (id) => ["POST", `/api/v0/passkeys/${id}/restore`], session: (id) => ["DELETE", `/api/v0/sessions/${id}`],
  repo: (id) => ["DELETE", `/api/v0/repositories/${id}`], restorerepo: (id) => ["POST", `/api/v0/repositories/${id}/restore`], consentir: (id) => ["POST", `/api/v0/repositories/${id}/consent`],
  consent: (id) => ["DELETE", `/api/v0/repositories/${id}/consent`], purge: (id) => ["DELETE", `/api/v0/repositories/${id}/content`], reader: () => ["DELETE", "/api/v0/reader"],
  readeron: () => ["POST", "/api/v0/reader"], closeothers: () => ["POST", "/api/v0/sessions/close-others"], recovery: () => ["POST", "/api/v0/recovery/cancel"], lang: () => ["POST", "/api/v0/tenant/settings"],
};
const DONE = {
  passkey: "Passkey retirée. Vous pouvez la remettre pendant 24 heures.", session: "Session fermée.", repo: "Dépôt retiré. Vous pouvez le remettre pendant 30 jours.",
  consent: "Consentement retiré. Les prochains envois de ce dépôt ne seront plus acceptés.", consentir: "Contenu consenti pour ce dépôt.", purge: "Contenu reçu effacé.",
  restore: "Passkey remise.", restorerepo: "Dépôt remis.", reader: "Lecteur automatique retiré.", readeron: "Lecteur automatique autorisé.", closeothers: "Les autres sessions sont fermées.", recovery: "Reprise d'accès annulée.", lang: "Langue changée ; l'index est reconstruit.",
};
async function confirmGesture(k) {
  const [kind, id] = k.split(":");
  const t = KINDS[kind];
  const erase = kind === "consent" && document.querySelector('input[name="sort"]:checked')?.value === "effacer";
  S.busy = k; S.failed = null; rerender();
  const [method, path] = ROUTE_OF[kind](id);
  const body = kind === "consent" ? { erase } : kind === "lang" ? { lang: id } : {};
  const object = ["reader", "readeron", "closeothers", "lang"].includes(kind) ? "" : kind === "recovery" ? id : id;
  const r = await write(method, path, body, { gesture: t.g, object });
  S.busy = null;
  if (!r.ok) { S.failed = k; S.failedText = r.message ? `${r.message} ${r.action ?? ""}` : null; return rerender(); }
  S.confirming = null;
  say(DONE[kind] ?? "Fait.");
  if ((kind === "passkey" && r.data?.closedCurrent) || (kind === "session" && r.data?.closedCurrent)) { S.session = null; S.closedBy = "passkey"; location.hash = "#/entree/session-fermee"; return; }
  S.focusKey = k;
  await refreshScreen();
}

document.addEventListener("click", async (e) => {
  const g = e.target.closest("[data-go]");
  if (g) { e.preventDefault(); S.formError = null; const to = g.dataset.go; if (location.hash === to) show(); else location.hash = to; return; }
  const b = e.target.closest("[data-do]");
  if (!b) return;
  const k = b.dataset.k, what = b.dataset.do;
  if (what === "signin") return signIn(k);
  if (what === "redeem") return redeem(k);
  if (what === "addpk") return addPasskey(k);
  if (what === "logout") { await api("POST", "/api/v0/auth/logout", {}); S.session = null; S.index = null; loadedFor = null; location.hash = "#/entree/sortie"; say("Vous êtes déconnecté."); return; }
  if (what === "reload") { location.reload(); return; }
  if (what === "reload-screen") { S.error = null; S.session = undefined; loadedFor = null; location.hash = location.hash.startsWith("#/panne") ? "#/" : location.hash; return show(); }
  if (what === "copy") {
    const pre = document.getElementById(b.dataset.copyTarget), out = document.getElementById("copie-etat");
    try { await navigator.clipboard.writeText(pre.textContent + "\n"); b.textContent = "Copié"; if (out) out.textContent = "L'extrait est dans votre presse-papiers."; }
    catch { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); if (out) out.textContent = "Extrait sélectionné : copiez-le avec ⌘C ou Ctrl+C."; }
    setTimeout(() => { b.textContent = "Copier l'extrait"; }, 2400);
    return;
  }
  if (what === "scroll") { mobEl.open = false; document.getElementById(k)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); return; }
  if (what === "ask") { S.confirming = k; S.busy = null; S.failed = null; S.focusKey = k; return rerender(); }
  if (what === "cancel") { const was = S.confirming; S.confirming = null; S.failed = null; S.focusKey = was; return rerender(); }
  if (what === "confirm") return confirmGesture(k);
  if (what === "single") {
    const r = await write("POST", "/api/v0/passkeys/single", {}, { gesture: "passkey-single", object: "" });
    if (r.ok) say("Choix écrit au journal : une seule passkey. Les étapes suivantes sont ouvertes.");
    await refreshScreen(); location.hash = "#/arrivee"; return;
  }
  if (what === "gesture" && k.startsWith("confirm:")) {
    const id = k.slice(8);
    const r = await write("POST", `/api/v0/repositories/${id}/confirm`, {}, { gesture: "repository-confirm", object: id });
    if (!r.ok) { S.failed = k; return rerender(); }
    say(r.data?.quarantine ? "Dépôt confirmé. Son premier envoi reste en quarantaine." : "Dépôt confirmé. La mission est publiée.");
    await loadSession(); loadedFor = null; location.hash = S.session.arrivalDone ? "#/" : "#/arrivee"; return;
  }
  if (what === "export") {
    S.export = { busy: true }; rerender();
    const r = await write("POST", "/api/v0/export", {}, { gesture: "export", object: "" });
    S.export = r.ok ? { ready: r.data } : { error: r.r ?? r.verify?.r ?? r };
    return rerender();
  }
});

main.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const val = (n) => f.elements[n]?.value?.trim() ?? "";
  if (f.id === "declare") {
    S.formValues = { repo: val("repo"), wf: val("wf"), mission: val("mission"), path: val("path") || ".", branch: val("branch") || "main" };
    const consent = f.elements.content.checked;
    const body = { name: S.formValues.repo, workflow: S.formValues.wf, defaultBranch: S.formValues.branch, missions: S.formValues.mission ? [{ id: S.formValues.mission, path: S.formValues.path }] : [], consent };
    const r = await write("POST", "/api/v0/repositories", body, consent ? { gesture: "declare-with-consent", object: S.formValues.repo.toLowerCase() } : {});
    if (!r.ok) { const x = r.data ? r : r.verify?.r ?? { message: "La vérification n'a pas abouti. Rien n'a changé.", action: "" }; S.formError = { field: FIELD_OF[x.refusal] ?? null, message: x.message, action: x.action, requestId: x.requestId }; return rerender(); }
    S.formError = null; S.formValues = null; say("Dépôt déclaré, en attente du premier envoi.");
    const onArrival = parts().route === "arrivee";
    await refreshScreen();
    location.hash = onArrival ? "#/arrivee" : `#/declarer/attente/${r.data.id}`;
  }
  if (f.id === "modify") {
    const id = f.dataset.id;
    const remove = [...f.querySelectorAll('input[name="remove"]:checked')].map((x) => x.value);
    const body = { workflow: val("wf"), defaultBranch: val("branch") || "main", addMissions: val("mission") ? [{ id: val("mission"), path: val("path") || "." }] : [], removeMissions: remove, knowingSendsStay: remove.length > 0 };
    const r = await write("PATCH", `/api/v0/repositories/${id}`, body);
    if (!r.ok) { const x = r.data ? r : { message: "La vérification n'a pas abouti. Rien n'a changé.", action: "" }; S.formError = { message: x.message, action: x.action }; return rerender(); }
    S.formError = null; say("Dépôt modifié."); await refreshScreen(); location.hash = "#/acces";
  }
});

(function theme() {
  const KEY = "runward-hosted-theme";
  let saved = null; try { saved = localStorage.getItem(KEY); } catch { saved = null; }
  if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-theme-btn]")) return;
    const cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch { /* a per-viewer convenience only */ }
  });
})();

// ------------------------------------------------------------- boot: a link in the fragment, never in the address
(async function boot() {
  if (location.pathname === "/lien") {
    const m = /^#t=([A-Za-z0-9_-]+)$/.exec(location.hash);
    S.link = m ? m[1] : null;
    history.replaceState(null, "", "/#/lien");
    await loadSession();
    if (S.link) { const r = await api("POST", "/api/v0/links/inspect", { token: S.link }); S.linkInfo = r.ok ? r.data : { state: "link-invalid" }; }
  }
  window.addEventListener("hashchange", () => { S.confirming = null; S.failed = null; show(); });
  window.addEventListener("online", () => { if (parts().route === "panne") show(); });
  await show();
})();
