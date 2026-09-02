import { trackBackground } from "./animate.ts";
import { pxToCells, roundHalfAwayFromZero } from "./metrics.ts";
import { autoTrack, zeroInsets } from "./types.ts";
import { leafRendererFor } from "./leaf.ts";
import { warnOnce } from "./warn.ts";
import type {
  AlignItems,
  BorderStyle,
  CellLength,
  CellMetrics,
  CellStyle,
  Display,
  GapRule,
  GridArea,
  GridAreas,
  GridAutoFlow,
  GridLine,
  GridTemplate,
  Insets,
  JustifyContent,
  PerSide,
  Position,
  Size,
  SizeLimit,
  TableRole,
  TrackBreadth,
  TrackSize,
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
  warnAuthoredFontSize(el, classAttr, inlineStyle);

  // Atomic inline-level boxes lay their CONTENT out like their block-level
  // counterparts (the tree builder blockifies the box itself onto its own
  // row — cell-model deviation).
  const rawDisplay = cs.display || TABLE_DISPLAY_FALLBACK[el.tagName] || "";
  const tableRole: TableRole = TABLE_ROLES[rawDisplay] ?? "none";
  // Multicol: a block with an authored column-count or column-width
  // (specs/multicol.md). Computed values are specified values (probed
  // — no used-value trap).
  const columnCount =
    cs.columnCount && cs.columnCount !== "auto"
      ? Math.max(1, Math.floor(Number(cs.columnCount) || 1))
      : null;
  const columnWidthPx =
    cs.columnWidth && cs.columnWidth !== "auto" ? parseFloat(cs.columnWidth) : NaN;
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
    alignContent: mapJustify(cs.alignContent),
    alignItems: mapAlign(cs.alignItems),
    alignSelf: mapAlignSelf(cs.alignSelf),
    justifyItems: mapAlign(cs.justifyItems),
    justifySelf: mapAlignSelf(cs.justifySelf),
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
    width: readSize(csm, cs.width, "width", rootFontSizePx, classAttr, inlineStyle, metrics),
    height: readSize(csm, cs.height, "height", rootFontSizePx, classAttr, inlineStyle, metrics),
    minWidth:
      viewportLimit(
        csm,
        "min-width",
        cs.minWidth,
        classAttr,
        "min-w",
        inlineStyle,
        metrics,
        rootFontSizePx,
      ) ??
      readLimit(cs.minWidth, rootFontSizePx) ??
      "auto",
    minHeight:
      viewportLimit(
        csm,
        "min-height",
        cs.minHeight,
        classAttr,
        "min-h",
        inlineStyle,
        metrics,
        rootFontSizePx,
      ) ??
      readLimit(cs.minHeight, rootFontSizePx) ??
      "auto",
    maxWidth:
      viewportLimit(
        csm,
        "max-width",
        cs.maxWidth,
        classAttr,
        "max-w",
        inlineStyle,
        metrics,
        rootFontSizePx,
      ) ?? readLimit(cs.maxWidth, rootFontSizePx),
    maxHeight:
      viewportLimit(
        csm,
        "max-height",
        cs.maxHeight,
        classAttr,
        "max-h",
        inlineStyle,
        metrics,
        rootFontSizePx,
      ) ?? readLimit(cs.maxHeight, rootFontSizePx),
    padding: readPadding(cs, rootFontSizePx),
    margin: readMargin(cs, csm, classAttr, inlineStyle, rootFontSizePx),
    position: readPosition(cs.position),
    insets: readInsets(cs, csm, classAttr, inlineStyle, rootFontSizePx),
    // `column-gap: normal` is 0 in flex/grid but 1em in multicol, per
    // CSS (specs/multicol.md "Reading"). Headless DOMs report unset as
    // an empty string — same initial value.
    gapX: readSpacing(
      cs.columnGap === "normal" || cs.columnGap === ""
        ? display === "multicol"
          ? `${fontSizePx}px`
          : "0px"
        : cs.columnGap,
      rootFontSizePx,
    ),
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
    // `nowrap` and `pre` disable soft wrapping; `pre` additionally makes
    // the tree builder preserve the source's spaces and newlines
    // (specs/cell-model.md). Readable via getComputedStyle because the
    // companion stylesheet's white-space lock is gated on `:not([measuring])`.
    whiteSpace: cs.whiteSpace === "pre" ? "pre" : cs.whiteSpace === "nowrap" ? "nowrap" : "normal",
    tabSize: Math.max(1, Math.floor(parseFloat(cs.tabSize)) || 8),
    // Both readable because the companion stylesheet's typography rewrite
    // is gated on `:not([measuring])`.
    lineGap: lineGapRows(cs.lineHeight, fontSizePx),
    tracking: trackingCells(cs.letterSpacing, fontSizePx, metrics?.letterSpacing ?? 0),
    textOverflow: cs.textOverflow === "ellipsis" ? "ellipsis" : "clip",
    color: cs.color,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    textDecorationLine: cs.textDecorationLine,
    backgroundColor: readAnimatedBackground(el, cs.backgroundColor, cs),
    backgroundClear: cs.getPropertyValue("--mw-bg-clear").trim() === "1",
    borderColor: {
      top: cs.borderTopColor,
      right: cs.borderRightColor,
      bottom: cs.borderBottomColor,
      left: cs.borderLeftColor,
    },
    // The forced-start rule is measuring-gated, so the computed value is
    // the authored one (no echo); the legacy `align` attribute surfaces
    // as `-webkit-center`/`-moz-center`. Inherited centering blocks each
    // descendant individually — same net effect as CSS inheritance.
    textAlignBlocked: authoredTextAlignBlocked(el, cs),
    textAlign: readTextAlign(el, cs),
    textIndent: readTextIndent(cs, rootFontSizePx),
    opacity: readOpacity(cs.opacity),
    glyphSet: cs.getPropertyValue("--mw-border-glyphs").trim() || null,
    zIndex: cs.zIndex === "auto" || cs.zIndex === "" ? null : Number(cs.zIndex) || 0,
    latticeBorder: null,
    ruleX:
      display === "flex" || display === "grid" || display === "multicol"
        ? readGapRule(cs, "x")
        : null,
    ruleY: display === "flex" || display === "grid" ? readGapRule(cs, "y") : null,
    ruleBreak: readKeyword(cs, "--mw-rule-break", ["none", "intersection"] as const, "normal"),
    ruleInset:
      cs.getPropertyValue("--mw-rule-inset").trim() === "overlap-join"
        ? "overlap-join"
        : Math.max(
            0,
            roundHalfAwayFromZero(parseFloat(cs.getPropertyValue("--mw-rule-inset")) || 0),
          ),
    ruleVisibilityItems: readKeyword(
      cs,
      "--mw-rule-visibility-items",
      ["all", "around", "between"] as const,
      "normal",
    ),
    columnCount,
    columnWidth,
    columnFill: cs.columnFill === "auto" ? "auto" : "balance",
    columnSpan: cs.columnSpan === "all",
    breakBeforeColumn: cs.breakBefore === "column",
    breakAfterColumn: cs.breakAfter === "column",
    breakInsideAvoid: cs.breakInside === "avoid" || cs.breakInside === "avoid-column",
  };
  applyBorderCollapse(style, cs);
  return style;
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

