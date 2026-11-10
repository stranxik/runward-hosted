// A static security scan of src/, committed as reports/eslint-security.sarif (scripts/security-scans.mjs)
// and cited by checklist-pre-production-security and config-secrets-boundary. Separate from
// eslint.config.js on purpose: that one states the hexagon, this one is a scan, each in its own report.
//
// The configuration boundary (config-secrets-boundary): the environment, where every secret of the
// service lives, is read by the two composition roots only (src/main.js, src/operator.js). No domain,
// application, adapter or HTTP file reads process.env: they receive typed configuration. A file that
// starts reading the environment, a secret included, is refused by no-restricted-properties.
//
// The eslint-plugin-security rules are each set by relevance, measured on src/ on 2026-11-08 before
// being placed (the numbers are in reports/eslint-security.sarif, regenerated in CI):
//   error: eval with an expression, non-literal require, pseudo-random bytes, child_process, new Buffer,
//          buffer noassert, bidi and invisible characters, unsafe regular expressions;
//   off, with the reason: detect-object-injection (fires on every obj[key]; the keys here come from the
//          closed table list and the route table, never from a request), detect-non-literal-fs-filename
//          (the only paths read are the service's own assets and the pinned lock file, fixed at start),
//          detect-non-literal-regexp (the route table compiles its own patterns at start),
//          detect-possible-timing-attacks (no secret is compared with ===: tokens are compared by their
//          sha256 in the database).
import security from "eslint-plugin-security";

// src/operator-gateway.js is the composition root of its own process (the private operator container,
// ADR-0016): its start block reads the environment and hands typed configuration to createGateway.
export const ENV_READERS = ["src/main.js", "src/operator.js", "src/operator-gateway.js"];
const ENV_MESSAGE = "config-secrets-boundary: the environment, and every secret in it, is read by the composition roots only (src/main.js, src/operator.js, src/operator-gateway.js); pass typed configuration in instead.";

export default [
  { ignores: ["node_modules/**", "reports/**", "vendor/**", "web/**", "test/**", "scripts/**"] },
  {
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { security },
    rules: {
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-child-process": "error",
      "security/detect-new-buffer": "error",
      "security/detect-buffer-noassert": "error",
      "security/detect-bidi-characters": "error",
      "security/detect-invisible-characters": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-regexp": "off",
      "security/detect-possible-timing-attacks": "off",
      "no-restricted-properties": ["error", { object: "process", property: "env", message: ENV_MESSAGE }],
      "no-restricted-imports": ["error", { paths: ["child_process", "node:child_process"].map((name) => ({ name, message: "the service spawns no process" })) }],
    },
  },
  { files: ENV_READERS, rules: { "no-restricted-properties": "off" } },
  // The one process that spawns: the operator gateway runs each gesture in a child holding the one URL of its
  // role (ADR-0016). The service itself still spawns nothing.
  { files: ["src/operator-gateway.js"], rules: { "no-restricted-imports": "off", "security/detect-child-process": "off" } },
];
