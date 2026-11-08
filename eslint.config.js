// The hexagon, expressed so a machine refuses it (hexa-architecture, hexa-adapter-pattern). Each arrow
// below was read off the tree before it was written down (2026-11-08), so a rule here refuses a change of
// architecture, never today's honest code. Its sensitivity is a test: test/unit/lint.test.js plants each
// forbidden import and requires this configuration to refuse it. Read by `npm run lint` and committed as
// reports/eslint.json (scripts/eslint-committable.mjs), which the manifest rows cite file by file.
//
//   domain       imports only the domain and node:crypto: no port, adapter, application, entry or package;
//   ports        import nothing but other ports;
//   application  imports only the domain, the ports, itself and node:*; never an adapter or a package;
//   adapters     never import the application, the HTTP entry or a composition root (main, operator);
//   http         never imports an adapter, the application or a composition root: it receives the app.
// Only the two composition roots (src/main.js, src/operator.js) see every layer.
const message = (layer, rule) => `${layer}: ${rule} (eslint.config.js, runward/architecture.md, rule hexa-architecture)`;

const only = (allowed, layer, rule) => ["error", { patterns: [{ regex: `^(?!${allowed}).*`, message: message(layer, rule) }] }];
const never = (groups, layer, rule) => ["error", { patterns: [{ group: groups, message: message(layer, rule) }] }];

export default [
  { ignores: ["node_modules/**", "reports/**", "vendor/**", "web/**", "captures/**"] },
  {
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: { "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }], "no-undef": "off" },
  },
  { files: ["src/domain/**/*.js"], rules: { "no-restricted-imports": only("\\./[a-z-]+\\.js$|node:crypto$", "the domain", "it imports only the domain and node:crypto") } },
  { files: ["src/ports/**/*.js"], rules: { "no-restricted-imports": only("\\./[a-z-]+\\.js$", "the ports", "they import nothing but other ports") } },
  { files: ["src/application/**/*.js"], rules: { "no-restricted-imports": only("\\./[a-z-]+\\.js$|\\.\\./(domain|ports)/[a-z-]+\\.js$|node:", "the application", "it imports only the domain, the ports, itself and node:*") } },
  { files: ["src/adapters/**/*.js"], rules: { "no-restricted-imports": never(["**/application/**", "**/http/**", "**/main.js", "**/operator.js"], "an adapter", "it never imports the application, the HTTP entry or a composition root") } },
  { files: ["src/http/**/*.js"], rules: { "no-restricted-imports": never(["**/adapters/**", "**/application/**", "**/main.js", "**/operator.js"], "the HTTP entry", "it never imports an adapter, the application or a composition root") } },
];
