import { STYLE_RANK } from "./lattice.ts";
import { glyphSetFor, junctionWeight, weightBand } from "./glyphs.ts";
import type { BorderGlyphSet } from "./glyphs.ts";
import { percentToCells } from "./metrics.ts";
import { warnOnce } from "./warn.ts";
import { distributeInteger } from "./flex.ts";
import {
  blockStaticSlot,
  boxChrome,
  clampSize,
  contentOrigin,
  intrinsicOuterWidth,
  isInFlowBox,
  isOutOfFlow,
  layoutNode,
  resolveMargin,
  resolveSizeAgainst,
} from "./layout.ts";
import type { IntrinsicCache } from "./layout.ts";
import type { LatticeBorder, LatticeSegment, LayoutNode, Side, TableLattice } from "./types.ts";

/**
 * Table layout (specs/table.md): CSS 2.1 §17 adapted to integer cells.
 * Structure comes from `tableRole`s (computed display), spans from the
 * HTML attributes, column sizing from the §17.5.2.2 algorithms with the
 * shared integer distribution, and collapsed borders become a shared
 * box-drawing lattice painted with junction glyphs.
 */

interface PlacedCell {
  node: LayoutNode;
  /** The row LayoutNode the cell lives under (its rect parent). */
  rowNode: LayoutNode;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

interface TableStructure {
  caption: LayoutNode | null;
  /** Rows in render order: header-group rows, body rows, footer-group rows. */
  rows: LayoutNode[];
  /** Per row: its group container node (null for rows directly in the table). */
  rowGroups: (LayoutNode | null)[];
  /** Per row: the exclusive end row index of its row group (`rowspan="0"`
   * extends to it, and row spans clamp to it). */
  groupEnds: number[];
  cells: PlacedCell[];
  columnCount: number;
  /** Fixed width from `<col>` elements, per column. */
  colFixed: (number | undefined)[];
  /** Percent width from `<col>` elements, per column. */
  colPercent: (number | undefined)[];
  /** `<col>`/`<colgroup>` boxes and misparented content — never rendered. */
  hidden: LayoutNode[];
  /** Per out-of-flow child: the index a row in its place would take. */
  outOfFlow: Map<LayoutNode, number>;
}

// ---------------------------------------------------------------------------
// Structure

function markHidden(structure: TableStructure, node: LayoutNode): void {
  structure.hidden.push(node);
  if (node.style.tableRole === "column" || node.style.tableRole === "column-group") return;
  warnOnce(
    node.source,
    "Table content outside the expected structure (rows in tables, cells in rows) " +
      "can't be laid out and was hidden — no anonymous table boxes (specs/table.md).",
  );
}

/** `span`, `colspan` or `rowspan`, clamped per HTML; a `rowspan` of 0
 * runs to the end of the row group, resolved during placement. */
function spanAttribute(el: Element, name: "span" | "colspan" | "rowspan"): number {
  const raw = Number.parseInt(el.getAttribute(name) ?? "", 10);
  if (Number.isNaN(raw)) return 1;
  if (name === "rowspan") return Math.min(65534, Math.max(0, raw));
  return Math.min(1000, Math.max(1, raw));
}

/** The width a table cell or column sets in cells, fixed or min-/max-content:
 * a percent reads apart, fit-content as auto (probed: every engine). */
function fixedWidth(node: LayoutNode, cache: IntrinsicCache): number | undefined {
  const { width } = node.style;
  if (width === undefined || width.kind === "percent" || width.kind === "fit-content") {
    return undefined;
  }
  return resolveSizeAgainst(width, 0, node, cache);
}

function readColumns(structure: TableStructure, node: LayoutNode, cache: IntrinsicCache): void {
  const expand = (col: LayoutNode, count: number) => {
    const width = col.style.width;
    const fixed = fixedWidth(col, cache);
    const percent = width && width.kind === "percent" ? width.value : undefined;
    for (let i = 0; i < count; i++) {
      structure.colFixed.push(fixed);
      structure.colPercent.push(percent);
    }
  };
  if (node.style.tableRole === "column") {
    expand(node, spanAttribute(node.source, "span"));
    return;
  }
  const cols = node.children.filter((child) => child.style.tableRole === "column");
  if (cols.length === 0) expand(node, spanAttribute(node.source, "span"));
  else for (const col of cols) expand(col, spanAttribute(col.source, "span"));
  for (const child of node.children)
    if (child.style.tableRole !== "column") markHidden(structure, child);
}

function resolveTableStructure(node: LayoutNode, cache: IntrinsicCache): TableStructure {
  const structure: TableStructure = {
    caption: null,
    rows: [],
    rowGroups: [],
    groupEnds: [],
    cells: [],
    columnCount: 0,
    colFixed: [],
    colPercent: [],
    hidden: [],
    outOfFlow: new Map(),
  };

  // Row groups render header-first and footer-last regardless of DOM
  // order, per HTML; consecutive direct rows form one implicit group.
  const headerRows: { row: LayoutNode; group: LayoutNode }[] = [];
  const bodyRows: { row: LayoutNode; group: LayoutNode | null }[] = [];
  const footerRows: { row: LayoutNode; group: LayoutNode }[] = [];
  for (const child of node.children) {
    if (isOutOfFlow(child.style)) {
      structure.outOfFlow.set(child, bodyRows.length);
      continue;
    }
    const role = child.style.tableRole;
    if (role === "row") {
      bodyRows.push({ row: child, group: null });
    } else if (role === "header-group" || role === "row-group" || role === "footer-group") {
      const bucket =
        role === "header-group" ? headerRows : role === "footer-group" ? footerRows : bodyRows;
      for (const rowChild of child.children) {
        if (isOutOfFlow(rowChild.style)) continue;
        if (rowChild.style.tableRole === "row") bucket.push({ row: rowChild, group: child });
        else markHidden(structure, rowChild);
      }
    } else if (role === "caption") {
      if (structure.caption === null) structure.caption = child;
      else markHidden(structure, child);
    } else if (role === "column" || role === "column-group") {
      readColumns(structure, child, cache);
      structure.hidden.push(child);
    } else {
      markHidden(structure, child);
    }
  }

  for (const [child, row] of structure.outOfFlow) {
    structure.outOfFlow.set(child, headerRows.length + row);
  }

  // Group boundaries: each explicit group is one; direct body rows merge
  // with their neighbors into implicit groups per contiguous run.
  const ordered = [...headerRows, ...bodyRows, ...footerRows];
  let groupStart = 0;
  for (let r = 0; r < ordered.length; r++) {
    structure.rows.push(ordered[r]!.row);
    structure.rowGroups.push(ordered[r]!.group);
    const nextGroup = ordered[r + 1]?.group;
    const sameGroup =
      r + 1 < ordered.length &&
      (ordered[r]!.group === nextGroup || (ordered[r]!.group === null && nextGroup === null));
    if (!sameGroup) {
      for (let g = groupStart; g <= r; g++) structure.groupEnds.push(r + 1);
      groupStart = r + 1;
    }
  }

  placeCells(structure);
  return structure;
}

/** The grid auto-placement cursor specialized to tables: rows are
 * definite, cells fill left-to-right skipping slots blocked by earlier
 * spans, never dense (specs/table.md). */
function placeCells(structure: TableStructure): void {
  // blockedUntil[c] = exclusive row index until which column c is occupied.
  const blockedUntil: number[] = [];
  for (let r = 0; r < structure.rows.length; r++) {
    const rowNode = structure.rows[r]!;
    let c = 0;
    for (const child of rowNode.children) {
      if (isOutOfFlow(child.style)) continue;
      if (child.style.tableRole !== "cell") {
        markHidden(structure, child);
        continue;
      }
      while ((blockedUntil[c] ?? 0) > r) c++;
      const colSpan = spanAttribute(child.source, "colspan");
      const rawRowSpan = spanAttribute(child.source, "rowspan");
      const groupEnd = structure.groupEnds[r]!;
      const rowSpan = Math.max(
        1,
        Math.min(rawRowSpan === 0 ? groupEnd - r : rawRowSpan, groupEnd - r),
      );
      for (let i = c; i < c + colSpan; i++)
        blockedUntil[i] = Math.max(blockedUntil[i] ?? 0, r + rowSpan);
      structure.cells.push({ node: child, rowNode, row: r, col: c, rowSpan, colSpan });
      c += colSpan;
    }
  }
  structure.columnCount = Math.max(blockedUntil.length, structure.colFixed.length);
}

// ---------------------------------------------------------------------------
// Column sizing (specs/table.md, CSS 2.1 §17.5.2.2 integer-adapted)

interface ColumnBounds {
  min: number[];
  max: number[];
  /** Highest percent authored on the column's cells or its `<col>`. */
  percent: (number | undefined)[];
}

/** A cell's intrinsic contribution. A fixed width replaces the max
 * contribution (floored at the content min — the width can't shrink a
 * column below its content, per CSS 2.1); the min stays content-derived.
 * Cell margins are ignored, per CSS (internal table boxes have none). */
function cellContribution(cell: LayoutNode, kind: "min" | "max", cache: IntrinsicCache): number {
  const style = cell.style;
  const contentMin = intrinsicOuterWidth(cell, "min", cache);
  let width: number;
  if (kind === "min") {
    width = contentMin;
  } else {
    const fixed = fixedWidth(cell, cache);
    width =
      fixed !== undefined ? Math.max(contentMin, fixed) : intrinsicOuterWidth(cell, "max", cache);
  }
  const min = typeof style.minWidth === "number" ? style.minWidth : 0;
  const max = typeof style.maxWidth === "number" ? style.maxWidth : undefined;
  return Math.max(0, clampSize(width, min, max));
}

function cellPercent(cell: LayoutNode): number | undefined {
  const width = cell.style.width;
  return width && width.kind === "percent" ? width.value : undefined;
}

function autoColumnBounds(
  structure: TableStructure,
  chrome: TableChrome,
  cache: IntrinsicCache,
): ColumnBounds {
  const count = structure.columnCount;
  const min = Array.from({ length: count }, () => 0);
  const max = Array.from({ length: count }, () => 0);
  const percent = Array.from({ length: count }, (): number | undefined => undefined);
  for (let c = 0; c < count; c++) {
    if (structure.colFixed[c] !== undefined) max[c] = structure.colFixed[c]!;
    percent[c] = structure.colPercent[c];
  }

  const spanning: PlacedCell[] = [];
  for (const cell of structure.cells) {
    if (cell.colSpan > 1) {
      spanning.push(cell);
      continue;
    }
    min[cell.col] = Math.max(min[cell.col]!, cellContribution(cell.node, "min", cache));
    max[cell.col] = Math.max(max[cell.col]!, cellContribution(cell.node, "max", cache));
    const p = cellPercent(cell.node);
    if (p !== undefined) percent[cell.col] = Math.max(percent[cell.col] ?? 0, p);
  }

  // Spanning cells: ascending span, excess over what the spanned columns
  // already provide distributed proportionally to their max widths
  // (equal shares when all zero). Percent on spanning cells is ignored.
  spanning.sort((a, b) => a.colSpan - b.colSpan);
  for (const cell of spanning) {
    const columnStart = cell.col;
    const columnEnd = cell.col + cell.colSpan;
    const interior = linesWithin(chrome.vLines, columnStart, columnEnd);
    const weights = max.slice(columnStart, columnEnd);
    for (const kind of ["min", "max"] as const) {
      const target = kind === "min" ? min : max;
      const provided = target.slice(columnStart, columnEnd).reduce((a, b) => a + b, 0) + interior;
      const excess = cellContribution(cell.node, kind, cache) - provided;
      if (excess <= 0) continue;
      const shares = distributeInteger(
        weights.some((w) => w > 0) ? weights : weights.map(() => 1),
        excess,
      );
      for (let c = columnStart; c < columnEnd; c++) target[c]! += shares[c - columnStart]!;
    }
  }

  for (let c = 0; c < count; c++) max[c] = Math.max(max[c]!, min[c]!);
  return { min, max, percent };
}

/** Distribute the definite column space (specs/table.md steps 4–5):
 * percent columns pin to their resolved shares (floored at min, scaled
 * so non-percent columns keep their mins); the rest grow min → max, then
 * share anything beyond proportionally to their maxes. */
function distributeColumns(bounds: ColumnBounds, columnSpace: number): number[] {
  const count = bounds.min.length;
  const widths = bounds.min.slice();
  const percentIndices: number[] = [];
  const autoIndices: number[] = [];
  for (let c = 0; c < count; c++)
    (bounds.percent[c] !== undefined ? percentIndices : autoIndices).push(c);

  if (percentIndices.length > 0) {
    const totalPercent = percentIndices.reduce((sum, c) => sum + bounds.percent[c]!, 0);
    const scale = Math.max(100, totalPercent);
    for (const c of percentIndices) {
      const raw = Math.round((columnSpace * bounds.percent[c]!) / scale);
      widths[c] = Math.max(bounds.min[c]!, raw);
    }
    // Cap so every non-percent column keeps its min (the used-width floor
    // guarantees all-mins fits); shrink proportionally to target − min.
    const autoMins = autoIndices.reduce((sum, c) => sum + bounds.min[c]!, 0);
    const percentTotal = percentIndices.reduce((sum, c) => sum + widths[c]!, 0);
    const over = percentTotal - (columnSpace - autoMins);
    if (over > 0) {
      const reducible = percentIndices.map((c) => widths[c]! - bounds.min[c]!);
      const cuts = distributeInteger(
        reducible,
        Math.min(
          over,
          reducible.reduce((a, b) => a + b, 0),
        ),
      );
      percentIndices.forEach((c, i) => (widths[c]! -= cuts[i]!));
    }
  }

  let remaining = columnSpace - widths.reduce((a, b) => a + b, 0);
  if (remaining > 0 && autoIndices.length > 0) {
    const room = autoIndices.map((c) => bounds.max[c]! - bounds.min[c]!);
    const growable = room.reduce((a, b) => a + b, 0);
    const grow = distributeInteger(room, Math.min(remaining, growable));
    autoIndices.forEach((c, i) => (widths[c]! += grow[i]!));
    remaining -= Math.min(remaining, growable);
  }
  if (remaining > 0) {
    // Beyond every max: proportional to the maxes (equal when all zero);
    // percent columns join only when there is nothing else.
    const targets = autoIndices.length > 0 ? autoIndices : percentIndices;
    if (targets.length > 0) {
      const weights = targets.map((c) => bounds.max[c]!);
      const extra = distributeInteger(
        weights.some((w) => w > 0) ? weights : weights.map(() => 1),
        remaining,
      );
      targets.forEach((c, i) => (widths[c]! += extra[i]!));
    }
  }
  return widths;
}

/** `table-layout: fixed`: `<col>`s, then the first row's cells (spanning
 * cells split equally); still-unsized columns share the rest equally.
 * Content is never measured. */
function fixedLayoutColumns(
  structure: TableStructure,
  columnSpace: number,
  cache: IntrinsicCache,
): number[] {
  const count = structure.columnCount;
  const widths = Array.from({ length: count }, (): number | undefined => undefined);
  for (let c = 0; c < count; c++) {
    if (structure.colFixed[c] !== undefined) widths[c] = structure.colFixed[c];
    else if (structure.colPercent[c] !== undefined)
      widths[c] = Math.max(0, Math.round((columnSpace * structure.colPercent[c]!) / 100));
  }
  for (const cell of structure.cells) {
    if (cell.row !== 0) continue;
    const style = cell.node.style;
    const cellWidth =
      style.width?.kind === "percent"
        ? Math.max(0, Math.round((columnSpace * style.width.value) / 100))
        : fixedWidth(cell.node, cache);
    if (cellWidth === undefined) continue;
    const share = distributeInteger(
      Array.from({ length: cell.colSpan }, () => 1),
      cellWidth,
    );
    for (let i = 0; i < cell.colSpan; i++) {
      const c = cell.col + i;
      if (widths[c] === undefined) widths[c] = share[i];
    }
  }
  const sized = widths.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  const unsized = widths.filter((w) => w === undefined).length;
  if (unsized > 0) {
    const shares = distributeInteger(
      Array.from({ length: unsized }, () => 1),
      Math.max(0, columnSpace - sized),
    );
    let i = 0;
    for (let c = 0; c < count; c++) if (widths[c] === undefined) widths[c] = shares[i++];
  }
  return widths.map((w) => w ?? 0);
}

// ---------------------------------------------------------------------------
// Border lattice (collapsed) and spacing (separate) geometry

interface TableChrome {
  collapsed: boolean;
  /** Per-line widths (columnCount + 1 / rowCount + 1): the lattice's
   * when collapsed, the border spacing in the separate model. */
  vLines: number[];
  hLines: number[];
  /** Collapsed only: winner per vertical segment [line][row] and
   * horizontal segment [line][column]; null = no border there (spanned
   * through, or nothing authored). */
  vSegments: (LatticeSegment | null)[][];
  hSegments: (LatticeSegment | null)[][];
}

/** CSS 2.1 §17.6.2.1, simplified: wider (px) wins, then style rank,
 * then the candidate order (callers pass cell > row > row group >
 * table). The winner draws with its weight band under the TABLE's set —
 * a lattice resolves with one set (specs/theming.md) — at the band's
 * thickness, and carries its weight into junctions where the set draws
 * it (junctionWeight). */
function resolveSegment(
  candidates: { border: LatticeBorder | null; side: Side }[],
  set: BorderGlyphSet | undefined,
): LatticeSegment | null {
  for (const { border, side } of candidates) if (border?.hidden[side]) return null; // hidden beats everything
  let winner: Omit<LatticeSegment, "width"> | null = null;
  for (const { border, side } of candidates) {
    if (!border || border.width[side] <= 0) continue;
    const weight = border.weight[side];
    const style = border.style[side];
    if (
      winner === null ||
      weight > winner.weight ||
      (weight === winner.weight && STYLE_RANK[style] > STYLE_RANK[winner.style])
    ) {
      winner = { weight, style, color: border.color[side] };
    }
  }
  if (!winner) return null;
  const { style, weight } = winner;
  return {
    ...winner,
    width: weightBand(style, weight, set).cells,
    weight: junctionWeight(style, weight, set),
  };
}

function resolveChrome(node: LayoutNode, structure: TableStructure): TableChrome {
  const C = structure.columnCount;
  const R = structure.rows.length;
  const collapsed = node.style.borderCollapse;
  const set = glyphSetFor(node.style.glyphSet);
  const chrome: TableChrome = {
    collapsed,
    vLines: Array.from({ length: C + 1 }, () => (collapsed ? 0 : node.style.borderSpacingX)),
    hLines: Array.from({ length: R + 1 }, () => (collapsed ? 0 : node.style.borderSpacingY)),
    vSegments: [],
    hSegments: [],
  };
  if (!collapsed || C === 0 || R === 0) return chrome;

  // Occupancy map for adjacency lookups.
  const cellAt: (PlacedCell | undefined)[][] = Array.from({ length: R }, () =>
    Array.from({ length: C }, (): PlacedCell | undefined => undefined),
  );
  for (const cell of structure.cells)
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++)
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) cellAt[r]![c] = cell;

  const table = node.style.latticeBorder;
  for (let i = 0; i <= C; i++) {
    const segments: (LatticeSegment | null)[] = [];
    for (let r = 0; r < R; r++) {
      const left = i > 0 ? cellAt[r]![i - 1] : undefined;
      const right = i < C ? cellAt[r]![i] : undefined;
      if (left !== undefined && left === right) {
        segments.push(null); // spanned through
        continue;
      }
      const candidates: { border: LatticeBorder | null; side: Side }[] = [];
      if (left && left.col + left.colSpan === i)
        candidates.push({ border: left.node.style.latticeBorder, side: "right" });
      if (right && right.col === i)
        candidates.push({ border: right.node.style.latticeBorder, side: "left" });
      // Row/group left/right borders compete at the table's edge lines.
      const edge: Side | null = i === 0 ? "left" : i === C ? "right" : null;
      if (edge) {
        candidates.push({ border: structure.rows[r]!.style.latticeBorder, side: edge });
        const group = structure.rowGroups[r];
        if (group) candidates.push({ border: group.style.latticeBorder, side: edge });
        candidates.push({ border: table, side: edge });
      }
      segments.push(resolveSegment(candidates, set));
    }
    chrome.vSegments.push(segments);
    chrome.vLines[i] = segments.reduce((w, s) => Math.max(w, s?.width ?? 0), 0);
  }
  for (let j = 0; j <= R; j++) {
    const segments: (LatticeSegment | null)[] = [];
    for (let c = 0; c < C; c++) {
      const above = j > 0 ? cellAt[j - 1]![c] : undefined;
      const below = j < R ? cellAt[j]![c] : undefined;
      if (above !== undefined && above === below) {
        segments.push(null);
        continue;
      }
      const candidates: { border: LatticeBorder | null; side: Side }[] = [];
      if (above && above.row + above.rowSpan === j)
        candidates.push({ border: above.node.style.latticeBorder, side: "bottom" });
      if (below && below.row === j)
        candidates.push({ border: below.node.style.latticeBorder, side: "top" });
      if (j > 0)
        candidates.push({ border: structure.rows[j - 1]!.style.latticeBorder, side: "bottom" });
      if (j < R) candidates.push({ border: structure.rows[j]!.style.latticeBorder, side: "top" });
      const groupAbove = j > 0 ? structure.rowGroups[j - 1] : null;
      const groupBelow = j < R ? structure.rowGroups[j] : null;
      if (groupAbove && groupAbove !== groupBelow)
        candidates.push({ border: groupAbove.style.latticeBorder, side: "bottom" });
      if (groupBelow && groupBelow !== groupAbove)
        candidates.push({ border: groupBelow.style.latticeBorder, side: "top" });
      if (j === 0) candidates.push({ border: table, side: "top" });
      if (j === R) candidates.push({ border: table, side: "bottom" });
      segments.push(resolveSegment(candidates, set));
    }
    chrome.hSegments.push(segments);
    chrome.hLines[j] = segments.reduce((w, s) => Math.max(w, s?.width ?? 0), 0);
  }
  return chrome;
}

