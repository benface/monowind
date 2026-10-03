import { html, nothing } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import card from "./assets/card.png";
import sunset from "./assets/sunset.png";
import sweep from "./assets/sweep.gif";
import {
  cellSize,
  copyText,
  frames,
  paintedBackground,
  pressAt,
  readyHost,
  readyHosts,
  release,
  testHooks,
  textWith,
} from "./helpers.ts";

const meta: Meta = {
  title: "Features / Images",
};
export default meta;

/** Served by a local server, which answers to a second name: another
 * origin for the cross-origin pictures. */
const served = ["localhost", "127.0.0.1"].includes(location.hostname);

/** A picture's URL from the local server's other name, another origin,
 * which shares a file asked for `?shared`. */
function otherOrigin(asset: string, shared = false): string {
  const url = new URL(asset, location.href);
  url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
  if (shared) url.searchParams.set("shared", "");
  return url.href;
}

/** The picture drawn for an image, and its pixel at a point of it, in
 * fractions of its width and height. */
function pictureOf(img: HTMLElement) {
  const box = img.getBoundingClientRect();
  const host = img.closest("mono-wind")!;
  const canvas = Array.from(
    host.shadowRoot!.querySelectorAll<HTMLCanvasElement>("canvas.picture"),
  ).find((each) => {
    const rect = each.getBoundingClientRect();
    return Math.abs(rect.left - box.left) < 1 && Math.abs(rect.top - box.top) < 1;
  });
  const pixel = (x: number, y: number): number[] => {
    const context = canvas!.getContext("2d")!;
    const at = context.getImageData(
      Math.floor(x * canvas!.width),
      Math.floor(y * canvas!.height),
      1,
      1,
    );
    return Array.from(at.data);
  };
  return { canvas, pixel };
}

/** Each image's picture drawn, a wait of its own each. */
async function drawn(...images: HTMLElement[]): Promise<void> {
  for (const image of images) {
    await waitFor(() => expect(pictureOf(image).canvas, image.dataset.test).toBeDefined());
  }
}

/**
 * Images (specs/images.md): each a box of whole cells, its picture
 * sampled at a column by two rows of pixels per cell — a block one at
 * its set width, its height from its ratio; one inline in a sentence;
 * `object-cover` and `object-contain` in a box of set size — and a
 * caption positioned over one covering its cells.
 */
export const Images: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-100 p-1">
        <p>A picture on the grid:</p>
        <figure class="relative mt-1 w-60">
          <img data-test="sunset" src=${sunset} alt="A sunset over hills and water" class="w-60" />
          <figcaption class="absolute bottom-0 left-0 bg-black px-1 text-white">Sunset</figcaption>
        </figure>
        <p class="mt-1">
          Inline, <img data-test="inline" src=${card} alt="a test card" class="inline w-8" /> in a
          sentence.
        </p>
        <div class="mt-1 flex gap-2">
          <img data-test="cover" src=${sunset} alt="Covered" class="size-16 object-cover" />
          <img data-test="contain" src=${sunset} alt="Contained" class="size-16 object-contain" />
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    await drawn(by("sunset"), by("inline"), by("cover"), by("contain"));
    const { canvas, pixel } = pictureOf(by("sunset"));
    // 60 columns, and two pixels a row for a 320 × 200 picture.
    expect(canvas!.width).toBe(60);
    expect(canvas!.height % 2).toBe(0);
    expect(pixel(0.5, 0.2)[3]).toBe(255);
    // The <img> and its alt speak for the picture.
    expect(canvas!.getAttribute("aria-hidden")).toBe("true");
    // The caption covers its cells: the picture is cleared under them.
    expect(pixel(0.02, 0.98)[3]).toBe(0);
    // Contained, the picture leaves the box's top and bottom bare.
    expect(pictureOf(by("contain")).pixel(0.5, 0.02)[3]).toBe(0);
    expect(pictureOf(by("cover")).pixel(0.5, 0.02)[3]).toBe(255);
  },
};

/**
 * Images where layers are (specs/images.md "Paint"): one in a scroller,
 * cut at its edge; one in a rotated card, turned with it; one faded,
 * its picture taking its opacity.
 */
