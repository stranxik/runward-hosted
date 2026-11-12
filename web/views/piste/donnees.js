// « La piste » (ADR-0035): what the rails show, derived from what runward-fleet's index and the service's status
// already carry, and from nothing else. No word and no HTML here: plain values, so that each derivation is tested on
// the real fixtures (test/unit/piste.test.js).
//
// What the index carries for an application (runward-fleet at d052814, src/build.js#projectVerdict): its latest
// check only (`latest`): the verdict, the gate, the required documents with their step (`deliverables.list[].phaseId`)
// and state, the refusals with their file, line, rule, kind, text and step (`conformance[]`), the rows of the team's
// record by state (`ratification.byState[].list`, « document · rule »), and their count (`evidence.rows`). What the
// status carries per application (GET /api/v0/fleet/status): the accepted upload in force (date, run, commit, its
// chain) and the last eight acts of its journal (uploads accepted, replaced, refused, the first one's confirmation),
// with no verdict for an earlier upload. So:
//   - the step of a refusal is its own `phaseId` when it names one of the six steps; else the step of the required
//     document its file is (« runward/execution-topology.md » is the document of Architecturer); else none;
//   - the count of requirements per step is given only when every row of the record is listed and each one's document
//     is a required document of a step (the rows the lists hold are exactly `evidence.rows`); otherwise it is none, and
//     the screen says pieces and refusals only;
//   - what moved between two checks is computed only between two indexes this page held (the one it showed, the one
//     a live read brought): the service serves no earlier check's content.

export const ETAPES = ["frame", "architect", "floor", "iterate", "govern", "handover"];
const GATE = { frame: "frame", architect: "architect", floor: "floor", iterate: "iterate", govern: "govern", hand: "handover", handover: "handover" };

const latestOf = (m) => (m && typeof m.latest === "object" && m.latest ? m.latest : null);
export const verdictOf = (m) => latestOf(m)?.verdict ?? "not-observed";
const list = (L) => (Array.isArray(L?.deliverables?.list) ? L.deliverables.list : []);
const conformance = (L) => (Array.isArray(L?.conformance) ? L.conformance : []);

/** The required document a file of the repository is, by its path (the mission may sit in a folder). */
function documentOf(L, file) {
  const f = String(file ?? "");
  if (!f) return null;
  return list(L).find((d) => d.relPath && (f === d.relPath || f.endsWith(`/${d.relPath}`) || f.includes(`/${d.relPath}/`) || f.startsWith(`${d.relPath}/`))) ?? null;
}
/** The step of a refusal: its own, else its document's, else none. */
export function stepOfRefusal(L, c) {
  if (ETAPES.includes(c?.phaseId)) return c.phaseId;
  const d = documentOf(L, c?.file);
  return d && ETAPES.includes(d.phaseId) ? d.phaseId : null;
}
/** The steps the gate names, as runward writes it: « 3 · Floor », or « … gate red at Floor, Govern ». */
export function gateSteps(gate) {
  const g = String(gate ?? "");
  const one = /^(\d+)\s*·\s*([A-Za-z]+)/.exec(g);
  if (one) return GATE[one[2].toLowerCase()] ? [GATE[one[2].toLowerCase()]] : [];
  const red = /gate red at\s+(.+)$/i.exec(g);
  if (!red) return [];
  return red[1].split(",").map((p) => GATE[p.trim().split(/\s+/)[0].toLowerCase()]).filter(Boolean);
}

/** The requirements of the team per step, when every row is listed and placed; else null (never a guess). */
export function rowsByStep(L) {
  const total = L?.evidence?.rows;
  const groups = Array.isArray(L?.ratification?.byState) ? L.ratification.byState : null;
  if (!groups || typeof total !== "number" || total <= 0) return null;
  const rows = groups.flatMap((g) => (Array.isArray(g?.list) ? g.list : []));
  if (rows.length !== total) return null;
  const by = Object.fromEntries(ETAPES.map((e) => [e, 0]));
  for (const row of rows) {
    const doc = String(row).split(" · ")[0];
    const d = list(L).find((x) => x.relPath === doc);
    if (!d || !ETAPES.includes(d.phaseId)) return null;
    by[d.phaseId]++;
  }
  return { total, by };
}

