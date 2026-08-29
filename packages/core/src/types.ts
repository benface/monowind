export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Insets where any side can be `null` to signal `auto` (used for margins). */
export interface NullableInsets {
  top: number | null;
  right: number | null;
  bottom: number | null;
  left: number | null;
}

export type Size =
  | { kind: "cells"; value: number }
  | { kind: "percent"; value: number }
  | { kind: "auto" }
  /** Intrinsic sizing keywords (`w-min` / `w-max` / `w-fit`). Resolved
   * against content: min-content = longest unbreakable unit, max-content =
   * unwrapped size, fit-content = shrink-to-fit within the available space.
   * Only honored for `width`; on `height` they behave as `auto` (content
   * height already is the intrinsic height). */
  | { kind: "min-content" }
  | { kind: "max-content" }
  | { kind: "fit-content" };

export type Display = "block" | "flex" | "grid" | "none";
export type FlexDirection = "row" | "column";
export type FlexWrap = "nowrap" | "wrap";
export type JustifyContent =
  | "start"
  | "center"
  | "end"
  | "space-between"
  | "space-around"
  | "space-evenly"
  /** CSS `normal` / `stretch`. In flex both behave as `start` (per
   * css-align); in grid they stretch auto-sized tracks over leftover space
   * (CSS Grid §11.8) and otherwise behave as `start`. */
  | "stretch";
export type AlignItems = "start" | "center" | "end" | "stretch";
/** Multi-line cross distribution (`content-*`); `stretch` (the CSS
 * default `normal`) grows flex lines / grid tracks instead of offsetting
 * them. */
export type AlignContent = JustifyContent;
export type AlignSelf = "auto" | "start" | "center" | "end" | "stretch";
export type BorderStyle = "solid" | "double" | "dashed" | "dotted";
export type Overflow = "visible" | "clip";
export type Position = "static" | "relative" | "absolute" | "fixed" | "sticky";
/** `nowrap` disables soft wrapping; `pre` additionally preserves the
 * source's spaces and newlines (specs/cell-model.md). Everything else
 * (`pre-wrap` included) behaves as `normal`. */
export type WhiteSpace = "normal" | "nowrap" | "pre";

/** A length in whole cells, or a percentage kept symbolic until layout.
 * Percentages resolve against the CSS-appropriate basis at layout time:
 * the available extent for min/max (`max-w-full` = 100%), the containing
 * block's WIDTH for padding and margins (all four sides, per CSS), and the
 * container's own content box in the gap's axis for gaps. */
export type CellLength = number | { percent: number };

/** A min/max constraint: a CellLength, or an intrinsic sizing keyword
 * (`max-w-max` = `max-width: max-content`, …). Keywords are honored on
 * width limits and behave as "no constraint" on height limits (content
 * height already is the intrinsic height). */
export type SizeLimit = CellLength | "min-content" | "max-content" | "fit-content";
export type TextOverflow = "clip" | "ellipsis";

/** One bound of a grid track size (specs/grid.md). `fr` is only valid as a
 * max (the reader normalizes bare `<n>fr` to `minmax(auto, <n>fr)`, per
 * CSS); percent resolves against the container's content box in the
 * track's axis (indefinite axis → treated as `auto`). */
export type TrackBreadth =
  | { kind: "cells"; value: number }
  | { kind: "percent"; value: number }
  | { kind: "fr"; value: number }
  | { kind: "auto" }
  | { kind: "min-content" }
  | { kind: "max-content" }
  /** `min()` / `max()` over fixed breadths — the canonical responsive
   * auto-fill pattern `minmax(min(8rem, 100%), 1fr)`. Resolvable only
   * when every argument is (a percent argument needs a definite axis);
   * otherwise the whole function behaves as `auto`. `calc()` arithmetic
   * stays unsupported (specs/grid.md deviations). */
  | { kind: "math"; fn: "min" | "max"; args: TrackBreadth[] };

/** A grid track as a normalized minmax pair — every track-size form reads
 * as one (`8rem` → minmax(cells, cells), `1fr` → minmax(auto, fr), …). */
export interface TrackSize {
  min: TrackBreadth;
  max: TrackBreadth;
}

/** A parsed `grid-template-columns` / `grid-template-rows`. Fixed repeats
 * are expanded at read time; an `auto-fill` / `auto-fit` repetition stays
 * symbolic (`autoRepeat`, spliced in at `tracks[autoRepeat.index]`) and
 * resolves its count at layout time against the definite axis size. */
