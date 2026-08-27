import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Builds the self-contained CDN bundle (dist/cdn.js): engine + companion
 * styles + @tailwindcss/browser in one IIFE, loadable via a classic
 * <script> tag with no build step. Kept as a separate config because Vite
 * lib mode builds one format-set per run and the main build is ESM-only.
 */
export default defineConfig({
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
  },
});
