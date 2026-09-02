import { junctionGlyph, lineGlyph } from "./borders.ts";
import { glyphSetFor } from "./glyphs.ts";
import type { BorderGlyphSet } from "./glyphs.ts";
import { percentToCells } from "./metrics.ts";
import { warnOnce } from "./warn.ts";
import { distributeInteger } from "./flex.ts";
import {
  clampSize,
  intrinsicOuterWidth,
  isOutOfFlow,
  layoutNode,
  minContentOuterWidth,
  resolveLength,
  resolveSizeAgainst,
} from "./layout.ts";
import type { IntrinsicCache } from "./layout.ts";
import type { BorderRun, BorderStyle, Insets, LatticeBorder, LayoutNode } from "./types.ts";

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

/** HTML `colspan`/`rowspan`, clamped per the HTML spec. `rowspan` 0 means
 * "to the end of the row group" and resolves during placement. */
function spanAttribute(el: Element, name: "colspan" | "rowspan"): number {
  const raw = Number.parseInt(el.getAttribute(name) ?? "", 10);
  if (Number.isNaN(raw)) return 1;
  if (name === "colspan") return Math.min(1000, Math.max(1, raw));
  return Math.min(65534, Math.max(0, raw));
}

function readColumns(structure: TableStructure, node: LayoutNode, cache: IntrinsicCache): void {
  const expand = (col: LayoutNode, count: number) => {
    const width = col.style.width;
    const fixed =
      width && width.kind !== "auto" && width.kind !== "percent"
        ? resolveSizeAgainst(width, 0, col, cache)
        : undefined;
    const percent = width && width.kind === "percent" ? width.value : undefined;
    for (let i = 0; i < count; i++) {
      structure.colFixed.push(fixed);
      structure.colPercent.push(percent);
    }
  };
  if (node.style.tableRole === "column") {
    expand(node, spanCount(node.source));
    return;
  }
  const cols = node.children.filter((child) => child.style.tableRole === "column");
  if (cols.length === 0) expand(node, spanCount(node.source));
  else for (const col of cols) expand(col, spanCount(col.source));
  for (const child of node.children)
    if (child.style.tableRole !== "column") markHidden(structure, child);
}

