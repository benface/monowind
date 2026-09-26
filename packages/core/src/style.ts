import { trackBackground } from "./animate.ts";
import { EFFECTS, animatesEffect } from "./animation.ts";
import { isTopLayer } from "./top-layer.ts";
import { colorAlpha, isLegacyColor, parseColor, splitTopLevel } from "./color.ts";
import type { ColorSpace, HueMode } from "./color.ts";
import { glyphSetFor, glyphSetNameFor, junctionWeight, weightBand } from "./glyphs.ts";
import type { BorderGlyphSet } from "./glyphs.ts";
import { pxToCells, roundHalfAwayFromZero } from "./metrics.ts";
import { autoTrack, SIDES, zeroInsets } from "./types.ts";
import { leafRendererFor } from "./leaf.ts";
import { warnOnce } from "./warn.ts";
import type {
  AlignItems,
  Overflow,
  OverflowAxis,
  BorderStyle,
  BoxShadow,
  BackgroundClip,
  Gradient,
  GradientLength,
  GradientPoint,
  GradientStop,
  RadialSize,
  CellLength,
  CellMetrics,
  CellStyle,
  Clear,
  Display,
  Float,
  GapRule,
  GridArea,
  GridAreas,
  GridAutoFlow,
  GridLine,
  GridTemplate,
  JustifyContent,
  Layer,
  PerSide,
  Side,
  Position,
  Size,
  SizeLimit,
  TableRole,
  TrackBreadth,
  TrackSize,
  Backdrop,
  AnchorFallback,
  Flip,
  AnchorInset,
  AnchorInsets,
  AnchorSize,
  AnchorSizeProperty,
  AnchorSizes,
  AreaSide,
  PositionArea,
} from "./types.ts";

/**
 * Read the interpreted CellStyle for an element from its computed CSS.
 *
 * Each element read carries its `data-mw-measuring` flag while this runs,
 * so the engine's own geometry rules (styles.css) don't feed their outputs
 * back into what it reads.
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
  warnAuthoredFontSize(el, classAttr, inlineStyle);
  // The glyph set decides a border's or rule's cells (its weight band),
  // so it is resolved before they are read.
  // A glyph the themed font has not got counts as unregistered, so the
  // set falls back per glyph to one the font draws (specs/theming.md).
  const glyphSet = glyphSetNameFor(
    cs.getPropertyValue("--mw-border-glyphs").trim() || null,
    cs.getPropertyValue("--mw-missing-glyphs"),
  );
  const set = glyphSetFor(glyphSet);
  const source: ReadSource = { cs, csm, classAttr, inlineStyle, metrics, rootFontSizePx };

  // Atomic inline-level boxes lay their CONTENT out like their block-level
  // counterparts (the tree builder blockifies the box itself onto its own
  // row — cell-model deviation).
  const rawDisplay = computedDisplay(el, cs);
  const tableRole: TableRole = TABLE_ROLES[rawDisplay] ?? "none";
  // A computed property's read is a call into the engine each time: one
  // wanted twice is read once.
  const { columnCount: count, columnWidth: widthValue, position } = cs;
  // Multicol: a block with an authored column-count or column-width
  // (specs/multicol.md). Computed values are specified values (probed
  // — no used-value trap).
  const columnCount =
    count && count !== "auto" ? Math.max(1, Math.floor(Number(count) || 1)) : null;
  const columnWidthPx = widthValue && widthValue !== "auto" ? parseFloat(widthValue) : NaN;
  const columnWidth = Number.isFinite(columnWidthPx)
    ? Math.max(1, pxToCells(columnWidthPx, rootFontSizePx))
    : null;
  const display: Display =
    rawDisplay === "flex" || rawDisplay === "inline-flex"
      ? "flex"
      : rawDisplay === "grid" || rawDisplay === "inline-grid"
        ? "grid"
        : rawDisplay === "table" || rawDisplay === "inline-table"
          ? "table"
          : rawDisplay === "none" || isZeroClipped(el, cs)
            ? "none"
            : columnCount !== null || columnWidth !== null
              ? "multicol"
              : "block";

  // Grid templates: `getComputedStyle` on a live grid container returns
  // the USED track list (expanded, in px) — fr factors, repeat(), and
  // minmax() are gone. Typed OM returns the COMPUTED value with the
  // authored structure intact (verified in Chromium and WebKit), so it's
  // the primary source, as for margins and insets. Without Typed OM
  // (Firefox pre-157), a `data-mw-degrid` attribute (measuring-gated
  // `display: block` rule in styles.css) blockifies the element for the
  // read, which makes getComputedStyle hand back the computed value too.
  // The attribute is not in the engine's MutationObserver filter, so the
  // write doesn't re-trigger layout.
  let gridTemplateColumns: GridTemplate = { kind: "none" };
  let gridTemplateRows: GridTemplate = { kind: "none" };
  let gridAutoColumns: TrackSize[] = [autoTrack()];
  let gridAutoRows: TrackSize[] = [autoTrack()];
  let gridAutoFlow: GridAutoFlow = { direction: "row", dense: false };
  let gridTemplateAreas: GridAreas | null = null;
  if (display === "grid") {
    if (csm) {
      gridTemplateColumns = parseTrackTemplate(
        csm.get("grid-template-columns")?.toString() ?? "",
        rootFontSizePx,
      );
      gridTemplateRows = parseTrackTemplate(
        csm.get("grid-template-rows")?.toString() ?? "",
        rootFontSizePx,
      );
    } else {
      el.setAttribute("data-mw-degrid", "");
      try {
        gridTemplateColumns = parseTrackTemplate(
          cs.getPropertyValue("grid-template-columns"),
          rootFontSizePx,
        );
        gridTemplateRows = parseTrackTemplate(
          cs.getPropertyValue("grid-template-rows"),
          rootFontSizePx,
        );
      } finally {
        el.removeAttribute("data-mw-degrid");
      }
    }
    // No used-value trap for these: their computed values keep the
    // authored form on grid containers too.
    gridAutoColumns = parseAutoTracks(cs.getPropertyValue("grid-auto-columns"), rootFontSizePx);
    gridAutoRows = parseAutoTracks(cs.getPropertyValue("grid-auto-rows"), rootFontSizePx);
    gridAutoFlow = parseGridAutoFlow(cs.getPropertyValue("grid-auto-flow"));
    gridTemplateAreas = parseGridTemplateAreas(cs.getPropertyValue("grid-template-areas"));
  }

  let tableLayout: "auto" | "fixed" = "auto";
  let borderCollapse = false;
  let borderSpacingX = 0;
  let borderSpacingY = 0;
  if (display === "table") {
    tableLayout = cs.tableLayout === "fixed" ? "fixed" : "auto";
    borderCollapse = cs.borderCollapse === "collapse";
    if (!borderCollapse) {
      // Computed form is "Xpx" or "Xpx Ypx" (horizontal first, per CSS).
      const parts = cs.borderSpacing.split(" ");
      borderSpacingX = pxToCells(parseFloat(parts[0] ?? "") || 0, rootFontSizePx);
      borderSpacingY = pxToCells(parseFloat(parts[1] ?? parts[0] ?? "") || 0, rootFontSizePx);
    }
  }

  // A top-layer box (specs/top-layer.md), and a displayed popover
  // through its exit, keeps the UA's geometry where the author sets
  // none.
  const topLayer = isTopLayer(el);
  const hoisted = topLayer || el.hasAttribute("popover");
  const outOfFlow = hoisted || position === "absolute" || position === "fixed";
  const anchoring = readAnchoring(el, cs, outOfFlow);
  const anchorSource: AnchorSource | null = outOfFlow
    ? { ...source, nativeDefault: anchoring.positionAnchor?.startsWith(IMPLICIT_ANCHOR) ?? false }
    : null;
  const anchorSizes = anchorSource ? readAnchorSizes(anchorSource) : {};
  const anchorInsets = anchorSource ? readAnchorInsets(anchorSource) : {};
  const { flexDirection, flexWrap, flexShrink, columnGap, rowGap, zIndex, breakInside } = cs;
  const ruleInset = cs.getPropertyValue("--mw-rule-inset").trim();
  const justifyContent = readAlignment(el, "justify-content", JUSTIFY, cs.justifyContent);
  const alignContent = readAlignment(el, "align-content", JUSTIFY, cs.alignContent);
  const alignItems = readAlignment(el, "align-items", ALIGN, cs.alignItems);
  const alignSelf = readAlignment(el, "align-self", ALIGN_SELF, cs.alignSelf);
  const justifyItems = readAlignment(el, "justify-items", ALIGN, cs.justifyItems);
  const justifySelf = readAlignment(el, "justify-self", ALIGN_SELF, cs.justifySelf);
  const style: CellStyle = {
    display,
    tableRole,
    tableLayout,
    borderCollapse,
    borderSpacingX,
    borderSpacingY,
    captionSide: cs.captionSide === "bottom" ? "bottom" : "top",
    // Cells and atomic-inline candidates; the rest never consume it.
    verticalAlign:
      tableRole === "cell" || rawDisplay.startsWith("inline-")
        ? readVerticalAlign(el, cs)
        : "start",
    flexDirection: flexDirection.startsWith("column") ? "column" : "row",
    flexReverse: flexDirection.endsWith("-reverse"),
    flexWrap: flexWrap.startsWith("wrap") ? "wrap" : "nowrap",
    wrapReverse: flexWrap === "wrap-reverse",
    flexGrow: Number(cs.flexGrow) || 0,
    flexShrink: flexShrink === "" ? 1 : Number(flexShrink) || 0,
    // flex-basis keeps its computed form (percentages stay symbolic), so
    // plain getComputedStyle is reliable here — `flex-1` reads as "0%".
    flexBasis: readFlexBasis(cs.flexBasis, rootFontSizePx),
    order: Number(cs.order) || 0,
    justifyContent: justifyContent.keyword,
    justifyContentSafe: justifyContent.safe,
    alignContent: alignContent.keyword,
    alignContentSafe: alignContent.safe,
    alignItems: alignItems.keyword,
    alignItemsSafe: alignItems.safe,
    alignSelf: alignSelf.keyword,
    alignSelfSafe: alignSelf.safe,
    justifyItems: justifyItems.keyword,
    justifyItemsSafe: justifyItems.safe,
    justifySelf: justifySelf.keyword,
    justifySelfSafe: justifySelf.safe,
    gridTemplateColumns,
    gridTemplateRows,
    gridAutoColumns,
    gridAutoRows,
    gridAutoFlow,
    gridTemplateAreas,
    // Placement longhands have no used-value trap (computed = as
    // specified) and cost four cheap reads, so they're read on every
    // element — items don't know their parent's display here.
    gridColumnStart: parseGridLine(cs.getPropertyValue("grid-column-start")),
    gridColumnEnd: parseGridLine(cs.getPropertyValue("grid-column-end")),
    gridRowStart: parseGridLine(cs.getPropertyValue("grid-row-start")),
    gridRowEnd: parseGridLine(cs.getPropertyValue("grid-row-end")),
    width: readSize(source, "width", cs.width),
    height: readSize(source, "height", cs.height),
    minWidth: readLimit(source, "min-width", cs.minWidth, "min-w") ?? "auto",
    minHeight: readLimit(source, "min-height", cs.minHeight, "min-h") ?? "auto",
    maxWidth: readLimit(source, "max-width", cs.maxWidth, "max-w"),
    maxHeight: readLimit(source, "max-height", cs.maxHeight, "max-h"),
    padding: readPadding(cs, rootFontSizePx),
    margin: readMargin(source),
    position: readKeyword(POSITIONS, position, "static"),
    // Per CSS an out-of-flow box computes `float: none`; headless DOMs
    // report the authored value, so the engine applies the rule itself.
    float:
      position === "absolute" || position === "fixed"
        ? "none"
        : readKeyword(FLOAT_SIDES, cs.float, "none"),
    clear: readKeyword(CLEAR_SIDES, cs.clear, "none"),
    insets: readInsets(source),
    // `column-gap: normal` is 0 in flex/grid but 1em in multicol, per
    // CSS (specs/multicol.md "Reading"). Headless DOMs report unset as
    // an empty string — same initial value.
    gapX: readSpacing(
      columnGap === "normal" || columnGap === ""
        ? display === "multicol"
          ? `${fontSizePx}px`
          : "0px"
        : columnGap,
      rootFontSizePx,
    ),
    gapY: readSpacing(rowGap === "normal" ? "0px" : rowGap, rootFontSizePx),
    ...readBorder(cs, set),
    borderRadius: {
      tl: readRadius(cs.borderTopLeftRadius, rootFontSizePx),
      tr: readRadius(cs.borderTopRightRadius, rootFontSizePx),
      bl: readRadius(cs.borderBottomLeftRadius, rootFontSizePx),
      br: readRadius(cs.borderBottomRightRadius, rootFontSizePx),
    },
    overflow: readOverflow(cs),
    scrollbarWidth: readScrollbarWidth(el, cs),
    scrollbarColor: readScrollbarColor(cs.scrollbarColor),
    overscroll: {
      x: (cs.overscrollBehaviorX || "auto") === "auto",
      y: (cs.overscrollBehaviorY || "auto") === "auto",
    },
    scrollbarSize: {
      x: readCells(cs.getPropertyValue("--mw-scrollbar-size-x")),
      y: readCells(cs.getPropertyValue("--mw-scrollbar-size-y")),
    },
    scrollbarInset: {
      x: readCells(cs.getPropertyValue("--mw-scrollbar-inset-x"), 0),
      y: readCells(cs.getPropertyValue("--mw-scrollbar-inset-y"), 0),
    },
    ...readTextStyle(el, cs, rootFontSizePx),
    // Both readable because the companion stylesheet's typography rewrite
    // is measuring-gated.
    lineGap: lineGapRows(cs.lineHeight, fontSizePx),
    tracking: trackingCells(cs.letterSpacing, fontSizePx, metrics?.letterSpacing ?? 0),
    ...readPaintStyle(cs),
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    backgroundColor: readAnimatedBackground(el, cs.backgroundColor, cs),
    backgroundClear: cs.getPropertyValue("--mw-bg-clear").trim() === "1",
    backgroundImage: readBackgroundImage(cs.backgroundImage, cs.color, rootFontSizePx),
    backgroundClip: readBackgroundClip(cs.backgroundClip),
    layer: readLayer(el, cs),
    visible: readVisible(cs, el),
    pointerEvents: cs.pointerEvents !== "none",
    ...anchoring,
    anchorSizes,
    anchorInsets,
    topLayer,
    backdrop: hoisted ? readBackdrop(el) : null,
    glyphSet,
    boxShadow: readBoxShadow(cs.boxShadow, rootFontSizePx, metrics),
    zIndex: zIndex === "auto" || zIndex === "" ? null : Number(zIndex) || 0,
    latticeBorder: null,
    ruleX:
      display === "flex" || display === "grid" || display === "multicol"
        ? readGapRule(cs, "x", set)
        : null,
    ruleY: display === "flex" || display === "grid" ? readGapRule(cs, "y", set) : null,
    ruleBreak: readKeyword(RULE_BREAKS, cs.getPropertyValue("--mw-rule-break").trim(), "normal"),
    ruleInset:
      ruleInset === "overlap-join"
        ? ruleInset
        : Math.max(0, roundHalfAwayFromZero(parseFloat(ruleInset) || 0)),
    ruleVisibilityItems: readKeyword(
      RULE_VISIBILITIES,
      cs.getPropertyValue("--mw-rule-visibility-items").trim(),
      "normal",
    ),
    columnCount,
    columnWidth,
    columnFill: cs.columnFill === "auto" ? "auto" : "balance",
    columnSpan: cs.columnSpan === "all",
    breakBeforeColumn: cs.breakBefore === "column",
    breakAfterColumn: cs.breakAfter === "column",
    breakInsideAvoid: breakInside === "avoid" || breakInside === "avoid-column",
  };
  // The browser's px for an anchor function is the pre-grid anchor's:
  // the property reads unset until the box is placed (positioning.ts).
  for (const property of Object.keys(anchorSizes) as AnchorSizeProperty[]) {
    setAnchorSize(style, property, undefined);
  }
  for (const side of Object.keys(anchorInsets) as Side[]) style.insets[side] = null;
  applyBorderCollapse(style, cs);
  if (hoisted) {
    applyTopLayerGeometry(style, source);
    // A backdrop's element paints in a box of its own, above the
    // backdrop box (specs/top-layer.md): a layer root.
    if (style.backdrop) style.layer ??= { backdropFilter: "none", resampled: false };
  }
  return style;
}

/** The size properties an `anchor-size()` can take: the reader's key,
 * the CSS property, its utilities' stems, and its axis. */
