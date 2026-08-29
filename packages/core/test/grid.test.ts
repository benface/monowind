import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { placeItems, resolveAxisPlacement } from "../src/grid.ts";
import { parseGridLine, parseTrackTemplate } from "../src/style.ts";
import type { GridLine, GridTemplate, TrackBreadth, TrackSize } from "../src/types.ts";
import { makeNode } from "./helpers.ts";

// --- track/template shorthands -------------------------------------------

const cellsB = (value: number): TrackBreadth => ({ kind: "cells", value });
const fixed = (value: number): TrackSize => ({ min: cellsB(value), max: cellsB(value) });
const fr = (value = 1): TrackSize => ({ min: { kind: "auto" }, max: { kind: "fr", value } });
/** Tailwind's `grid-cols-<n>` track: `minmax(0, 1fr)`. */
const twFr = (): TrackSize => ({ min: cellsB(0), max: { kind: "fr", value: 1 } });
const auto = (): TrackSize => ({ min: { kind: "auto" }, max: { kind: "auto" } });
const tracks = (...list: TrackSize[]): GridTemplate => ({ kind: "tracks", tracks: list });

const line = (value: number): GridLine => ({ kind: "line", value });
const span = (value: number): GridLine => ({ kind: "span", value });
const autoLine = (): GridLine => ({ kind: "auto" });

describe("resolveAxisPlacement", () => {
  it("resolves two definite lines to start + distance", () => {
    expect(resolveAxisPlacement(line(1), line(3), 3)).toEqual({ start: 0, span: 2 });
    // Inverted lines swap; equal lines drop the end (span 1).
    expect(resolveAxisPlacement(line(3), line(1), 3)).toEqual({ start: 0, span: 2 });
    expect(resolveAxisPlacement(line(2), line(2), 3)).toEqual({ start: 1, span: 1 });
  });

  it("counts negative lines from the explicit end", () => {
    // Explicit 3 tracks = lines 1..4; line -1 is line 4.
    expect(resolveAxisPlacement(line(-1), autoLine(), 3)).toEqual({ start: 3, span: 1 });
    expect(resolveAxisPlacement(line(1), line(-1), 3)).toEqual({ start: 0, span: 3 });
  });

  it("resolves a span against its definite line", () => {
    expect(resolveAxisPlacement(line(2), span(2), 3)).toEqual({ start: 1, span: 2 });
    expect(resolveAxisPlacement(span(2), line(3), 3)).toEqual({ start: 0, span: 2 });
    // Span back past the grid start goes negative (implicit tracks).
    expect(resolveAxisPlacement(span(3), line(2), 3)).toEqual({ start: -2, span: 3 });
  });

  it("keeps span-only and auto placements indefinite", () => {
    expect(resolveAxisPlacement(span(2), autoLine(), 3)).toEqual({ start: null, span: 2 });
    expect(resolveAxisPlacement(autoLine(), autoLine(), 3)).toEqual({ start: null, span: 1 });
  });
});

