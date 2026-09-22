import { html } from "lit";
import { expect, userEvent, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { dialog } from "@monowind/ui/dialog";
import { defineMonoUi } from "@monowind/ui/elements";
import { listbox } from "@monowind/ui/listbox";
import { menu } from "@monowind/ui/menu";
import { popover } from "@monowind/ui/popover";
import { select } from "@monowind/ui/select";
import { tooltip } from "@monowind/ui/tooltip";
import {
  cellSize,
  dragTo,
  expectOnItsCells,
  expectTouching,
  hoverOver,
  mountedOn,
  paintedBackground,
  expectRow,
  paintedSpan,
  pressAt,
  readyHost,
  release,
  showsRow,
  testHooks,
  type Point,
} from "./helpers.ts";

/**
 * `@monowind/ui` (specs/ui.md): Zag's machines on the grid — the engine
 * places each floating part against its trigger as an anchored box in
 * the top layer, Zag runs the roles, the keyboard, typeahead, focus,
 * and dismissal. Headless: the parts are styled here through the
 * theme's tokens, and wired by the vanilla path from each render.
 *
 * Every part is written out: a mount reads them when lit hands it the
 * root, which it does before committing anything a nested template
 * would bring, so items built by a `map` or a helper arrive too late
 * to be found.
 */

// The elements the `Elements` story writes; the functions above need
// no registry.
defineMonoUi();
const meta: Meta = {
  title: "Packages / ui",
};
export default meta;

const ITEM =
  "px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg) data-disabled:text-neutral-500 not-data-disabled:cursor-default";
const MENU_CONTENT = "border bg-clear";

/** A listbox item: the item's own styles, and the selected one in bold
 * beside its indicator. */
const LIST_ITEM = `${ITEM} data-[state=checked]:font-bold`;

/** A grid drag between two points, pressed on the host's grid where
 * the pointer lands (specs/cell-model.md), and the text it selected. */
function dragSelect(host: HTMLElement, at: Point, to: Point): string {
  expect(document.elementFromPoint(at.x, at.y)).toBe(host);
  const target = host.shadowRoot!.elementFromPoint(at.x, at.y)!;
  pressAt(target, at, 1);
  dragTo(target, to);
  release();
  return document.getSelection()!.toString();
}

/** A point just inside an element's left edge, on its middle row. */
const leftOf = (el: Element): Point => {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + 2, y: rect.top + rect.height / 2 };
};

/** A point just inside an element's right edge, on its middle row. */
const rightOf = (el: Element): Point => {
  const rect = el.getBoundingClientRect();
  return { x: rect.right - 2, y: rect.top + rect.height / 2 };
};

/** A menu with a group, a disabled item, a separator, and a submenu
 * shifted a row up along its item. */
