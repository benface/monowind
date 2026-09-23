/**
 * Guard against non-canonical Tailwind classes — what Tailwind
 * IntelliSense flags with `suggestCanonicalClasses`, such as
 * `[scrollbar-gutter:stable]` for `scrollbar-gutter-stable`. Checks, or
 * with `--fix` rewrites, every static `class` and `className` attribute
 * against the stylesheet `.oxfmtrc.json` sorts that file's classes by.
 *
 * Attributes only, as IntelliSense: Tailwind's scanner also matches
 * code — a `!fixed` negation, a `flex-grow` property name — which a
 * rewrite would break. The design system comes from Tailwind's
 * `__unstable__loadDesignSystem`, the API IntelliSense uses; a release
 * that changes it fails here, not silently. At IntelliSense's 16px root
 * a px arbitrary value is its spacing step (`w-[90px]` is `w-22.5`),
 * the unit the grid counts in.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, matchesGlob, resolve } from "node:path";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";

const root = resolve(import.meta.dirname, "..");
const fix = process.argv.includes("--fix");

// The default stylesheet, then each matching override in order; an
// override's `false` opts its files out, and sorting without a named
// stylesheet leaves no design system to check against.
const config = JSON.parse(readFileSync(resolve(root, ".oxfmtrc.json"), "utf8"));
function stylesheetFor(file) {
  let sort = config.sortTailwindcss;
  for (const { files, options } of config.overrides ?? []) {
    if (options && "sortTailwindcss" in options && files.some((glob) => matchesGlob(file, glob))) {
      sort = options.sortTailwindcss;
    }
  }
  if (!sort) return null;
  if (!sort.stylesheet) throw new Error(`${file}: sortTailwindcss names no stylesheet`);
  return sort.stylesheet;
}

const systems = new Map();
function systemFor(stylesheet) {
  if (!systems.has(stylesheet)) {
    const path = resolve(root, stylesheet);
    systems.set(
      stylesheet,
      __unstable__loadDesignSystem(readFileSync(path, "utf8"), { base: dirname(path) }),
    );
  }
  return systems.get(stylesheet);
}

// A bare attribute: not a binding (`:class=`), a property
// (`el.className=`), or another attribute's tail (`data-class=`).
const attribute = /(?<![\w:.-])(class|className)=(?:"([^"]*)"|'([^']*)')/g;
// Untracked files too, as oxfmt sees them, less its ignored paths; a
// deletion not yet staged is gone.
const ignored = (config.ignorePatterns ?? []).map((pattern) =>
  pattern.endsWith("/") ? `${pattern}**` : pattern,
);
const files = execFileSync(
  "git",
  [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--deduplicate",
    "*.html",
    "*.js",
    "*.mjs",
    "*.ts",
    "*.tsx",
    "*.vue",
    "*.svelte",
  ],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter(
    (file) =>
      file &&
      existsSync(resolve(root, file)) &&
      !ignored.some((pattern) => matchesGlob(file, pattern)),
  );

let found = 0;
for (const file of files) {
  const stylesheet = stylesheetFor(file);
  if (!stylesheet) continue;
  const content = readFileSync(resolve(root, file), "utf8");
  const system = await systemFor(stylesheet);
  const next = content.replace(attribute, (whole, name, double, single, offset) => {
    const quote = double === undefined ? "'" : '"';
    const start = offset + name.length + 2;
    const value = (double ?? single).replace(/\S+/g, (token, at) => {
      // A template's interpolation is not a class.
      if (/[${}]/.test(token)) return token;
      // IntelliSense's call, at its default root font size.
      const [canonical = token] = system.canonicalizeCandidates([token], { rem: 16 });
      if (canonical === token) return token;
      found++;
      const line = content.slice(0, start + at).split("\n").length;
      console.log(`${file}:${line}  ${token}  →  ${canonical}`);
      return canonical;
    });
    return `${name}=${quote}${value}${quote}`;
  });
  if (fix && next !== content) writeFileSync(resolve(root, file), next);
}

if (found === 0) {
  console.log("Tailwind classes all canonical");
} else if (fix) {
  console.log(`${found} Tailwind class(es) rewritten to their canonical form`);
} else {
  console.error(`${found} non-canonical Tailwind class(es): \`pnpm check:fix\` rewrites them`);
  process.exit(1);
}
