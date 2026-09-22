import { defineConfig, presetWind4 } from "unocss";

/** Tailwind-shaped utilities, UnoCSS's own engine. monowind reads
 * what they compute, not what they are called. */
export default defineConfig({ presets: [presetWind4()] });
