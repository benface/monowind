import { defineConfig } from "@pandacss/dev";

/** Panda compiles the style objects it finds in `src` into real CSS
 * at build time; monowind reads what that computes. */
export default defineConfig({
  preflight: true,
  include: ["./src/**/*.{ts,tsx}"],
  outdir: "styled-system",
});
