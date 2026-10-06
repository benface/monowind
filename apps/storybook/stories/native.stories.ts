import { html } from "lit";
import { expect, userEvent, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import sunset from "./assets/sunset.png";
import {
  cellSize,
  centerOf,
  copyText,
  countLayouts,
  dragTo,
  frames,
  gridOf,
  layoutsQuiet,
  pressAt,
  readyHost,
  readyHosts,
  release,
  select,
  testHooks,
} from "./helpers.ts";

const meta: Meta = {
  title: "Features / Native regions",
};
export default meta;

/** A page of the frame's own, in the browser's sans-serif face. */
const PAGE =
  "<body style='margin: 0; padding: 8px; font: 14px sans-serif; background: #eef'>" +
  "<h1 style='font-size: 18px; margin: 0 0 4px'>An embedded page</h1>" +
  "<p style='margin: 0'>Its own document, drawn by the browser.</p></body>";

/** An element's content box, in fractional px. */
function contentBox(el: HTMLElement): { top: number; width: number; height: number } {
  const style = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  const sum = (...sides: (keyof CSSStyleDeclaration)[]) =>
    sides.reduce<number>((total, side) => total + parseFloat(style[side] as string), 0);
  return {
    top: box.top + sum("borderTopWidth", "paddingTop"),
    width: box.width - sum("borderLeftWidth", "borderRightWidth", "paddingLeft", "paddingRight"),
    height: box.height - sum("borderTopWidth", "borderBottomWidth", "paddingTop", "paddingBottom"),
  };
}

/** A check that a region's content box holds its contents within a
 * cell: no overflow, and no spare row. */
function holdsSnugly(region: HTMLElement, cell: { width: number; height: number }): void {
  const { top, height } = contentBox(region);
  const used =
    Math.max(...[...region.children].map((child) => child.getBoundingClientRect().bottom)) - top;
  expect(used, "no overflow").toBeLessThanOrEqual(height + 0.5);
  expect(height - used, "no spare row").toBeLessThan(cell.height);
}

/** A check that an element's border box lies on the host's cells. */
function expectOnCells(host: HTMLElement, el: HTMLElement): void {
  const cell = cellSize(host);
  const grid = gridOf(host).getBoundingClientRect();
  const box = el.getBoundingClientRect();
  for (const [offset, size] of [
    [box.left - grid.left, cell.width],
    [box.top - grid.top, cell.height],
    [box.width, cell.width],
    [box.height, cell.height],
  ] as const) {
    expect(Math.abs(offset - Math.round(offset / size) * size)).toBeLessThan(1);
  }
}

/** A check that an element's text keeps its own font and fill, not the grid's. */
function expectNativeText(host: HTMLElement, text: HTMLElement): void {
  const style = getComputedStyle(text);
  expect(style.webkitTextFillColor, "its own fill").toBe(style.color);
  expect(style.fontFamily, "its own font").not.toBe(getComputedStyle(host).fontFamily);
}

/** A host holding a native region between two paragraphs. */
const regionPage = (mode: string) => html`
  <mono-wind select=${mode} data-test=${mode}>
    <p>Grid text above.</p>
    <div class="w-60 border p-1 font-serif mw-native">
      <p>Native text, its first paragraph.</p>
      <p>Its second.</p>
    </div>
    <p>Grid text below.</p>
  </mono-wind>
`;

/**
 * Native regions in a page (specs/native-regions.md): a frame of a page,
 * its size the default object's — 300 by 150 px on the spacing scale, 75
 * by 38 cells — beside a panel of native text, between the grid's own
 * heading and text.
 */
export const Regions: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <h1 class="font-bold">A page with native regions</h1>
        <div class="my-1 flex items-start gap-2">
          <iframe
            data-test="frame"
            class="border mw-native"
            title="An embedded page"
            srcdoc=${PAGE}
          ></iframe>
          <div class="w-50 border p-1 font-serif mw-native">
            <p data-test="text">
              Native text beside a frame of a page, each drawn by the browser in the cells the grid
              gives it.
            </p>
          </div>
        </div>
        <p>The grid's own text, after them.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const cell = cellSize(host);
    const frame = by("frame");
    expect(Math.round(frame.clientWidth / cell.width)).toBe(75);
    expect(Math.round(frame.clientHeight / cell.height)).toBe(38);
    expectOnCells(host, frame);
    expectNativeText(host, by("text"));
  },
};

