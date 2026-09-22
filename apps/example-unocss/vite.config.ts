import unocss from "unocss/vite";
import { defineConfig } from "vite";

/** No monowind plugin and no Tailwind: the engine reads computed
 * styles, so UnoCSS writing them is all it needs. The companion
 * stylesheet comes in through `monowind/styles.css`. */
export default defineConfig({
  plugins: [unocss()],
  server: { port: 5189 },
});