export type GridTemplate =
  | { kind: "none" }
  | { kind: "subgrid" }
  | {
      kind: "tracks";
      tracks: TrackSize[];
      /** `[name …]` groups: `lineNames[i]` names line i (0 … tracks.length).
       * Absent when the template names no lines. */
      lineNames?: string[][];
      autoRepeat?: {
        index: number;
        tracks: TrackSize[];
        /** Names inside the repetition (tracks.length + 1 entries); the
         * edge groups merge with neighbors at every iteration boundary. */
        lineNames?: string[][];
        /** Names authored just before the `repeat()` — they attach to the
         * first repeated line once the count is known. */
        leadingNames?: string[];
        mode: "auto-fill" | "auto-fit";
      };
    };

/** One side of a grid item's placement (`grid-column-start`, …): a line
 * number (negative counts from the explicit grid's end, per CSS), a span
 * (optionally counting only lines with a name), a named line (`foo`, or
 * `<n> foo` — `nth` absent for the bare form, whose area-edge lookup
 * comes first, specs/grid.md), or auto. */
export type GridLine =
  | { kind: "auto" }
  | { kind: "line"; value: number }
  | { kind: "span"; value: number; name?: string }
  | { kind: "name"; name: string; nth?: number };

/** A named area from `grid-template-areas`, as 0-based line indices
 * (`colEnd` / `rowEnd` exclusive of the last cell's track). */
export interface GridArea {
  colStart: number;
  colEnd: number;
  rowStart: number;
  rowEnd: number;
}

/** `grid-template-areas`: the row/column count it defines and its
 * (rectangular) named areas. */
export interface GridAreas {
  columns: number;
  rows: number;
  areas: Map<string, GridArea>;
}

export interface GridAutoFlow {
  direction: "row" | "column";
  dense: boolean;
}

/** Tracks a subgrid inherits from its parent grid in a subgridded axis
 * (specs/grid.md), projected into the subgrid's CONTENT-box coordinates:
 * the first and last tracks are shrunk by the subgrid's own margin,
 * border, and padding on that side, so its items still land on the
 * parent's lines. `gap` is the parent's gutter. */
export interface InheritedTracks {
  positions: number[];
  sizes: number[];
  gapBefore: number[];
  gap: number;
}

/** One value per box edge (border style, border color, …). */
export interface PerSide<T> {
  top: T;
  right: T;
  bottom: T;
  left: T;
}

