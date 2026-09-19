import { resolve } from "node:path";
import { defineConfig } from "vite";

/** One module (dist/index.js); Vue, Zag, and the core external. */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    sourcemap: true,
    target: "es2022",
    rollupOptions: { external: [/^vue/, /^@zag-js\//, /^@monowind\//] },
  },
  test: {
    environment: "happy-dom",
  },
});