/**
 * An image in a native region, beside the same image on the grid
 * (specs/native-regions.md "The utility"): both take the same cells, but
 * only the grid's is drawn in them, its picture a canvas of the grid's;
 * the native one is the browser's, smooth.
 */
export const NativeImage: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex items-start gap-2 p-1">
        <figure>
          <img data-test="grid" class="w-40" src=${sunset} alt="A sunset, on the grid" />
          <figcaption>On the grid</figcaption>
        </figure>
        <figure>
          <img data-test="native" class="w-40 mw-native" src=${sunset} alt="A sunset, native" />
          <figcaption>Native</figcaption>
        </figure>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const [grid, native] = [by("grid"), by("native")];
    const pictures = () => [...host.shadowRoot!.querySelectorAll("canvas.picture")];
    await waitFor(() => expect(pictures()).toHaveLength(1));
    const picture = pictures()[0]!.getBoundingClientRect();
    expect(Math.abs(picture.left - grid.getBoundingClientRect().left)).toBeLessThan(1);
    expect(getComputedStyle(grid).content).toMatch(/^url\("data:image\/gif/);
    expect(getComputedStyle(native).content).toBe("normal");
    expect(native.getAttribute("data-mw-native")).toBe("");
    const [a, b] = [grid, native].map((img) => img.getBoundingClientRect());
    expect(Math.abs(a!.width - b!.width)).toBeLessThan(1);
    expect(Math.abs(a!.height - b!.height)).toBeLessThan(1);
    expectOnCells(host, native);
  },
};

/**
 * A video in a native region (specs/native-regions.md "Layout"): a
 * YouTube embed, as wide as its card and 16:9 in cells, which the
 * browser plays. Its play checks the frame, never the remote load.
 */
