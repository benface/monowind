import { html } from "lit";
import { expect, userEvent, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import {
  cellSize,
  channels,
  countLayouts,
  expectColor,
  expectRow,
  frames,
  gridOf,
  hoverOver,
  layoutsQuiet,
  pressAt,
  readyGrid,
  readyHost,
  readyHosts,
  release,
  rowsOf,
  shown,
  testHooks,
} from "./helpers.ts";

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
            class="absolute top-0 left-1 bg-clear px-1 group-has-focus-visible:bg-(--mw-fg) group-has-focus-visible:text-(--mw-bg)"
            >Input</label
          >
          <input
            id="input"
            value="Input"
            class="w-40 max-w-full border border-cyan-400 px-1 focus-visible:border-(--mw-bg)"
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
    const host = await readyHost(canvasElement);
    // Browser paints each input's value on top; the grid leaves their
    // leaves empty. Labels are normal elements and render their text
    // into the grid — check `.value` instead of the grid text.
    const bordered = host.querySelector<HTMLInputElement>("#input")!;
    expect(bordered.value).toBe("Input");
    const grid = host.toPlainText();
    expect(grid).not.toContain("John Smith");
    expect(grid).toContain("Name:");
    expect(grid).toContain("Date of birth:");
    // Cascade guard: form controls opt out of the ink locks, so
    // computed color, the INHERITED text-fill (which, unlike color, has
    // no UA default on controls), and caret-color must all be visible.
    for (const input of host.querySelectorAll<HTMLInputElement>("input")) {
      const cs = getComputedStyle(input);
      expect(cs.color).not.toBe("rgba(0, 0, 0, 0)");
      expect(cs.color).not.toBe("transparent");
      expect(cs.webkitTextFillColor, "control ink visible").not.toBe("rgba(0, 0, 0, 0)");
      expect(cs.caretColor).not.toBe("rgba(0, 0, 0, 0)");
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
            class="absolute top-0 left-1 bg-clear px-1 group-has-focus-visible:bg-(--mw-fg) group-has-focus-visible:text-(--mw-bg)"
            >Textarea</label
          >
          <textarea
            id="textarea"
            rows="1"
            class="w-40 max-w-full border border-cyan-400 px-1 focus-visible:border-(--mw-bg)"
          >
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
    const host = await readyHost(canvasElement);
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
    // content rows, + py-1 (2) + border-2 (2: heavy, one cell per edge).
    const funky = host.querySelector<HTMLElement>("#textarea-funky")!;
    expect(cells(funky)).toBe(3 + 2 + 2);
    // The half-leading lift must reach inline boxes too — a textarea's
    // native value would otherwise sit centered in its (leading-loose)
    // line boxes instead of on its rows.
    expect(parseFloat(getComputedStyle(funky).top)).toBeLessThan(0);
  },
};

export const Select: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="group relative">
          <label
            for="select"
            class="absolute top-0 left-1 bg-clear px-1 group-has-focus-visible:bg-(--mw-fg) group-has-focus-visible:text-(--mw-bg)"
            >Select</label
          >
          <select
            id="select"
            class="w-40 max-w-full truncate border border-cyan-400 px-1 focus-visible:border-(--mw-bg)"
          >
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
    const host = await readyHost(canvasElement);
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
  },
};

/** Test-only (hidden from the sidebar): `Select`'s placeholder select
 * picked, and presses that take the focus off a focus-visible select —
 * onto another, onto the grid, onto its own row. */
