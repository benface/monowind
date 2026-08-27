import { addons } from "storybook/manager-api";
import { themes } from "storybook/theming";

// Brand the manager UI's sidebar title. (The browser-tab title suffix is
// hardcoded to "Storybook" by the manager runtime — not themable.) Custom
// themes replace the default wholesale, so start from the light/dark base
// matching the system preference — same behavior the preview's background
// default follows (see preview.ts).
const base = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
  ? themes.dark
  : themes.light;

addons.setConfig({
  theme: { ...base, brandTitle: "monowind" },
});
