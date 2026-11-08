#!/usr/bin/env node
// reports/eslint.json: the hexagon's lint (eslint.config.js) of src/, committable (the pattern of
// runward's scripts/eslint-committable.mjs, its ADR-0075): paths relative to the repository, entries
// sorted, the echoed source dropped. Exits with ESLint's own verdict. The rows cite it file by file
// (file:reports/eslint.json#src/...): a file present with no error-severity message.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ESLint } from "eslint";

const ROOT = resolve(import.meta.dirname, "..");
export const ESLINT_REPORT = join(ROOT, "reports", "eslint.json");

export async function eslintReport() {
  const results = await new ESLint({ cwd: ROOT }).lintFiles(["src"]);
  const report = results.map((r) => {
    const { source, filePath, ...rest } = r;
    void source;
    return { filePath: relative(ROOT, filePath).split("\\").join("/"), ...rest };
  }).sort((a, b) => a.filePath.localeCompare(b.filePath, "en"));
  return { text: `${JSON.stringify(report, null, 2)}\n`, errors: report.reduce((n, e) => n + e.errorCount, 0), files: report.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { text, errors, files } = await eslintReport();
  mkdirSync(dirname(ESLINT_REPORT), { recursive: true });
  writeFileSync(ESLINT_REPORT, text);
  console.log(`reports/eslint.json: ${files} file(s), ${errors} error(s)`);
  process.exit(errors ? 1 : 0);
}