/** The line widths inside the tracks [start, end). */
function linesWithin(lines: number[], start: number, end: number): number {
  let sum = 0;
  for (let i = start + 1; i < end; i++) sum += lines[i]!;
  return sum;
}

// ---------------------------------------------------------------------------
// Cached per-node table data (structure + chrome + column bounds)

export interface TableData {
  structure: TableStructure;
  chrome: TableChrome;
  bounds: ColumnBounds;
  chromeX: number;
}

function tableData(node: LayoutNode, cache: IntrinsicCache): TableData {
  const cached = cache.tableData.get(node);
  if (cached) return cached;
  const structure = resolveTableStructure(node, cache);
  const chrome = resolveChrome(node, structure);
  const bounds = autoColumnBounds(structure, chrome, cache);
  const data: TableData = {
    structure,
    chrome,
    bounds,
    chromeX: chrome.vLines.reduce((a, b) => a + b, 0),
  };
  cache.tableData.set(node, data);
  return data;
}

/** Content-box intrinsic widths: column bounds plus lattice/spacing
 * chrome, floored by the caption. Percents behave as auto here (the
 * indefinite-axis rule); inflation applies only against a definite
 * available width, in `tableUsedOuterWidth`. */
export function tableIntrinsicInnerWidths(
  node: LayoutNode,
  cache: IntrinsicCache,
): { min: number; max: number } {
  const { structure, bounds, chromeX } = tableData(node, cache);
  let min = bounds.min.reduce((a, b) => a + b, 0) + chromeX;
  let max = bounds.max.reduce((a, b) => a + b, 0) + chromeX;
  if (structure.caption) {
    min = Math.max(min, intrinsicOuterWidth(structure.caption, "min", cache));
    max = Math.max(max, intrinsicOuterWidth(structure.caption, "max", cache));
  }
  return { min, max };
}