export const SelectPressed: StoryObj = {
  tags: ["!dev"],
  render: Select.render!,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const dropdown = host.querySelector<HTMLSelectElement>("#select")!;
    const fruit = host.querySelector<HTMLSelectElement>("#select-fruit")!;
    const day = host.querySelector<HTMLSelectElement>("#select-dob-day")!;
    // Picking a real value drops :invalid and the dim color.
    day.value = "01";
    day.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => {
      expect(day.matches(":invalid")).toBe(false);
      expect(getComputedStyle(day).color).toBe(getComputedStyle(dropdown).color);
    });
    // A press on another select while one is focus-visible, a caret
    // left in the grid by an earlier click: the blur's relayout repaints
    // the first's cells at once — the press is the control's, never a
    // native grid drag to hold the repaint for — before the picker opens
    // and holds relayouts.
    const gridBackgroundAt = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const [x, y] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
      const spans = gridOf(host).querySelectorAll("span");
      const span = Array.from(spans).find((span) => {
        const r = span.getBoundingClientRect();
        return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
      });
      return span?.style.backgroundColor ?? "";
    };
    const center = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    dropdown.focus();
    expect(dropdown.matches(":focus-visible")).toBe(true);
    await waitFor(() => expect(gridBackgroundAt(dropdown)).not.toBe(""));
    const gridEl = gridOf(host);
    const gridText = document.createTreeWalker(gridEl, NodeFilter.SHOW_TEXT).nextNode()!;
    document.getSelection()!.setBaseAndExtent(gridText, 0, gridText, 0);
    pressAt(fruit, center(fruit), 1);
    fruit.focus();
    expect(gridBackgroundAt(dropdown)).toBe("");
    release();
    host.dispatchEvent(new PointerEvent("pointerleave"));
    // A press on the grid instead: the engine takes the drag over and
    // claims it before the blur, so the blur's relayout paints too.
    dropdown.focus();
    await waitFor(() => expect(gridBackgroundAt(dropdown)).not.toBe(""));
    document.getSelection()!.setBaseAndExtent(gridText, 0, gridText, 0);
    pressAt(gridEl, center(host.querySelector<HTMLElement>("legend")!), 1);
    expect(document.activeElement).not.toBe(dropdown);
    expect(gridBackgroundAt(dropdown)).toBe("");
    release();
    host.dispatchEvent(new PointerEvent("pointerleave"));
    // A press on the select's own row, which that relayout rebuilds:
    // the caret lands on the grid's fresh nodes.
    dropdown.focus();
    await waitFor(() => expect(gridBackgroundAt(dropdown)).not.toBe(""));
    const box = dropdown.getBoundingClientRect();
    const cellWidth = cellSize(host).width;
    pressAt(gridEl, { x: box.right + 2 * cellWidth, y: box.top + box.height / 2 }, 1);
    expect(gridBackgroundAt(dropdown)).toBe("");
    // The caret's node, seen through the shadow (the document's anchor
    // is retargeted onto the host in some engines).
    const selection = document.getSelection()!;
    const inner = (host.shadowRoot as { getSelection?: () => Selection | null }).getSelection?.();
    const caret =
      selection.getComposedRanges?.({ shadowRoots: [host.shadowRoot!] })[0]?.startContainer ??
      (inner ?? selection).getRangeAt(0).startContainer;
    expect(caret.nodeType).toBe(Node.TEXT_NODE);
    expect(gridEl.contains(caret)).toBe(true);
    release();
    host.dispatchEvent(new PointerEvent("pointerleave"));
    selection.removeAllRanges();
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
};

/** Test-only (hidden from the sidebar): `Link`'s custom link focused,
 * its focus styles painted on the grid. */
export const LinkFocused: StoryObj = {
  tags: ["!dev"],
  render: Link.render!,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
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
    const grid = gridOf(host);
    await waitFor(() => {
      const spans = Array.from(grid.querySelectorAll("span"));
      expect(spans.some((span) => getComputedStyle(span).backgroundColor === expected)).toBe(true);
    });
  },
};

/** Clicks counted without touching the label, so the grid never
 * relayouts under the pointer. */
