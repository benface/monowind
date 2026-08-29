import { describe, expect, it } from "vitest";
import { layoutRoot } from "../src/layout.ts";
import { placeItems, resolveAxisPlacement } from "../src/grid.ts";
import type { AxisLines } from "../src/grid.ts";
import { parseGridLine, parseGridTemplateAreas, parseTrackTemplate } from "../src/style.ts";
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
/** An explicit grid of `count` tracks; `names[i]` names line i. */
const axis = (count: number, names: Record<number, string[]> = {}): AxisLines => ({
  explicitCount: count,
  names: Array.from({ length: count + 1 }, (_, i) => names[i] ?? []),
});
const span = (value: number): GridLine => ({ kind: "span", value });
const autoLine = (): GridLine => ({ kind: "auto" });

describe("resolveAxisPlacement", () => {
  it("resolves two definite lines to start + distance", () => {
    expect(resolveAxisPlacement(line(1), line(3), axis(3))).toEqual({ start: 0, span: 2 });
    // Inverted lines swap; equal lines drop the end (span 1).
    expect(resolveAxisPlacement(line(3), line(1), axis(3))).toEqual({ start: 0, span: 2 });
    expect(resolveAxisPlacement(line(2), line(2), axis(3))).toEqual({ start: 1, span: 1 });
  });

  it("counts negative lines from the explicit end", () => {
    // Explicit 3 tracks = lines 1..4; line -1 is line 4.
    expect(resolveAxisPlacement(line(-1), autoLine(), axis(3))).toEqual({ start: 3, span: 1 });
    expect(resolveAxisPlacement(line(1), line(-1), axis(3))).toEqual({ start: 0, span: 3 });
  });

  it("resolves a span against its definite line", () => {
    expect(resolveAxisPlacement(line(2), span(2), axis(3))).toEqual({ start: 1, span: 2 });
    expect(resolveAxisPlacement(span(2), line(3), axis(3))).toEqual({ start: 0, span: 2 });
    // Span back past the grid start goes negative (implicit tracks).
    expect(resolveAxisPlacement(span(3), line(2), axis(3))).toEqual({ start: -2, span: 3 });
  });

  it("keeps span-only and auto placements indefinite", () => {
    expect(resolveAxisPlacement(span(2), autoLine(), axis(3))).toEqual({ start: null, span: 2 });
    expect(resolveAxisPlacement(autoLine(), autoLine(), axis(3))).toEqual({ start: null, span: 1 });
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

describe("absolutely positioned grid children (§10.1)", () => {
  const twoCols = () => ({
    display: "grid" as const,
    gridTemplateColumns: tracks(twFr(), twFr()),
    gapX: 2,
  });

  it("uses the grid area as containing block when the container is positioned", () => {
    const overlay = makeNode({
      text: "x",
      style: {
        position: "absolute",
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        gridColumnStart: line(1),
        gridColumnEnd: line(2),
      },
    });
    const root = makeNode({
      style: { ...twoCols(), position: "relative" },
      children: [makeNode({ text: "a" }), makeNode({ text: "b" }), overlay],
    });
    layoutRoot(root, 20);
    // Tracks are 9 + 9 with a 2-cell gap; the overlay fills column 1's
    // area (rows auto → the padding edges, i.e. the single 1-row track).
    expect(overlay.localRect).toEqual({ x: 0, y: 0, width: 9, height: 1 });
  });

  it("resolves spans against auto and lines beyond the grid to the padding edges", () => {
    const spanOnly = makeNode({
      text: "x",
      style: {
        position: "absolute",
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        gridColumnStart: span(1),
      },
    });
    const beyond = makeNode({
      text: "y",
      style: {
        position: "absolute",
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        gridColumnStart: line(2),
        gridColumnEnd: line(9),
      },
    });
    const root = makeNode({
      style: {
        ...twoCols(),
        position: "relative",
        padding: { top: 0, right: 1, bottom: 0, left: 1 },
      },
      children: [makeNode({ text: "a" }), spanOnly, beyond],
    });
    layoutRoot(root, 22);
    // Padding box = the whole 22 (no border); span-against-auto → both
    // padding edges; line 9 is beyond the grid → end at the padding edge.
    expect(spanOnly.localRect.x).toBe(0);
    expect(spanOnly.localRect.width).toBe(22);
    expect(beyond.localRect.x).toBe(1 + 11);
    expect(beyond.localRect.width).toBe(22 - 12);
  });

  it("static position is the sole item of the content box, self-aligned", () => {
    const badge = makeNode({
      text: "hi",
      style: { position: "absolute", justifySelf: "end", alignSelf: "end" },
    });
    const root = makeNode({
      style: {
        ...twoCols(),
        position: "relative",
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
        height: { kind: "cells", value: 6 },
      },
      children: [makeNode({ text: "a" }), badge],
    });
    layoutRoot(root, 20);
    // Content box is x 1..19, y 1..5 → end-aligned 2×1 badge at (17, 4).
    expect(badge.localRect.x).toBe(17);
    expect(badge.localRect.y).toBe(4);
  });

  it("uses the padding box as static area when the grid container is itself absolute", () => {
    const badge = makeNode({ text: "hi", style: { position: "absolute" } });
    const grid = makeNode({
      style: {
        ...twoCols(),
        position: "absolute",
        insets: { top: 0, right: null, bottom: null, left: 0 },
        width: { kind: "cells", value: 20 },
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      children: [makeNode({ text: "a" }), badge],
    });
    const root = makeNode({ style: { position: "relative" }, children: [grid] });
    layoutRoot(root, 30);
    // Start-aligned in the PADDING box → the badge sits at the box's own
    // corner, not inset by the padding.
    expect(badge.localRect.x).toBe(0);
    expect(badge.localRect.y).toBe(0);
  });

  it("falls through to the nearest positioned ancestor when the grid is static", () => {
    const badge = makeNode({
      text: "hi",
      style: {
        position: "absolute",
        insets: { top: null, right: 0, bottom: null, left: null },
        gridColumnStart: line(1),
      },
    });
    const grid = makeNode({
      style: twoCols(),
      children: [makeNode({ text: "a" }), badge],
    });
    const root = makeNode({ style: { position: "relative" }, children: [grid] });
    layoutRoot(root, 30);
    // right: 0 resolves against the ROOT (30 wide), ignoring the grid's
    // column placement — the static grid is not a containing block.
    expect(badge.localRect.x).toBe(28);
  });
});

describe("named lines and areas", () => {
  const named = (name: string, nth?: number): GridLine =>
    nth === undefined ? { kind: "name", name } : { kind: "name", name, nth };

  it("parses line-name groups, merging around fixed repeats", () => {
    const parsed = parseTrackTemplate("[a] 40px repeat(2, [b] 1fr [c]) [d]", 16);
    expect(parsed).toEqual({
      kind: "tracks",
      tracks: [fixed(10), fr(), fr()],
      lineNames: [["a"], ["b"], ["c", "b"], ["c", "d"]],
    });
  });

  it("parses named placement longhands in any token order", () => {
    expect(parseGridLine("main")).toEqual({ kind: "name", name: "main" });
    expect(parseGridLine("2 col")).toEqual({ kind: "name", name: "col", nth: 2 });
    expect(parseGridLine("col -1")).toEqual({ kind: "name", name: "col", nth: -1 });
    expect(parseGridLine("span 2 col")).toEqual({ kind: "span", value: 2, name: "col" });
    expect(parseGridLine("span col")).toEqual({ kind: "span", value: 1, name: "col" });
  });

  it("parses grid-template-areas and rejects non-rectangular ones", () => {
    const areas = parseGridTemplateAreas('"head head" "nav main" ". main"');
    expect(areas?.columns).toBe(2);
    expect(areas?.rows).toBe(3);
    expect(areas?.areas.get("head")).toEqual({ colStart: 0, colEnd: 2, rowStart: 0, rowEnd: 1 });
    expect(areas?.areas.get("main")).toEqual({ colStart: 1, colEnd: 2, rowStart: 1, rowEnd: 3 });
    expect(parseGridTemplateAreas("none")).toBeNull();
    expect(parseGridTemplateAreas('"a a" "a b"')).toBeNull(); // L-shaped
    expect(parseGridTemplateAreas('"a a" "b"')).toBeNull(); // ragged
  });

  it("resolves names: area edges first, then nth occurrence, then implicit lines", () => {
    const lines = axis(3, { 0: ["main-start", "col"], 1: ["col"], 3: ["main-end"] });
    // Bare name → the -start / -end edge.
    expect(resolveAxisPlacement(named("main"), named("main"), lines)).toEqual({
      start: 0,
      span: 3,
    });
    // `2 col` → the second line named col; `-1 col` → the last.
    expect(resolveAxisPlacement(named("col", 2), autoLine(), lines)).toEqual({ start: 1, span: 1 });
    expect(resolveAxisPlacement(named("col", -1), autoLine(), lines)).toEqual({
      start: 1,
      span: 1,
    });
    // Only two `col` lines exist: the third is the first implicit line
    // past the explicit grid (line 4 = index 3 + 1).
    expect(resolveAxisPlacement(named("col", 3), autoLine(), lines)).toEqual({ start: 4, span: 1 });
    // A named span counts named lines from the definite edge.
    expect(
      resolveAxisPlacement(named("col", 1), { kind: "span", value: 1, name: "col" }, lines),
    ).toEqual({ start: 0, span: 1 });
  });

  it("lays out a dashboard from grid-template-areas and grid-area names", () => {
    const area = (name: string) => ({
      gridColumnStart: named(name),
      gridColumnEnd: named(name),
      gridRowStart: named(name),
      gridRowEnd: named(name),
    });
    const head = makeNode({ text: "h", style: area("head") });
    const nav = makeNode({ text: "n", style: area("nav") });
    const main = makeNode({ text: "m", style: area("main") });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(fixed(4), twFr()),
        gridTemplateAreas: parseGridTemplateAreas('"head head" "nav main" "nav main"'),
        gridAutoRows: [fixed(2)],
        gapX: 1,
      },
      // Document order deliberately scrambled: names place, not order.
      children: [main, nav, head],
    });
    layoutRoot(root, 20);
    // Columns: 4 + gap + 15. Rows: the areas define 3 rows, all sized by
    // grid-auto-rows (2 each) since the template defines none.
    expect(head.localRect).toMatchObject({ x: 0, y: 0, width: 20, height: 2 });
    expect(nav.localRect).toMatchObject({ x: 0, y: 2, width: 4, height: 4 });
    expect(main.localRect).toMatchObject({ x: 5, y: 2, width: 15, height: 4 });
  });

  it("places an absolute child by area name", () => {
    const overlay = makeNode({
      text: "o",
      style: {
        position: "absolute",
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        gridColumnStart: named("main"),
        gridColumnEnd: named("main"),
        gridRowStart: named("main"),
        gridRowEnd: named("main"),
      },
    });
    const root = makeNode({
      style: {
        display: "grid",
        position: "relative",
        gridTemplateColumns: tracks(fixed(4), twFr()),
        gridTemplateAreas: parseGridTemplateAreas('"nav main"'),
      },
      children: [makeNode({ text: "n" }), makeNode({ text: "m" }), overlay],
    });
    layoutRoot(root, 20);
    expect(overlay.localRect).toMatchObject({ x: 4, y: 0, width: 16, height: 1 });
  });
});

describe("subgrid", () => {
  const subgridCols = (): GridTemplate => ({ kind: "subgrid" });

  it("aligns a column-subgrid's items to the parent's tracks and lets them size those tracks", () => {
    const a = makeNode({ text: "a" });
    const bigB = makeNode({ text: "abcdefghij" }); // 10 wide, in the subgrid
    const c = makeNode({ text: "c" });
    const sub = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: subgridCols(),
        gridColumnStart: line(1),
        gridColumnEnd: line(4),
      },
      children: [a, bigB, c],
    });
    const top = makeNode({ text: "t1" });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(auto(), auto(), auto()),
        justifyContent: "start",
        gapX: 1,
      },
      children: [top, makeNode({ text: "t2" }), makeNode({ text: "t3" }), sub],
    });
    layoutRoot(root, 40);
    // The subgrid's middle item (10 wide) sized the parent's middle track:
    // parent tracks are [2, 10, 2], so the top row's items land on them.
    expect(top.localRect.width).toBe(2);
    expect(root.children[1]!.localRect.x).toBe(3);
    expect(root.children[1]!.localRect.width).toBe(10);
    expect(root.children[2]!.localRect.x).toBe(14);
    // Inside the subgrid, items sit on the same lines (subgrid-relative).
    expect(a.localRect.x).toBe(0);
    expect(bigB.localRect.x).toBe(3);
    expect(c.localRect.x).toBe(14);
    expect(sub.localRect.width).toBe(16);
  });

  it("adds the subgrid's border and padding to its edge tracks", () => {
    const inner = [makeNode({ text: "a" }), makeNode({ text: "b" })];
    const sub = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: subgridCols(),
        gridColumnStart: line(1),
        gridColumnEnd: line(3),
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        padding: { top: 0, right: 2, bottom: 0, left: 2 },
      },
      children: inner,
    });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(auto(), auto()),
        justifyContent: "start",
      },
      children: [makeNode({ text: "x" }), makeNode({ text: "y" }), sub],
    });
    layoutRoot(root, 40);
    // Each parent track fits its 1-wide item plus the subgrid's chrome on
    // that side (border 1 + padding 2): 4 + 4.
    expect(root.children[0]!.localRect.width).toBe(4);
    expect(root.children[1]!.localRect.x).toBe(4);
    expect(sub.localRect.width).toBe(8);
    // The subgrid's items sit inside its chrome, on the parent's lines.
    expect(inner[0]!.localRect.x).toBe(3);
    expect(inner[1]!.localRect.x).toBe(4);
    expect(inner[1]!.localRect.width).toBe(1);
  });

  it("row subgrids share the parent's rows across siblings (aligned cards)", () => {
    const card = (bodyText: string) => {
      const title = makeNode({ text: "title" });
      const body = makeNode({ text: bodyText });
      const foot = makeNode({ text: "foot" });
      const node = makeNode({
        style: {
          display: "grid",
          gridTemplateRows: { kind: "subgrid" },
          gridRowStart: span(3),
        },
        children: [title, body, foot],
      });
      return { node, title, body, foot };
    };
    const short = card("one line");
    const tall = card("aa bb cc dd"); // wraps to 2 lines at width 5
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(fixed(5), fixed(5)), gapY: 1 },
      children: [short.node, tall.node],
    });
    layoutRoot(root, 11);
    // The tall body (2 lines at width 5) sizes the shared middle row, so
    // both cards' footers land on the same row.
    expect(tall.body.localRect.height).toBe(2);
    expect(short.foot.localRect.y).toBe(tall.foot.localRect.y);
    expect(short.foot.localRect.y).toBe(1 + 1 + 2 + 1); // title, gap, body, gap
    expect(short.body.localRect.height).toBe(2); // stretched to the shared row
  });

  it("clamps subgrid placement to the inherited tracks (no implicit tracks)", () => {
    const beyond = makeNode({
      text: "z",
      style: { gridColumnStart: line(5), gridColumnEnd: line(9) },
    });
    const sub = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: subgridCols(),
        gridColumnStart: line(1),
        gridColumnEnd: line(3),
      },
      children: [beyond],
    });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(fixed(4), fixed(4)) },
      children: [sub],
    });
    layoutRoot(root, 20);
    // Lines 5–9 don't exist in a 2-track subgrid: the item lands in the
    // last track.
    expect(beyond.localRect.x).toBe(4);
    expect(beyond.localRect.width).toBe(4);
  });

  it("treats subgrid as none outside a grid parent", () => {
    const sub = makeNode({
      style: { display: "grid", gridTemplateColumns: subgridCols() },
      children: [makeNode({ text: "a" }), makeNode({ text: "b" })],
    });
    const root = makeNode({ children: [sub] });
    layoutRoot(root, 20);
    // No parent tracks to inherit → `none`: items auto-place into one
    // implicit column, stacking.
    expect(sub.children[1]!.localRect.y).toBe(1);
  });
});