export const Video: StoryObj = {
  tags: ["!golden"],
  render: () => html`
    <mono-wind>
      <article class="m-1 max-w-120 border">
        <h2 class="border-b px-1 font-bold">Big Buck Bunny</h2>
        <iframe
          data-test="video"
          class="aspect-video w-full mw-native"
          src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ"
          title="Big Buck Bunny"
          allow="encrypted-media; picture-in-picture; fullscreen"
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
        <p class="border-t px-1">
          The Blender Foundation's short film, played by the browser in a native region.
        </p>
      </article>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const video = testHooks(canvasElement)("video");
    const cell = cellSize(host);
    expect(video.getAttribute("data-mw-native")).toBe("");
    expectOnCells(host, video);
    const { width, height } = video.getBoundingClientRect();
    expect(Math.abs(height - (width * 9) / 16)).toBeLessThan(cell.height);
    expect(getComputedStyle(video).pointerEvents).toBe("auto");
    expect(getComputedStyle(video).clipPath).toBe("none");
  },
};

/**
 * Text in native regions (specs/native-regions.md "Layout"): sans-serif
 * and serif paragraphs in the browser's own faces, sizes and fill, in a
 * region the grid frames, its rows its text's rounded up; and a region
 * as wide as its text, its columns rounded up too.
 */
export const NativeText: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col items-start gap-1 p-1">
        <div data-test="panel" class="w-80 border p-1 mw-native">
          <p data-test="sans" class="font-sans">
            Sans-serif text in a native region: the browser's own face, size and fill, wrapping
            where the browser wraps it, framed by the grid's border.
          </p>
          <p data-test="serif" class="mt-1 font-serif text-lg italic">
            And serif, a size up, set as a page would set it.
          </p>
        </div>
        <div data-test="fit" class="w-fit border px-1 font-serif mw-native">
          <span data-test="fit-text">A region as wide as its text.</span>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const cell = cellSize(host);
    for (const name of ["sans", "serif", "fit-text"]) expectNativeText(host, by(name));
    expect(gridOf(host).textContent).not.toContain("Sans-serif");
    holdsSnugly(by("panel"), cell);
    holdsSnugly(by("fit"), cell);
    // Its columns its text's, rounded up.
    const content = contentBox(by("fit")).width;
    const text = by("fit-text").getBoundingClientRect().width;
    expect(content - text).toBeGreaterThanOrEqual(-0.5);
    expect(content - text).toBeLessThan(cell.width);
  },
};

/**
 * Native regions (specs/native-regions.md): boxes the grid sizes and
 * frames in cells, their contents the browser's — an iframe of a page,
 * and a panel of serif text with a native slider and a button rounded
 * off the grid, each sized by its author.
 */
export const SizedRegions: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex items-start gap-2 p-1">
        <iframe
          data-test="frame"
          class="h-14 w-50 border mw-native"
          title="An embedded page"
          srcdoc=${PAGE}
        ></iframe>
        <div data-test="panel" class="h-14 w-50 border p-1 font-serif mw-native">
          <p data-test="text">
            Native text, in the browser's own serif face, wrapping where the browser wraps it.
          </p>
          <input data-test="slider" type="range" aria-label="A native slider" />
          <button data-test="button" class="rounded-md border px-2 py-0.5">A rounded button</button>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const [frame, panel, text, slider, button] = ["frame", "panel", "text", "slider", "button"].map(
      by,
    );
    expect([frame, panel].map((region) => region!.getAttribute("data-mw-native"))).toEqual([
      "",
      "",
    ]);
    // Their contents are native: their ink, their font, their pointer.
    const textStyle = getComputedStyle(text!);
    expect(textStyle.webkitTextFillColor).toBe(textStyle.color);
    expect(textStyle.fontFamily).not.toBe(getComputedStyle(host).fontFamily);
    for (const el of [frame, text, slider, button]) {
      expect(getComputedStyle(el!).pointerEvents).toBe("auto");
    }
    expect(getComputedStyle(slider!).appearance).not.toBe("none");
    expect(getComputedStyle(button!).borderTopLeftRadius).not.toBe("0px");
    // Each box on its cells: its border cells a transparent native border,
    // its padding cells native padding.
    const cell = cellSize(host);
    for (const region of [frame, panel]) {
      expectOnCells(host, region!);
      const { width, height } = region!.getBoundingClientRect();
      expect(Math.abs(width - 50 * cell.width)).toBeLessThan(1);
      expect(Math.abs(height - 14 * cell.height)).toBeLessThan(1);
      expect(getComputedStyle(region!).borderTopColor).toBe("rgba(0, 0, 0, 0)");
    }
    const inset = text!.getBoundingClientRect().left - panel!.getBoundingClientRect().left;
    expect(Math.abs(inset - 2 * cell.width)).toBeLessThan(1);
  },
};

/**
 * Regions sized by their contents (specs/native-regions.md "Layout"):
 * a block of native text its rows, rounded up through the cell, through
 * a transition of an element inside it too, and one its author offsets.
 */
export const AutoRegion: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="flex flex-col items-start gap-1 p-1">
        <div data-test="block" class="w-60 border p-1 font-serif mw-native">
          <p>Native text whose rows are its own: the region takes as many as the browser draws.</p>
          <div data-test="grow" style="height: 10px; transition: height 0.2s"></div>
        </div>
        <div
          data-test="offset"
          class="relative top-1 bottom-1 w-60 border p-1 font-serif mw-native"
        >
          <p>Native text in a region its author offsets, measured as any.</p>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const cell = cellSize(host);
    const block = by("block");
    holdsSnugly(block, cell);
    holdsSnugly(by("offset"), cell);
    // A change inside lays out at once, and its transition follows to
    // its end through the contents' resizes.
    by("grow").style.height = "120px";
    await waitFor(() => {
      expect(by("grow").getBoundingClientRect().height).toBe(120);
      holdsSnugly(block, cell);
    });
  },
};

/**
 * A region's own styles start native (specs/native-regions.md Decision
 * 5): what the browser's own sheet gives preformatted text, a field, a
 * button, an input button and a link, as outside a host, and in a
 * text-mode host the cursor a box around it sets; a list item's marker
 * the grid's alone.
 */
export const RegionOwnStyles: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="flex flex-col items-start gap-1 p-1">
        <pre data-test="pre" class="mw-native">
Preformatted text,
  its lines its own.</pre>
        <textarea data-test="textarea" class="mw-native" rows="2" aria-label="A native textarea">
A textarea's own wrap.</textarea>
        <button data-test="button" class="mw-native">A native button</button>
        <input data-test="input-button" type="button" value="A native input" class="mw-native" />
        <a data-test="link" href="#" class="mw-native">A native link</a>
        <ol class="list-decimal pl-3">
          <li data-test="item" class="mw-native">A native list item</li>
        </ol>
      </div>
    </mono-wind>
    <mono-wind select="text">
      <div class="cursor-pointer p-1">
        <div data-test="pointed" class="mw-native">Native text under a pointer</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHosts(canvasElement);
    const by = testHooks(canvasElement);
    // The browser's own, read off twins outside any host.
    const outside = document.createElement("div");
    outside.innerHTML =
      '<pre></pre><textarea></textarea><button></button><input type="button"><a href="#"></a>';
    canvasElement.append(outside);
    const [pre, textarea, button, input, link] = [...outside.children].map((el) =>
      getComputedStyle(el),
    );
    const own = (name: string) => getComputedStyle(by(name));
    try {
      expect(own("pre").whiteSpace, "pre").toBe(pre!.whiteSpace);
      expect(own("textarea").whiteSpace, "textarea").toBe(textarea!.whiteSpace);
      expect(own("textarea").overflowWrap, "textarea").toBe(textarea!.overflowWrap);
      expect(own("textarea").cursor, "textarea").toBe(textarea!.cursor);
      expect(own("button").cursor, "button").toBe(button!.cursor);
      expect(own("input-button").webkitUserSelect, "input button").toBe(input!.webkitUserSelect);
      expect(own("link").cursor, "link").toBe(link!.cursor);
    } finally {
      outside.remove();
    }
    expect(own("pointed").cursor, "the page's around it").toBe("pointer");
    expect(getComputedStyle(by("item"), "::marker").content, "its marker").toBe("none");
  },
};

/**
 * A menu over a native region (specs/native-regions.md "Paint"): the
 * region gives way where the menu's cells cover it, as the grid's own
 * paint would — its contents shown around the menu, the menu's box and
 * items taking the pointer over it.
 */
export const MenuOverRegion: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="relative p-1">
        <div data-test="region" class="h-10 w-60 border p-1 font-serif mw-native">
          <p data-test="text">
            Native text under a menu: where the menu's cells cover the region, the region gives way,
            and the text around them stays the browser's own.
          </p>
        </div>
        <div
          data-test="menu"
          role="menu"
          class="absolute top-3 left-20 z-10 border bg-black px-1 text-white"
        >
          <button data-test="item" role="menuitem" class="block">Open</button>
          <button role="menuitem" class="block">Save as…</button>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    expect(getComputedStyle(by("region")).clipPath).toMatch(/^path\(evenodd/);
    const at = (el: Element, x: number, y: number) => {
      const box = el.getBoundingClientRect();
      return document.elementFromPoint(box.left + x * box.width, box.top + y * box.height);
    };
    expect(at(by("item"), 0.5, 0.5), "an item over the region").toBe(by("item"));
    expect(at(by("menu"), 0.98, 0.95), "the menu's own box, the grid's").toBe(host);
    expect(at(by("text"), 0.01, 0.1), "the text around it").toBe(by("text"));
  },
};

/** A modal dialog's backdrop over a native region painted before it
 * (specs/native-regions.md deviation 1): the region hidden whole, the
 * page dimmed around the dialog. */
export const DialogOverRegion: StoryObj = {
  tags: ["!dev"],
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <div data-test="region" class="h-6 w-60 border p-1 font-serif mw-native">
          Native text a modal dialog's backdrop hides.
        </div>
        <p>The page, which the backdrop dims.</p>
        <dialog data-test="dialog" class="border p-1 backdrop:bg-black/50">
          <p>A modal dialog.</p>
        </dialog>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    (by("dialog") as HTMLDialogElement).showModal();
    await waitFor(() => expect(getComputedStyle(by("region")).clipPath).toBe("inset(50%)"));
  },
};

/** A native region scrolled under a sticky header in a scroller of the
 * grid's (specs/native-regions.md "Paint"): clipped at the header's
 * rows, the header's cells the grid's over it. */
export const RegionScrolledUnderHeader: StoryObj = {
  tags: ["!dev"],
  render: () => html`
    <mono-wind>
      <div data-test="scroller" class="m-1 h-12 w-60 overflow-y-auto border">
        <p data-test="header" class="sticky top-0 border-b bg-black px-1 text-white">
          A sticky header
        </p>
        <div data-test="region" class="mx-1 h-8 border p-1 font-serif mw-native">
          Native text that scrolls under the header, which covers it as it would the grid's.
        </div>
        <p class="px-1">Grid text below the region,</p>
        <p class="px-1">and more,</p>
        <p class="px-1">past the scroller's end.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const cell = cellSize(host);
    await layoutsQuiet(host);
    const layouts = countLayouts(host);
    by("scroller").scrollTop = 3 * cell.height;
    await waitFor(() => expect(getComputedStyle(by("region")).clipPath).toMatch(/^path/));
    await frames(3);
    expect(layouts.count, "a scroll repaints, its clip with it").toBe(0);
    layouts.stop();
    const header = by("header").getBoundingClientRect();
    const region = by("region").getBoundingClientRect();
    const x = region.left + region.width / 2;
    expect(region.top, "under the header").toBeLessThan(header.bottom);
    expect(document.elementFromPoint(x, header.bottom - 2), "the header's cells").toBe(host);
  },
};

