import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const { version } = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
) as { version: string };

/** The classic-script CDN bundle (dist/cdn.js): element + default
 * fonts + companion styles in one IIFE, loaded next to core's. */
export default defineConfig({
  define: {
    __MONOWIND_ASCII_VERSION__: JSON.stringify(version),
  },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/cdn.ts"),
      formats: ["iife"],
      name: "monowindAscii",
      fileName: () => "cdn.js",
    },
    sourcemap: true,
    target: "es2022",
    emptyOutDir: false,
    // The engine stays external: core's cdn.js exposes the extension
    // API on the shared `monowind` global — bundling a second engine
    // copy would split the registries.
    rollupOptions: {
      external: ["monowind"],
      output: { globals: { monowind: "monowind" } },
    },
  },
});
