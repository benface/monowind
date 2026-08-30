import { collectGapRuleRuns, ruleBandSegments } from "./borders.ts";
import type { GapStrip } from "./borders.ts";
import type { RuleSegment } from "./borders.ts";
import { percentToCells, roundHalfAwayFromZero } from "./metrics.ts";
import { autoTrack } from "./types.ts";
import {
  clampSize,
  intrinsicOuterWidth,
  isOutOfFlow,
  layoutNode,
  minContentOuterWidth,
  resolveGap,
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
  InheritedTracks,
  Insets,
  JustifyContent,
  LayoutNode,
  NullableInsets,
  Rect,
  TrackBreadth,
  TrackSize,
} from "./types.ts";

/**
 * Grid layout (specs/grid.md): template resolution, CSS §8.5 auto-
 * placement, the §11 track sizing algorithm adapted to integer cells, and
 * item placement in areas. Shares the integer distribution and alignment
 * offset machinery with flex. See layout.ts for the deliberate import
 * cycle between the layout modules.
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
  // A subgridded axis inherits the parent's tracks AND gutters
  // (specs/grid.md — an own gap on that axis is ignored, a documented
  // simplification). Rows may still be provisional (see LayoutNode.subgrid).
  const inheritedCols = node.subgrid?.cols;
  const inheritedRows = node.subgrid?.rows;
  const gapX = inheritedCols ? inheritedCols.gap : resolveGap(style, "x", innerWidth);
  const gapY = inheritedRows ? inheritedRows.gap : resolveGap(style, "y", rowAvailable);

  const structure = resolveGridStructure(
    node,
    innerWidth,
    rowAvailable,
    gapX,
    gapY,
    node.subgrid ? { col: node.subgrid.colSpan, row: node.subgrid.rowSpan } : undefined,
  );
  const { children, placed, colLines, rowLines, colTracks, rowTracks, colCollapsed, rowCollapsed } =
    structure;
  const margins = children.map((child) => resolveMargin(child.style.margin, innerWidth));
  const justifies = children.map((child) =>
    child.style.justifySelf === "auto" ? style.justifyItems : child.style.justifySelf,
  );

  // Whether each child subgrids its columns / rows, computed once and
  // shared by the sizing builders and both item passes.
  const subs = children.map(subgridAxes);

  // Column track sizing from the items' intrinsic width contributions
  // (outer sizes plus fixed margins, auto margins as 0; subgrid children
  // contribute their own items through the mapped tracks) — or the
  // parent's tracks when this axis is subgridded.
  const colSizing: SizingResult = inheritedCols
    ? sizingResultFromInherited(inheritedCols)
    : sizeTracks(
        colTracks,
        colCollapsed,
        columnSizingItems(structure, subs, margins, cache),
        innerWidth,
        gapX,
        style.justifyContent === "stretch",
      );
  const colPos = inheritedCols
    ? inheritedCols.positions
    : trackPositions(colSizing, innerWidth, style.justifyContent);

  // First item pass: resolve each item's width in its column area
  // (stretch by default; own min/max still clamp; explicit sizes and auto
  // margins opt out) and lay it out — heights emerge here. A subgrid is
  // always exactly its area in a subgridded axis, per CSS, and receives
  // the inherited tracks before its layout.
  const usedWidths: number[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const p = placed.items[i]!;
    const areaW = areaExtent(colPos, colSizing.sizes, p.col.start, p.col.span);
    const margin = margins[i]!;
    const availW = Math.max(0, areaW - fixedX(margin));
    const sub = subs[i]!;
    // A child that subgrids either axis carries a subgrid record — the
    // column half fills in now (rows follow after row sizing).
    if (sub.cols || sub.rows) {
      const cols = sub.cols
        ? inheritTracks(
            colPos,
            colSizing,
            gapX,
            p.col.start,
            p.col.span,
            subgridChrome(child, "cols", margin, areaW),
          )
        : undefined;
      child.subgrid = { colSpan: p.col.span, rowSpan: p.row.span, cols, rows: undefined };
    } else {
      child.subgrid = undefined;
    }
    const justify = justifies[i]!;
    const hasAutoX = margin.left === null || margin.right === null;
    const hasExplicitWidth = child.style.width !== undefined && child.style.width.kind !== "auto";
    if (sub.cols) {
      layoutNode(child, areaW, undefined, 0, 0, "fill", cache, { width: availW });
    } else if (justify === "stretch" && !hasAutoX && !hasExplicitWidth) {
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
  // the item's min- and max-content block contributions coincide) — or
  // the parent's tracks when this axis is subgridded.
  const rowSizing: SizingResult = inheritedRows
    ? sizingResultFromInherited(inheritedRows)
    : sizeTracks(
        rowTracks,
        rowCollapsed,
        rowSizingItems(structure, subs, margins),
        rowAvailable ?? "max-content",
        gapY,
        style.alignContent === "stretch",
      );
  const contentRows = totalExtent(rowSizing);
  const rowPos = inheritedRows
    ? inheritedRows.positions
    : trackPositions(rowSizing, rowAvailable ?? contentRows, style.alignContent);

  // Second item pass: block-axis stretch and final placement (a row
  // subgrid gets its inherited rows now and is laid out for real).
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
    if (subs[i]!.rows) {
      child.subgrid!.rows = inheritTracks(
        rowPos,
        rowSizing,
        gapY,
        p.row.start,
        p.row.span,
        subgridChrome(child, "rows", margin, areaW),
      );
      layoutNode(child, areaW, areaH, 0, 0, "fill", cache, {
        width: usedWidths[i]!,
        height: availH,
      });
    } else if (align === "stretch" && !hasAutoY && !hasExplicitHeight) {
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

  const contentHeight = Number.isFinite(innerHeight)
    ? Math.max(innerHeight, contentRows)
    : contentRows;

  // Gap rules (specs/gap-decorations.md): gutter bands between adjacent
  // tracks (collapsed auto-fit gutters have no width and drop out),
  // segmented per placement occupancy, rule-break, rule-visibility-items,
  // and rule-inset (see the spec's "Segments" section).
  if (style.ruleX || style.ruleY) {
    const colCount = colSizing.sizes.length;
    const rowCount = rowSizing.sizes.length;
    // occupied[c][r]: a cell holds (part of) an item. crossesCol[g][r]:
    // an item spans across column-gap g (between columns g and g+1)
    // at row r — the gap doesn't exist there; crossesRow likewise.
    const occupied = Array.from({ length: colCount }, () =>
      Array.from({ length: rowCount }, () => false),
    );
    const crossesCol = Array.from({ length: Math.max(0, colCount - 1) }, () =>
      Array.from({ length: rowCount }, () => false),
    );
    const crossesRow = Array.from({ length: Math.max(0, rowCount - 1) }, () =>
      Array.from({ length: colCount }, () => false),
    );
    for (const p of placed.items) {
      for (let c = p.col.start; c < p.col.start + p.col.span && c < colCount; c++) {
        for (let r = p.row.start; r < p.row.start + p.row.span && r < rowCount; r++) {
          occupied[c]![r] = true;
          if (c + 1 < p.col.start + p.col.span && c < colCount - 1) crossesCol[c]![r] = true;
          if (r + 1 < p.row.start + p.row.span && r < rowCount - 1) crossesRow[r]![c] = true;
        }
      }
    }
    const strips = (
      gap: number,
      positions: number[],
      sizes: number[],
      crosses: boolean[][],
      before: (t: number) => boolean,
      after: (t: number) => boolean,
    ): GapStrip[] =>
      positions.map((position, t) => ({
        start: position,
        end: position + sizes[t]!,
        spanned: crosses[gap]?.[t] ?? false,
        beforeOccupied: before(t),
        afterOccupied: after(t),
      }));
    const bandSegments = (
      positions: number[],
      sizes: number[],
      stripsFor: (gap: number) => GapStrip[],
    ): RuleSegment[] => {
      const bands: RuleSegment[] = [];
      for (let i = 1; i < positions.length; i++) {
        const bandStart = positions[i - 1]! + sizes[i - 1]!;
        const bandSize = positions[i]! - bandStart;
        if (bandSize <= 0) continue;
        for (const segment of ruleBandSegments(
          stripsFor(i - 1),
          style.ruleBreak,
          style.ruleVisibilityItems,
          style.ruleInset,
        )) {
          bands.push({ bandStart, bandSize, start: segment.start, end: segment.end });
        }
      }
      return bands;
    };
    const vertical = bandSegments(colPos, colSizing.sizes, (gap) =>
      strips(
        gap,
        rowPos,
        rowSizing.sizes,
        crossesCol,
        (r) => occupied[gap]?.[r] ?? false,
        (r) => occupied[gap + 1]?.[r] ?? false,
      ),
    );
    const horizontal = bandSegments(rowPos, rowSizing.sizes, (gap) =>
      strips(
        gap,
        colPos,
        colSizing.sizes,
        crossesRow,
        (c) => occupied[c]?.[gap] ?? false,
        (c) => occupied[c]?.[gap + 1] ?? false,
      ),
    );
    node.decorationRuns = collectGapRuleRuns({
      ruleX: style.ruleX,
      ruleY: style.ruleY,
      vertical,
      horizontal,
      contentWidth: innerWidth,
      contentHeight,
      border,
      borderStyle: style.borderStyle,
      borderColor: style.borderColor,
      padding,
    });
  }

  // Out-of-flow children (specs/grid.md §10.1): the child's grid area —
  // its containing block when this container is positioned — plus the
  // sole-item static area: the content box, or the padding box when this
  // container is itself absolutely positioned. Both parent-relative.
  const outOfFlow = node.children.filter((child) => isOutOfFlow(child.style));
  if (outOfFlow.length > 0) {
    const staticArea: Rect = isOutOfFlow(style)
      ? {
          x: border.left,
          y: border.top,
          width: padding.left + innerWidth + padding.right,
          height: padding.top + contentHeight + padding.bottom,
        }
      : { x: originX, y: originY, width: innerWidth, height: contentHeight };
    for (const child of outOfFlow) {
      const cols = absoluteAxisExtent(
        child.style.gridColumnStart,
        child.style.gridColumnEnd,
        colLines,
        placed.colOrigin,
        colPos,
        colSizing.sizes,
        -padding.left,
        innerWidth + padding.right,
      );
      const rows = absoluteAxisExtent(
        child.style.gridRowStart,
        child.style.gridRowEnd,
        rowLines,
        placed.rowOrigin,
        rowPos,
        rowSizing.sizes,
        -padding.top,
        contentHeight + padding.bottom,
      );
      child.staticSlot = {
        kind: "grid",
        area: {
          x: originX + cols.start,
          y: originY + rows.start,
          width: Math.max(0, cols.end - cols.start),
          height: Math.max(0, rows.end - rows.start),
        },
        staticArea,
      };
    }
  }

  return contentHeight;
}

/** Which axes of an in-flow grid child are `subgrid`. */
function subgridAxes(child: LayoutNode): { cols: boolean; rows: boolean } {
  const isGrid = child.style.display === "grid";
  return {
    cols: isGrid && child.style.gridTemplateColumns.kind === "subgrid",
    rows: isGrid && child.style.gridTemplateRows.kind === "subgrid",
  };
}