const countClicks = (event: Event) => {
  const el = event.currentTarget as HTMLElement;
  el.dataset.clicks = String(Number(el.dataset.clicks ?? "0") + 1);
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
          class="w-full cursor-pointer truncate border px-1 text-center transition duration-200 hover:not-focus-visible:text-emerald-400 focus-visible:bg-amber-400 active:scale-98 active:opacity-50 active:transition-none"
        >
          full-width, centered label, with custom hover, active, and focus states
        </button>
        <!-- An overlay painted over a button and a link: the grid
             shows it on those cells, so a press there is the
             overlay's — the light DOM sees through it, being
             pointer-events: none in grid mode (specs/cell-model.md
             "Pointer states"). An inline link is no box of its own,
             and keeps its own cells' presses. -->
        <div class="relative max-w-64">
          <button
            id="btn-covered"
            class="w-full cursor-pointer truncate border px-1 text-center transition duration-200 hover:not-focus-visible:text-emerald-400 focus-visible:bg-amber-400 active:scale-98 active:opacity-50 active:transition-none"
            @click=${countClicks}
          >
            part of me is covered
          </button>
          <p class="mt-1">
            <a id="lnk-covered" href="#covered" class="underline" @click=${countClicks}>under it</a>
            and
            <a id="lnk-free" href="#free" class="underline" @click=${countClicks}>past it</a>
          </p>
          <div
            data-test="overlay"
            class="absolute inset-y-0 left-0 flex items-center justify-center bg-red-500 px-2"
          >
            covered
          </div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
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
    // The `transition` class must not leak animation frames into the
    // engine's style reads (the measuring gate snaps transitions) — a
    // mid-fade read once painted this whole button transparent.
    const grid = gridOf(host);
    const invisible = Array.from(grid.querySelectorAll("span")).filter(
      (span) => span.textContent!.includes("full-width") && span.style.color === "rgba(0, 0, 0, 0)",
    );
    expect(invisible, "transitioned label paints visibly").toHaveLength(0);
    // The overlay paints over the covered button's left edge, its own
    // text where that border would be — the label, centered, still
    // shows. What a pointer over those cells addresses is
    // `visual/pointer.spec.ts`, which needs a trusted hit.
    const border = host
      .toPlainText()
      .split("\n")
      .find((row) => row.includes("part of me is covered"))!;
    expect(border.trimStart(), "the overlay stands over the border").not.toMatch(/^[│|]/);
    expect(border, "the label still shows").toContain("part of me is covered");
  },
};

/** Test-only (hidden from the sidebar): `Button`'s first button focused
 * and clicked twice, its new label on the grid. */
export const ButtonPressed: StoryObj = {
  tags: ["!dev"],
  render: Button.render!,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const btn = host.querySelector<HTMLButtonElement>("#btn")!;
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // Click triggers the handler; the text change fires the host's
    // MutationObserver → relayout → grid repaints with the new label.
    btn.click();
    await waitFor(() => expect(host.toPlainText()).toContain("clicked (1)"));
    btn.click();
    await waitFor(() => expect(host.toPlainText()).toContain("clicked (2)"));
  },
};

/** A `details` shows its `summary` alone until it opens: its content
 * joins the grid when `open` is set, by a press on the summary or a
 * script, and leaves it when unset (specs/visibility.md "Skipped
 * contents"). Each summary is a list item, its disclosure triangle
 * its marker (specs/lists.md). */
export const Details: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex max-w-60 flex-col gap-1">
        <details data-test="closed" class="border px-1">
          <summary class="cursor-pointer">What does it draw?</summary>
          <p>Drawn on the grid.</p>
        </details>
        <details data-test="open" open class="border px-1">
          <summary class="cursor-pointer">Open from the start</summary>
          <p>Press to fold it.</p>
        </details>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, measure } = await readyGrid(canvasElement);
    const text = host.toPlainText();
    expect(text).toContain("▶ What does it draw?");
    expect(text).not.toContain("Drawn on the grid.");
    expect(text).toContain("▼ Open from the start");
    expect(text).toContain("Press to fold it.");
    // The summaries' native text lies under the grid's, past the marker.
    await waitFor(() => {
      for (const summary of canvasElement.querySelectorAll("summary")) {
        measure().expectNativeOnGrid(summary);
      }
    });
  },
};

/** Each of `Details`' summaries pressed, and pressed back, the grid
 * following. */
export const DetailsToggled: StoryObj = {
  tags: ["!dev", "!golden"],
  render: Details.render!,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const hook = testHooks(canvasElement);
    const text = () => host.toPlainText();
    const shows = (content: string, shown: boolean) =>
      waitFor(() => expect(text().includes(content), content).toBe(shown));
    const toggle = (name: string) => hook(name).querySelector("summary")!.click();
    toggle("closed");
    await shows("Drawn on the grid.", true);
    toggle("open");
    await shows("Press to fold it.", false);
    expect(text()).toContain("Open from the start");
    toggle("closed");
    toggle("open");
    await shows("Drawn on the grid.", false);
    await shows("Press to fold it.", true);
  },
};

/** Checkboxes and radio buttons (specs/checkboxes.md): each state's
 * glyphs from the glyph set, a checked one in its `accent-*`, a
 * disabled one dimmed, a custom `appearance-none` one a box its
 * `checked:` fill paints, and a label a `peer-checked:` style follows;
 * each native control under its glyphs. */
