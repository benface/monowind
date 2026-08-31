import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * Responsive variants (`sm:`, `md:`, …) work out of the box: the browser
 * resolves the cascade before the engine reads computed styles, and any
 * viewport change resizes the host, which re-runs layout. Resize the
 * window (or use the viewport toolbar) to see these switch.
 */
const meta: Meta = {
  title: "Features / Responsive",
};
export default meta;

export const RootFontSize: StoryObj = {
  render: () => html`
    <mono-wind class="text-xs sm:text-sm md:text-base">
      <div class="max-w-max border border-neutral-500 px-1">
        The whole grid scales with the root font size:
        <span class="text-cyan-400">text-xs</span>, then
        <span class="text-yellow-400">sm:text-sm</span>, then
        <span class="text-emerald-400">md:text-base</span>.
      </div>
    </mono-wind>
  `,
};

export const LayoutChange: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-x-1 md:flex-row md:gap-2">
        <div class="border border-cyan-400 px-1 md:flex-1">
          Stacked as a column on narrow viewports…
        </div>
        <div class="border border-yellow-400 px-1 md:flex-1">
          …side by side (flex-row + flex-1) from md up.
        </div>
        <div class="hidden border border-fuchsia-400 px-1 lg:block lg:flex-1">
          This third box only exists from lg up.
        </div>
      </div>
    </mono-wind>
  `,
};
