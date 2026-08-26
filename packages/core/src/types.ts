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
  | { kind: "auto" };

export type Display = "block" | "flex" | "grid" | "none";
export type FlexDirection = "row" | "column";
export type FlexWrap = "nowrap" | "wrap";
export type JustifyContent = "start" | "center" | "end" | "space-between";
export type AlignItems = "start" | "center" | "end" | "stretch";
export type AlignSelf = "auto" | "start" | "center" | "end" | "stretch";
export type BorderStyle = "solid" | "double" | "dashed" | "dotted";
export type Overflow = "visible" | "clip";

export interface CellStyle {
  display: Display;
  flexDirection: FlexDirection;
  flexWrap: FlexWrap;
  flexGrow: number;
  flexShrink: number;
  justifyContent: JustifyContent;
  alignItems: AlignItems;
  alignSelf: AlignSelf;
  width: Size | undefined;
  height: Size | undefined;
  minWidth: number;
  minHeight: number;
  maxWidth: number | undefined;
  maxHeight: number | undefined;
  padding: Insets;
  margin: NullableInsets;
  gapX: number;
  gapY: number;
  border: Insets;
  borderStyle: BorderStyle;
  borderColor: string | undefined;
  overflow: Overflow;
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
}

export interface CellMetrics {
  width: number;
  height: number;
}

export function defaultCellStyle(): CellStyle {
  return {
    display: "block",
    flexDirection: "row",
    flexWrap: "nowrap",
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: "start",
    alignItems: "start",
    alignSelf: "auto",
    width: undefined,
    height: undefined,
    minWidth: 0,
    minHeight: 0,
    maxWidth: undefined,
    maxHeight: undefined,
    padding: zeroInsets(),
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    gapX: 0,
    gapY: 0,
    border: zeroInsets(),
    borderStyle: "solid",
    overflow: "visible",
    color: undefined,
    backgroundColor: undefined,
    borderColor: undefined,
    textAlignBlocked: false,
  };
}

export function zeroInsets(): Insets {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}