const ANCHOR_SIZE_PROPERTIES = [
  ["width", "width", "w|size", "width"],
  ["height", "height", "h|size", "height"],
  ["minWidth", "min-width", "min-w", "width"],
  ["minHeight", "min-height", "min-h", "height"],
  ["maxWidth", "max-width", "max-w", "width"],
  ["maxHeight", "max-height", "max-h", "height"],
] as const;

/** What a length is read from: the element's computed values, as Typed
 * OM has them too, its class and inline style — whose units carry
 * intent the computed px has lost — the measured cell, and the root
 * font size. */
interface ReadSource {
  cs: CSSStyleDeclaration;
  csm: StylePropertyMapReadOnly | null;
  classAttr: string;
  inlineStyle: CSSStyleDeclaration;
  metrics: CellMetrics | undefined;
  rootFontSizePx: number;
}

/** An anchor function's source, and whether its default anchor is a
 * popover's invoker. */
interface AnchorSource extends ReadSource {
  nativeDefault: boolean;
}

/** An anchor function's arguments: its words before the fallback's
 * comma, and the fallback, a length the axis resolves — undefined
 * without a comma, null for anything but a length. */
interface AnchorArguments {
  words: string[];
  fallback: CalcValue | null | undefined;
}

/** An anchor function authored as a whole property, its arguments: from
 * the inline style, else the first arbitrary-value utility of one of the
 * stems (`min-w-[anchor-size(width)]`) the cascade can leave in effect,
 * its underscores spaces. The browser resolves one against the anchor's
 * pre-grid box, so the function itself is read, for the engine to
 * resolve against the anchor's cells. */
function authoredAnchorFunction(
  name: "anchor" | "anchor-size",
  property: string,
  stems: string,
  axis: "width" | "height",
  source: AnchorSource,
): AnchorArguments | undefined {
  const inline = source.inlineStyle.getPropertyValue(property).trim();
  if (inline) {
    const args = new RegExp(`^${name}\\((.*)\\)$`).exec(inline)?.[1];
    return args === undefined ? undefined : anchorArguments(args, axis, source.rootFontSizePx);
  }
  if (!source.classAttr.includes(`[${name}(`)) return undefined;
  const utilities = new RegExp(`(?:^|[\\s:.[!])(?:${stems})-\\[${name}\\(([^\\s\\]]*)\\)\\]`, "g");
  for (const [, args] of source.classAttr.matchAll(utilities)) {
    const parsed = anchorArguments(args!.replaceAll("_", " "), axis, source.rootFontSizePx);
    if (inEffect(parsed, property, axis, source)) return parsed;
  }
  return undefined;
}

function anchorArguments(
  args: string,
  axis: "width" | "height",
  rootFontSizePx: number,
): AnchorArguments {
  const comma = args.indexOf(",");
  const words = (comma < 0 ? args : args.slice(0, comma)).trim().split(/\s+/).filter(Boolean);
  if (comma < 0) return { words, fallback: undefined };
  return { words, fallback: lengthValue(args.slice(comma + 1).trim(), axis, rootFontSizePx) };
}

/** Whether Typed OM leaves a utility's anchor function possibly in effect
 * (specs/anchor-positioning.md deviation 1): unresolved, it computes to
 * the property's initial value, or to its fallback, compared in px. */
function inEffect(
  args: AnchorArguments,
  property: string,
  axis: "width" | "height",
  source: AnchorSource,
): boolean {
  if (!source.csm) return true;
  // The invoker resolves natively, anchor-scope aside.
  if (source.nativeDefault && !args.words.some((word) => word.startsWith("--"))) return true;
  const computed = source.csm.get(property)?.toString() ?? "";
  if (args.fallback === undefined)
    return computed === unresolvedValue(property, source.metrics?.autoMinimum ?? "auto");
  if (args.fallback === null) return true;
  const value = lengthValue(computed, axis, source.rootFontSizePx);
  return (
    value !== null &&
    Math.abs(value.px - args.fallback.px) < 0.001 &&
    Math.abs(value.percent - args.fallback.percent) < 0.001
  );
}

/** What a property with an unresolvable anchor function computes to:
 * its initial value — for a minimum, `auto` as this engine reads it. */
function unresolvedValue(property: string, autoMinimum: string): string {
  if (property.startsWith("max-")) return "none";
  if (property.startsWith("min-")) return autoMinimum;
  return "auto";
}

/** The sizes an out-of-flow box authors as `anchor-size()`
 * (specs/anchor-positioning.md). */
function readAnchorSizes(source: AnchorSource): AnchorSizes {
  const sizes: AnchorSizes = {};
  for (const [key, property, stems, axis] of ANCHOR_SIZE_PROPERTIES) {
    const authored = authoredAnchorFunction("anchor-size", property, stems, axis, source);
    const size = authored === undefined ? null : parseAnchorSize(authored, axis);
    if (size) sizes[key] = size;
  }
  return sizes;
}

/** `anchor-size()`'s arguments: an anchor name and a dimension, each
 * optional — the property's own axis by default, the logical keywords
 * those of a horizontal host — and a fallback length after a comma. */
function parseAnchorSize(args: AnchorArguments, axis: "width" | "height"): AnchorSize | null {
  let anchor: string | null = null;
  let dimension: AnchorSize["dimension"] = axis;
  for (const word of args.words) {
    if (word.startsWith("--")) anchor = word;
    else if (word === "width" || word.endsWith("inline")) dimension = "width";
    else if (word === "height" || word.endsWith("block")) dimension = "height";
    else return null;
  }
  return args.fallback
    ? { anchor, dimension, fallback: lengthCells(args.fallback) }
    : { anchor, dimension };
}

/** A length, a percentage, or a calc() of them; null for anything else. */
function lengthValue(
  text: string,
  axis: "width" | "height",
  rootFontSizePx: number,
): CalcValue | null {
  const value = evaluateCalc(text, axis, undefined, rootFontSizePx);
  // A unitless zero is the one number a length takes.
  return !value || (value.unitless && value.cells !== 0) ? null : value;
}

/** A length in whole cells, a percentage kept. */
function lengthCells(value: CalcValue): CellLength {
  const cells = roundHalfAwayFromZero(value.cells);
  if (value.percent === 0) return cells;
  return cells === 0 ? { percent: value.percent } : { percent: value.percent, cells };
}

/** The insets an out-of-flow box authors as `anchor()`
 * (specs/anchor-positioning.md), read like `anchor-size()`
 * (`top-[anchor(bottom)]`). */
function readAnchorInsets(source: AnchorSource): AnchorInsets {
  const insets: AnchorInsets = {};
  for (const side of SIDES) {
    const axis = side === "top" || side === "bottom" ? "height" : "width";
    const authored = authoredAnchorFunction("anchor", side, SIDE_STEMS[side], axis, source);
    const inset = authored === undefined ? null : parseAnchorInset(authored, side);
    if (inset) insets[side] = inset;
  }
  return insets;
}

/** `anchor()`'s arguments: an optional anchor name and the side — the
 * inset's axis's own, `center`, a logical side of a horizontal
 * left-to-right host, `inside` (the inset's own side), `outside` (the
 * opposite one), or a percentage from the start; another axis's side
 * takes the fallback alone, as in CSS — and a fallback length after a
 * comma. */
function parseAnchorInset(args: AnchorArguments, inset: Side): AnchorInset | null {
  const vertical = inset === "top" || inset === "bottom";
  const [start, end] = vertical ? ["top", "bottom"] : ["left", "right"];
  const own = inset === start ? 0 : 1;
  const fractions: Record<string, number | null> = {
    [vertical ? "left" : "top"]: null,
    [vertical ? "right" : "bottom"]: null,
    [start!]: 0,
    [end!]: 1,
    center: 0.5,
    start: 0,
    end: 1,
    "self-start": 0,
    "self-end": 1,
    inside: own,
    outside: 1 - own,
  };
  let anchor: string | null = null;
  let fraction: number | null | undefined;
  for (const word of args.words) {
    if (word.startsWith("--")) anchor = word;
    else if (Object.hasOwn(fractions, word)) fraction = fractions[word];
    else if (/^-?\d+(?:\.\d+)?%$/.test(word)) fraction = parseFloat(word) / 100;
    else return null;
  }
  if (fraction === undefined) return null;
  return args.fallback
    ? { anchor, fraction, fallback: lengthCells(args.fallback) }
    : { anchor, fraction };
}

