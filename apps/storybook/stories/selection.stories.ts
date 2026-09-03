import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * Fixtures for the selection-invert visual regression
 * (visual/selection.spec.ts drags a real selection across them and
 * screenshots the painted result — per engine, because Safari paints
 * selection ink through text-fill-color and needs the text-shadow
 * fallback in the canonical ::selection rules). Hidden from the
 * sidebar and the story sweep; the spec targets them by id.
 */
const meta: Meta = {
  title: "Test / Selection",
  tags: ["!dev"],
};
export default meta;

export const LightText: StoryObj = {
  render: () => html`
    <mono-wind select="text">
      <p data-test="target" class="max-w-64">
        A raccoon walked into the corner bakery and took one long look at the display case.
      </p>
    </mono-wind>
  `,
};

export const Banner: StoryObj = {
  render: () => html`
    <mono-wind select="text">
      <mono-ascii data-test="target" font="small" class="text-emerald-400">monowind</mono-ascii>
    </mono-wind>
  `,
};
