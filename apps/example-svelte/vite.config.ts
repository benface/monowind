import monowind from "@monowind/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte(), monowind()],
  server: {
    port: 5185,
  },
});
