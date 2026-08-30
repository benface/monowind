import monowind from "@monowind/vite";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [solid(), monowind()],
  server: {
    port: 5184,
  },
});
