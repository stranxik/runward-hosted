// The shell's static files, built once at start: names that carry their digest, cached immutable; the
// page itself no-store. views.js and the fonts are read from the pinned runward-fleet package, never
// copied into this repository (PADR-0011 point 4); the fleet stylesheet is the <style> of its
// template.html with its :root token blocks removed, so web/tokens.css is the only source of values.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const WEB = new URL("../../web/", import.meta.url).pathname;

/** Remove every rule whose selector starts with :root, including inside an at-rule; drop at-rules left empty. */
export function stripRootBlocks(css) {
  let out = "", i = 0;
  const block = (from) => { let depth = 0; for (let j = from; j < css.length; j++) { if (css[j] === "{") depth++; else if (css[j] === "}") { depth--; if (depth === 0) return j + 1; } } return css.length; };
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) { out += css.slice(i); break; }
    const selector = css.slice(i, open);
    const end = block(open);
    if (/^\s*(\/\*[\s\S]*?\*\/\s*)*:root\b/.test(selector)) { out += selector.replace(/[^\n]*$/, ""); i = end; continue; }
    if (/^\s*@media/.test(selector.trim().split("\n").pop() ?? "")) {
      const inner = stripRootBlocks(css.slice(open + 1, end - 1));
      out += inner.trim() ? `${selector}{${inner}}` : selector.replace(/[^\n]*$/, "");
      i = end; continue;
    }
    out += css.slice(i, end); i = end;
  }
  return out;
}

export function fleetCss(pinDir) {
  const t = readFileSync(join(pinDir, "ui", "template.html"), "utf8");
  const css = t.slice(t.indexOf("<style>") + 7, t.indexOf("</style>")).replace("/*FONTS*/", "");
  return stripRootBlocks(css);
}

export function buildAssets({ pin, commit }) {
  const files = new Map();
  const add = (name, ext, bytes, type) => { const p = `/assets/${name}.${sha(bytes).slice(0, 16)}.${ext}`; files.set(p, { bytes, type, immutable: true }); return p; };
  const views = readFileSync(join(pin.dir, "ui", "views.js"));
  const viewsPath = add(`views-${pin.version}`, "js", views, "text/javascript; charset=utf-8");
  const famille = add("famille", "css", readFileSync(join(WEB, "famille.css")), "text/css; charset=utf-8");
  const tokens = add("tokens", "css", readFileSync(join(WEB, "tokens.css")), "text/css; charset=utf-8");
  const fleet = add(`fleet-${pin.version}`, "css", Buffer.from(fleetCss(pin.dir)), "text/css; charset=utf-8");
  const appCss = add("app", "css", readFileSync(join(WEB, "app.css")), "text/css; charset=utf-8");
  const appJs = add("app", "js", Buffer.from(readFileSync(join(WEB, "app.js"), "utf8").replace('"__VIEWS__"', JSON.stringify(viewsPath))), "text/javascript; charset=utf-8");
  for (const f of readdirSync(join(pin.dir, "ui", "fonts"))) {
    if (!f.endsWith(".woff2")) continue;
    files.set(`/assets/fonts/${f}`, { bytes: readFileSync(join(pin.dir, "ui", "fonts", f)), type: "font/woff2", immutable: false });
  }
  const page = Buffer.from(readFileSync(join(WEB, "index.html"), "utf8")
    .replace("__COMMIT__", commit).replace("__FAMILLE_CSS__", famille).replace("__TOKENS_CSS__", tokens).replace("__FLEET_CSS__", fleet)
    .replace("__APP_CSS__", appCss).replace("__VIEWS_JS__", viewsPath).replace("__APP_JS__", appJs));
  return { files, page, viewsSha256: sha(views), viewsPath };
}