/**
 * Project the parent's tracks `[start, start + span)` into a subgrid's
 * content-box coordinates: the subgrid's content box starts `chrome.start`
 * (margin + border + padding) inside the first track, so that track
 * loses those cells at its start and the last track loses `chrome.end`
 * at its end; interior lines keep their positions. All returned arrays
 * are fresh — later mutation of the parent's sizing can never leak into
 * the child's inherited tracks.
 */
function inheritTracks(
  positions: number[],
  sizing: SizingResult,
  gap: number,
  start: number,
  span: number,
  chrome: { start: number; end: number },
): InheritedTracks {
  const base = positions[start]! + chrome.start;
  const sizes = sizing.sizes.slice(start, start + span);
  sizes[0] = Math.max(0, sizes[0]! - chrome.start);
  sizes[span - 1] = Math.max(0, sizes[span - 1]! - chrome.end);
  return {
    positions: Array.from({ length: span }, (_, i) => (i === 0 ? 0 : positions[start + i]! - base)),
    sizes,
    gapBefore: Array.from({ length: span }, (_, i) => (i === 0 ? 0 : sizing.gapBefore[start + i]!)),
    gap,
  };
}

/** Adapt inherited tracks to the `SizingResult` shape the rest of
 * `layoutGrid` reads. The tracks are already sized (limits = sizes) —
 * downstream code never mutates a `SizingResult`, so the arrays can be
 * shared. */