export const ImagesInLayers: StoryObj = {
  name: "Images in Layers",
  render: () => html`
    <mono-wind>
      <div class="flex items-start gap-4 p-2">
        <div class="h-8 w-30 overflow-y-auto border">
          <img data-test="scrolled" src=${sunset} alt="In a scroller" class="w-28" />
        </div>
        <div class="rotate-3 border p-1">
          <img data-test="turned" src=${card} alt="In a rotated card" class="w-24" />
        </div>
        <img data-test="faded" src=${sunset} alt="Faded" class="w-24 opacity-50" />
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    await drawn(by("scrolled"), by("turned"), by("faded"));
    // Cut at the scroller's edge: the clip box around the picture's.
    const scrolled = pictureOf(by("scrolled")).canvas!;
    expect(scrolled.closest(".clip")).not.toBeNull();
    // Turned with its card: its layer is inside the card's.
    const turned = pictureOf(by("turned")).canvas!;
    expect(turned.parentElement!.parentElement!.closest(".layer")).not.toBeNull();
    // Faded: its box takes the image's opacity.
    expect(pictureOf(by("faded")).canvas!.parentElement!.style.opacity).toBe("0.5");
  },
};

/**
 * An image that fails draws its `alt` as text, as browsers do; one from
 * another origin, whose pixels the page may not read, draws at the
 * grid's resolution in full color; one its server shares over CORS,
 * loaded without `crossorigin`, takes its colors as any image does —
 * posterized here; those two where a local server answers to a second
 * name (specs/images.md "Paint").
 */
export const ImageStates: StoryObj = {
  name: "Image States",
  render: () => {
    const foreign = html`
      <img
        data-test="foreign"
        src=${otherOrigin(sunset)}
        alt="From another origin"
        class="mt-1 w-40"
      />
      <img
        data-test="shared"
        src=${otherOrigin(sunset, true)}
        alt="Shared from another origin"
        class="mt-1 w-40 image-posterize-2"
      />
    `;
    return html`
      <mono-wind>
        <div class="p-1">
          <p>
            Broken:
            <img src="missing.png" alt="[a missing picture]" />
          </p>
          ${served ? foreign : nothing}
        </div>
      </mono-wind>
    `;
  },
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    await waitFor(() => expect(host.shadowRoot!.textContent).toContain("[a missing picture]"));
    if (!served) return;
    await drawn(by("foreign"));
    const foreign = pictureOf(by("foreign"));
    expect(foreign.canvas!.width).toBe(40);
    // Drawn by the browser from pixels the page may not read: its
    // canvas is the origin's too.
    expect(() => foreign.pixel(0.5, 0.5)).toThrow();
    // Read from its bytes: two levels a channel.
    await waitFor(() => {
      const colors = colorsOf(pictureOf(by("shared")).canvas!);
      expect(
        [...colors].every((color) => /^#(?:00|ff){3}$/.test(color)),
        [...colors].join(),
      ).toBe(true);
    });
  },
};

/**
 * An image's `width` and `height` attributes at its natural size reach
 * the engine as the px they map to, on the spacing scale as its natural
 * size is: the same box as without them (specs/images.md "Sizing").
 */
export const ImageAttributes: StoryObj = {
  name: "Image Attributes",
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <img data-test="bare" src=${card} alt="Bare" />
      <img data-test="sized" src=${card} alt="Sized" />
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const bare = by("bare") as HTMLImageElement;
    const sized = by("sized") as HTMLImageElement;
    await waitFor(() => expect(bare.naturalWidth).toBeGreaterThan(0));
    sized.width = bare.naturalWidth;
    sized.height = bare.naturalHeight;
    const size = (img: HTMLElement) => {
      const { width, height } = img.getBoundingClientRect();
      return [width, height];
    };
    await waitFor(() => expect(size(sized)).toEqual(size(bare)));
  },
};

/**
 * A picture read from its bytes (another origin's, shared) whose box
 * grows past what it was read for is read again: as fine as one read at
 * that size from the start.
 */
export const ImageGrown: StoryObj = {
  name: "Image Grown",
  tags: ["!dev", "!golden"],
  render: () => {
    const shared = otherOrigin(sunset, true);
    return html`
      <mono-wind>
        <img data-test="grown" src=${shared} alt="Grown" class="w-8" />
        <img data-test="sized" src=${shared} alt="Sized" class="w-40" />
      </mono-wind>
    `;
  },
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const read = (name: string) => {
      const { canvas } = pictureOf(by(name));
      return canvas && canvas.width > 0 ? pixelsOf(canvas) : null;
    };
    await waitFor(() => expect(read("grown")).not.toBeNull());
    await waitFor(() => expect(read("sized")).not.toBeNull());
    by("grown").className = "w-40";
    await waitFor(() => expect(read("grown")).toEqual(read("sized")));
  },
};

/** The story's `card` drawn, a point of its picture, and waits on the
 * point inverted and restored. */
async function cardOf(canvasElement: HTMLElement) {
  const host = await readyHost(canvasElement);
  const by = testHooks(canvasElement);
  await drawn(by("card"));
  const at = () => pictureOf(by("card")).pixel(0.3, 0.4);
  const before = at();
  const selected = () => waitFor(() => expect(inverted(before, at()), at().join()).toBe(true));
  const restored = () => waitFor(() => expect(at()).toEqual(before));
  return { host, by, at, before, selected, restored };
}

/** A selection from the start of `from` to the end of `to`, in `root`. */
function select(root: Node, from: string, to: string): void {
  const start = textWith(root, from);
  const end = textWith(root, to);
  document
    .getSelection()!
    .setBaseAndExtent(start, start.data.indexOf(from), end, end.data.indexOf(to) + to.length);
}

/** The text point at a cell of a grid of one character a cell. */
function gridPoint(grid: HTMLElement, row: number, col: number): [Text, number] {
  const walker = document.createTreeWalker(grid, NodeFilter.SHOW_TEXT);
  let [y, x] = [0, 0];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let i = 0; i < node.data.length; i++) {
      if (y === row && x === col) return [node, i];
      if (node.data[i] === "\n") [y, x] = [y + 1, 0];
      else x++;
    }
  }
  throw new Error(`no cell at ${row}, ${col}`);
}

/** Whether `after` is `before`'s color inverted, its alpha kept. */
const inverted = (before: number[], after: number[]) =>
  after.every((value, i) => (i === 3 ? value === before[3] : value === 255 - before[i]!));

/** A grid selection over an image inverts the picture's cells it spans,
 * as selected text shows (specs/images.md "Paint"). */
export const ImageSelectedOnGrid: StoryObj = {
  name: "Image Selected on Grid",
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <p>above</p>
      <img data-test="card" src=${card} alt="A test card" class="w-24" />
      <p>below</p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by, at, before, selected, restored } = await cardOf(canvasElement);
    // The picture's layer holds no text a drag could end in: the drag
    // over it selects the grid's beneath.
    expect(pictureOf(by("card")).canvas!.parentElement!.textContent).toBe("");
    const grid = host.shadowRoot!.getElementById("grid")!;
    select(grid, "above", "below");
    await selected();
    // A paint rebuilding the rows the selection ends in, read before
    // its selectionchange: the picture still selected.
    const painted = new Promise<number[]>((resolve) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve(at());
      });
      observer.observe(grid, { childList: true, subtree: true, characterData: true });
    });
    host.querySelector("p:last-of-type")!.textContent = "below!";
    expect(inverted(before, await painted)).toBe(true);
    document.getSelection()!.removeAllRanges();
    await restored();
    // The picture's first row is the grid's second, under "above".
    const { canvas } = pictureOf(by("card"));
    const pixel = (x: number, row: number) =>
      Array.from(canvas!.getContext("2d")!.getImageData(x, row * 2, 1, 1).data);
    const cells = [pixel(4, 1), pixel(4, 2), pixel(16, 2), pixel(4, 3)];
    const [node, offset] = gridPoint(grid, 3, 12);
    const end = textWith(grid, "below");
    document.getSelection()!.setBaseAndExtent(node, offset, end, end.data.length);
    await waitFor(() => {
      const now = [pixel(4, 1), pixel(4, 2), pixel(16, 2), pixel(4, 3)];
      expect(now.slice(0, 2)).toEqual(cells.slice(0, 2));
      expect(inverted(cells[2]!, now[2]!), now[2]!.join()).toBe(true);
      expect(inverted(cells[3]!, now[3]!), now[3]!.join()).toBe(true);
    });
    // A select-all from inside the grid holds its viewport whole, across
    // its grids: the picture inverted with the rest.
    const viewport = host.shadowRoot!.getElementById("viewport")!;
    document.getSelection()!.setBaseAndExtent(viewport, 0, viewport, viewport.childNodes.length);
    await selected();
    document.getSelection()!.removeAllRanges();
  },
};

/** A text selection through an image selects it whole, an atomic box,
 * its picture inverted as the grid paints the selection. */
export const ImageSelectedInText: StoryObj = {
  name: "Image Selected in Text",
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind select="text">
      <p>above</p>
      <img data-test="card" src=${card} alt="A test card" class="w-24" />
      <p>below</p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, at, before, selected, restored } = await cardOf(canvasElement);
    select(host, "above", "below");
    await selected();
    document.getSelection()!.removeAllRanges();
    await restored();
    // A selection reaching in from the page, a select-all's, paints the
    // host's part: its text swapped, its picture inverted.
    const ground = paintedBackground(host, "above");
    document.getSelection()!.selectAllChildren(document.body);
    await waitFor(() => {
      expect(inverted(before, at()), at().join()).toBe(true);
      expect(paintedBackground(host, "above")).not.toBe(ground);
    });
    document.getSelection()!.removeAllRanges();
  },
};

/**
 * Clicks on an image (specs/semantic-selection.md "An image is one
 * unit"): in grid mode a double-click selects its row of cells under
 * the pointer, a grid selection whose copy holds the alt, and in text
 * mode the image; a triple-click selects the image, copied as its alt
 * in text mode, as its content's cells in grid mode, the alt in them.
 */
export const ImageClicked: StoryObj = {
  name: "Image Clicked",
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <p>An <img data-test="inline" src=${card} alt="inline card" class="inline w-8" /> here.</p>
      <img data-test="block" src=${card} alt="a test card" class="w-24" />
      <img data-test="broken" src="missing.png" alt="gone" />
      <div data-test="clip" class="w-12 overflow-hidden">
        <img data-test="wide" src=${card} alt="a wide card" class="w-24 max-w-none" />
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const grid = host.shadowRoot!.getElementById("grid")!;
    await drawn(by("inline"), by("block"));
    // The broken image's alt drawn, once its load has failed.
    await waitFor(() => expect(grid.textContent).toContain("gone"));
    // The block's cells as a copy holds them: its alt on its first row,
    // padded to its width, its other rows blank.
    const cell = cellSize(host);
    const block = by("block").getBoundingClientRect();
    const columns = Math.round(block.width / cell.width);
    const blank = " ".repeat(columns);
    const rows = Array.from({ length: Math.round(block.height / cell.height) }, (_, i) =>
      i === 0 ? "a test card".padEnd(columns) : blank,
    );
    const selection = document.getSelection()!;
    for (const mode of ["text", "grid"]) {
      host.setAttribute("select", mode);
      await frames(2);
      // A press on an image's row, and its release, which the engine
      // owns: its mouse-up cancelled, whose default collapses a
      // selection the press landed in.
      const press = (name: string, detail: number, row: "first" | "middle" = "middle") => {
        const { left, top, width, height } = by(name).getBoundingClientRect();
        const y = row === "first" ? top + cell.height / 2 : top + height / 2;
        expect(pressAt(mode === "grid" ? grid : by(name), { x: left + width / 2, y }, detail)).toBe(
          false,
        );
        release();
        const up = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
        window.dispatchEvent(up);
        expect(up.defaultPrevented, `${mode} ${name} ${detail}`).toBe(true);
      };
      press("block", 2, "first");
      if (mode === "grid") {
        // A row of its cells, which the grid draws blank and its copy
        // holds the alt in.
        expect(selection.containsNode(by("block")), mode).toBe(false);
        expect(selection.toString(), mode).toBe(blank);
        expect(copyText(host), mode).toBe(rows[0]);
      } else {
        expect(selection.containsNode(by("block")), mode).toBe(true);
      }
      // In grid mode an inline image's cells on its line's row: the
      // alt's first line in its 8 columns.
      press("inline", 3);
      expect(selection.containsNode(by("inline")), mode).toBe(true);
      expect(copyText(host), mode).toBe(mode === "grid" ? "inline  " : "inline card");
      press("block", 3);
      expect(selection.containsNode(by("block")), mode).toBe(true);
      // The light DOM's selection leaves the grid unselectable, whose own
      // highlight Chromium paints for a range on the host itself.
      const { userSelect, webkitUserSelect } = getComputedStyle(grid);
      if (mode === "grid") expect(userSelect || webkitUserSelect).toBe("none");
      expect(copyText(host), mode).toBe(mode === "grid" ? rows.join("\n") : "a test card");
      if (mode === "grid") {
        // A double-click inside the selected image: its row, kept past
        // the release.
        press("block", 2);
        expect(selection.toString(), mode).toBe(blank);
        // Shift extends an element selection, which a row of cells, the
        // grid's, can't: the row alone.
        press("block", 3);
        const block = by("block").getBoundingClientRect();
        pressAt(grid, { x: block.left + 1, y: block.top + cell.height / 2 }, 2, { shiftKey: true });
        release();
        expect(selection.toString(), mode).toBe(blank);
        // A row of an image its box clips: as far as the clip shows it.
        const wide = by("wide").getBoundingClientRect();
        pressAt(grid, { x: wide.left + cell.width / 2, y: wide.top + cell.height / 2 }, 2);
        release();
        const shown = Math.round(by("clip").getBoundingClientRect().width / cell.width);
        expect(selection.toString().length, mode).toBe(shown);
      }
      // A broken image, its alt drawn as text, selected whole too.
      press("broken", 3);
      expect(selection.containsNode(by("broken")), mode).toBe(true);
      expect(copyText(host), mode).toBe("gone");
      selection.removeAllRanges();
    }
  },
};

/**
 * A grid selection over an image copies its cells with its alt in them,
 * as wide as the image, the text beside aligned — though the grid draws
 * no alt, an `object-contain` picture's bare bands showing blanks even
 * under the selection (specs/images.md "The light DOM").
 */
export const ImageCopiedOnGrid: StoryObj = {
  name: "Image Copied on Grid",
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <p>above</p>
      <div class="flex gap-1">
        <img data-test="contained" src=${sunset} alt="a sunset" class="size-16 object-contain" />
        <p>beside</p>
      </div>
      <p>below</p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    await drawn(by("contained"));
    const grid = host.shadowRoot!.getElementById("grid")!;
    select(grid, "above", "below");
    await frames(2);
    expect(grid.textContent).not.toContain("a sunset");
    const copied = copyText(host).split("\n");
    // The picture's first row: its alt, padded to its 16 columns, then
    // the text beside it.
    expect(copied[1]!.trimEnd()).toBe(`${"a sunset".padEnd(16)} beside`);
    expect(copied.at(-1)).toBe("below");
    document.getSelection()!.removeAllRanges();
  },
};

/**
 * A selection reaching into a host — a select-all, or a drag in from
 * the page's text — copies its part as it copies it, its images as its
 * mode does, the page's text around it and another host's part as that
 * host copies it (specs/semantic-selection.md "Copy serialization").
 */
export const HostCopiedWhole: StoryObj = {
  name: "Host Copied Whole",
  tags: ["!dev", "!golden"],
  render: () => html`
    <div data-test="page">
      <p>before</p>
      <mono-wind>
        <p>An <img data-test="inline" src=${card} alt="inline card" class="inline w-8" /> here.</p>
        <img data-test="block" src=${card} alt="a test card" class="w-24" />
        <p class="translate-x-1">in a layer</p>
      </mono-wind>
      <p>after</p>
      <mono-wind select="grid">
        <p>second</p>
        <img data-test="second" src=${card} alt="another card" class="w-24" />
      </mono-wind>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    await drawn(by("inline"), by("block"), by("second"));
    for (const mode of ["text", "grid"]) {
      host.setAttribute("select", mode);
      await frames(2);
      document.getSelection()!.selectAllChildren(by("page"));
      // A select-all's copy fires on the page, not in the host.
      const copied = copyText(document.body);
      expect(copied.startsWith("before\n"), `${mode}: ${copied}`).toBe(true);
      // Another host's part as it copies it, its alt in its cells, its
      // hidden metrics probe left out.
      expect(copied, mode).toMatch(/\nafter\nsecond *\n+another card/);
      expect(copied, mode).not.toContain("MMMM");
      expect(copied, mode).toContain(
        mode === "grid" ? "An inline   here." : "An inline card here.",
      );
      expect(copied, mode).toContain("a test card");
      expect(copied, mode).toContain("in a layer");
      document.getSelection()!.removeAllRanges();
    }
    // A selection reaching in from the page's text copies the host's
    // part up to its end, the page's text before.
    host.setAttribute("select", "text");
    await frames(2);
    const into = by("inline").nextSibling!;
    document.getSelection()!.setBaseAndExtent(textWith(by("page"), "before"), 0, into, 0);
    expect(copyText(document.body)).toBe("before\nAn inline card");
    document.getSelection()!.removeAllRanges();
    // A select-all in grid mode stays in the host's shadow, its grid
    // whole: the grid's rows, the alt in the image's cells.
    host.setAttribute("select", "grid");
    await frames(2);
    const viewport = host.shadowRoot!.getElementById("viewport")!;
    document.getSelection()!.setBaseAndExtent(viewport, 0, viewport, viewport.childNodes.length);
    const copied = copyText(document.body);
    expect(copied).toContain("a test card");
    expect(copied).toContain("in a layer");
    document.getSelection()!.removeAllRanges();
  },
};

