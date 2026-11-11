// Recovery, explained to someone who lost every passkey.
import { head } from "./marks.js";
import { mots } from "./lexique.js";

export function viewReprise() {
  const R = mots().reprise;
  return { title: R.title, key: "entree", signed: "out", html: `${head(R.head, R.headR)}
    <h1 class="v">${R.h1}</h1>
    <p class="face lede">${R.lede}</p>
    <ol class="steps">
      <li><div class="body"><h3>${R.step1}</h3><pre class="term" tabindex="0" lang="en">${R.command}</pre>
        <p class="note">${R.step1Note}</p></div></li>
      <li><div class="body"><h3>${R.step2}</h3><p>${R.step2Text}</p></div></li>
      <li><div class="body"><h3>${R.step3}</h3><p>${R.step3Text}</p></div></li>
    </ol>
    <p class="note">${R.limit}</p>` };
}