/** An `anchor-size()` property as cells, or its initial value where no
 * anchor resolves it (CSS: invalid at computed-value time). */
export function setAnchorSize(
  style: CellStyle,
  property: AnchorSizeProperty,
  cells: number | undefined,
  fallback?: CellLength,
): void {
  const length = cells ?? fallback;
  switch (property) {
    case "width":
    case "height":
      // A size takes whole cells or a plain percentage.
      style[property] =
        typeof length === "number"
          ? { kind: "cells", value: length }
          : length !== undefined && length.cells === undefined
            ? { kind: "percent", value: length.percent }
            : undefined;
      return;
    case "minWidth":
    case "minHeight":
      style[property] = length ?? "auto";
      return;
    case "maxWidth":
    case "maxHeight":
      style[property] = length;
  }
}

/** The elements a `visibility` fade holds visible, until when
 * (`performance.now()` time): CSS shows an element throughout a fade
 * between `visible` and `hidden`, which the measuring mask cancels. */
const fades = new WeakMap<Element, number>();

/** Holds an element visible to the read until `until`. */
export function holdVisible(el: Element, until: number): void {
  fades.set(el, until);
}

/** Whether a computed `visibility` paints (specs/visibility.md):
 * `hidden` and `collapse` do not, unless a fade holds the element; a
 * DOM without the property does. */
export function readVisible(cs: CSSStyleDeclaration, el?: Element): boolean {
  const { visibility } = cs;
  if (visibility !== "hidden" && visibility !== "collapse") return true;
  return el !== undefined && (fades.get(el) ?? 0) > performance.now();
}

/** `position-visibility`'s conditions: `always` none, the initial value
 * (and a DOM without the property) `anchors-visible`; the draft's
 * singular spellings and the browsers' plural ones alike. */
export function parsePositionVisibility(value: string): CellStyle["positionVisibility"] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { anchorValid: false, anchorVisible: true, noOverflow: false };
  return {
    anchorValid: words.some((word) => /^anchors?-valid$/.test(word)),
    anchorVisible: words.some((word) => /^anchors?-visible$/.test(word)),
    noOverflow: words.includes("no-overflow"),
  };
}

/** `position-try-order`'s keywords, the logical ones for a horizontal
 * host. */
const TRY_ORDER: Record<string, CellStyle["positionTryOrder"]> = {
  "most-width": "most-width",
  "most-inline-size": "most-width",
  "most-height": "most-height",
  "most-block-size": "most-height",
};

/** The anchor positioning properties (specs/anchor-positioning.md):
 * any element's names, and the anchoring of an out-of-flow box. */
function readAnchoring(
  el: Element,
  cs: CSSStyleDeclaration,
  outOfFlow: boolean,
): Pick<
  CellStyle,
  | "anchorNames"
  | "positionAnchor"
  | "positionArea"
  | "positionTryFallbacks"
  | "positionTryOrder"
  | "positionVisibility"
  | "anchorCenter"
> {
  const anchorNames = readAnchorNames(el, cs);
  if (!outOfFlow) {
    return {
      anchorNames,
      positionAnchor: null,
      positionArea: null,
      positionTryFallbacks: [],
      positionTryOrder: "normal",
      positionVisibility: { anchorValid: false, anchorVisible: false, noOverflow: false },
      anchorCenter: { x: false, y: false },
    };
  }
  const positionArea = parsePositionArea(cs.getPropertyValue("position-area"));
  const tryOrder = cs.getPropertyValue("position-try-order").trim();
  return {
    anchorNames,
    positionAnchor: readPositionAnchor(el, cs, positionArea !== null),
    positionArea,
    positionTryFallbacks: parsePositionTryFallbacks(cs.getPropertyValue("position-try-fallbacks")),
    positionTryOrder: readKeyword(TRY_ORDER, tryOrder, "normal"),
    positionVisibility: parsePositionVisibility(cs.getPropertyValue("position-visibility")),
    anchorCenter: { x: cs.justifySelf === "anchor-center", y: cs.alignSelf === "anchor-center" },
  };
}

/** The start of the anchor names the engine gives a popover's implicit
 * anchor, apart from an author's. */
export const IMPLICIT_ANCHOR = "--mw:";

/** An element's `position-anchor`: a name; `match-parent` its parent's;
 * `auto` its implicit anchor — a popover's, synthesized from its id —
 * and `normal` (the initial) too where it has a `position-area`, as in
 * CSS; a DOM without the property reads "". */
function readPositionAnchor(el: Element, cs: CSSStyleDeclaration, hasArea: boolean): string | null {
  const anchor = cs.getPropertyValue("position-anchor").trim();
  if (anchor.startsWith("--")) return anchor;
  if (anchor === "match-parent") {
    const parent = el.parentElement;
    if (!parent) return null;
    const parentStyle = getComputedStyle(parent);
    const parentArea = parsePositionArea(parentStyle.getPropertyValue("position-area"));
    return readPositionAnchor(parent, parentStyle, parentArea !== null);
  }
  const implicit = anchor === "auto" || ((anchor === "normal" || anchor === "") && hasArea);
  return implicit && el.hasAttribute("popover") && el.id !== "" ? IMPLICIT_ANCHOR + el.id : null;
}

/** An element's `anchor-name`s; an invoker of a popover
 * (`popovertarget`, `commandfor`) named for its target where the
 * author names it not. */
export function readAnchorNames(el: Element, cs: CSSStyleDeclaration): string[] {
  const named = cs.getPropertyValue("anchor-name").trim();
  if (named !== "" && named !== "none") return named.split(",").map((name) => name.trim());
  const target = el.getAttribute("popovertarget") ?? el.getAttribute("commandfor");
  return target ? [IMPLICIT_ANCHOR + target] : [];
}

const AREA_X: Record<string, AreaSide> = {
  left: "start",
  right: "end",
  "span-left": "span-start",
  "span-right": "span-end",
  "x-start": "start",
  "x-end": "end",
  "span-x-start": "span-start",
  "span-x-end": "span-end",
  "x-self-start": "start",
  "x-self-end": "end",
  "span-x-self-start": "span-start",
  "span-x-self-end": "span-end",
  "inline-start": "start",
  "inline-end": "end",
  "span-inline-start": "span-start",
  "span-inline-end": "span-end",
  "self-inline-start": "start",
  "self-inline-end": "end",
  "span-self-inline-start": "span-start",
  "span-self-inline-end": "span-end",
};
const AREA_Y: Record<string, AreaSide> = {
  top: "start",
  bottom: "end",
  "span-top": "span-start",
  "span-bottom": "span-end",
  "y-start": "start",
  "y-end": "end",
  "span-y-start": "span-start",
  "span-y-end": "span-end",
  "y-self-start": "start",
  "y-self-end": "end",
  "span-y-self-start": "span-start",
  "span-y-self-end": "span-end",
  "block-start": "start",
  "block-end": "end",
  "span-block-start": "span-start",
  "span-block-end": "span-end",
  "self-block-start": "start",
  "self-block-end": "end",
  "span-self-block-start": "span-start",
  "span-self-block-end": "span-end",
};
/** The keywords of either axis: alone they name both, paired the block
 * axis first. */
const AREA_BOTH: Record<string, AreaSide> = {
  start: "start",
  end: "end",
  center: "center",
  "span-start": "span-start",
  "span-end": "span-end",
  "span-all": "span-all",
  "self-start": "start",
  "self-end": "end",
  "span-self-start": "span-start",
  "span-self-end": "span-end",
};

/** A computed `position-area` as the engines serialize it — one keyword
 * where the other axis spans all, or an ambiguous one for both axes —
 * mapped for a horizontal left-to-right host; null for none. */
export function parsePositionArea(value: string): PositionArea | null {
  const words = value.trim().split(/\s+/);
  if (words[0] === "" || words[0] === "none") return null;
  const kind = (word: string): ["x" | "y" | "both", AreaSide] | null =>
    Object.hasOwn(AREA_X, word)
      ? ["x", AREA_X[word]!]
      : Object.hasOwn(AREA_Y, word)
        ? ["y", AREA_Y[word]!]
        : Object.hasOwn(AREA_BOTH, word)
          ? ["both", AREA_BOTH[word]!]
          : null;
  const first = kind(words[0]!);
  if (!first) return null;
  if (words.length === 1) {
    const [axis, side] = first;
    if (axis === "both") return { x: side, y: side };
    return axis === "x" ? { x: side, y: "span-all" } : { x: "span-all", y: side };
  }
  const second = words.length === 2 ? kind(words[1]!) : null;
  if (!second) return null;
  if (first[0] === "both" && second[0] === "both") return { y: first[1], x: second[1] };
  if (first[0] === "y" || second[0] === "x") return { y: first[1], x: second[1] };
  return { x: first[1], y: second[1] };
}

/** Each try-tactic keyword's flip, `flip-x` and `flip-y` those of a
 * horizontal left-to-right host. */
const FLIPS: Record<string, Flip> = {
  "flip-block": "block",
  "flip-inline": "inline",
  "flip-start": "start",
  "flip-x": "inline",
  "flip-y": "block",
};

/** A computed `position-try-fallbacks`: a list of tactics, each its
 * flips in their written order, or an area of its own. */
export function parsePositionTryFallbacks(value: string): AnchorFallback[] {
  const list = value.trim();
  if (list === "" || list === "none") return [];
  const fallbacks: AnchorFallback[] = [];
  for (const entry of list.split(",")) {
    const words = entry.trim().split(/\s+/);
    if (words.every((word) => Object.hasOwn(FLIPS, word))) {
      fallbacks.push({ flips: words.map((word) => FLIPS[word]!) });
    } else {
      const area = parsePositionArea(entry);
      if (area) fallbacks.push(area);
    }
  }
  return fallbacks;
}

/** The UA's geometry of a top-layer box — a fixed box at `inset: 0`,
 * sized `fit-content`, its margins `auto` — where the author's classes
 * and inline style say nothing: the browsers resolve the UA's `auto`
 * margins to used pixels, and without the Typed OM the insets read
 * from the class list alone. */
function applyTopLayerGeometry(style: CellStyle, { classAttr, inlineStyle }: ReadSource): void {
  style.position = "fixed";
  for (const side of SIDES) {
    style.insets[side] ??= 0;
  }
  style.width ??= { kind: "fit-content" };
  style.height ??= { kind: "fit-content" };
  const authored = (stems: string, physical: string): boolean =>
    new RegExp(`(?:^|[\\s:.[!])-?(?:${stems})-`).test(classAttr) ||
    inlineStyle.getPropertyValue(physical) !== "";
  if (!authored("m|my|mt", "margin-top")) style.margin.top = null;
  if (!authored("m|mx|mr|me", "margin-right")) style.margin.right = null;
  if (!authored("m|my|mb", "margin-bottom")) style.margin.bottom = null;
  if (!authored("m|mx|ml|ms", "margin-left")) style.margin.left = null;
}

/** The `::backdrop`'s look, read while the companion's lock is off;
 * null when nothing of it shows, or where a headless DOM has no
 * pseudo-elements. */
function readBackdrop(el: Element): Backdrop | null {
  try {
    const cs = getComputedStyle(el, "::backdrop");
    if (!readVisible(cs, el)) return null;
    const backgroundColor = cs.backgroundColor;
    const backgroundImage = cs.backgroundImage || "none";
    const backdropFilter = cs.backdropFilter || "none";
    if (
      isTransparentColor(backgroundColor) &&
      backgroundImage === "none" &&
      backdropFilter === "none"
    ) {
      return null;
    }
    return { backgroundColor, backgroundImage, backdropFilter, opacity: cs.opacity || "1" };
  } catch {
    return null;
  }
}

/** Collapsed-table participants surrender their borders to the lattice
 * (`border-collapse` inherits, so each element knows on its own); the
 * table also drops its padding, per CSS 2.1 (specs/table.md). */
function applyBorderCollapse(style: CellStyle, cs: CSSStyleDeclaration): void {
  if (cs.borderCollapse !== "collapse") return;
  const participates =
    style.display === "table" ||
    style.tableRole === "cell" ||
    style.tableRole === "row" ||
    style.tableRole === "row-group" ||
    style.tableRole === "header-group" ||
    style.tableRole === "footer-group";
  if (!participates) return;
  style.latticeBorder = {
    width: style.border,
    weight: style.borderWeight,
    style: style.borderStyle,
    color: style.borderColor,
    hidden: {
      top: cs.borderTopStyle === "hidden",
      right: cs.borderRightStyle === "hidden",
      bottom: cs.borderBottomStyle === "hidden",
      left: cs.borderLeftStyle === "hidden",
    },
  };
  style.border = zeroInsets();
  if (style.display === "table") style.padding = zeroInsets();
}