/**
 * A selection the engine paints without hearing of it — Firefox fires
 * one `selectionchange` for a selection and its removal together, a
 * paint between them — is painted away when it goes: here its
 * `selectionchange` swallowed before the host hears it, and a restyle
 * painting it.
 */
export const ImageSelectionUnheard: StoryObj = {
  name: "Image Selection Unheard",
  tags: ["!dev", "!golden"],
  render: ImageSelectedInText.render!,
  play: async ({ canvasElement }) => {
    const { host, by, selected, restored } = await cardOf(canvasElement);
    const swallow = (event: Event) => event.stopImmediatePropagation();
    window.addEventListener("selectionchange", swallow, true);
    select(host, "above", "below");
    by("card").classList.add("restyled");
    await selected();
    window.removeEventListener("selectionchange", swallow, true);
    document.getSelection()!.removeAllRanges();
    await restored();
  },
};

const THEMES = ["dos", "c64", "green-phosphor", "amber", "teletype"] as const;

/** Every pixel of a picture, opaque ones alone, as `#rrggbb`. */
function colorsOf(canvas: HTMLCanvasElement): Set<string> {
  const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  const colors = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) continue;
    colors.add(
      `#${[data[i], data[i + 1], data[i + 2]].map((c) => c!.toString(16).padStart(2, "0")).join("")}`,
    );
  }
  return colors;
}