function sizingResultFromInherited(t: InheritedTracks): SizingResult {
  return { sizes: t.sizes, gapBefore: t.gapBefore, limits: t.sizes };
}

/** Column sizing contributions for a resolved grid: each item's
 * min-/max-content outer width plus fixed margins; a column-subgrid child
 * is replaced by its own items, mapped onto the parent's tracks. */
function columnSizingItems(
  structure: GridStructure,
  subs: { cols: boolean; rows: boolean }[],
  margins: NullableInsets[],
  cache: IntrinsicCache,
): SizingItem[] {
  const items: SizingItem[] = [];
  structure.children.forEach((child, i) => {
    const p = structure.placed.items[i]!;
    const margin = margins[i]!;
    if (subs[i]!.cols) {
      const chrome = subgridChrome(child, "cols", margin, 0);
      for (const item of subgridContributions(child, "cols", p, chrome, cache)) {
        items.push({ ...item, start: item.start + p.col.start });
      }
      return;
    }
    items.push({
      start: p.col.start,
      span: p.col.span,
      min: widthContribution(child, "min", cache) + fixedX(margin),
      max: widthContribution(child, "max", cache) + fixedX(margin),
    });
  });
  return items;
}

/** Row sizing contributions: each laid-out item's height plus fixed
 * margins (min = max at the final width); a row-subgrid child is
 * replaced by its own items, mapped onto the parent's tracks. */