describe("subgrid edge cases", () => {
  it("composes nested subgrids through both levels", () => {
    const deep = makeNode({ text: "abcdefgh" }); // 8 wide, two levels down
    const innerSub = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: { kind: "subgrid" },
        gridColumnStart: line(1),
        gridColumnEnd: line(3),
      },
      children: [makeNode({ text: "a" }), deep],
    });
    const outerSub = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: { kind: "subgrid" },
        gridColumnStart: line(1),
        gridColumnEnd: line(3),
      },
      children: [innerSub],
    });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(auto(), auto()),
        justifyContent: "start",
      },
      children: [makeNode({ text: "x" }), makeNode({ text: "y" }), outerSub],
    });
    layoutRoot(root, 40);
    // The grandchild's 8-cell text sized the ROOT's second track through
    // two subgrid levels; every level's items sit on the same lines.
    expect(root.children[1]!.localRect.x).toBe(1);
    expect(root.children[1]!.localRect.width).toBe(8);
    expect(deep.localRect.x).toBe(1);
    expect(deep.localRect.width).toBe(8);
  });

  it("subgrids both axes at once", () => {
    const items = [makeNode({ text: "a" }), makeNode({ text: "bb bb" })];
    const both = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: { kind: "subgrid" },
        gridTemplateRows: { kind: "subgrid" },
        gridColumnStart: line(1),
        gridColumnEnd: line(3),
        gridRowStart: span(1),
      },
      children: items,
    });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: tracks(fixed(4), fixed(2)), gapX: 1 },
      children: [both],
    });
    layoutRoot(root, 7);
    // Columns: parent's [4, 2] with the 1-cell gap; rows: the single
    // shared row sized by the wrapped second item ("bb bb" at width 2 →
    // 2 lines... wait, width 2 track: "bb" per line → 3 lines? "bb bb"
    // → "bb"/"bb" = 2 lines).
    expect(items[0]!.localRect).toMatchObject({ x: 0, width: 4 });
    expect(items[1]!.localRect).toMatchObject({ x: 5, width: 2, height: 2 });
    expect(items[0]!.localRect.height).toBe(2); // stretched to the shared row
    expect(both.localRect.height).toBe(2);
  });

  it("an empty subgrid still claims its chrome from the parent's tracks", () => {
    const empty = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: { kind: "subgrid" },
        gridColumnStart: line(1),
        gridColumnEnd: line(2),
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        padding: { top: 0, right: 2, bottom: 0, left: 2 },
      },
      children: [],
    });
    const root = makeNode({
      style: {
        display: "grid",
        gridTemplateColumns: tracks(auto()),
        justifyContent: "start",
      },
      children: [empty],
    });
    layoutRoot(root, 20);
    // No items, but the track still fits the subgrid's own chrome:
    // border 1+1 + padding 2+2 = 6.
    expect(empty.localRect.width).toBe(6);
  });
});

