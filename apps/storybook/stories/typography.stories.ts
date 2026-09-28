import { html } from "lit";
import { expect } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import {
  besideNative,
  cellOffset,
  cellSize,
  channels,
  expectBrowserLineBreaksToMatchEngine,
  expectBrowserRowsToMatchEngine,
  expectGridOnItsCells,
  expectLinesAsNative,
  expectWordsAsNative,
  frames,
  gridOf,
  isFirefox,
  paintedSpan,
  readyGrid,
  readyHost,
  readyHosts,
  rowsOf,
  testHooks,
  type Engine,
  type NativeCase,
  type Unit,
} from "./helpers.ts";

const meta: Meta = {
  title: "Features / Typography",
};
export default meta;

export const Wrapping: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-40 border border-neutral-500 px-1">
        This text wraps at word boundaries when it runs out of columns, and breaks long words at
        cell boundaries. Try resizing the window to see how it behaves.
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    await expectBrowserLineBreaksToMatchEngine(canvasElement);
  },
};

// Hyphen-run break torture cases (specs/cell-model.md): a word-initial
// run glues to what follows (UAX #14 LB20a), every other run breaks
// after — digits included. Each box is exactly wide enough to force the
// wrap whose break position the play asserts per character. Test-only:
// in Firefox (breaks BEFORE hyphens, documented divergence) the
// hyphenated leaves are skipped and may visually overflow their boxes.
export const HyphenBreaks: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="flex flex-wrap items-start gap-2">
        <div class="w-5">-top-1</div>
        <div class="w-6">2026-08</div>
        <div class="w-6">mx-auto</div>
        <div class="w-6">well--known</div>
        <div class="w-4">a-1b-2</div>
        <div class="w-3">x--y</div>
        <div class="w-4">-5 plus</div>
        <div class="w-4">e-mail</div>
        <div class="w-2">${"a\u00a0b"}</div>
        <div class="w-min">-top-1</div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserLineBreaksToMatchEngine(canvasElement);
    // Line counts too (min-content drift shows up as box height, not
    // break position) — except Firefox, where its earlier hyphen breaks
    // can produce a different count ("well--known" needs 3 lines).
    if (!isFirefox) await expectBrowserRowsToMatchEngine(canvasElement);
  },
};

export const Truncating: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex max-w-40 flex-col gap-1">
        <div class="truncate border border-neutral-500 px-1">
          This text gets truncated when it is wider than the available width.
        </div>
        <div data-test="clamp" class="line-clamp-2 border border-neutral-500 px-1">
          This one wraps, and its lines past the clamp are cut, the last one kept ending in an
          ellipsis.
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { by, cells, measure } = await readyGrid(canvasElement);
    const clamp = by("clamp");
    // Two rows between its borders, the second ending in the ellipsis.
    expect(cells(clamp, "--mw-h") - cells(clamp, "--mw-bt") - cells(clamp, "--mw-bb")).toBe(2);
    const { rows, boxOf } = measure();
    expect(rows[boxOf(clamp).row + 2]!.trimEnd()).toMatch(/… │$/);
  },
};

