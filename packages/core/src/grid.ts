import { percentToCells, roundHalfAwayFromZero } from "./metrics.ts";
import {
  clampSize,
  intrinsicOuterWidth,
  isOutOfFlow,
  layoutNode,
  minContentOuterWidth,
  resolveLength,
  resolveLimit,
  resolveMargin,
  resolveSizeAgainst,
  resolveWidthLimit,
} from "./layout.ts";
import type { IntrinsicCache } from "./layout.ts";
import { alignCrossOffset, distributeInteger, effectiveAlign, mainAxisOffsets } from "./flex.ts";
import type {
  AlignItems,
  GridAutoFlow,
  GridLine,
  GridTemplate,
  Insets,
  JustifyContent,
  LayoutNode,
  NullableInsets,
  TrackBreadth,
  TrackSize,
} from "./types.ts";

/**
 * Grid layout (specs/grid.md): template resolution, CSS §8.5 auto-
 * placement, the §11 track sizing algorithm adapted to integer cells, and
 * item placement in areas. Shares the integer distribution and alignment
 * offset machinery with flex. See layout.ts for the deliberate import
 * cycle between the layout modules.
 *
 * Not yet implemented (later milestones-within-the-milestone): subgrid
 * (both axes behave as `none`), and the §10.1 grid-area containing block
 * for absolutely positioned children (they get the block static slot at
 * the content origin for now).
 */

export function layoutGrid(
  node: LayoutNode,
  innerWidth: number,
  innerHeight: number,
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const style = node.style;
  // The column axis is always definite (width fills); the row axis uses
  // any bounded inner height — a `min-height` floor included, same as
  // flex lines — so rows stretch and align inside `min-h-*` containers.
  const rowAvailable = Number.isFinite(innerHeight) ? innerHeight : undefined;
  const gapX = resolveLength(style.gapX, innerWidth);
  const gapY = resolveLength(style.gapY, rowAvailable);

  const { children, placed, colTracks, rowTracks, colCollapsed, rowCollapsed } =
    resolveGridStructure(node, innerWidth, rowAvailable, gapX, gapY);
  const margins = children.map((child) => resolveMargin(child.style.margin, innerWidth));
  const justifies = children.map((child) =>
    child.style.justifySelf === "auto" ? style.justifyItems : child.style.justifySelf,
  );

  // Column track sizing from the items' intrinsic width contributions
  // (outer sizes plus fixed margins, auto margins as 0).
  const colSizing = sizeTracks(
    colTracks,
    colCollapsed,
    placed.items.map((p, i) => ({
      start: p.col.start,
      span: p.col.span,
      min: widthContribution(children[i]!, "min", cache) + fixedX(margins[i]!),
      max: widthContribution(children[i]!, "max", cache) + fixedX(margins[i]!),
    })),
    innerWidth,
    gapX,
    style.justifyContent === "stretch",
  );
  const colPos = trackPositions(colSizing, innerWidth, style.justifyContent);

  // First item pass: resolve each item's width in its column area
  // (stretch by default; own min/max still clamp; explicit sizes and auto
  // margins opt out) and lay it out — heights emerge here.
  const usedWidths: number[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const p = placed.items[i]!;
    const areaW = areaExtent(colPos, colSizing.sizes, p.col.start, p.col.span);
    const margin = margins[i]!;
    const availW = Math.max(0, areaW - fixedX(margin));
    const justify = justifies[i]!;
    const hasAutoX = margin.left === null || margin.right === null;
    const hasExplicitWidth = child.style.width !== undefined && child.style.width.kind !== "auto";
    if (justify === "stretch" && !hasAutoX && !hasExplicitWidth) {
      // The automatic minimum (`min-width: auto` = min-content while
      // overflow is visible) floors the stretched width, same as flex —
      // the item can overflow a `minmax(0, 1fr)` track narrower than its
      // content, matching CSS.
      const minW =
        child.style.minWidth === "auto"
          ? child.style.overflow === "visible"
            ? minContentOuterWidth(child, cache)
            : 0
          : (resolveLimit(child.style.minWidth, areaW) ?? 0);
      const maxW = resolveWidthLimit(child.style.maxWidth, areaW, child, cache);
      const stretched = clampSize(availW, minW, maxW);
      layoutNode(child, areaW, undefined, 0, 0, "fill", cache, { width: stretched });
    } else {
      layoutNode(child, availW, undefined, 0, 0, "shrink", cache);
    }
    usedWidths.push(child.localRect.width);
  }

  // Row track sizing from the laid-out heights (at final column widths,
  // the item's min- and max-content block contributions coincide).
  const rowSizing = sizeTracks(
    rowTracks,
    rowCollapsed,
    placed.items.map((p, i) => ({
      start: p.row.start,
      span: p.row.span,
      min: children[i]!.localRect.height + fixedY(margins[i]!),
      max: children[i]!.localRect.height + fixedY(margins[i]!),
    })),
    rowAvailable ?? "max-content",
    gapY,
    style.alignContent === "stretch",
  );
  const contentRows = totalExtent(rowSizing);
  const rowPos = trackPositions(rowSizing, rowAvailable ?? contentRows, style.alignContent);

  // Second item pass: block-axis stretch and final placement.
  const originX = border.left + padding.left;
  const originY = border.top + padding.top;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const p = placed.items[i]!;
    const margin = margins[i]!;
    const areaW = areaExtent(colPos, colSizing.sizes, p.col.start, p.col.span);
    const areaH = areaExtent(rowPos, rowSizing.sizes, p.row.start, p.row.span);
    const availH = Math.max(0, areaH - fixedY(margin));
    const align = effectiveAlign(child, node);
    const hasAutoY = margin.top === null || margin.bottom === null;
    const hasExplicitHeight =
      child.style.height !== undefined && child.style.height.kind !== "auto";
    if (align === "stretch" && !hasAutoY && !hasExplicitHeight) {
      // Same automatic minimum in the block axis: the laid-out content
      // height floors the stretch (a definite row smaller than the content
      // overflows instead of crushing it), unless overflow opts out.
      const minH =
        child.style.minHeight === "auto"
          ? child.style.overflow === "visible"
            ? child.localRect.height
            : 0
          : (resolveLimit(child.style.minHeight, areaH) ?? 0);
      const maxH = resolveLimit(child.style.maxHeight, areaH);
      const stretched = clampSize(availH, minH, maxH);
      if (stretched !== child.localRect.height) {
        layoutNode(child, areaW, areaH, 0, 0, "fill", cache, {
          width: usedWidths[i]!,
          height: stretched,
        });
      }
    } else if (child.style.height?.kind === "percent") {
      // A percent height resolves against the item's grid area, per the
      // cyclic-percentage rule: it contributed as `auto` to the row
      // sizing above, and resolves against the resulting area now.
      layoutNode(child, areaW, areaH, 0, 0, "fill", cache, { width: usedWidths[i]! });
    }
    child.localRect = {
      ...child.localRect,
      x:
        originX +
        colPos[p.col.start]! +
        areaAxisOffset(justifies[i]!, margin.left, margin.right, areaW, child.localRect.width),
      y:
        originY +
        rowPos[p.row.start]! +
        areaAxisOffset(align, margin.top, margin.bottom, areaH, child.localRect.height),
    };
  }

  // Out-of-flow children: block static slot at the content origin plus
  // margins for now (the §10.1 grid-area containing block is a later
  // phase, specs/grid.md).
  for (const child of node.children) {
    if (!isOutOfFlow(child.style)) continue;
    const margin = resolveMargin(child.style.margin, innerWidth);
    child.staticSlot = {
      kind: "block",
      x: originX + (margin.left ?? 0),
      y: originY + (margin.top ?? 0),
    };
  }

  return Number.isFinite(innerHeight) ? Math.max(innerHeight, contentRows) : contentRows;
}

