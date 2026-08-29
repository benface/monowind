import { pxToCells, roundHalfAwayFromZero } from "./metrics.ts";
import type {
  AlignContent,
  AlignItems,
  BorderStyle,
  CellLength,
  CellMetrics,
  CellStyle,
  Display,
  Insets,
  JustifyContent,
  PerSide,
  Position,
  Size,
  SizeLimit,
} from "./types.ts";

/**
 * Read the interpreted CellStyle for an element from its computed CSS.
 *
 * The host must have the `measuring` attribute set while this runs so the
 * engine's own geometry rules (from styles.css) don't feed their outputs back
 * into what we read.
 *
 * `metrics` (the host's measured cell) is the basis for leading and
 * tracking; absent in headless tests, where the cell height defaults to
 * the font size and the root letter-spacing to 0.
 */
export function readCellStyle(
  el: Element,
  rootFontSizePx: number,
  metrics?: CellMetrics,
): CellStyle {
  const cs = getComputedStyle(el);
  const fontSizePx = parseFloat(cs.fontSize) || rootFontSizePx;
  const csm = supportsTypedOM(el) ? el.computedStyleMap() : null;
  const classAttr = el.getAttribute("class") ?? "";
  const inlineStyle = (el as HTMLElement).style;

  // Atomic inline-level boxes lay their CONTENT out like their block-level
  // counterparts (the tree builder blockifies the box itself onto its own
  // row — cell-model deviation).
  const rawDisplay = cs.display;
  const display: Display =
    rawDisplay === "flex" || rawDisplay === "inline-flex"
      ? "flex"
      : rawDisplay === "grid" || rawDisplay === "inline-grid"
        ? "grid"
        : rawDisplay === "none"
          ? "none"
          : "block";

  return {
    display,
    flexDirection: cs.flexDirection.startsWith("column") ? "column" : "row",
    flexReverse: cs.flexDirection.endsWith("-reverse"),
    flexWrap: cs.flexWrap.startsWith("wrap") ? "wrap" : "nowrap",
    wrapReverse: cs.flexWrap === "wrap-reverse",
    flexGrow: Number(cs.flexGrow) || 0,
    flexShrink: cs.flexShrink === "" ? 1 : Number(cs.flexShrink) || 0,
    // flex-basis keeps its computed form (percentages stay symbolic), so
    // plain getComputedStyle is reliable here — `flex-1` reads as "0%".
    flexBasis: readFlexBasis(cs.flexBasis, rootFontSizePx),
    order: Number(cs.order) || 0,
    justifyContent: mapJustify(cs.justifyContent),
    alignContent: mapAlignContent(cs.alignContent),
    alignItems: mapAlign(cs.alignItems),
    alignSelf: mapAlignSelf(cs.alignSelf),
    width: readSize(csm, cs.width, "width", rootFontSizePx, classAttr, inlineStyle),
    height: readSize(csm, cs.height, "height", rootFontSizePx, classAttr, inlineStyle),
    minWidth: readLimit(cs.minWidth, rootFontSizePx) ?? "auto",
    minHeight: readLimit(cs.minHeight, rootFontSizePx) ?? "auto",
    maxWidth: readLimit(cs.maxWidth, rootFontSizePx),
    maxHeight: readLimit(cs.maxHeight, rootFontSizePx),
    padding: readPadding(cs, rootFontSizePx),
    margin: readMargin(cs, csm, classAttr, rootFontSizePx),
    position: readPosition(cs.position),
    insets: readInsets(cs, csm, classAttr, inlineStyle, rootFontSizePx),
    gapX: readSpacing(cs.columnGap === "normal" ? "0px" : cs.columnGap, rootFontSizePx),
    gapY: readSpacing(cs.rowGap === "normal" ? "0px" : cs.rowGap, rootFontSizePx),
    border: readBorderInsets(cs),
    borderStyle: {
      top: mapBorderStyle(cs.borderTopStyle),
      right: mapBorderStyle(cs.borderRightStyle),
      bottom: mapBorderStyle(cs.borderBottomStyle),
      left: mapBorderStyle(cs.borderLeftStyle),
    },
    // Treat `hidden` and `clip` the same — both keep content inside the
    // box. Normalized to `clip` internally since that's the more precise
    // semantic for what we do (no scroll container, cheaper). Longhands
    // (`overflow-x`/`overflow-y`) are honored: setting just one axis to
    // hidden or clip still marks the element as clipping. `auto` and
    // `scroll` are left as "visible" here — real scrolling is deferred to
    // the scrolling milestone.
    overflow:
      isClipping(cs.overflow) || isClipping(cs.overflowX) || isClipping(cs.overflowY)
        ? "clip"
        : "visible",
    // `nowrap` and `pre` disable soft wrapping; `pre`'s whitespace
    // preservation is NOT honored (documented deviation — the tree builder
    // collapses whitespace). Readable via getComputedStyle because the
    // companion stylesheet's white-space lock is gated on `:not([measuring])`.
    whiteSpace: cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre" ? "nowrap" : "normal",
    // Both readable because the companion stylesheet's typography rewrite
    // is gated on `:not([measuring])`.
    lineGap: lineGapRows(cs.lineHeight, metrics?.height ?? fontSizePx),
    tracking: trackingCells(cs.letterSpacing, fontSizePx, metrics?.letterSpacing ?? 0),
    textOverflow: cs.textOverflow === "ellipsis" ? "ellipsis" : "clip",
    color: cs.color,
    backgroundColor: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? undefined : cs.backgroundColor,
    borderColor: {
      top: cs.borderTopColor,
      right: cs.borderRightColor,
      bottom: cs.borderBottomColor,
      left: cs.borderLeftColor,
    },
    // Detect authored text-align via class + inline style rather than
    // getComputedStyle, since our own override would otherwise be echoed
    // back and cause oscillation. Inheritance is handled by CSS: forcing
    // `text-align: start` on the element that authors center/justify
    // cascades to its descendants automatically.
    textAlignBlocked: authoredTextAlignBlocked(classAttr, inlineStyle),
  };
}