/** `<col span>` / `<colgroup span>`, clamped per HTML (1–1000). */
function spanCount(el: Element): number {
  const raw = Number.parseInt(el.getAttribute("span") ?? "", 10);
  return Number.isNaN(raw) ? 1 : Math.min(1000, Math.max(1, raw));
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
  };

  // Row groups render header-first and footer-last regardless of DOM
  // order, per HTML; consecutive direct rows form one implicit group.
  const headerRows: { row: LayoutNode; group: LayoutNode }[] = [];
  const bodyRows: { row: LayoutNode; group: LayoutNode | null }[] = [];
  const footerRows: { row: LayoutNode; group: LayoutNode }[] = [];
  for (const child of node.children) {
    if (isOutOfFlow(child.style)) continue;
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
  const contentMin = minContentOuterWidth(cell, cache);
  let width: number;
  if (kind === "min") {
    width = contentMin;
  } else {
    const fixed =
      style.width !== undefined && style.width.kind !== "auto" && style.width.kind !== "percent"
        ? resolveSizeAgainst(style.width, 0, cell, cache)
        : undefined;
    width = fixed !== undefined ? Math.max(contentMin, fixed) : intrinsicOuterWidth(cell, cache);
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
    const c0 = cell.col;
    const c1 = cell.col + cell.colSpan;
    const interior = chromeBetweenColumns(chrome, c0, c1);
    const weights = max.slice(c0, c1);
    for (const kind of ["min", "max"] as const) {
      const target = kind === "min" ? min : max;
      const provided = target.slice(c0, c1).reduce((a, b) => a + b, 0) + interior;
      const excess = cellContribution(cell.node, kind, cache) - provided;
      if (excess <= 0) continue;
      const shares = distributeInteger(
        weights.some((w) => w > 0) ? weights : weights.map(() => 1),
        excess,
      );
      for (let c = c0; c < c1; c++) target[c]! += shares[c - c0]!;
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
    let cellWidth: number | undefined;
    if (style.width && style.width.kind === "percent")
      cellWidth = Math.max(0, Math.round((columnSpace * style.width.value) / 100));
    else if (style.width && style.width.kind !== "auto")
      cellWidth = resolveSizeAgainst(style.width, 0, cell.node, cache);
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

interface LatticeSegment {
  width: number;
  style: BorderStyle;
  color: string | undefined;
}

interface TableChrome {
  collapsed: boolean;
  /** Collapsed: per-line widths (columnCount + 1 / rowCount + 1); the
   * separate model keeps them zero and uses the spacings. */
  vLines: number[];
  hLines: number[];
  spacingX: number;
  spacingY: number;
  /** Collapsed only: winner per vertical segment [line][row] and
   * horizontal segment [line][column]; null = no border there (spanned
   * through, or nothing authored). */
  vSegments: (LatticeSegment | null)[][];
  hSegments: (LatticeSegment | null)[][];
}

type Side = "top" | "right" | "bottom" | "left";

const STYLE_RANK: Record<BorderStyle, number> = { double: 3, solid: 2, dashed: 1, dotted: 0 };

/** CSS 2.1 §17.6.2.1, simplified: wider wins, then style rank, then the
 * candidate order (callers pass cell > row > row group > table). */
function resolveSegment(
  candidates: { border: LatticeBorder | null; side: Side }[],
): LatticeSegment | null {
  for (const { border, side } of candidates) if (border?.hidden[side]) return null; // hidden beats everything
  let winner: LatticeSegment | null = null;
  for (const { border, side } of candidates) {
    if (!border) continue;
    const width = border.width[side];
    if (width <= 0) continue;
    const style = border.style[side];
    if (
      winner === null ||
      width > winner.width ||
      (width === winner.width && STYLE_RANK[style] > STYLE_RANK[winner.style])
    ) {
      winner = { width, style, color: border.color[side] };
    }
  }
  return winner;
}

function resolveChrome(node: LayoutNode, structure: TableStructure): TableChrome {
  const C = structure.columnCount;
  const R = structure.rows.length;
  const collapsed = node.style.borderCollapse;
  const chrome: TableChrome = {
    collapsed,
    vLines: Array.from({ length: C + 1 }, () => 0),
    hLines: Array.from({ length: R + 1 }, () => 0),
    spacingX: collapsed ? 0 : node.style.borderSpacingX,
    spacingY: collapsed ? 0 : node.style.borderSpacingY,
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
      segments.push(resolveSegment(candidates));
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
      segments.push(resolveSegment(candidates));
    }
    chrome.hSegments.push(segments);
    chrome.hLines[j] = segments.reduce((w, s) => Math.max(w, s?.width ?? 0), 0);
  }
  return chrome;
}

function innerChromeX(chrome: TableChrome, columnCount: number): number {
  return chrome.collapsed
    ? chrome.vLines.reduce((a, b) => a + b, 0)
    : (columnCount + 1) * chrome.spacingX;
}

/** Chrome between columns [c0, c1): interior lattice lines or spacing. */
function chromeBetweenColumns(chrome: TableChrome, c0: number, c1: number): number {
  if (!chrome.collapsed) return chrome.spacingX * (c1 - c0 - 1);
  let sum = 0;
  for (let i = c0 + 1; i < c1; i++) sum += chrome.vLines[i]!;
  return sum;
}

function chromeBetweenRows(chrome: TableChrome, r0: number, r1: number): number {
  if (!chrome.collapsed) return chrome.spacingY * (r1 - r0 - 1);
  let sum = 0;
  for (let j = r0 + 1; j < r1; j++) sum += chrome.hLines[j]!;
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
    chromeX: innerChromeX(chrome, structure.columnCount),
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
    min = Math.max(min, minContentOuterWidth(structure.caption, cache));
    max = Math.max(max, intrinsicOuterWidth(structure.caption, cache));
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
  const style = node.style;
  const { bounds, chromeX } = tableData(node, cache);
  const { min, max } = tableIntrinsicInnerWidths(node, cache);
  const outerChromeX =
    style.border.left +
    style.border.right +
    resolveLength(style.padding.left, availableWidth) +
    resolveLength(style.padding.right, availableWidth);

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
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const { structure, chrome, bounds } = tableData(node, cache);
  const C = structure.columnCount;
  const R = structure.rows.length;
  const contentLeft = border.left + padding.left;
  const contentTop = border.top + padding.top;

  for (const hiddenNode of structure.hidden) {
    hiddenNode.tableHidden = true;
    hiddenNode.localRect = { x: 0, y: 0, width: 0, height: 0 };
    hiddenNode.resolvedPadding = { top: 0, right: 0, bottom: 0, left: 0 };
    hiddenNode.unclampedHeight = 0;
  }

  const columnSpace = Math.max(0, innerWidth - innerChromeX(chrome, C));
  // Fixed layout applies only with an authored width; a width-auto fixed
  // table uses the auto algorithm, like every browser (CSS 2.1 §17.5.2).
  const style = node.style;
  const usesFixedLayout =
    style.tableLayout === "fixed" && style.width !== undefined && style.width.kind !== "auto";
  const widths = usesFixedLayout
    ? fixedLayoutColumns(structure, columnSpace, cache)
    : distributeColumns(bounds, columnSpace);

  // Column x positions and grid width, table-content-relative.
  const colX: number[] = [];
  let x = 0;
  for (let c = 0; c < C; c++) {
    x += chrome.collapsed ? chrome.vLines[c]! : chrome.spacingX;
    colX.push(x);
    x += widths[c]!;
  }
  const gridWidth = x + (chrome.collapsed ? (chrome.vLines[C] ?? 0) : chrome.spacingX);

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
    const c1 = cell.col + cell.colSpan;
    const spanW =
      widths.slice(cell.col, c1).reduce((a, b) => a + b, 0) +
      chromeBetweenColumns(chrome, cell.col, c1);
    spanWidths.set(cell, spanW);
    layoutNode(cell.node, spanW, undefined, 0, 0, "fill", cache, { width: spanW });
    naturalHeights.set(cell, cell.node.localRect.height);
  }

  // Row heights: fixed (and, against a definite table height, percent —
  // probed: all engines pin such rows and give the leftover to the
  // others) row heights floor, single-span cells raise, spanning cells
  // distribute ascending-span (equal shares), extra definite height
  // spreads equally over the non-percent rows (specs/table.md).
  const chromeY = chrome.collapsed
    ? chrome.hLines.reduce((a, b) => a + b, 0)
    : (R + 1) * chrome.spacingY;
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
    const r1 = cell.row + cell.rowSpan;
    const provided =
      rowHeights.slice(cell.row, r1).reduce((a, b) => a + b, 0) +
      chromeBetweenRows(chrome, cell.row, r1);
    const excess = naturalHeights.get(cell)! - provided;
    if (excess <= 0) continue;
    const shares = distributeInteger(
      Array.from({ length: cell.rowSpan }, () => 1),
      excess,
    );
    for (let r = cell.row; r < r1; r++) rowHeights[r]! += shares[r - cell.row]!;
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
    y += chrome.collapsed ? chrome.hLines[r]! : chrome.spacingY;
    rowY.push(y);
    y += rowHeights[r]!;
  }
  const gridBottom =
    R > 0 ? y + (chrome.collapsed ? (chrome.hLines[R] ?? 0) : chrome.spacingY) : gridTop;

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
    group.unclampedHeight = bottom - top;
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
    rowNode.unclampedHeight = rowHeights[r]!;
  }
  for (const cell of structure.cells) {
    const r1 = cell.row + cell.rowSpan;
    const areaH =
      rowHeights.slice(cell.row, r1).reduce((a, b) => a + b, 0) +
      chromeBetweenRows(chrome, cell.row, r1);
    // A cell with percent-height children re-lays-out at the final area
    // height so they resolve against it — the browsers' legacy second
    // pass. Deeper percents chain through their parents' then-definite
    // heights; alignment then sees whatever height the content reached.
    const hasPercentHeightChild = cell.node.children.some(
      (child) => !isOutOfFlow(child.style) && child.style.height?.kind === "percent",
    );
    if (hasPercentHeightChild && areaH !== naturalHeights.get(cell)) {
      layoutNode(cell.node, spanWidths.get(cell)!, areaH, 0, 0, "fill", cache, {
        width: spanWidths.get(cell)!,
        height: areaH,
      });
    }
    // Align the CONTENT, not the box: an explicit cell height tallens
    // the natural box, but vertical-align still centers within it.
    alignCellContent(
      cell.node,
      areaH - (cell.node.naturalContentHeight ?? cell.node.localRect.height),
    );
    cell.node.localRect = {
      x: colX[cell.col]!,
      y: 0,
      width: cell.node.localRect.width,
      height: areaH,
    };
  }

  // Static slots for the table's own out-of-flow children: content origin
  // (sole-item semantics are a grid/flex concept; block-like here).
  for (const child of node.children)
    if (isOutOfFlow(child.style))
      child.staticSlot = { kind: "block", x: contentLeft, y: contentTop };

  if (structure.caption && node.style.captionSide === "bottom")
    structure.caption.localRect.y = contentTop + gridBottom;

  if (chrome.collapsed && C > 0 && R > 0)
    node.decorationRuns = buildLatticeRuns(
      chrome,
      structure,
      widths,
      rowHeights,
      colX,
      rowY,
      contentLeft,
      contentTop,
      glyphSetFor(node.style.glyphSet),
    );

  // A top caption is already inside gridBottom (via gridTop).
  return node.style.captionSide === "bottom" ? gridBottom + captionHeight : gridBottom;
}

