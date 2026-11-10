// Access, section: the open sessions.
import { esc } from "../base.js";
import { when } from "../time.js";
import { act } from "../marks.js";
import { ask, confirmBox } from "../confirm.js";

/** The open sessions, this one first said. */
export function sectionSessions(a) {
  const ss = a.sessions.map((s) => `<div class="arow"><div><div class="nm">${esc(s.device ?? "Navigateur")}${s.current ? " · cette session" : ""}</div><span class="k">ouverte par la passkey ${esc(s.openedByLabel ?? "")}</span></div>
      <div class="small"><span class="k">ouverte, heure du service (déclarée)</span>${when(s.createdAt, { sec: false })}</div>
      ${s.current ? `<div>${act("logout", "Se déconnecter", { q: true })}</div>` : `<div>${ask(`session:${s.id}`, "Fermer")}</div>`}${confirmBox(`session:${s.id}`)}</div>`).join("");
  const otherOpen = a.sessions.some((s) => !s.current);
  return `<section class="blk"><h2>Sessions ouvertes</h2>${ss}${otherOpen ? `<div class="actions" style="margin-top:12px">${ask("closeothers:all", "Fermer toutes les autres sessions")}</div>${confirmBox("closeothers:all")}` : ""}</section>`;
}