/** A computed color that paints nothing: one of alpha zero in any
 * form, or the empty string and `currentcolor` happy-dom leaves
 * unresolved. */
export function isTransparentColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "currentcolor" || colorAlpha(normalized) === 0;
}

/** Background-color read, routed through the synthesized-transition
 * tracker (animate.ts): a mid-fade read returns the interpolated color
 * — including near-transparent frames of a fade to/from unset, which
 * must paint rather than read as "no background". */
function readAnimatedBackground(
  el: Element,
  raw: string,
  cs: CSSStyleDeclaration,
): string | undefined {
  const tracked = trackBackground(el, isTransparentColor(raw) ? "" : raw, cs);
  return tracked === "" ? undefined : tracked;
}

function isClipping(value: string): boolean {
  return value === "hidden" || value === "clip";
}

/** Authored `scrollbar-width`, cached from the first CLEAN read: once
 * the element carries data-mw-scroll our own hiding lock sets it to
 * none, and Firefox never re-resolves the computed value when the
 * lock's [measuring] gate flips — so the pre-lock value is the truth
 * (authored changes after the first layout won't re-read there;
 * documented deviation). */
const scrollbarWidthCache = new WeakMap<Element, "auto" | "none">();
let scrollbarWidthReadable: boolean | null = null;

/** Environments with forced overlay scrollbars (headless Firefox
 * among them) compute `scrollbar-width: none` on EVERY element — a
 * pristine probe reading `none` means reads carry no authored signal,
 * so the engine ignores the property there instead of hiding every
 * bar. */
function scrollbarWidthReadsTrustworthy(doc: Document): boolean {
  if (scrollbarWidthReadable !== null) return scrollbarWidthReadable;
  if (!doc.body) return true; // decide later, on a real read
  const probe = doc.createElement("div");
  probe.style.cssText = "position: absolute; width: 0; height: 0; overflow: auto";
  doc.body.appendChild(probe);
  scrollbarWidthReadable = getComputedStyle(probe).scrollbarWidth !== "none";
  probe.remove();
  return scrollbarWidthReadable;
}

function readScrollbarWidth(el: Element, cs: CSSStyleDeclaration): "auto" | "none" {
  if (!scrollbarWidthReadsTrustworthy(el.ownerDocument)) return "auto";
  if (el.hasAttribute("data-mw-scroll")) {
    const cached = scrollbarWidthCache.get(el);
    if (cached !== undefined) return cached;
  }
  const value: "auto" | "none" = cs.scrollbarWidth === "none" ? "none" : "auto";
  scrollbarWidthCache.set(el, value);
  return value;
}

/** `scrollbar-color: <thumb> <track>` — two computed colors, split at
 * the top parenthesis level (rgb()/color() carry inner spaces). */
function readScrollbarColor(value: string): { thumb: string; track: string } | null {
  const [thumb, track] = splitTopLevel(value ?? "", " ");
  return thumb && track ? { thumb, track } : null;
}

/** A `<integer>` custom property in cells, floored at `min`. */
function readCells(value: string, min = 1): number {
  return Math.max(min, Math.floor(Number(value) || min));
}

function overflowAxis(value: string): OverflowAxis {
  if (isClipping(value)) return "clip";
  if (value === "auto" || value === "scroll") return value;
  return "visible";
}

/** Per-axis overflow (specs/scrolling.md). Longhands read first (the
 * shorthand sets both in real browsers; happy-dom may leave them "",
 * hence the fallback), then the CSS coercion: one non-visible axis
 * forces the other's `visible` to compute `auto`. */
export function readOverflow(cs: CSSStyleDeclaration): Overflow {
  let x = overflowAxis(cs.overflowX || cs.overflow);
  let y = overflowAxis(cs.overflowY || cs.overflow);
  if (x !== "visible" && y === "visible") y = "auto";
  if (y !== "visible" && x === "visible") x = "auto";
  return { x, y };
}

/** The screen-reader-only pattern (Tailwind `sr-only` and friends): an
 * absolutely positioned box whose ink can't show — a zero `clip` rect,
 * or a clipped ≤1px box. Treated as display:none by the ENGINE only:
 * the light-DOM element keeps its authored styles, so assistive tech
 * still reads it. */
function isZeroClipped(el: Element, cs: CSSStyleDeclaration): boolean {
  const { position } = cs;
  if (position !== "absolute" && position !== "fixed") return false;
  const clip = cs.clip.replace(/\s/g, "");
  if (clip === "rect(0px,0px,0px,0px)" || clip === "rect(0,0,0,0)") return true;
  // The clipped-box half reads the browser's NATURAL size, which for a
  // renderer leaf is meaningless (its size comes from the renderer's
  // lines; its light content is invisible) — a fresh absolute leaf
  // with overflow-clip and no padding measures 0x0 and would be
  // dropped before it ever renders, staying 0x0 forever.
  if (leafRendererFor(el.tagName)) return false;
  return (
    (isClipping(cs.overflow) || isClipping(cs.overflowX)) &&
    parseFloat(cs.width) <= 1 &&
    parseFloat(cs.height) <= 1
  );
}

/** A computed `display`. happy-dom leaves the initial `inline` and the
 * table parts' UA values unset (""); a browser always resolves one. */
export function computedDisplay(el: Element, cs: CSSStyleDeclaration): string {
  return cs.display || TABLE_DISPLAY_FALLBACK[el.tagName] || "inline";
}

const TABLE_DISPLAY_FALLBACK: Record<string, string> = {
  TABLE: "table",
  THEAD: "table-header-group",
  TBODY: "table-row-group",
  TFOOT: "table-footer-group",
  TR: "table-row",
  TD: "table-cell",
  TH: "table-cell",
  CAPTION: "table-caption",
  COL: "table-column",
  COLGROUP: "table-column-group",
};

const TABLE_ROLES: Record<string, TableRole> = {
  "table-header-group": "header-group",
  "table-row-group": "row-group",
  "table-footer-group": "footer-group",
  "table-row": "row",
  "table-cell": "cell",
  "table-caption": "caption",
  "table-column": "column",
  "table-column-group": "column-group",
};

const VERTICAL_ALIGN = { top: "start", middle: "center", bottom: "end" } as const;

/** Cell block-axis alignment, from the COMPUTED `vertical-align` — the
 * companion's baseline lock is measuring-gated, so the read sees the
 * authored/UA value from any authoring (classes, plain CSS, hints).
 * Only top/middle/bottom apply to cells (CSS 2.1); everything else
 * behaves as baseline, which behaves as `start`. Fallbacks are for
 * environments without presentational hints or UA table styles
 * (happy-dom): the `valign` attribute, then the tag's UA `middle`. */
function readVerticalAlign(el: Element, cs: CSSStyleDeclaration): "start" | "center" | "end" {
  const value =
    cs.verticalAlign ||
    el.getAttribute("valign")?.toLowerCase() ||
    (el.tagName === "TD" || el.tagName === "TH" ? "middle" : "baseline");
  return readKeyword(VERTICAL_ALIGN, value, "start");
}

/** The text properties a leaf takes from its own element — the host's
 * contribution to the root leaf too (specs/host-leaf.md). */
export function readTextStyle(
  el: Element,
  cs: CSSStyleDeclaration,
  rootFontSizePx: number,
): Pick<
  CellStyle,
  | "whiteSpace"
  | "tabSize"
  | "textOverflow"
  | "textDecorationLine"
  | "textAlignBlocked"
  | "textAlign"
  | "textIndent"
> {
  return {
    // `nowrap` and `pre` disable soft wrapping; `pre` additionally makes
    // the tree builder preserve the source's spaces and newlines
    // (specs/cell-model.md). Readable via getComputedStyle because the
    // companion stylesheet's white-space lock is measuring-gated.
    whiteSpace: readKeyword(WHITE_SPACES, cs.whiteSpace, "normal"),
    tabSize: Math.max(1, Math.floor(parseFloat(cs.tabSize)) || 8),
    textOverflow: cs.textOverflow === "ellipsis" ? "ellipsis" : "clip",
    textDecorationLine: cs.textDecorationLine,
    // The forced-start rule is measuring-gated, so the computed value is
    // the authored one (no echo); the legacy `align` attribute surfaces
    // as `-webkit-center`/`-moz-center`. Inherited centering blocks each
    // descendant individually — same net effect as CSS inheritance.
    textAlignBlocked: authoredTextAlignBlocked(el, cs),
    textAlign: readTextAlign(el, cs),
    textIndent: readTextIndent(cs, rootFontSizePx),
  };
}

/** Font sizes are locked to the root (cell-model deviation 3); the lock is
 * silent, so surface it once. Detected via class + inline style — the
 * companion stylesheet's `font-size: inherit` hides it from computed style. */
