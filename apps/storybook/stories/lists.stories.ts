import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import {
  besideNative,
  channels,
  countLayouts,
  expectWordsAsNative,
  paintedSpan,
  readyGrid,
  rowsOf,
} from "./helpers.ts";

const meta: Meta = {
  title: "Features / Lists",
};
export default meta;

/** A painted span's color is its host's `--color-*` token. */
const expectToken = (span: HTMLElement, token: string): void => {
  const { host } = span.getRootNode() as ShadowRoot;
  expect(channels(span.style.color)).toEqual(
    channels(getComputedStyle(host).getPropertyValue(`--color-${token}`)),
  );
};

/** Each drawn `marker` ends where its item's `text` starts, on a row of
 * the grid's. */
const expectMarkers = (rows: readonly string[], markers: readonly [string, string][]): void => {
  for (const [marker, text] of markers) {
    const drawn = marker + text;
    expect(
      rows.some((row) => row.includes(drawn)),
      `"${drawn}" in\n${rows.join("\n")}`,
    ).toBe(true);
  }
};

/**
 * List markers (specs/lists.md): each list item's marker, numbered by
 * CSS's counters, drawn outside its item in the list's padding, or
 * inside as its first line's opening cells, bullets through the item's
 * glyph set (a `summary`'s disclosure triangles in "Interactive /
 * Details").
 */
export const Lists: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="grid max-w-120 gap-x-4 gap-y-1 sm:grid-cols-2">
        <ul class="list-disc pl-2">
          <li>Bullets</li>
          <li>
            Nested lists
            <ul class="list-[circle] pl-2">
              <li>
                in circles
                <ul class="list-[square] pl-2">
                  <li>and squares</li>
                </ul>
              </li>
            </ul>
          </li>
        </ul>
        <ol class="list-decimal pl-4" start="9">
          <li>From nine</li>
          <li>to ten</li>
          <li value="20">set to twenty</li>
          <li>and on</li>
        </ol>
        <ol class="list-[lower-alpha] pl-3">
          <li>Letters</li>
          <li>count too</li>
        </ol>
        <ol reversed class="list-[upper-roman] pl-5">
          <li>Romans, reversed</li>
          <li>count down</li>
          <li>to one</li>
        </ol>
        <ul class="list-['→_'] pl-2">
          <li>A string</li>
          <li class="marker:font-bold marker:text-amber-400">in a color of its own</li>
        </ul>
        <ol class="list-inside list-decimal">
          <li>
            Inside, the marker opens the first line, and the text wraps back under it,
            <a data-test="link" href="#wrapped" class="underline">a link</a> included
          </li>
          <li class="text-center">centered</li>
          <li class="indent-2">
            indented: the marker moves with the first line, and the lines after it start at the edge
          </li>
        </ol>
        <ul class="list-disc pl-2">
          <li class="float-left mr-2 h-2 w-4 list-none bg-neutral-700"></li>
          <li>Beside a float</li>
          <li>the markers move in</li>
          <li>and back out</li>
        </ul>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, measure } = await readyGrid(canvasElement);
    await waitFor(() => {
      const { rows, expectNativeOnGrid } = measure();
      expectMarkers(rows, [
        ["• ", "Bullets"],
        ["• ", "Nested lists"],
        ["◦ ", "in circles"],
        ["▪ ", "and squares"],
        [" 9. ", "From nine"],
        ["10. ", "to ten"],
        ["20. ", "set to twenty"],
        ["21. ", "and on"],
        ["a. ", "Letters"],
        ["b. ", "count too"],
        ["III. ", "Romans"],
        [" II. ", "count down"],
        ["  I. ", "to one"],
        ["→ ", "A string"],
        ["→ ", "in a color"],
        ["1. ", "Inside, the marker"],
        ["2. ", "centered"],
        ["  3. ", "indented"],
        ["• ", "Beside a float"],
        ["• ", "the markers move in"],
        ["• ", "and back out"],
      ]);
      // The native text, inside markers' lines included, lies under the
      // grid's; centered, it may lie half a cell off (cell-model.md
      // "Text alignment").
      for (const item of canvasElement.querySelectorAll<HTMLElement>("li")) {
        if (item.textContent!.trim() && !item.classList.contains("text-center")) {
          expectNativeOnGrid(item);
        }
      }
    });
    const amber = Array.from(host.shadowRoot!.querySelectorAll("span")).find(
      (span) => span.textContent!.startsWith("→") && span.style.fontWeight === "700",
    )!;
    expectToken(amber, "amber-400");
  },
};

/**
 * What an author styles a marker with: `marker:` utilities, a string
 * type, `content` with its counters, and an `@counter-style` rule — and
 * the gap between marker and text, which is the marker's own text (a
 * `::marker` takes no margin or padding): its suffix, a string's
 * trailing spaces, and outside, the item's padding, which moves its
 * text alone. An image draws nothing (specs/lists.md deviation 3): a
 * `list-style-image` item its type, a `content` image its text alone.
 */
