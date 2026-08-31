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
      <div class="flex flex-col gap-1">
        <div class="group relative">
          <label
            for="input"
            class="absolute top-0 left-1 bg-clear px-1 group-has-focus-visible:text-white dark:group-has-focus-visible:text-black"
            >Input</label
          >
          <input
            id="input"
            value="Input"
            class="w-40 max-w-full border border-cyan-400 px-1 dark:focus-visible:border-black"
          />
        </div>
        <div class="flex items-center gap-1">
          <label for="input-name">Name:</label>
          <input id="input-name" value="John Smith" class="grow focus-visible:bg-amber-400" />
        </div>
        <fieldset class="flex items-center">
          <legend>Date of birth:</legend>
          <label for="input-dob-day" class="sr-only">Day</label>
          <input
            id="input-dob-day"
            placeholder="DD"
            size="2"
            maxlength="2"
            inputmode="numeric"
            class="px-2 py-1"
          />
          <span>/</span>
          <label for="input-dob-month" class="sr-only">Month</label>
          <input
            id="input-dob-month"
            placeholder="MM"
            size="2"
            maxlength="2"
            inputmode="numeric"
            class="px-2 py-1"
          />
          <span>/</span>
          <label for="input-dob-year" class="sr-only">Year</label>
          <input
            id="input-dob-year"
            placeholder="YYYY"
            size="4"
            maxlength="4"
            inputmode="numeric"
            class="px-2 py-1"
          />
        </fieldset>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<MonoWindElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    // Browser paints each input's value on top; the grid leaves their
    // leaves empty. Labels are normal elements and render their text
    // into the grid — check `.value` instead of the grid text.
    const bordered = host.querySelector<HTMLInputElement>("#input")!;
    expect(bordered.value).toBe("Input");
    const grid = host.toPlainText();
    expect(grid).not.toContain("John Smith");
    expect(grid).toContain("Name:");
    expect(grid).toContain("Date of birth:");
    // Cascade guard: form controls opt out of the color-transparent
    // lock, so computed color and caret-color must both be visible.
    for (const input of host.querySelectorAll<HTMLInputElement>("input")) {
      const color = getComputedStyle(input).color;
      expect(color).not.toBe("rgba(0, 0, 0, 0)");
      expect(color).not.toBe("transparent");
      expect(getComputedStyle(input).caretColor).not.toBe("rgba(0, 0, 0, 0)");
    }
    // The size attribute drives intrinsic width: DD/MM are narrower
    // than YYYY (2 vs 4 content cells; same px-2 py-1 chrome).
    const day = host.querySelector<HTMLInputElement>("#input-dob-day")!;
    const year = host.querySelector<HTMLInputElement>("#input-dob-year")!;
    const cells = (el: HTMLElement) => Number(el.style.getPropertyValue("--mw-w"));
    expect(cells(year)).toBe(cells(day) + 2);
  },
};

export const Textarea: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="group relative">
          <label
            for="textarea"
            class="absolute top-0 left-1 bg-clear px-1 group-has-focus-visible:text-white dark:group-has-focus-visible:text-black"
            >Textarea</label
          >
          <textarea id="textarea" rows="1" class="w-40 max-w-full border border-cyan-400 px-1">
Textarea
with multiple
lines</textarea>
        </div>
        <div class="flex gap-1">
          <label for="textarea-description">Description:</label>
          <textarea
            id="textarea-description"
            placeholder="Type something..."
            rows="1"
            class="grow focus-visible:bg-amber-400"
          ></textarea>
        </div>
        <div>
          <label for="textarea-funky">Funky textarea</label>
          <textarea
            id="textarea-funky"
            rows="1"
            class="w-full border-2 border-dotted border-orange-400 px-3 py-1 text-end leading-loose"
          >
Right aligned!
And double-spaced!?</textarea>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<MonoWindElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    // Grid leaves each textarea empty — the browser paints the value
    // on top; sibling labels still render into the grid.
    const grid = host.toPlainText();
    expect(grid).not.toContain("with multiple");
    expect(grid).toContain("Description:");
    expect(grid).toContain("Funky textarea");
    const bordered = host.querySelector<HTMLTextAreaElement>("#textarea")!;
    expect(bordered.value).toContain("with multiple");
    expect(bordered.value).toContain("lines");
    const cells = (el: HTMLElement) => Number(el.style.getPropertyValue("--mw-h"));
    // 3 value lines beat rows="1".
    expect(cells(bordered)).toBe(3 + 2); // + top/bottom border
    // Empty with rows="1": exactly one content row.
    expect(cells(host.querySelector<HTMLElement>("#textarea-description")!)).toBe(1);
    // leading-loose doubles the spacing: 2 lines → 2 + 1 gap = 3
    // content rows, + py-1 (2) + border-2 (4).
    const funky = host.querySelector<HTMLElement>("#textarea-funky")!;
    expect(cells(funky)).toBe(3 + 2 + 4);
    // The half-leading cancellation must reach inline boxes too — a
    // textarea's native value would otherwise sit centered in its
    // (leading-loose) line boxes instead of on its rows.
    expect(getComputedStyle(funky).translate).not.toBe("none");
  },
};

