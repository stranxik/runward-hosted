#!/usr/bin/env node
// Draw a link on the author's workstation (PADR-0012 note 5 bis): 256 random bits, no network. The link
// is printed here and nowhere else; only its sha256 leaves the workstation, as the input of the operator
// workflow (a digest is not a secret: it does not give the token back).
//   npm run operateur:amorcage                       -> the founder's link
//   npm run operateur:reprise -- --tenant T --member M
// The printed command triggers the private operator repository's workflow; it waits for the approval of
// the "operateur" environment, which is the author's gesture.
import { randomBytes, createHash } from "node:crypto";

const kind = process.argv[2];
if (!["bootstrap", "recovery", "invitation"].includes(kind)) { console.error("usage: operator-link.mjs bootstrap|recovery|invitation [--tenant T] [--member M]"); process.exit(2); }
const args = process.argv.slice(3);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const origin = process.env.RW_ORIGIN ?? "https://app.runward.dev";
const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const workflow = { bootstrap: "amorcage.yml", recovery: "reprise-acces.yml", invitation: null }[kind];
console.log(`\nThe link (it stays on this workstation; open it, or hand it over yourself):\n\n  ${origin}/lien#t=${token}\n`);
console.log(`Its digest, the only thing that leaves this workstation:\n\n  ${hash}\n`);
if (workflow) {
  const extra = kind === "recovery" ? ` -f tenant=${get("--tenant") ?? "<tenant>"} -f member=${get("--member") ?? "<member>"}` : get("--tenant") ? ` -f tenant=${get("--tenant")}` : "";
  console.log(`Then, to open it (the run waits for your approval in the "operateur" environment):\n\n  gh workflow run ${workflow} --repo stranxik/runward-hosted-ops -f hash=${hash}${extra}\n`);
}
