import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** The components are TypeScript, so the plugin that compiles them
 * for the tests needs the preprocessor that strips it. */
export default { preprocess: vitePreprocess() };