/**
 * A native region's content takes its own input in grid mode, in a
 * scroller of the grid's (specs/native-regions.md "Interaction"): a
 * press is its own, a wheel over its own scroller the browser's, and
 * typing into a field in it lays the host out no more.
 */
export const RegionContentsInteract: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div data-test="scroller" class="h-8 w-60 overflow-y-auto border">
        <div data-test="region" class="h-6 overflow-y-auto border p-1 font-serif mw-native">
          <p data-test="text">
            Native text, long enough to scroll inside its own region: the browser scrolls it, and
            the grid's scroller around it after, as a page chains its scrollers.
          </p>
          <input data-test="field" class="border" aria-label="A native field" />
        </div>
        <p>Grid text below the region.</p>
        <p>More grid text, past the scroller's edge.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const text = by("text");
    const box = text.getBoundingClientRect();
    const at = { x: box.left + 4, y: box.top + 4 };
    expect(pressAt(text, at, 1), "a press, its own").toBe(true);
    release();
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 2,
      clientX: at.x,
      clientY: at.y,
    });
    const region = by("region");
    const scroller = by("scroller");
    expect(region.scrollHeight, "its own to scroll").toBeGreaterThan(region.clientHeight);
    expect(scroller.scrollHeight, "the grid's to scroll").toBeGreaterThan(scroller.clientHeight);
    expect(text.dispatchEvent(wheel), "a wheel, the browser's").toBe(true);
    const field = by("field") as HTMLInputElement;
    field.focus();
    await layoutsQuiet(host);
    const layouts = countLayouts(host);
    await userEvent.keyboard("typed");
    await frames(3);
    expect(field.value).toBe("typed");
    expect(layouts.count, "layouts while typing").toBe(0);
    layouts.stop();
  },
};

