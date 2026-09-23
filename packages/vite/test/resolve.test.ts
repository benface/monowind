import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, expect, it } from "vitest";
import monowind from "../src/index.ts";

/** The engine the plugin loads is the app's own copy where it has one
 * (the package's README), else the plugin's. */
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const write = (file: string, content: string): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

/** A temporary app, its packages real folders as an npm install lays them
 * out: a stand-in engine keeping a registry, and a leaf renderer
 * registering on it. */
const app = (withMonowind: boolean): string => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "monowind-app-")));
  roots.push(root);
  write(path.join(root, "package.json"), '{ "name": "app", "type": "module" }');
  if (withMonowind) {
    const engine = path.join(root, "node_modules", "monowind");
    write(
      path.join(engine, "package.json"),
      JSON.stringify({
        name: "monowind",
        type: "module",
        exports: { ".": "./src/index.js", "./styles.css": "./src/styles.css" },
      }),
    );
    write(
      path.join(engine, "src", "index.js"),
      "export const registry = new Map();\nexport function defineMonoWind() {}\n",
    );
    write(path.join(engine, "src", "styles.css"), "");
    const leaf = path.join(root, "node_modules", "leaf");
    write(
      path.join(leaf, "package.json"),
      JSON.stringify({ name: "leaf", type: "module", exports: "./index.js" }),
    );
    write(
      path.join(leaf, "index.js"),
      'import { registry } from "monowind";\nregistry.set("leaf", 1);\n',
    );
  }
  return root;
};

type Setup = {
  config(config: { root: string }): object | undefined;
  configResolved(config: object): void;
  load(id: string): string;
};

/** What the plugin loads for an app: the virtual module's engine import,
 * the stylesheets its CSS entry imports, and the config it adds. */
const loaded = (root: string): { engine: string; css: string; added: object | undefined } => {
  const [, setup] = monowind() as unknown as [unknown, Setup];
  const added = setup.config({ root });
  setup.configResolved({
    root,
    command: "serve",
    cacheDir: path.join(root, "node_modules", ".vite"),
  });
  const module = setup.load("virtual:monowind");
  const entry = /import "([^"]+\.css)";/.exec(module)![1]!;
  return {
    engine: /from "([^"]+)"/.exec(module)![1]!,
    css: readFileSync(entry, "utf8"),
    added,
  };
};

/** The page's engine is the dev server's pre-bundled one, and the
 * pre-bundled leaf imports it, or the chunk it re-exports. */
const expectOneEngine = async (server: ViteDevServer, root: string): Promise<void> => {
  const virtual = await server.environments.client.transformRequest("virtual:monowind");
  expect(virtual!.code).toMatch(/"\/node_modules\/\.vite\/deps\/monowind\.js/);
  const deps = path.join(root, "node_modules", ".vite", "deps");
  await expect.poll(() => existsSync(path.join(deps, "leaf.js"))).toBe(true);
  const imported = (file: string) =>
    [...readFileSync(path.join(deps, file), "utf8").matchAll(/from "(\.\/[^"]+)"/g)].map(
      (match) => match[1],
    );
  const engine = ["./monowind.js", ...imported("monowind.js")];
  expect(imported("leaf.js").some((file) => engine.includes(file))).toBe(true);
};

it("loads the engine by name and its stylesheet from the app's own copy", () => {
  const root = app(true);
  const { engine, css, added } = loaded(root);
  expect(engine).toBe("monowind");
  expect(css).toContain(path.join(root, "node_modules", "monowind", "src", "styles.css"));
  expect(added).toEqual({
    optimizeDeps: { include: ["monowind"] },
    resolve: { dedupe: ["monowind"] },
  });
});

it("falls back to the plugin's own copy where the app has none", () => {
  const own = createRequire(import.meta.url);
  const { engine, css, added } = loaded(app(false));
  expect(engine).toBe("monowind");
  expect(css).toContain(own.resolve("monowind/styles.css"));
  expect(added).toEqual({
    optimizeDeps: { include: ["monowind"] },
    resolve: { alias: [{ find: /^monowind$/, replacement: own.resolve("monowind") }] },
  });
});

it("serves one engine in dev where only a leaf renderer brings the engine, as pnpm lays it out", async () => {
  // The leaf's own engine sits in pnpm's store, beside it and not at the
  // app's root: the plugin's copy is the page's, and the leaf's import
  // must reach it.
  const root = app(false);
  const store = path.join(root, "node_modules", ".pnpm");
  const leaf = path.join(store, "leaf@1", "node_modules", "leaf");
  write(
    path.join(leaf, "package.json"),
    JSON.stringify({ name: "leaf", type: "module", exports: "./index.js" }),
  );
  write(
    path.join(leaf, "index.js"),
    'import { defineMonoWind } from "monowind";\ndefineMonoWind();\n',
  );
  const engine = path.join(store, "monowind@1", "node_modules", "monowind");
  write(
    path.join(engine, "package.json"),
    JSON.stringify({ name: "monowind", type: "module", exports: { ".": "./index.js" } }),
  );
  write(path.join(engine, "index.js"), 'export function defineMonoWind() { return "stand-in"; }\n');
  symlinkSync(engine, path.join(store, "leaf@1", "node_modules", "monowind"), "dir");
  symlinkSync(leaf, path.join(root, "node_modules", "leaf"), "dir");
  write(path.join(root, "index.html"), '<script type="module" src="/main.js"></script>');
  write(path.join(root, "main.js"), 'import "leaf";\n');
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [monowind()],
    server: { port: 0 },
  });
  try {
    await server.listen();
    // The leaf's import resolves to the page's engine.
    await expectOneEngine(server, root);
    const leafBundle = path.join(root, "node_modules", ".vite", "deps", "leaf.js");
    expect(readFileSync(leafBundle, "utf8")).not.toContain("stand-in");
  } finally {
    await server.close();
  }
});

it("serves one engine in dev, the pre-bundled leaf renderer sharing it", async () => {
  const root = app(true);
  write(path.join(root, "index.html"), '<script type="module" src="/main.js"></script>');
  write(path.join(root, "main.js"), 'import "leaf";\n');
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [monowind()],
    server: { port: 0 },
  });
  try {
    await server.listen();
    await expectOneEngine(server, root);
  } finally {
    await server.close();
  }
});