function warnAuthoredFontSize(
  el: Element,
  classAttr: string,
  inlineStyle: CSSStyleDeclaration,
): void {
  const authored =
    /(?:^|[\s:.[!])text-(?:xs|sm|base|lg|[2-9]?xl)(?![\w-])/.test(classAttr) ||
    /(?:^|[\s:.[!])text-\[(?:(?:length|size):|[\d.])/.test(classAttr) ||
    inlineStyle.fontSize !== "";
  if (!authored) return;
  warnOnce(
    el,
    "font-size inside <mono-wind> is ignored — all text shares the host's cell " +
      "size. Size the <mono-wind> element itself instead.",
  );
}

const RULE_BREAKS = keywords("none", "intersection");
const RULE_VISIBILITIES = keywords("all", "around", "between");

/** Gap rules from the `--mw-rule-*` mirrors (specs/gap-decorations.md);
 * registered `inherits: false`, so a container only sees its own. A
 * width is a weight, as for borders: the set's band draws it and
 * says its cells. */
function readGapRule(
  cs: CSSStyleDeclaration,
  axis: "x" | "y",
  set: BorderGlyphSet | undefined,
): GapRule | null {
  const weight = parseFloat(cs.getPropertyValue(`--mw-rule-${axis}-width`)) || 0;
  if (weight <= 0) return null;
  const style = readKeyword(
    BORDER_STYLES,
    cs.getPropertyValue(`--mw-rule-${axis}-style`).trim(),
    "solid",
  );
  const color = cs.getPropertyValue(`--mw-rule-${axis}-color`).trim();
  return {
    width: weightBand(style, weight, set).cells,
    weight: junctionWeight(style, weight, set),
    style,
    // Default currentColor, resolved on the CONTAINER (like computed
    // border colors) — decoration spans would otherwise inherit the
    // host's color, not the container's.
    color: color && color !== "currentcolor" && color !== "currentColor" ? color : cs.color,
  };
}

/** Only `justify` is blocked (its per-line extra word spacing is
 * fractional and off-grid). `center` is engine-quantized: the grid
 * paints each line at floor((W − line) / 2); the browser's own
 * (fractional) centering only touches the invisible light-DOM copy. */
function authoredTextAlignBlocked(el: Element, cs: CSSStyleDeclaration): boolean {
  if (cs.textAlign === "justify") return true;
  // Hint fallback for environments that don't map `align` (happy-dom).
  return el.getAttribute("align")?.toLowerCase() === "justify";
}

function readTextAlign(el: Element, cs: CSSStyleDeclaration): "start" | "center" | "end" {
  const value = cs.textAlign || el.getAttribute("align")?.toLowerCase() || "";
  if (value === "right" || value === "end") return "end";
  // -webkit-center / -moz-center: the legacy `align` attribute's
  // computed form in real browsers.
  if (value === "center" || value.endsWith("-center")) return "center";
  return "start";
}

function supportsTypedOM(
  el: Element,
): el is Element & { computedStyleMap(): StylePropertyMapReadOnly } {
  return typeof (el as { computedStyleMap?: unknown }).computedStyleMap === "function";
}

/** A keyword as `table` reads it, else `fallback`. */
function readKeyword<T, D = T>(
  table: Readonly<Record<string, T>>,
  value: string,
  fallback: D,
): T | D {
  return Object.hasOwn(table, value) ? table[value]! : fallback;
}

/** A table of keywords that read as themselves. */
function keywords<T extends string>(...values: T[]): Record<string, T> {
  return Object.fromEntries(values.map((value) => [value, value]));
}

/** An alignment value's keyword, as `table` reads it past css-align's
 * overflow position (`safe` or `unsafe`) and `legacy` (justify-items,
 * whose other keyword is what a grid's items take), and whether it is
 * `safe`, which a baseline is. A value the table lacks warns once and
 * reads as the initial value, the table's empty entry. */
function readAlignment<T>(
  el: Element,
  property: string,
  table: Readonly<Record<string, T>>,
  value: string,
): { keyword: T; safe: boolean } {
  const words = value.split(" ").filter((word) => word !== "legacy");
  const safe = words[0] === "safe";
  if (safe || words[0] === "unsafe") words.shift();
  const key = words.join(" ");
  if (Object.hasOwn(table, key)) {
    return { keyword: table[key]!, safe: safe || key.endsWith("baseline") };
  }
  warnOnce(el, `${property}: ${value} is not supported and reads as its initial value.`);
  return { keyword: table[""]!, safe: false };
}

/** Content distribution: `normal` (the initial value) and `stretch`
 * both read as `stretch` — flex treats it as `flex-start` (per
 * css-align), grid stretches auto tracks. */
const JUSTIFY: Record<string, JustifyContent> = {
  start: "start",
  "flex-start": "flex-start",
  left: "start",
  center: "center",
  "flex-end": "flex-end",
  end: "end",
  right: "end",
  "space-between": "space-between",
  "space-around": "space-around",
  "space-evenly": "space-evenly",
  baseline: "flex-start",
  "first baseline": "flex-start",
  "last baseline": "end",
  normal: "stretch",
  stretch: "stretch",
  "": "stretch",
};

/** Item alignment: `normal` behaves as `stretch` in flex and grid, and
 * `anchor-center` centers on the anchor for an anchored box
 * (specs/anchor-positioning.md), plainly for any other. */
const ALIGN: Record<string, AlignItems> = {
  start: "start",
  "flex-start": "flex-start",
  "self-start": "start",
  left: "start",
  center: "center",
  "anchor-center": "center",
  "flex-end": "flex-end",
  "self-end": "end",
  end: "end",
  right: "end",
  baseline: "baseline",
  "first baseline": "baseline",
  "last baseline": "last baseline",
  normal: "stretch",
  stretch: "stretch",
  "": "stretch",
};
const ALIGN_SELF: Record<string, AlignItems | "auto"> = {
  ...ALIGN,
  auto: "auto",
  normal: "auto",
  "": "auto",
};

const POSITIONS = keywords<Position>("relative", "absolute", "fixed", "sticky");
const WHITE_SPACES = keywords("pre", "nowrap");

/** `inline-start`/`inline-end` are the logical spellings a browser may
 * report for `float-start`/`float-end`; LTR maps them to the sides. */
const FLOAT_SIDES: Record<string, Float> = {
  left: "left",
  "inline-start": "left",
  right: "right",
  "inline-end": "right",
};
const CLEAR_SIDES: Record<string, Clear> = { ...FLOAT_SIDES, both: "both" };
const BORDER_STYLES = keywords<BorderStyle>("double", "dashed", "dotted");

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
 * class attribute for Tailwind auto-margin utilities, left to right
 * (specs/cell-model.md deviation 20).
 */
function readMargin(source: ReadSource): PerSide<CellLength | null> {
  const { cs, csm, classAttr, inlineStyle, rootFontSizePx } = source;
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
      if (physicalValue && (physicalValue.endsWith("%") || physicalValue.startsWith("calc("))) {
        const length = readSpacing(physicalValue, rootFontSizePx);
        if (length !== 0) return length;
      }
    } else if (
      autoClassPattern.test(classAttr) ||
      inlineStyle.getPropertyValue(physical) === "auto"
    ) {
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

/** Empty rows between wrapped lines: floor(line-height ÷ font-size) − 1,
 * never negative. Computed line-height is always px (or `normal`); the
 * divisor is FONT-SIZE, not cell-height, so unitless ratios keep their
 * CSS meaning (`leading-loose` = 2 → 2 rows per line, 1 gap) even when
 * cell-height ≠ 1em (default `line-height: normal` on the root makes
 * the cell ~1.15em). */
export function lineGapRows(lineHeight: string, fontSizePx: number): number {
  if (!lineHeight || lineHeight === "normal" || fontSizePx <= 0) return 0;
  const px = parseFloat(lineHeight);
  if (!Number.isFinite(px)) return 0;
  return Math.max(0, Math.floor(px / fontSizePx + 1e-6) - 1);
}

/** The `inset` stem that authors every side (`inset-0`), apart from the
 * axis, logical-side, shadow, and ring utilities sharing its prefix. */
const EVERY_SIDE = "inset(?!-(?:[xyse]|b[se]|shadow|ring)\\b)";

/** Each side's inset utility stems: its own, `inset`, its axis's, and
 * its logical side's, left-to-right. */
const SIDE_STEMS = {
  top: `top|${EVERY_SIDE}|inset-y|inset-bs`,
  right: `right|end|${EVERY_SIDE}|inset-x|inset-e`,
  bottom: `bottom|${EVERY_SIDE}|inset-y|inset-be`,
  left: `left|start|${EVERY_SIDE}|inset-x|inset-s`,
} as const;

/**
 * Read insets, preserving `auto` as `null`.
 *
 * Same trap as margins: on POSITIONED elements, `getComputedStyle` returns
 * *used* values for top/right/bottom/left — an `auto` side comes back as a
 * resolved distance, indistinguishable from an authored inset (which would
 * e.g. wrongly trigger the absolute stretch branch). Typed OM returns
 * *computed* values, so `auto` survives. The no-Typed-OM fallback trusts a
 * side only when an inline style or a Tailwind inset utility for it is
 * authored (then the used value equals the authored one) — a percentage
 * utility read from the class list, its used px having resolved the
 * percentage already. LTR only.
 */
function readInsets(source: ReadSource): PerSide<CellLength | null> {
  const { cs, csm, classAttr, inlineStyle, rootFontSizePx } = source;
  const side = (prop: Side): CellLength | null => {
    const stems = SIDE_STEMS[prop];
    if (csm) {
      const value = csm.get(prop)?.toString().trim();
      if (!value || value === "auto") return null;
      return readSpacing(value, rootFontSizePx);
    }
    const inline = inlineStyle[prop];
    if (inline) return inline === "auto" ? null : readSpacing(inline, rootFontSizePx);
    if (!new RegExp(`(?:^|[\\s:.[!])-?(?:${stems})-`).test(classAttr)) return null;
    // An inactive variant resolves to `auto`; no resolved value at all
    // (headless, stylesheet not loaded) trusts the class.
    const value = cs.getPropertyValue(prop);
    if (value === "auto") return null;
    const authored = authoredPercentInset(classAttr, stems, rootFontSizePx);
    if (authored !== undefined) return authored;
    return value ? readSpacing(value, rootFontSizePx) : null;
  };
  return {
    top: side("top"),
    right: side("right"),
    bottom: side("bottom"),
    left: side("left"),
  };
}

/** A percentage inset utility — a fraction (`top-1/2`), `full`, or an
 * arbitrary percentage or calc() — from the class list, negated by its
 * `-` prefix; undefined for any other utility. */
function authoredPercentInset(
  classAttr: string,
  stems: string,
  rootFontSizePx: number,
): CellLength | undefined {
  const lead = `(?:^|[\\s:.[!])(-?)(?:${stems})-`;
  const signed = (sign: string, length: CellLength): CellLength => {
    if (sign !== "-") return length;
    if (typeof length === "number") return -length;
    return length.cells === undefined
      ? { percent: -length.percent }
      : { percent: -length.percent, cells: -length.cells };
  };
  const fraction = new RegExp(`${lead}(\\d+)/(\\d+)(?![\\w./])`).exec(classAttr);
  if (fraction) {
    return signed(fraction[1]!, { percent: (100 * Number(fraction[2])) / Number(fraction[3]) });
  }
  const full = new RegExp(`${lead}full(?![\\w-])`).exec(classAttr);
  if (full) return signed(full[1]!, { percent: 100 });
  const arbitrary = new RegExp(`${lead}\\[(calc\\([^\\]]*\\)|-?\\d+(?:\\.\\d+)?%)\\]`).exec(
    classAttr,
  );
  if (arbitrary) {
    return signed(arbitrary[1]!, readSpacing(arbitrary[2]!.replaceAll("_", " "), rootFontSizePx));
  }
  return undefined;
}

/** The shadows of a computed `box-shadow` (specs/box-shadow.md): per
 * comma-separated shadow, `x y blur spread` — px once computed, a bare
 * `0` allowed — the offsets physical cells (a displacement: the
 * measured cell, the spacing scale before a measurement, a nonzero one
 * at least a cell), the blur unrounded and the spread on the spacing
 * scale, its color, the token that is no length, and its `inset`. */
function readBoxShadow(
  value: string,
  rootFontSizePx: number,
  metrics: CellMetrics | undefined,
): BoxShadow[] {
  if (!value || value === "none") return [];
  const isLength = (token: string) => /^-?[\d.]+(?:e[+-]?\d+)?(?:px)?$/i.test(token);
  const offset = (px: number, cellPx: number | undefined): number => {
    if (px === 0) return 0;
    const cells = cellPx ? Math.abs(px) / cellPx : Math.abs(pxToCells(px, rootFontSizePx));
    return Math.sign(px) * Math.max(1, Math.round(cells));
  };
  const shadows: BoxShadow[] = [];
  for (const part of splitTopLevel(value, ",")) {
    const tokens = splitTopLevel(part, " ");
    const lengths = tokens.filter(isLength).map(parseFloat);
    if (lengths.length < 2) continue;
    const [x, y, blur = 0, spread = 0] = lengths;
    shadows.push({
      x: offset(x!, metrics?.width),
      y: offset(y!, metrics?.height),
      blur: blur / (0.25 * rootFontSizePx),
      spread: pxToCells(spread, rootFontSizePx),
      color: tokens.find((token) => !isLength(token) && token !== "inset") ?? "currentcolor",
      inset: tokens.includes("inset"),
    });
  }
  return shadows;
}

/** The gradient layers of a computed `background-image`
 * (specs/gradients.md), in the forms engines serialize: a direction,
 * shape, size, position, or space first when present, then the stops
 * with their positions and hints, a `currentcolor` stop the element's
 * `color`; other layers (`url()`, `none`) are left out. */
function readBackgroundImage(value: string, color: string, rootFontSizePx: number): Gradient[] {
  const gradients: Gradient[] = [];
  if (!value || value === "none") return gradients;
  for (const layer of splitTopLevel(value.replace(/\bcurrentcolor\b/gi, color), ",")) {
    const match = /^\s*(repeating-)?(linear|radial|conic)-gradient\((.*)\)\s*$/s.exec(layer);
    if (!match) continue;
    const [, repeating, kind, inner] = match;
    const args = splitTopLevel(inner!, ",").map((arg) => arg.trim());
    const leads = args.length > 0 && !startsWithColor(args[0]!);
    const head = leads ? splitTopLevel(args[0]!, " ") : [];
    const stopArgs = leads ? args.slice(1) : args;
    const stops = readGradientStops(stopArgs, rootFontSizePx);
    if (stops.length < 2) continue;
    const base = { repeating: repeating !== undefined, ...gradientSpace(head, stopArgs), stops };
    if (kind === "linear") {
      gradients.push({ kind, ...base, direction: linearDirection(head) });
    } else if (kind === "radial") {
      gradients.push({ kind, ...base, ...radialGeometry(head, rootFontSizePx) });
    } else {
      const from = head.indexOf("from");
      gradients.push({
        kind: "conic",
        ...base,
        from: from >= 0 ? readAngle(head[from + 1] ?? "") : 0,
        at: readGradientAt(head, rootFontSizePx),
      });
    }
  }
  return gradients;
}

/** Whether a gradient argument opens with a color: a stop, then. */
const startsWithColor = (arg: string): boolean =>
  /^(?:rgba?|hsla?|oklab|oklch|color)\(|^transparent\b/i.test(arg);

const SPACES: ColorSpace[] = ["oklab", "oklch", "srgb", "srgb-linear", "hsl"];
const HUE_MODES: HueMode[] = ["shorter", "longer", "increasing", "decreasing"];

/** The interpolation space and hue mode: named with `in <space>
 * [<mode> hue]`, else oklab, or srgb when every stop is a legacy
 * color (CSS's default for those); a space outside the engine's
 * reads as oklab. */
function gradientSpace(head: string[], stopArgs: string[]): { space: ColorSpace; hue: HueMode } {
  const at = head.indexOf("in");
  if (at >= 0) {
    const named = head[at + 1] as ColorSpace;
    const mode = head[at + 2] as HueMode;
    return {
      space: SPACES.includes(named) ? named : "oklab",
      hue: HUE_MODES.includes(mode) ? mode : "shorter",
    };
  }
  const colors = stopArgs.filter(startsWithColor);
  const legacy = colors.every((arg) => isLegacyColor(splitTopLevel(arg, " ")[0] ?? ""));
  return { space: legacy ? "srgb" : "oklab", hue: "shorter" };
}

/** Where the background paints, the first layer's keyword. */
function readBackgroundClip(value: string): BackgroundClip {
  const first = value.split(",")[0]!.trim();
  return first === "text" || first === "padding-box" || first === "content-box"
    ? first
    : "border-box";
}

/** An angle in degrees from a CSS angle token. */
function readAngle(token: string): number {
  const amount = parseFloat(token);
  if (!Number.isFinite(amount)) return 0;
  if (token.endsWith("grad")) return amount * 0.9;
  if (token.endsWith("rad")) return (amount * 180) / Math.PI;
  if (token.endsWith("turn")) return amount * 360;
  return amount;
}

/** `to <side-or-corner>` or an angle; `to bottom` (180deg) by default. */
function linearDirection(head: string[]): { angle: number } | { toX: number; toY: number } {
  if (head[0] === "to") {
    let toX = 0;
    let toY = 0;
    for (const side of head.slice(1)) {
      if (side === "left") toX = -1;
      else if (side === "right") toX = 1;
      else if (side === "top") toY = -1;
      else if (side === "bottom") toY = 1;
    }
    return { toX, toY };
  }
  const angle = head.find((token) => /^-?[\d.]+(?:deg|grad|rad|turn)$/.test(token));
  return angle === undefined ? { angle: 180 } : { angle: readAngle(angle) };
}

/** A gradient length: a percentage as a fraction, an angle (a conic's
 * positions) as a fraction of the turn, a px length as cells on the
 * spacing scale. */
function gradientLength(token: string, rootFontSizePx: number): GradientLength | null {
  const amount = parseFloat(token);
  if (!Number.isFinite(amount)) return null;
  if (token.endsWith("%")) return { fraction: amount / 100 };
  if (/(?:deg|grad|rad|turn)$/.test(token)) return { fraction: readAngle(token) / 360 };
  return { cells: pxToCells(amount, rootFontSizePx) };
}

/** The `at <position>` of a radial or conic gradient, the center by
 * default: keywords and lengths, one value centering the other axis. */
function readGradientAt(head: string[], rootFontSizePx: number): GradientPoint {
  const at = head.indexOf("at");
  const center = { fraction: 0.5 };
  if (at < 0) return { x: center, y: center };
  const keyword: Record<string, GradientLength> = {
    left: { fraction: 0 },
    top: { fraction: 0 },
    center,
    right: { fraction: 1 },
    bottom: { fraction: 1 },
  };
  const values = head.slice(at + 1, at + 3).filter((token) => token !== "in");
  const [first, second] = values.map(
    (token) => keyword[token] ?? gradientLength(token, rootFontSizePx),
  );
  const swap =
    values[0] === "top" || values[0] === "bottom" || values[1] === "left" || values[1] === "right";
  const x = (swap ? second : first) ?? center;
  const y = (swap ? first : second) ?? center;
  return { x, y };
}

/** A radial gradient's shape, size, and position: `ellipse` and
 * `farthest-corner` by default, a lone length a circle's radius, a
 * pair an ellipse's radii. */
function radialGeometry(
  head: string[],
  rootFontSizePx: number,
): { shape: "circle" | "ellipse"; size: RadialSize; at: GradientPoint } {
  const at = head.indexOf("at");
  const own = at < 0 ? head : head.slice(0, at);
  const keyword = own.find((token) =>
    ["closest-side", "farthest-side", "closest-corner", "farthest-corner"].includes(token),
  ) as Exclude<RadialSize, object> | undefined;
  const lengths = own
    .map((token) => (/^[\d.]/.test(token) ? gradientLength(token, rootFontSizePx) : null))
    .filter((length): length is GradientLength => length !== null);
  let shape: "circle" | "ellipse" = own.includes("circle") ? "circle" : "ellipse";
  let size: RadialSize = keyword ?? "farthest-corner";
  if (lengths.length === 1) {
    shape = "circle";
    size = { rx: lengths[0]!, ry: lengths[0]! };
  } else if (lengths.length >= 2) {
    shape = "ellipse";
    size = { rx: lengths[0]!, ry: lengths[1]! };
  }
  return { shape, size, at: readGradientAt(head, rootFontSizePx) };
}

/** The stops of a gradient, each a color and up to two positions
 * (two make two stops), a lone length between stops a hint. */
function readGradientStops(args: string[], rootFontSizePx: number): GradientStop[] {
  const stops: GradientStop[] = [];
  for (const arg of args) {
    const tokens = splitTopLevel(arg, " ");
    const color = parseColor(tokens[0] ?? "");
    if (!color) {
      const hint = gradientLength(tokens[0] ?? "", rootFontSizePx);
      const last = stops[stops.length - 1];
      if (hint && last) last.hint = hint;
      continue;
    }
    const positions = tokens.slice(1, 3).map((token) => gradientLength(token, rootFontSizePx));
    if (positions.length === 0) positions.push(null);
    for (const position of positions) stops.push({ color, position });
  }
  return stops;
}

/** A corner's radius in cells on the spacing scale, unrounded — the
 * nearest registered corner glyph draws it; a percentage is `Infinity`
 * (the largest registration), an elliptical pair its smaller radius. */
function readRadius(value: string, rootFontSizePx: number): number {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 0;
  let radius = Infinity;
  for (const part of parts) {
    const amount = parseFloat(part);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    radius = Math.min(radius, part.endsWith("%") ? Infinity : amount / (0.25 * rootFontSizePx));
  }
  return radius;
}

/**
 * Read a min/max constraint: an authored calc() or viewport length first,
 * then the computed value. Percentages must be kept symbolic (they resolve
 * against the parent's content box during layout) — naive px parsing would
 * read `"100%"` as 100px and produce a nonsense cell count.
 */
function readLimit(
  source: ReadSource,
  property: string,
  value: string,
  prefix: string,
): SizeLimit | undefined {
  const resolved = resolvedText(source.csm, property, value);
  const authored = authoredCells(source, property, resolved, prefix);
  if (authored !== undefined) return authored;
  if (!value || value === "none" || value === "auto") return undefined;
  if (value === "min-content" || value === "max-content" || value === "fit-content") return value;
  if (value.endsWith("%")) {
    const percent = parseFloat(value);
    return Number.isFinite(percent) ? { percent } : undefined;
  }
  const px = parseFloat(value);
  return Number.isFinite(px) ? pxToCells(px, source.rootFontSizePx) : undefined;
}

/**
 * Read a spacing length. Percentages stay symbolic — they resolve against
 * the containing block's width during layout (getComputedStyle would give
 * a used px value based on the pre-grid natural layout, which is wrong).
 */
function readSpacing(value: string, rootFontSizePx: number): CellLength {
  if (!value || value === "auto" || value === "none") return 0;
  // A calc() the browser computed keeps only a percentage symbolic,
  // every other term in px: a percentage plus cells.
  if (value.startsWith("calc(")) {
    const calc = evaluateCalc(value, "width", undefined, rootFontSizePx);
    if (!calc || calc.unitless) return 0;
    const cells = roundHalfAwayFromZero(calc.cells);
    if (calc.percent === 0) return cells;
    return cells === 0 ? { percent: calc.percent } : { percent: calc.percent, cells };
  }
  if (value.endsWith("%")) {
    const percent = parseFloat(value);
    return Number.isFinite(percent) && percent !== 0 ? { percent } : 0;
  }
  const px = parseFloat(value);
  return Number.isFinite(px) ? pxToCells(px, rootFontSizePx) : 0;
}

/** Computed `opacity`, clamped to [0, 1]; a non-numeric read is opaque. */
export function readOpacity(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
}

/** A layer root — an element with a transform or a filter set, or a
 * running animation or transition of one (specs/animations.md) — and its
 * `backdrop-filter`, read while the companion's lock is off. An
 * identity (Tailwind's `transform`, `transform-gpu`, a dialog resting
 * at `scale-100` after its transition) is none. */
const IDENTITY = new Set([
  "matrix(1, 0, 0, 1, 0, 0)",
  "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
  "1",
  "1 1",
  "1 1 1",
  "0deg",
  "0px",
  "0px 0px",
  "0px 0px 0px",
]);

function readLayer(el: Element, cs: CSSStyleDeclaration): Layer | null {
  const effect = (property: string): string => {
    const value = cs.getPropertyValue(property).trim();
    return value === "" || IDENTITY.has(value) ? "none" : value;
  };
  const backdropFilter = effect("backdrop-filter");
  let layered = backdropFilter !== "none";
  for (const property of EFFECTS) layered ||= effect(property) !== "none";
  layered ||= animatesEffect(el);
  return layered ? { backdropFilter, resampled: resamples(effect) } : null;
}

/** Whether the effects draw the layer's cells at another size or angle
 * (types.ts `resampled`). A translation and a filter carry them as they
 * are; `matrix(a, b, c, d, tx, ty)` does too at the identity in `a..d`,
 * and anything else resamples. */
function resamples(effect: (property: string) => string): boolean {
  if (effect("scale") !== "none" || effect("rotate") !== "none") return true;
  const transform = effect("transform");
  if (transform === "none") return false;
  if (transform.startsWith("matrix3d(")) return true;
  const matrix = /^matrix\(([^)]*)\)$/.exec(transform);
  // Left as authored where the environment serializes no matrix: only
  // translations carry the cells.
  if (!matrix) return transform.replaceAll(/translate(?:[XYZ]|3d)?\([^)]*\)/g, "").trim() !== "";
  const [a, b, c, d] = matrix[1]!.split(",").map(Number);
  return !(a === 1 && b === 0 && c === 0 && d === 1);
}

/** The paint-only properties a frame of an animation resamples onto a
 * node (specs/animations.md): live on the light element, read off the
 * node by the walk. */
export function readPaintStyle(
  cs: CSSStyleDeclaration,
): Pick<CellStyle, "color" | "opacity" | "borderColor"> {
  return {
    color: cs.color,
    opacity: readOpacity(cs.opacity),
    borderColor: {
      top: cs.borderTopColor,
      right: cs.borderRightColor,
      bottom: cs.borderBottomColor,
      left: cs.borderLeftColor,
    },
  };
}

/** `text-indent` in cells. Percentages come through as `Npx` after
 * `getComputedStyle` only when a definite width is around, and even then
 * they'd need per-line resolution; treat them as 0. */
function readTextIndent(cs: CSSStyleDeclaration, rootFontSizePx: number): number {
  const value = cs.textIndent;
  if (!value || value.endsWith("%")) return 0;
  const px = parseFloat(value);
  return Number.isFinite(px) ? Math.max(0, pxToCells(px, rootFontSizePx)) : 0;
}

function readSize(source: ReadSource, key: "width" | "height", computed: string): Size | undefined {
  const { csm, classAttr, inlineStyle, rootFontSizePx } = source;
  const axis = key === "width" ? "w" : "h";
  const resolved = resolvedText(csm, key, computed);
  const authored = authoredCells(source, key, resolved, axis);
  if (authored !== undefined) return { kind: "cells", value: authored };
  if (csm) {
    if (resolved === "" || resolved === "auto") return undefined;
    const intrinsic = intrinsicSizeKeyword(resolved);
    if (intrinsic) return intrinsic;
    const amount = parseFloat(resolved);
    if (resolved.endsWith("%")) return { kind: "percent", value: amount };
    if (resolved.endsWith("px")) return { kind: "cells", value: pxToCells(amount, rootFontSizePx) };
    if (resolved.endsWith("rem"))
      return { kind: "cells", value: roundHalfAwayFromZero(amount / 0.25) };
  }
  // Fallback path (Firefox pre-157: no Typed OM). getComputedStyle returns
  // *used* values (always px) for box properties, so we can't distinguish
  // "authored w-N" from "natural content width". Look at what was authored:
  // inline styles first, then any Tailwind sizing utility in the class list.
  // If neither is present, treat as auto so intrinsic sizing kicks in.
  const inline = key === "width" ? inlineStyle.width : inlineStyle.height;
  if (inline) {
    if (inline === "auto") return undefined;
    const intrinsic = intrinsicSizeKeyword(inline);
    if (intrinsic) return intrinsic;
    if (inline.endsWith("%")) return { kind: "percent", value: parseFloat(inline) };
    const px = parseFloat(inline);
    if (Number.isFinite(px)) return { kind: "cells", value: pxToCells(px, rootFontSizePx) };
  }
  // Intrinsic-keyword utilities (`w-min`…) must be caught by class scan here:
  // getComputedStyle would hand back the browser's *used* px width, which is
  // measured content px — NOT on the spacing scale — and would convert to a
  // nonsense cell count. `size-*` sets both axes; the lead-in admits
  // variants (`md:w-full`, `hover:w-0`, `[&_span]:w-2`).
  const stem = `(?:^|[\\s:.[!])(?:${axis}|size)-`;
  if (new RegExp(`${stem}min\\b`).test(classAttr)) return { kind: "min-content" };
  if (new RegExp(`${stem}max\\b`).test(classAttr)) return { kind: "max-content" };
  if (new RegExp(`${stem}fit\\b`).test(classAttr)) return { kind: "fit-content" };
  // Percent utilities must be caught here too: their used px depends on
  // the (pre-neutralization) native layout — badly wrong inside tables.
  const fraction = new RegExp(`${stem}(\\d+)/(\\d+)(?![\\w./])`).exec(classAttr);
  if (fraction)
    return { kind: "percent", value: (100 * Number(fraction[1])) / Number(fraction[2]) };
  if (new RegExp(`${stem}full(?![\\w-])`).test(classAttr)) return { kind: "percent", value: 100 };
  const arbitraryPercent = new RegExp(`${stem}\\[(\\d+(?:\\.\\d+)?)%\\]`).exec(classAttr);
  if (arbitraryPercent) return { kind: "percent", value: Number(arbitraryPercent[1]) };
  // Numeric spacing-scale utility (`h-7`, `w-0.5`, …): map the class
  // directly to cells. Match the Tailwind spacing scale (N * 0.25rem
  // = N cells) so we don't have to trust `cs.height` — same result
  // for most elements, but critical for <td>/<th> in Firefox where
  // `cs.height` returns the USED height from the table layout
  // (including rowspan effects), not the authored value.
  const numeric = new RegExp(`${stem}(\\d+(?:\\.\\d+)?)(?![\\w-/])`).exec(classAttr);
  if (numeric) return { kind: "cells", value: roundHalfAwayFromZero(Number(numeric[1])) };
  if (!new RegExp(stem).test(classAttr)) return undefined;
  if (computed.endsWith("%")) return { kind: "percent", value: parseFloat(computed) };
  const px = parseFloat(computed);
  if (Number.isFinite(px)) return { kind: "cells", value: pxToCells(px, rootFontSizePx) };
  return undefined;
}

/** Parse an authored viewport-relative length ("100dvh", "50vw", …)
 * into px against the current viewport. null for anything else. */
function viewportLengthPx(value: string): number | null {
  const match = /^(-?[\d.]+)((?:[dsl]?v)(?:h|w|min|max)|vi|vb)$/.exec(value.trim());
  if (!match || typeof window === "undefined") return null;
  const amount = parseFloat(match[1]!);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2]!;
  const height = window.innerHeight;
  const width = window.innerWidth;
  const basis = unit.endsWith("h")
    ? height
    : unit.endsWith("min")
      ? Math.min(width, height)
      : unit.endsWith("max")
        ? Math.max(width, height)
        : unit === "vb"
          ? height
          : width; // vw / vi
  return (amount / 100) * basis;
}

/** Tailwind viewport utilities (`h-screen`, `min-h-dvh`, `h-[95dvh]`,
 * …) → px. Scanned in EVERY engine (computed values resolve viewport
 * units to plain px); callers active-check the result. `prefix` is
 * the utility stem ("h", "w", "min-h", …). */
function viewportUtilityPx(classAttr: string, prefix: string): number | null {
  if (typeof window === "undefined") return null;
  const named = new RegExp(`(?:^|[\\s:.[!])${prefix}-(screen|[dsl]v[hw])(?![\\w-])`).exec(
    classAttr,
  );
  if (named) {
    const name = named[1]!;
    // h-screen = 100vh, w-screen = 100vw; explicit units name their axis.
    if (name === "screen") return prefix.includes("h") ? window.innerHeight : window.innerWidth;
    return name.endsWith("h") ? window.innerHeight : window.innerWidth;
  }
  // Arbitrary viewport values: h-[95dvh], min-h-[50vh], …
  const arbitrary = new RegExp(
    `(?:^|[\\s:.[!])${prefix}-\\[(-?[\\d.]+(?:[dsl]?v(?:h|w|min|max)|vi|vb))\\]`,
  ).exec(classAttr);
  return arbitrary ? viewportLengthPx(arbitrary[1]!) : null;
}

/** Convert PHYSICAL px to cells on the given axis using the measured
 * cell size — viewport-relative lengths mean real screen distance, not
 * the spacing scale. Headless fallback: the spacing scale. */
function physicalCells(
  px: number,
  key: "width" | "height",
  metrics: CellMetrics | undefined,
  rootFontSizePx: number,
): number {
  const cellPx = key === "width" ? metrics?.width : metrics?.height;
  if (cellPx && cellPx > 0) return Math.max(0, Math.floor(px / cellPx));
  return pxToCells(px, rootFontSizePx);
}

/** A length whose authored units carry intent the computed px has lost,
 * in cells: a viewport length through the measured cell
 * (specs/cell-model.md "Viewport-relative lengths"), a `calc()` per
 * term ("Mixed-unit calc()": viewport units like `h-screen`, `rem`,
 * `--spacing(N)` and `px` on the spacing scale, so `calc(100vh -
 * --spacing(2))` is "the rows that fit, minus two"). From the inline
 * style, which wins by cascade, or Typed OM's `resolved` text; else a
 * utility (`max-h-[calc(…)]`, `_` for spaces; `min-h-[95dvh]`, a size's
 * `size-*` too), active-checked against that text. A percentage term,
 * or one the evaluator does not model (em, var()), leaves the value to
 * the computed px. undefined = none. */
function authoredCells(
  source: ReadSource,
  property: string,
  resolved: string,
  prefix: string,
): number | undefined {
  const { classAttr, metrics, rootFontSizePx } = source;
  const key = property.endsWith("width") ? "width" : "height";
  const inline = source.inlineStyle.getPropertyValue(property).trim();
  // A viewport string is proof in itself: parsed as px, "100dvh" is 100.
  const viewport = viewportLengthPx(inline) ?? (source.csm ? viewportLengthPx(resolved) : null);
  if (viewport !== null) return physicalCells(viewport, key, metrics, rootFontSizePx);
  const fromInline = inline.startsWith("calc(");
  // Six reads per element: the substring test spares the regex almost always.
  const calc = fromInline
    ? inline
    : classAttr.includes("-[calc(")
      ? new RegExp(`(?:^|[\\s:.[!])${prefix}-\\[(calc\\([^\\]]*\\))\\]`)
          .exec(classAttr)?.[1]
          ?.replaceAll("_", " ")
      : undefined;
  const value = calc ? evaluateCalc(calc, key, metrics, rootFontSizePx) : null;
  if (
    value &&
    !value.unitless &&
    value.percent === 0 &&
    (fromInline || activeUtilityPx(resolved, value.px) !== null)
  ) {
    return Math.max(0, roundHalfAwayFromZero(value.cells));
  }
  // Class scan, every engine: computed values resolve viewport units to
  // plain px; the resolved px, active, also carries the sv/lv/dv bases.
  const scanned =
    viewportUtilityPx(classAttr, prefix) ??
    (property === key ? viewportUtilityPx(classAttr, "size") : null);
  const px = scanned === null ? null : activeUtilityPx(resolved, scanned);
  return px === null ? undefined : physicalCells(px, key, metrics, rootFontSizePx);
}

/** A property's resolved value as text: Typed OM's, else the computed one. */
function resolvedText(
  csm: StylePropertyMapReadOnly | null,
  property: string,
  computed: string,
): string {
  return (csm ? String(csm.get(property) ?? "") : computed).trim();
}

/** The active-check for a length a class authors, against the resolved
 * value: an inactive variant or an overriding declaration resolves
 * elsewhere — to other px, or to a keyword (`none`, `auto`) — and wins
 * (null). Active, the resolved px; no resolved value at all (headless,
 * stylesheet not loaded) trusts the authored px. */
function activeUtilityPx(resolvedValue: string, authoredPx: number): number | null {
  const resolved = parseFloat(resolvedValue);
  if (!Number.isFinite(resolved)) return resolvedValue === "" ? authoredPx : null;
  return Math.abs(resolved - authoredPx) <= Math.abs(authoredPx) * 0.3 ? resolved : null;
}

/** A calc term carried two ways: the engine's cells (per-unit
 * semantics) and the px the browser computes (for the active-check),
 * with a percentage kept symbolic. */
interface CalcValue {
  cells: number;
  px: number;
  percent: number;
  unitless: boolean;
}

/** Recursive-descent evaluation of `calc()` arithmetic over lengths.
 * null for anything outside the modeled units. */
function evaluateCalc(
  source: string,
  key: "width" | "height",
  metrics: CellMetrics | undefined,
  rootFontSizePx: number,
): CalcValue | null {
  const tokens = source.match(/--spacing\(\s*-?[\d.]+\s*\)|calc|[\d.]+[a-z%]*|[()+\-*/]/g);
  if (!tokens || tokens.join("").replace(/\s+/g, "") !== source.replace(/\s+/g, "")) return null;
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const next = (): string | undefined => tokens[i++];
  const length = (cells: number, px: number): CalcValue => ({
    cells,
    px,
    percent: 0,
    unitless: false,
  });
  const term = (token: string): CalcValue | null => {
    const spacing = /^--spacing\(\s*(-?[\d.]+)\s*\)$/.exec(token);
    if (spacing) {
      const n = parseFloat(spacing[1]!);
      return length(n, (n * rootFontSizePx) / 4);
    }
    const match = /^([\d.]+)([a-z%]*)$/.exec(token);
    if (!match) return null;
    const amount = parseFloat(match[1]!);
    const unit = match[2]!;
    if (!Number.isFinite(amount)) return null;
    if (unit === "") return { cells: amount, px: amount, percent: 0, unitless: true };
    if (unit === "%") return { cells: 0, px: 0, percent: amount, unitless: false };
    if (unit === "px") return length(amount / (rootFontSizePx / 4), amount);
    if (unit === "rem") return length(amount * 4, amount * rootFontSizePx);
    const viewport = viewportLengthPx(token);
    if (viewport === null) return null;
    return length(physicalCells(viewport, key, metrics, rootFontSizePx), viewport);
  };
  const combine = (op: string, a: CalcValue, b: CalcValue): CalcValue | null => {
    if (op === "+" || op === "-") {
      if (a.unitless !== b.unitless) return null;
      const sign = op === "+" ? 1 : -1;
      return {
        cells: a.cells + sign * b.cells,
        px: a.px + sign * b.px,
        percent: a.percent + sign * b.percent,
        unitless: a.unitless,
      };
    }
    if (op === "*") {
      if (!a.unitless && !b.unitless) return null;
      const [n, v] = a.unitless ? [a, b] : [b, a];
      return {
        cells: v.cells * n.cells,
        px: v.px * n.px,
        percent: v.percent * n.cells,
        unitless: v.unitless && n.unitless,
      };
    }
    if (!b.unitless || b.px === 0) return null;
    return {
      cells: a.cells / b.cells,
      px: a.px / b.px,
      percent: a.percent / b.cells,
      unitless: a.unitless,
    };
  };
  const factor = (): CalcValue | null => {
    const token = next();
    if (token === undefined) return null;
    if (token === "-") {
      const value = factor();
      return value && { ...value, cells: -value.cells, px: -value.px, percent: -value.percent };
    }
    if (token === "calc") return next() === "(" ? group() : null;
    if (token === "(") return group();
    return term(token);
  };
  const group = (): CalcValue | null => {
    const value = sum();
    return next() === ")" ? value : null;
  };
  const product = (): CalcValue | null => {
    let value = factor();
    while (value && (peek() === "*" || peek() === "/")) {
      const op = next()!;
      const rhs = factor();
      value = rhs ? combine(op, value, rhs) : null;
    }
    return value;
  };
  const sum = (): CalcValue | null => {
    let value = product();
    while (value && (peek() === "+" || peek() === "-")) {
      const op = next()!;
      const rhs = product();
      value = rhs ? combine(op, value, rhs) : null;
    }
    return value;
  };
  const result = sum();
  return i === tokens.length ? result : null;
}

/**
 * CSS `flex-basis`. `auto` → undefined, so the layout falls back to the
 * width-or-intrinsic base; `content` is the content's size, the item's
 * own width or height aside (CSS §7.2.3). `0%` (Tailwind `flex-1`) must
 * survive as an actual zero base.
 */
function readFlexBasis(value: string, rootFontSizePx: number): Size | undefined {
  if (!value || value === "auto") return undefined;
  if (value === "content") return { kind: "max-content" };
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
 * Parse a computed `grid-template-columns` / `grid-template-rows` value
 * (specs/grid.md). Expected on a NON-grid element (see the degrid read in
 * readCellStyle), so the authored structure survives: lengths are computed
 * to px, but `fr`, `minmax()`, and `repeat()` keep their form. Fixed
 * repeats expand here; `auto-fill` / `auto-fit` stay symbolic for layout.
 */
export function parseTrackTemplate(value: string, rootFontSizePx: number): GridTemplate {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") return { kind: "none" };
  if (trimmed === "subgrid" || trimmed.startsWith("subgrid ")) return { kind: "subgrid" };
  const tracks: TrackSize[] = [];
  const lineNames: string[][] = [];
  // Names collected for the line BEFORE the next track (or the trailing
  // line); a `repeat()`'s edge groups merge into it, per CSS.
  let pending: string[] = [];
  const pushTrack = (track: TrackSize) => {
    lineNames.push(pending);
    pending = [];
    tracks.push(track);
  };
  let autoRepeat: NonNullable<Extract<GridTemplate, { kind: "tracks" }>["autoRepeat"]> | undefined;
  for (const token of splitTopLevel(trimmed, " ")) {
    const names = parseLineNames(token);
    if (names) {
      pending.push(...names);
      continue;
    }
    const repeat = token.match(/^repeat\(\s*([^,]+?)\s*,(.*)\)$/s);
    if (repeat) {
      const inner = parseTrackList(repeat[2]!.trim(), rootFontSizePx);
      if (inner.tracks.length === 0) continue;
      const count = repeat[1]!;
      if (count === "auto-fill" || count === "auto-fit") {
        // Per CSS only one auto-repeat is allowed; a second is ignored.
        if (!autoRepeat) {
          autoRepeat = { index: tracks.length, tracks: inner.tracks, mode: count };
          if (inner.lineNames.some((n) => n.length > 0)) autoRepeat.lineNames = inner.lineNames;
          if (pending.length > 0) autoRepeat.leadingNames = pending;
          pending = [];
        }
        continue;
      }
      const n = Math.max(0, Math.floor(Number(count) || 0));
      for (let i = 0; i < n; i++) {
        pending.push(...inner.lineNames[0]!);
        for (let j = 0; j < inner.tracks.length; j++) {
          pushTrack(inner.tracks[j]!);
          pending.push(...inner.lineNames[j + 1]!);
        }
      }
      continue;
    }
    pushTrack(parseTrackSize(token, rootFontSizePx));
  }
  lineNames.push(pending);
  if (tracks.length === 0 && !autoRepeat) return { kind: "none" };
  const template: Extract<GridTemplate, { kind: "tracks" }> = { kind: "tracks", tracks };
  if (lineNames.some((n) => n.length > 0)) template.lineNames = lineNames;
  if (autoRepeat) template.autoRepeat = autoRepeat;
  return template;
}

/** A plain track list (no `repeat()`): tracks plus the line names around
 * them — `lineNames` has one entry per line, tracks.length + 1. */
function parseTrackList(
  value: string,
  rootFontSizePx: number,
): { tracks: TrackSize[]; lineNames: string[][] } {
  const tracks: TrackSize[] = [];
  const lineNames: string[][] = [];
  let pending: string[] = [];
  for (const token of splitTopLevel(value, " ")) {
    const names = parseLineNames(token);
    if (names) {
      pending.push(...names);
      continue;
    }
    lineNames.push(pending);
    pending = [];
    tracks.push(parseTrackSize(token, rootFontSizePx));
  }
  lineNames.push(pending);
  return { tracks, lineNames };
}

/** `[name other-name]` → the names; null for any other token. */
function parseLineNames(token: string): string[] | null {
  const group = token.match(/^\[(.*)\]$/s);
  if (!group) return null;
  return group[1]!.split(/\s+/).filter((name) => name !== "");
}

/**
 * Parse `grid-template-areas` (specs/grid.md): one quoted string per row,
 * whitespace-separated cell tokens, `.` (any run of dots) for an empty
 * cell. Per CSS the whole value is invalid — and reads as `none` — when
 * rows have different lengths or a name's cells don't form one
 * filled-in rectangle.
 */
export function parseGridTemplateAreas(value: string): GridAreas | null {
  const rows: string[][] = [];
  for (const match of value.matchAll(/"([^"]*)"|'([^']*)'/g)) {
    const cells = (match[1] ?? match[2] ?? "")
      .trim()
      .split(/\s+/)
      .filter((c) => c !== "");
    if (cells.length === 0) return null;
    rows.push(cells);
  }
  if (rows.length === 0) return null;
  const columns = rows[0]!.length;
  if (rows.some((row) => row.length !== columns)) return null;
  const areas = new Map<string, GridArea>();
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (/^\.+$/.test(cell)) return;
      const area = areas.get(cell);
      if (!area) areas.set(cell, { colStart: c, colEnd: c + 1, rowStart: r, rowEnd: r + 1 });
      else {
        area.colStart = Math.min(area.colStart, c);
        area.colEnd = Math.max(area.colEnd, c + 1);
        area.rowStart = Math.min(area.rowStart, r);
        area.rowEnd = Math.max(area.rowEnd, r + 1);
      }
    });
  });
  // Rectangular check: every cell inside a name's bounding box carries it.
  for (const [name, area] of areas) {
    for (let r = area.rowStart; r < area.rowEnd; r++) {
      for (let c = area.colStart; c < area.colEnd; c++) {
        if (rows[r]![c] !== name) return null;
      }
    }
  }
  return { columns, rows: rows.length, areas };
}

