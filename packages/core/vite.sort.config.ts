import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Builds dist/sort.js — the optional companion to the CDN bundle that
 * exposes `globalThis.monowind.sortClasses` (see src/sort.ts). Its own
 * config because Vite lib mode builds one entry per run, and the
 * separation is the point: the `tailwindcss` design system it needs
 * would grow cdn.js by ~70%.
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/sort.ts"),
      formats: ["iife"],
      name: "monowindSort",
      fileName: () => "sort.js",
    },
    sourcemap: true,
    target: "es2022",
    emptyOutDir: false,
    // utilities.css?inline is Tailwind source compiled at runtime.
    cssMinify: false,
  },
});