/**
 * A grid drag across native regions sweeps through them, their contents
 * giving up the pointer for the drag as the interactives do
 * (specs/native-regions.md "Interaction"): a frame of a page among them.
 */
export const GridDragAcrossRegion: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind select="grid">
      <div class="flex flex-col items-start gap-1 p-1">
        <p data-test="above">Grid text above the regions.</p>
        <div data-test="region" class="w-60 border p-1 font-serif mw-native">
          <p data-test="text">Native text a grid drag sweeps through.</p>
          <input data-test="field" class="border" aria-label="A native field" />
        </div>
        <iframe
          data-test="frame"
          class="h-8 w-60 border mw-native"
          title="An embedded page"
          srcdoc=${PAGE}
        ></iframe>
        <p data-test="below">Grid text below them.</p>
        <div class="pointer-events-none">
          <div class="w-60 border p-1 mw-native">
            <button data-test="inert">Under an authored pointer-events: none</button>
          </div>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const grid = gridOf(host);
    expect(getComputedStyle(by("inert")).pointerEvents, "the author's none").toBe("none");
    const swept = ["region", "text", "field", "frame"].map(by);
    const pointer = () => swept.map((el) => getComputedStyle(el).pointerEvents);
    expect(pointer(), "their own pointer").toEqual(["auto", "auto", "auto", "auto"]);
    pressAt(grid, centerOf(by("above")), 1);
    dragTo(grid, centerOf(by("text")));
    expect(host).toHaveAttribute("data-mw-dragging");
    expect(pointer(), "the drag's").toEqual(["none", "none", "none", "none"]);
    for (const el of [by("text"), by("frame")]) {
      const at = centerOf(el);
      expect(document.elementFromPoint(at.x, at.y), "the grid under the drag").toBe(host);
    }
    release();
    expect(host).not.toHaveAttribute("data-mw-dragging");
    expect(pointer(), "their own again").toEqual(["auto", "auto", "auto", "auto"]);
  },
};

