// The words of the shell: what the journal calls an act, what a verdict, a gate and a deliverable are
// called in French, and the lines the dashboard, a mission and the sidebar say with them.
// Everything is read from the index served and from GET /api/v0/fleet/status, already loaded for the screen:
// opening a mission costs 0 more read (architecture §6). No example data: what is shown is the tenant's.
import { S, esc } from "./base.js";
import { hm } from "./time.js";
import { mk, etq, go } from "./marks.js";

export const WHAT = {
  "send-accepted": "envoi accepté", "send-historical": "envoi accepté, plus ancien que le courant", "send-pending": "premier envoi gardé, à confirmer", "send-not-accepted": "envoi non accepté", "send-quarantined": "envoi gardé en quarantaine",
  "repository-declared": "dépôt déclaré", "repository-changed": "dépôt modifié", "repository-confirmed": "dépôt confirmé", "repository-removed": "dépôt retiré", "repository-restored": "dépôt remis", "repository-expired": "déclaration expirée",
  "consent-given": "contenu consenti", "consent-withdrawn": "consentement retiré", "content-erased": "contenu effacé", "member-founded": "membre créé", "member-recovered": "accès repris",
  "signed-in": "connexion", "signed-out": "déconnexion", "session-closed": "session fermée", "sessions-closed-others": "autres sessions fermées", "passkey-added": "passkey ajoutée", "passkey-removed": "passkey retirée",
  "passkey-restored": "passkey remise", "passkey-single-chosen": "choix : une seule passkey", "recovery-opened": "reprise d'accès ouverte", "recovery-cancelled": "reprise d'accès annulée", "access-reset": "accès réinitialisé par l'opérateur",
  "bootstrap-opened": "amorçage ouvert par l'opérateur", "export-prepared": "archive préparée", "settings-changed": "réglage changé", "reader-authorized": "lecteur automatique autorisé", "reader-withdrawn": "lecteur automatique retiré", "reader-read": "lecture du lecteur automatique", "restore-replayed": "restauration rejouée",
};
export const WHO = { human: "identité humaine", workload: "identité de charge", operator: "opérateur du service", reader: "lecteur automatique" };
export const MAILTO = "mailto:contact@runward.dev?subject=Acc%C3%A8s%20%C3%A0%20la%20pr%C3%A9version%20de%20runward%20h%C3%A9berg%C3%A9";
export const VERDICT_FR = { gaps: ["inv", "refusée"], "level-not-met": ["inv", "niveau non atteint"], "not-observed": ["void", "silencieuse"], clean: ["full", "sans écart"] };
const ORDER = { gaps: 0, "level-not-met": 1, "not-observed": 2, clean: 3 };
export const PHASE_FR = { frame: "Cadrer", architect: "Architecturer", floor: "Plancher", iterate: "Itérer", govern: "Gouverner", handover: "Transmettre" };
const GATE_KEY = { frame: "frame", architect: "architect", floor: "floor", iterate: "iterate", govern: "govern", hand: "handover" };
export const ART_FR = {
  "Framing note": "note de cadrage", "Steering contract": "contrat de pilotage", "Architecture note": "note d'architecture",
  "Execution topology": "topologie d'exécution", "Decision matrix": "matrice de décision", "Decision journal (≥1 ADR)": "journal de décisions",
  "Port contracts (≥1 filled)": "contrats de ports", "Floor note (measured proof)": "note de plancher, preuve mesurée", "Threat model": "modèle de menaces",
  "Evaluation rubric": "grille d'évaluation", "Observability schema": "schéma d'observabilité", "Recovery runbook": "runbook de reprise",
  "Hand-over note (the kit, proven)": "note de passation",
};
const REFUS_FR = { "workflow-not-pinned": "workflow appelant non déclaré", "content-not-consented": "contenu non consenti", "repository-pending": "dépôt en attente de votre confirmation", "repository-not-declared": "dépôt non déclaré ou retiré", "owner-changed": "propriétaire changé", "private-path": "chemin privé", "index-build-refused": "export que runward-fleet ne sait pas assembler", "index-rule-broken": "règle de vue cassée" };
export const chipOf = (v) => { const [sh, w] = VERDICT_FR[v] ?? VERDICT_FR["not-observed"]; return sh === "inv" ? mk("inv", w) : etq(sh, w); };
export const verdictOf = (m) => (m && typeof m.latest === "object" && m.latest ? m.latest.verdict : "not-observed");
export const nomLong = (m) => m.name;
export const nomCourt = (m) => (m.path && m.path !== "." ? m.path.split("/").pop() : m.name.split("/").pop());
export const triees = () => (S.index ? [...S.index.missions].sort((a, b) => (ORDER[verdictOf(a)] ?? 9) - (ORDER[verdictOf(b)] ?? 9)) : []);
export const ligne = (id) => S.status?.lines.find((l) => l.mission === id) ?? null;
export function porteFr(gate) {
  if (!gate || gate === "all gates passed") return "toutes les portes";
  const g = /^(\d+)\s*·\s*([A-Za-z]+)/.exec(gate);
  return g ? `porte ${g[1]}, ${PHASE_FR[GATE_KEY[g[2].toLowerCase()]] ?? g[2]}` : gate;
}
const manquants = (m) => (typeof m.latest === "object" ? (m.latest.deliverables?.list ?? []).filter((d) => d.state !== "filled") : []);
export const sourceDe = (m) => (typeof m.latest === "object" ? S.index.sources.find((s) => s.id === m.latest.src)?.path : null);
export function cause(m) {
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
export function sourceLigne(m) {
  const st = ligne(m.id);
  if (!st || !st.accepted) return `source : journal${st?.lastRefusalSeq ? `, entrée ${esc(st.lastRefusalSeq)}` : ""}`;
  return `source : <code>${esc(sourceDe(m) ?? "")}</code>, commit ${esc(String(st.accepted.commit ?? "").slice(0, 12))}, entrée ${esc(st.accepted.seq)} à ${hm(st.accepted.receivedAt)}`;
}
export function geste(m) {
  const v = verdictOf(m), st = ligne(m.id);
  if (v === "gaps" && m.latest.next?.command) return `<span class="k">ensuite, dans le dépôt</span><code class="cmd" translate="no">${esc(m.latest.next.command)}</code>`;
  if (v === "level-not-met") return go(`#/mission/${m.id}`, "Voir ce qui n'est que déclaré", { q: true });
  if (v === "not-observed") return st?.consent ? `<span class="small">${etq("full", "contenu consenti")} Le prochain envoi de ce dépôt sera lu.</span>` : go("#/acces", "Consentir dans Accès", { q: true });
  return "";
}
export function comptes() {
  const by = Object.fromEntries((S.index?.fleet.byVerdict ?? []).map((g) => [g.state, g.n]));
  return { N: S.index?.fleet.declared ?? 0, gaps: by.gaps ?? 0, lnm: by["level-not-met"] ?? 0, silent: by["not-observed"] ?? 0, clean: by.clean ?? 0 };
}
const QUOI = {
  "send-accepted": (e) => `envoi accepté (entrée ${e.seq})`, "send-historical": (e) => `relance gardée comme historique, jamais comme courant (entrée ${e.seq})`,
  "send-pending": (e) => `premier envoi, gardé jusqu'à votre confirmation (entrée ${e.seq})`, "send-not-accepted": (e) => `envoi non accepté : ${REFUS_FR[e.refusal] ?? e.refusal} (entrée ${e.seq})`,
  "send-quarantined": (e) => `envoi gardé en quarantaine : ${REFUS_FR[e.refusal] ?? e.refusal} (entrée ${e.seq})`,
};
export function jLigne(e) {
  if (e.who === "workload") {
    const shape = e.what === "send-accepted" ? "full" : e.what === "send-not-accepted" || e.what === "send-quarantined" ? "inv" : "void";
    return `<li><span class="h">${hm(e.at)}</span><span class="m"><span class="mk mk-${shape}" aria-hidden="true"></span></span><span><span translate="no">${esc(e.repository ?? "")}</span>${e.runNumber ? `, run ${esc(e.runNumber)}` : ""}<span class="sub">${esc((QUOI[e.what] ?? ((x) => `${WHAT[x.what] ?? x.what} (entrée ${x.seq})`))(e))}</span></span></li>`;
  }
  return `<li><span class="h">${hm(e.at)}</span><span class="m"><span class="mk mk-void" aria-hidden="true"></span></span><span>${esc(WHAT[e.what] ?? e.what)}${e.repository ? ` · <span translate="no">${esc(e.repository)}</span>` : ""}<span class="sub">${esc(WHO[e.who] ?? e.who)} (entrée ${e.seq})</span></span></li>`;
}
export const provLigne = () => {
  const i = S.status?.index;
  return i ? `relevé du <b>${esc(S.index?.asOf?.label ?? "")}</b> · index <b>${esc(String(i.sha256).slice(0, 12))}</b> · runward-fleet ${esc(i.fleetVersion)} · assemblé à <b>${hm(i.publishedAt)}</b>, heure du service (déclarée), à l'entrée ${esc(i.seq)}` : "aucun index publié";
};
