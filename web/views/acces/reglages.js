// Access, section: the fleet's language and the automatic reader.
import { mk } from "../marks.js";
import { ask, confirmBox } from "../confirm.js";

/** The language of the fleet and the automatic reader. */
export function sectionReglages(a) {
  const other = a.lang === "fr" ? "en" : "fr";
  return `<section class="blk"><h2>Langue et lecteur automatique</h2>
      <div class="arow"><div><div class="nm">Langue de la flotte</div><span class="k">écrite dans l'inventaire ; la changer reconstruit l'index</span></div><div class="small">${a.lang === "fr" ? "français" : "anglais"}</div><div>${ask(`lang:${other}`, other === "en" ? "Passer en anglais" : "Passer en français")}</div>${confirmBox(`lang:${other}`)}</div>
      <div class="arow"><div><div class="nm">Lecteur automatique</div><span class="k">stranxik/runward-hosted, temoin.yml : lit l'index et l'archive pour les mesures S1 et S2, chaque lecture au journal</span></div><div class="small">${a.reader ? mk("full", "autorisé") : mk("void", "non autorisé")}</div><div>${a.reader ? ask("reader:1", "Retirer") : ask("readeron:1", "Autoriser")}</div>${confirmBox("reader:1")}${confirmBox("readeron:1")}</div></section>`;
}
