import { addons } from "storybook/preview-api";
import { UPDATE_GLOBALS } from "storybook/internal/core-events";
import type { Preview } from "@storybook/web-components-vite";
import { defineMonoWind } from "monowind";
import "./styles.css";

defineMonoWind();

// Canvas + text colors from Tailwind theme tokens (resolved in the preview
// iframe, where the compiled theme's CSS variables exist). One tradeoff:
// the toolbar's tiny color swatch renders in the manager UI, which doesn't
// load the preview CSS, so the swatch chip appears blank there.
const THEMES = {
  light: { canvas: "var(--color-bg-light)", text: "var(--color-fg-light)" },
  dark: { canvas: "var(--color-bg-dark)", text: "var(--color-fg-dark)" },
} as const;

// Default the background toggle to the system theme (the toolbar toggle
// still overrides it per-session).
const systemTheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
  ? "dark"
  : "light";

// Theming beyond the addon's canvas paint: text color, `color-scheme`, and
// the `.dark` class that drives the `dark:` variant and the canvas colors
// (see styles.css).
function applyTheme(background: unknown): void {
  const name = background === "dark" ? "dark" : "light";
  document.body.style.color = THEMES[name].text;
  document.body.style.colorScheme = name;
  document.documentElement.classList.toggle("dark", name === "dark");
}

// A toolbar toggle only reaches decorators after Storybook re-renders the
// story (~100ms) — the addon's own canvas paint waits on the same
// re-render. Listening to the globals event applies the theme immediately,
// and the canvas rules in styles.css make the addon's late paint a no-op.
addons.getChannel().on(UPDATE_GLOBALS, ({ globals }: { globals: Record<string, unknown> }) => {
  const value = (globals.backgrounds as { value?: unknown } | undefined)?.value;
  if (value !== undefined) applyTheme(value);
});

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
    // Initial render (and restored globals): the event above hasn't fired,
    // so sync the theme from the story context here.
    (story, context) => {
      applyTheme(context.globals.backgrounds?.value ?? systemTheme);
      return story();
    },
  ],
};

export default preview;
