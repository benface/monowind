import { defineConfig } from "vite";
import type { CSSOptions } from "vite";
import { resolve } from "node:path";

/** The CSS a build inlines as a string (`?inline`), its comments dropped. */
export const css: CSSOptions = {
  postcss: {
    plugins: [{ postcssPlugin: "strip-comments", Comment: (comment) => void comment.remove() }],
  },
};

export default defineConfig({
  css,
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    sourcemap: true,
    target: "es2022",
  },
  test: {
    environment: "happy-dom",
    // One happy-dom per worker rather than per file, each file still in
    // its own context: the environment was most of the run.
    pool: "vmThreads",
    globals: true,
  },
});
