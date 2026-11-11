// Outage, offline, slow start.
import { S, esc } from "./base.js";
import { mk, reqNote, act, head } from "./marks.js";
import { mots } from "./lexique.js";

export function viewPanne(sub) {
  const W = mots(), P = W.panne, C = W.common;
  const r = S.error;
  const V = {
    "": [P.down.title, P.down.h1, `<p class="face">${mk("inv", P.down.mk)} ${P.down.face}${reqNote(r)}</p><div class="actions">${act("reload-screen", C.retry)}</div>
      <p class="note">${P.down.note}</p>`],
    "hors-ligne": [P.offline.title, P.offline.h1, `<p class="face">${mk("void", P.offline.mk)} ${P.offline.face}</p><div class="actions">${act("reload-screen", C.retry)}</div>`],
    lent: [P.slow.title, P.slow.h1, `<p class="face">${P.slow.face}</p><div class="charge" role="progressbar" aria-label="${esc(P.slow.label)}"></div><div class="actions">${act("reload-screen", C.retry)}</div>`],
  };
  const v = Object.hasOwn(V, sub) ? V[sub] : null;
  if (!v) return null;
  return { title: v[0], key: "panne", signed: "any", html: `${head(P.head, P.headR)}<h1 class="v">${esc(v[1])}</h1>${v[2]}` };
}