export const HardBreaks: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="border border-neutral-500 px-1">
        first line<br />second line<br /><br />after a blank line
      </div>
    </mono-wind>
  `,
};

// Interpolated so no formatter ever reflows the whitespace-sensitive
// content (tabs and newlines included).
const indentedMarkup =
  "<mono-wind>\n  spaces   survive\n    and so does\n      indentation\n</mono-wind>";
const tabbedColumns = "name\tqty\nfoobar\t1\nbuzz\t12\ntabs land on tab stops";

export const Preformatted: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <pre class="border border-neutral-500 px-1">${indentedMarkup}</pre>
        <div class="border border-emerald-400 px-1 whitespace-pre">${tabbedColumns}</div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

export const InlineElements: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-48 border border-neutral-500 px-3 py-1">
        Inline elements like <b class="text-yellow-400">bold/strong text</b>,
        <i class="text-cyan-400">italics/emphasized text</i>, and
        <a href="https://benface.com" target="_blank" class="text-blue-400 underline">links</a> ride
        along in the text run. Atomic boxes too: an inline-block
        <span class="inline-block border border-fuchsia-400 px-1" data-test="block">boxed</span>
        pinned to its line's top, a middle-aligned
        <button class="border px-1 align-middle" data-test="middle">button</button>, as well as a
        bottom-aligned inline table with
        <table class="inline-table align-bottom" data-test="inline-table">
          <tbody>
            <tr>
              <td class="border px-1">two</td>
              <td class="border px-1">cells</td>
            </tr>
          </tbody>
        </table>
        that drops the text to its last row.
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement, { allowStretchedLeaves: true });
    // Both atomic boxes ride the run in flow.
    const block = canvasElement.querySelector<HTMLElement>('[data-test="block"]')!;
    const inlineTable = canvasElement.querySelector<HTMLElement>('[data-test="inline-table"]')!;
    expect(block.hasAttribute("data-mw-inline-box")).toBe(true);
    expect(inlineTable.hasAttribute("data-mw-inline-box")).toBe(true);
    expect(Number(inlineTable.style.getPropertyValue("--mw-h"))).toBe(3);
    // align-bottom passes through to the browser (grid-exact, probed) —
    // the plain box stays top-pinned, the align-bottom one drops.
    expect(block.hasAttribute("data-mw-vbottom")).toBe(false);
    expect(inlineTable.hasAttribute("data-mw-vbottom")).toBe(true);
    // align-middle is a whole-row baseline length the engine writes, the
    // browser's text on the button's middle row (checked above against
    // the engine's rows).
    const middle = canvasElement.querySelector<HTMLElement>('[data-test="middle"]')!;
    expect(middle.hasAttribute("data-mw-vmiddle")).toBe(true);
    expect(middle.style.getPropertyValue("--mw-va")).toBe("0");
  },
};

/** Test-only: a border on an inline element draws nothing (specs/cell-model.md,
 * deviation 5): the grid has no glyphs for it, and the browser's own is
 * zeroed, so the line's native text stays under its glyphs. */
export const InlineBorder: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <p>
        a <span class="border px-1" data-test="bordered">word</span> <b data-test="after">in</b> a
        line
      </p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const style = getComputedStyle(by("bordered"));
    expect([style.borderTopWidth, style.borderLeftWidth]).toEqual(["0px", "0px"]);
    expect(gridOf(host).textContent).toContain("a  word  in a line");
    // The word after it sits on the cell the grid draws it on: "a ",
    // the padded word, and a space before it.
    const { width } = cellSize(host);
    const after =
      by("after").getBoundingClientRect().left - gridOf(host).getBoundingClientRect().left;
    expect(Math.abs(after - 9 * width)).toBeLessThan(0.5);
  },
};

/** Test-only: an inline element's padding is its own (specs/cell-model.md
 * "Inline content"): a span inside a padded one takes none, so its light box,
 * and the text after it, sit on the cells the grid draws them on. */
export const NestedInlinePadding: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <p>
        a <span class="bg-red-500 px-2">b<span data-test="inner">c</span></span>
        <b data-test="after">d</b>
      </p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    expect(gridOf(host).textContent).toContain("a   bc   d");
    const { width } = cellSize(host);
    const left = gridOf(host).getBoundingClientRect().left;
    // "a ", two padding cells and "b" before "c", its one cell alone.
    const inner = by("inner").getBoundingClientRect();
    expect(Math.abs(inner.left - left - 5 * width)).toBeLessThan(0.5);
    expect(Math.abs(inner.width - width)).toBeLessThan(0.5);
    expect(Math.abs(by("after").getBoundingClientRect().left - left - 9 * width)).toBeLessThan(0.5);
  },
};

/** Test-only: an element's glyph properties (types.ts
 * `GLYPH_PROPERTIES`) reach its glyphs on the grid, which inherits the
 * host's: an upright span in a bold italic host stays upright, and a
 * fraction form, which would merge glyphs, stays off. */
export const GlyphProperties: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind class="font-bold italic antialiased">
      <p>host <span class="font-normal not-italic subpixel-antialiased">upright</span></p>
    </mono-wind>
    <mono-wind>
      <p>plain <span class="font-bold italic antialiased">styled</span></p>
      <p>
        <span class="slashed-zero underline underline-offset-4 text-shadow-md">0 zero</span>
        <span class="diagonal-fractions">1/2</span>
      </p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const [styledHost, plainHost] = await readyHosts(canvasElement);
    /** The painted glyphs' weight, style and smoothing. */
    const font = (host: HTMLElement, text: string) => {
      const style = getComputedStyle(paintedSpan(host, text)!);
      const smoothing = style.getPropertyValue("-webkit-font-smoothing");
      // Firefox's alias reads its own `grayscale`.
      return `${style.fontWeight} ${style.fontStyle} ${smoothing === "grayscale" ? "antialiased" : smoothing}`;
    };
    expect(font(styledHost!, "host")).toBe("700 italic antialiased");
    expect(font(styledHost!, "upright")).toBe("400 normal auto");
    expect(font(plainHost!, "plain")).toBe("400 normal auto");
    expect(font(plainHost!, "styled")).toBe("700 italic antialiased");
    const zero = getComputedStyle(paintedSpan(plainHost!, "zero")!);
    expect(zero.fontVariantNumeric).toBe("slashed-zero");
    expect(zero.textShadow).not.toBe("none");
    expect(zero.textUnderlineOffset).toBe("4px");
    expect(getComputedStyle(paintedSpan(plainHost!, "1/2")!).fontVariantNumeric).toBe("normal");
  },
};

/** Text decorations (specs/cell-model.md "Typography") drawn as their
 * boxes draw them: their style, color and thickness, and a propagated
 * line in its decorating box's color. */
export const Decorations: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <p class="underline decoration-rose-400 decoration-wavy">
          a wavy <span data-test="rose" class="text-rose-400">rose</span> line
        </p>
        <p class="underline decoration-2 underline-offset-4">a thick one, offset</p>
        <p data-test="amber" class="text-amber-300 underline decoration-dotted">
          dotted, <span data-test="cyan" class="text-cyan-300">amber under cyan</span>
        </p>
        <p class="line-through decoration-cyan-300 decoration-double">a double strike</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const drawn = (text: string) => getComputedStyle(paintedSpan(host, text)!);
    expect(drawn("wavy").textDecorationStyle).toBe("wavy");
    expect(channels(drawn("wavy").textDecorationColor)).toEqual(
      channels(getComputedStyle(by("rose")).color),
    );
    expect(drawn("thick").textDecorationThickness).toBe("2px");
    expect(drawn("thick").textUnderlineOffset).toBe("4px");
    expect(drawn("under cyan").textDecorationStyle).toBe("dotted");
    expect(channels(drawn("under cyan").textDecorationColor)).toEqual(
      channels(getComputedStyle(by("amber")).color),
    );
    expect(drawn("strike").textDecorationLine).toBe("line-through");
    expect(drawn("strike").textDecorationStyle).toBe("double");
    expect(channels(drawn("strike").textDecorationColor)).toEqual(
      channels(getComputedStyle(by("cyan")).color),
    );
  },
};

/** Test-only: text in the case `text-transform` puts it in, wrapped
 * where the browser wraps it (`ß` is two cells as `SS`). */
export const TextTransform: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <p class="uppercase">straße <span class="normal-case">keeps</span> case</p>
      <p class="capitalize">hello-world don't <b>st</b>op</p>
      <p lang="tr" class="uppercase">istanbul</p>
      <p class="w-13 uppercase">straße straße straße</p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    expect(rowsOf(host).map((row) => row.trimEnd())).toEqual([
      "STRASSE keeps CASE",
      "Hello-World Don't Stop",
      "İSTANBUL",
      "STRASSE",
      "STRASSE",
      "STRASSE",
    ]);
    await expectBrowserRowsToMatchEngine(canvasElement);
  },
};

/** Test-only: tracked atomic inline boxes filling their line exactly,
 * which the browser keeps on one line as the grid does
 * (visual/agreement.spec.ts checks each on its cells in every engine). */
export const TrackedInlineBoxes: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="flex">
        <span data-test="line" class="border">
          <button class="tracking-[0.25rem]">ab</button>
          <button class="tracking-[0.25rem]">cd</button>
          <button class="tracking-[0.25rem]">ef</button>
        </span>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await readyHost(canvasElement);
    const tops = [...testHooks(canvasElement)("line").querySelectorAll("button")].map(
      (button) => button.getBoundingClientRect().top,
    );
    expect(new Set(tops).size, "one line").toBe(1);
  },
};

export const InlineDisplay: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="relative max-w-48 border border-neutral-500 px-3 py-1">
        <!-- The running text keeps a div of its own beside the block span:
             the row-agreement helper below checks laid-out leaves. -->
        <div>
          Inline-ness follows computed display: this text run contains
          <div class="inline">an inline div,</div>
          <div class="inline-flex flex-wrap">
            <div>an&nbsp;</div>
            <div>inline-flex&nbsp;</div>
            <div>div,</div>
          </div>
          a <span class="hidden">completely invisible</span> hidden span whose text never joins the
          flow, and an absolute span that leaves the flow to become the corner badge
          <span class="absolute -top-1 right-2 bg-clear px-1 text-yellow-500">* badge</span>
          instead of rendering here.
        </div>
        <span class="block text-cyan-400">Finally, this is a block span.</span>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    await expectBrowserRowsToMatchEngine(canvasElement);
    // The load-bearing agreement of atomic inline boxes: the BROWSER's own
    // line layout must place the in-flow box exactly where the ENGINE's
    // wrap model computed it (the engine writes its cells to --mw-x/y but
    // no CSS consumes them for inline boxes — the browser flows it).
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    const box = host.querySelector<HTMLElement>("[data-mw-inline-box]")!;
    const leaf = box.parentElement!;
    const engineX = Number(box.style.getPropertyValue("--mw-x")) * cellWidth;
    const engineY = Number(box.style.getPropertyValue("--mw-y")) * cellHeight;
    const boxRect = box.getBoundingClientRect();
    const leafRect = leaf.getBoundingClientRect();
    expect(boxRect.left - leafRect.left).toBeCloseTo(engineX, 0);
    expect(boxRect.top - leafRect.top).toBeCloseTo(engineY, 0);
    expect(boxRect.height).toBeCloseTo(
      Number(box.style.getPropertyValue("--mw-h")) * cellHeight,
      0,
    );
  },
};

/** An atomic inline box's margins join its line (specs/cell-model.md
 * "Atomic inline boxes"): the horizontal ones its advance, a negative
 * one overlapping the text before, the vertical ones its line's rows,
 * a bottom-aligned box's text on its margin box's last row. Each box,
 * and the word after it, where the browser puts them. */
export const InlineBoxMargins: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex max-w-80 flex-col gap-1">
        <p>one <span data-test="box" class="mx-2 inline-block border px-1">mx-2</span> alpha</p>
        <p>two <span data-test="box" class="-ml-1 inline-block border px-1">-ml-1</span> bravo</p>
        <p>three <span data-test="box" class="mt-1 inline-block border px-1">mt-1</span> charlie</p>
        <p>
          four <span data-test="box" class="mb-1 inline-block border px-1 align-bottom">mb-1</span>
          delta
        </p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const cell = cellSize(host);
    const grid = gridOf(host).getBoundingClientRect();
    // Each box's cells in its paragraph: past the words and its left
    // margin, down its top margin.
    const cells = [
      [6, 0],
      [3, 0],
      [6, 1],
      [5, 0],
    ];
    for (const [i, box] of host.querySelectorAll<HTMLElement>('[data-test="box"]').entries()) {
      const leaf = box.parentElement!.getBoundingClientRect();
      const rect = box.getBoundingClientRect();
      const at = (name: string) => Number(box.style.getPropertyValue(name));
      expect([at("--mw-x"), at("--mw-y")], box.textContent!).toEqual(cells[i]);
      expect(rect.left - leaf.left, box.textContent!).toBeCloseTo(at("--mw-x") * cell.width, 0);
      expect(rect.top - leaf.top, box.textContent!).toBeCloseTo(at("--mw-y") * cell.height, 0);
    }
    const rows = rowsOf(host);
    for (const word of ["alpha", "bravo", "charlie", "delta"]) {
      const row = rows.findIndex((line) => line.includes(word));
      const text = [...host.querySelectorAll("p")].find((p) => p.textContent!.includes(word))!;
      const node = text.lastChild!;
      const range = document.createRange();
      range.setStart(node, node.textContent!.indexOf(word));
      range.setEnd(node, node.textContent!.indexOf(word) + word.length);
      const native = range.getClientRects()[0]!;
      expect(Math.round((native.left - grid.left) / cell.width), word).toBe(
        rows[row]!.indexOf(word),
      );
      expect(Math.floor((native.top + native.height / 2 - grid.top) / cell.height), word).toBe(row);
    }
    // The bottom-aligned box's line text on its margin's row, two below
    // its label's.
    const delta = rows.findIndex((line) => line.includes("delta"));
    expect(delta - rows.findIndex((line) => line.includes("mb-1"))).toBe(2);
  },
};

/** Text indent (specs/cell-model.md "Text indent"), lengths in `u`: a
 * hanging one, a percentage, one an inline block's width counts, and a
 * mixed container's, its run after a block unindented. */
const indentCases = (u: Unit): string[] => [
  `<p style="text-indent:${u(-6)};padding-left:${u(12)};width:${u(26)}">a hanging indent over lines of words that wrap</p>`,
  `<p style="text-indent:10%;width:${u(30)}">a tenth of its width indents the first line only</p>`,
  `<div style="display:inline-block;text-indent:${u(12)}">abc</div> after`,
  `<div style="text-indent:${u(4)}">first<p>block</p>second</div>`,
];

export const TextIndent: StoryObj = {
  tags: ["!dev", "!golden"],
  ...besideNative(indentCases),
};

/** The wrapping `white-space` values (specs/cell-model.md "White-space
 * and truncation"), lengths in `u`: `pre-line`'s newlines break, the
 * spaces around them going, an inline element's newline too;
 * `pre-wrap` keeps its spaces, hanging those at a soft break, out of
 * the alignment too; `break-spaces` wraps its spaces as cells; a
 * nowrap box inside keeps its own. */
const whiteSpaceCases = (u: Unit): string[] => [
  `<p style="white-space:pre-line;width:${u(20)}">first line\n   second   line of words that wrap here\nthird</p>`,
  `<p style="white-space:pre-line;width:${u(20)}">one <b>two\nthree</b> four</p>`,
  `<p style="white-space:pre-wrap;width:${u(12)}">  two  spaces lead   and   these   wrap here</p>`,
  `<p style="white-space:pre-wrap;width:${u(12)};text-align:right">right  aligned text   </p>`,
  `<p style="white-space:break-spaces;width:${u(12)}">ab   cd      ef gh    ij</p>`,
  `<div style="display:flex"><p style="white-space:pre-wrap">trail   </p><p>next</p></div>`,
  `<div style="display:flex"><p style="white-space:break-spaces">tail   </p><p>after</p></div>`,
  `<div style="white-space:pre-wrap;width:${u(12)}">kept  spaces<div style="white-space:nowrap">a nowrap box inside</div></div>`,
];

/** A case's words where the browser puts them, the host's own light
 * text on the grid's rows. */
const wordsAndLightRows = async (host: HTMLElement, native: HTMLElement): Promise<void> => {
  expectWordsAsNative(host, native);
  await expectBrowserRowsToMatchEngine(host.parentElement!);
};

export const WhiteSpace: StoryObj = {
  tags: ["!dev", "!golden"],
  ...besideNative(whiteSpaceCases, wordsAndLightRows),
};

/** `text-wrap: balance` and `pretty` (specs/cell-model.md "White-space
 * and truncation"), lengths in `u`: a balanced heading, a balanced
 * paragraph of three lines, and a pretty paragraph whose last line
 * would hold one word. */
const wrapStyleCases = (u: Unit): NativeCase[] => [
  `<h2 style="text-wrap:balance;width:${u(30)}">a heading long enough to wrap onto two lines</h2>`,
  `<p style="text-wrap:balance;width:${u(24)}">balanced lines even out their lengths so that no line runs far past the others here</p>`,
  {
    markup: `<p style="text-wrap:pretty;width:${u(24)}">a pretty paragraph keeps its final line from one word</p>`,
    // Firefox wraps it greedily; WebKit re-breaks the whole paragraph.
    departs: ["firefox", "webkit"],
  },
];

export const WrapStyle: StoryObj = {
  tags: ["!dev", "!golden"],
  ...besideNative(wrapStyleCases, wordsAndLightRows),
};

/** Line breaking (specs/cell-model.md "Line breaking"), lengths in `u`:
 * `<wbr>`, a zero-width space, soft hyphens, dashes, Japanese with its
 * punctuation, kana beside `ー` and small kana, Korean, and `word-break`.
 * `cjk` marks the copies re-spaced to the grid's two cells a character,
 * which their fonts draw narrower. Chromium breaks before `ー` and small
 * kana. */
const lineBreaks: {
  width: number;
  text: string;
  style?: string;
  cjk?: true;
  departs?: Engine[];
}[] = [
  { width: 16, text: "super<wbr>califragilistic<wbr>expialidocious" },
  { width: 12, text: "longword&#8203;continues&#8203;here" },
  { width: 10, text: "hy&shy;phen&shy;a&shy;tion is hy&shy;phen&shy;at&shy;ed" },
  { width: 10, text: "one—two—three–four five" },
  {
    width: 16,
    text: "日本語の文章は、単語の間に空白がありません。",
    cjk: true,
  },
  { width: 7, text: "チャホーチャホー", cjk: true, departs: ["chromium"] },
  {
    width: 11,
    text: "한국어문장도음절사이에서",
    cjk: true,
  },
  { width: 12, text: "abc defghijklmnopq rst", style: "word-break:break-all" },
  {
    width: 12,
    text: "한국어 문장도 음절",
    style: "word-break:keep-all",
    cjk: true,
  },
];
const lineBreakCases = (u: Unit): NativeCase[] =>
  lineBreaks.map(({ width, text, style = "", departs }) => ({
    markup: `<p style="width:${u(width)};${style}">${text}</p>`,
    departs,
  }));

/** Each case's rows as the browser breaks them, a CJK copy spaced to
 * the grid's two cells a character by its first (its fallback font
 * draws them narrower), its spaces kept a cell. */
export const LineBreaks: StoryObj = {
  tags: ["!dev", "!golden"],
  ...besideNative(lineBreakCases, async (host, native, i) => {
    if (lineBreaks[i]!.cjk) {
      const probe = native.appendChild(document.createElement("span"));
      probe.textContent = native.textContent!.charAt(0);
      const advance = probe.getBoundingClientRect().width;
      probe.remove();
      const spacing = 2 * cellSize(host).width - advance;
      Object.assign(native.style, { letterSpacing: `${spacing}px`, wordSpacing: `${-spacing}px` });
      await frames(1);
    }
    expectLinesAsNative(host, native);
  }),
};

/** Line clamps (specs/cell-model.md "White-space and truncation"),
 * lengths in `u`, each clamp's paragraph before an `after` one: two
 * lines of three, three of four, and two of a text that fits them. */
const clamps = [2, 3, 2];
const clampCases = (u: Unit): string[] =>
  [
    "a paragraph long enough to wrap onto several lines under the clamp",
    "a paragraph long enough to wrap onto several lines under the clamp, and more",
    "short text",
  ].map(
    (text, i) =>
      `<p style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${clamps[i]};overflow:hidden;width:${u(24)}">${text}</p><p data-test="after">after</p>`,
  );