export const Select: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="group relative">
          <label
            for="select"
            class="absolute top-0 left-1 bg-clear px-1 group-has-focus-visible:text-white dark:group-has-focus-visible:text-black"
            >Select</label
          >
          <select id="select" class="w-40 max-w-full truncate border border-cyan-400 px-1">
            <option>Select</option>
            <option>an</option>
            <option>option</option>
            <option>Lorem ipsum dolor sit amet, consectetur adipiscing elit</option>
          </select>
        </div>
        <div class="flex items-center gap-1">
          <label for="select-fruit">Fruit:</label>
          <select id="select-fruit" class="field-sizing-content focus-visible:bg-amber-400">
            <option value="apple" selected>Apple</option>
            <option value="banana">Banana</option>
            <option value="cherry">Cherry</option>
            <option value="pineapple">Pineapple</option>
          </select>
        </div>
        <fieldset class="flex items-center">
          <legend>Date of birth:</legend>
          <label for="select-dob-day" class="sr-only">Day</label>
          <select id="select-dob-day" required class="px-2 py-1">
            <option value="" selected disabled>DD</option>
            <option>01</option>
            <option>02</option>
            <option>03</option>
            <option>04</option>
            <option>05</option>
          </select>
          <span>/</span>
          <label for="select-dob-month" class="sr-only">Month</label>
          <select id="select-dob-month" required class="px-2 py-1">
            <option value="" selected disabled>MM</option>
            <option>01</option>
            <option>02</option>
            <option>03</option>
            <option>04</option>
            <option>05</option>
            <option>06</option>
            <option>07</option>
            <option>08</option>
            <option>09</option>
            <option>10</option>
            <option>11</option>
            <option>12</option>
          </select>
          <span>/</span>
          <label for="select-dob-year" class="sr-only">Year</label>
          <select id="select-dob-year" required class="px-2 py-1">
            <option value="" selected disabled>YYYY</option>
            <option>1990</option>
            <option>1991</option>
            <option>1992</option>
          </select>
        </fieldset>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<MonoWindElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    // Grid leaves each select empty — the browser paints the option
    // label; sibling labels and the legend still render into the grid.
    const grid = host.toPlainText();
    expect(grid).not.toContain("Apple");
    expect(grid).toContain("Fruit:");
    expect(grid).toContain("Date of birth:");
    const dropdown = host.querySelector<HTMLSelectElement>("#select")!;
    expect(dropdown.value).toBe("Select");
    // field-sizing-content: sized to the SELECTED option's label
    // ("Apple" = 5 cells), not the longest one.
    const fruit = host.querySelector<HTMLSelectElement>("#select-fruit")!;
    const cells = (el: HTMLElement) => Number(el.style.getPropertyValue("--mw-w"));
    expect(fruit.value).toBe("apple");
    expect(cells(fruit)).toBe(5);
    // Placeholder styling: a required select on its empty option is
    // :invalid and renders dimmer than a valid one — same treatment as
    // a text-control placeholder.
    const day = host.querySelector<HTMLSelectElement>("#select-dob-day")!;
    expect(day.value).toBe("");
    expect(day.matches(":invalid")).toBe(true);
    expect(dropdown.matches(":invalid")).toBe(false);
    const placeholderColor = getComputedStyle(day).color;
    expect(placeholderColor).not.toBe(getComputedStyle(dropdown).color);
    // Picking a real value drops :invalid and the dim color.
    day.value = "01";
    day.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => {
      expect(day.matches(":invalid")).toBe(false);
      expect(getComputedStyle(day).color).toBe(getComputedStyle(dropdown).color);
    });
  },
};

export const Link: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-60 border border-neutral-500 px-1">
        This paragraph has
        <a href="https://benface.com" target="_blank">a completely unstyled link</a> (invert on
        focus) and
        <a
          href="https://benface.com"
          target="_blank"
          id="custom-link"
          class="text-blue-400 underline focus-visible:bg-fuchsia-500 focus-visible:text-white focus-visible:no-underline"
          >a custom one</a
        >
        (with custom focus styles too, try tabbing to it with the keyboard).
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<MonoWindElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const link = host.querySelector<HTMLAnchorElement>("#custom-link")!;
    link.focus();
    expect(document.activeElement).toBe(link);
    // Plays run with no prior pointer interaction, so programmatic
    // focus counts as keyboard-like and :focus-visible matches.
    expect(link.matches(":focus-visible")).toBe(true);
    // The customized bg must reach the grid as span paint (the
    // light-DOM bg itself is transparent-locked). Resolve the expected
    // color through a reference element OUTSIDE the host.
    const reference = document.createElement("div");
    reference.className = "bg-fuchsia-500";
    canvasElement.appendChild(reference);
    const expected = getComputedStyle(reference).backgroundColor;
    const grid = host.shadowRoot!.getElementById("grid")!;
    await waitFor(() => {
      const spans = Array.from(grid.querySelectorAll("span"));
      expect(spans.some((span) => getComputedStyle(span).backgroundColor === expected)).toBe(true);
    });
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
      <div class="flex flex-col gap-1">
        <button id="btn" class="w-max max-w-full cursor-pointer border px-1" @click=${bumpCount}>
          click me
        </button>
        <button
          id="btn-full"
          class="w-full cursor-pointer truncate border px-1 text-center hover:not-focus-visible:text-emerald-400 focus-visible:bg-amber-400"
        >
          full-width, centered label, custom hover and focus colors
        </button>
      </div>
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
    // Full-width + text-center: the label sits centered on the grid.
    const full = host.querySelector<HTMLButtonElement>("#btn-full")!;
    const label = full.textContent!.trim();
    const cells = (name: string) => Number(full.style.getPropertyValue(name));
    const line = host
      .toPlainText()
      .split("\n")
      .find((row) => row.includes(label))!;
    const contentCells = cells("--mw-w") - 2 - 2; // border + px-1 each side
    const expectedOffset = 1 + 1 + Math.floor((contentCells - label.length) / 2);
    expect(line.indexOf(label)).toBe(expectedOffset);
  },
};
