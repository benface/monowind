import { addons } from "storybook/preview-api";
import { GLOBALS_UPDATED, STORY_RENDERED, UPDATE_GLOBALS } from "storybook/internal/core-events";
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
  // Engine-painted glyph colors are baked at layout time, and the theme
  // flips outside the hosts' subtrees — nudge each host so its observer
  // triggers a fresh layout (see the dynamic-style question in the
  // architecture doc).
  for (const host of document.querySelectorAll<HTMLElement>("mono-wind"))
    host.style.setProperty("--sb-theme", name);
}

// A toolbar toggle only reaches decorators after Storybook re-renders the
// story (~100ms) — the addon's own canvas paint waits on the same
// re-render. Listening to the globals event applies the theme immediately,
// and the canvas rules in styles.css make the addon's late paint a no-op.
addons.getChannel().on(UPDATE_GLOBALS, ({ globals }: { globals: Record<string, unknown> }) => {
  const value = (globals.backgrounds as { value?: unknown } | undefined)?.value;
  if (value !== undefined) applyTheme(value);
});
// Boot: nothing emits an event for the initial value (the addon only
// paints the canvas), so dark-system users otherwise start half-themed.
applyTheme(systemTheme);

// The select toggle, via the channel like the theme (a decorator
// would also need a hook for re-applying after story navigation).
// Starts true to match initialGlobals (the boot value emits no event).
let gridSelect = true;
function applySelect(): void {
  // Explicit both ways: a removed attribute reflects back to the "grid"
  // default, so "text" must be written, not implied by absence.
  for (const host of document.querySelectorAll("mono-wind")) {
    host.setAttribute("select", gridSelect ? "grid" : "text");
  }
}
// GLOBALS_UPDATED also covers values restored from the URL/session at
// load, which UPDATE_GLOBALS (user edits only) never sees.
addons.getChannel().on(GLOBALS_UPDATED, ({ globals }: { globals: Record<string, unknown> }) => {
  const value = (globals.backgrounds as { value?: unknown } | undefined)?.value;
  if (value !== undefined) applyTheme(value);
  if (globals.select !== undefined) {
    gridSelect = globals.select === "grid";
    applySelect();
  }
});
addons.getChannel().on(STORY_RENDERED, () => {
  // The event can precede the new canvas's paint; apply a frame later.
  requestAnimationFrame(applySelect);
});

const preview: Preview = {
  globalTypes: {
    select: {
      description: "Text selection: the whole cell grid (default) or element text",
      toolbar: {
        title: "Select",
        icon: "paragraph",
        items: [
          { value: "text", title: "Select element text" },
          { value: "grid", title: "Select whole grid" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    // Read-only story source (our lit templates are the plain markup) in
    // an addon panel beside the canvas. Controls/Actions panels are
    // hidden: no story uses args.
    docs: { codePanel: true },
    controls: { disable: true },
    actions: { disable: true },
    layout: "padded",
    backgrounds: {
      options: Object.fromEntries(
        Object.entries(THEMES).map(([name, theme]) => [name, { name, value: theme.canvas }]),
      ),
    },
  },
  initialGlobals: {
    backgrounds: { value: systemTheme },
    select: "grid",
  },
};

export default preview;
