import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { cellSize, gridOf, hoverOver, pressAt, readyHost, release, testHooks } from "./helpers.ts";

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
    const btn = host.querySelector<HTMLButtonElement>("#btn")!;
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // Click triggers the handler; the text change fires the host's
    // MutationObserver → relayout → grid repaints with the new label.
    btn.click();
    await waitFor(() => expect(host.toPlainText()).toContain("clicked (1)"));
    btn.click();
    await waitFor(() => expect(host.toPlainText()).toContain("clicked (2)"));
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
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    hoverOver(by("badge"));
    // Over the badge's cells the button beneath hovers, uncovered.
    await waitFor(() => expect(by("button")).toHaveAttribute("data-mw-hover"));
    expect(by("button")).not.toHaveAttribute("data-mw-covered");
    expect(by("badge")).not.toHaveAttribute("data-mw-hover");
    // The disabled link keeps its own value in grid mode, where links
    // otherwise take the pointer back; what a real press does is
    // visual/pointer.spec.ts's.
    expect(getComputedStyle(by("disabled")).pointerEvents).toBe("none");
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