export const Menu: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="p-1" ${mountedOn((root) => menu(root, { id: "file" }))}>
        <p>A page with a menu bar and text below it.</p>
        <p class="mt-1">
          <button data-part="trigger" data-test="trigger" class="border px-1">File</button>
        </p>
        <div data-part="positioner" data-test="positioner" popover="manual" class="-mt-1">
          <div data-part="content" data-test="content" class=${MENU_CONTENT}>
            <div data-part="item-group" data-value="file">
              <div data-part="item-group-label" data-value="file" class="px-1 text-neutral-500">
                File
              </div>
              <div data-part="item" data-value="new" data-test="new" class=${ITEM}>New</div>
              <div data-part="item" data-value="open" data-test="open" class=${ITEM}>Open…</div>
              <div data-part="item" data-value="save" data-test="save" data-disabled class=${ITEM}>
                Save
              </div>
            </div>
            <hr data-part="separator" class="border-t" />
            <div data-part="trigger-item" data-test="share" class=${ITEM}>Share&nbsp;›</div>
            <div data-part="submenu" data-value="share">
              <div data-part="positioner" data-test="sub-positioner" popover="manual" class="-mt-1">
                <div data-part="content" data-test="sub-content" class=${MENU_CONTENT}>
                  <div data-part="item" data-value="mail" data-test="mail" class=${ITEM}>Mail</div>
                  <div data-part="item" data-value="link" class=${ITEM}>Copy link</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p>
          More of the page under the menu, and enough of it for the menu to open over: the host is
          the viewport a floating part flips within.
        </p>
        ${Array.from({ length: 8 }, (_, i) => html`<p>Line ${i + 1} of the page.</p>`)}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const state = (name: string) => by(name).getAttribute("data-state");
    const box = (name: string) => by(name).getBoundingClientRect();
    // Roles from the machine, on the light DOM.
    expect(by("trigger").getAttribute("aria-haspopup")).toBe("menu");
    expect(by("content").getAttribute("role")).toBe("menu");
    expect(by("new").getAttribute("role")).toBe("menuitem");
    // Opened by the keyboard: Down highlights the first item, the
    // arrows move the highlight — an attribute Tailwind styles, the
    // grid repainting on it alone.
    by("trigger").focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(by("new")).toHaveAttribute("data-highlighted"));
    // The focus is the content, an ARIA composite (specs/cell-model.md):
    // its highlighted item is the indication, its own cells stay plain
    // in every paint after.
    await waitFor(() => expect(document.activeElement).toBe(by("content")));
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(by("open")).toHaveAttribute("data-highlighted"));
    await waitFor(() => expect(paintedBackground(host, "Open")).not.toBe(""));
    const highlighted = paintedBackground(host, "Open");
    const pageText = paintedSpan(host, "A page with")?.style.color ?? "";
    const plain = (text: string) => {
      const span = paintedSpan(host, text);
      expect(span).toBeDefined();
      expect(span!.style.backgroundColor).toBe("");
      expect(span!.style.color).toBe(pageText);
    };
    plain("New");
    await userEvent.keyboard("{ArrowUp}");
    await waitFor(() => expect(by("new")).toHaveAttribute("data-highlighted"));
    await waitFor(() => expect(paintedBackground(host, "New")).toBe(highlighted));
    plain("Open");
    // The pointer taking the highlight, then leaving the item, clears it;
    // the focused container's text stays the page's.
    hoverOver(by("open"));
    await waitFor(() => expect(paintedBackground(host, "Open")).toBe(highlighted));
    by("open").dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    await waitFor(() => expect(paintedBackground(host, "Open")).toBe(""));
    plain("Open");
    plain("New");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(state("content")).toBe("closed"));
    await waitFor(() => expect(by("positioner").matches(":popover-open")).toBe(false));
    // Opened by the button: an anchored popover under it, the light
    // element on its cells, its items on the grid over the page's text.
    await userEvent.click(by("trigger"));
    await waitFor(() =>
      expect(by("positioner").getAttribute("data-mw-area")).toBe("span-right bottom"),
    );
    expect(by("trigger").getAttribute("aria-expanded")).toBe("true");
    expect(by("positioner").matches(":popover-open")).toBe(true);
    await expectOnItsCells(host, by("positioner"));
    // Its margin pulls it a row up, its border row on the trigger's.
    const cellHeight = cellSize(host).height;
    await expectTouching(
      () => box("positioner").top + cellHeight,
      () => box("trigger").bottom,
    );
    await expectTouching(
      () => box("positioner").left,
      () => box("trigger").left,
    );
    await expectRow(host, "Open");
    // The menu's own cells are the grid's: a drag from its border cell
    // selects its text, the focus staying on the menu, the menu open.
    const border = { x: box("content").left + 2, y: rightOf(by("open")).y };
    expect(dragSelect(host, border, rightOf(by("open")))).toContain("Open");
    expect(document.activeElement).toBe(by("content"));
    document.getSelection()!.removeAllRanges();
    // The pointer highlights (past Zag's deferred outside-press check,
    // which counts a press in the menu's box as inside), the arrows
    // move the highlight past the disabled item, Escape closes and
    // restores focus.
    hoverOver(by("open"));
    await waitFor(() => expect(by("open")).toHaveAttribute("data-highlighted"));
    expect(state("content")).toBe("open");
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(by("share")).toHaveAttribute("data-highlighted"));
    await userEvent.keyboard("n");
    await waitFor(() => expect(by("new")).toHaveAttribute("data-highlighted"));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(state("content"), "closed on Escape").toBe("closed"));
    await waitFor(() => expect(by("positioner").matches(":popover-open")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(by("trigger")));
    // Reopened, the submenu opens beside its item under the pointer, an
    // anchored popover of its own; left open for the golden.
    await userEvent.click(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    hoverOver(by("share"));
    await waitFor(() => expect(by("share")).toHaveAttribute("data-highlighted"));
    await waitFor(() => expect(state("sub-content")).toBe("open"));
    await waitFor(() =>
      expect(by("sub-positioner").getAttribute("data-mw-area")).toBe("right span-bottom"),
    );
    // Shifted a row up by its margin, its first item level with the item
    // that opened it, past its border; a flip up puts its last item there.
    await expectTouching(
      () => box("sub-positioner").top + cellHeight,
      () => box("share").top,
    );
    await expectTouching(
      () => box("sub-positioner").left,
      () => box("share").right,
    );
    await expectRow(host, "Copy link");
    // The arrow keys walk the submenu: its first item highlighted, on the
    // grid too; Left returns to the parent.
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(paintedBackground(host, "Mail")).not.toBe(""));
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(state("sub-content"), "closed on ArrowLeft").toBe("closed"));
    await waitFor(() => expect(paintedBackground(host, "Mail")).toBe(""));
    // The parent's content holds the focus again, and its arrows work:
    // Up moves the highlight to the item above, Down back to the submenu's.
    // Zag hands the focus back on an animation frame, slow under load.
    await waitFor(() => expect(document.activeElement).toBe(by("content")));
    await userEvent.keyboard("{ArrowUp}");
    await waitFor(() => expect(by("open")).toHaveAttribute("data-highlighted"));
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(by("share")).toHaveAttribute("data-highlighted"));
    // Left with the submenu opened from the keyboard, for the golden;
    // the wait is on the open alone.
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(state("sub-content")).toBe("open"));
    await expectRow(host, "Copy link");
  },
};

