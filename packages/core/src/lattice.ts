/**
 * A collapsed table's border lattice (specs/table.md), resolved at
 * paint (specs/sticky.md "Table parts stick"): layout's segments are
 * placed with the shift of the row group, row, and cell they belong
 * to — a shared line once per distinct shift, so a part takes its own
 * lines along and its neighbours keep theirs — into an arms map, and
 * each visible cell's glyph comes from what lands on it: a line where
 * one segment runs, a junction where several meet. A part covers what
 * it slid over; parts moving together merge where they meet.
 */

import { junctionGlyph, lineGlyph, paintOrderedChildren } from "./borders.ts";
import type { BorderRun, BorderStyle, LatticeSegment, LayoutNode, TableLattice } from "./types.ts";

export const STYLE_RANK: Record<BorderStyle, number> = {
  double: 3,
  solid: 2,
  dashed: 1,
  dotted: 0,
};

const UP = 8;
const DOWN = 4;
const LEFT = 2;
const RIGHT = 1;

interface Cell {
  x: number;
  y: number;
  mask: number;
  allDouble: boolean;
  dominant: LatticeSegment;
  /** The one segment running through here — a line, not a junction —
   * or null once a second one lands. */
  only: { id: number; axis: "h" | "v" } | null;
  owners: Set<LayoutNode | null>;
}

interface Shift {
  x: number;
  y: number;
}

/** One placement of a segment: the shift of the cells beside it that
 * share it, the parts painting it — for each such cell the innermost
 * sticky-shifted node among the cell, its row, and its row group, or
 * null for the table — and the latest of them in paint order. */
interface Placement {
  shift: Shift;
  owners: (LayoutNode | null)[];
  rank: number;
}

/** The lattice's line coordinates: line `i` starts where column `i`'s
 * left line does (past the last column for `i = C`), line `j` likewise
 * for rows. */
function lineEdges(lattice: TableLattice): {
  lineX: (i: number) => number;
  lineY: (j: number) => number;
} {
  const { vLines, hLines, widths, rowHeights, colX, rowY } = lattice;
  const C = widths.length;
  const R = rowHeights.length;
  return {
    lineX: (i) => (i < C ? colX[i]! - vLines[i]! : colX[C - 1]! + widths[C - 1]!),
    lineY: (j) => (j < R ? rowY[j]! - hLines[j]! : rowY[R - 1]! + rowHeights[R - 1]!),
  };
}

/** What the shifted parts cover. Each part's region is its box, lines
 * included, where it paints now; inside it the part covers what paints
 * before it (`rankOf`, the table's own lattice at -1) and moves
 * differently — parts moving together, the cells of a stuck column or
 * a cell and its stuck row, form one piece and merge where they meet.
 * Regions are indexed by row — a stuck column is one per cell — for
 * the lookup every arm makes. */
function coverage(
  table: LayoutNode,
  lattice: TableLattice,
  { lineX, lineY }: ReturnType<typeof lineEdges>,
): {
  rankOf: (owner: LayoutNode | null) => number;
  coveredAt: (x: number, y: number, rank: number, shift: Shift) => boolean;
} {
  const { vLines, hLines, widths, cells } = lattice;
  const C = widths.length;
  const rank = new Map<LayoutNode, number>();
  const order = (node: LayoutNode): void => {
    rank.set(node, rank.size);
    for (const child of paintOrderedChildren(node)) order(child);
  };
  order(table);
  const rankOf = (owner: LayoutNode | null): number => (owner ? (rank.get(owner) ?? -1) : -1);
  interface Region {
    x0: number;
    x1: number;
    rank: number;
    shift: Shift;
  }
  const byRow = new Map<number, Region[]>();
  const seen = new Set<LayoutNode>();
  for (const row of cells) {
    for (const cell of row) {
      if (!cell) continue;
      const { shift, owner } = placementOf(cell);
      if (!owner || seen.has(owner)) continue;
      seen.add(owner);
      const { r0, r1, c0, c1 } = partExtent(lattice, owner)!;
      const wide = owner.style.tableRole !== "cell";
      const region: Region = {
        x0: lattice.contentLeft + shift.x + (wide ? lineX(0) : lineX(c0)),
        x1:
          lattice.contentLeft +
          shift.x +
          (wide ? lineX(C) + vLines[C]! : lineX(c1 + 1) + vLines[c1 + 1]!),
        rank: rankOf(owner),
        shift,
      };
      const y0 = lattice.contentTop + shift.y + lineY(r0);
      const y1 = lattice.contentTop + shift.y + lineY(r1 + 1) + hLines[r1 + 1]!;
      for (let y = y0; y < y1; y++) {
        const at = byRow.get(y);
        if (at) at.push(region);
        else byRow.set(y, [region]);
      }
    }
  }
  const coveredAt = (x: number, y: number, ownerRank: number, ownerShift: Shift): boolean =>
    byRow
      .get(y)
      ?.some(
        (r) =>
          r.rank > ownerRank &&
          (r.shift.x !== ownerShift.x || r.shift.y !== ownerShift.y) &&
          x >= r.x0 &&
          x < r.x1,
      ) ?? false;
  return { rankOf, coveredAt };
}

