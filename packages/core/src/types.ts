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
  | "space-evenly";
export type AlignItems = "start" | "center" | "end" | "stretch";
export type AlignSelf = "auto" | "start" | "center" | "end" | "stretch";
export type BorderStyle = "solid" | "double" | "dashed" | "dotted";
export type Overflow = "visible" | "clip";
export type Position = "static" | "relative" | "absolute" | "fixed" | "sticky";
export type WhiteSpace = "normal" | "nowrap";

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
  alignItems: AlignItems;
  alignSelf: AlignSelf;
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
  /** `nowrap` disables soft wrapping (hard `<br>` breaks still apply). */
  whiteSpace: WhiteSpace;
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
      };
  /** Per-character cell advances for tracked leaf text (`1 + tracking` of
   * the character's innermost element, specs/cell-model.md); absent when
   * every character is a plain 1-cell advance. */
  advances?: number[];
  /** Inline descendants of a leaf. The renderer writes each one's grid
   * tracking and — for the positioned ones — its relative insets rewritten
   * to whole cells (specs/positioning.md); `null` insets = not positioned. */
  inlineElements?: {
    element: Element;
    tracking: number;
    insets: PerSide<number | null> | null;
  }[];
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
    justifyContent: "start",
    alignItems: "start",
    alignSelf: "auto",
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