/**
 * Themes change what images look like (specs/images.md "Color"): the
 * same picture reduced to each theme's system palette with an ordered
 * dither — a monochrome theme's by lightness, in its phosphor's hue —
 * and, on a page with no theme, posterized and dithered each way.
 */
export const ImageColors: StoryObj = {
  name: "Image Colors",
  render: () => html`
    <div class="grid grid-cols-4 gap-2">
      ${THEMES.map(
        (theme) => html`
          <mono-wind class="theme-${theme} p-1">
            <img data-test=${theme} src=${sunset} alt=${theme} class="w-24" />
            <p>${theme}</p>
          </mono-wind>
        `,
      )}
      <mono-wind class="p-1">
        <img data-test="posterized" src=${card} alt="Posterized" class="w-24 image-posterize-3" />
        <p>3 levels, ordered</p>
      </mono-wind>
      <mono-wind class="p-1">
        <img
          data-test="diffused"
          src=${card}
          alt="Diffused"
          class="w-24 image-dither-diffusion image-posterize-2"
        />
        <p>2 levels, diffused</p>
      </mono-wind>
      <mono-wind class="p-1">
        <img
          data-test="undithered"
          src=${card}
          alt="Undithered"
          class="w-24 image-dither-none image-posterize-3"
        />
        <p>3 levels, undithered</p>
      </mono-wind>
    </div>
  `,
  play: async ({ canvasElement }) => {
    await readyHosts(canvasElement);
    const by = testHooks(canvasElement);
    const picture = (name: string) => pictureOf(by(name));
    await drawn(...[...THEMES, "posterized", "diffused", "undithered"].map(by));
    const vga = [
      "#000000",
      "#0000aa",
      "#00aa00",
      "#00aaaa",
      "#aa0000",
      "#aa00aa",
      "#aa5500",
      "#aaaaaa",
      "#555555",
      "#5555ff",
      "#55ff55",
      "#55ffff",
      "#ff5555",
      "#ff55ff",
      "#ffff55",
      "#ffffff",
    ];
    for (const color of colorsOf(picture("dos").canvas!)) expect(vga, color).toContain(color);
    const green = ["#000000", "#003b00", "#00711d", "#00a83c", "#0adb53", "#66ff84", "#c4ffd1"];
    for (const color of colorsOf(picture("green-phosphor").canvas!))
      expect(green, color).toContain(color);
    // Three levels a channel: 0, 128 and 255.
    for (const color of colorsOf(picture("posterized").canvas!)) {
      expect(
        color.match(/[0-9a-f]{2}/g)!.every((c) => ["00", "80", "ff"].includes(c)),
        color,
      ).toBe(true);
    }
  },
};

