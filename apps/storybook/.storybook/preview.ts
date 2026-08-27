import type { Preview } from "@storybook/web-components-vite";
import { defineMonoWind } from "monowind";
import "./styles.css";

defineMonoWind();

// Canvas + text colors from Tailwind theme tokens (resolved in the preview
// iframe, where the compiled theme's CSS variables exist). One tradeoff:
// the toolbar's tiny color swatch renders in the manager UI, which doesn't
// load the preview CSS, so the swatch chip appears blank there.
const THEMES = {
  light: { canvas: "var(--color-neutral-50)", text: "var(--color-neutral-900)" },
  dark: { canvas: "var(--color-neutral-900)", text: "var(--color-neutral-50)" },
} as const;

// Default the background toggle to the system theme (the toolbar toggle
// still overrides it per-session).
const systemTheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
  ? "dark"
  : "light";

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: {
      options: Object.fromEntries(
        Object.entries(THEMES).map(([name, theme]) => [name, { name, value: theme.canvas }]),
      ),
    },
  },
  initialGlobals: {
    backgrounds: { value: systemTheme },
  },
  decorators: [
    // The backgrounds addon only paints the canvas; make the text color
    // follow the selected background so stories stay readable in both.
    (story, context) => {
      const background = (context.globals.backgrounds?.value ?? systemTheme) as
        | keyof typeof THEMES
        | undefined;
      const theme = THEMES[background ?? systemTheme] ?? THEMES[systemTheme];
      document.body.style.color = theme.text;
      document.body.style.colorScheme = background === "dark" ? "dark" : "light";
      return story();
    },
  ],
};

export default preview;