export const Checkboxes: StoryObj = {
  render: () => html`
    <mono-wind>
      <form data-test="form" class="flex max-w-80 flex-col">
        <label><input data-test="remember" type="checkbox" /> Remember me</label>
        <label>
          <input data-test="accent" type="checkbox" checked class="accent-green-400" /> In its
          accent
        </label>
        <label
          ><input data-test="mixed" type="checkbox" .indeterminate=${true} /> Some of them</label
        >
        <label><input data-test="disabled" type="checkbox" checked disabled /> Disabled</label>
        <div class="flex gap-2">
          <label><input data-test="small" type="radio" name="size" /> Small</label>
          <label>
            <input data-test="medium" type="radio" name="size" checked class="accent-cyan-400" />
            Medium
          </label>
        </div>
        <label class="flex gap-2">
          <input
            data-test="custom"
            type="checkbox"
            class="h-1 w-2 appearance-none bg-slate-600 transition-colors duration-300 checked:bg-blue-500"
          />
          Custom
        </label>
        <div>
          <input data-test="peer" id="peer" type="checkbox" class="peer" />
          <label data-test="peer-label" for="peer" class="peer-checked:text-green-400">
            Its label follows
          </label>
        </div>
      </form>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const hook = testHooks(canvasElement);
    const rows = rowsOf(host).map((row) => row.trimEnd());
    for (const row of [
      "[ ] Remember me",
      "[x] In its accent",
      "[-] Some of them",
      "[x] Disabled",
    ]) {
      expect(rows).toContain(row);
    }
    expect(rows.some((row) => /^\( \) Small +\(\u2022\) Medium$/.test(row))).toBe(true);
    // The custom control is its authored box, three cells, no glyph.
    expect(rows).toContain("    Custom");
    expect(rows).toContain("[ ] Its label follows");
    // Checked, in its accent; disabled, at half the controls' color.
    const glyphs = (text: string) =>
      Array.from(gridOf(host).querySelectorAll("span")).filter((span) => span.textContent === text);
    const [accented, disabled] = glyphs("[x]");
    expectColor(shown(accented)!, getComputedStyle(hook("accent")).accentColor, "accent");
    expect(channels(shown(disabled)!)[3]).toBeCloseTo(128, -1);
    // Each native control lies on its glyphs' cells.
    const glyphUnder = (name: string): string => {
      const { width, height } = cellSize(host);
      const grid = gridOf(host).getBoundingClientRect();
      const box = hook(name).getBoundingClientRect();
      const [x, y] = [(box.left - grid.left) / width, (box.top - grid.top) / height];
      expect(Math.abs(x - Math.round(x)), name).toBeLessThan(0.05);
      expect(Math.abs(y - Math.round(y)), name).toBeLessThan(0.05);
      const cells = Math.round(box.width / width);
      return rowsOf(host)[Math.round(y)]!.slice(Math.round(x), Math.round(x) + cells);
    };
    await waitFor(() =>
      expect(
        ["remember", "accent", "mixed", "disabled", "small", "medium", "custom", "peer"].map(
          glyphUnder,
        ),
      ).toEqual(["[ ]", "[x]", "[-]", "[x]", "( )", "(\u2022)", "  ", "[ ]"]),
    );
  },
};

/** `Checkboxes` toggled every way a page or a user flips a control —
 * a click, its label, Space, an arrow in the radio group, a script, a
 * "select all" in one task, a form reset — the grid following each; a
 * script's flip of the custom control fades its fill. */
export const CheckboxesToggled: StoryObj = {
  tags: ["!dev"],
  render: Checkboxes.render!,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const hook = testHooks(canvasElement);
    const input = (name: string) => hook(name) as HTMLInputElement;
    input("remember").click();
    await expectRow(host, "[x] Remember me");
    hook("remember").closest("label")!.click();
    await expectRow(host, "[ ] Remember me");
    input("remember").focus();
    await userEvent.keyboard(" ");
    await expectRow(host, "[x] Remember me");
    input("medium").focus();
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(input("small").checked).toBe(true));
    await expectRow(host, "(\u2022) Small");
    // A script's flips, which fire no event.
    input("accent").checked = false;
    input("mixed").indeterminate = false;
    await expectRow(host, "[ ] In its accent");
    await expectRow(host, "[ ] Some of them");
    // A "select all" in one task lays out once, counted from a host at
    // rest: the custom control's color transition from the load, and
    // the layout a step's own leaves to come, done.
    await layoutsQuiet(host);
    const layouts = countLayouts(host);
    for (const name of ["remember", "accent", "mixed", "peer"]) input(name).checked = true;
    await expectRow(host, "[x] Its label follows");
    await frames(3);
    expect(layouts.count).toBe(1);
    layouts.stop();
    for (const row of ["[x] In its accent", "[x] Some of them"]) await expectRow(host, row);
    // The label a `peer-checked:` style follows.
    expectColor(
      getComputedStyle(hook("peer-label")).color,
      shown(
        Array.from(gridOf(host).querySelectorAll("span")).find((span) =>
          span.textContent!.includes("Its label"),
        ),
      )!,
      "the peer's label",
    );
    // The custom control's fill fades, flipped by a script.
    const fills = () =>
      new Set(
        Array.from(gridOf(host).querySelectorAll<HTMLElement>("span"))
          .map((span) => span.style.backgroundColor)
          .filter(Boolean),
      );
    const [from] = fills();
    input("custom").checked = true;
    const seen: string[] = [];
    for (let frame = 0; frame < 60; frame++) {
      await frames(1);
      seen.push(...fills());
      // The grid's fade alone: the native background stays locked.
      expect(channels(getComputedStyle(hook("custom")).backgroundColor)[3]).toBe(0);
    }
    const to = seen.at(-1)!;
    expect(to).not.toBe(from);
    expect(seen.some((fill) => fill !== from && fill !== to)).toBe(true);
    // A form reset flips each control back to its default.
    (hook("form") as HTMLFormElement).reset();
    for (const row of [
      "[ ] Remember me",
      "[x] In its accent",
      "[ ] Some of them",
      "[ ] Its label follows",
    ]) {
      await expectRow(host, row);
    }
    await expectRow(host, "(\u2022) Medium");
    (document.activeElement as HTMLElement | null)?.blur();
  },
};

/** A host whose width is its content's holds a checkbox and its label
 * on one row, and a radio beside its own: the glyphs' cells count in
 * the width the host measures (specs/checkboxes.md "Sizing"). */
export const CheckboxFit: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind class="w-fit">
      <label><input type="checkbox" /> Remember me</label>
    </mono-wind>
    <mono-wind class="inline-block">
      <label><input type="radio" checked /> Only</label>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const [fit, inline] = await readyHosts(canvasElement);
    expect(rowsOf(fit!)).toEqual(["[ ] Remember me"]);
    expect(rowsOf(inline!)).toEqual(["(\u2022) Only"]);
  },
};

/** A button-like input is as wide as its label: its `value`, else the
 * browser's own ("Submit" in Chromium and WebKit, "Submit Query" in
 * Firefox), measured against a copy outside the host. */
export const ButtonInputs: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <p class="flex gap-1">
        <input data-test="send" type="submit" value="Send" />
        <input data-test="submit" type="submit" />
        <input data-test="reset" type="reset" />
        <input data-test="empty" type="button" />
      </p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const hook = testHooks(canvasElement);
    const cells = (name: string) => Number(hook(name).style.getPropertyValue("--mw-w"));
    // The browser's own label, in the host's font, unpadded and unlocked.
    const labelCells = (type: string) => {
      const { fontFamily, fontSize } = getComputedStyle(host);
      const copy = document.createElement("input");
      copy.type = type;
      copy.style.cssText = "padding: 0; border: 0; appearance: none";
      const zeros = document.createElement("span");
      zeros.textContent = "0".repeat(100);
      for (const el of [copy, zeros]) Object.assign(el.style, { fontFamily, fontSize });
      canvasElement.append(copy, zeros);
      const advance = zeros.getBoundingClientRect().width / 100;
      const label = Math.ceil(copy.getBoundingClientRect().width / advance - 0.05);
      copy.remove();
      zeros.remove();
      return label;
    };
    expect(cells("send")).toBe(4);
    expect(cells("submit")).toBe(labelCells("submit"));
    expect(cells("reset")).toBe(labelCells("reset"));
    expect(cells("submit")).toBeGreaterThan(0);
    expect(cells("empty")).toBe(0);
  },
};

/** `pointer-events: none` passes the pointer through, as natively: a
 * badge laid over a button's corner leaves the press, the hover and the
 * cursor there to the button, and a link it disables (`aria-disabled`,
 * no `href`) takes none of them (specs/cell-model.md "Pointer states"). */
export const ClickThrough: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="relative w-max">
          <button
            data-test="button"
            class="cursor-pointer border px-1 hover:text-emerald-400"
            @click=${bumpCount}
          >
            inbox
          </button>
          <span
            data-test="badge"
            class="pointer-events-none absolute top-0 -right-1 bg-red-600 px-1 text-white"
            >3</span
          >
        </div>
        <p>
          <a
            data-test="enabled"
            href="#enabled"
            class="underline hover:text-emerald-400"
            @click=${countClicks}
            >a link</a
          >
          and
          <a
            data-test="disabled"
            role="link"
            aria-disabled="true"
            class="pointer-events-none cursor-pointer underline opacity-50"
            @click=${countClicks}
            >a disabled one</a
          >
        </p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    // The disabled link keeps its own value in grid mode, where links
    // otherwise take the pointer back; what a real press does is
    // visual/pointer.spec.ts's.
    expect(getComputedStyle(testHooks(canvasElement)("disabled")).pointerEvents).toBe("none");
  },
};

/** Test-only (hidden from the sidebar and the visual sweep, its play
 * ending as `ClickThrough` starts): the button under the badge hovered
 * through it, and kept the grid's under a page's pointer lock. */
export const ClickThroughHovered: StoryObj = {
  tags: ["!dev", "!golden"],
  render: ClickThrough.render!,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    hoverOver(by("badge"));
    // Over the badge's cells the button beneath hovers, uncovered.
    await waitFor(() => expect(by("button")).toHaveAttribute("data-mw-hover"));
    expect(by("button")).not.toHaveAttribute("data-mw-covered");
    expect(by("badge")).not.toHaveAttribute("data-mw-hover");
    // A lock the page sets above the host — a modal's, on the body — is
    // the page's own: the button laid out under it stays the grid's.
    document.body.style.pointerEvents = "none";
    try {
      by("badge").textContent = "4";
      await waitFor(() => expect(host.toPlainText()).toContain("4"));
      expect(by("button")).not.toHaveAttribute("data-mw-pointer-none");
    } finally {
      document.body.style.pointerEvents = "";
      by("badge").textContent = "3";
    }
    host.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse", isPrimary: true }));
    await waitFor(() => expect(by("button")).not.toHaveAttribute("data-mw-hover"));
    await waitFor(() => expect(host.toPlainText()).toContain("3"));
  },
};

/** Test-only (hidden from the sidebar and the visual sweep): what
 * addresses an element with no pointer over it — a key's activation of
 * the focused button, a label's click forwarded to its control —
 * reaches it in grid mode (visual/pointer.spec.ts, which needs trusted
 * input). Full screen, so the viewport's origin, where Chromium and
 * Firefox report a key's click, is a cell the paragraph shows. */
export const Activation: StoryObj = {
  tags: ["!dev", "!golden"],
  parameters: { layout: "fullscreen" },
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <p>A paragraph on the first row.</p>
        <button data-test="button" class="w-max border px-1" @click=${countClicks}>press</button>
        <label data-test="wrapping">Wrapping <input data-test="wrapped" type="checkbox" /></label>
        <p>
          <label data-test="pointing" for="pointed">Pointing</label>
          <input id="pointed" data-test="pointed" type="checkbox" />
        </p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
  },
};

/** Test-only (hidden from the sidebar and the visual sweep): what takes
 * no pointer events passes the pointer where it is drawn — a tip
 * translated over a button, a paragraph over a drop zone whose link
 * takes the pointer again — a button whose centre another box covers,
 * for a key's activation, and a box drawn 4px off its laid-out cells,
 * for the hover at its edge (visual/pointer-events.spec.ts). */
export const PassThrough: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="relative w-30">
          <button data-test="under" class="w-12 border" @click=${countClicks}>under</button>
          <span
            data-test="tip"
            class="pointer-events-none absolute top-0 left-14 -translate-x-14 bg-red-600 text-white"
            >tip</span
          >
        </div>
        <div class="relative">
          <div data-test="zone" class="h-3 bg-gray-800"></div>
          <p class="pointer-events-none absolute top-1 left-1">
            Drop files or
            <a
              data-test="link"
              href="#browse"
              class="pointer-events-auto underline"
              @click=${countClicks}
              >browse</a
            >
          </p>
        </div>
        <div class="relative w-max">
          <button data-test="covered" class="w-20 border" @click=${countClicks}>
            press me please
          </button>
          <div class="absolute top-0 left-6 h-3 w-8 bg-red-600"></div>
        </div>
        <div data-test="edge" class="w-10 translate-x-1 hover:bg-emerald-800">edge</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
  },
};
