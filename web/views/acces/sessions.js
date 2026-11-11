// Access, section: the open sessions.
import { esc } from "../base.js";
import { when } from "../time.js";
import { act } from "../marks.js";
import { ancre, titreAncre } from "../liens.js";
import { mots, appareil } from "../lexique.js";
import { ask, confirmBox } from "../confirm.js";

/** The open sessions, this one first said. */
export function sectionSessions(a) {
  const W = mots(), T = W.acces.sessions;
  const ss = a.sessions.map((s) => `<div class="arow"><div><div class="nm">${esc(appareil(s.device) ?? T.browser)}${s.current ? T.thisOne : ""}</div><span class="k">${T.openedBy(esc(appareil(s.openedByLabel) ?? ""))}</span></div>
      <div class="small"><span class="k">${T.opened}</span>${when(s.createdAt, { sec: false })}</div>
      ${s.current ? `<div>${act("logout", W.frame.signOut, { q: true })}</div>` : `<div>${ask(`session:${s.id}`, T.close)}</div>`}${confirmBox(`session:${s.id}`)}</div>`).join("");
  const otherOpen = a.sessions.some((s) => !s.current);
  return `<section class="blk"${ancre("sessions")}><h2${titreAncre("sessions")}>${T.h2}</h2>${ss}${otherOpen ? `<div class="actions" style="margin-top:12px">${ask("closeothers:all", T.closeOthers)}</div>${confirmBox("closeothers:all")}` : ""}</section>`;
}
