// The boundary of the domain, verified and not cited (PADR-0016 point 1), on the model of Dropyour's
// test/frontiere-du-domaine.test.ts: it reads the real imports (template strings removed first), follows
// their transitive closure, and holds three properties, each with a planted control that must fail:
//   1. the domain imports only the domain and node:crypto (no adapter, entry, application, port, package);
//   2. the application imports only the domain, the ports and itself (never an adapter or a package);
//   3. nothing the domain reaches, transitively, is an adapter, an entry or a vendor package.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { tmpdir } from "node:os";

const ROOT = new URL("../..", import.meta.url).pathname;
const list = (d) => readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? list(join(d, e)) : e.endsWith(".js") ? [join(d, e)] : []));

/** The specifiers a file imports or re-exports (static and dynamic), template strings removed first. */
export function imports(file) {
  const src = readFileSync(file, "utf8").replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``");
  return [
    ...[...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]),
    ...[...src.matchAll(/^\s*import\s+"([^"]+)"/gm)].map((m) => m[1]),
    ...[...src.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]),
  ];
}
const resolveSpec = (root, from, spec) => {
  if (!spec.startsWith(".")) return null;
  const target = normalize(join(dirname(from), spec));
  return existsSync(target) ? relative(root, target) : `missing:${relative(root, target)}`;
};

export function violations(root) {
  const domain = list(join(root, "src/domain"));
  const application = list(join(root, "src/application"));
  const faults = [];
  for (const f of domain) for (const s of imports(f)) {
    const c = resolveSpec(root, f, s);
    if (c === null ? s !== "node:crypto" : !c.startsWith("src/domain/")) faults.push(`domain: ${relative(root, f)} → ${s}`);
  }
  for (const f of application) for (const s of imports(f)) {
    const c = resolveSpec(root, f, s);
    if (c === null ? !s.startsWith("node:") : !/^src\/(domain|ports|application)\//.test(c)) faults.push(`application: ${relative(root, f)} → ${s}`);
  }
  const seen = new Set();
  const stack = domain.map((f) => relative(root, f));
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const s of imports(join(root, f))) {
      const c = resolveSpec(root, join(root, f), s);
      if (c === null) continue;
      if (!c.startsWith("src/domain/")) faults.push(`closure: ${f} → ${c}`);
      else stack.push(c);
    }
  }
  return { faults, domain: domain.length, application: application.length, closure: seen.size };
}

test("the domain and the application keep their boundary", () => {
  const v = violations(ROOT);
  assert.deepEqual(v.faults, []);
  assert.ok(v.domain >= 5 && v.application >= 6, "the guard must see the real files, or it proves nothing");
  assert.ok(v.closure >= v.domain, "the closure was walked");
});

test("planted controls: an adapter imported by the domain, a package by the application, both fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "boundary-"));
  try {
    for (const d of ["src/domain", "src/application", "src/adapters", "src/ports"]) mkdirSync(join(dir, d), { recursive: true });
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `src/domain/d${i}.js`), `import { x } from "./d${(i + 1) % 5}.js";\n`);
    writeFileSync(join(dir, "src/adapters/db.js"), "export const x = 1;\n");
    writeFileSync(join(dir, "src/domain/planted.js"), 'import { x } from "../adapters/db.js";\nexport const y = x;\n');
    for (let i = 0; i < 6; i++) writeFileSync(join(dir, `src/application/a${i}.js`), 'import { createHash } from "node:crypto";\n');
    writeFileSync(join(dir, "src/application/planted.js"), 'import postgres from "postgres";\n');
    const v = violations(dir);
    assert.ok(v.faults.some((f) => f.startsWith("domain: src/domain/planted.js")), "the planted domain import is seen");
    assert.ok(v.faults.some((f) => f.startsWith("closure: src/domain/planted.js")), "the closure sees it too");
    assert.ok(v.faults.some((f) => f.startsWith("application: src/application/planted.js")), "the planted package import is seen");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
