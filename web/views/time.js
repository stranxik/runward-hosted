// Times: UTC kept, Paris shown, the offset said.
import { esc } from "./base.js";

const TZ = "Europe/Paris";
export const DTF = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const OFF = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, timeZoneName: "longOffset" });
export function when(iso, { sec = true } = {}) {
  if (!iso) return `<span class="soft">à dater</span>`;
  const d = new Date(iso);
  let s = DTF.format(d);
  if (!sec) s = s.slice(0, 16);
  const o = (OFF.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT").replace("GMT", "") || "+00:00";
  return `<time datetime="${esc(iso)}">${esc(s)}&nbsp;${esc(o)}</time>`;
}
const HM = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const DAY_FR = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
export const hm = (iso) => (iso ? `<time datetime="${esc(iso)}">${esc(HM.format(new Date(iso)))}</time>` : `<span class="soft">à dater</span>`);