/** A listbox of branches: a value selected, groups with their labels,
 * an item disabled, and more items than the box shows. */
export const Listbox: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <p>A page with a list to choose from.</p>
        <div
          class="mt-1"
          data-highlight-on-hover
          ${mountedOn((root) => listbox(root, { id: "branch", defaultValue: ["main"] }))}
        >
          <span data-part="label" data-test="label" class="text-neutral-500">Branch</span>
          <div data-part="content" data-test="content" class="max-h-8 w-20 overflow-y-auto border">
            <div data-part="item-group" data-value="local">
              <div data-part="item-group-label" data-value="local" class="px-1 text-neutral-500">
                Local
              </div>
              <div data-part="item" data-value="main" data-test="main" class=${LIST_ITEM}>
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">main</span>
              </div>
              <div data-part="item" data-value="next" data-test="next" class=${LIST_ITEM}>
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">next</span>
              </div>
              <div data-part="item" data-value="feature" data-test="feature" class=${LIST_ITEM}>
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">feature/grid</span>
              </div>
              <div
                data-part="item"
                data-value="stale"
                data-test="stale"
                data-disabled
                class=${LIST_ITEM}
              >
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">stale</span>
              </div>
            </div>
            <div data-part="item-group" data-value="remote">
              <div data-part="item-group-label" data-value="remote" class="px-1 text-neutral-500">
                Remote
              </div>
              <div
                data-part="item"
                data-value="origin-main"
                data-test="origin-main"
                class=${LIST_ITEM}
              >
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">origin/main</span>
              </div>
              <div
                data-part="item"
                data-value="origin-next"
                data-test="origin-next"
                class=${LIST_ITEM}
              >
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">origin/next</span>
              </div>
              <div data-part="item" data-value="release" data-test="release" class=${LIST_ITEM}>
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">release</span>
              </div>
            </div>
          </div>
        </div>
        <p class="mt-1">More of the page under the list.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const content = by("content");
    // Roles from the machine, on the light DOM.
    expect(content.getAttribute("role")).toBe("listbox");
    expect(content.getAttribute("aria-labelledby")).toBe(by("label").id);
    expect(by("main").getAttribute("role")).toBe("option");
    expect(by("stale").getAttribute("aria-disabled")).toBe("true");
    // The value it was given: its item selected, its indicator painted
    // beside the item's text.
    expect(by("main").getAttribute("aria-selected")).toBe("true");
    await expectRow(host, "✓ main");
    // Tabbed to: a composite's own cells stay plain, so the selection
    // takes the highlight and the grid shows where the focus is
    // (specs/cell-model.md).
    await userEvent.tab();
    await waitFor(() => expect(document.activeElement).toBe(content));
    await waitFor(() => expect(by("main")).toHaveAttribute("data-highlighted"));
    await waitFor(() => expect(paintedBackground(host, "main")).not.toBe(""));
    // A press selects, and the indicator follows the value.
    await userEvent.click(by("next"));
    await waitFor(() => expect(by("next").getAttribute("aria-selected")).toBe("true"));
    expect(by("main").getAttribute("aria-selected")).toBe("false");
    await expectRow(host, "✓ next");
    expect(showsRow(host, "✓ main")).toBe(false);
    // The pointer moves the highlight where the root asks for it: the
    // item it names is the active descendant, Zag keeping
    // `data-highlighted` for the keyboard's own focus below.
    hoverOver(by("feature"));
    await waitFor(() =>
      expect(content.getAttribute("aria-activedescendant")).toBe(by("feature").id),
    );
    // The focus starts at the selection, wherever the list was left:
    // the highlight moved to the first item and the list scrolled away
    // from it, a tab back lands on the selected item and shows it
    // (specs/ui.md).
    content.focus();
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(by("main")).toHaveAttribute("data-highlighted"));
    content.scrollTop = content.scrollHeight;
    await waitFor(() => expect(showsRow(host, "Local")).toBe(false));
    content.blur();
    content.focus();
    await waitFor(() => expect(by("next")).toHaveAttribute("data-highlighted"));
    await expectRow(host, "✓ next");
    expect(by("main"), "the highlight it left is not where it lands").not.toHaveAttribute(
      "data-highlighted",
    );
    // More items than the box shows: the keyboard moves the highlight to
    // the last, the browser scrolls the light content to it, and the grid
    // repaints on the cells it moved to (specs/scrolling.md).
    expect(showsRow(host, "release")).toBe(false);
    content.focus();
    await userEvent.keyboard("{End}");
    await waitFor(() => expect(by("release")).toHaveAttribute("data-highlighted"));
    await waitFor(() => expect(content.scrollTop).toBeGreaterThan(0));
    await expectRow(host, "release");
    await waitFor(() => expect(paintedBackground(host, "release")).not.toBe(""));
    // Enter selects it; left selected and scrolled for the golden.
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(by("release").getAttribute("aria-selected")).toBe("true"));
    await expectRow(host, "✓ release");
  },
};