/** Fold the cell's leftover block-axis space into its content per
 * `vertical-align`: leaves take it as engine-owned padding (the
 * alignLeafText pattern); containers shift their children. */
function alignCellContent(cell: LayoutNode, delta: number): void {
  if (delta <= 0) return;
  const align = cell.style.verticalAlign;
  const offset = align === "center" ? Math.floor(delta / 2) : align === "end" ? delta : 0;
  const hasInFlow = cell.children.some((c) => !isOutOfFlow(c.style) && !c.inlineBox);
  if (!hasInFlow) {
    // The FULL delta lands in padding even at offset 0 (top alignment):
    // the renderers then account for every row of the stretched box.
    cell.resolvedPadding.top += offset;
    cell.resolvedPadding.bottom += delta - offset;
    return;
  }
  if (offset <= 0) return;
  for (const child of cell.children) {
    if (child.inlineBox) continue;
    if (isOutOfFlow(child.style)) {
      if (child.staticSlot?.kind === "block") child.staticSlot.y += offset;
    } else {
      child.localRect.y += offset;
    }
  }
}

// ---------------------------------------------------------------------------
// Lattice painting

function buildLatticeRuns(
  chrome: TableChrome,
  structure: TableStructure,
  widths: number[],
  rowHeights: number[],
  colX: number[],
  rowY: number[],
  contentLeft: number,
  contentTop: number,
  set?: BorderGlyphSet,
): BorderRun[] {
  const C = structure.columnCount;
  const R = structure.rows.length;
  const out: BorderRun[] = [];
  const lineX = (i: number) =>
    i < C ? colX[i]! - chrome.vLines[i]! : colX[C - 1]! + widths[C - 1]!;
  const lineY = (j: number) =>
    j < R ? rowY[j]! - chrome.hLines[j]! : rowY[R - 1]! + rowHeights[R - 1]!;

  // Straight vertical segments.
  for (let i = 0; i <= C; i++) {
    const segments = chrome.vSegments[i]!;
    for (let r = 0; r < R; r++) {
      const seg = segments[r];
      if (!seg) continue;
      // A segment narrower than its line paints from the line's start
      // (CSS centers collapsed borders; sub-cell centering can't).
      const glyph = lineGlyph(seg.style, "v", set);
      for (let t = 0; t < seg.width; t++)
        for (let yy = rowY[r]!; yy < rowY[r]! + rowHeights[r]!; yy++)
          out.push({
            glyph,
            x: contentLeft + lineX(i) + t,
            y: contentTop + yy,
            length: 1,
            color: seg.color,
          });
    }
  }
  // Straight horizontal segments.
  for (let j = 0; j <= R; j++) {
    const segments = chrome.hSegments[j]!;
    for (let c = 0; c < C; c++) {
      const seg = segments[c];
      if (!seg) continue;
      const glyph = lineGlyph(seg.style, "h", set);
      for (let t = 0; t < seg.width; t++)
        out.push({
          glyph,
          x: contentLeft + colX[c]!,
          y: contentTop + lineY(j) + t,
          length: widths[c]!,
          color: seg.color,
        });
    }
  }
  // Junction blocks where a vertical and a horizontal line cross.
  for (let i = 0; i <= C; i++) {
    if (chrome.vLines[i]! <= 0) continue;
    for (let j = 0; j <= R; j++) {
      if (chrome.hLines[j]! <= 0) continue;
      const up = j > 0 ? chrome.vSegments[i]![j - 1] : null;
      const down = j < R ? chrome.vSegments[i]![j] : null;
      const left = i > 0 ? chrome.hSegments[j]![i - 1] : null;
      const right = i < C ? chrome.hSegments[j]![i] : null;
      const arms = [up, down, left, right].filter((s): s is LatticeSegment => s !== null);
      if (arms.length === 0) continue;
      // Junction style: double only when every arm is double (the corner
      // convention); color from the dominant arm.
      const style: BorderStyle = arms.every((s) => s.style === "double") ? "double" : "solid";
      const dominant = arms.reduce((a, b) =>
        b.width > a.width || (b.width === a.width && STYLE_RANK[b.style] > STYLE_RANK[a.style])
          ? b
          : a,
      );
      const glyph = junctionGlyph(
        style,
        up !== null,
        down !== null,
        left !== null,
        right !== null,
        set,
      );
      // Thick lines fill the whole crossing block with the junction glyph.
      for (let t = 0; t < chrome.vLines[i]!; t++)
        for (let u = 0; u < chrome.hLines[j]!; u++)
          out.push({
            glyph,
            x: contentLeft + lineX(i) + t,
            y: contentTop + lineY(j) + u,
            length: 1,
            color: dominant.color,
          });
    }
  }
  return out;
}