/** Parse `grid-auto-columns` / `grid-auto-rows`: a track-size list, cycled
 * across implicit tracks. Falls back to a single `auto`. */
function parseAutoTracks(value: string, rootFontSizePx: number): TrackSize[] {
  const tracks = splitTopLevel(value.trim(), " ")
    .filter((t) => t !== "" && !t.startsWith("["))
    .map((t) => parseTrackSize(t, rootFontSizePx));
  return tracks.length > 0 ? tracks : [autoTrack()];
}

/** Normalize one track size to a minmax pair: `<n>fr` → minmax(auto, fr)
 * per CSS; a fixed/intrinsic breadth b → minmax(b, b). `fit-content()` is
 * deferred (specs/grid.md deviations) and reads as `auto`. */
function parseTrackSize(token: string, rootFontSizePx: number): TrackSize {
  const minmax = token.match(/^minmax\((.*)\)$/s);
  if (minmax) {
    // Depth-aware argument split — a nested function (`minmax(min(8rem,
    // 100%), 1fr)`) has commas of its own.
    const args = splitTopLevel(minmax[1]!, ",").map((arg) => arg.trim());
    if (args.length === 2) {
      return {
        min: parseTrackBreadth(args[0]!, rootFontSizePx),
        max: parseTrackBreadth(args[1]!, rootFontSizePx),
      };
    }
    return { min: { kind: "auto" }, max: { kind: "auto" } };
  }
  const breadth = parseTrackBreadth(token, rootFontSizePx);
  if (breadth.kind === "fr") return { min: { kind: "auto" }, max: breadth };
  return { min: breadth, max: breadth };
}