/** A listbox taking several values at once: every chosen item keeps
 * its check, and the machine's `selectionMode` is all it takes. */
export const ListboxMultiple: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <p>A page with a list to choose from, several at a time.</p>
        <div
          class="mt-1"
          ${mountedOn((root) =>
            listbox(root, { id: "scopes", selectionMode: "multiple", defaultValue: ["read"] }),
          )}
        >
          <span data-part="label" data-test="label" class="text-neutral-500">Scopes</span>
          <div data-part="content" data-test="content" class="w-16 border">
            <div data-part="item" data-value="read" data-test="read" class=${LIST_ITEM}>
              <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
              ><span data-part="item-text">read</span>
            </div>
            <div data-part="item" data-value="write" data-test="write" class=${LIST_ITEM}>
              <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
              ><span data-part="item-text">write</span>
            </div>
            <div data-part="item" data-value="admin" data-test="admin" class=${LIST_ITEM}>
              <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
              ><span data-part="item-text">admin</span>
            </div>
            <div data-part="item" data-value="audit" data-test="audit" class=${LIST_ITEM}>
              <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
              ><span data-part="item-text">audit</span>
            </div>
          </div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    expect(by("content").getAttribute("aria-multiselectable")).toBe("true");
    await expectRow(host, "✓ read");
    // A press adds to the selection rather than replacing it, and each
    // item keeps its own check on the grid.
    await userEvent.click(by("admin"));
    await waitFor(() => expect(by("admin").getAttribute("aria-selected")).toBe("true"));
    expect(by("read").getAttribute("aria-selected"), "the first stays chosen").toBe("true");
    await expectRow(host, "✓ admin");
    await expectRow(host, "✓ read");
    // Pressing a chosen item takes it back out; left with two for the
    // golden.
    await userEvent.click(by("read"));
    await waitFor(() => expect(by("read").getAttribute("aria-selected")).toBe("false"));
    await waitFor(() => expect(showsRow(host, "✓ read")).toBe(false));
    await userEvent.click(by("write"));
    await waitFor(() => expect(by("write").getAttribute("aria-selected")).toBe("true"));
    await expectRow(host, "✓ write");
  },
};

/** A select: the value on its trigger, its list anchored under it in
 * the top layer, and a hidden native select carrying the value into a
 * form, off the grid. */
