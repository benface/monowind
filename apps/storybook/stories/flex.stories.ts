import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

const meta: Meta = {
  title: "Features/Flex",
};
export default meta;

export const Justify: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="flex justify-start gap-1 border border-neutral-500">
          <div>justify</div>
          <div>start</div>
        </div>
        <div class="flex justify-center gap-1 border border-neutral-500">
          <div>justify</div>
          <div>center</div>
        </div>
        <div class="flex justify-end gap-1 border border-neutral-500">
          <div>justify</div>
          <div>end</div>
        </div>
        <div class="flex justify-between border border-neutral-500">
          <div>justify</div>
          <div>between</div>
        </div>
        <div class="flex justify-around border border-neutral-500">
          <div>justify</div>
          <div>around</div>
        </div>
        <div class="flex justify-evenly border border-neutral-500">
          <div>justify</div>
          <div>evenly</div>
        </div>
      </div>
    </mono-wind>
  `,
};

export const Align: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex min-h-7 items-center gap-1 border border-neutral-500 px-1">
        <div class="border border-cyan-400 px-1">center</div>
        <div class="self-start border border-yellow-400 px-1">self-start</div>
        <div class="self-end border border-fuchsia-400 px-1">self-end</div>
        <div class="self-stretch border border-emerald-400 px-1">self-stretch</div>
      </div>
    </mono-wind>
  `,
};

export const GrowShrinkBasis: StoryObj = {
  name: "Grow / Shrink / Basis",
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="flex gap-1">
          <div class="shrink-0 border border-yellow-400 px-1">doesn't grow or shrink</div>
          <div class="min-w-24 grow border border-emerald-400 px-1">grows + min width</div>
          <div class="border border-neutral-500 px-1">doesn't grow, but shrinks</div>
        </div>
        <div class="flex gap-1">
          <div class="flex-1 border border-cyan-400 px-1">flex-1</div>
          <div class="flex-1 border border-cyan-400 px-1">flex-1 with much longer content</div>
          <div class="flex-1 border border-cyan-400 px-1">flex-1</div>
        </div>
        <div class="flex gap-1">
          <div class="basis-24 border border-emerald-400 px-1">basis-24</div>
          <div class="grow border border-yellow-400 px-1">grow</div>
        </div>
      </div>
    </mono-wind>
  `,
};

export const Wrap: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex max-w-40 flex-wrap gap-x-1 border border-neutral-500 px-1">
        <div class="border border-cyan-400 px-1">first</div>
        <div class="border border-cyan-400 px-1">second item</div>
        <div class="border border-cyan-400 px-1">a third one</div>
        <div class="border border-cyan-400 px-1">fourth</div>
        <div class="border border-cyan-400 px-1">five</div>
      </div>
    </mono-wind>
  `,
};

export const ReverseAndOrder: StoryObj = {
  name: "Reverse & Order",
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="flex flex-row-reverse gap-1 border border-neutral-500 px-1">
          <button class="border border-cyan-400 px-1">first</button>
          <button class="border border-cyan-400 px-1">second</button>
          <button class="border border-cyan-400 px-1">third</button>
        </div>
        <div class="flex gap-1 border border-neutral-500 px-1">
          <button class="order-3 border border-yellow-400 px-1">order-3</button>
          <button class="order-1 border border-yellow-400 px-1">order-1</button>
          <button class="order-2 border border-yellow-400 px-1">order-2</button>
        </div>
      </div>
    </mono-wind>
  `,
};

export const AutoMargins: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="flex border border-neutral-500">
          <div class="me-auto">me-auto</div>
          <div>end</div>
        </div>
        <div class="flex border border-neutral-500">
          <div>start</div>
          <div class="ms-auto">ms-auto</div>
        </div>
        <div class="flex min-h-5 border border-neutral-500">
          <div class="mx-auto my-auto">mx-auto my-auto</div>
        </div>
      </div>
    </mono-wind>
  `,
};

export const Column: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex min-h-18 flex-col gap-1 border border-neutral-500 px-2 py-1">
        <div class="border border-cyan-400 px-1">header</div>
        <div class="grow border border-emerald-400 px-1">
          content section that grows to fill the container, with a lot of text in it so we can see
          that the default height is a minimum, not a fixed height
        </div>
        <div class="border border-cyan-400 px-1">footer</div>
      </div>
    </mono-wind>
  `,
};