/** The container's intrinsic content widths (specs/grid.md interaction
 * section): run placement and column sizing under a min-content
 * constraint — min-content = the track bases, max-content = the track
 * growth limits (fr tracks report their flex-fraction size), plus gaps.
 * One placement + sizing pass computes both, cached per node. */
export function gridIntrinsicInnerWidths(
  node: LayoutNode,
  cache: IntrinsicCache,
): { min: number; max: number } {
  const cached = cache.gridIntrinsic.get(node);
  if (cached !== undefined) return cached;
  const style = node.style;
  const gapX = typeof style.gapX === "number" ? style.gapX : 0;
  const { children, placed, colTracks, colCollapsed } = resolveGridStructure(
    node,
    undefined,
    undefined,
    gapX,
    0,
  );
  const sizing = sizeTracks(
    colTracks,
    colCollapsed,
    placed.items.map((p, i) => {
      const margins = fixedX(resolveMargin(children[i]!.style.margin, 0));
      return {
        start: p.col.start,
        span: p.col.span,
        min: widthContribution(children[i]!, "min", cache) + margins,
        max: widthContribution(children[i]!, "max", cache) + margins,
      };
    }),
    "min-content",
    gapX,
    false,
  );
  const gaps = sizing.gapBefore.reduce((s, g) => s + g, 0);
  const result = {
    min: sizing.sizes.reduce((s, v) => s + v, 0) + gaps,
    max: sizing.limits.reduce((s, v) => s + v, 0) + gaps,
  };
  cache.gridIntrinsic.set(node, result);
  return result;
}

interface GridStructure {
  children: LayoutNode[];
  placed: PlacementResult;
  colTracks: TrackSize[];
  rowTracks: TrackSize[];
  colCollapsed: boolean[];
  rowCollapsed: boolean[];
}

/** Everything upstream of track sizing: template resolution against the
 * axes' available sizes, placement spec resolution, §8.5 auto-placement,
 * the full per-axis track lists (implicit tracks included), and auto-fit
 * collapse flags. */
