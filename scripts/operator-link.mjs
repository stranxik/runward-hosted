#!/usr/bin/env node
// Draw a link on the author's workstation (PADR-0012 note 5 bis): 256 random bits, no network. The link
// is printed here, once, and nowhere else; only its sha256 leaves the workstation, as the argument of the
// operator's gesture (a digest is not a secret: it does not give the token back).
//   npm run operateur:amorcage [-- --tenant T] [--witness] [--title "..."]   -> the founder's link
//   npm run operateur:reprise -- --tenant T --member M                       -> a recovery link
//   npm run operateur:invitation                                             -> a link, opened in the product
// The printed command opens the link through the operator's gateway, from this workstation
// (scripts/operator-call.sh, ADR-0016): its arguments are the ones the gateway accepts, checked here with
// the gateway's own rule before they are printed, so a command it would refuse is never printed (finding
// of 2026-11-10: the command printed was a workflow of a private repository that holds none).
import { randomBytes, createHash } from "node:crypto";
import { argvOf } from "../src/operator-gateway.js";

const GESTURE = { bootstrap: "open-bootstrap", recovery: "open-recovery", invitation: null };

/** What the script prints for `kind`, given the token drawn and the options: the link, its digest, and
 *  the command that opens it (none for an invitation). Throws when the gateway would refuse the arguments. */
export function linkAndCommand(kind, { token, origin, tenant = null, member = null, witness = false, title = null }) {
  const hash = createHash("sha256").update(token).digest("hex");
  const gesture = GESTURE[kind];
  let command = null;
  if (gesture) {
    const args = kind === "recovery" ? { hash, tenant, member } : { hash, ...(tenant ? { tenant } : {}), ...(witness ? { witness: true } : {}), ...(title ? { title } : {}) };
    argvOf(gesture, args); // the gateway's own check of these arguments
    const json = JSON.stringify(args);
    if (json.includes("'")) throw new Error("an argument holds a quote: it cannot be printed as a shell argument");
    command = `scripts/operator-call.sh ${gesture} '${json}'`;
  }
  return { link: `${origin}/lien#t=${token}`, hash, command };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kind = process.argv[2];
  const usage = "usage: operator-link.mjs bootstrap [--tenant T] [--witness] [--title TEXT] | recovery --tenant T --member M | invitation";
  if (!Object.hasOwn(GESTURE, kind ?? "")) { console.error(usage); process.exit(2); }
  const args = process.argv.slice(3);
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] ?? null : null; };
  let out;
  try {
    out = linkAndCommand(kind, { token: randomBytes(32).toString("base64url"), origin: process.env.RW_ORIGIN ?? "https://app.runward.dev", tenant: get("--tenant"), member: get("--member"), witness: args.includes("--witness"), title: get("--title") });
  } catch (e) { console.error(`operator-link: ${e.message}\n${usage}`); process.exit(2); }
  console.log(`\nThe link (it stays on this workstation; open it, or hand it over yourself):\n\n  ${out.link}\n`);
  console.log(`Its digest, the only thing that leaves this workstation:\n\n  ${out.hash}\n`);
  if (out.command) {
    console.log("Then, to open it, from this workstation, through the operator's gateway (SCW_SECRET_KEY and RW_OPERATOR_TOKEN");
    console.log("read from the keychain by name inside the command, RW_OPERATOR_URL the gateway's address: runward/runbook.md");
    console.log(`§12, step 5). The gateway answers a status and a code; the gesture's result is in the operator journal:\n\n  ${out.command}\n`);
  }
}
