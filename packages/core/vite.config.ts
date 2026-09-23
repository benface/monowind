import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
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