function rowSizingItems(
  structure: GridStructure,
  subs: { cols: boolean; rows: boolean }[],
  margins: NullableInsets[],
): SizingItem[] {
  const items: SizingItem[] = [];
  structure.children.forEach((child, i) => {
    const p = structure.placed.items[i]!;
    const margin = margins[i]!;
    if (subs[i]!.rows) {
      const chrome = subgridChrome(child, "rows", margin, 0);
      for (const item of subgridContributions(child, "rows", p, chrome)) {
        items.push({ ...item, start: item.start + p.row.start });
      }
      return;
    }
    const height = child.localRect.height + fixedY(margin);
    items.push({ start: p.row.start, span: p.row.span, min: height, max: height });
  });
  return items;
}

/** A subgrid's own chrome on one axis — margin + border + padding on the
 * subgrid box itself — which its edge-track items must also cover (CSS
 * Grid 2 §3.1). `basis` resolves percent padding (per CSS, against the
 * containing-block WIDTH on all four sides); pass 0 during intrinsic
 * sizing so percent padding contributes 0, matching the intrinsic-size
 * rule for percent padding on any box. */
function subgridChrome(
  child: LayoutNode,
  axis: "cols" | "rows",
  margin: NullableInsets,
  basis: number,
): { start: number; end: number } {
  const { border, padding } = child.style;
  return axis === "cols"
    ? {
        start: (margin.left ?? 0) + border.left + resolveLength(padding.left, basis),
        end: (margin.right ?? 0) + border.right + resolveLength(padding.right, basis),
      }
    : {
        start: (margin.top ?? 0) + border.top + resolveLength(padding.top, basis),
        end: (margin.bottom ?? 0) + border.bottom + resolveLength(padding.bottom, basis),
      };
}

