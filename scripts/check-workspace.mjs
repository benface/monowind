/**
 * The workspace's invariants `pnpm check` holds, a failure class each;
 * `--built` adds the two over built packages, which CI runs after a build.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const built = process.argv.includes("--built");
let failed = false;
const fail = (message) => {
  console.error(message);
  failed = true;
};
/** A group's workspaces that have a manifest: folder name, path, manifest. */
const workspaces = (group) =>
  readdirSync(join(root, group)).flatMap((folder) => {
    const dir = join(root, group, folder);
    const path = join(dir, "package.json");
    return existsSync(path)
      ? [{ folder, dir, manifest: JSON.parse(readFileSync(path, "utf8")) }]
      : [];
  });
/** The files under a directory whose names pass `keep`, the subdirectories
 * `skip` names left out. */
const filesIn = (dir, keep, skip = () => false) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? skip(entry.name)
        ? []
        : filesIn(join(dir, entry.name), keep, skip)
      : keep(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );
const apps = workspaces("apps");
const packages = workspaces("packages");

/**
 * An app script running `pnpm -C ../../packages/<x> …` needs <x> declared:
 * a filtered CI install lays out the declared workspaces alone.
 */
for (const { folder: app, manifest } of apps) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  for (const script of Object.values(manifest.scripts ?? {})) {
    for (const [, dir] of String(script).matchAll(/-C \.\.\/\.\.\/packages\/([\w-]+)/g)) {
      const name = packages.find((pkg) => pkg.folder === dir)?.manifest.name;
      if (name === undefined)
        fail(`apps/${app}: scripts reach into packages/${dir}, not a package`);
      else if (!declared.has(name)) {
        fail(
          `apps/${app}: scripts reach into packages/${dir} but "${name}" is not a declared dependency`,
        );
      }
    }
  }
}

/**
 * Every export has a `publishConfig` counterpart inside the package's
 * `files`, so the tarball carries every entry it publishes.
 */
/** An export target's paths by condition, nested conditions joined. */
const targetPaths = (target, condition = "default") =>
  target === null
    ? []
    : typeof target === "string"
      ? [[condition, target]]
      : Object.entries(target).flatMap(([key, value]) =>
          targetPaths(value, condition === "default" ? key : `${condition}.${key}`),
        );
for (const { folder: pkg, manifest } of packages) {
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
  for (const subpath of Object.keys(manifest.exports ?? {})) {
    const target = published[subpath];
    if (target === undefined) {
      fail(`packages/${pkg}: "${subpath}" has no publishConfig export`);
      continue;
    }
    for (const [condition, path] of targetPaths(target)) {
      // npm ships package.json whatever `files` says.
      if (path === "./package.json" || shipped.some((entry) => entry.test(path))) continue;
      fail(`packages/${pkg}: "${subpath}" publishes ${condition} as ${path}, outside its files`);
    }
  }
}

/**
 * A workspace with TypeScript sources has a `typecheck` script, the one
 * `pnpm -r typecheck` runs.
 */
const SKIP = new Set(["node_modules", "dist", "netlify", "styled-system"]);
for (const [group, list] of [
  ["apps", apps],
  ["packages", packages],
]) {
  for (const { folder, dir, manifest } of list) {
    if (manifest.scripts?.typecheck) continue;
    const typed = filesIn(
      dir,
      (name) => /\.(ts|tsx|svelte|vue)$/.test(name),
      (name) => name.startsWith(".") || SKIP.has(name),
    );
    if (typed.length === 0) continue;
    fail(
      `${group}/${folder}: has TypeScript sources but no "typecheck" script, so \`pnpm -r typecheck\` skips it`,
    );
  }
}

/**
 * Each app has a dev port of its own, declared once (the dev script or
 * the Vite config's `server`).
 */
const ports = new Map();
for (const { folder: app, dir, manifest } of apps) {
  const dev = String(manifest.scripts?.dev ?? "");
  const config = readdirSync(dir).find((name) => /^vite\.config\.[cm]?[jt]s$/.test(name));
  const declared = [
    ...[...dev.matchAll(/(?:--port[= ]|-p )(\d+)/g)].map((match) => ["the dev script", match[1]]),
    ...(config
      ? [
          ...readFileSync(join(dir, config), "utf8").matchAll(
            /\bserver:\s*\{[^}]*?\bport:\s*(\d+)/g,
          ),
        ].map((match) => [config, match[1]])
      : []),
  ];
  if (declared.length > 1) {
    const where = declared.map(([place, port]) => `${port} in ${place}`).join(", ");
    fail(`apps/${app}: dev port declared ${declared.length} times (${where})`);
  }
  for (const [, port] of declared.slice(0, 1)) {
    if (ports.has(port)) fail(`apps/${app}: dev port ${port} is apps/${ports.get(port)}'s too`);
    ports.set(port, app);
  }
}

/**
 * With `--built`: a package's emitted types import only its
 * dependencies, which a consumer's install lays out, and a built file
 * names only a source map it ships.
 */
for (const { folder: pkg, dir, manifest } of built ? packages : []) {
  const dist = join(dir, "dist");
  if (!existsSync(dist)) continue;
  const reachable = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const named = new Set();
  for (const file of filesIn(dist, (name) => name.endsWith(".d.ts"))) {
    // Doc comments quote imports in prose.
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const specifiers = source.matchAll(
      /(?:\bfrom|\bimport\s*\(?)\s*["']([^"'.][^"']*)["']|\/\/\/\s*<reference\s+types=["']([^"']+)["']/g,
    );
    for (const [, imported, referenced] of specifiers) {
      const specifier = imported ?? referenced;
      const parts = specifier.split("/");
      const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      if (!name.startsWith("node:") && !reachable.has(name)) named.add(name);
    }
  }
  for (const name of named) {
    fail(`packages/${pkg}: its built types import "${name}", not among its dependencies`);
  }
  for (const file of filesIn(dist, (name) => /\.(m?js|d\.ts|css)$/.test(name))) {
    const map = /[#@] sourceMappingURL=(?!data:)([^\s*]+)[\s*/]*$/.exec(
      readFileSync(file, "utf8"),
    )?.[1];
    if (map && !existsSync(join(file, "..", map))) {
      fail(`packages/${pkg}: ${file.slice(dist.length + 1)} names ${map}, not built`);
    }
  }
}

if (failed) process.exit(1);
console.log(
  "workspace script dependencies all declared, published exports all built, every TypeScript workspace type-checked, every app on a dev port of its own" +
    (built ? ", built types importing only dependencies, every source map named there" : ""),
);