/**
 * A copy across a native region takes its text, as the page renders it,
 * in either mode — in grid mode, in its content box's cells — while a
 * selection inside one region is the browser's own: no highlight lock,
 * no inverted cells, a copy the host leaves alone
 * (specs/native-regions.md "Interaction").
 */
export const CopyAcrossRegion: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`${regionPage("text")} ${regionPage("grid")}`,
  play: async ({ canvasElement }) => {
    await readyHosts(canvasElement);
    const by = testHooks(canvasElement);
    const [text, grid] = [by("text"), by("grid")];
    select(text, "Grid text above.", "Grid text below.");
    expect(copyText(text)).toBe(
      "Grid text above.\n\nNative text, its first paragraph.\nIts second.\n\nGrid text below.",
    );
    select(gridOf(grid), "Grid text above.", "Grid text below.");
    await frames(2);
    const copied = copyText(grid)
      .split("\n")
      .map((line) => line.trimEnd());
    expect(copied).toEqual([
      "Grid text above.",
      expect.stringMatching(/^┌─+┐$/),
      expect.stringMatching(/^│ +│$/),
      expect.stringMatching(/^│ Native text, its first paragraph\. +│$/),
      expect.stringMatching(/^│ Its second\. +│$/),
      expect.stringMatching(/^│ +│$/),
      expect.stringMatching(/^└─+┘$/),
      "Grid text below.",
    ]);
    expect(gridOf(grid).textContent, "the grid draws none of it").not.toContain("Native");
    for (const host of [text, grid]) {
      select(host, "Native text", "second.");
      await frames(2);
      expect(host.hasAttribute("data-mw-selection"), "no highlight lock").toBe(false);
      expect(copyText(host), "the browser's copy").toBe("");
    }
    document.getSelection()!.removeAllRanges();
  },
};