function resolveGridStructure(
  node: LayoutNode,
  colAvailable: number | undefined,
  rowAvailable: number | undefined,
  gapX: number,
  gapY: number,
): GridStructure {
  const style = node.style;
  const children = gridOrderedChildren(node);
  const colTemplate = resolveTemplate(style.gridTemplateColumns, colAvailable, gapX);
  const rowTemplate = resolveTemplate(style.gridTemplateRows, rowAvailable, gapY);
  const specs = children.map((child) => ({
    col: resolveAxisPlacement(
      child.style.gridColumnStart,
      child.style.gridColumnEnd,
      colTemplate.tracks.length,
    ),
    row: resolveAxisPlacement(
      child.style.gridRowStart,
      child.style.gridRowEnd,
      rowTemplate.tracks.length,
    ),
  }));
  const placed = placeItems(
    specs,
    colTemplate.tracks.length,
    rowTemplate.tracks.length,
    style.gridAutoFlow,
  );
  return {
    children,
    placed,
    colTracks: buildAxisTracks(
      colTemplate.tracks,
      placed.colOrigin,
      placed.colCount,
      style.gridAutoColumns,
    ),
    rowTracks: buildAxisTracks(
      rowTemplate.tracks,
      placed.rowOrigin,
      placed.rowCount,
      style.gridAutoRows,
    ),
    colCollapsed: collapsedTracks(
      colTemplate,
      placed.colOrigin,
      placed.colCount,
      placed.items.map((p) => p.col),
    ),
    rowCollapsed: collapsedTracks(
      rowTemplate,
      placed.rowOrigin,
      placed.rowCount,
      placed.items.map((p) => p.row),
    ),
  };
}

/** Grid item order: stable sort by CSS `order` (document order ties) —
 * `order` participates in auto-placement, per CSS. */
function gridOrderedChildren(node: LayoutNode): LayoutNode[] {
  return node.children
    .filter((child) => !isOutOfFlow(child.style) && !child.inlineBox)
    .sort((a, b) => a.style.order - b.style.order);
}

function fixedX(margin: NullableInsets): number {
  return (margin.left ?? 0) + (margin.right ?? 0);
}

function fixedY(margin: NullableInsets): number {
  return (margin.top ?? 0) + (margin.bottom ?? 0);
}

/** An item's outer width contribution to intrinsic track sizing: its
 * explicit width if fixed (percent behaves as auto, per intrinsic
 * contribution rules), else the min-/max-content outer width; clamped by
 * the item's own fixed min/max. */
function widthContribution(child: LayoutNode, kind: "min" | "max", cache: IntrinsicCache): number {
  const style = child.style;
  let width: number | undefined;
  if (style.width !== undefined && style.width.kind !== "auto" && style.width.kind !== "percent") {
    width = resolveSizeAgainst(style.width, 0, child, cache);
  }
  if (width === undefined) {
    width = kind === "min" ? minContentOuterWidth(child, cache) : intrinsicOuterWidth(child, cache);
  }
  const min = typeof style.minWidth === "number" ? style.minWidth : 0;
  const max = typeof style.maxWidth === "number" ? style.maxWidth : undefined;
  return Math.max(0, clampSize(width, min, max));
}

// ---------------------------------------------------------------------------
// Template resolution

interface ResolvedTemplate {
  tracks: TrackSize[];
  /** The index range [start, end) of the tracks an `auto-fit` repetition
   * produced — those collapse to 0 when empty (gaps dropped too). */
  autoFit?: { start: number; end: number };
}

/**
 * Expand a template's auto-repeat against the axis's definite size:
 * `count = max(1, floor((available + gap) ÷ (iteration + gap·tracks)))`
 * with `iteration` the sum of the repeated tracks' fixed mins (their fixed
 * max when the min is intrinsic) — exact in integer cells. An indefinite
 * axis repeats once, per CSS. `subgrid` behaves as `none` for now
 * (specs/grid.md — subgrid is a later phase).
 */
function resolveTemplate(
  template: GridTemplate,
  available: number | undefined,
  gap: number,
): ResolvedTemplate {
  if (template.kind !== "tracks") return { tracks: [] };
  if (!template.autoRepeat) return { tracks: template.tracks };
  const { index, tracks: repetition, mode } = template.autoRepeat;
  let count = 1;
  if (available !== undefined) {
    const iteration = repetition.reduce((sum, track) => {
      const min = fixedBreadth(track.min, available) ?? fixedBreadth(track.max, available) ?? 1;
      return sum + Math.max(1, min);
    }, 0);
    count = Math.max(1, Math.floor((available + gap) / (iteration + gap * repetition.length)));
  }
  const repeated: TrackSize[] = [];
  for (let i = 0; i < count; i++) repeated.push(...repetition);
  const tracks = [...template.tracks.slice(0, index), ...repeated, ...template.tracks.slice(index)];
  if (mode === "auto-fit") {
    return { tracks, autoFit: { start: index, end: index + repeated.length } };
  }
  return { tracks };
}

