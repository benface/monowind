import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { MonoWindElement } from "monowind";

const meta: Meta = {
  title: "Features / Interactive",
};
export default meta;

/**
 * Form controls: the grid paints borders/backgrounds/focus-invert
 * around them; the browser paints the value, caret, and selection
 * natively. `:focus-visible` inverts colors via `--mw-fg`/`--mw-bg`.
 */

export const Input: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="group relative">
        <label
          for="field"
          class="absolute top-0 left-1 bg-clear px-1 group-has-focus:text-white dark:group-has-focus:text-black"
          >Label</label
        >
        <input id="field" class="w-40 border border-cyan-400 px-1" value="Label" />
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<MonoWindElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    // Browser paints the input's value on top; the grid leaves its
    // own leaf empty. The sibling <label> still renders "Label" into
    // the grid — check `input.value` instead of the grid text.
    const input = host.querySelector<HTMLInputElement>("#field")!;
    expect(input.value).toBe("Label");
    // Cascade guard: form controls opt out of the color-transparent
    // lock, so computed color and caret-color must both be visible.
    const inputColor = getComputedStyle(input).color;
    expect(inputColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(inputColor).not.toBe("transparent");
    expect(getComputedStyle(input).caretColor).not.toBe("rgba(0, 0, 0, 0)");
  },
};

export const Textarea: StoryObj = {
  render: () => html`
    <mono-wind>
      <textarea id="area" class="w-40 border border-cyan-400 px-1" aria-label="Textarea example">
line one
line two</textarea>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<MonoWindElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    // Grid leaves the textarea empty — the browser paints the value on top.
    const text = host.toPlainText();
    expect(text).not.toContain("line one");
    const area = host.querySelector<HTMLTextAreaElement>("#area")!;
    expect(area.value).toContain("line one");
    expect(area.value).toContain("line two");
  },
};

export const Select: StoryObj = {
  render: () => html`
    <mono-wind>
      <select id="dropdown" class="w-40 border border-cyan-400 px-1" aria-label="Select example">
        <option>apple</option>
        <option>banana</option>
        <option>cherry</option>
      </select>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<MonoWindElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    // Grid leaves the select empty — the browser paints the option label.
    expect(host.toPlainText()).not.toContain("apple");
    const dropdown = host.querySelector<HTMLSelectElement>("#dropdown")!;
    expect(dropdown.value).toBe("apple");
  },
};

const bumpCount = (event: Event) => {
  const btn = event.currentTarget as HTMLButtonElement;
  const count = Number(btn.dataset.count ?? "0") + 1;
  btn.dataset.count = String(count);
  btn.textContent = `clicked (${count})`;
};

export const Button: StoryObj = {
  render: () => html`
    <mono-wind>
      <button id="btn" class="cursor-pointer border px-1 hover:text-cyan-400" @click=${bumpCount}>
        click me
      </button>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<MonoWindElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const btn = host.querySelector<HTMLButtonElement>("#btn")!;
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // Click triggers the handler; the text change fires the host's
    // MutationObserver → relayout → grid repaints with the new label.
    btn.click();
    await waitFor(() => expect(host.toPlainText()).toContain("clicked (1)"), { timeout: 5_000 });
    btn.click();
    await waitFor(() => expect(host.toPlainText()).toContain("clicked (2)"), { timeout: 5_000 });
  },
};
