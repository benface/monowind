import { pxToCells, roundHalfAwayFromZero } from "./metrics.ts";
import type {
  AlignItems,
  BorderStyle,
  CellStyle,
  Display,
  Insets,
  JustifyContent,
  NullableInsets,
  Size,
} from "./types.ts";

/**
 * Read the interpreted CellStyle for an element from its computed CSS.
 *
 * The host must have the `measuring` attribute set while this runs so the
 * engine's own geometry rules (from styles.css) don't feed their outputs back
 * into what we read.
 */
export function readCellStyle(el: Element, rootFontSizePx: number): CellStyle {
  const cs = getComputedStyle(el);
  const csm = supportsTypedOM(el) ? el.computedStyleMap() : null;
  const classAttr = el.getAttribute("class") ?? "";
  const inlineStyle = (el as HTMLElement).style;

  const rawDisplay = cs.display;
  const display: Display =
    rawDisplay === "flex"
      ? "flex"
      : rawDisplay === "grid"
        ? "grid"
        : rawDisplay === "none"
          ? "none"
          : rawDisplay.startsWith("inline")
            ? "block"
            : "block";

  return {
    display,
    flexDirection: cs.flexDirection === "column" ? "column" : "row",
    flexWrap: cs.flexWrap === "wrap" ? "wrap" : "nowrap",
    flexGrow: Number(cs.flexGrow) || 0,
    flexShrink: cs.flexShrink === "" ? 1 : Number(cs.flexShrink) || 0,
    justifyContent: mapJustify(cs.justifyContent),
    alignItems: mapAlign(cs.alignItems),
    alignSelf: mapAlignSelf(cs.alignSelf),
    width: readSize(csm, cs.width, "width", rootFontSizePx, classAttr, inlineStyle),
    height: readSize(csm, cs.height, "height", rootFontSizePx, classAttr, inlineStyle),
    minWidth: readLength(cs.minWidth, rootFontSizePx),
    minHeight: readLength(cs.minHeight, rootFontSizePx),
    maxWidth: cs.maxWidth === "none" ? undefined : readLength(cs.maxWidth, rootFontSizePx),
    maxHeight: cs.maxHeight === "none" ? undefined : readLength(cs.maxHeight, rootFontSizePx),
    padding: readInsets(cs, "padding", rootFontSizePx),
    margin: readMargin(cs, csm, classAttr, rootFontSizePx),
    gapX: readLength(cs.columnGap === "normal" ? "0px" : cs.columnGap, rootFontSizePx),
    gapY: readLength(cs.rowGap === "normal" ? "0px" : cs.rowGap, rootFontSizePx),
    border: readBorderInsets(cs),
    borderStyle: mapBorderStyle(cs.borderTopStyle),
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
    color: cs.color,
    backgroundColor: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? undefined : cs.backgroundColor,
    borderColor: cs.borderTopColor,
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
    default:
      return "start";
  }
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
): NullableInsets {
  const readSide = (physical: string, logical: string, autoClassPattern: RegExp): number | null => {
    if (csm) {
      const physicalValue = csm.get(physical)?.toString().trim();
      if (physicalValue === "auto") return null;
      const logicalValue = csm.get(logical)?.toString().trim();
      if (logicalValue === "auto") return null;
    } else if (autoClassPattern.test(classAttr)) {
      return null;
    }
    const physicalValue = cs.getPropertyValue(physical);
    if (physicalValue === "auto") return null;
    const physicalCells = readLength(physicalValue, rootFontSizePx);
    if (physicalCells !== 0) return physicalCells;
    const logicalValue = cs.getPropertyValue(logical);
    if (logicalValue === "auto") return null;
    return readLength(logicalValue, rootFontSizePx);
  };
  return {
    top: readSide("margin-top", "margin-block-start", /(?:^|[\s:.[!])(?:m|my|mt)-auto\b/),
    right: readSide("margin-right", "margin-inline-end", /(?:^|[\s:.[!])(?:m|mx|mr|me)-auto\b/),
    bottom: readSide("margin-bottom", "margin-block-end", /(?:^|[\s:.[!])(?:m|my|mb)-auto\b/),
    left: readSide("margin-left", "margin-inline-start", /(?:^|[\s:.[!])(?:m|mx|ml|ms)-auto\b/),
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

function readLength(value: string, rootFontSizePx: number): number {
  if (!value || value === "auto" || value === "none") return 0;
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
    if (inline.endsWith("%")) return { kind: "percent", value: parseFloat(inline) };
    const px = parseFloat(inline);
    if (Number.isFinite(px)) return { kind: "cells", value: pxToCells(px, rootFontSizePx) };
  }
  if (!hasSizingUtility(classAttr, key === "width" ? "w" : "h")) return { kind: "auto" };
  if (fallback === "auto") return { kind: "auto" };
  if (fallback.endsWith("%")) return { kind: "percent", value: parseFloat(fallback) };
  const px = parseFloat(fallback);
  if (Number.isFinite(px)) return { kind: "cells", value: pxToCells(px, rootFontSizePx) };
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

function readInsets(
  cs: CSSStyleDeclaration,
  prefix: "padding" | "margin",
  rootFontSizePx: number,
): Insets {
  return {
    top: readLength(cs.getPropertyValue(`${prefix}-top`), rootFontSizePx),
    right: readLength(cs.getPropertyValue(`${prefix}-right`), rootFontSizePx),
    bottom: readLength(cs.getPropertyValue(`${prefix}-bottom`), rootFontSizePx),
    left: readLength(cs.getPropertyValue(`${prefix}-left`), rootFontSizePx),
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
