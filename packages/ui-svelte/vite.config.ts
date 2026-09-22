import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

/** Tests only: the package itself ships its source, which the
 * consumer's own Svelte plugin compiles. The browser condition is
 * what makes Svelte resolve to its client build under a DOM the test
 * environment provides rather than to its server one. */
export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ["browser"] },
  test: {
    environment: "happy-dom",
  },
});