describe("placeItems", () => {
  const spec = (col: Partial<{ start: number; span: number }>, row?: typeof col) => ({
    col: { start: col.start ?? null, span: col.span ?? 1 },
    row: { start: row?.start ?? null, span: row?.span ?? 1 },
  });
  const rowFlow = { direction: "row" as const, dense: false };

  it("flows items row-major, wrapping at the explicit column count", () => {
    const placed = placeItems([spec({}), spec({}), spec({}), spec({})], 3, 0, rowFlow);
    expect(placed.items.map((p) => [p.row.start, p.col.start])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
    ]);
    expect(placed.colCount).toBe(3);
    expect(placed.rowCount).toBe(2);
  });

  it("sparse flow leaves holes; dense back-fills them", () => {
    const specs = [spec({ span: 2 }), spec({ span: 2 }), spec({ span: 1 })];
    const sparse = placeItems(specs, 3, 0, rowFlow);
    expect(sparse.items.map((p) => [p.row.start, p.col.start])).toEqual([
      [0, 0],
      [1, 0],
      [1, 2],
    ]);
    const dense = placeItems(specs, 3, 0, { direction: "row", dense: true });
    expect(dense.items.map((p) => [p.row.start, p.col.start])).toEqual([
      [0, 0],
      [1, 0],
      [0, 2],
    ]);
  });

  it("skips occupied cells from definite placements", () => {
    const specs = [spec({ start: 1 }, { start: 0 }), spec({}), spec({})];
    const placed = placeItems(specs, 2, 0, rowFlow);
    expect(placed.items.map((p) => [p.row.start, p.col.start])).toEqual([
      [0, 1],
      [0, 0],
      [1, 0],
    ]);
  });

  it("normalizes implicit tracks before the explicit grid", () => {
    const placed = placeItems([spec({ start: -1 }), spec({})], 2, 0, rowFlow);
    // Item 1 sits on an implicit column before the grid (original index
    // −1); everything shifts so track indices start at 0.
    expect(placed.colOrigin).toBe(-1);
    expect(placed.items[0]!.col.start).toBe(0);
    expect(placed.items[1]!.col.start).toBe(1);
    expect(placed.colCount).toBe(3);
  });

  it("column flow grows columns instead of rows", () => {
    const placed = placeItems([spec({}), spec({}), spec({}), spec({})], 0, 2, {
      direction: "column",
      dense: false,
    });
    expect(placed.items.map((p) => [p.row.start, p.col.start])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(placed.rowCount).toBe(2);
    expect(placed.colCount).toBe(2);
  });
});