/**
 * The six stations of an application: each one's state (`ok` passes, `refus` the check refuses there, `vide` nothing
 * is required there, `attente` no check), its required documents, those missing, its refusals (with their index in
 * `latest.conformance`) and its requirements when they are known; then where the line stops and how far it is drawn.
 */
export function stations(m) {
  const L = latestOf(m);
  const v = verdictOf(m);
  const rows = L ? rowsByStep(L) : null;
  if (!L || v === "not-observed" || v === "not-available") {
    return { verdict: v, stations: ETAPES.map((id, i) => ({ id, n: i + 1, state: "attente", pieces: [], missing: [], refusals: [], rows: null })), stop: null, reach: 0, rows: null, unplaced: [], gateOnly: [] };
  }
  const refusals = conformance(L).map((c, i) => ({ ...c, i, step: stepOfRefusal(L, c) }));
  const gate = v === "gaps" ? gateSteps(L.currentGate) : [];
  const out = ETAPES.map((id, i) => {
    const pieces = list(L).filter((d) => d.phaseId === id);
    const missing = pieces.filter((d) => d.state !== "filled");
    const mine = refusals.filter((c) => c.step === id);
    const red = v === "gaps" && (mine.length > 0 || missing.length > 0 || (gate.includes(id) && /gate red at/i.test(String(L.currentGate))));
    return { id, n: i + 1, state: red ? "refus" : pieces.length ? "ok" : "vide", pieces, missing, refusals: mine, rows: rows ? rows.by[id] : null };
  });
  // a refused version with no refusal placed on a step: the gate's own step, said as such
  if (v === "gaps" && !out.some((x) => x.state === "refus")) for (const id of gate) out[ETAPES.indexOf(id)].state = "refus";
  const first = out.find((x) => x.state === "refus");
  return {
    verdict: v, stations: out, stop: first ? first.n : null,
    // the solid line runs from the first station to the one where the check refuses, or to the last
    reach: first ? (first.n - 1) / 5 : 1,
    rows,
    unplaced: refusals.filter((c) => !c.step),
    gateOnly: v === "gaps" && !refusals.length && !out.some((x) => x.missing.length) ? out.filter((x) => x.state === "refus").map((x) => x.id) : [],
  };
}

/** A refusal's text when it says a cited name is no longer found: the pointer and the name, as runward writes them. */
export function renamed(problem) {
  const p = String(problem ?? "");
  const sym = /symbol "([^"]+)" not found in the file \(moved or renamed\?/.exec(p);
  const ptr = /typed pointer (file:\S+)/.exec(p);
  return sym && ptr ? { pointer: ptr[1].slice(5), symbol: sym[1] } : null;
}

/**
 * The refusals of an application grouped for the eye: by step (in the six steps' order, then those outside them),
 * then by kind and the check's text, each group with every place it stands for (file, line, rule). Every refusal of
 * the index is in exactly one group.
 */
export function blockGroups(st) {
  const groups = [];
  const add = (step, c) => {
    const key = `${step ?? ""}\u0000${c.kind ?? ""}\u0000${c.problem ?? ""}`;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, step, kind: c.kind ?? null, problem: c.problem ?? null, places: [] }; groups.push(g); }
    g.places.push({ i: c.i, file: c.file ?? null, line: c.line ?? null, rule: c.rule ?? null, scope: c.scope ?? null });
  };
  for (const x of st.stations) for (const c of x.refusals) add(x.id, c);
  for (const c of st.unplaced) add(null, c);
  return groups;
}

/** The kinds of the refusals of an application, most frequent first (the order of the export among equals). */
export function kindsOf(m) {
  const by = new Map();
  for (const c of conformance(latestOf(m))) {
    const k = c.kind ?? "not-observed";
    if (!by.has(k)) by.set(k, { kind: k, n: 0, renamed: 0 });
    const g = by.get(k);
    g.n++;
    if (renamed(c.problem)) g.renamed++;
  }
  return [...by.values()].sort((a, b) => b.n - a.n);
}

/**
 * The portfolio's sentence: the applications of the index by verdict, then the declared ones the index does not carry
 * yet, by their next step (to confirm: a first upload or a new owner; else no check received).
 */
