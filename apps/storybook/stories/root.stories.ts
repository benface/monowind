import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * Styling the `<mono-wind>` root itself. Its font, line-height, and
 * letter-spacing define the cell grid (cell width = glyph advance + root
 * letter-spacing, cell height = the root's line box), and every inherited
 * property set on it (color, …) becomes the default for the whole component.
 */
const meta: Meta = {
  title: "Features/Root Styles",
};
export default meta;

const CARD = html`
  <div class="flex gap-2">
    <div class="border border-neutral-500 px-1">
      Every character, border, and gap lands on whole cells.
    </div>
    <div class="max-w-22 border border-cyan-400 px-1">
      A narrow box wraps its text on the same grid.
    </div>
  </div>
`;

export const FontSize: StoryObj = {
  render: () => html`
    <div class="flex flex-col gap-3">
      <mono-wind class="text-xs">${CARD}</mono-wind>
      <mono-wind>${CARD}</mono-wind>
      <mono-wind class="text-xl">${CARD}</mono-wind>
    </div>
  `,
};

export const Color: StoryObj = {
  render: () => html`
    <mono-wind class="bg-neutral-950 text-emerald-400">
      <div class="border border-current px-2 py-1">
        The root's <span class="text-yellow-300">color</span> and background are ordinary CSS: text,
        borders, and inline elements inherit them.
      </div>
    </mono-wind>
  `,
};

export const LeadingAndTracking: StoryObj = {
  name: "Leading & Tracking",
  render: () => html` <mono-wind class="leading-[1.75] tracking-[0.25em]">${CARD}</mono-wind> `,
};
