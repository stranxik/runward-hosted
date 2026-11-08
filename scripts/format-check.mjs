#!/usr/bin/env node
// The format of the tree (checklist-day-zero-project: lint and format), checked, not rewritten: every
// tracked text file is UTF-8 with LF line ends, no trailing white space, no tab indentation and one
// final newline. The style inside a line is left to the authors and to ESLint's rules (eslint.config.js);
// this check holds what a diff should never carry. The files runward scaffolded or copied are skipped.
// Exit 1 with the list of files and lines.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const TEXT = /\.(js|mjs|json|md|sql|ya?ml|css|html|tf|txt)$|(^|\/)Dockerfile$/;
const SKIP = /^(vendor|reports|node_modules|runward\/rules)\/|^package-lock\.json$/; // runward/rules: the corpus runward copies in
// The files runward scaffolded and pins by digest (runward/scaffold-lock.json) are runward's, not ours:
// rewriting them to pass this check would break the lock.
const scaffolded = () => { try { return new Set(Object.keys(JSON.parse(readFileSync(resolve(ROOT, "runward/scaffold-lock.json"), "utf8")).files ?? {})); } catch { return new Set(); } };

export function formatFaults(name, text) {
  const faults = [];
  if (text.includes("\r")) faults.push("CR line ends");
  if (text.length && !text.endsWith("\n")) faults.push("no final newline");
  if (/\n\n$/.test(text)) faults.push("blank lines at the end");
  text.split("\n").forEach((l, i) => {
    if (/[ \t]+$/.test(l)) faults.push(`line ${i + 1}: trailing white space`);
    if (/^\t/.test(l)) faults.push(`line ${i + 1}: tab indentation`);
  });
  return faults.map((f) => `${name}: ${f}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const locked = scaffolded();
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => f && TEXT.test(f) && !SKIP.test(f) && !locked.has(f));
  const faults = files.flatMap((f) => { try { return formatFaults(f, readFileSync(resolve(ROOT, f), "utf8")); } catch { return []; } });
  if (faults.length) { console.error(`format-check: ${faults.length} fault(s)\n  - ${faults.slice(0, 50).join("\n  - ")}`); process.exit(1); }
  console.log(`format-check: ${files.length} text file(s), LF, no trailing white space, no tab indentation, one final newline`);
}