/** Each clamp's next paragraph where the browser puts it, and its last
 * kept line ending in `…` where the clamp cut it. */
export const LineClamp: StoryObj = {
  tags: ["!dev", "!golden"],
  ...besideNative(clampCases, (host, native, i) => {
    const row = Math.round(cellOffset(native, "after", cellSize(host)).y);
    const rows = rowsOf(host);
    expect(
      rows.findIndex((line) => line.includes("after")),
      `case ${i}`,
    ).toBe(row);
    expect(rows[row - 1]!.trimEnd().endsWith("…"), `case ${i}`).toBe(i < 2);
  }),
};

export const TextAlign: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <div class="border border-neutral-500 px-1 text-end">text-end lands on the grid</div>
        <div class="border border-neutral-500 px-1 text-center">
          text-center too — each line centers at a whole-cell offset
        </div>
        <div class="max-w-40 border border-neutral-500 px-1 text-justify">
          text-justify shares each line's leftover cells among its gaps
        </div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

/** Justified text (specs/cell-model.md "Text alignment"), lengths in
 * `u`: wrapping paragraphs, a line's leftover odd and in halves, one
 * with an inline block mid-line, and one broken hard, its line before
 * the break at the start. */
const justifyCases = (u: Unit): string[] =>
  (
    [
      [22, "each line but the last fills the width, its gaps sharing what is left"],
      [24, "each line but the last line"],
      [
        24,
        `a <span style="display:inline-block;width:${u(5)}">box</span> sits mid-line and moves with its gaps as the text does`,
      ],
      [22, "a line before<br>a hard break keeps to the start of its row"],
    ] as const
  ).map(([width, text]) => `<p style="text-align:justify;width:${u(width)}">${text}</p>`);

