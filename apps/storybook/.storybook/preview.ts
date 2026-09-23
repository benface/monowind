import { html, nothing } from "lit";
import { addons } from "storybook/preview-api";
import { GLOBALS_UPDATED, STORY_RENDERED, UPDATE_GLOBALS } from "storybook/internal/core-events";
import type { Preview } from "@storybook/web-components-vite";
import { defineMonoWind } from "monowind";
import "@monowind/ascii";
import "@monowind/qr-code";
import "./styles.css";

defineMonoWind();

// The backgrounds: light and dark from Tailwind theme tokens (resolved
// in the preview iframe, where the compiled theme's CSS variables exist;
// the manager's swatch chip stays blank for them), and the
// @monowind/themes themes, each worn as a class around every story
// (the decorator below) with its own canvas and text — a theme's colors
// are its own, so light/dark has no say over it. Kept in step with the
// theme files' colors; an unthemed host's tokens derive from the canvas
// and text behind it (specs/theming.md).
const THEMES = {
  light: { canvas: "var(--color-bg-light)", text: "var(--color-fg-light)", dark: false },
  dark: { canvas: "var(--color-bg-dark)", text: "var(--color-fg-dark)", dark: true },
  dos: { canvas: "#000000", text: "#aaaaaa", dark: true },
  "dos-blue": { canvas: "#0000aa", text: "#aaaaaa", dark: true },
  c64: { canvas: "#40318d", text: "#7869c4", dark: true },
  "green-phosphor": { canvas: "#000000", text: "#0adb53", dark: true },
  amber: { canvas: "#000000", text: "#ffb000", dark: true },
  teletype: { canvas: "#f5f1e6", text: "#20201c", dark: false },
  bbs: { canvas: "#000000", text: "#aaaaaa", dark: true },
} as const;
type Background = keyof typeof THEMES;
const isTheme = (name: Background): boolean => name !== "light" && name !== "dark";

// Default the background toggle to the system theme (the toolbar toggle
// still overrides it per-session).
const systemTheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
  ? "dark"
  : "light";

// Theming beyond the addon's canvas paint: the canvas color (`--sb-canvas`,
// read by styles.css), the body's text color (which an unthemed host's
// `--mw-fg` derives from), `color-scheme`, and the `.dark` class that
// drives the `dark:` variant. The theme class itself comes
// from the decorator, so a story's hosts connect themed and never lay
// out in the default font first.
const backgroundOf = (value: unknown): Background =>
  typeof value === "string" && value in THEMES ? (value as Background) : "light";
function applyTheme(value: unknown): void {
  const theme = THEMES[backgroundOf(value)];
  document.documentElement.style.setProperty("--sb-canvas", theme.canvas);
  document.body.style.color = theme.text;
  document.body.style.colorScheme = theme.dark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", theme.dark);
  applyModes();
}

// A toolbar toggle only reaches decorators after Storybook re-renders the
// story (~100ms) — the addon's own canvas paint waits on the same
// re-render. Listening to the globals event applies the theme immediately,
// and the canvas rules in styles.css make the addon's late paint a no-op.
addons.getChannel().on(UPDATE_GLOBALS, ({ globals }: { globals: Record<string, unknown> }) => {
  const value = (globals.backgrounds as { value?: unknown } | undefined)?.value;
  if (value !== undefined) applyTheme(value);
});
// The select and focus toggles, via the channel like the background (a
// decorator would also need a hook for re-applying after story
// navigation). Start at the defaults to match initialGlobals (the boot
// value emits no event).
const modes = { select: "grid", focus: "tab" };
function applyModes(): void {
  for (const host of document.querySelectorAll<HTMLElement>("mono-wind")) {
    // Explicit both ways: a removed attribute reflects back to the
    // default, so the other value must be written, not implied by absence.
    host.setAttribute("select", modes.select);
    host.setAttribute("focus", modes.focus);
  }
}
// GLOBALS_UPDATED also covers values restored from the URL/session at
// load, which UPDATE_GLOBALS (user edits only) never sees.
addons.getChannel().on(GLOBALS_UPDATED, ({ globals }: { globals: Record<string, unknown> }) => {
  const value = (globals.backgrounds as { value?: unknown } | undefined)?.value;
  if (value !== undefined) applyTheme(value);
  let changed = false;
  for (const name of Object.keys(modes) as (keyof typeof modes)[]) {
    const value = globals[name];
    if (typeof value === "string") {
      modes[name] = value;
      changed = true;
    }
  }
  if (changed) applyModes();
});
addons.getChannel().on(STORY_RENDERED, () => {
  // The event can precede the new canvas's paint; apply a frame later.
  requestAnimationFrame(applyModes);
});
// Boot: nothing emits an event for the initial value (the addon only
// paints the canvas), so dark-system users otherwise start half-themed.
applyTheme(systemTheme);

// A play's userEvent patches every input it sees focused, for good, and
// its value setter puts the caret at the end on any write — an identical
// one included, which a browser ignores. A person's first edit (trusted,
// where userEvent's are not) gets the native input back.
const USER_EVENT_PATCHES = [
  "value",
  "setSelectionRange",
  "selectionStart",
  "selectionEnd",
  "select",
  "setRangeText",
];
document.addEventListener(
  "beforeinput",
  (event) => {
    const input = event.target;
    if (!event.isTrusted) return;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
    for (const key of USER_EVENT_PATCHES) Reflect.deleteProperty(input, key);
  },
  { capture: true },
);

const preview: Preview = {
  // Every story is a golden of the visual sweep (visual/stories.spec.ts)
  // unless it opts out with `!golden`.
  tags: ["golden"],
  // A theme wraps the story in its class (the @monowind/themes
  // contract: `.theme-<name> mono-wind`), re-rendered when the
  // background changes.
  decorators: [
    (story, context) => {
      const name = backgroundOf((context.globals.backgrounds as { value?: unknown })?.value);
      // One template either way: a theme toggle swaps the class and keeps
      // the story's DOM (and what a play left in it).
      return html`<div class=${isTheme(name) ? `theme-${name}` : nothing}>${story()}</div>`;
    },
  ],
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
    focus: {
      description: "Keyboard focus: Tab only (default) or the arrow keys too",
      toolbar: {
        title: "Focus",
        icon: "arrowdownalt",
        items: [
          { value: "tab", title: "Tab moves focus" },
          { value: "arrows", title: "Arrow keys move focus too" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    // The sidebar's groups in this order (the index lists them as their
    // files come, `ascii` first).
    options: { storySort: { order: ["Features", "Packages", "Test"] } },
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
    focus: "tab",
  },
};

export default preview;
