import type { StorybookConfig } from "@storybook/web-components-vite";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

/** A file asked for with `?shared` is shared with every origin (CORS),
 * and nothing else is, as on the static server (serve-static.mjs): the
 * image stories need one picture from another origin the page may read
 * and one it may not. */
const sharing: Plugin = {
  name: "monowind:sharing",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (new URL(request.url ?? "/", "http://x").searchParams.has("shared")) {
        response.setHeader("access-control-allow-origin", "*");
      }
      next();
    });
  },
};

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.ts"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    "@storybook/addon-mcp",
  ],
  framework: {
    name: "@storybook/web-components-vite",
    options: {},
  },
  viteFinal: async (viteConfig) => {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss(), sharing];
    viteConfig.server = { ...viteConfig.server, cors: false };
    return viteConfig;
  },
};

export default config;