/** Each word on the browser's row, at the cell nearest its fractional
 * column — either neighbor at a half. */
export const Justify: StoryObj = {
  tags: ["!dev", "!golden"],
  ...besideNative(justifyCases, (host, native) => expectWordsAsNative(host, native, 0.1)),
};

export const Leading: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex items-start gap-2">
        <div class="max-w-30 border border-neutral-500 px-1 leading-normal">
          leading-normal: wrapped lines sit on consecutive rows, as usual.
        </div>
        <div class="max-w-30 border border-cyan-400 px-1 leading-loose">
          leading-loose: one empty row between every two wrapped lines.
        </div>
        <div class="max-w-30 border border-yellow-400 px-1 leading-[3]">
          leading-[3]: two empty rows between wrapped lines.
        </div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

export const Tracking: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col items-start gap-1">
        <div class="border border-neutral-500 px-1 tracking-normal">tracking-normal</div>
        <div class="border border-cyan-400 px-1 tracking-wide">tracking-wide</div>
        <div class="border border-yellow-400 px-1 tracking-wider">tracking-wider</div>
        <div class="border border-fuchsia-400 px-1 tracking-widest">tracking-widest</div>
        <div class="max-w-40 border border-emerald-400 px-1 tracking-wide">
          wrapped text with tracking-wide still breaks at word boundaries
        </div>
        <div class="border border-neutral-500 px-1">
          inline <span class="tracking-wide text-cyan-400">tracking-wide</span> and
          <span class="tracking-wider text-yellow-400">wider</span> spans in a run
        </div>
      </div>
    </mono-wind>
  `,
  play: ({ canvasElement }) => expectBrowserRowsToMatchEngine(canvasElement),
};

/**
 * Regression guard for the width headroom in styles.css: engines floor
 * lengths to a layout unit (1/64px), so `cells × cell-width` can land one
 * unit short of the shaped advance of a line that fits exactly, and the
 * browser wraps it. JetBrains Mono's 0.6em advance never trips this, so the
 * story uses a self-hosted DejaVu Sans Mono subset (1233/2048em — Menlo's
 * metrics), which does at several widths; the play sweeps the host width
 * so every line hits an exact fit at some column count.
 */
export const SubpixelHeadroom: StoryObj = {
  // Test-only: hidden from the Storybook sidebar (and the visual suite),
  // still run by the Vitest story tests.
  tags: ["!dev", "!golden"],
  render: () => html`
    <div id="sweep-frame">
      <mono-wind style="font-family: 'DejaVu Sans Mono Subset', monospace">
        <div class="flex flex-col gap-1">
          <div class="border border-neutral-500 px-1">
            inline <span class="tracking-wide text-cyan-400">tracking-wide</span> and
            <span class="tracking-wider text-yellow-400">wider</span> spans in a run
          </div>
          <div class="tracking-wide">wrapped text with tracking-wide and no border at all</div>
          <div>plain text alpha beta gamma delta epsilon zeta eta theta iota kappa</div>
        </div>
      </mono-wind>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    const frame = canvasElement.querySelector<HTMLElement>("#sweep-frame")!;
    // The fixture font loads lazily and the host re-measures its cell once
    // fonts settle — poll until that layout has landed (a fixed frame count
    // races the re-measure on slow runners).
    await document.fonts.load(`${getComputedStyle(host).fontSize} 'DejaVu Sans Mono Subset'`);
    // Wait for the fixture font to measure at its TRUE advance, pumping
    // the frame width so every attempt forces a relayout and a fresh cell
    // measurement (metrics update only on layout, so a passive wait can
    // wedge on a stale value). Root-caused 2026-08: Linux Chromium
    // QUANTIZES glyph advances to whole pixels under default hinting
    // (DejaVu's 8.4287px measures as exactly 8px — the font renders fine),
    // and on the raw CI runner that quantization toggles per renderer
    // process. The engine is self-consistent either way (the browser lays
    // text out with the same advances the probe measures); only this
    // sweep needs the fractional advance to exist.
    // 1233/2048 em is the fixture font's glyph advance; the em size comes
    // from the host's computed font-size rather than a hardcoded 14 so a
    // base-stylesheet change can't silently desync the sweep.
    const fontSizePx = parseFloat(getComputedStyle(host).fontSize);
    const targetCellWidth = (1233 / 2048) * fontSizePx;
    // ±0.01px: tight enough to exclude fallback monospace fonts near
    // DejaVu's advance (macOS Monaco is 8.401px, 0.028 away — matching it
    // once desynced the whole sweep), loose enough for engines that round
    // advances slightly (Linux Firefox measures 8.4333px, 0.0046 away).
    const advanceTolerance = 0.01;
    const cellWidthNow = () => cellSize(host).width;
    const fontDeadline = performance.now() + 10_000;
    let pump = false;
    while (
      Math.abs(cellWidthNow() - targetCellWidth) > advanceTolerance &&
      performance.now() < fontDeadline
    ) {
      pump = !pump;
      frame.style.width = `${420 + (pump ? 0.5 : 0.25)}px`;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Integer-quantized advances: with whole-pixel advances there is no
    // fractional accumulation, so the exact-fit headroom scenario this
    // sweep guards against PHYSICALLY cannot occur — skipping loses no
    // coverage on this platform. Environments with precise advances
    // (macOS, the other browser engines, most real users) run the full
    // sweep.
    const skipQuantized = (when: string): void => {
      console.warn(
        `[SubpixelHeadroom] glyph advances are pixel-quantized ${when}; the exact-fit sweep does not apply`,
        { mwCw: getComputedStyle(host).getPropertyValue("--mw-cw") },
      );
    };
    if (Math.abs(cellWidthNow() - targetCellWidth) > advanceTolerance) {
      if (!document.fonts.check(`${fontSizePx}px 'DejaVu Sans Mono Subset'`)) {
        throw new Error("fixture font failed to load");
      }
      skipQuantized("here");
      return;
    }
    await expectBrowserRowsToMatchEngine(canvasElement);
    const cellWidth = cellWidthNow();
    const first = host.firstElementChild as HTMLElement;
    for (let columns = 20; columns <= 90; columns++) {
      // Resize a plain WRAPPER, not the host (reaches the engine via its
      // ResizeObserver), on an explicitly paced write → wait → check loop
      // (waitFor would re-check on every mutation, and a write per check
      // becomes a microtask storm that starves the engine's rAF). The two
      // alternating widths floor to the same column count but are distinct
      // box sizes, so every attempt forces a relayout and a fresh cell
      // measurement. The platform's advance quantization can flip MID-TEST
      // (seen on CI 2026-08: the font gate above passed at 8.42875px, then
      // the sweep's re-measures read exactly 8px): the engine self-heals on
      // the next layout, but the sweep's frame widths are derived from the
      // now-stale fractional advance, so the expected column count can
      // never land — detect the flip and skip, same rationale as above.
      const deadline = performance.now() + 10_000;
      let landed = false;
      let flipped = false;
      while (!landed && performance.now() < deadline) {
        pump = !pump;
        frame.style.width = `${columns * cellWidth + (pump ? 0.5 : 0.25)}px`;
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (Math.abs(cellWidthNow() - targetCellWidth) > advanceTolerance) {
          flipped = true;
          break;
        }
        landed = first.style.getPropertyValue("--mw-w") === String(columns);
      }
      if (flipped) {
        skipQuantized("mid-sweep");
        return;
      }
      if (!landed) {
        // Fail-only diagnostics: capture what the engine actually saw.
        const cs = getComputedStyle(host);
        throw new Error(
          `sweep stalled: ${JSON.stringify({
            columns,
            cellWidth,
            styleWidth: frame.style.width,
            clientWidth: host.clientWidth,
            rectWidth: host.getBoundingClientRect().width,
            mwW: first.style.getPropertyValue("--mw-w"),
            mwCw: cs.getPropertyValue("--mw-cw"),
            fontApplied: document.fonts.check(`${fontSizePx}px 'DejaVu Sans Mono Subset'`),
            padding: cs.paddingLeft,
            measuring: host.hasAttribute("measuring"),
            visibility: document.visibilityState,
          })}`,
        );
      }
      await expectBrowserRowsToMatchEngine(canvasElement);
    }
  },
};

