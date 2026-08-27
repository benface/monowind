import monowind from "@monowind/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // The whole setup: no Tailwind install, no CSS entry, no JS entry.
  // The optional `css` file adds custom @theme tokens.
  plugins: [monowind({ css: "./src/theme.css" })],
  server: {
    port: 5182,
  },
});