export interface CellStyle {
  display: Display;
  flexDirection: FlexDirection;
  /** True for `row-reverse` / `column-reverse`: the main axis runs
   * backwards — items lay out in reverse order and `justify-content`
   * start/end swap meaning. */
  flexReverse: boolean;
  flexWrap: FlexWrap;
  /** True for `wrap-reverse`: lines stack from the cross-end (bottom-up). */
  wrapReverse: boolean;
  flexGrow: number;
  flexShrink: number;
  /** CSS `flex-basis`: the flex base size when not `auto`/undefined —
   * notably `0%` from Tailwind's `flex-1`, which makes grow distribute ALL
   * the space (equal columns) instead of just the extra. */
  flexBasis: Size | undefined;
  /** CSS `order` — flex items sort by it (stable, document order ties). */
  order: number;
  justifyContent: JustifyContent;
  /** Flex: multi-line (wrap-enabled) containers only, per CSS. Grid: row
   * track distribution. */
  alignContent: AlignContent;
  alignItems: AlignItems;
  alignSelf: AlignSelf;
  /** Grid container inline-axis item alignment (`justify-items`); the CSS
   * default `normal` behaves as `stretch` in grid. */
  justifyItems: AlignItems;
  /** Grid item inline-axis self-alignment override (`justify-self`). */
  justifySelf: AlignSelf;
  /** Parsed track templates (specs/grid.md). `none` for non-grid elements. */
  gridTemplateColumns: GridTemplate;
  gridTemplateRows: GridTemplate;
  /** Sizes for implicit tracks (`grid-auto-columns` / `grid-auto-rows`),
   * cycled across the implicit tracks in each axis. Never empty — the CSS
   * initial value is a single `auto`. */
  gridAutoColumns: TrackSize[];
  gridAutoRows: TrackSize[];
  gridAutoFlow: GridAutoFlow;
  /** Parsed `grid-template-areas`; `null` for `none` or an invalid value
   * (per CSS the whole property then doesn't apply). */
  gridTemplateAreas: GridAreas | null;
  /** Grid item placement longhands. `auto` on non-grid-item elements. */
  gridColumnStart: GridLine;
  gridColumnEnd: GridLine;
  gridRowStart: GridLine;
  gridRowEnd: GridLine;
  width: Size | undefined;
  height: Size | undefined;
  /** `"auto"` is CSS `min-width/height: auto`: 0 in block flow, but a flex
   * item's automatic minimum (its min-content size, when overflow is
   * visible) on the flex main axis — the reason text in a flex row stops
   * shrinking instead of vanishing, and why `min-w-0` exists. */
  minWidth: SizeLimit | "auto";
  minHeight: SizeLimit | "auto";
  maxWidth: SizeLimit | undefined;
  maxHeight: SizeLimit | undefined;
  padding: PerSide<CellLength>;
  /** `null` = `auto`. Percentages resolve against the parent's content
   * width where the margin is consumed. */
  margin: PerSide<CellLength | null>;
  /** See specs/positioning.md: fixed behaves as absolute anchored to the
   * host; sticky behaves as relative until the scrolling milestone. */
  position: Position;
  /** `top/right/bottom/left`; `null` = `auto`. Percentages resolve against
   * the containing block (width for left/right, height for top/bottom). */
  insets: PerSide<CellLength | null>;
  gapX: CellLength;
  gapY: CellLength;
  border: Insets;
  borderStyle: PerSide<BorderStyle>;
  borderColor: PerSide<string | undefined>;
  overflow: Overflow;
  whiteSpace: WhiteSpace;
  /** CSS `tab-size` in cells — tab stops for preserved (`pre`) text,
   * expanded by the tree builder from each hard line's start. */
  tabSize: number;
  /** Empty rows between wrapped lines (`leading-*` re-quantized to the
   * grid: rows per line − 1). See specs/cell-model.md. */
  lineGap: number;
  /** Extra cells after every character (`tracking-*` re-quantized:
   * floor((letter-spacing − root letter-spacing) ÷ 0.025em)). */
  tracking: number;
  /** Paint-only: with `nowrap` + clipping, the browser draws the ellipsis.
   * The engine only needs it for the ASCII renderer's mirror of that. */
  textOverflow: TextOverflow;
  /**
   * Paint-only colors, reserved for the visual-system milestone. `color` will
   * feed decoration glyphs that visually belong to the text (control framing
   * like `[ Save ]`, cursors, selection carets); `backgroundColor` will feed
   * cell-level highlights (selection ranges, decoration backgrounds). Read
   * from the source element now so the future work has the data available.
   */
  color: string | undefined;
  backgroundColor: string | undefined;
  /** True when text-align is center/justify — forced back to `start` since
   * per-line centering can't be snapped to whole cells. See cell-model spec. */
  textAlignBlocked: boolean;
}