describe("grid track sizing via layout", () => {
  it("divides minmax(0, 1fr) columns evenly regardless of content", () => {
    const a = makeNode({ text: "abcdefgh" });
    const b = makeNode({ text: "xy" });
    const c = makeNode({ text: "z" });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(twFr(), twFr(), twFr()), gapX: 1 },
      children: [a, b, c],
    });
    layoutRoot(root, 32);
    expect([a.localRect.width, b.localRect.width, c.localRect.width]).toEqual([10, 10, 10]);
    expect([a.localRect.x, b.localRect.x, c.localRect.x]).toEqual([0, 11, 22]);
  });

  it("floors bare fr tracks at their items' min-content (automatic minimum)", () => {
    const wide = makeNode({ text: "abcdefgh" });
    const narrow = makeNode({ text: "xy" });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(fr(), fr()) },
      children: [wide, narrow],
    });
    layoutRoot(root, 10);
    // Equal shares would be 5/5, but the first track's automatic minimum
    // (min-content 8) wins; the second absorbs what's left.
    expect(wide.localRect.width).toBe(8);
    expect(narrow.localRect.width).toBe(2);
  });

  it("gives fixed tracks their cells and fr the leftover", () => {
    const a = makeNode({ text: "aa" });
    const b = makeNode({ text: "bb" });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(fixed(8), fr()) },
      children: [a, b],
    });
    layoutRoot(root, 30);
    expect(a.localRect.width).toBe(8);
    expect(b.localRect.width).toBe(22);
    expect(b.localRect.x).toBe(8);
  });

  it("maximizes a fixed minmax max before fr distribution", () => {
    const a = makeNode({ text: "a" });
    const b = makeNode({ text: "b" });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks({ min: cellsB(0), max: cellsB(10) }, fr()),
      },
      children: [a, b],
    });
    layoutRoot(root, 30);
    expect(a.localRect.width).toBe(10);
    expect(b.localRect.width).toBe(20);
  });

  it("stretches auto tracks over leftover space under the default justify-content", () => {
    const a = makeNode({ text: "abc" });
    const b = makeNode({ text: "dd" });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(auto(), fixed(4)) },
      children: [a, b],
    });
    layoutRoot(root, 20);
    // justify-content defaults to stretch (CSS normal): §11.8 grows the
    // auto track from its max-content 3 to absorb the free 13.
    expect(a.localRect.width).toBe(16);
    expect(b.localRect.x).toBe(16);
  });

  it("offsets tracks instead when justify-content is not stretch", () => {
    const a = makeNode({ text: "abc" });
    const b = makeNode({ text: "dd" });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(auto(), fixed(4)),
        justifyContent: "center",
      },
      children: [a, b],
    });
    layoutRoot(root, 20);
    // Tracks stay 3 + 4; leftover 13 centers → offset 6.
    expect(a.localRect.width).toBe(3);
    expect(a.localRect.x).toBe(6);
    expect(b.localRect.x).toBe(9);
  });

  it("resolves auto-fill counts and collapses empty auto-fit tracks", () => {
    const fillRoot = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: {
          kind: "tracks",
          tracks: [],
          autoRepeat: { index: 0, tracks: [fixed(8)], mode: "auto-fill" },
        },
        gapX: 1,
      },
      children: [makeNode({ text: "a" }), makeNode({ text: "b" })],
    });
    layoutRoot(fillRoot, 35);
    // count = floor((35 + 1) / (8 + 1)) = 4 tracks; items sit in the
    // first two, empty tracks keep their size.
    expect(fillRoot.children[0]!.localRect.width).toBe(8);
    expect(fillRoot.children[1]!.localRect.x).toBe(9);

    const a = makeNode({ text: "a" });
    const b = makeNode({ text: "b" });
    const fitRoot = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: {
          kind: "tracks",
          tracks: [],
          autoRepeat: { index: 0, tracks: [fixed(8)], mode: "auto-fit" },
        },
        gapX: 1,
        justifyContent: "end",
      },
      children: [a, b],
    });
    layoutRoot(fitRoot, 35);
    // Two of the four tracks collapse (size 0, gaps dropped): the used
    // extent is 8 + 1 + 8 = 17, so `justify-content: end` shifts the
    // tracks by 35 − 17 = 18.
    expect(a.localRect.x).toBe(18);
    expect(b.localRect.x).toBe(27);
  });

  it("sums indefinite rows and distributes definite heights to auto rows", () => {
    const items = [makeNode({ text: "a" }), makeNode({ text: "b" })];
    const natural = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(twFr()), gapY: 1 },
      children: items.map((i) => i),
    });
    layoutRoot(natural, 10);
    expect(natural.localRect.height).toBe(3); // 1 + gap + 1

    const c = makeNode({ text: "a" });
    const d = makeNode({ text: "b" });
    const stretched = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(twFr()),
        height: { kind: "cells", value: 8 },
      },
      children: [c, d],
    });
    layoutRoot(stretched, 10);
    // align-content defaults to stretch: the two auto rows split the
    // definite 8 → 4 each, and the second row starts at 4.
    expect(d.localRect.y).toBe(4);
  });

  it("centers rows when align-content is center", () => {
    const c = makeNode({ text: "a" });
    const d = makeNode({ text: "b" });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(twFr()),
        height: { kind: "cells", value: 8 },
        alignContent: "center",
      },
      children: [c, d],
    });
    layoutRoot(root, 10);
    expect(c.localRect.y).toBe(3);
    expect(d.localRect.y).toBe(4);
  });
});

