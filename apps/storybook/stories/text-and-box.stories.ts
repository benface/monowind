import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

const meta: Meta = {
  title: "Features/Text & Box Model",
};
export default meta;

export const Wrapping: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-40 border border-neutral-500 px-2 py-1">
        This text wraps at word boundaries when it runs out of columns, and breaks long words at
        cell boundaries. Try resizing the window to see how it behaves.
      </div>
    </mono-wind>
  `,
};

export const Truncating: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-40 truncate border border-neutral-500 px-2 py-1">
        This text gets truncated when it is wider than the available width.
      </div>
    </mono-wind>
  `,
};

export const HardBreaks: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="border border-neutral-500 px-2 py-1">
        first line<br />second line<br /><br />after a blank line
      </div>
    </mono-wind>
  `,
};

export const InlineElements: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-40 border border-neutral-500 px-2 py-1">
        Inline elements like <b class="text-yellow-400">bold text</b>,
        <i class="text-cyan-400">italic text</i>, and
        <a href="#" class="text-blue-400 underline">links (click me)</a> ride along in the text run.
      </div>
    </mono-wind>
  `,
};

export const TextAlign: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="border border-neutral-500 px-1 text-end">text-end lands on the grid</div>
        <div class="border border-neutral-500 px-1 text-center">
          text-center would be off-grid, so it is forced back to start
        </div>
        <div class="border border-neutral-500 px-1 text-justify">same thing for text-justify</div>
      </div>
    </mono-wind>
  `,
};

export const Margin: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-50 border border-neutral-500 px-1">
        <div class="mb-2 border border-cyan-400 px-1">mb-2</div>
        <div class="mt-1 border border-yellow-400 px-1">mt-1 (collapses to 2, not 3)</div>
        <div class="mx-auto mt-1 w-min max-w-full border border-emerald-400 px-1">
          w-min mx-auto
        </div>
        <div class="mx-auto mt-1 w-max max-w-full border border-amber-400 px-1">w-max mx-auto</div>
      </div>
    </mono-wind>
  `,
};