export interface LayoutNode {
  source: Element;
  style: CellStyle;
  children: LayoutNode[];
  /** The leaf's text run (inline descendants included, `<br>` as `\n`).
   * Empty for containers — their direct text nodes are not laid out. */
  text: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  localRect: Rect;
  /** Where an out-of-flow (absolute) box would have sat in normal flow —
   * its CSS "static position", parent-relative, recorded by the parent's
   * flow pass and consumed by the absolute-positioning pass for inset-less
   * axes. Flex parents record the container's content box plus alignment
   * so the "as if sole flex item" rule can apply once the box is sized. */
  staticSlot?:
    | { kind: "block"; x: number; y: number }
    | {
        kind: "flex";
        direction: FlexDirection;
        originX: number;
        originY: number;
        innerWidth: number;
        innerHeight: number;
      }
    /** Grid parents (specs/grid.md §10.1): `area` is the child's grid
     * area (its containing block when the grid container is positioned)
     * and `staticArea` the sole-item area for inset-less axes — both
     * parent-relative border-box rects. */
    | { kind: "grid"; area: Rect; staticArea: Rect };
  /** Per-character cell advances for tracked leaf text (`1 + tracking` of
   * the character's innermost element, specs/cell-model.md); absent when
   * every character is a plain 1-cell advance. */
  advances?: number[];
  /** Inline descendants of a leaf. The renderer writes each one's grid
   * tracking, its quantized horizontal padding (the run reserves the
   * cells as INLINE_PAD markers; the browser applies the same cells as
   * real padding via engine-owned vars), and — for the positioned ones —
   * its relative insets rewritten to whole cells (specs/positioning.md);
   * `null` insets = not positioned. */
  inlineElements?: {
    element: Element;
    tracking: number;
    padLeft: number;
    padRight: number;
    insets: PerSide<number | null> | null;
  }[];
  /** True on an atomic inline-level box (`inline-flex`/`inline-block`/
   * `inline-grid`) riding its parent leaf's text run as a single
   * unbreakable unit: the leaf's run holds an OBJECT REPLACEMENT
   * CHARACTER (U+FFFC) for it whose advance is the box's laid-out width.
   * The box stays IN FLOW in the browser (sized to whole cells by the
   * companion stylesheet) so the browser's own line layout places it —
   * engine and browser agree because both treat it as an atomic unit of
   * the same width (specs/cell-model.md). */
  inlineBox?: boolean;
  /** Set by a grid parent on a child whose template is `subgrid` in at
   * least one axis: the child's span in each axis (its explicit track
   * count there — placement clamps to it) and, once the parent has sized
   * that axis, the inherited tracks. Rows arrive in the parent's second
   * pass: the first pass lays the subgrid out provisionally (its own
   * items' heights feed the parent's row sizing). Absent on everything
   * else — a `subgrid` template then behaves as `none`, per CSS. */
  subgrid?:
    | {
        colSpan: number;
        rowSpan: number;
        cols?: InheritedTracks | undefined;
        rows?: InheritedTracks | undefined;
      }
    | undefined;
  /** True on a container whose direct text nodes were dropped (mixed
   * text + in-flow block children — cell-model deviation). The renderer
   * hides that text and warns instead of letting the browser paint it
   * unpositioned. */
  droppedText?: boolean;
  /** Outer height before min/max clamping — written by layoutNode; the
   * column flex algorithm's base main size (CSS distributes from unclamped
   * bases; limits apply via its freeze loop). */
  unclampedHeight: number;
  /** Padding with percentages resolved to cells — written by layoutNode
   * (percent resolves against the containing block width, which only
   * layout knows); the renderers read this, never `style.padding`. */
  resolvedPadding: Insets;
}

/** The root's cell, in px: width = glyph advance + the root's
 * letter-spacing, height = the root's line box (specs/cell-model.md).
 * `letterSpacing` is the root's, kept so descendant tracking can be read
 * relative to it. */
export interface CellMetrics {
  width: number;
  height: number;
  letterSpacing: number;
}

export function defaultCellStyle(): CellStyle {
  return {
    display: "block",
    flexDirection: "row",
    flexReverse: false,
    flexWrap: "nowrap",
    wrapReverse: false,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: undefined,
    order: 0,
    // The CSS initial value `normal` reads as `stretch` (flex treats it
    // as `start`; grid stretches auto tracks).
    justifyContent: "stretch",
    alignContent: "stretch",
    alignItems: "stretch",
    alignSelf: "auto",
    justifyItems: "stretch",
    justifySelf: "auto",
    gridTemplateColumns: { kind: "none" },
    gridTemplateRows: { kind: "none" },
    gridAutoColumns: [autoTrack()],
    gridAutoRows: [autoTrack()],
    gridAutoFlow: { direction: "row", dense: false },
    gridTemplateAreas: null,
    gridColumnStart: { kind: "auto" },
    gridColumnEnd: { kind: "auto" },
    gridRowStart: { kind: "auto" },
    gridRowEnd: { kind: "auto" },
    width: undefined,
    height: undefined,
    minWidth: "auto",
    minHeight: "auto",
    maxWidth: undefined,
    maxHeight: undefined,
    padding: zeroInsets(),
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    position: "static",
    insets: { top: null, right: null, bottom: null, left: null },
    gapX: 0,
    gapY: 0,
    border: zeroInsets(),
    borderStyle: { top: "solid", right: "solid", bottom: "solid", left: "solid" },
    overflow: "visible",
    whiteSpace: "normal",
    tabSize: 8,
    lineGap: 0,
    tracking: 0,
    textOverflow: "clip",
    color: undefined,
    backgroundColor: undefined,
    borderColor: { top: undefined, right: undefined, bottom: undefined, left: undefined },
    textAlignBlocked: false,
  };
}

export function zeroInsets(): Insets {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/** The CSS initial implicit-track size: `minmax(auto, auto)`. */
export function autoTrack(): TrackSize {
  return { min: { kind: "auto" }, max: { kind: "auto" } };
}
