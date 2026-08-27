import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

const meta: Meta = {
  title: "Features/Borders",
};
export default meta;

export const Styles: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap gap-x-2 gap-y-1">
        <div class="border border-neutral-400 px-2 py-1">solid</div>
        <div class="border border-dashed border-yellow-400 px-2 py-1">dashed</div>
        <div class="border border-double border-cyan-400 px-2 py-1">double</div>
        <div class="border border-dotted border-blue-400 px-2 py-1">dotted</div>
      </div>
    </mono-wind>
  `,
};

export const Widths: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex gap-x-2 gap-y-1">
        <div class="border-2 border-emerald-400 px-2 py-1">border-2</div>
        <div class="border-3 border-double border-fuchsia-400 px-2 py-1">
          border-3 border-double
        </div>
      </div>
    </mono-wind>
  `,
};

export const DifferentSides: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap gap-x-2 gap-y-1">
        <div class="border-t border-red-400 px-2 py-1">top</div>
        <div class="border-b border-red-400 px-2 py-1">bottom</div>
        <div class="border-y border-orange-400 px-2 py-1">top + bottom</div>
        <div class="border-x border-lime-400 px-2 py-1">left + right</div>
        <div
          class="border border-t-cyan-400 border-r-yellow-400 border-b-fuchsia-400 border-l-red-500 px-2 py-1"
        >
          per-side colors
        </div>
        <div
          class="border [border-right-style:dashed] [border-bottom-style:double] [border-left-style:dotted] px-2 py-1"
        >
          per-side styles
        </div>
      </div>
    </mono-wind>
  `,
};

export const Nested: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="border border-neutral-400">
        <div class="border border-dashed border-neutral-500">
          <div class="border border-dotted border-neutral-600 px-2 py-1">three levels deep</div>
        </div>
      </div>
    </mono-wind>
  `,
};
