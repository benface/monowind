/**
 * fonts/*.{flf,tlf} → src/fonts/<name>.ts — one importable, self-
 * registering module per font. Committed output: consumers and the
 * workspace import the modules, not the raw files.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "src/fonts");
mkdirSync(out, { recursive: true });
for (const file of readdirSync(join(root, "fonts"))) {
  if (!/\.(flf|tlf)$/.test(file)) continue;
  const name = basename(file).replace(/\.(flf|tlf)$/, "");
  const data = readFileSync(join(root, "fonts", file), "utf8");
  const module = `// Generated from fonts/${file} by scripts/generate-fonts.mjs — do not edit.
import { registerAsciiFont } from "../registry.ts";

const data: string = ${JSON.stringify(data)};
registerAsciiFont(${JSON.stringify(name)}, data);
export default data;
`;
  writeFileSync(join(out, `${name}.ts`), module);
}
// Keep generated output oxfmt-clean so `pnpm check` never drifts.
execSync("pnpm exec oxfmt src/fonts", { cwd: root, stdio: "ignore" });
console.log(`generated ${readdirSync(out).length} font modules`);
