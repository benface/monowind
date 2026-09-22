import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig } from "vite";

/** No Tailwind and no utilities: vanilla-extract writes real CSS from
 * TypeScript, and the engine reads what it computes. */
export default defineConfig({
  plugins: [vanillaExtractPlugin()],
  server: { port: 5190 },
});