/** Used outer width of an auto-width table (specs/table.md step 3):
 * shrink-to-fit with percent inflation, floored at the min sum, capped
 * at the available width. Fixed layout always fills. */
export function tableUsedOuterWidth(
  node: LayoutNode,
  availableWidth: number,
  cache: IntrinsicCache,
): number {
  const { bounds, chromeX } = tableData(node, cache);
  const { min, max } = tableIntrinsicInnerWidths(node, cache);
  const outerChromeX = boxChrome(node.style, "x", availableWidth);

  // Percent inflation (css-tables-3 style, probed): each percent column
  // demands max ÷ p, the rest demand sum ÷ (1 − Σp); Σp ≥ 100% demands
  // everything. All in column space; chrome comes back after.
  let demand = bounds.max.reduce((a, b) => a + b, 0);
  let sumPercent = 0;
  let nonPercentMax = 0;
  for (let c = 0; c < bounds.max.length; c++) {
    const p = bounds.percent[c];
    if (p === undefined) nonPercentMax += bounds.max[c]!;
    else sumPercent += p;
  }
  if (sumPercent >= 100) {
    demand = Number.POSITIVE_INFINITY;
  } else if (sumPercent > 0) {
    for (let c = 0; c < bounds.max.length; c++) {
      const p = bounds.percent[c];
      if (p !== undefined && p > 0)
        demand = Math.max(demand, Math.ceil((bounds.max[c]! * 100) / p));
    }
    demand = Math.max(demand, Math.ceil((nonPercentMax * 100) / (100 - sumPercent)));
  }
  // `max` (not just the column demand) so the caption's own max-content
  // participates in shrink-to-fit.
  const target = Math.max(demand + chromeX, max) + outerChromeX;
  return Math.max(min + outerChromeX, Math.min(target, availableWidth));
}

