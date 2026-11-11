// Times: UTC kept, Paris shown, the offset said. A day is written in the reader's language.
import { esc } from "./base.js";
import { mots } from "./lexique.js";

const TZ = "Europe/Paris";
export const DTF = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const OFF = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, timeZoneName: "longOffset" });
const undated = () => `<span class="soft">${esc(mots().time.undated)}</span>`;
export function when(iso, { sec = true } = {}) {
  if (!iso) return undated();
  const d = new Date(iso);
  let s = DTF.format(d);
  if (!sec) s = s.slice(0, 16);
  const o = (OFF.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT").replace("GMT", "") || "+00:00";
  return `<time datetime="${esc(iso)}">${esc(s)}&nbsp;${esc(o)}</time>`;
}
const HM = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const hm = (iso) => (iso ? `<time datetime="${esc(iso)}">${esc(HM.format(new Date(iso)))}</time>` : undated());
const DAYS = new Map();
/** A day in Paris time, written in the reader's language (« 11 nov. 2026 », « 11 Nov 2026 »): text. */
export function day(iso) {
  const locale = mots().time.locale;
  if (!DAYS.has(locale)) DAYS.set(locale, new Intl.DateTimeFormat(locale, { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }));
  return DAYS.get(locale).format(new Date(iso));
}
