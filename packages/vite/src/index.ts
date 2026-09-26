import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin, PluginOption } from "vite";

export interface MonowindOptions {
  /**
   * Optional CSS entry (path relative to the Vite root) pulled into the
   * Tailwind compilation, so `@theme` customization, custom utilities, and
   * any other Tailwind CSS features work exactly as in a hand-rolled setup.
   */
  css?: string;
}

const VIRTUAL_ID = "virtual:monowind";

/** The engine's stylesheet and the config that loads one `monowind` for
 * the page, the app's own else this plugin's: two copies are two
 * registries. An installed engine is pre-bundled once, the packages
 * built on it against that bundle; a linked one (a workspace, `npm link`)
 * is excluded and served as is: the optimizer's cache would miss its
 * edits, and a pre-bundled package built on it would inline a copy. */
function resolveMonowind(root: string): { styles: string; config: object } {
  const own = hasPackage(root, "monowind");
  const require = createRequire(own ? path.join(root, "package.json") : import.meta.url);
  const entry = require.resolve("monowind");
  const installed = realpathSync(entry).split(path.sep).includes("node_modules");
  return {
    styles: require.resolve("monowind/styles.css"),
    config: {
      optimizeDeps: installed ? { include: ["monowind"] } : { exclude: ["monowind"] },
      resolve: own
        ? { dedupe: ["monowind"] }
        : { alias: [{ find: /^monowind$/, replacement: entry }] },
    },
  };
}

/** Whether a package is installed for `root` by the node_modules walk Vite
 * resolves with, which leaves out the NODE_PATH pnpm's bin shims set. */
function hasPackage(root: string, name: string): boolean {
  for (let dir = root; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "node_modules", name, "package.json"))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

/**
 * Standalone monowind: add this plugin and write HTML — Tailwind v4 and the
 * monowind engine are wired up automatically (no Tailwind install, no CSS
 * entry, no JS entry required).
 *
 * How: the plugin embeds `@tailwindcss/vite`, generates a CSS entry that
 * imports Tailwind + the monowind companion stylesheet (+ the user's `css`
 * file, if any) via absolute paths — so resolution works even though the
 * user's project doesn't depend on Tailwind — and injects a virtual module
 * into index.html that loads that CSS and registers <mono-wind>.
 *
 * Setups without an index.html (SSR, some frameworks) can import the same
 * virtual module manually instead: `import "virtual:monowind"`.
 */
export default function monowind(options: MonowindOptions = {}): PluginOption[] {
  // Resolve from THIS package's context: the user's project depends only on
  // @monowind/vite; tailwindcss is our dependency.
  const require = createRequire(import.meta.url);
  const tailwindEntry = path.join(
    path.dirname(require.resolve("tailwindcss/package.json")),
    "index.css",
  );

  let cssEntryPath = "";
  let engine: ReturnType<typeof resolveMonowind>;
  let command: "build" | "serve" = "serve";

  const setup: Plugin = {
    name: "monowind",
    config(config) {
      engine = resolveMonowind(path.resolve(config.root ?? process.cwd()));
      return engine.config;
    },
    configResolved(config) {
      command = config.command;
      const imports = [tailwindEntry, engine.styles];
      if (options.css) imports.push(path.resolve(config.root, options.css));
      // A real file on disk (not a virtual module) so Tailwind's plugin and
      // Vite's CSS pipeline treat it like any authored entry. Lives NEXT TO
      // Vite's cacheDir (usually node_modules/.monowind): that location is
      // writable and gitignored wherever `root` points, but deliberately NOT
      // inside cacheDir itself — Vite treats URLs under cacheDir as
      // dep-optimizer artifacts and won't serve arbitrary files from there.
      const cacheDir = path.join(path.dirname(config.cacheDir), ".monowind");
      mkdirSync(cacheDir, { recursive: true });
      cssEntryPath = path.join(cacheDir, "entry.css");
      const content = imports.map((file) => `@import ${JSON.stringify(file)};`).join("\n");
      writeFileSync(cssEntryPath, `${content}\n`);
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return VIRTUAL_ID;
      return undefined;
    },
    load(id) {
      if (id !== VIRTUAL_ID) return undefined;
      return [
        `import ${JSON.stringify(cssEntryPath)};`,
        `import { defineMonoWind } from "monowind";`,
        `defineMonoWind();`,
      ].join("\n");
    },
    transformIndexHtml: {
      // `pre`, so the injected script is present when Vite's build scans the
      // HTML for module entries (post-order injection ships the raw
      // `/@id/...` URL to production, unresolved).
      order: "pre",
      handler() {
        return [
          {
            tag: "script",
            attrs: {
              type: "module",
              // Dev middleware needs the /@id/ prefix; the build resolves
              // the bare virtual id through resolveId.
              src: command === "serve" ? `/@id/${VIRTUAL_ID}` : VIRTUAL_ID,
            },
            injectTo: "head",
          },
        ];
      },
    },
  };

  return [tailwindcss(), setup];
}