describe("grid items in their areas", () => {
  it("stretches items to their track by default; explicit widths align start", () => {
    const stretchy = makeNode({ text: "ab" });
    const sized = makeNode({ text: "cd", style: { width: { kind: "cells", value: 4 } } });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(twFr(), twFr()) },
      children: [stretchy, sized],
    });
    layoutRoot(root, 20);
    expect(stretchy.localRect.width).toBe(10);
    expect(sized.localRect.width).toBe(4);
    expect(sized.localRect.x).toBe(10);
  });

  it("honors justify-items and justify-self", () => {
    const centered = makeNode({ text: "ab", style: { width: { kind: "cells", value: 4 } } });
    const ended = makeNode({
      text: "cd",
      style: { width: { kind: "cells", value: 4 }, justifySelf: "end" },
    });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(twFr(), twFr()),
        justifyItems: "center",
      },
      children: [centered, ended],
    });
    layoutRoot(root, 20);
    expect(centered.localRect.x).toBe(3); // floor((10 − 4) / 2)
    expect(ended.localRect.x).toBe(16); // 10 + (10 − 4)
  });

  it("lets auto margins absorb the area over alignment", () => {
    const item = makeNode({
      text: "ab",
      style: {
        width: { kind: "cells", value: 4 },
        margin: { top: 0, right: null, bottom: 0, left: null },
      },
    });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(twFr()) },
      children: [item],
    });
    layoutRoot(root, 10);
    expect(item.localRect.x).toBe(3); // centered by the auto pair
  });

  it("stretches shorter items to their row height", () => {
    const tall = makeNode({ text: "aa bb" }); // wraps to 2 rows at width 2
    const short = makeNode({ text: "c" });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(fixed(2), fixed(4)) },
      children: [tall, short],
    });
    layoutRoot(root, 6);
    expect(tall.localRect.height).toBe(2);
    expect(short.localRect.height).toBe(2); // align-items stretch
  });

  it("keeps fixed margins inside the area", () => {
    const item = makeNode({
      text: "ab",
      style: { margin: { top: 1, right: 0, bottom: 0, left: 2 } },
    });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(twFr()) },
      children: [item],
    });
    layoutRoot(root, 10);
    expect(item.localRect.x).toBe(2);
    expect(item.localRect.y).toBe(1);
    expect(item.localRect.width).toBe(8); // stretched minus margins
  });

  it("places explicitly positioned items and spans", () => {
    const spanning = makeNode({
      text: "ab",
      style: { gridColumnStart: line(1), gridColumnEnd: line(3) },
    });
    const second = makeNode({
      text: "cd",
      style: { gridColumnStart: line(2), gridRowStart: line(2) },
    });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(twFr(), twFr()), gapX: 2 },
      children: [spanning, second],
    });
    layoutRoot(root, 22);
    expect(spanning.localRect.width).toBe(22); // both tracks + gap
    expect(second.localRect.x).toBe(12);
    expect(second.localRect.y).toBe(1);
  });

  it("sorts items by order before auto-placement", () => {
    const first = makeNode({ text: "a", style: { order: 2 } });
    const second = makeNode({ text: "b", style: { order: 1 } });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(twFr(), twFr()) },
      children: [first, second],
    });
    layoutRoot(root, 10);
    expect(second.localRect.x).toBe(0);
    expect(first.localRect.x).toBe(5);
  });
});

describe("grid intrinsic sizing", () => {
  it("sizes a max-content grid container from its tracks", () => {
    const root = makeNode({
      style: {
        display: "grid",
        width: { kind: "max-content" },
        gridTemplateColumns: tracks(auto(), auto()),
        gapX: 1,
      },
      children: [makeNode({ text: "abc" }), makeNode({ text: "de" })],
    });
    layoutRoot(root, 40);
    expect(root.localRect.width).toBe(6); // 3 + 1 + 2
  });

  it("uses min-content contributions for the min-content width", () => {
    const root = makeNode({
      style: {
        display: "grid",
        width: { kind: "min-content" },
        gridTemplateColumns: tracks(auto()),
      },
      children: [makeNode({ text: "hello world" })],
    });
    layoutRoot(root, 40);
    expect(root.localRect.width).toBe(5); // longest word
  });
});

