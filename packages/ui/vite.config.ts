import { resolve } from "node:path";
import { defineConfig } from "vite";

/** One module per component (dist/menu.js, …), Zag external. */
export default defineConfig({
  build: {
    lib: {
      entry: {
        menu: resolve(import.meta.dirname, "src/menu.ts"),
        dialog: resolve(import.meta.dirname, "src/dialog.ts"),
        popover: resolve(import.meta.dirname, "src/popover.ts"),
        tooltip: resolve(import.meta.dirname, "src/tooltip.ts"),
        "top-layer": resolve(import.meta.dirname, "src/top-layer.ts"),
      },
      formats: ["es"],
    },
    sourcemap: true,
    target: "es2022",
    rollupOptions: { external: [/^@zag-js\//] },
  },
  test: {
    environment: "happy-dom",
  },
});