/** The lattice's glyph runs, in table-local cells: the table's own, and
 * each shifted part's (for the part's paint step). `visible` says
 * whether a table-local cell reaches the grid. */
export function resolveLattice(
  table: LayoutNode,
  lattice: TableLattice,
  visible: (x: number, y: number) => boolean,
): { runs: BorderRun[]; parts: Map<LayoutNode, BorderRun[]> } {
  const { vLines, hLines, vSegments, hSegments, widths, rowHeights, colX, rowY, cells, set } =
    lattice;
  const C = widths.length;
  const R = rowHeights.length;
  const edges = lineEdges(lattice);
  const { lineX, lineY } = edges;
  const { rankOf, coveredAt } = coverage(table, lattice, edges);
  const map = new Map<number, Cell>();
  let nextId = 0;
  const add = (
    x: number,
    y: number,
    arm: number,
    segment: LatticeSegment,
    id: number,
    axis: "h" | "v" | null,
    { shift, owners, rank }: Placement,
  ): void => {
    x += lattice.contentLeft;
    y += lattice.contentTop;
    if (!visible(x, y)) return;
    // A covered contribution keeps only the arms reaching a visible cell
    // nothing covers — a column line running on below a stuck header.
    // Elsewhere an arm reaches its neighbour as always, into the clip
    // included: a cut line looks cut.
    if (coveredAt(x, y, rank, shift)) {
      const reaches = (nx: number, ny: number) =>
        visible(nx, ny) && !coveredAt(nx, ny, rank, shift);
      if (!reaches(x, y - 1)) arm &= ~UP;
      if (!reaches(x, y + 1)) arm &= ~DOWN;
      if (!reaches(x - 1, y)) arm &= ~LEFT;
      if (!reaches(x + 1, y)) arm &= ~RIGHT;
      if (arm === 0) return;
    }
    // One key per cell; a scrolled table's cells sit at negative x.
    const key = y * 65536 + x + 32768;
    const cell = map.get(key);
    if (!cell) {
      map.set(key, {
        x,
        y,
        mask: arm,
        allDouble: segment.style === "double",
        dominant: segment,
        only: axis ? { id, axis } : null,
        owners: new Set(owners),
      });
      return;
    }
    cell.mask |= arm;
    cell.allDouble &&= segment.style === "double";
    if (
      segment.width > cell.dominant.width ||
      (segment.width === cell.dominant.width &&
        STYLE_RANK[segment.style] > STYLE_RANK[cell.dominant.style])
    ) {
      cell.dominant = segment;
    }
    if (!axis || cell.only?.id !== id) cell.only = null;
    for (const owner of owners) cell.owners.add(owner);
  };
  // The placements a segment gets: one per distinct shift of the cells
  // beside it, with every part that shares it; a shared segment is the
  // later part's for covering, so its own region never covers it.
  const placements = (beside: (LatticeCell | undefined)[]): Placement[] => {
    const out: Placement[] = [];
    for (const cell of beside) {
      if (!cell) continue;
      const { shift, owner } = placementOf(cell);
      const same = out.find((p) => p.shift.x === shift.x && p.shift.y === shift.y);
      if (!same) out.push({ shift, owners: [owner], rank: rankOf(owner) });
      else if (!same.owners.includes(owner)) {
        same.owners.push(owner);
        same.rank = Math.max(same.rank, rankOf(owner));
      }
    }
    return out;
  };

  // Vertical segments: the row's cells, plus a down arm into the junction
  // block above and an up arm into the one below.
  for (let i = 0; i <= C; i++) {
    for (let r = 0; r < R; r++) {
      const seg = vSegments[i]![r];
      if (!seg) continue;
      const segmentId = nextId++;
      for (const placement of placements([cells[r]![i - 1], cells[r]![i]])) {
        const { shift } = placement;
        for (let t = 0; t < seg.width; t++) {
          const x = lineX(i) + t + shift.x;
          for (let y = rowY[r]!; y < rowY[r]! + rowHeights[r]!; y++) {
            add(x, y + shift.y, UP | DOWN, seg, segmentId, "v", placement);
          }
        }
        for (let t = 0; t < vLines[i]!; t++) {
          for (let u = 0; u < hLines[r]!; u++) {
            add(
              lineX(i) + t + shift.x,
              lineY(r) + u + shift.y,
              DOWN,
              seg,
              segmentId,
              null,
              placement,
            );
          }
          for (let u = 0; u < hLines[r + 1]!; u++) {
            add(
              lineX(i) + t + shift.x,
              lineY(r + 1) + u + shift.y,
              UP,
              seg,
              segmentId,
              null,
              placement,
            );
          }
        }
      }
    }
  }
  // Horizontal segments: the column's cells, plus a right arm into the
  // junction block at its start and a left arm into the one at its end.
  for (let j = 0; j <= R; j++) {
    for (let c = 0; c < C; c++) {
      const seg = hSegments[j]![c];
      if (!seg) continue;
      const segmentId = nextId++;
      for (const placement of placements([cells[j - 1]?.[c], cells[j]?.[c]])) {
        const { shift } = placement;
        for (let t = 0; t < seg.width; t++) {
          const y = lineY(j) + t + shift.y;
          for (let x = colX[c]!; x < colX[c]! + widths[c]!; x++) {
            add(x + shift.x, y, LEFT | RIGHT, seg, segmentId, "h", placement);
          }
        }
        for (let u = 0; u < hLines[j]!; u++) {
          for (let t = 0; t < vLines[c]!; t++) {
            add(
              lineX(c) + t + shift.x,
              lineY(j) + u + shift.y,
              RIGHT,
              seg,
              segmentId,
              null,
              placement,
            );
          }
          for (let t = 0; t < vLines[c + 1]!; t++) {
            add(
              lineX(c + 1) + t + shift.x,
              lineY(j) + u + shift.y,
              LEFT,
              seg,
              segmentId,
              null,
              placement,
            );
          }
        }
      }
    }
  }

  const runs: BorderRun[] = [];
  const parts = new Map<LayoutNode, BorderRun[]>();
  for (const cell of map.values()) {
    const glyph = cell.only
      ? lineGlyph(cell.dominant.style, cell.only.axis, set)
      : junctionGlyph(
          cell.allDouble ? "double" : "solid",
          (cell.mask & UP) !== 0,
          (cell.mask & DOWN) !== 0,
          (cell.mask & LEFT) !== 0,
          (cell.mask & RIGHT) !== 0,
          set,
        );
    const run: BorderRun = { glyph, x: cell.x, y: cell.y, length: 1, color: cell.dominant.color };
    for (const owner of cell.owners) {
      if (owner === null) runs.push(run);
      else {
        const own = parts.get(owner);
        if (own) own.push(run);
        else parts.set(owner, [run]);
      }
    }
  }
  return { runs, parts };
}

type LatticeCell = NonNullable<TableLattice["cells"][number][number]>;

/** The grid rows and columns a part covers — a cell's own, a row's or
 * row group's cells' — or null for a part without cells. */
export function partExtent(
  lattice: TableLattice,
  part: LayoutNode,
): { r0: number; r1: number; c0: number; c1: number } | null {
  let r0 = Infinity;
  let r1 = -1;
  let c0 = Infinity;
  let c1 = -1;
  lattice.cells.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell || (cell.node !== part && cell.row !== part && cell.group !== part)) return;
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
    }),
  );
  return r1 < 0 ? null : { r0, r1, c0, c1 };
}

/** A cell's shift — its own, its row's, and its row group's — and the
 * innermost of them that has one, which paints its lines. */
function placementOf(cell: LatticeCell): { shift: Shift; owner: LayoutNode | null } {
  const chain = [cell.node, cell.row, cell.group];
  const shift = { x: 0, y: 0 };
  let owner: LayoutNode | null = null;
  for (const node of chain) {
    if (!node?.stickyShift) continue;
    shift.x += node.stickyShift.x;
    shift.y += node.stickyShift.y;
    owner ??= node;
  }
  return { shift, owner };
}