export const MarkerStyles: StoryObj = {
  name: "Marker Styles",
  render: () => html`
    <mono-wind>
      <style>
        @counter-style parens {
          system: extends decimal;
          prefix: "(";
          suffix: ") ";
        }
        @counter-style wide-gap {
          system: extends upper-alpha;
          suffix: ".   ";
        }
        .image-type {
          list-style-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><circle cx='4' cy='4' r='4' fill='red'/></svg>");
        }
        .image-content::marker {
          content: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><circle cx='4' cy='4' r='4' fill='red'/></svg>")
            "» ";
        }
      </style>
      <div class="grid max-w-120 gap-x-4 gap-y-1 sm:grid-cols-2">
        <ul class="list-disc pl-2 marker:font-bold marker:text-cyan-400">
          <li>marker: color and weight</li>
          <li class="marker:text-amber-400 marker:italic">per item</li>
        </ul>
        <ul class="pl-3">
          <li class="list-['→']">touching</li>
          <li class="list-['→_']">one cell</li>
          <li class="list-['→__']">two cells</li>
        </ul>
        <ol class="list-[parens] pl-4">
          <li>an @counter-style</li>
          <li>its prefix and suffix</li>
        </ol>
        <ol class="list-[wide-gap] pl-5">
          <li>a wider suffix, for every item</li>
          <li>pushes the text in, and a wrapped line starts under the text, not the marker</li>
        </ol>
        <ol class="list-decimal pl-3">
          <li class="pl-2">padding moves the text alone</li>
          <li class="pl-2">
            and a wrapped line starts under the text too, the marker staying at the edge
          </li>
        </ol>
        <ul class="list-disc pl-2">
          <li class="image-type">an image type draws its type</li>
          <li data-test="image-content" class="image-content">
            a content image draws nothing, its text stays
          </li>
        </ul>
        <ol class="pl-5 marker:content-[counters(list-item,'.')_'_']">
          <li>
            counters()
            <ol class="pl-4">
              <li>in content</li>
              <li>nested</li>
            </ol>
          </li>
        </ol>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, measure } = await readyGrid(canvasElement);
    await waitFor(() => {
      const { rows, expectNativeOnGrid } = measure();
      expectMarkers(rows, [
        ["• ", "marker: color"],
        ["• ", "per item"],
        ["→", "touching"],
        ["→ ", "one cell"],
        ["→  ", "two cells"],
        ["(1) ", "an @counter-style"],
        ["(2) ", "its prefix"],
        ["A.   ", "a wider suffix"],
        ["B.   ", "pushes the text"],
        ["1.   ", "padding moves"],
        ["2.   ", "and a wrapped"],
        ["1 ", "counters()"],
        ["1.1 ", "in content"],
        ["1.2 ", "nested"],
        ["• ", "an image type"],
        ["» ", "a content image"],
      ]);
      for (const item of canvasElement.querySelectorAll<HTMLElement>("li")) {
        expectNativeOnGrid(item);
      }
    });
    // The image's native marker takes no content.
    expect(canvasElement.querySelector('[data-test="image-content"]')).toHaveAttribute(
      "data-mw-marker-image",
    );
    const cyan = paintedSpan(host, "•")!;
    expectToken(cyan, "cyan-400");
    expect(cyan.style.fontWeight).toBe("700");
  },
};

/** Test-only: `Marker Styles` laid out again, twice — its image
 * marker's text and flag kept each time, the engine reading the
 * authored `content` its native lock hides. */
export const MarkerStylesRelaidOut: StoryObj = {
  tags: ["!dev", "!golden"],
  render: MarkerStyles.render!,
  play: async ({ canvasElement }) => {
    const { host } = await readyGrid(canvasElement);
    const item = canvasElement.querySelector<HTMLElement>('[data-test="image-content"]')!;
    const layouts = countLayouts(host);
    for (let pass = 1; pass <= 2; pass++) {
      item.classList.toggle("relaid");
      await waitFor(() => expect(layouts.count).toBe(pass));
      expect(
        rowsOf(host).some((row) => row.includes("» a content image")),
        `pass ${pass}`,
      ).toBe(true);
      expect(item).toHaveAttribute("data-mw-marker-image");
    }
    layouts.stop();
  },
};

/**
 * Test-only: inside markers laid out by the engine and by the browser
 * beside it, each word of the items where the browser puts it — the
 * first line wrapping at the width less the marker, aligned and
 * indented with it, a leading block below the marker's own line, and
 * an inline item's marker inside it, whatever its position.
 * WebKit leaves an inside marker's spaces out of a justified line's
 * spread, which CSS and the other two include.
 */
export const ListsAgainstNative: StoryObj = {
  tags: ["!dev", "!golden"],
  ...besideNative(
    (u) => [
      `<ol class="list-inside list-decimal"><li>An inside marker opens the first line of text and wraps with it</li></ol>`,
      `<ol class="list-inside list-decimal" start="9"><li>nine</li><li>and ten, a marker a cell wider</li></ol>`,
      `<ol class="list-inside list-decimal"><li style="text-indent: ${u(3)}">indented past the marker</li></ol>`,
      `<ol class="list-inside list-decimal text-center"><li>centered with its marker</li><li>and odd</li></ol>`,
      `<ol class="list-inside list-decimal text-right"><li>ended with its marker</li></ol>`,
      {
        markup: `<ol class="list-inside list-decimal text-justify"><li>a justified first line spreads the marker's space with the words of the line</li></ol>`,
        departs: ["webkit"],
      },
      `<ol class="list-inside list-decimal"><li><div>a leading block</div></li><li></li><li>after an empty item</li></ol>`,
      // WebKit has no inline list item.
      {
        markup: `<p>an <span class="list-decimal" style="display: inline list-item">inline item</span> has its marker inside</p>`,
        departs: ["webkit"],
      },
    ],
    // A centered line's native copy may lie half a cell off
    // (cell-model.md "Text alignment").
    (host, native) => expectWordsAsNative(host, native, 0.05),
  ),
};
