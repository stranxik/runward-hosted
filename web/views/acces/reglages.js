// Access, section: the fleet's language and the automatic reader.
import { mk } from "../marks.js";
import { mots } from "../lexique.js";
import { ask, confirmBox } from "../confirm.js";

/** The language of the fleet and the automatic reader. */
export function sectionReglages(a) {
  const W = mots(), R = W.acces.reglages, C = W.common;
  const other = a.lang === "fr" ? "en" : "fr";
  return `<section class="blk"><h2>${R.h2}</h2>
      <div class="arow"><div><div class="nm">${R.lang}</div><span class="k">${R.langNote}</span></div><div class="small">${a.lang === "fr" ? R.fr : R.en}</div><div>${ask(`lang:${other}`, other === "en" ? R.toEn : R.toFr)}</div>${confirmBox(`lang:${other}`)}</div>
      <div class="arow"><div><div class="nm">${R.reader}</div><span class="k">${R.readerNote}</span></div><div class="small">${a.reader ? mk("full", R.authorised) : mk("void", R.notAuthorised)}</div><div>${a.reader ? ask("reader:1", C.remove) : ask("readeron:1", R.authorise)}</div>${confirmBox("reader:1")}${confirmBox("readeron:1")}</div></section>`;
}