// ---------------------------------------------------------------------------
// Layout

export function layoutTable(
  node: LayoutNode,
  innerWidth: number,
  definiteInnerHeight: number | undefined,
  cache: IntrinsicCache,
): number {
  const { structure, chrome, bounds, chromeX } = tableData(node, cache);
  const C = structure.columnCount;
  const R = structure.rows.length;
  const { x: contentLeft, y: contentTop } = contentOrigin(node);

  for (const hiddenNode of structure.hidden) {
    hiddenNode.tableHidden = true;
    hiddenNode.localRect = { x: 0, y: 0, width: 0, height: 0 };
    hiddenNode.resolvedPadding = { top: 0, right: 0, bottom: 0, left: 0 };
  }

  const columnSpace = Math.max(0, innerWidth - chromeX);
  // Fixed layout applies only with an authored width; a width-auto fixed
  // table uses the auto algorithm, like every browser (CSS 2.1 §17.5.2).
  const style = node.style;
  const usesFixedLayout = style.tableLayout === "fixed" && style.width !== undefined;
  const widths = usesFixedLayout
    ? fixedLayoutColumns(structure, columnSpace, cache)
    : distributeColumns(bounds, columnSpace);

  // Column x positions and grid width, table-content-relative.
  const colX: number[] = [];
  let x = 0;
  for (let c = 0; c < C; c++) {
    x += chrome.vLines[c]!;
    colX.push(x);
    x += widths[c]!;
  }
  const gridWidth = x + chrome.vLines[C]!;

  // Caption first: a top caption shifts the grid down.
  let captionHeight = 0;
  if (structure.caption) {
    layoutNode(structure.caption, innerWidth, undefined, contentLeft, contentTop, "fill", cache);
    captionHeight = structure.caption.localRect.height;
  }

  // Cell natural heights at their final span widths. Percent heights in
  // the subtree contribute nothing here (they'd be circular).
  const naturalHeights = new Map<PlacedCell, number>();
  const spanWidths = new Map<PlacedCell, number>();
  for (const cell of structure.cells) {
    const columnEnd = cell.col + cell.colSpan;
    const spanWidth =
      widths.slice(cell.col, columnEnd).reduce((a, b) => a + b, 0) +
      linesWithin(chrome.vLines, cell.col, columnEnd);
    spanWidths.set(cell, spanWidth);
    layoutNode(cell.node, spanWidth, undefined, 0, 0, "fill", cache, { width: spanWidth });
    naturalHeights.set(cell, cell.node.localRect.height);
  }

  // Row heights: fixed (and, against a definite table height, percent —
  // probed: all engines pin such rows and give the leftover to the
  // others) row heights floor, single-span cells raise, spanning cells
  // distribute ascending-span (equal shares), extra definite height
  // spreads equally over the non-percent rows (specs/table.md).
  const chromeY = chrome.hLines.reduce((a, b) => a + b, 0);
  const rowBasis =
    definiteInnerHeight === undefined
      ? undefined
      : Math.max(0, definiteInnerHeight - captionHeight - chromeY);
  const percentFloor = (size: LayoutNode["style"]["height"]): number =>
    size !== undefined && size.kind === "percent" && rowBasis !== undefined
      ? percentToCells(size.value, rowBasis)
      : 0;
  const rowHeights = Array.from({ length: R }, () => 0);
  const percentRows = Array.from({ length: R }, () => false);
  for (let r = 0; r < R; r++) {
    const h = structure.rows[r]!.style.height;
    if (h !== undefined && h.kind === "cells") rowHeights[r] = h.value;
    const floor = percentFloor(h);
    if (floor > 0) {
      rowHeights[r] = Math.max(rowHeights[r]!, floor);
      percentRows[r] = true;
    }
  }
  for (const cell of structure.cells)
    if (cell.rowSpan === 1) {
      const floor = percentFloor(cell.node.style.height);
      if (floor > 0) percentRows[cell.row] = true;
      rowHeights[cell.row] = Math.max(rowHeights[cell.row]!, naturalHeights.get(cell)!, floor);
    }
  const rowSpanning = structure.cells
    .filter((cell) => cell.rowSpan > 1)
    .sort((a, b) => a.rowSpan - b.rowSpan);
  for (const cell of rowSpanning) {
    const rowEnd = cell.row + cell.rowSpan;
    const provided =
      rowHeights.slice(cell.row, rowEnd).reduce((a, b) => a + b, 0) +
      linesWithin(chrome.hLines, cell.row, rowEnd);
    const excess = naturalHeights.get(cell)! - provided;
    if (excess <= 0) continue;
    const shares = distributeInteger(
      Array.from({ length: cell.rowSpan }, () => 1),
      excess,
    );
    for (let r = cell.row; r < rowEnd; r++) rowHeights[r]! += shares[r - cell.row]!;
  }
  if (definiteInnerHeight !== undefined && R > 0) {
    const extra =
      definiteInnerHeight - captionHeight - chromeY - rowHeights.reduce((a, b) => a + b, 0);
    if (extra > 0) {
      // Percent rows are pinned at their share; the rest split the
      // leftover (equally — deviation 5).
      const receivers: number[] = [];
      for (let r = 0; r < R; r++) if (!percentRows[r]) receivers.push(r);
      const targets = receivers.length > 0 ? receivers : Array.from({ length: R }, (_, r) => r);
      const shares = distributeInteger(
        targets.map(() => 1),
        extra,
      );
      targets.forEach((r, i) => (rowHeights[r]! += shares[i]!));
    }
  }

  // Row y positions, table-content-relative.
  const gridTop = structure.caption && node.style.captionSide === "top" ? captionHeight : 0;
  const rowY: number[] = [];
  let y = gridTop;
  for (let r = 0; r < R; r++) {
    y += chrome.hLines[r]!;
    rowY.push(y);
    y += rowHeights[r]!;
  }
  const gridBottom = R > 0 ? y + chrome.hLines[R]! : gridTop;

  // Rects, parent-relative down the tree: table → group → row → cell.
  // Rows and groups never went through layoutNode; give them the fields
  // the renderers expect (padding on internal boxes is ignored, per CSS).
  const groupTops = new Map<LayoutNode, number>();
  for (let r = 0; r < R; r++) {
    const group = structure.rowGroups[r];
    if (group && !groupTops.has(group)) groupTops.set(group, rowY[r]!);
  }
  for (const [group, top] of groupTops) {
    let bottom = top;
    for (let r = 0; r < R; r++)
      if (structure.rowGroups[r] === group) bottom = rowY[r]! + rowHeights[r]!;
    group.localRect = {
      x: contentLeft,
      y: contentTop + top,
      width: gridWidth,
      height: bottom - top,
    };
    group.resolvedPadding = { top: 0, right: 0, bottom: 0, left: 0 };
  }
  for (let r = 0; r < R; r++) {
    const rowNode = structure.rows[r]!;
    const group = structure.rowGroups[r];
    const groupTop = group ? groupTops.get(group)! : undefined;
    rowNode.localRect = {
      x: groupTop === undefined ? contentLeft : 0,
      y: groupTop === undefined ? contentTop + rowY[r]! : rowY[r]! - groupTop,
      width: gridWidth,
      height: rowHeights[r]!,
    };
    rowNode.resolvedPadding = { top: 0, right: 0, bottom: 0, left: 0 };
  }
  for (const cell of structure.cells) {
    const rowEnd = cell.row + cell.rowSpan;
    const areaHeight =
      rowHeights.slice(cell.row, rowEnd).reduce((a, b) => a + b, 0) +
      linesWithin(chrome.hLines, cell.row, rowEnd);
    // A cell with percent-height children re-lays-out at the final area
    // height so they resolve against it — the browsers' legacy second
    // pass. Deeper percents chain through their parents' then-definite
    // heights; alignment then sees whatever height the content reached.
    const hasPercentHeightChild = cell.node.children.some(
      (child) => !isOutOfFlow(child.style) && child.style.height?.kind === "percent",
    );
    if (hasPercentHeightChild && areaHeight !== naturalHeights.get(cell)) {
      layoutNode(cell.node, spanWidths.get(cell)!, areaHeight, 0, 0, "fill", cache, {
        width: spanWidths.get(cell)!,
        height: areaHeight,
      });
    }
    // Align the CONTENT, not the box: an explicit cell height tallens
    // the natural box, but vertical-align still centers within it.
    alignCellContent(cell.node, areaHeight - cell.node.naturalContentHeight);
    cell.node.localRect = {
      x: colX[cell.col]!,
      y: 0,
      width: cell.node.localRect.width,
      height: areaHeight,
    };
  }

  for (const [child, row] of structure.outOfFlow) {
    const margin = resolveMargin(child.style.margin, innerWidth);
    const top = row < R ? rowY[row]! : y + chrome.hLines[R]!;
    child.staticSlot = blockStaticSlot(margin, contentLeft + chrome.vLines[0]!, contentTop + top);
  }

  if (structure.caption && node.style.captionSide === "bottom")
    structure.caption.localRect.y = contentTop + gridBottom;

  if (chrome.collapsed && C > 0 && R > 0) {
    const cells: TableLattice["cells"] = Array.from({ length: R }, () =>
      Array.from({ length: C }, () => undefined),
    );
    for (const cell of structure.cells) {
      const placed = { node: cell.node, row: cell.rowNode, group: structure.rowGroups[cell.row]! };
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++)
        for (let c = cell.col; c < cell.col + cell.colSpan; c++) cells[r]![c] = placed;
    }
    node.lattice = {
      vLines: chrome.vLines,
      hLines: chrome.hLines,
      vSegments: chrome.vSegments,
      hSegments: chrome.hSegments,
      widths,
      rowHeights,
      colX,
      rowY,
      contentLeft,
      contentTop,
      cells,
      set: glyphSetFor(node.style.glyphSet),
    };
  }

  // A top caption is already inside gridBottom (via gridTop).
  return node.style.captionSide === "bottom" ? gridBottom + captionHeight : gridBottom;
}

/** Fold the cell's leftover block-axis space into its content per
 * `vertical-align`: leaves take it as engine-owned padding (the
 * alignLeafText pattern); containers shift their children. Either way
 * the children move with it — a leaf's inline boxes were placed at the
 * padding before it grew. */
function alignCellContent(cell: LayoutNode, delta: number): void {
  if (delta <= 0) return;
  const align = cell.style.verticalAlign;
  const offset = align === "center" ? Math.floor(delta / 2) : align === "end" ? delta : 0;
  if (!cell.children.some(isInFlowBox)) {
    // The FULL delta lands in padding even at offset 0 (top alignment):
    // the renderers then account for every row of the stretched box.
    cell.resolvedPadding.top += offset;
    cell.resolvedPadding.bottom += delta - offset;
  }
  if (offset <= 0) return;
  for (const child of cell.children) {
    if (isOutOfFlow(child.style)) {
      if (child.staticSlot?.kind === "block") child.staticSlot.y += offset;
    } else {
      child.localRect.y += offset;
    }
  }
}
