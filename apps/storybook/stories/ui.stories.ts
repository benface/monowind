import { html } from "lit";
import { expect, userEvent, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { dialog } from "@monowind/ui/dialog";
import { menu } from "@monowind/ui/menu";
import { popover } from "@monowind/ui/popover";
import { tooltip } from "@monowind/ui/tooltip";
import {
  cellSize,
  dragTo,
  expectOnItsCells,
  expectTouching,
  hoverOver,
  mountedOn,
  paintedBackground,
  paintedSpan,
  pressAt,
  readyHost,
  release,
  rowsOf,
  testHooks,
  type Point,
} from "./helpers.ts";

/**
 * `@monowind/ui` (specs/ui.md): Zag's machines on the grid — the engine
 * places each floating part against its trigger as an anchored box in
 * the top layer, Zag runs the roles, the keyboard, typeahead, focus,
 * and dismissal. Headless: the parts are styled here through the
 * theme's tokens, and wired by the vanilla path from each render.
 */
const meta: Meta = {
  title: "Packages / ui",
};
export default meta;

const MENU_ITEM =
  "px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg) data-disabled:text-neutral-500 not-data-disabled:cursor-default";
const MENU_CONTENT = "border bg-clear";

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
              <div data-part="item" data-value="new" data-test="new" class=${MENU_ITEM}>New</div>
              <div data-part="item" data-value="open" data-test="open" class=${MENU_ITEM}>
                Open…
              </div>
              <div
                data-part="item"
                data-value="save"
                data-test="save"
                data-disabled
                class=${MENU_ITEM}
              >
                Save
              </div>
            </div>
            <hr data-part="separator" class="border-t" />
            <div data-part="trigger-item" data-test="share" class=${MENU_ITEM}>Share&nbsp;›</div>
            <div data-part="submenu" data-value="share">
              <div data-part="positioner" data-test="sub-positioner" popover="manual" class="-mt-1">
                <div data-part="content" data-test="sub-content" class=${MENU_CONTENT}>
                  <div data-part="item" data-value="mail" data-test="mail" class=${MENU_ITEM}>
                    Mail
                  </div>
                  <div data-part="item" data-value="link" class=${MENU_ITEM}>Copy link</div>
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
    await waitFor(() => expect(rowsOf(host).some((row) => row.includes("Open"))).toBe(true));
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
    await waitFor(() => expect(rowsOf(host).some((row) => row.includes("Copy link"))).toBe(true));
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
    await waitFor(() => expect(rowsOf(host).some((row) => row.includes("Copy link"))).toBe(true));
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
    await waitFor(() => expect(rowsOf(host).some((row) => row.includes("A popover"))).toBe(true));
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
    await waitFor(() => expect(rowsOf(host).some((row) => row.includes("A popover"))).toBe(true));
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
    await waitFor(() => expect(rowsOf(host).some((row) => row.includes("Saves the"))).toBe(true));
    // Escape closes; the focus opens it again, left open for the golden.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(state("content")).toBe("closed"));
    await waitFor(() => expect(by("positioner").matches(":popover-open")).toBe(false));
    by("trigger").focus();
    await waitFor(() => expect(state("content")).toBe("open"));
    await waitFor(() => expect(rowsOf(host).some((row) => row.includes("Saves the"))).toBe(true));
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