export const Select: StoryObj = {
  render: () => html`
    <mono-wind>
      <form class="p-1" ${mountedOn((root) => select(root, { id: "branch", name: "branch" }))}>
        <p>A page with a select.</p>
        <div class="mt-1 flex gap-1">
          <span data-part="label" data-test="label" class="text-neutral-500">Branch</span>
          <span data-part="control">
            <button data-part="trigger" data-test="trigger" class="border px-1">
              <span data-part="value-text" data-test="value">Choose…</span>
              <span data-part="indicator" class="ml-1">▼</span>
            </button>
          </span>
        </div>
        <select data-part="hidden-select" data-test="hidden"></select>
        <div data-part="positioner" data-test="positioner" popover="manual" class="-mt-1">
          <div
            data-part="content"
            data-test="content"
            class="${MENU_CONTENT} max-h-8 w-20 overflow-y-auto"
          >
            <div data-part="item-group" data-value="local">
              <div data-part="item-group-label" data-value="local" class="px-1 text-neutral-500">
                Local
              </div>
              <div data-part="item" data-value="main" data-test="main" class=${LIST_ITEM}>
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">main</span>
              </div>
              <div data-part="item" data-value="next" data-test="next" class=${LIST_ITEM}>
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">next</span>
              </div>
              <div
                data-part="item"
                data-value="stale"
                data-test="stale"
                data-disabled
                class=${LIST_ITEM}
              >
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">stale</span>
              </div>
              <div data-part="item" data-value="feature" data-test="feature" class=${LIST_ITEM}>
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">feature/grid</span>
              </div>
            </div>
            <div data-part="item-group" data-value="remote">
              <div data-part="item-group-label" data-value="remote" class="px-1 text-neutral-500">
                Remote
              </div>
              <div
                data-part="item"
                data-value="origin-main"
                data-test="origin-main"
                class=${LIST_ITEM}
              >
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">origin/main</span>
              </div>
              <div data-part="item" data-value="release" data-test="release" class=${LIST_ITEM}>
                <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
                ><span data-part="item-text">release</span>
              </div>
            </div>
          </div>
        </div>
        ${Array.from({ length: 8 }, (_, i) => html`<p>Line ${i + 1} of the page.</p>`)}
      </form>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const state = (name: string) => by(name).getAttribute("data-state");
    const box = (name: string) => by(name).getBoundingClientRect();
    // Roles from the machine, on the light DOM; the hidden select is
    // the form's, and the layout leaves it out.
    expect(by("trigger").getAttribute("aria-haspopup")).toBe("listbox");
    expect(by("content").getAttribute("role")).toBe("listbox");
    expect(by("main").getAttribute("role")).toBe("option");
    expect(by("stale").getAttribute("aria-disabled")).toBe("true");
    expect(by("hidden")).not.toHaveAttribute("data-mw-laid-out");
    expect(by("value").textContent, "the markup's text is the placeholder").toBe("Choose…");
    // Opened by the trigger: an anchored popover under it, its margin
    // pulling its border row onto the trigger's, on its own cells.
    await userEvent.click(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    await waitFor(() =>
      expect(by("positioner").getAttribute("data-mw-area")).toBe("span-right bottom"),
    );
    expect(by("trigger").getAttribute("aria-expanded")).toBe("true");
    expect(by("positioner").matches(":popover-open")).toBe(true);
    await expectOnItsCells(host, by("positioner"));
    await expectTouching(
      () => box("positioner").top + cellSize(host).height,
      () => box("trigger").bottom,
    );
    await expectRow(host, "feature/grid");
    // A press selects, closes the list, and puts the value on the
    // trigger — the grid painting it where the placeholder was.
    await userEvent.click(by("next"));
    await waitFor(() => expect(state("content")).toBe("closed"));
    await waitFor(() => expect(by("positioner").matches(":popover-open")).toBe(false));
    expect(by("value").textContent).toBe("next");
    expect((by("hidden") as HTMLSelectElement).value, "the form carries it").toBe("next");
    await expectRow(host, "next ▼");
    // The keyboard opens it and walks the items past the disabled one,
    // Enter selects; left open on the selection for the golden.
    by("trigger").focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(state("content")).toBe("open"));
    await waitFor(() => expect(by("next")).toHaveAttribute("data-highlighted"));
    // The content takes the focus on a frame of its own: the arrows
    // that follow are its to read.
    await waitFor(() => expect(document.activeElement).toBe(by("content")));
    await userEvent.keyboard("{ArrowDown}");
    // Past the disabled item between them, which never takes it.
    await waitFor(() => expect(by("feature")).toHaveAttribute("data-highlighted"));
    expect(by("stale")).not.toHaveAttribute("data-highlighted");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(by("value").textContent).toBe("feature/grid"));
    await waitFor(() => expect(state("content")).toBe("closed"));
    await userEvent.click(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    await expectRow(host, "✓ feature/grid");
    // More items than the list shows: End takes the highlight to the
    // last, and the scroll brings it inside the content box rather than
    // under the border the grid paints (specs/ui.md). Left there for
    // the golden.
    expect(showsRow(host, "release")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(by("content")));
    await userEvent.keyboard("{End}");
    await waitFor(() => expect(by("release")).toHaveAttribute("data-highlighted"));
    await waitFor(() => expect(by("content").scrollTop).toBeGreaterThan(0));
    await expectRow(host, "release");
  },
};
/** A select taking several values at once: the trigger names them
 * together and the form control carries them all. */
export const SelectMultiple: StoryObj = {
  render: () => html`
    <mono-wind>
      <form
        class="p-1"
        ${mountedOn((root) => select(root, { id: "formats", multiple: true, name: "formats" }))}
      >
        <p>A page with a select taking several values.</p>
        <div class="mt-1 flex gap-1">
          <span data-part="label" class="text-neutral-500">Export</span>
          <span data-part="control">
            <button data-part="trigger" data-test="trigger" class="border px-1">
              <span data-part="value-text" data-test="value">Choose…</span>
              <span data-part="indicator" class="ml-1">▼</span>
            </button>
          </span>
        </div>
        <select data-part="hidden-select" data-test="hidden"></select>
        <div data-part="positioner" data-test="positioner" popover="manual" class="-mt-1">
          <div data-part="content" data-test="content" class=${MENU_CONTENT}>
            <div data-part="item" data-value="csv" data-test="csv" class=${LIST_ITEM}>
              <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
              ><span data-part="item-text">csv</span>
            </div>
            <div data-part="item" data-value="json" data-test="json" class=${LIST_ITEM}>
              <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
              ><span data-part="item-text">json</span>
            </div>
            <div data-part="item" data-value="yaml" data-test="yaml" class=${LIST_ITEM}>
              <span class="inline-block w-2"><span data-part="item-indicator">✓</span></span
              ><span data-part="item-text">yaml</span>
            </div>
          </div>
        </div>
        ${Array.from({ length: 6 }, (_, i) => html`<p>Line ${i + 1} of the page.</p>`)}
      </form>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const state = (name: string) => by(name).getAttribute("data-state");
    const hidden = by("hidden") as HTMLSelectElement;
    const chosen = () => [...hidden.selectedOptions].map((option) => option.value);
    await userEvent.click(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    expect(by("content").getAttribute("aria-multiselectable")).toBe("true");
    // Each press adds a value and leaves the list open; the trigger
    // names them together and the form control carries them all.
    await userEvent.click(by("csv"));
    await waitFor(() => expect(by("value").textContent).toBe("csv"));
    expect(state("content"), "the list stays open").toBe("open");
    await userEvent.click(by("yaml"));
    await waitFor(() => expect(by("value").textContent).toBe("csv, yaml"));
    await waitFor(() => expect(chosen()).toEqual(["csv", "yaml"]));
    await expectRow(host, "csv, yaml");
    // A press on a chosen item takes it back out; left open for the
    // golden.
    await userEvent.click(by("csv"));
    await waitFor(() => expect(by("value").textContent).toBe("yaml"));
    await waitFor(() => expect(chosen()).toEqual(["yaml"]));
  },
};