describe("track template parsing", () => {
  it("expands fixed repeats and normalizes fr", () => {
    expect(parseTrackTemplate("repeat(3, minmax(0px, 1fr))", 16)).toEqual(
      tracks(twFr(), twFr(), twFr()),
    );
  });

  it("parses mixed track lists", () => {
    // Root font 16px → cell 4px: 80px = 20 cells, 100px = 25 cells.
    expect(parseTrackTemplate("80px 1fr minmax(100px, max-content)", 16)).toEqual(
      tracks(fixed(20), fr(), { min: cellsB(25), max: { kind: "max-content" } }),
    );
  });

  it("keeps auto-repeats symbolic", () => {
    expect(parseTrackTemplate("repeat(auto-fill, minmax(80px, 1fr))", 16)).toEqual({
      kind: "tracks",
      tracks: [],
      autoRepeat: {
        index: 0,
        tracks: [{ min: cellsB(20), max: { kind: "fr", value: 1 } }],
        mode: "auto-fill",
      },
    });
  });

  it("parses keywords, percentages, and deferred forms", () => {
    expect(parseTrackTemplate("none", 16)).toEqual({ kind: "none" });
    expect(parseTrackTemplate("subgrid", 16)).toEqual({ kind: "subgrid" });
    expect(parseTrackTemplate("50% auto", 16)).toEqual(
      tracks({ min: { kind: "percent", value: 50 }, max: { kind: "percent", value: 50 } }, auto()),
    );
    // fit-content() is deferred and reads as auto.
    expect(parseTrackTemplate("fit-content(100px)", 16)).toEqual(tracks(auto()));
  });

  it("parses grid line longhands", () => {
    expect(parseGridLine("auto")).toEqual({ kind: "auto" });
    expect(parseGridLine("3")).toEqual({ kind: "line", value: 3 });
    expect(parseGridLine("-1")).toEqual({ kind: "line", value: -1 });
    expect(parseGridLine("span 2")).toEqual({ kind: "span", value: 2 });
  });
});

describe("indefinite-axis track sizing", () => {
  it("content-sizes minmax(0, 1fr) rows in an auto-height grid (no overlap)", () => {
    // Regression: `grid-flow-col grid-rows-2` items overlapped because the
    // fr rows sized to their fixed min (0) on the indefinite axis.
    const items = [1, 2, 3, 4, 5].map(() =>
      makeNode({ text: "aa", style: { border: { top: 1, right: 1, bottom: 1, left: 1 } } }),
    );
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateRows: tracks(twFr(), twFr()),
        gridAutoFlow: { direction: "column", dense: false },
        gapY: 1,
      },
      children: items,
    });
    layoutRoot(root, 40);
    // Each item is 3 tall (border + line + border) → rows [3, 3], the
    // second starting after the first plus the row gap.
    expect(items[0]!.localRect.y).toBe(0);
    expect(items[1]!.localRect.y).toBe(4);
    expect(root.localRect.height).toBe(7);
  });

  it("equalizes fr rows to the shared flex fraction, per CSS", () => {
    const short = makeNode({ text: "a" });
    const tall = makeNode({ text: "aa bb", style: { width: { kind: "cells", value: 2 } } });
    const root = makeNode({
      style: { display: "grid", gridTemplateRows: tracks(fr(), fr()) },
      children: [short, tall],
    });
    layoutRoot(root, 10);
    // The taller item (2 rows) sets the fraction; BOTH rows become 2.
    expect(tall.localRect.y).toBe(2);
    expect(root.localRect.height).toBe(4);
  });

  it("maximizes a fixed minmax max on the indefinite axis, even empty", () => {
    // All three browser engines give `grid-template-rows: minmax(0, N)`
    // its full N in an auto-height container (§11.6's infinite free space
    // under the max-content constraint).
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateRows: tracks({ min: cellsB(0), max: cellsB(6) }),
      },
      children: [makeNode({ text: "a" })],
    });
    layoutRoot(root, 10);
    expect(root.localRect.height).toBe(6);

    const empty = makeNode({
      style: {
        display: "grid",
        gridTemplateRows: tracks({ min: cellsB(0), max: cellsB(6) }),
      },
      children: [],
    });
    const outer = makeNode({ children: [empty] });
    layoutRoot(outer, 10);
    expect(empty.localRect.height).toBe(6);
  });
});

