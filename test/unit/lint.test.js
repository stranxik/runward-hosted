// The linters refuse what the manifest says they refuse (hexa-architecture, hexa-adapter-pattern,
// config-secrets-boundary, checklist-pre-production-security). Each forbidden import, and a read of the
// environment outside a composition root, is planted in a file of the right layer, linted with the
// repository's own configuration, and must be refused by exactly the rule that states it; the same
// configuration passes the tree as it is. A zero from a linter that cannot see is not evidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

const ROOT = new URL("../..", import.meta.url).pathname;
const boundary = new ESLint({ cwd: ROOT });
const scan = new ESLint({ cwd: ROOT, overrideConfigFile: `${ROOT}eslint.security.config.js` });
const rules = async (linter, file, code) => (await linter.lintText(code, { filePath: `${ROOT}${file}` }))[0].messages.map((m) => m.ruleId);

test("the hexagon is refused by the linter: each forbidden arrow, planted in its layer, is an error", async () => {
  const planted = [
    ["src/domain/planted.js", 'import { memoryStore } from "../adapters/store/memory.js";'],
    ["src/domain/planted.js", 'import postgres from "postgres";'],
    ["src/domain/planted.js", 'import { readFileSync } from "node:fs";'],
    ["src/domain/planted.js", 'export { StoreConflict } from "../ports/errors.js";'],
    ["src/domain/refusals/planted.js", 'import { StoreConflict } from "../../ports/errors.js";'],
    ["src/domain/refusals/planted.js", 'import { MAX_EXPORT_BYTES } from "../workload.js";'],
    ["src/ports/planted.js", 'import { Refusal } from "../domain/refusals/index.js";'],
    ["src/application/planted.js", 'import { postgresStore } from "../adapters/store/postgres.js";'],
    ["src/application/planted.js", 'import { AwsClient } from "aws4fetch";'],
    ["src/application/planted.js", 'import { createHttp } from "../http/server.js";'],
    ["src/adapters/store/planted.js", 'import { createApp } from "../../application/app.js";'],
    ["src/adapters/system/planted.js", 'import { readConfig } from "../../main.js";'],
    ["src/http/planted.js", 'import { memoryStore } from "../adapters/store/memory.js";'],
    ["src/http/planted.js", 'import { createApp } from "../application/app.js";'],
  ];
  // the planted import is not used; only the boundary's verdict is asked of it
  for (const [file, code] of planted) assert.deepEqual((await rules(boundary, file, `${code}\n`)).filter((r) => r !== "no-unused-vars"), ["no-restricted-imports"], `${file}: ${code}`);
});

test("the hexagon's allowed arrows pass, and the tree as it is lints clean", async () => {
  for (const [file, code] of [
    ["src/domain/planted.js", 'import { createHash } from "node:crypto";\nimport { Refusal } from "./refusals/index.js";\nexport const x = [createHash, Refusal];'],
    ["src/domain/refusals/planted.js", 'import { FLOOR } from "./floor.js";\nexport const x = [FLOOR];'],
    ["src/application/planted.js", 'import { Refusal } from "../domain/refusals/index.js";\nimport { StoreConflict } from "../ports/errors.js";\nimport { randomBytes } from "node:crypto";\nexport const x = [Refusal, StoreConflict, randomBytes];'],
    ["src/adapters/store/planted.js", 'import { LINK_DURATIONS } from "../../domain/identity.js";\nimport postgres from "postgres";\nexport const x = [LINK_DURATIONS, postgres];'],
    ["src/main.js", 'import { createApp } from "./application/app.js";\nimport { memoryStore } from "./adapters/store/memory.js";\nexport const x = [createApp, memoryStore];'],
  ]) assert.deepEqual(await rules(boundary, file, `${code}\n`), [], file);
  const results = await boundary.lintFiles(["src"]);
  assert.ok(results.length >= 30, "the whole of src/ is linted");
  assert.deepEqual(results.filter((r) => r.errorCount).map((r) => r.filePath), []);
});

test("the security scan refuses a read of the environment outside the composition roots, and eval", async () => {
  assert.deepEqual(await rules(scan, "src/adapters/objects/planted.js", "export const k = process.env.S3_SECRET_ACCESS_KEY;\n"), ["no-restricted-properties"]);
  assert.deepEqual(await rules(scan, "src/application/planted.js", "export const k = process.env;\n"), ["no-restricted-properties"]);
  assert.deepEqual(await rules(scan, "src/main.js", "export const k = process.env.DATABASE_URL;\n"), [], "the composition root reads it");
  assert.deepEqual(await rules(scan, "src/http/planted.js", "export const f = (s) => eval(s);\n"), ["security/detect-eval-with-expression"]);
  assert.deepEqual(await rules(scan, "src/http/planted.js", 'import { execFile } from "node:child_process";\nexport const f = execFile;\n'), ["no-restricted-imports"]);
  const results = await scan.lintFiles(["src"]);
  assert.deepEqual(results.filter((r) => r.errorCount).map((r) => r.filePath), [], "the tree as it is passes the scan");
});

// Review finding of 2026-11-10 (independent review): both configurations' comments said two composition
// roots; there are three since the operator's gateway (ADR-0016), and the hexagon's rule did not name the
// third. What the comments say is held to what the rules do.
test("the composition roots are three, in the rules and in what the two configurations say of them", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { ENV_READERS } = await import("../../eslint.security.config.js");
  // the roots, read off the tree: the files of src/ itself (every other file lives in a layer's directory)
  const roots = readdirSync(`${ROOT}src`).filter((f) => f.endsWith(".js")).map((f) => `src/${f}`).sort();
  assert.deepEqual(roots, ["src/main.js", "src/operator-gateway.js", "src/operator.js"]);
  assert.deepEqual([...ENV_READERS].sort(), roots, "the environment's readers are the roots");
  for (const config of ["eslint.config.js", "eslint.security.config.js"]) {
    const comments = readFileSync(`${ROOT}${config}`, "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n");
    assert.doesNotMatch(comments, /\btwo composition roots\b/, config);
    assert.match(comments, /three composition roots/, config);
    for (const root of roots) assert.ok(comments.includes(root), `${config} does not name ${root}`);
  }
  // no layer may import any of the three
  for (const root of ["main.js", "operator.js", "operator-gateway.js"]) {
    assert.deepEqual((await rules(boundary, "src/adapters/system/planted.js", `import * as x from "../../${root}";\n`)).filter((r) => r !== "no-unused-vars"), ["no-restricted-imports"], `an adapter importing ${root}`);
    assert.deepEqual((await rules(boundary, "src/http/planted.js", `import * as x from "../${root}";\n`)).filter((r) => r !== "no-unused-vars"), ["no-restricted-imports"], `the HTTP entry importing ${root}`);
  }
});