/** A dialog with a title, a description, and a close button. */
export const Dialog: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="p-1" ${mountedOn((root) => dialog(root, { id: "confirm" }))}>
        <p>A page with a button that opens a dialog.</p>
        <p class="mt-1">
          <button data-part="trigger" data-test="trigger" class="border px-1">Delete</button>
        </p>
        <div
          data-part="positioner"
          data-test="positioner"
          popover="manual"
          class="backdrop:bg-black/50"
        >
          <div data-part="content" data-test="content" class="border px-1">
            <p data-part="title" class="font-bold">Delete the file?</p>
            <p data-part="description">This cannot be undone.</p>
            <p class="mt-1">
              <button data-part="close-trigger" data-test="cancel" class="border px-1">
                Cancel
              </button>
              <button data-test="delete" class="border px-1">Delete</button>
            </p>
          </div>
        </div>
        ${Array.from({ length: 8 }, (_, i) => html`<p>Line ${i + 1} of the page.</p>`)}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const state = (name: string) => by(name).getAttribute("data-state");
    expect(by("content").getAttribute("role")).toBe("dialog");
    expect(by("content").getAttribute("aria-modal")).toBe("true");
    // Opened: in the top layer, centered in the host, its backdrop drawn
    // beneath it, the focus inside and trapped.
    await userEvent.click(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    await waitFor(() => expect(by("positioner")).toHaveAttribute("data-mw-laid-out"));
    expect(by("positioner").matches(":popover-open")).toBe(true);
    // Its backdrop makes it a layer of its own: its text is in the shadow
    // root, past the grid.
    await waitFor(() => expect(host.shadowRoot!.textContent).toContain("Delete the file?"));
    const hostRect = host.getBoundingClientRect();
    const box = by("positioner").getBoundingClientRect();
    expect(Math.abs(box.left + box.width / 2 - (hostRect.left + hostRect.width / 2))).toBeLessThan(
      8,
    );
    await waitFor(() => expect(host.shadowRoot!.querySelector(".backdrop")).not.toBeNull());
    await waitFor(() => expect(by("content").contains(document.activeElement)).toBe(true));
    await userEvent.tab();
    await userEvent.tab();
    expect(by("content").contains(document.activeElement)).toBe(true);
    // Escape closes and restores the focus; reopened for the golden.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(state("content")).toBe("closed"));
    await waitFor(() => expect(by("positioner").matches(":popover-open")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(by("trigger")));
    await userEvent.click(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    await waitFor(() => expect(host.shadowRoot!.textContent).toContain("Delete the file?"));
  },
};

/** A popover with a title, a description, and a close button, its
 * content fading in and out. */
export const Popover: StoryObj = {
  render: () => html`
    <mono-wind>
      <div
        class="p-1"
        ${mountedOn((root) =>
          popover(root, { id: "info", positioning: { placement: "bottom-start" } }),
        )}
      >
        <p>A page with a button that opens a popover.</p>
        <p class="mt-1">
          <button data-part="trigger" data-test="trigger" class="border px-1">Details</button>
        </p>
        <div data-part="positioner" data-test="positioner" popover="manual">
          <div
            data-part="content"
            data-test="content"
            class="border bg-clear px-1 transition-opacity duration-300 data-[state=closed]:opacity-0 starting:opacity-0"
          >
            <p data-part="title" class="font-bold">A popover</p>
            <p data-part="description">Anchored to its button, above the page.</p>
            <p class="mt-1">
              <button data-part="close-trigger" data-test="close" class="border px-1">Close</button>
            </p>
          </div>
        </div>
        ${Array.from({ length: 9 }, (_, i) => html`<p>Line ${i + 1} of the page.</p>`)}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const state = (name: string) => by(name).getAttribute("data-state");
    const box = (name: string) => by(name).getBoundingClientRect();
    expect(by("content").getAttribute("role")).toBe("dialog");
    // Opened: under its button, on its cells, the focus inside.
    await userEvent.click(by("trigger"));
    await waitFor(() =>
      expect(by("positioner").getAttribute("data-mw-area")).toBe("span-right bottom"),
    );
    expect(by("trigger").getAttribute("aria-expanded")).toBe("true");
    await expectOnItsCells(host, by("positioner"));
    await expectTouching(
      () => box("positioner").top,
      () => box("trigger").bottom,
    );
    await expectRow(host, "A popover");
    await waitFor(() => expect(by("content").contains(document.activeElement)).toBe(true));
    // The enter from the starting style has settled at full opacity.
    await waitFor(() => expect(getComputedStyle(by("content")).opacity).toBe("1"));
    // Its text is the grid's to select: a drag across it, pressed where
    // the pointer lands, selects it.
    expect(
      dragSelect(
        host,
        leftOf(by("content").querySelector("[data-part='title']")!),
        rightOf(by("content")),
      ),
    ).toContain("A popover");
    document.getSelection()!.removeAllRanges();
    // Escape closes: the exit fades the content, the positioner held in
    // the top layer until it ends (specs/ui.md), then hidden; the focus
    // restored. The close button closes too; left open for the golden.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(state("content")).toBe("closed"));
    expect(by("positioner").matches(":popover-open")).toBe(true);
    await waitFor(() => expect(by("positioner").matches(":popover-open")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(by("trigger")));
    await userEvent.click(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    await userEvent.click(by("close"));
    await waitFor(() => expect(state("content")).toBe("closed"));
    await waitFor(() => expect(by("positioner").matches(":popover-open")).toBe(false));
    await userEvent.click(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    await expectRow(host, "A popover");
  },
};

/** A tooltip above its button, opened by hover and by focus. */
export const Tooltip: StoryObj = {
  render: () => html`
    <mono-wind>
      <div
        class="p-1 pt-4"
        ${mountedOn((root) =>
          tooltip(root, {
            id: "hint",
            openDelay: 0,
            closeDelay: 0,
            positioning: { placement: "top" },
          }),
        )}
      >
        <p>
          A page with a
          <button data-part="trigger" data-test="trigger" class="border px-1">button</button>
          that carries a tooltip.
        </p>
        <div data-part="positioner" data-test="positioner" popover="manual">
          <div data-part="content" data-test="content" class="border bg-clear px-1">
            Saves the document
          </div>
        </div>
        <p class="mt-1">More of the page.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const state = (name: string) => by(name).getAttribute("data-state");
    const box = (name: string) => by(name).getBoundingClientRect();
    expect(by("content").getAttribute("role")).toBe("tooltip");
    // Hovered: the tooltip above the button, centered on it, on its cells.
    hoverOver(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    await waitFor(() => expect(by("positioner").getAttribute("data-mw-area")).toBe("span-all top"));
    expect(by("trigger").getAttribute("aria-describedby")).toBe(by("content").id);
    await expectOnItsCells(host, by("positioner"));
    await expectTouching(
      () => box("positioner").bottom,
      () => box("trigger").top,
    );
    expect(box("positioner").left).toBeLessThan(box("trigger").left);
    await expectRow(host, "Saves the");
    // Escape closes; the focus opens it again, left open for the golden.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(state("content")).toBe("closed"));
    await waitFor(() => expect(by("positioner").matches(":popover-open")).toBe(false));
    by("trigger").focus();
    await waitFor(() => expect(state("content")).toBe("open"));
    await expectRow(host, "Saves the");
  },
};

/**
 * The same components as markup alone: `<mono-menu>` and its kin root
 * the mount themselves, their attributes the machine's props and their
 * callbacks events that bubble — so a selection in the menu opens the
 * dialog by writing its `open`, and the dialog writes it back when it
 * closes itself. A select's items are its collection, and its mount
 * fills the control a form posts. No script mounts anything here.
 *
 * An element has no display of its own: it is inline, as a custom
 * element is, and the engine splits that inline box around the blocks
 * inside it (specs/cell-model.md), so none of them needs one.
 */
export const Elements: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <p>A page whose components are written as elements.</p>
        <mono-menu id="edit" placement="bottom-start" gutter="1">
          <p class="mt-1">
            <button data-part="trigger" data-test="trigger" class="border px-1">Edit</button>
          </p>
          <div data-part="positioner" data-test="positioner" popover="manual">
            <div data-part="content" data-test="content" class=${MENU_CONTENT}>
              <div data-part="item" data-value="undo" data-test="undo" class=${ITEM}>Undo</div>
              <div data-part="item" data-value="delete" data-test="delete" class=${ITEM}>
                Delete…
              </div>
              <div data-part="trigger-item" data-test="share" class=${ITEM}>Share&nbsp;›</div>
              <mono-submenu value="share" placement="right-start">
                <div data-part="positioner" data-test="sub-positioner" popover="manual">
                  <div data-part="content" data-test="sub-content" class=${MENU_CONTENT}>
                    <div data-part="item" data-value="mail" data-test="mail" class=${ITEM}>
                      Mail
                    </div>
                  </div>
                </div>
              </mono-submenu>
            </div>
          </div>
        </mono-menu>
        <p class="mt-1">
          The
          <mono-tooltip id="hint" open-delay="0" close-delay="0" placement="top">
            <button data-part="trigger" data-test="hint-trigger" class="border px-1">
              Delete…
            </button>
            <span data-part="positioner" data-test="hint-positioner" popover="manual">
              <span data-part="content" data-test="hint" class="border bg-clear px-1">
                Asks first
              </span>
            </span>
          </mono-tooltip>
          item asks before it removes anything.
        </p>
        <mono-select id="branch" name="branch" data-test="select">
          <div data-part="control">
            <button data-part="trigger" data-test="select-trigger" class="border px-1">
              <span data-part="value-text" data-test="value-text">branch…</span>
              <span data-part="indicator" class="ml-1">▼</span>
            </button>
          </div>
          <div data-part="positioner" data-test="select-positioner" popover="manual">
            <div data-part="content" data-test="select-content" class=${MENU_CONTENT}>
              <div data-part="item" data-value="main" data-test="main" class=${ITEM}>
                <span data-part="item-text">main</span>
              </div>
              <div data-part="item" data-value="next" data-test="next" class=${ITEM}>
                <span data-part="item-text">next</span>
              </div>
            </div>
          </div>
          <select data-part="hidden-select"></select>
        </mono-select>
        <mono-dialog id="confirm" data-test="dialog">
          <div data-part="positioner" data-test="dialog-positioner" class="backdrop:bg-black/50">
            <div data-part="content" data-test="dialog-content" class="border px-1">
              <p data-part="title" class="font-bold">Delete the file?</p>
              <p class="mt-1">
                <button data-part="close-trigger" data-test="cancel" class="border px-1">
                  Cancel
                </button>
              </p>
            </div>
          </div>
        </mono-dialog>
        ${Array.from({ length: 6 }, (_, i) => html`<p>Line ${i + 1} of the page.</p>`)}
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const state = (name: string) => by(name).getAttribute("data-state");
    const dialogElement = by("dialog");
    // The events the callbacks dispatch are the wiring: a selection in
    // the menu opens the dialog by writing the attribute.
    const selections: string[] = [];
    canvasElement.addEventListener("itemselect", (event) => {
      const { value } = (event as CustomEvent<{ value: string }>).detail;
      selections.push(value);
      if (value === "delete") dialogElement.setAttribute("open", "");
    });
    // Roles from the machines, on markup no script mounted.
    expect(by("trigger").getAttribute("aria-haspopup")).toBe("menu");
    expect(by("content").getAttribute("role")).toBe("menu");
    expect(by("undo").getAttribute("role")).toBe("menuitem");
    expect(by("dialog-content").getAttribute("role")).toBe("dialog");
    // The attributes are the props: the menu opens where its placement
    // says, a row below its trigger for the gutter.
    await userEvent.click(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    await waitFor(() =>
      expect(by("positioner").getAttribute("data-mw-area")).toBe("span-right bottom"),
    );
    await expectTouching(
      () => by("positioner").getBoundingClientRect().top - cellSize(host).height,
      () => by("trigger").getBoundingClientRect().bottom,
    );
    // The submenu is an element too, placed where its own markup says.
    hoverOver(by("share"));
    await waitFor(() => expect(state("sub-content")).toBe("open"));
    await waitFor(() =>
      expect(by("sub-positioner").getAttribute("data-mw-area")).toBe("right span-bottom"),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(state("content")).toBe("closed"));
    // A selection reaches the page as an event, and the dialog opens on
    // the attribute it writes.
    await userEvent.click(by("trigger"));
    await waitFor(() => expect(state("content")).toBe("open"));
    await userEvent.click(by("delete"));
    await waitFor(() => expect(selections).toEqual(["delete"]));
    await waitFor(() => expect(state("dialog-content")).toBe("open"));
    await waitFor(() => expect(host.shadowRoot!.textContent).toContain("Delete the file?"));
    // Closed by its own button, the machine writes `open` back off.
    await userEvent.click(by("cancel"));
    await waitFor(() => expect(state("dialog-content")).toBe("closed"));
    await waitFor(() => expect(dialogElement.hasAttribute("open")).toBe(false));
    // A select is an element too: its items are its collection, and
    // the mount fills the control a form posts — a write into its own
    // markup, which must not have it mount again.
    expect(by("select-trigger").getAttribute("aria-haspopup")).toBe("listbox");
    const hidden = by("select").querySelector<HTMLSelectElement>("select")!;
    expect(hidden.querySelectorAll("option")).toHaveLength(2);
    expect(hidden.style.display).toBe("none");
    await userEvent.click(by("select-trigger"));
    await waitFor(() => expect(state("select-content")).toBe("open"));
    await expectOnItsCells(host, by("select-positioner"));
    await userEvent.click(by("next"));
    await waitFor(() => expect(by("value-text").textContent).toBe("next"));
    expect(hidden.value).toBe("next");
    await expectRow(host, "next");
    // A tooltip element sits in the sentence and opens over it; left
    // open for the golden.
    hoverOver(by("hint-trigger"));
    await waitFor(() => expect(state("hint")).toBe("open"));
    await waitFor(() =>
      expect(by("hint-positioner").getAttribute("data-mw-area")).toBe("span-all top"),
    );
    await expectRow(host, "Asks first");
  },
};
