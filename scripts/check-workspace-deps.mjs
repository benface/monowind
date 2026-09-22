/**
 * Guard against the undeclared-cross-package-reach failure class: an
 * app script running `pnpm -C ../../packages/<x> …` works locally
 * (the full workspace is always installed) but broke filtered CI
 * installs twice (v0.1.7, v0.1.9) when <x> wasn't a declared
 * dependency. Fails `pnpm check` at dev time instead.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
let failed = false;
for (const app of readdirSync(join(root, "apps"))) {
  const manifestPath = join(root, "apps", app, "package.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  for (const script of Object.values(manifest.scripts ?? {})) {
    for (const [, dir] of String(script).matchAll(/-C \.\.\/\.\.\/packages\/([\w-]+)/g)) {
      const name = JSON.parse(
        readFileSync(join(root, "packages", dir, "package.json"), "utf8"),
      ).name;
      if (!declared.has(name)) {
        console.error(
          `apps/${app}: scripts reach into packages/${dir} but "${name}" is not a declared dependency`,
        );
        failed = true;
      }
    }
  }
}
/**
 * Guard against a second publish-time failure class: a package's
 * `exports` point at `src` for the workspace, and `publishConfig`
 * swaps them for what the tarball carries. A subpath missing there, or
 * one pointing outside the package's `files`, publishes an entry that
 * is not in the tarball at all.
 */
for (const pkg of readdirSync(join(root, "packages"))) {
  const manifestPath = join(root, "packages", pkg, "package.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const published = manifest.publishConfig?.exports;
  if (!published) continue;
  // A `files` entry is a path or a glob: `dist` covers `./dist/…`,
  // `src/*.css` covers `./src/styles.css`.
  const shipped = (manifest.files ?? []).map((entry) => {
    const pattern = entry
      .replace(/^\.?\//, "")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*");
    return new RegExp(`^\\./${pattern}(/|$)`);
  });
  for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
    if (typeof entry === "string") continue;
    const target = published[subpath];
    if (target === undefined) {
      console.error(`packages/${pkg}: "${subpath}" has no publishConfig export`);
      failed = true;
      continue;
    }
    for (const [condition, path] of Object.entries(target)) {
      if (shipped.some((entry) => entry.test(path))) continue;
      console.error(
        `packages/${pkg}: "${subpath}" publishes ${condition} as ${path}, outside its files`,
      );
      failed = true;
    }
  }
}
/**
 * Guard against a third failure class: `pnpm -r typecheck` runs the
 * script where a workspace has one and SKIPS the workspace where it
 * does not, so a TypeScript app added without one is never checked at
 * all — which is how four of the styling examples shipped unchecked.
 */
const SKIP = new Set(["node_modules", "dist", "netlify", ".netlify", "styled-system"]);
const hasTypes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).some((entry) => {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) return false;
    if (entry.isDirectory()) return hasTypes(join(dir, entry.name));
    return /\.(ts|tsx|svelte|vue)$/.test(entry.name);
  });
for (const group of ["apps", "packages"]) {
  for (const name of readdirSync(join(root, group))) {
    const dir = join(root, group, name);
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.scripts?.typecheck || !hasTypes(dir)) continue;
    console.error(
      `${group}/${name}: has TypeScript sources but no "typecheck" script, so \`pnpm -r typecheck\` skips it`,
    );
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(
  "workspace script dependencies all declared, published exports all built, every TypeScript workspace type-checked",
);