function parseTrackBreadth(token: string, rootFontSizePx: number): TrackBreadth {
  if (token === "auto" || token.startsWith("fit-content")) return { kind: "auto" };
  if (token === "min-content") return { kind: "min-content" };
  if (token === "max-content") return { kind: "max-content" };
  // min()/max() over fixed breadths stay symbolic (percent arguments
  // resolve against the axis at layout time). Anything unresolvable —
  // calc() arithmetic included — degrades to `auto` (specs/grid.md
  // deviations).
  const math = token.match(/^(min|max)\((.*)\)$/s);
  if (math) {
    const args = splitTopLevel(math[2]!, ",").map((arg) =>
      parseTrackBreadth(arg.trim(), rootFontSizePx),
    );
    const fixed = args.every(
      (a) => a.kind === "cells" || a.kind === "percent" || a.kind === "math",
    );
    if (args.length > 0 && fixed) {
      return { kind: "math", fn: math[1] as "min" | "max", args };
    }
    return { kind: "auto" };
  }
  if (token.endsWith("fr")) {
    const value = parseFloat(token);
    return Number.isFinite(value) && value >= 0 ? { kind: "fr", value } : { kind: "auto" };
  }
  if (token.endsWith("%")) {
    const percent = parseFloat(token);
    return Number.isFinite(percent) ? { kind: "percent", value: percent } : { kind: "auto" };
  }
  const px = parseFloat(token);
  if (!Number.isFinite(px)) return { kind: "auto" };
  const cells = token.endsWith("rem")
    ? roundHalfAwayFromZero(px / 0.25)
    : pxToCells(px, rootFontSizePx);
  return { kind: "cells", value: cells };
}