function isClipping(value: string): boolean {
  return value === "hidden" || value === "clip";
}

function authoredTextAlignBlocked(classAttr: string, inlineStyle: CSSStyleDeclaration): boolean {
  if (/(?:^|[\s:.[!])text-(?:center|justify)/.test(classAttr)) return true;
  const inline = inlineStyle.textAlign;
  return inline === "center" || inline === "justify";
}

function supportsTypedOM(
  el: Element,
): el is Element & { computedStyleMap(): StylePropertyMapReadOnly } {
  return typeof (el as { computedStyleMap?: unknown }).computedStyleMap === "function";
}

function mapJustify(value: string): JustifyContent {
  switch (value) {
    case "center":
      return "center";
    case "flex-end":
    case "end":
    case "right":
      return "end";
    case "space-between":
      return "space-between";
    case "space-around":
      return "space-around";
    case "space-evenly":
      return "space-evenly";
    default:
      return "start";
  }
}

/** CSS initial `normal` behaves as `stretch` for align-content in flex. */
function mapAlignContent(value: string): AlignContent {
  if (value === "stretch" || value === "normal" || value === "") return "stretch";
  return mapJustify(value);
}

function mapAlign(value: string): AlignItems {
  switch (value) {
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "end";
    case "stretch":
    // CSS default for align-items on a flex container is "normal", which
    // behaves as "stretch" in flex/grid contexts.
    case "normal":
    case "":
      return "stretch";
    default:
      return "start";
  }
}

function mapAlignSelf(value: string): "auto" | AlignItems {
  if (value === "auto" || value === "" || value === "normal") return "auto";
  return mapAlign(value);
}

/**
 * Read margins, preserving `auto` as `null`.
 *
 * `getComputedStyle` returns *used* values for margins on flex items, which
 * means an authored `auto` has already been resolved to a pixel length by
 * the browser's own flex pass — we can't tell "auto" from a fixed number
 * anymore. Typed OM returns *computed* values, so "auto" survives; we use it
 * as the source of truth when available.
 *
 * On engines without Typed OM (Firefox pre-157), fall back to scanning the
 * class attribute for Tailwind auto-margin utilities. LTR only for now.
 */
function readMargin(
  cs: CSSStyleDeclaration,
  csm: StylePropertyMapReadOnly | null,
  classAttr: string,
  rootFontSizePx: number,
): PerSide<CellLength | null> {
  const readSide = (
    physical: string,
    logical: string,
    autoClassPattern: RegExp,
  ): CellLength | null => {
    if (csm) {
      const physicalValue = csm.get(physical)?.toString().trim();
      if (physicalValue === "auto") return null;
      const logicalValue = csm.get(logical)?.toString().trim();
      if (logicalValue === "auto") return null;
      // Percent margins must stay symbolic (getComputedStyle would hand
      // back a used px value resolved against the pre-grid natural layout).
      if (physicalValue?.endsWith("%")) {
        const percent = parseFloat(physicalValue);
        if (Number.isFinite(percent) && percent !== 0) return { percent };
      }
    } else if (autoClassPattern.test(classAttr)) {
      return null;
    }
    const physicalValue = cs.getPropertyValue(physical);
    if (physicalValue === "auto") return null;
    const physicalCells = readSpacing(physicalValue, rootFontSizePx);
    if (physicalCells !== 0) return physicalCells;
    const logicalValue = cs.getPropertyValue(logical);
    if (logicalValue === "auto") return null;
    return readSpacing(logicalValue, rootFontSizePx);
  };
  return {
    top: readSide("margin-top", "margin-block-start", /(?:^|[\s:.[!])(?:m|my|mt)-auto\b/),
    right: readSide("margin-right", "margin-inline-end", /(?:^|[\s:.[!])(?:m|mx|mr|me)-auto\b/),
    bottom: readSide("margin-bottom", "margin-block-end", /(?:^|[\s:.[!])(?:m|my|mb)-auto\b/),
    left: readSide("margin-left", "margin-inline-start", /(?:^|[\s:.[!])(?:m|mx|ml|ms)-auto\b/),
  };
}

/** Extra cells after each character: floor((letter-spacing − root
 * letter-spacing) ÷ 0.025em), never negative (specs/cell-model.md). The
 * root's own letter-spacing is part of the cell, so only the excess over
 * it (inherited by default) counts. */
export function trackingCells(
  letterSpacing: string,
  fontSizePx: number,
  rootLetterSpacingPx: number,
): number {
  const px =
    (letterSpacing === "normal" ? 0 : parseFloat(letterSpacing) || 0) - rootLetterSpacingPx;
  if (px <= 0) return 0;
  return Math.floor(px / (0.025 * fontSizePx) + 1e-6);
}

/** Empty rows between wrapped lines: floor(line-height ÷ cell height) − 1,
 * never negative. Computed line-height is always px (or `normal`). */
function lineGapRows(lineHeight: string, cellHeightPx: number): number {
  if (!lineHeight || lineHeight === "normal" || cellHeightPx <= 0) return 0;
  const px = parseFloat(lineHeight);
  if (!Number.isFinite(px)) return 0;
  return Math.max(0, Math.floor(px / cellHeightPx + 1e-6) - 1);
}

function readPosition(value: string): Position {
  switch (value) {
    case "relative":
    case "absolute":
    case "fixed":
    case "sticky":
      return value;
    default:
      return "static";
  }
}

/**
 * Read insets, preserving `auto` as `null`.
 *
 * Same trap as margins: on POSITIONED elements, `getComputedStyle` returns
 * *used* values for top/right/bottom/left — an `auto` side comes back as a
 * resolved distance, indistinguishable from an authored inset (which would
 * e.g. wrongly trigger the absolute stretch branch). Typed OM returns
 * *computed* values, so `auto` survives. The no-Typed-OM fallback trusts a
 * side only when an inline style or a Tailwind inset utility for it is
 * authored (then the used value equals the authored one). LTR only.
 */
function readInsets(
  cs: CSSStyleDeclaration,
  csm: StylePropertyMapReadOnly | null,
  classAttr: string,
  inlineStyle: CSSStyleDeclaration,
  rootFontSizePx: number,
): PerSide<CellLength | null> {
  const side = (
    prop: "top" | "right" | "bottom" | "left",
    utilityPattern: RegExp,
  ): CellLength | null => {
    if (csm) {
      const value = csm.get(prop)?.toString().trim();
      if (!value || value === "auto") return null;
      return readSpacing(value, rootFontSizePx);
    }
    const inline = inlineStyle[prop];
    if (inline) return inline === "auto" ? null : readSpacing(inline, rootFontSizePx);
    if (!utilityPattern.test(classAttr)) return null;
    const value = cs.getPropertyValue(prop);
    return !value || value === "auto" ? null : readSpacing(value, rootFontSizePx);
  };
  return {
    top: side("top", /(?:^|[\s:.[!])-?(?:top|inset|inset-y)-/),
    right: side("right", /(?:^|[\s:.[!])-?(?:right|end|inset|inset-x)-/),
    bottom: side("bottom", /(?:^|[\s:.[!])-?(?:bottom|inset|inset-y)-/),
    left: side("left", /(?:^|[\s:.[!])-?(?:left|start|inset|inset-x)-/),
  };
}

function mapBorderStyle(value: string): BorderStyle {
  switch (value) {
    case "double":
      return "double";
    case "dashed":
      return "dashed";
    case "dotted":
      return "dotted";
    default:
      return "solid";
  }
}

/**
 * Read a min/max constraint. Percentages must be kept symbolic (they resolve
 * against the parent's content box during layout) — naive px parsing would
 * read `"100%"` as 100px and produce a nonsense cell count.
 */
function readLimit(value: string, rootFontSizePx: number): SizeLimit | undefined {
  if (!value || value === "none" || value === "auto") return undefined;
  if (value === "min-content" || value === "max-content" || value === "fit-content") return value;
  if (value.endsWith("%")) {
    const percent = parseFloat(value);
    return Number.isFinite(percent) ? { percent } : undefined;
  }
  const px = parseFloat(value);
  return Number.isFinite(px) ? pxToCells(px, rootFontSizePx) : undefined;
}

/**
 * Read a spacing length. Percentages stay symbolic — they resolve against
 * the containing block's width during layout (getComputedStyle would give
 * a used px value based on the pre-grid natural layout, which is wrong).
 */
function readSpacing(value: string, rootFontSizePx: number): CellLength {
  if (!value || value === "auto" || value === "none") return 0;
  if (value.endsWith("%")) {
    const percent = parseFloat(value);
    return Number.isFinite(percent) && percent !== 0 ? { percent } : 0;
  }
  const px = parseFloat(value);
  return Number.isFinite(px) ? pxToCells(px, rootFontSizePx) : 0;
}

function readSize(
  csm: StylePropertyMapReadOnly | null,
  fallback: string,
  key: "width" | "height",
  rootFontSizePx: number,
  classAttr: string,
  inlineStyle: CSSStyleDeclaration,
): Size | undefined {
  if (csm) {
    const value = csm.get(key);
    if (value == null) return undefined;
    const s = value.toString().trim();
    if (s === "auto") return { kind: "auto" };
    const intrinsic = intrinsicSizeKeyword(s);
    if (intrinsic) return intrinsic;
    if (s.endsWith("%")) return { kind: "percent", value: parseFloat(s) };
    if (s.endsWith("px")) return { kind: "cells", value: pxToCells(parseFloat(s), rootFontSizePx) };
    if (s.endsWith("rem"))
      return { kind: "cells", value: roundHalfAwayFromZero(parseFloat(s) / 0.25) };
  }
  // Fallback path (Firefox pre-157: no Typed OM). getComputedStyle returns
  // *used* values (always px) for box properties, so we can't distinguish
  // "authored w-N" from "natural content width". Look at what was authored:
  // inline styles first, then any Tailwind sizing utility in the class list.
  // If neither is present, treat as auto so intrinsic sizing kicks in.
  const inline = key === "width" ? inlineStyle.width : inlineStyle.height;
  if (inline) {
    if (inline === "auto") return { kind: "auto" };
    const intrinsic = intrinsicSizeKeyword(inline);
    if (intrinsic) return intrinsic;
    if (inline.endsWith("%")) return { kind: "percent", value: parseFloat(inline) };
    const px = parseFloat(inline);
    if (Number.isFinite(px)) return { kind: "cells", value: pxToCells(px, rootFontSizePx) };
  }
  // Intrinsic-keyword utilities (`w-min`…) must be caught by class scan here:
  // getComputedStyle would hand back the browser's *used* px width, which is
  // measured content px — NOT on the spacing scale — and would convert to a
  // nonsense cell count.
  const axis = key === "width" ? "w" : "h";
  if (new RegExp(`(?:^|[\\s:.[!])${axis}-min\\b`).test(classAttr)) return { kind: "min-content" };
  if (new RegExp(`(?:^|[\\s:.[!])${axis}-max\\b`).test(classAttr)) return { kind: "max-content" };
  if (new RegExp(`(?:^|[\\s:.[!])${axis}-fit\\b`).test(classAttr)) return { kind: "fit-content" };
  if (!hasSizingUtility(classAttr, axis)) return { kind: "auto" };
  if (fallback === "auto") return { kind: "auto" };
  if (fallback.endsWith("%")) return { kind: "percent", value: parseFloat(fallback) };
  const px = parseFloat(fallback);
  if (Number.isFinite(px)) return { kind: "cells", value: pxToCells(px, rootFontSizePx) };
  return undefined;
}

/**
 * CSS `flex-basis`. `auto` (and the unsupported `content`) → undefined, so
 * the layout falls back to the width-or-intrinsic base. `0%` (Tailwind
 * `flex-1`) must survive as an actual zero base.
 */
function readFlexBasis(value: string, rootFontSizePx: number): Size | undefined {
  if (!value || value === "auto" || value === "content") return undefined;
  const keyword = intrinsicSizeKeyword(value);
  if (keyword) return keyword;
  if (value.endsWith("%")) {
    const percent = parseFloat(value);
    return Number.isFinite(percent) ? { kind: "percent", value: percent } : undefined;
  }
  const px = parseFloat(value);
  return Number.isFinite(px) ? { kind: "cells", value: pxToCells(px, rootFontSizePx) } : undefined;
}

function intrinsicSizeKeyword(value: string): Size | undefined {
  if (value === "min-content") return { kind: "min-content" };
  if (value === "max-content") return { kind: "max-content" };
  if (value === "fit-content") return { kind: "fit-content" };
  return undefined;
}

/**
 * Detect whether an element has an authored `width` / `height` utility (not
 * `min-*` or `max-*`, which set separate properties). Handles variants
 * (`md:w-full`, `hover:w-0`) and arbitrary variant selectors (`[&_span]:w-2`).
 * Used only when Typed OM is unavailable.
 */
function hasSizingUtility(classAttr: string, axis: "w" | "h"): boolean {
  const pattern = axis === "w" ? /(?:^|[\s:.[!])w-/ : /(?:^|[\s:.[!])h-/;
  return pattern.test(classAttr);
}

function readPadding(cs: CSSStyleDeclaration, rootFontSizePx: number): PerSide<CellLength> {
  return {
    top: readSpacing(cs.getPropertyValue("padding-top"), rootFontSizePx),
    right: readSpacing(cs.getPropertyValue("padding-right"), rootFontSizePx),
    bottom: readSpacing(cs.getPropertyValue("padding-bottom"), rootFontSizePx),
    left: readSpacing(cs.getPropertyValue("padding-left"), rootFontSizePx),
  };
}

/** Border widths use the 1px = 1 cell scale (not the spacing scale). */
function readBorderInsets(cs: CSSStyleDeclaration): Insets {
  const readSide = (side: string, style: string) => {
    if (cs.getPropertyValue(style) === "none") return 0;
    return roundHalfAwayFromZero(parseFloat(cs.getPropertyValue(side)) || 0);
  };
  return {
    top: readSide("border-top-width", "border-top-style"),
    right: readSide("border-right-width", "border-right-style"),
    bottom: readSide("border-bottom-width", "border-bottom-style"),
    left: readSide("border-left-width", "border-left-style"),
  };
}