/** The quarter of the sweep its bar is in: the frame showing. */
function barOf({ pixel }: ReturnType<typeof pictureOf>): number {
  return [0, 1, 2, 3].findIndex((quarter) => pixel(quarter / 4 + 1 / 8, 0.5)[0] !== 16);
}

/** The sweep running into its second pass, its frames decoded again:
 * its bar seen moving five times. */
async function expectSweeping(host: HTMLElement, img: HTMLElement): Promise<void> {
  const bars = [barOf(pictureOf(img))];
  await waitFor(() => {
    const bar = barOf(pictureOf(img));
    if (bar !== bars.at(-1)) bars.push(bar);
    expect(bars.length).toBeGreaterThan(5);
  });
}

/**
 * An animated image (specs/images.md "Paint"): its frames decoded and
 * drawn on the grid at their own times — a bar sweeping across, a
 * quarter of the way a frame.
 */
export const AnimatedImage: StoryObj = {
  name: "Animated Image",
  tags: ["!golden"],
  render: () => html`
    <mono-wind>
      <div class="p-1">
        <img data-test="sweep" src=${sweep} alt="A bar sweeping across" class="w-32" />
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    await drawn(by("sweep"));
    await expectSweeping(host, by("sweep"));
  },
};

/** Every pixel of a canvas. */
const pixelsOf = (canvas: HTMLCanvasElement): number[] =>
  Array.from(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data);

/** What `read` gives every 25 ms for half a second, past four frames'
 * time: one reading where nothing moves. */
async function readingsOf(read: () => unknown): Promise<Set<string>> {
  const readings = new Set<string>();
  for (let elapsed = 0; elapsed < 500; elapsed += 25) {
    readings.add(JSON.stringify(read()));
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return readings;
}

/**
 * The frames hold where no one sees them and run again once seen: its
 * host hidden, then out of the document; its image removed, its canvas,
 * out of the grid, draws no more.
 */
export const AnimatedImageStopped: StoryObj = {
  name: "Animated Image Stopped",
  tags: ["!dev", "!golden"],
  render: AnimatedImage.render!,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    await drawn(by("sweep"));
    const held = async (canvas: HTMLCanvasElement) =>
      expect((await readingsOf(() => pixelsOf(canvas))).size).toBe(1);
    let { canvas } = pictureOf(by("sweep"));
    host.style.display = "none";
    // A frame decoding as it hides lands first, within a frame's time.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await held(canvas!);
    host.style.display = "";
    await expectSweeping(host, by("sweep"));
    ({ canvas } = pictureOf(by("sweep")));
    const parent = host.parentNode!;
    host.remove();
    await held(canvas!);
    parent.appendChild(host);
    await expectSweeping(host, by("sweep"));
    ({ canvas } = pictureOf(by("sweep")));
    by("sweep").remove();
    await waitFor(() => expect(canvas!.isConnected).toBe(false));
    await held(canvas!);
  },
};

/** The page's `prefers-reduced-motion`, stood in for: no engine sets it
 * from a page. */
const reducedMotion = Object.assign(new EventTarget(), {
  media: "(prefers-reduced-motion: reduce)",
  matches: true,
});

/** Under `prefers-reduced-motion`, the first frame alone; the sweep
 * starts once it lifts. */
export const AnimatedImageReducedMotion: StoryObj = {
  name: "Animated Image Reduced Motion",
  tags: ["!dev", "!golden"],
  render: AnimatedImage.render!,
  beforeEach: () => {
    const matchMedia = window.matchMedia;
    reducedMotion.matches = true;
    window.matchMedia = (query) =>
      query === reducedMotion.media
        ? (reducedMotion as unknown as MediaQueryList)
        : matchMedia.call(window, query);
    return () => {
      window.matchMedia = matchMedia;
    };
  },
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    await drawn(by("sweep"));
    expect(await readingsOf(() => barOf(pictureOf(by("sweep"))))).toEqual(new Set(["0"]));
    reducedMotion.matches = false;
    reducedMotion.dispatchEvent(new Event("change"));
    await expectSweeping(host, by("sweep"));
  },
};
