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
export type WhiteSpace = "normal" | "nowrap";

/** A length in whole cells, or a percentage kept symbolic until layout.
 * Percentages resolve against the CSS-appropriate basis at layout time:
 * the available extent for min/max (`max-w-full` = 100%), the containing
 * block's WIDTH for padding and margins (all four sides, per CSS), and the
 * container's own content box in the gap's axis for gaps. */
export type CellLength = number | { percent: number };
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
  minWidth: CellLength | "auto";
  minHeight: CellLength | "auto";
  maxWidth: CellLength | undefined;
  maxHeight: CellLength | undefined;
  padding: PerSide<CellLength>;
  /** `null` = `auto`. Percentages resolve against the parent's content
   * width where the margin is consumed. */
  margin: PerSide<CellLength | null>;
  gapX: CellLength;
  gapY: CellLength;
  border: Insets;
  borderStyle: PerSide<BorderStyle>;
  borderColor: PerSide<string | undefined>;
  overflow: Overflow;
  /** `nowrap` disables soft wrapping (hard `<br>` breaks still apply). */
  whiteSpace: WhiteSpace;
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
  /** Raw text content of the element's direct text nodes (leaves only). Empty
   * for pure containers. May coexist with child element nodes when the
   * element has mixed text+element children. */
  text: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  localRect: Rect;
  /** Outer height before min/max clamping — written by layoutNode; the
   * column flex algorithm's base main size (CSS distributes from unclamped
   * bases; limits apply via its freeze loop). */
  unclampedHeight: number;
  /** Padding with percentages resolved to cells — written by layoutNode
   * (percent resolves against the containing block width, which only
   * layout knows); the renderers read this, never `style.padding`. */
  resolvedPadding: Insets;
}

export interface CellMetrics {
  width: number;
  height: number;
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
    gapX: 0,
    gapY: 0,
    border: zeroInsets(),
    borderStyle: { top: "solid", right: "solid", bottom: "solid", left: "solid" },
    overflow: "visible",
    whiteSpace: "normal",
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