describe("named-line edge cases", () => {
  const named = (name: string, nth?: number): GridLine =>
    nth === undefined ? { kind: "name", name } : { kind: "name", name, nth };

  it("merges auto-repeat line names at layout time", () => {
    // "[a] repeat(auto-fill, [b] 8cells [c]) [d]" at width 26, gap 0:
    // count = 3 → lines: [a b] [c b] [c b] [c d].
    const template: GridTemplate = {
      kind: "tracks",
      tracks: [],
      lineNames: [["d"]],
      autoRepeat: {
        index: 0,
        tracks: [fixed(8)],
        lineNames: [["b"], ["c"]],
        leadingNames: ["a"],
        mode: "auto-fill",
      },
    };
    const first = makeNode({
      text: "x",
      style: { gridColumnStart: named("a"), gridColumnEnd: { kind: "span", value: 1, name: "c" } },
    });
    const second = makeNode({
      text: "y",
      style: { gridColumnStart: named("c", 2), gridColumnEnd: named("d") },
    });
    const root = makeNode({
      style: { display: "grid", gridTemplateColumns: template, justifyContent: "start" },
      children: [first, second],
    });
    layoutRoot(root, 26);
    // `a` names the first line; `span 1 c` reaches the first c-line.
    expect(first.localRect).toMatchObject({ x: 0, width: 8 });
    // `2 c` is the second c-line (line 16) through to `d` (the last
    // line, at 24 — the 2 leftover cells sit past the tracks).
    expect(second.localRect).toMatchObject({ x: 16, width: 8 });
  });

  it("walks a missing negative nth into the implicit grid before line 0", () => {
    // One line named `edge` (index 1 of 2 tracks); `-2 edge` needs a
    // second from the end → the first implicit line before the grid.
    expect(
      resolveAxisPlacement(named("edge", -2), named("edge", -1), axis(2, { 1: ["edge"] })),
    ).toEqual({ start: -1, span: 2 });
  });
});
