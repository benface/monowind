import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const { version } = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
) as { version: string };

/**
 * Builds the self-contained CDN bundle (dist/cdn.js): engine + companion
 * styles + @tailwindcss/browser in one IIFE, loadable via a classic
 * <script> tag with no build step. Kept as a separate config because Vite
 * lib mode builds one format-set per run and the main build is ESM-only.
 */
export default defineConfig({
  define: {
    __MONOWIND_VERSION__: JSON.stringify(version),
  },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/cdn.ts"),
      formats: ["iife"],
      name: "monowind",
      fileName: () => "cdn.js",
    },
    sourcemap: true,
    target: "es2022",
    emptyOutDir: false,
    // utilities.css?inline is Tailwind source compiled at runtime.
    cssMinify: false,
  },
});