export function synthesis(index, lines, nextOf) {
  const c = { gaps: 0, level: 0, clean: 0, confirm: 0, silent: 0, total: 0 };
  const missions = index?.missions ?? [];
  for (const m of missions) {
    const v = verdictOf(m);
    c.total++;
    if (v === "gaps") c.gaps++; else if (v === "level-not-met") c.level++; else if (v === "clean") c.clean++; else c.silent++;
  }
  for (const l of lines ?? []) {
    if (missions.some((m) => m.id === l.mission)) continue;
    c.total++;
    const k = nextOf(l).kind;
    if (k === "confirm" || k === "owner") c.confirm++; else c.silent++;
  }
  return c;
}

/**
 * The checked deliveries of an application, most recent first, from its status line: each upload and the first one's
 * confirmation, with its date, run and commit; the upload in force carries the verdict of the index, an earlier one
 * none (the service serves no earlier verdict). A first upload is accepted by its confirmation: the entry in force is then
 * the confirmation's, with the accepted upload's commit and run.
 */
export function history(line) {
  const acts = (line?.activity ?? []).filter((e) => typeof e.what === "string" && (e.what.startsWith("send-") || e.what === "repository-confirmed"));
  const cur = line?.accepted?.seq ?? null;
  // the upload in force is the accepted one; a first upload is accepted by its confirmation, whose entry it then carries
  return acts.map((e) => {
    const current = cur !== null && e.seq === cur && (e.what === "send-accepted" || e.what === "repository-confirmed");
    return { ...e, current, ...(current ? { commit: e.commit ?? line.accepted.commit ?? null, runNumber: e.runNumber ?? line.accepted.runNumber ?? null } : {}) };
  });
}

// ------------------------------------------------------------- what moved between two checks this page held
const refusalKey = (c) => `${c.kind ?? ""}\u0000${c.rule ?? ""}\u0000${c.file ?? ""}\u0000${c.problem ?? ""}`;
const ratified = (L) => new Set((L?.ratification?.byState ?? []).filter((g) => g.state === "ratified").flatMap((g) => g.list ?? []));
const stepOfRow = (L, row) => { const d = list(L).find((x) => x.relPath === String(row).split(" · ")[0]); return d && ETAPES.includes(d.phaseId) ? d.phaseId : null; };

/**
 * What moved from one check of an application to the next, both held by this page: the verdict, the refusals lifted
 * and raised, the documents filled or no longer counted, the requirements newly endorsed, each with its step. Null
 * when either check is not there (nothing to compare), or when they are the same upload.
 */
export function moved(before, after) {
  const A = latestOf(before), B = latestOf(after);
  if (!A || !B) return null;
  const ka = new Map(conformance(A).map((c) => [refusalKey(c), c])), kb = new Map(conformance(B).map((c) => [refusalKey(c), c]));
  const lifted = [...ka].filter(([k]) => !kb.has(k)).map(([, c]) => stepOfRefusal(A, c));
  const raised = [...kb].filter(([k]) => !ka.has(k)).map(([, c]) => stepOfRefusal(B, c));
  const da = new Map(list(A).map((d) => [d.relPath, d])), db = new Map(list(B).map((d) => [d.relPath, d]));
  const filled = [...db.values()].filter((d) => d.state === "filled" && da.get(d.relPath)?.state !== "filled").map((d) => (ETAPES.includes(d.phaseId) ? d.phaseId : null));
  const emptied = [...da.values()].filter((d) => d.state === "filled" && db.get(d.relPath)?.state !== "filled").map((d) => (ETAPES.includes(d.phaseId) ? d.phaseId : null));
  const ra = ratified(A);
  const decided = [...ratified(B)].filter((r) => !ra.has(r)).map((r) => stepOfRow(B, r));
  const verdict = A.verdict !== B.verdict ? [A.verdict, B.verdict] : null;
  const steps = new Set([...lifted, ...raised, ...filled, ...emptied, ...decided].filter(Boolean));
  return { verdict, lifted, raised, filled, emptied, decided, steps: ETAPES.filter((e) => steps.has(e)), same: !verdict && !lifted.length && !raised.length && !filled.length && !emptied.length && !decided.length };
}