/**
 * Tab goes into a native region and out, natively, the focus ring its
 * contents' own (specs/native-regions.md "Interaction"); a frame's
 * contents take it too (`visual/keyboard.spec.ts`, a real Tab).
 */
export const TabThroughRegion: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="flex items-start gap-2 p-1">
        <button data-test="before" class="border px-1">Before</button>
        <div class="border p-1 font-serif mw-native">
          <a data-test="link" href="#tab-through-region">A native link</a>
        </div>
        <iframe
          data-test="frame"
          class="h-6 w-30 border mw-native"
          title="A page with a button"
          srcdoc="<button>Inside</button>"
        ></iframe>
        <button data-test="after" class="border px-1">After</button>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    by("before").focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(by("link"));
    expect(getComputedStyle(by("link")).outlineStyle, "its own focus ring").not.toBe("none");
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(by("before"));
  },
};

/**
 * Under `focus="arrows"`, the arrows inside a native region are its
 * contents' own, and the host's navigation passes over them, which the
 * layout does not know (specs/native-regions.md "Interaction",
 * specs/focus-navigation.md).
 */
export const ArrowsInRegion: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind focus="arrows">
      <div class="flex flex-col items-start gap-1 p-1">
        <button data-test="above" class="border px-1">Above</button>
        <div class="border p-1 font-serif mw-native">
          <button data-test="first">First</button>
          <button data-test="second">Second</button>
        </div>
        <button data-test="below" class="border px-1">Below</button>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    by("first").focus();
    for (const key of ["{ArrowDown}", "{ArrowRight}"]) {
      await userEvent.keyboard(key);
      expect(document.activeElement, key).toBe(by("first"));
    }
    by("above").focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(by("below"));
  },
};

/**
 * A host in a native region is a host of its own
 * (specs/native-regions.md "Nesting"): laid out by itself, on its own
 * grid at its own font size, the outer host's locks stopping at the
 * region, which takes the inner host's rows.
 */
export const NestedHost: StoryObj = {
  render: () => html`
    <mono-wind data-test="outer">
      <div class="flex items-start gap-2 p-1">
        <p class="w-30">The outer host's text, beside a region holding a host of its own.</p>
        <div data-test="region" class="w-40 border p-1 mw-native">
          <mono-wind data-test="inner" class="text-xs">
            <div class="border px-1">
              <p class="font-bold">An inner host</p>
              <p>On its own grid, at its own size.</p>
            </div>
          </mono-wind>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHosts(canvasElement);
    const by = testHooks(canvasElement);
    const [outer, inner] = [by("outer"), by("inner")];
    expect(inner).not.toHaveAttribute("data-mw-nested");
    expect(gridOf(inner).textContent).toContain("An inner host");
    expect(gridOf(outer).textContent).not.toContain("An inner host");
    expect(cellSize(inner).height).toBeLessThan(cellSize(outer).height);
    await waitFor(() => holdsSnugly(by("region"), cellSize(outer)));
  },
};

/**
 * A region toggled (specs/native-regions.md "The locks"): without
 * `mw-native` its contents are the grid's again, locked and drawn in
 * cells; with it back, the browser's.
 */
export const RegionToggled: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div data-test="region" class="m-1 w-60 border p-1 font-serif mw-native">
        <p data-test="text">Native text, then the grid's, then native again.</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const [region, text] = [by("region"), by("text")];
    const native = async (is: boolean) =>
      waitFor(() => {
        expect(region.hasAttribute("data-mw-native")).toBe(is);
        expect(gridOf(host).textContent!.includes("Native text")).toBe(!is);
        const style = getComputedStyle(text);
        expect(style.webkitTextFillColor === style.color).toBe(is);
      });
    await native(true);
    region.classList.remove("mw-native");
    await native(false);
    region.classList.add("mw-native");
    await native(true);
  },
};