/**
 * A subgrid child's items as sizing contributions in the CHILD's own
 * track coordinates for the subgridded `axis` (the caller shifts them
 * onto the parent's tracks). Items in the subgrid's first/last track
 * also carry the subgrid's chrome on that side; nested subgrids compose
 * recursively. A subgrid without items still claims its chrome. `cache`
 * is needed for column (intrinsic) contributions only — rows use the
 * heights the provisional first pass laid out.
 *
 * `child.subgrid` is NOT written here — placement span is passed
 * explicitly to `resolveGridStructure`, keeping that field owned solely
 * by the parent's item passes.
 */
function subgridContributions(
  child: LayoutNode,
  axis: "cols" | "rows",
  placement: { col: PlacedAxis; row: PlacedAxis },
  chrome: { start: number; end: number },
  cache?: IntrinsicCache,
): SizingItem[] {
  const span = axis === "cols" ? placement.col.span : placement.row.span;
  const structure = resolveGridStructure(child, undefined, undefined, 0, 0, {
    col: placement.col.span,
    row: placement.row.span,
  });
  const items: SizingItem[] = [];
  structure.children.forEach((item, j) => {
    const q = structure.placed.items[j]!;
    const a = axis === "cols" ? q.col : q.row;
    const first = a.start === 0;
    const last = a.start + a.span === span;
    const extra = (first ? chrome.start : 0) + (last ? chrome.end : 0);
    const margin = resolveMargin(item.style.margin, 0);
    if (subgridAxes(item)[axis]) {
      const own = subgridChrome(item, axis, margin, 0);
      const nested = subgridContributions(
        item,
        axis,
        q,
        { start: own.start + (first ? chrome.start : 0), end: own.end + (last ? chrome.end : 0) },
        cache,
      );
      for (const c of nested) items.push({ ...c, start: c.start + a.start });
      return;
    }
    if (axis === "cols") {
      items.push({
        start: a.start,
        span: a.span,
        min: widthContribution(item, "min", cache!) + fixedX(margin) + extra,
        max: widthContribution(item, "max", cache!) + fixedX(margin) + extra,
      });
    } else {
      const height = item.localRect.height + fixedY(margin) + extra;
      items.push({ start: a.start, span: a.span, min: height, max: height });
    }
  });
  if (items.length === 0) {
    const total = chrome.start + chrome.end;
    items.push({ start: 0, span, min: total, max: total });
  }
  return items;
}

/**
 * One axis of an absolutely positioned grid child's area (CSS §10.1 with
 * §8.3 line resolution): definite lines map to track edges; `auto`, a
 * span against `auto`, and a line beyond the implicit grid resolve to the
 * container's padding edges (`edgeStart` / `edgeEnd`, content-relative).
 * Positions are content-relative track starts.
 */