describe("percent heights on grid items", () => {
  it("resolves a percent height against the item's grid area", () => {
    const half = makeNode({
      text: "a",
      style: { height: { kind: "percent", value: 50 }, alignSelf: "start" },
    });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(twFr()),
        gridTemplateRows: tracks(fixed(8)),
      },
      children: [half],
    });
    layoutRoot(root, 10);
    expect(half.localRect.height).toBe(4);
  });
});

describe("min()/max() track breadths", () => {
  it("parses min()/max() over lengths and percentages", () => {
    // Root font 16px → cell 4px: 128px = 32 cells.
    expect(parseTrackTemplate("repeat(auto-fill, minmax(min(128px, 100%), 1fr))", 16)).toEqual({
      kind: "tracks",
      tracks: [],
      autoRepeat: {
        index: 0,
        tracks: [
          {
            min: {
              kind: "math",
              fn: "min",
              args: [cellsB(32), { kind: "percent", value: 100 }],
            },
            max: { kind: "fr", value: 1 },
          },
        ],
        mode: "auto-fill",
      },
    });
    // calc() arithmetic still degrades to auto.
    expect(parseTrackTemplate("calc(100% - 8px) 1fr", 16)).toEqual(tracks(auto(), fr()));
  });

  it("caps responsive auto-fill tracks at the container width", () => {
    const track = {
      min: {
        kind: "math" as const,
        fn: "min" as const,
        args: [cellsB(32), { kind: "percent" as const, value: 100 }],
      },
      max: { kind: "fr" as const, value: 1 },
    };
    const template: GridTemplate = {
      kind: "tracks",
      tracks: [],
      autoRepeat: { index: 0, tracks: [track], mode: "auto-fill" },
    };
    const wideItems = [makeNode({ text: "a" }), makeNode({ text: "b" })];
    const wide = makeNode({
      style: { display: "grid", gridTemplateColumns: template, gapX: 1 },
      children: wideItems.map((i) => i),
    });
    layoutRoot(wide, 70);
    // min(32, 70) = 32 → count = ⌊(70 + 1) ÷ 33⌋ = 2; fr stretches both.
    expect(wideItems[0]!.localRect.width).toBe(35);
    expect(wideItems[1]!.localRect.x).toBe(36);

    const narrowItem = makeNode({ text: "a" });
    const narrow = makeNode({
      style: { display: "grid", gridTemplateColumns: template, gapX: 1 },
      children: [narrowItem],
    });
    layoutRoot(narrow, 20);
    // min(32, 20) = 20: one track, capped at the container — no overflow.
    expect(narrowItem.localRect.width).toBe(20);
  });
});

describe("spanning items and implicit track sizes", () => {
  it("distributes a spanning item's contribution equally across intrinsic tracks", () => {
    const a = makeNode({ text: "ab" });
    const b = makeNode({ text: "cd" });
    const spanning = makeNode({
      text: "abcdefgh",
      style: { gridColumnStart: line(1), gridColumnEnd: line(3), whiteSpace: "nowrap" },
    });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(auto(), auto()),
        justifyContent: "start",
      },
      children: [a, b, spanning],
    });
    layoutRoot(root, 20);
    // Span-1 items set both auto tracks to 2; the span-2 item still needs
    // 8 − 4 = 4 more, split equally (specs/grid.md deviation 4) → 4 + 4.
    expect(a.localRect.width).toBe(4);
    expect(b.localRect.x).toBe(4);
    expect(b.localRect.width).toBe(4);
    expect(spanning.localRect.width).toBe(8);
  });

  it("cycles the grid-auto-rows list across implicit tracks", () => {
    const items = [1, 2, 3].map(() => makeNode({ text: "a" }));
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(twFr()),
        gridAutoRows: [fixed(2), fixed(4)],
      },
      children: items,
    });
    layoutRoot(root, 10);
    // Implicit rows take 2, 4, 2, … from the list; items stretch to them.
    expect(items.map((i) => i.localRect.y)).toEqual([0, 2, 6]);
    expect(items.map((i) => i.localRect.height)).toEqual([2, 4, 2]);
  });
});
