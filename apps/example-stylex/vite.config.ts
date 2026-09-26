import stylex from "@stylexswc/unplugin/vite";
import { defineConfig } from "vite";

/** No Tailwind and no utilities: StyleX compiles its style objects to
 * atomic CSS, and the engine reads what they compute. */
export default defineConfig({
  // The rules land at the `@stylex;` marker in the stylesheet main.ts
  // imports, which the page requests only once main.ts, style objects
  // and all, is compiled.
  plugins: [stylex({ useCssPlaceholder: true })],
  server: { port: 5192 },
});