function absoluteAxisExtent(
  startLine: GridLine,
  endLine: GridLine,
  lines: AxisLines,
  origin: number,
  positions: number[],
  sizes: number[],
  edgeStart: number,
  edgeEnd: number,
): { start: number; end: number } {
  let start = lineToIndex(startLine, "start", lines);
  let end = lineToIndex(endLine, "end", lines);
  if (start !== null && end !== null) {
    if (start > end) [start, end] = [end, start];
    else if (start === end) end = null;
  } else if (start !== null && endLine.kind === "span") {
    end = spanFrom(start, endLine, 1, lines);
  } else if (end !== null && startLine.kind === "span") {
    start = spanFrom(end, startLine, -1, lines);
  }
  // A grid line sits between two tracks with the gutter around it: as a
  // START line it is the following track's start edge, as an END line the
  // preceding track's end edge (an area never includes an outer gutter).
  const count = positions.length;
  const normalized = (line: number | null): number | undefined => {
    if (line === null) return undefined;
    const n = line - origin;
    return n < 0 || n > count || count === 0 ? undefined : n;
  };
  const startLineAt = (n: number): number =>
    n === count ? positions[count - 1]! + sizes[count - 1]! : positions[n]!;
  const endLineAt = (n: number): number =>
    n === 0 ? positions[0]! : positions[n - 1]! + sizes[n - 1]!;
  const s = normalized(start);
  const e = normalized(end);
  return {
    start: s === undefined ? edgeStart : startLineAt(s),
    end: e === undefined ? edgeEnd : endLineAt(e),
  };
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
  const gapX = Math.max(typeof style.gapX === "number" ? style.gapX : 0, style.ruleX?.width ?? 0);
  const structure = resolveGridStructure(
    node,
    undefined,
    undefined,
    gapX,
    0,
    node.subgrid ? { col: node.subgrid.colSpan, row: node.subgrid.rowSpan } : undefined,
  );
  const subs = structure.children.map(subgridAxes);
  const margins = structure.children.map((child) => resolveMargin(child.style.margin, 0));
  const sizing = sizeTracks(
    structure.colTracks,
    structure.colCollapsed,
    columnSizingItems(structure, subs, margins, cache),
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
  /** The explicit grid per axis — the basis for line resolution. */
  colLines: AxisLines;
  rowLines: AxisLines;
  colTracks: TrackSize[];
  rowTracks: TrackSize[];
  colCollapsed: boolean[];
  rowCollapsed: boolean[];
}

/** Everything upstream of track sizing: template resolution against the
 * axes' available sizes (a subgridded axis has exactly its span's worth
 * of placeholder tracks, and clamps placement to them — no implicit
 * tracks there, per CSS Grid 2), placement spec resolution, §8.5
 * auto-placement, the full per-axis track lists (implicit tracks
 * included), and auto-fit collapse flags. */
function resolveGridStructure(
  node: LayoutNode,
  colAvailable: number | undefined,
  rowAvailable: number | undefined,
  gapX: number,
  gapY: number,
  subgridSpans?: { col: number; row: number },
): GridStructure {
  const style = node.style;
  const children = gridOrderedChildren(node);
  const colSubgrid = style.gridTemplateColumns.kind === "subgrid" && subgridSpans !== undefined;
  const rowSubgrid = style.gridTemplateRows.kind === "subgrid" && subgridSpans !== undefined;
  const colTemplate = colSubgrid
    ? placeholderTemplate(subgridSpans.col)
    : resolveTemplate(style.gridTemplateColumns, colAvailable, gapX);
  const rowTemplate = rowSubgrid
    ? placeholderTemplate(subgridSpans.row)
    : resolveTemplate(style.gridTemplateRows, rowAvailable, gapY);
  // `grid-template-areas` (specs/grid.md): the explicit grid is the
  // larger of the template and the areas — extra tracks come from the
  // grid-auto-* lists — and every area names its edge lines
  // `<name>-start` / `<name>-end` in both axes. A subgridded axis keeps
  // its inherited track count.
  const areas = style.gridTemplateAreas;
  const colExplicit = [...colTemplate.tracks];
  const rowExplicit = [...rowTemplate.tracks];
  if (areas) {
    if (!colSubgrid) {
      extendExplicitTracks(
        colExplicit,
        colTemplate.lineNames,
        areas.columns,
        style.gridAutoColumns,
      );
    }
    if (!rowSubgrid) {
      extendExplicitTracks(rowExplicit, rowTemplate.lineNames, areas.rows, style.gridAutoRows);
    }
    for (const [name, area] of areas.areas) {
      colTemplate.lineNames[Math.min(area.colStart, colExplicit.length)]!.push(`${name}-start`);
      colTemplate.lineNames[Math.min(area.colEnd, colExplicit.length)]!.push(`${name}-end`);
      rowTemplate.lineNames[Math.min(area.rowStart, rowExplicit.length)]!.push(`${name}-start`);
      rowTemplate.lineNames[Math.min(area.rowEnd, rowExplicit.length)]!.push(`${name}-end`);
    }
  }
  const colLines: AxisLines = { explicitCount: colExplicit.length, names: colTemplate.lineNames };
  const rowLines: AxisLines = { explicitCount: rowExplicit.length, names: rowTemplate.lineNames };
  const specs = children.map((child) => ({
    col: resolveAxisPlacement(child.style.gridColumnStart, child.style.gridColumnEnd, colLines),
    row: resolveAxisPlacement(child.style.gridRowStart, child.style.gridRowEnd, rowLines),
  }));
  const placed = placeItems(specs, colExplicit.length, rowExplicit.length, style.gridAutoFlow);
  if (colSubgrid) clampToExplicit(placed, "col", colExplicit.length);
  if (rowSubgrid) clampToExplicit(placed, "row", rowExplicit.length);
  return {
    children,
    placed,
    colLines,
    rowLines,
    colTracks: buildAxisTracks(
      colExplicit,
      placed.colOrigin,
      placed.colCount,
      style.gridAutoColumns,
    ),
    rowTracks: buildAxisTracks(rowExplicit, placed.rowOrigin, placed.rowCount, style.gridAutoRows),
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

/** A subgridded axis's stand-in template: `span` auto tracks. The
 * parent's inherited tracks replace them at sizing time; they only size
 * themselves during a row subgrid's provisional first pass. */
function placeholderTemplate(span: number): ResolvedTemplate {
  return {
    tracks: Array.from({ length: span }, () => autoTrack()),
    lineNames: Array.from({ length: span + 1 }, () => []),
  };
}

/** Subgrids have no implicit tracks in a subgridded axis: any placement
 * outside the explicit `count` tracks is clamped onto the nearest edge
 * track(s), and the axis is normalized to exactly those tracks. */
function clampToExplicit(placed: PlacementResult, axis: "col" | "row", count: number): void {
  const origin = axis === "col" ? placed.colOrigin : placed.rowOrigin;
  for (const item of placed.items) {
    const a = item[axis];
    const start = Math.min(Math.max(a.start + origin, 0), count - 1);
    const end = Math.min(Math.max(a.start + origin + a.span, start + 1), count);
    a.start = start;
    a.span = end - start;
  }
  if (axis === "col") {
    placed.colOrigin = 0;
    placed.colCount = count;
  } else {
    placed.rowOrigin = 0;
    placed.rowCount = count;
  }
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
  /** Names per line, tracks.length + 1 entries (fresh arrays — the
   * structure step adds area-implied names to them). */
  lineNames: string[][];
  /** The index range [start, end) of the tracks an `auto-fit` repetition
   * produced — those collapse to 0 when empty (gaps dropped too). */
  autoFit?: { start: number; end: number };
}

/**
 * Expand a template's auto-repeat against the axis's definite size:
 * `count = max(1, floor((available + gap) ÷ (iteration + gap·tracks)))`
 * with `iteration` the sum of the repeated tracks' fixed mins (their fixed
 * max when the min is intrinsic) — exact in integer cells. An indefinite
 * axis repeats once, per CSS. (`subgrid` never reaches here — the
 * structure step substitutes the inherited span; outside a grid parent
 * it behaves as `none`, per CSS.)
 */
function resolveTemplate(
  template: GridTemplate,
  available: number | undefined,
  gap: number,
): ResolvedTemplate {
  if (template.kind !== "tracks") return { tracks: [], lineNames: [[]] };
  const baseNames = (
    template.lineNames ?? Array.from({ length: template.tracks.length + 1 }, () => [])
  ).map((names) => [...names]);
  if (!template.autoRepeat) return { tracks: template.tracks, lineNames: baseNames };
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
  // Line names: the repetition's edge groups merge with their neighbors
  // at every boundary (the names authored before the repeat land on the
  // first repeated line, the names after it on the line past the last).
  const repNames =
    template.autoRepeat.lineNames ?? Array.from({ length: repetition.length + 1 }, () => []);
  const lineNames: string[][] = baseNames.slice(0, index);
  let pending = [...(template.autoRepeat.leadingNames ?? [])];
  for (let i = 0; i < count; i++) {
    pending.push(...repNames[0]!);
    for (let j = 0; j < repetition.length; j++) {
      lineNames.push(pending);
      pending = [...repNames[j + 1]!];
    }
  }
  lineNames.push([...pending, ...baseNames[index]!]);
  lineNames.push(...baseNames.slice(index + 1));
  if (mode === "auto-fit") {
    return { tracks, lineNames, autoFit: { start: index, end: index + repeated.length } };
  }
  return { tracks, lineNames };
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

/** Grow an explicit track list to `count` tracks with the `grid-auto-*`
 * list (cycled), keeping `lineNames` at tracks + 1 entries — for tracks
 * that `grid-template-areas` defines beyond the template, per CSS §7.3. */
function extendExplicitTracks(
  tracks: TrackSize[],
  lineNames: string[][],
  count: number,
  autoList: TrackSize[],
): void {
  for (let i = tracks.length; i < count; i++) {
    tracks.push(autoList[(i - tracks.length) % autoList.length]!);
    lineNames.push([]);
  }
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

/** The explicit grid of one axis for line resolution: its track count
 * and the names on each of its `explicitCount + 1` lines (template
 * `[name]` groups plus the `<area>-start` / `<area>-end` lines areas
 * imply). Line indices are 0-based; indices outside `0 … explicitCount`
 * are implicit lines. */
export interface AxisLines {
  explicitCount: number;
  names: string[][];
}

/**
 * A definite line (numeric or named) as a 0-based line index, or null
 * for `auto` and spans. Numbers are 1-based, negatives count from the
 * explicit grid's end. A bare name first matches the first line named
 * `<name>-start` / `<name>-end` for its side (the area edges), else it
 * means `1 <name>`; `<n> <name>` is the n-th line so named, walking into
 * the implicit grid when fewer exist (every implicit line is assumed to
 * carry every name, per CSS §8.3).
 */
function lineToIndex(line: GridLine, side: "start" | "end", lines: AxisLines): number | null {
  if (line.kind === "line") {
    return line.value > 0 ? line.value - 1 : lines.explicitCount + 1 + line.value;
  }
  if (line.kind !== "name") return null;
  if (line.nth === undefined) {
    const edge = `${line.name}-${side}`;
    const index = lines.names.findIndex((names) => names.includes(edge));
    if (index !== -1) return index;
  }
  const nth = line.nth ?? 1;
  const count = lines.explicitCount;
  let seen = 0;
  if (nth > 0) {
    for (let i = 0; i <= count; i++) {
      if (lines.names[i]!.includes(line.name) && ++seen === nth) return i;
    }
    return count + (nth - seen);
  }
  for (let i = count; i >= 0; i--) {
    if (lines.names[i]!.includes(line.name) && ++seen === -nth) return i;
  }
  return -(-nth - seen);
}

/** The line a span reaches from a definite line: plain spans count every
 * line; a named span counts only lines carrying the name (all implicit
 * lines beyond the explicit grid count, per CSS). */
function spanFrom(
  from: number,
  span: { value: number; name?: string },
  direction: 1 | -1,
  lines: AxisLines,
): number {
  if (span.name === undefined) return from + direction * span.value;
  let remaining = span.value;
  let i = from;
  while (remaining > 0) {
    i += direction;
    const explicit = i >= 0 && i <= lines.explicitCount;
    if (!explicit || lines.names[i]!.includes(span.name)) remaining--;
  }
  return i;
}

/**
 * Resolve one axis of an item's placement from the two line longhands
 * (CSS §8.3). Both lines definite: start = the earlier line, span = the
 * distance (equal lines → the end line is discarded, span 1). One
 * definite line + a span → definite. Only spans (or nothing) →
 * indefinite with the requested span (a named span against `auto` is a
 * plain span — specs/grid.md deviation).
 */
export function resolveAxisPlacement(
  startLine: GridLine,
  endLine: GridLine,
  lines: AxisLines,
): AxisSpec {
  const start = lineToIndex(startLine, "start", lines);
  const end = lineToIndex(endLine, "end", lines);
  if (start !== null && end !== null) {
    if (start === end) return { start, span: 1 };
    return { start: Math.min(start, end), span: Math.abs(end - start) };
  }
  if (start !== null) {
    const spanEnd = endLine.kind === "span" ? spanFrom(start, endLine, 1, lines) : start + 1;
    return { start, span: spanEnd - start };
  }
  if (end !== null) {
    const spanStart = startLine.kind === "span" ? spanFrom(end, startLine, -1, lines) : end - 1;
    return { start: spanStart, span: end - spanStart };
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
