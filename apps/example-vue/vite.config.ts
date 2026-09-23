import monowind from "@monowind/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // <mono-wind> is a custom element, not a component to resolve.
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "mono-wind" } } }),
    monowind(),
  ],
  server: {
    port: 5195,
  },
});
