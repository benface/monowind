import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    sourcemap: true,
    target: "es2022",
    rollupOptions: { external: ["monowind", "qr"] },
  },
  test: {
    environment: "happy-dom",
    globals: true,
  },
});
