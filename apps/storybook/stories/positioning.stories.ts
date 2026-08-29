import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

const meta: Meta = {
  title: "Features/Positioning",
};
export default meta;

export const Relative: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex max-w-max gap-2 border border-neutral-500 px-1">
        <div class="top-1 border border-neutral-500 px-1">static</div>
        <div class="relative -top-1 border border-cyan-400 px-1">-top-1</div>
        <div class="relative top-1 left-2 border border-yellow-400 px-1">top-1 left-2</div>
        <div class="relative inset-e-2 bottom-1 border border-yellow-400 px-1">
          bottom-1 inset-e-2
        </div>
      </div>
    </mono-wind>
  `,
};

export const Absolute: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="relative min-h-8 max-w-40 border border-neutral-500 px-1">
          <div>anchored corners</div>
          <div class="absolute top-0 right-0 border border-cyan-400 px-1">top-0 right-0</div>
          <div class="absolute bottom-0 left-0 border border-yellow-400 px-1">bottom-0 left-0</div>
        </div>
        <div class="relative min-h-9 max-w-40 border border-neutral-500 px-1">
          <div class="z-10 -mt-1 w-max bg-bg-light px-1 dark:bg-bg-dark">filled</div>
          <div
            class="absolute inset-0 flex items-center justify-center border border-fuchsia-400 px-1"
          >
            inset-0
          </div>
        </div>
        <div class="relative min-h-9 max-w-40 border border-neutral-500 px-1">
          <div class="z-10 -mt-1 w-max bg-bg-light px-1 dark:bg-bg-dark">centered</div>
          <div class="absolute inset-0 m-auto size-max max-w-full border border-fuchsia-400 px-1">
            inset-0 m-auto size-max
          </div>
        </div>
      </div>
    </mono-wind>
  `,
};

export const InlineRelative: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-60 border border-neutral-500 px-2 py-1 leading-loose">
        Inline elements can shift on the grid: this word is
        <span class="relative top-1 text-cyan-400">lowered</span> and this one is
        <span class="relative -top-1 text-yellow-400">raised</span> by one row, without affecting
        the flow of the text around them.
      </div>
    </mono-wind>
  `,
};