/** True for a computed `background-color` that shouldn't trigger the
 * bg-occludes-decorations fill. Real browsers resolve transparent to
 * `rgba(0, 0, 0, 0)`; the empty-string and `currentcolor` branches
 * cover happy-dom (test env), which leaves some computed values
 * unresolved. */
export function isTransparentColor(value: string): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "currentcolor"
  );
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

/** The screen-reader-only pattern (Tailwind `sr-only` and friends): an
 * absolutely positioned box whose ink can't show — a zero `clip` rect,
 * or a clipped ≤1px box. Treated as display:none by the ENGINE only:
 * the light-DOM element keeps its authored styles, so assistive tech
 * still reads it. */
function isZeroClipped(el: Element, cs: CSSStyleDeclaration): boolean {
  if (cs.position !== "absolute" && cs.position !== "fixed") return false;
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

/** Tag → display fallback for environments whose getComputedStyle
 * returns "" for UA-styled table elements (happy-dom); real browsers
 * always resolve a computed display. */
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
  if (value === "top") return "start";
  if (value === "middle") return "center";
  if (value === "bottom") return "end";
  return "start";
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

/** Gap rules from the `--mw-rule-*` mirrors (specs/gap-decorations.md);
 * registered `inherits: false`, so a container only sees its own.
 * Widths use the border scale (1px = 1 cell), like the utilities. */
function readKeyword<T extends string, D extends string>(
  cs: CSSStyleDeclaration,
  property: string,
  values: readonly T[],
  fallback: D,
): T | D {
  const value = cs.getPropertyValue(property).trim() as T;
  return values.includes(value) ? value : fallback;
}

function readGapRule(cs: CSSStyleDeclaration, axis: "x" | "y"): GapRule | null {
  const width = roundHalfAwayFromZero(
    parseFloat(cs.getPropertyValue(`--mw-rule-${axis}-width`)) || 0,
  );
  if (width <= 0) return null;
  const color = cs.getPropertyValue(`--mw-rule-${axis}-color`).trim();
  return {
    width,
    style: mapBorderStyle(cs.getPropertyValue(`--mw-rule-${axis}-style`).trim()),
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

/** `normal` (the initial value) and `stretch` both read as `stretch`: flex
 * treats it as `start` (per css-align), grid stretches auto tracks. */
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
    case "normal":
    case "stretch":
    case "":
      return "stretch";
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
  inlineStyle: CSSStyleDeclaration,
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
function lineGapRows(lineHeight: string, fontSizePx: number): number {
  if (!lineHeight || lineHeight === "normal" || fontSizePx <= 0) return 0;
  const px = parseFloat(lineHeight);
  if (!Number.isFinite(px)) return 0;
  return Math.max(0, Math.floor(px / fontSizePx + 1e-6) - 1);
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

/** Computed `opacity`, clamped to [0, 1]; a non-numeric read is opaque. */
function readOpacity(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
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

function readSize(
  csm: StylePropertyMapReadOnly | null,
  fallback: string,
  key: "width" | "height",
  rootFontSizePx: number,
  classAttr: string,
  inlineStyle: CSSStyleDeclaration,
  metrics: CellMetrics | undefined,
): Size | undefined {
  // Viewport-relative lengths (h-screen, style="height: 100dvh", …)
  // express PHYSICAL screen intent, so they convert via the measured
  // cell size, not the spacing scale (specs/cell-model.md
  // "Viewport-relative lengths"). The inline style attribute keeps the
  // authored unit verbatim — and inline beats classes, per cascade.
  const inlineViewport = viewportLengthPx(key === "width" ? inlineStyle.width : inlineStyle.height);
  if (inlineViewport !== null) {
    return { kind: "cells", value: physicalCells(inlineViewport, key, metrics, rootFontSizePx) };
  }
  // Class scan, every engine: computed values (Typed OM included)
  // resolve viewport units to plain px, indistinguishable from
  // spacing-scale lengths.
  const viewportPx = viewportUtilityPx(classAttr, key === "width" ? "w" : "h");
  if (viewportPx !== null) {
    // Confirm the utility is ACTIVE against the resolved value — an
    // inactive variant (md:h-screen below md) or an overriding inline
    // style resolves elsewhere and must win. When it agrees, prefer
    // the RESOLVED px: it also carries sv/lv/dv bases the innerWidth/
    // Height estimate can't know. No resolved value at all (headless
    // test env, stylesheet not loaded yet) trusts the scan.
    const resolved = parseFloat(csm ? String(csm.get(key) ?? "") : fallback);
    const agrees = Number.isFinite(resolved) && Math.abs(resolved - viewportPx) <= viewportPx * 0.3;
    if (agrees || !Number.isFinite(resolved)) {
      const px = agrees ? resolved : viewportPx;
      return { kind: "cells", value: physicalCells(px, key, metrics, rootFontSizePx) };
    }
  }
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
    // Authored viewport units that survive to the computed string
    // (engine-dependent; arbitrary values like h-[50vh]).
    const authoredViewport = viewportLengthPx(s);
    if (authoredViewport !== null) {
      return {
        kind: "cells",
        value: physicalCells(authoredViewport, key, metrics, rootFontSizePx),
      };
    }
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
  // Percent utilities must be caught here too: their used px depends on
  // the (pre-neutralization) native layout — badly wrong inside tables.
  const fraction = new RegExp(`(?:^|[\\s:.[!])${axis}-(\\d+)/(\\d+)(?![\\w./])`).exec(classAttr);
  if (fraction)
    return { kind: "percent", value: (100 * Number(fraction[1])) / Number(fraction[2]) };
  if (new RegExp(`(?:^|[\\s:.[!])${axis}-full(?![\\w-])`).test(classAttr))
    return { kind: "percent", value: 100 };
  const arbitraryPercent = new RegExp(`(?:^|[\\s:.[!])${axis}-\\[(\\d+(?:\\.\\d+)?)%\\]`).exec(
    classAttr,
  );
  if (arbitraryPercent) return { kind: "percent", value: Number(arbitraryPercent[1]) };
  // Numeric spacing-scale utility (`h-7`, `w-0.5`, …): map the class
  // directly to cells. Match the Tailwind spacing scale (N * 0.25rem
  // = N cells) so we don't have to trust `cs.height` — same result
  // for most elements, but critical for <td>/<th> in Firefox where
  // `cs.height` returns the USED height from the table layout
  // (including rowspan effects), not the authored value.
  const numeric = new RegExp(`(?:^|[\\s:.[!])${axis}-(\\d+(?:\\.\\d+)?)(?![\\w-/])`).exec(
    classAttr,
  );
  if (numeric) return { kind: "cells", value: roundHalfAwayFromZero(Number(numeric[1])) };
  if (!hasSizingUtility(classAttr, axis)) return { kind: "auto" };
  if (fallback === "auto") return { kind: "auto" };
  if (fallback.endsWith("%")) return { kind: "percent", value: parseFloat(fallback) };
  const px = parseFloat(fallback);
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

/** Viewport-relative min/max limit, when one is authored. Class scan
 * (`min-h-screen`, `min-h-[95dvh]`, …) — computed values resolve
 * viewport units to plain px in every engine, so the class list is the
 * only reliable signal — active-checked against the resolved value,
 * same rules as readSize's viewport branch. undefined = not
 * viewport-relative (caller falls through to the normal readLimit). */
function viewportLimit(
  csm: StylePropertyMapReadOnly | null,
  property: string,
  resolvedValue: string,
  classAttr: string,
  utilityPrefix: string,
  inlineStyle: CSSStyleDeclaration,
  metrics: CellMetrics | undefined,
  rootFontSizePx: number,
): number | undefined {
  const key = property.endsWith("width") ? "width" : "height";
  // An authored viewport string — inline style (kept verbatim in the
  // style attribute) or a computed value that survives resolution —
  // is proof in itself: no active-check needed (or possible: parsing
  // it as px would misread "100dvh" as 100).
  const authoredPx =
    viewportLengthPx(inlineStyle.getPropertyValue(property)) ??
    viewportLengthPx(csm?.get(property)?.toString().trim() ?? "");
  if (authoredPx !== null) return physicalCells(authoredPx, key, metrics, rootFontSizePx);
  // Class scan needs the active-check, same rules as readSize's
  // viewport branch.
  const scanned = viewportUtilityPx(classAttr, utilityPrefix);
  if (scanned === null) return undefined;
  const resolved = parseFloat(csm ? String(csm.get(property) ?? "") : resolvedValue);
  const agrees = Number.isFinite(resolved) && Math.abs(resolved - scanned) <= scanned * 0.3;
  if (!agrees && Number.isFinite(resolved)) return undefined;
  return physicalCells(agrees ? resolved : scanned, key, metrics, rootFontSizePx);
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
 * Parse a computed `grid-template-columns` / `grid-template-rows` value
 * (specs/grid.md). Expected on a NON-grid element (see the degrid read in
 * readCellStyle), so the authored structure survives: lengths are computed
 * to px, but `fr`, `minmax()`, and `repeat()` keep their form. Fixed
 * repeats expand here; `auto-fill` / `auto-fit` stay symbolic for layout.
 * Line names would appear in `[bracket]` groups — deferred, dropped.
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
  for (const token of splitTopLevel(trimmed)) {
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
  for (const token of splitTopLevel(value)) {
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
  const tracks = splitTopLevel(value.trim())
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
    const args = splitTopLevelCommas(minmax[1]!).map((arg) => arg.trim());
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
    const args = splitTopLevelCommas(math[2]!).map((arg) =>
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

/** Split a CSS function's arguments on top-level commas (nested parens
 * stay intact). */
function splitTopLevelCommas(value: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      args.push(value.slice(start, i));
      start = i + 1;
    }
  }
  args.push(value.slice(start));
  return args.filter((a) => a.trim() !== "");
}

/** Split a CSS value list on top-level whitespace (nested parens and
 * brackets stay intact). */
function splitTopLevel(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (start !== -1) tokens.push(value.slice(start, i));
      start = -1;
    } else if (start === -1) {
      start = i;
    }
  }
  if (start !== -1) tokens.push(value.slice(start));
  return tokens;
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
