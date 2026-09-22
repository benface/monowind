import stylex from "@stylexswc/unplugin/vite";
import { defineConfig } from "vite";

/** No Tailwind and no utilities: StyleX compiles its style objects to
 * atomic CSS, and the engine reads what they compute. */
export default defineConfig({
  plugins: [stylex()],
  server: { port: 5192 },
});