/** Parse a `grid-column-start`-family longhand: `auto`, an integer line
 * (possibly negative), `span <n>`, or the named forms — `foo`, `<n> foo`,
 * `span foo`, `span <n> foo` (specs/grid.md "Named lines and areas"). */
export function parseGridLine(value: string): GridLine {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "auto") return { kind: "auto" };
  // `span`, an integer, and a custom-ident, in any order (browsers
  // serialize `span 2 foo`; the grammar allows every order).
  let span = false;
  let integer: number | undefined;
  let name: string | undefined;
  for (const token of trimmed.split(/\s+/)) {
    if (token === "span") span = true;
    else if (/^-?\d+$/.test(token)) integer = Number(token);
    else name = token;
  }
  if (span) {
    const count = integer ?? 1;
    if (count < 1) return { kind: "auto" };
    return name === undefined
      ? { kind: "span", value: count }
      : { kind: "span", value: count, name };
  }
  if (name !== undefined) {
    if (integer === 0) return { kind: "auto" };
    return integer === undefined ? { kind: "name", name } : { kind: "name", name, nth: integer };
  }
  if (integer !== undefined && integer !== 0) return { kind: "line", value: integer };
  return { kind: "auto" };
}

function parseGridAutoFlow(value: string): GridAutoFlow {
  return {
    direction: value.includes("column") ? "column" : "row",
    dense: value.includes("dense"),
  };
}

function readPadding(cs: CSSStyleDeclaration, rootFontSizePx: number): PerSide<CellLength> {
  return {
    top: readSpacing(cs.getPropertyValue("padding-top"), rootFontSizePx),
    right: readSpacing(cs.getPropertyValue("padding-right"), rootFontSizePx),
    bottom: readSpacing(cs.getPropertyValue("padding-bottom"), rootFontSizePx),
    left: readSpacing(cs.getPropertyValue("padding-left"), rootFontSizePx),
  };
}

/** Borders per edge: the style, the px width as the WEIGHT, and the
 * cells the weight band draws it with — one under the defaults' heavy,
 * two where a set registers rings (specs/cell-model.md "Box model").
 * `hidden` reads as no border, its computed width in a browser. */
function readBorder(
  cs: CSSStyleDeclaration,
  set: BorderGlyphSet | undefined,
): Pick<CellStyle, "border" | "borderWeight" | "borderStyle"> {
  const border = zeroInsets();
  const borderWeight = { top: 1, right: 1, bottom: 1, left: 1 };
  const borderStyle: PerSide<BorderStyle> = {
    top: "solid",
    right: "solid",
    bottom: "solid",
    left: "solid",
  };
  for (const side of SIDES) {
    const style = cs.getPropertyValue(`border-${side}-style`);
    const weight =
      style === "none" || style === "hidden"
        ? 0
        : parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0;
    borderStyle[side] = readKeyword(BORDER_STYLES, style, "solid");
    if (weight <= 0) continue;
    borderWeight[side] = weight;
    border[side] = weightBand(borderStyle[side], weight, set).cells;
  }
  return { border, borderWeight, borderStyle };
}
