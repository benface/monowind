import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const { version } = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
) as { version: string };

/** The classic-script CDN bundle (dist/cdn.js): the components and Zag
 * in one IIFE, loaded next to core's. */
export default defineConfig({
  define: {
    __MONOWIND_UI_VERSION__: JSON.stringify(version),
    // Zag reads it for its development checks; a classic script has no process.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/cdn.ts"),
      formats: ["iife"],
      name: "monowindUi",
      fileName: () => "cdn.js",
    },
    sourcemap: true,
    target: "es2022",
    emptyOutDir: false,
  },
});