/** A fixed track breadth in cells, or undefined for intrinsic/fr (percent
 * is fixed only when the axis is definite, per CSS). A `min()`/`max()`
 * resolves when every argument does, else behaves as intrinsic. */
function fixedBreadth(breadth: TrackBreadth, available: number | undefined): number | undefined {
  if (breadth.kind === "cells") return breadth.value;
  if (breadth.kind === "percent" && available !== undefined) {
    return percentToCells(breadth.value, available);
  }
  if (breadth.kind === "math") {
    const values: number[] = [];
    for (const arg of breadth.args) {
      const value = fixedBreadth(arg, available);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return breadth.fn === "min" ? Math.min(...values) : Math.max(...values);
  }
  return undefined;
}

/** The full per-axis track list: explicit tracks at normalized indices
 * [−origin, −origin + explicit.length), implicit tracks on both sides
 * sized by the `grid-auto-*` list — cycled, taken from the list's end in
 * reverse for tracks before the explicit grid (positive modulo), per CSS. */
function buildAxisTracks(
  explicit: TrackSize[],
  origin: number,
  count: number,
  autoList: TrackSize[],
): TrackSize[] {
  const tracks: TrackSize[] = [];
  for (let i = 0; i < count; i++) {
    const original = i + origin;
    if (original >= 0 && original < explicit.length) {
      tracks.push(explicit[original]!);
    } else {
      const cycle = original < 0 ? original : original - explicit.length;
      tracks.push(autoList[((cycle % autoList.length) + autoList.length) % autoList.length]!);
    }
  }
  return tracks;
}

/** `auto-fit` collapse (CSS §7.2.3.2): a repeated track no placed item
 * spans is collapsed — sized 0 with its gaps dropped. */
function collapsedTracks(
  template: ResolvedTemplate,
  origin: number,
  count: number,
  spans: { start: number; span: number }[],
): boolean[] {
  const collapsed: boolean[] = Array.from({ length: count }, () => false);
  if (!template.autoFit) return collapsed;
  for (let original = template.autoFit.start; original < template.autoFit.end; original++) {
    const index = original - origin;
    if (index < 0 || index >= count) continue;
    const occupied = spans.some((s) => index >= s.start && index < s.start + s.span);
    if (!occupied) collapsed[index] = true;
  }
  return collapsed;
}

// ---------------------------------------------------------------------------
// Placement (CSS §8.5)

interface AxisSpec {
  /** Normalized 0-based track index of the start line (explicit tracks
   * occupy [0, explicitCount)); may be negative (implicit tracks before
   * the explicit grid) or null for auto. */
  start: number | null;
  span: number;
}

/**
 * Resolve one axis of an item's placement from the two line longhands.
 * Line numbers are 1-based; negative numbers count from the explicit
 * grid's end (line −1 = the last explicit line). Both lines definite:
 * start = the earlier line, span = the distance (equal lines → the end
 * line is discarded, span 1). One definite line + a span → definite. Only
 * spans (or nothing) → indefinite with the requested span.
 */
export function resolveAxisPlacement(
  startLine: GridLine,
  endLine: GridLine,
  explicitCount: number,
): AxisSpec {
  const lineIndex = (n: number) => (n > 0 ? n - 1 : explicitCount + 1 + n);
  const start = startLine.kind === "line" ? lineIndex(startLine.value) : null;
  const end = endLine.kind === "line" ? lineIndex(endLine.value) : null;
  if (start !== null && end !== null) {
    if (start === end) return { start, span: 1 };
    return { start: Math.min(start, end), span: Math.abs(end - start) };
  }
  if (start !== null) {
    return { start, span: endLine.kind === "span" ? endLine.value : 1 };
  }
  if (end !== null) {
    const span = startLine.kind === "span" ? startLine.value : 1;
    return { start: end - span, span };
  }
  const span =
    startLine.kind === "span" ? startLine.value : endLine.kind === "span" ? endLine.value : 1;
  return { start: null, span };
}

interface PlacedAxis {
  start: number;
  span: number;
}

interface PlacementResult {
  items: { col: PlacedAxis; row: PlacedAxis }[];
  colOrigin: number;
  colCount: number;
  rowOrigin: number;
  rowCount: number;
}

/**
 * CSS §8.5 auto-placement. The flow's major axis grows (rows for `row`
 * flow); the minor axis has a bounded track count. Sparse (default): the
 * cursor only moves forward; `dense` restarts the scan from the grid's
 * start for every item. Items are expected in order-then-document order.
 */
export function placeItems(
  specs: { col: AxisSpec; row: AxisSpec }[],
  explicitCols: number,
  explicitRows: number,
  flow: GridAutoFlow,
): PlacementResult {
  const rowFlow = flow.direction === "row";
  const major = specs.map((s) => (rowFlow ? s.row : s.col));
  const minor = specs.map((s) => (rowFlow ? s.col : s.row));
  const explicitMinor = rowFlow ? explicitCols : explicitRows;
  const explicitMajor = rowFlow ? explicitRows : explicitCols;

  // Minor-axis bounds (§8.5 step 3): the explicit count, grown by definite
  // placements (negative lines extend before the grid) and by the largest
  // span among the items to be auto-placed.
  let minorOrigin = 0;
  let minorEnd = Math.max(explicitMinor, 1);
  for (let i = 0; i < specs.length; i++) {
    const m = minor[i]!;
    if (m.start !== null) {
      minorOrigin = Math.min(minorOrigin, m.start);
      minorEnd = Math.max(minorEnd, m.start + m.span);
    }
  }
  for (let i = 0; i < specs.length; i++) {
    const m = minor[i]!;
    if (m.start === null) minorEnd = Math.max(minorEnd, minorOrigin + m.span);
  }
  let majorOrigin = 0;
  for (let i = 0; i < specs.length; i++) {
    const mj = major[i]!;
    if (mj.start !== null) majorOrigin = Math.min(majorOrigin, mj.start);
  }

  const occupied = new Set<string>();
  const fits = (mj: number, mn: number, mjSpan: number, mnSpan: number): boolean => {
    for (let a = mj; a < mj + mjSpan; a++) {
      for (let b = mn; b < mn + mnSpan; b++) if (occupied.has(`${a}:${b}`)) return false;
    }
    return true;
  };
  const mark = (mj: number, mn: number, mjSpan: number, mnSpan: number): void => {
    for (let a = mj; a < mj + mjSpan; a++) {
      for (let b = mn; b < mn + mnSpan; b++) occupied.add(`${a}:${b}`);
    }
  };

  const result: ({ major: number; minor: number } | null)[] = specs.map(() => null);

  // Step 1: fully definite items.
  for (let i = 0; i < specs.length; i++) {
    const mj = major[i]!;
    const mn = minor[i]!;
    if (mj.start === null || mn.start === null) continue;
    result[i] = { major: mj.start, minor: mn.start };
    mark(mj.start, mn.start, mj.span, mn.span);
  }

  // Step 2: items locked to a major-axis position. Sparse keeps a per-line
  // minor cursor so later items on the same line only move forward.
  const lineCursor = new Map<number, number>();
  for (let i = 0; i < specs.length; i++) {
    const mj = major[i]!;
    const mn = minor[i]!;
    if (mj.start === null || mn.start !== null) continue;
    const from = flow.dense
      ? minorOrigin
      : Math.max(minorOrigin, lineCursor.get(mj.start) ?? minorOrigin);
    let position = from;
    while (!fits(mj.start, position, mj.span, mn.span)) position++;
    result[i] = { major: mj.start, minor: position };
    mark(mj.start, position, mj.span, mn.span);
    if (!flow.dense) lineCursor.set(mj.start, position + mn.span);
    minorEnd = Math.max(minorEnd, position + mn.span);
  }

  // Steps 3–4: the auto-placement cursor.
  let curMajor = majorOrigin;
  let curMinor = minorOrigin;
  for (let i = 0; i < specs.length; i++) {
    if (result[i] !== null) continue;
    const mj = major[i]!;
    const mn = minor[i]!;
    if (flow.dense) {
      curMajor = majorOrigin;
      curMinor = minorOrigin;
    }
    if (mn.start !== null) {
      // Definite minor position: overflowing the cursor's minor position
      // wraps to the next major line, then the item slides down until it
      // fits.
      if (mn.start < curMinor) curMajor++;
      while (!fits(curMajor, mn.start, mj.span, mn.span)) curMajor++;
      result[i] = { major: curMajor, minor: mn.start };
      mark(curMajor, mn.start, mj.span, mn.span);
      curMinor = mn.start + mn.span;
    } else {
      let mjPos = curMajor;
      let mnPos = curMinor;
      for (;;) {
        if (mnPos + mn.span > minorEnd) {
          mjPos++;
          mnPos = minorOrigin;
          continue;
        }
        if (fits(mjPos, mnPos, mj.span, mn.span)) break;
        mnPos++;
      }
      result[i] = { major: mjPos, minor: mnPos };
      mark(mjPos, mnPos, mj.span, mn.span);
      curMajor = mjPos;
      curMinor = mnPos + mn.span;
    }
  }

  let majorEnd = Math.max(explicitMajor, majorOrigin);
  for (let i = 0; i < specs.length; i++) {
    majorEnd = Math.max(majorEnd, result[i]!.major + major[i]!.span);
  }

  const items = specs.map((_, i) => {
    const majorAxis = { start: result[i]!.major - majorOrigin, span: major[i]!.span };
    const minorAxis = { start: result[i]!.minor - minorOrigin, span: minor[i]!.span };
    return rowFlow ? { col: minorAxis, row: majorAxis } : { col: majorAxis, row: minorAxis };
  });
  const majorCount = majorEnd - majorOrigin;
  const minorCount = minorEnd - minorOrigin;
  return rowFlow
    ? {
        items,
        colOrigin: minorOrigin,
        colCount: minorCount,
        rowOrigin: majorOrigin,
        rowCount: majorCount,
      }
    : {
        items,
        colOrigin: majorOrigin,
        colCount: majorCount,
        rowOrigin: minorOrigin,
        rowCount: minorCount,
      };
}

// ---------------------------------------------------------------------------
// Track sizing (CSS §11, integer-adapted — specs/grid.md)

interface SizingItem {
  start: number;
  span: number;
  /** Min-content outer contribution (cells). */
  min: number;
  /** Max-content outer contribution (cells). */
  max: number;
}

interface SizingResult {
  sizes: number[];
  /** Gap preceding each track (0 for the first and for collapsed tracks). */
  gapBefore: number[];
  /** Final growth limits (for the container's max-content size). */
  limits: number[];
}

interface TrackState {
  base: number;
  /** Fixed or contribution-grown limit; null = infinite so far. */
  limit: number | null;
  /** Which contributions grow the base: intrinsic mins (auto /
   * min-content / max-content / unresolvable percent) take min-content
   * contributions (specs/grid.md step 2). */
  baseIntrinsic: boolean;
  /** How the limit grows: fixed never; fr via §11.7; intrinsic-min from
   * min-content contributions (max = min-content); intrinsic-max from
   * max-content contributions (max = auto / max-content). */
  limitKind: "fixed" | "fr" | "intrinsic-min" | "intrinsic-max";
  frFactor: number;
  collapsed: boolean;
}

/**
 * Size one axis's tracks. `space` is the definite inner size in the axis,
 * or the intrinsic sizing constraint when the axis is indefinite:
 * `"max-content"` for actual layout of an unbounded axis (rows of an
 * auto-height container), `"min-content"` for the container's min-content
 * measure. Steps: initialize from the minmax pairs; grow intrinsic
 * bases/limits from item contributions in ascending span order
 * (equal-weight integer distribution — specs/grid.md deviation); clamp
 * bases to fixed limits (the limit wins, emulating the spec's
 * limited-contribution rule). Definite: maximize bases up to limits
 * (§11.6), distribute the leftover to fr tracks floored at their bases
 * (§11.7), stretch auto-limited tracks over any remainder when the axis's
 * content-distribution is `stretch` (§11.8). Indefinite: fr tracks size
 * to the shared flex fraction (§11.7 with indefinite space), and under
 * the max-content constraint every track maximizes to its growth limit —
 * a fixed minmax max fills even without content, per CSS (§11.6's
 * infinite free space; all three browser engines agree).
 */
export function sizeTracks(
  trackSizes: TrackSize[],
  collapsed: boolean[],
  items: SizingItem[],
  space: number | "min-content" | "max-content",
  gap: number,
  stretchAuto: boolean,
): SizingResult {
  const available = typeof space === "number" ? space : undefined;
  const tracks: TrackState[] = trackSizes.map((size, i) => {
    if (collapsed[i]) {
      return {
        base: 0,
        limit: 0,
        baseIntrinsic: false,
        limitKind: "fixed",
        frFactor: 0,
        collapsed: true,
      };
    }
    const fixedMin = fixedBreadth(size.min, available);
    const base = fixedMin ?? 0;
    const baseIntrinsic = fixedMin === undefined;
    const max = size.max;
    if (max.kind === "fr") {
      return {
        base,
        limit: null,
        baseIntrinsic,
        limitKind: "fr",
        frFactor: max.value,
        collapsed: false,
      };
    }
    const fixedMax = fixedBreadth(max, available);
    if (fixedMax !== undefined) {
      return {
        base,
        limit: fixedMax,
        baseIntrinsic,
        limitKind: "fixed",
        frFactor: 0,
        collapsed: false,
      };
    }
    return {
      base,
      limit: null,
      baseIntrinsic,
      limitKind: max.kind === "min-content" ? "intrinsic-min" : "intrinsic-max",
      frFactor: 0,
      collapsed: false,
    };
  });

  const gapBefore: number[] = tracks.map((t, i) => {
    if (i === 0 || t.collapsed) return 0;
    return tracks.slice(0, i).some((p) => !p.collapsed) ? gap : 0;
  });
  const internalGaps = (start: number, span: number): number => {
    let sum = 0;
    for (let i = start + 1; i < start + span; i++) sum += gapBefore[i]!;
    return sum;
  };
  const effectiveLimit = (t: TrackState): number =>
    t.collapsed ? 0 : t.limitKind === "fixed" ? t.limit! : Math.max(t.base, t.limit ?? t.base);

  // Step 2: intrinsic contributions, ascending span order. An item
  // spanning an fr track distributes only its MIN-content contribution,
  // and only to the fr tracks' bases (weighted by flex factor, per CSS
  // §11.5.1) — this is the automatic minimum that makes bare `1fr 1fr`
  // columns unequal under long content; max contributions are §11.7's
  // job. Everything else grows the intrinsic tracks it spans.
  const bySpan = [...items].sort((a, b) => a.span - b.span);
  for (const item of bySpan) {
    const spanned: TrackState[] = [];
    let crossesFr = false;
    for (let i = item.start; i < item.start + item.span; i++) {
      const t = tracks[i];
      if (t === undefined) continue;
      if (t.limitKind === "fr") crossesFr = true;
      spanned.push(t);
    }
    if (spanned.length === 0) continue;
    const gaps = internalGaps(item.start, item.span);
    if (crossesFr) {
      // Only fr tracks with an INTRINSIC min (`1fr` = minmax(auto, 1fr))
      // take the automatic minimum; `minmax(0, 1fr)` opts out and keeps
      // dividing evenly.
      const frReceivers = spanned.filter(
        (t) => t.limitKind === "fr" && t.baseIntrinsic && !t.collapsed,
      );
      if (frReceivers.length === 0) continue;
      const current = spanned.reduce((s, t) => s + t.base, 0) + gaps;
      const needed = item.min - current;
      if (needed > 0) {
        const factorSum = frReceivers.reduce((s, t) => s + t.frFactor, 0);
        const shares = distributeInteger(
          frReceivers.map((t) => (factorSum > 0 ? t.frFactor : 1)),
          needed,
        );
        frReceivers.forEach((t, k) => {
          t.base += shares[k]!;
        });
      }
      continue;
    }

    // Bases: grow the intrinsic-min tracks until the span covers the
    // item's min-content contribution.
    const baseReceivers = spanned.filter((t) => t.baseIntrinsic && !t.collapsed);
    if (baseReceivers.length > 0) {
      const current = spanned.reduce((s, t) => s + t.base, 0) + gaps;
      const needed = item.min - current;
      if (needed > 0) {
        const shares = distributeInteger(
          baseReceivers.map(() => 1),
          needed,
        );
        baseReceivers.forEach((t, k) => {
          t.base += shares[k]!;
        });
      }
    }
    // Limits: grow the intrinsic-limit tracks toward the corresponding
    // contribution (min-content maxes take the min contribution).
    for (const [kind, contribution] of [
      ["intrinsic-min", item.min],
      ["intrinsic-max", item.max],
    ] as const) {
      const receivers = spanned.filter((t) => t.limitKind === kind && !t.collapsed);
      if (receivers.length === 0) continue;
      const current = spanned.reduce((s, t) => s + effectiveLimit(t), 0) + gaps;
      const needed = contribution - current;
      if (needed > 0) {
        const shares = distributeInteger(
          receivers.map(() => 1),
          needed,
        );
        receivers.forEach((t, k) => {
          t.limit = effectiveLimit(t) + shares[k]!;
        });
      }
    }
  }

  // Step 3: clamp. A fixed limit wins over a larger base (mirroring
  // min/max-width, and emulating CSS's limited contributions); an
  // intrinsic limit is floored at its base.
  for (const t of tracks) {
    if (t.collapsed) continue;
    if (t.limitKind === "fixed") t.base = Math.min(t.base, t.limit!);
    else if (t.limitKind !== "fr") t.limit = Math.max(t.base, t.limit ?? t.base);
  }

  if (available === undefined) {
    // Indefinite axis. Flexible tracks size to the shared flex fraction
    // (§11.7 with indefinite space): the largest of each fr track's
    // base ÷ factor and, per item crossing fr tracks, its max-content
    // contribution left after the non-flexible spanned tracks, divided by
    // the crossed flex factors (floored at 1, per §11.7.1). Integer cells
    // via the shared rounding. This is why two `1fr` rows both take the
    // TALLEST item's height, matching browsers.
    const frTracks = tracks.filter((t) => t.limitKind === "fr" && !t.collapsed);
    if (frTracks.length > 0) {
      let fraction = 0;
      for (const t of frTracks) {
        if (t.frFactor > 0) fraction = Math.max(fraction, t.base / t.frFactor);
      }
      for (const item of items) {
        let factorSum = 0;
        let nonFlexible = internalGaps(item.start, item.span);
        for (let i = item.start; i < item.start + item.span; i++) {
          const t = tracks[i];
          if (t === undefined || t.collapsed) continue;
          if (t.limitKind === "fr") factorSum += t.frFactor;
          else nonFlexible += effectiveLimit(t);
        }
        if (factorSum <= 0) continue;
        fraction = Math.max(fraction, (item.max - nonFlexible) / Math.max(factorSum, 1));
      }
      for (const t of frTracks) {
        const size = Math.max(t.base, roundHalfAwayFromZero(t.frFactor * fraction));
        t.limit = size;
        if (space === "max-content") t.base = size;
      }
    }
    // Under the max-content constraint (§11.6 with infinite free space)
    // every other track maximizes to its growth limit.
    if (space === "max-content") {
      for (const t of tracks) {
        if (!t.collapsed && t.limitKind !== "fr") t.base = effectiveLimit(t);
      }
    }
  } else {
    const totalGaps = gapBefore.reduce((s, g) => s + g, 0);
    // §11.6 maximize: grow bases up to their growth limits with the free
    // space, equal shares, re-distributing what frozen tracks can't take.
    let free = available - totalGaps - tracks.reduce((s, t) => s + t.base, 0);
    for (;;) {
      if (free <= 0) break;
      const growable = tracks.filter(
        (t) => !t.collapsed && t.limitKind !== "fr" && t.base < effectiveLimit(t),
      );
      if (growable.length === 0) break;
      const shares = distributeInteger(
        growable.map(() => 1),
        free,
      );
      let grown = 0;
      growable.forEach((t, k) => {
        const grow = Math.min(shares[k]!, effectiveLimit(t) - t.base);
        t.base += grow;
        grown += grow;
      });
      free -= grown;
      if (grown === 0) break;
    }

    // §11.7 fr distribution: the space left after non-fr tracks, shared by
    // factor, each fr track floored at its base (the automatic minimum for
    // bare `<n>fr`; `minmax(0, 1fr)` has base 0 and divides evenly). A
    // factor sum below 1 only distributes that fraction of the space, per
    // CSS. Frozen-at-base tracks drop out and the rest re-distribute.
    const frTracks = tracks.filter((t) => t.limitKind === "fr");
    if (frTracks.length > 0) {
      const leftover = Math.max(
        0,
        available - totalGaps - tracks.reduce((s, t) => s + (t.limitKind === "fr" ? 0 : t.base), 0),
      );
      let active = frTracks;
      let space = leftover;
      const factorSum = frTracks.reduce((s, t) => s + t.frFactor, 0);
      if (factorSum < 1) space = Math.floor(space * factorSum);
      for (;;) {
        const shares = distributeInteger(
          active.map((t) => t.frFactor),
          space,
        );
        const violators = active.filter((t, k) => shares[k]! < t.base);
        if (violators.length === 0) {
          active.forEach((t, k) => {
            t.base = Math.max(t.base, shares[k]!);
          });
          break;
        }
        for (const t of violators) space -= t.base;
        space = Math.max(0, space);
        active = active.filter((t) => !violators.includes(t));
        if (active.length === 0) break;
      }
    }

    // §11.8 stretch auto tracks: under `normal`/`stretch` content
    // distribution, leftover space grows the auto-limited tracks equally.
    if (stretchAuto) {
      const remaining = available - totalGaps - tracks.reduce((s, t) => s + t.base, 0);
      const autoTracks = tracks.filter((t) => !t.collapsed && t.limitKind === "intrinsic-max");
      if (remaining > 0 && autoTracks.length > 0) {
        const shares = distributeInteger(
          autoTracks.map(() => 1),
          remaining,
        );
        autoTracks.forEach((t, k) => {
          t.base += shares[k]!;
        });
      }
    }
  }

  return {
    sizes: tracks.map((t) => t.base),
    gapBefore,
    limits: tracks.map((t) => effectiveLimit(t)),
  };
}

// ---------------------------------------------------------------------------
// Geometry

/** Track start positions relative to the content-box origin, including
 * the content-distribution offsets when the tracks underfill the axis
 * (`stretch` already consumed the space in sizing; it offsets as start). */
function trackPositions(
  sizing: SizingResult,
  available: number,
  distribute: JustifyContent,
): number[] {
  const { sizes, gapBefore } = sizing;
  const leftover = Math.max(0, available - totalExtent(sizing));
  const offsets = mainAxisOffsets(distribute === "stretch" ? "start" : distribute, sizes, leftover);
  const positions: number[] = [];
  let gapSum = 0;
  for (let i = 0; i < sizes.length; i++) {
    gapSum += gapBefore[i]!;
    positions.push(offsets[i]! + gapSum);
  }
  return positions;
}

function totalExtent(sizing: SizingResult): number {
  return sizing.sizes.reduce((s, v) => s + v, 0) + sizing.gapBefore.reduce((s, g) => s + g, 0);
}

/** The extent of a track span, internal gaps included. */
function areaExtent(positions: number[], sizes: number[], start: number, span: number): number {
  const last = start + span - 1;
  if (positions[start] === undefined || positions[last] === undefined) return 0;
  return positions[last]! + sizes[last]! - positions[start]!;
}

/** An item's offset inside its grid area along one axis: auto margins win
 * over alignment (both → centered, one → pushed to the other side), then
 * the fixed leading margin plus the alignment offset (`stretch` behaves
 * as `start` — the stretch already happened in sizing). */
function areaAxisOffset(
  align: AlignItems,
  before: number | null,
  after: number | null,
  area: number,
  size: number,
): number {
  const fixedBefore = before ?? 0;
  const fixedAfter = after ?? 0;
  const slack = area - size;
  if (before === null && after === null) return Math.floor(slack / 2);
  if (before === null) return slack - fixedAfter;
  if (after === null) return fixedBefore;
  return fixedBefore + alignCrossOffset(align, area, size + fixedBefore + fixedAfter);
}