/** Wide and fallback glyphs (specs/wide-characters.md): ideographs,
 * Hangul, and emoji take two cells, symbols the font lacks one, and
 * the grid stays on its cells whatever the fallback fonts draw. */
export const WideCharacters: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="max-w-48 border border-neutral-500 px-1">
        <p>日本語のテキストと 한국어 텍스트 mixed with Latin, ★ stars ✓ checks and 😀 emoji.</p>
        <p class="mt-1 text-center">· 中央 ·</p>
        <p class="mt-1 truncate">This line is truncated 日本語のテキストが長すぎる</p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    expectGridOnItsCells(host);
  },
};

/** Tiling glyphs fit their row in any font and any leading
 * (specs/wide-characters.md): a `leading-6` root makes the row taller
 * than the font's `█` and `│`, and at the font's own leading its `│`
 * is drawn past the row — either way every block and box-drawing
 * glyph is boxed and pinned to the row, so neither a gap nor an
 * overlap shows where two rows meet. Borders, the scrollbar's
 * thumb, and a QR code's half blocks are included, the shades (the
 * track) at the scale that lands their lattice on whole device pixels
 * and phased so it runs on from row to row; a `bg-*` reaches the row's
 * edges too. */
export const TilingGlyphs: StoryObj = {
  render: () => html`
    <div class="flex flex-col gap-2">
      <mono-wind data-test="tall-rows" class="leading-6">
        <div class="flex items-start gap-2">
          <div data-test="blocks" class="w-12">█████ ▀▀▀▀▀ ▄▄▄▄▄ ░░░░░ ▒▒▒▒▒ ▓▓▓▓▓ ▌▌▐▐ ▖▗▘▝</div>
          <div class="h-5 w-20 overflow-y-auto border border-neutral-500 px-1">
            A scroll container's bar is block glyphs too: the track and the thumb tile the gutter
            without a gap between rows, however tall the row.
          </div>
          <div class="border border-double border-cyan-400 px-1">
            <div data-test="filled" class="bg-neutral-700 px-1">a filled row</div>
            <div class="mt-1">and a double border</div>
          </div>
          <mono-qr data-test="code">12345</mono-qr>
        </div>
      </mono-wind>
      <mono-wind data-test="own-rows">
        <div class="border border-neutral-500 px-1">
          At the font's own leading a glyph drawn past the row is boxed too, so a border's stem
          meets the next row's on one edge.
        </div>
      </mono-wind>
    </div>
  `,
  play: async ({ canvasElement }) => {
    await readyHosts(canvasElement);
    const by = testHooks(canvasElement);
    const host = by("tall-rows");
    const cellHeight = cellSize(host).height;
    const grid = gridOf(host);
    const gridRect = grid.getBoundingClientRect();
    // The cell is a whole number of layout units, so a row of boxes ends
    // where a row of text does.
    expect((cellSize(host).width * 64) % 1).toBe(0);
    // The boxes are judged in bulk: the Interactions addon instruments
    // every `expect`, and hundreds freeze the panel.
    const tiling = (from: HTMLElement) =>
      Array.from(gridOf(from).querySelectorAll("span")).filter((span) =>
        /^[\u2500-\u259F]$/.test(span.textContent ?? ""),
      );
    const labels = (boxes: HTMLElement[]) =>
      boxes.map((box) => `${box.textContent} [${box.getAttribute("style")}]`);
    // Boxed a row tall and pinned to its row, whichever way the font
    // draws the glyph off it.
    const unpinned = (judged: HTMLElement[], from: HTMLElement) => {
      const row = cellSize(from).height;
      const top = gridOf(from).getBoundingClientRect().top;
      return labels(
        judged.filter((box) => {
          const rect = box.getBoundingClientRect();
          const rowOffset = ((rect.top - top) / row) % 1;
          return (
            box.dataset.box === undefined ||
            !box.style.lineHeight.endsWith("px") ||
            Math.abs(rect.height - row) > 0.5 ||
            Math.min(rowOffset, 1 - rowOffset) > 0.05
          );
        }),
      );
    };
    // A block stands for a cell filled, so it grows into a row taller
    // than the font draws it, a run of one uniform block sharing a box;
    // a stroke stands for a line, whose weight that growth would change,
    // so here it keeps the font's size and takes no box at all.
    const boxes = Array.from(gridOf(host).querySelectorAll("span")).filter((box) =>
      /^[\u2580-\u259F]+$/.test(box.textContent ?? ""),
    );
    expect(boxes.length).toBeGreaterThan(60);
    expect(unpinned(boxes, host)).toEqual([]);
    expect(labels(boxes.filter((box) => !(parseFloat(box.style.fontSize) > 100)))).toEqual([]);
    const strokes = tiling(host).filter((box) => /^[\u2500-\u257F]$/.test(box.textContent!));
    expect(labels(strokes.filter((box) => box.dataset.box !== undefined))).toEqual([]);
    // A shade scales past the blocks, to whole device pixels of lattice,
    // and its box carries the lattice's phase from row to row, its
    // copies drawing its glyph.
    const block = parseFloat(boxes.find((box) => /^█+$/.test(box.textContent!))!.style.fontSize);
    const shades = boxes.filter((box) => /^[\u2591-\u2593]$/.test(box.textContent!));
    expect(shades.length).toBeGreaterThan(3);
    const unphased = shades.filter((box) => {
      const period = parseFloat(box.style.getPropertyValue("--mw-period"));
      return (
        !(parseFloat(box.style.fontSize) >= block) ||
        box.dataset.shade !== box.textContent ||
        getComputedStyle(box, "::after").content !== JSON.stringify(box.textContent) ||
        !(period > 0) ||
        !(parseFloat(box.style.lineHeight) > 0)
      );
    });
    expect(unphased.map((box) => `${box.textContent} [${box.getAttribute("style")}]`)).toEqual([]);
    const rows = grid.textContent!.split("\n").length;
    expect(gridRect.height).toBeCloseTo(rows * cellHeight, 0);
    // A painted span pads by the host's measured half-gap.
    const filled = paintedSpan(host, "a filled row")!;
    expect(parseFloat(getComputedStyle(filled).paddingTop)).toBeCloseTo(
      parseFloat(host.style.getPropertyValue("--mw-bgpad")),
      3,
    );
    // At the font's own leading the glyph runs past the row instead:
    // the box clips each row to its own slice.
    const own = by("own-rows");
    const ownStyle = getComputedStyle(gridOf(own));
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = `${ownStyle.fontStyle} ${ownStyle.fontWeight} ${ownStyle.fontSize} ${ownStyle.fontFamily}`;
    const stem = measure.measureText("│");
    expect(stem.actualBoundingBoxAscent + stem.actualBoundingBoxDescent).toBeGreaterThan(
      cellSize(own).height,
    );
    expect(tiling(own).length).toBeGreaterThan(20);
    expect(unpinned(tiling(own), own)).toEqual([]);
  },
};

/** Text beside block children (specs/cell-model.md "Inline content"):
 * each run is an anonymous leaf on the grid, and the block children
 * stay in the browser's flow, so the runs' native text and the link
 * land on their cells in every engine — under `leading-loose` too,
 * where a run's wrapped lines sit two rows apart, a native line box is
 * two rows, and the container's content shifts by half a row. */
export const AnonymousRuns: StoryObj = {
  name: "Anonymous Runs",
  render: () => html`
    <mono-wind>
      <div data-test="mixed" class="w-48 border border-neutral-500 px-2 py-1 text-amber-300">
        Text before the block.
        <div data-test="block" class="my-1 bg-neutral-700 px-1 text-white">A block child</div>
        Text after it, with <a data-test="link" href="#" class="text-cyan-400 underline">a link</a>.
      </div>
      <div
        data-test="mixed-loose"
        class="mt-1 w-48 border border-neutral-500 px-2 py-1 leading-loose"
      >
        Leaded before the block, wrapping onto a second line.
        <div data-test="block-loose" class="my-1 bg-neutral-700 px-1 text-white">
          A leaded block that wraps onto a second row.
        </div>
        Leaded after it, with
        <a data-test="link-loose" href="#" class="text-cyan-400 underline">a link</a>, wrapping onto
        a second line too.
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const by = testHooks(canvasElement);
    const grid = host.shadowRoot!.getElementById("grid")!;
    const rows = grid.textContent!.split("\n");
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    const gridRect = grid.getBoundingClientRect();
    // Where a native line rect lands, in cells (its middle: a leaded
    // line box is two rows).
    const cellOf = (rect: DOMRect) => ({
      row: Math.floor((rect.top + rect.height / 2 - gridRect.top) / cellHeight),
      col: Math.round((rect.left - gridRect.left) / cellWidth),
    });
    // Where the grid shows a text, from a row on.
    const shown = (text: string, from = 0) => {
      const row = rows.findIndex((line, index) => index >= from && line.includes(text));
      expect(row).toBeGreaterThanOrEqual(0);
      return { row, col: rows[row]!.indexOf(text) };
    };
    // 48 cells: the border, then `px-2` and the block's own `px-1`.
    const inner = (text = "") => `│${text.padEnd(46)}│`;
    expect(rows.map((row) => row.trimEnd()).filter(Boolean)).toEqual([
      `┌${"─".repeat(46)}┐`,
      inner(),
      inner("  Text before the block."),
      inner(),
      inner("   A block child"),
      inner(),
      inner("  Text after it, with a link."),
      inner(),
      `└${"─".repeat(46)}┘`,
      `┌${"─".repeat(46)}┐`,
      inner(),
      inner("  Leaded before the block, wrapping onto a"),
      inner(),
      inner("  second line."),
      inner(),
      inner("   A leaded block that wraps onto a second"),
      inner(),
      inner("   row."),
      inner(),
      inner("  Leaded after it, with a link, wrapping"),
      inner(),
      inner("  onto a second line too."),
      inner(),
      `└${"─".repeat(46)}┘`,
    ]);
    // A text node's lines, each by its leftmost rect (WebKit splits a
    // line's rects at spaces).
    const linesOf = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const byRow = new Map<number, number>();
      for (const rect of range.getClientRects()) {
        if (rect.width === 0) continue;
        const { row, col } = cellOf(rect);
        byRow.set(row, Math.min(byRow.get(row) ?? Infinity, col));
      }
      return [...byRow].sort(([a], [b]) => a - b).map(([row, col]) => ({ row, col }));
    };
    const textNodes = (el: Element) =>
      Array.from(el.childNodes).filter(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "",
      );
    for (const [suffix, word, blockText, blockRows] of [
      ["", "Text", "A block child", 1],
      ["-loose", "Leaded", "A leaded block", 3],
    ] as const) {
      // The block stays in the browser's flow, engine-margined so its
      // text sits on its row; its box spans its rows, the gap row of a
      // wrapped line included.
      const block = by(`block${suffix}`);
      expect(block).toHaveAttribute("data-mw-flow");
      const top = shown(`${word} before`).row;
      expect(linesOf(textNodes(block)[0]!)[0]).toEqual(shown(blockText, top));
      expect(Math.round(block.getBoundingClientRect().height / cellHeight)).toBe(blockRows);
      // The runs' native text and the link inside one sit on their cells.
      const [before, after] = textNodes(by(`mixed${suffix}`));
      expect(linesOf(before!)[0]).toEqual(shown(`${word} before`, top));
      expect(linesOf(after!)[0]).toEqual(shown(`${word} after`, top));
      expect(cellOf(by(`link${suffix}`).getBoundingClientRect())).toEqual(shown("a link", top));
    }
    // A run paints in its container's color.
    const run = paintedSpan(host, "Text before")!;
    expect(getComputedStyle(run).color).toBe(getComputedStyle(by("mixed")).color);
    // Under leading, each wrapped line sits a gap row down — the runs'
    // and the block's, natively too (the run after the link wraps in
    // the text node after it).
    const leaded = shown("Leaded before").row;
    const [leadedBefore, , leadedTail] = textNodes(by("mixed-loose"));
    for (const [node, first, second] of [
      [leadedBefore!, "Leaded before", "second line."],
      [leadedTail!, "Leaded after", "onto a second line too"],
      [textNodes(by("block-loose"))[0]!, "A leaded block", "row."],
    ] as const) {
      const wrapped = shown(second, leaded);
      expect(wrapped.row).toBe(shown(first, leaded).row + 2);
      expect(linesOf(node).at(-1)).toEqual(wrapped);
    }
  },
};
