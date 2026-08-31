import type {
  RuleBreak,
  RuleVisibilityItems,
  BorderRun,
  BorderStyle,
  CellStyle,
  GapRule,
  Insets,
  LayoutNode,
  PerSide,
  Rect,
} from "./types.ts";

export type { BorderRun } from "./types.ts";

interface Glyphs {
  h: string;
  v: string;
  tl: string;
  tr: string;
  bl: string;
  br: string;
}

interface RingSides {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/**
 * Emit runs of border glyphs for the box's engine-allocated border cells.
 *
 * For multi-cell borders (`border-2`, `border-3`, …) the engine allocates N
 * cells per edge; we render them as N concentric rings. Styles and colors
 * are per-side (see paintRing); every ring repeats them.
 *
 * A single-cell-thin box (width < 2 or height < 2) has no interior; we draw
 * only vertical/horizontal runs and skip corners that would overlap.
 */
export function collectBorderRuns(style: CellStyle, box: Rect, out: BorderRun[]): void {
  const border = style.border;
  if (border.top === 0 && border.right === 0 && border.bottom === 0 && border.left === 0) return;
  const rings = Math.max(border.top, border.right, border.bottom, border.left);
  for (let ring = 0; ring < rings; ring++) {
    const sides = {
      top: ring < border.top,
      right: ring < border.right,
      bottom: ring < border.bottom,
      left: ring < border.left,
    };
    const ringRect = {
      x: box.x + (sides.left ? ring : 0),
      y: box.y + (sides.top ? ring : 0),
      width: box.width - (sides.left ? ring : 0) - (sides.right ? ring : 0),
      height: box.height - (sides.top ? ring : 0) - (sides.bottom ? ring : 0),
    };
    if (ringRect.width <= 0 || ringRect.height <= 0) continue;
    paintRing(out, style.borderStyle, style.borderColor, ringRect, sides);
  }
}

/**
 * Paint one ring, honoring per-side styles and colors. Each edge uses its
 * own style's glyphs. A corner where both adjacent edges share a style uses
 * that style's corner glyph; mixed-style corners fall back to the light
 * corners (Unicode has no mixed junction glyphs for most pairs — same
 * convention as dashed/dotted). Corner color comes from the horizontal
 * (top/bottom) edge.
 */
function paintRing(
  out: BorderRun[],
  styles: PerSide<BorderStyle>,
  colors: PerSide<string | undefined>,
  rect: Rect,
  sides: RingSides,
): void {
  const top = borderGlyphs(styles.top);
  const right = borderGlyphs(styles.right);
  const bottom = borderGlyphs(styles.bottom);
  const left = borderGlyphs(styles.left);
  const corner = (a: BorderStyle, b: BorderStyle, pick: (g: Glyphs) => string): string =>
    a === b ? pick(borderGlyphs(a)) : pick(borderGlyphs("solid"));
  const { x, y, width, height } = rect;
  const hasCorners = width >= 2 && height >= 2;
  const interiorStartX = x + (sides.left ? 1 : 0);
  const interiorEndX = x + width - (sides.right ? 1 : 0);
  const interiorStartY = y + (sides.top ? 1 : 0);
  const interiorEndY = y + height - (sides.bottom ? 1 : 0);

  // Horizontal edges
  if (sides.top && interiorEndX > interiorStartX) {
    out.push({
      glyph: top.h,
      x: interiorStartX,
      y,
      length: interiorEndX - interiorStartX,
      color: colors.top,
    });
  }
  if (sides.bottom && height > (sides.top ? 1 : 0) && interiorEndX > interiorStartX) {
    out.push({
      glyph: bottom.h,
      x: interiorStartX,
      y: y + height - 1,
      length: interiorEndX - interiorStartX,
      color: colors.bottom,
    });
  }
  // Vertical edges
  if (sides.left) {
    for (let vy = interiorStartY; vy < interiorEndY; vy++)
      out.push({ glyph: left.v, x, y: vy, length: 1, color: colors.left });
  }
  if (sides.right && width > (sides.left ? 1 : 0)) {
    for (let vy = interiorStartY; vy < interiorEndY; vy++)
      out.push({ glyph: right.v, x: x + width - 1, y: vy, length: 1, color: colors.right });
  }
  // Corners (only when we have interior room to distinguish them)
  if (hasCorners) {
    if (sides.top && sides.left)
      out.push({
        glyph: corner(styles.top, styles.left, (g) => g.tl),
        x,
        y,
        length: 1,
        color: colors.top,
      });
    if (sides.top && sides.right)
      out.push({
        glyph: corner(styles.top, styles.right, (g) => g.tr),
        x: x + width - 1,
        y,
        length: 1,
        color: colors.top,
      });
    if (sides.bottom && sides.left)
      out.push({
        glyph: corner(styles.bottom, styles.left, (g) => g.bl),
        x,
        y: y + height - 1,
        length: 1,
        color: colors.bottom,
      });
    if (sides.bottom && sides.right)
      out.push({
        glyph: corner(styles.bottom, styles.right, (g) => g.br),
        x: x + width - 1,
        y: y + height - 1,
        length: 1,
        color: colors.bottom,
      });
  }
}

/** Where CSS applies `z-index`: positioned elements and flex/grid
 * items; inert on static block-flow children. */
export function zIndexApplies(child: LayoutNode, parent: LayoutNode): boolean {
  return (
    child.style.position !== "static" ||
    parent.style.display === "flex" ||
    parent.style.display === "grid"
  );
}

/** Children in paint order (CSS 2.1 Appendix E, no floats or stacking
 * contexts — negative z still paints over the parent): non-positioned
 * block, then non-positioned inline, then positioned (asc z-index).
 * Stable within a bucket, so DOM order breaks ties. Bucketed instead
 * of full-sorted so the common case (single bucket, no z-index) is
 * allocation-free. */
export function paintOrderedChildren(node: LayoutNode): LayoutNode[] {
  if (node.children.length <= 1) return node.children;
  let blocks: LayoutNode[] | null = null;
  let inlines: LayoutNode[] | null = null;
  let positioned: LayoutNode[] | null = null;
  for (const child of node.children) {
    if (zIndexApplies(child, node)) (positioned ??= []).push(child);
    else if (child.inlineBox) (inlines ??= []).push(child);
    else (blocks ??= []).push(child);
  }
  if (positioned && positioned.length > 1) {
    positioned.sort((a, b) => (a.style.zIndex ?? 0) - (b.style.zIndex ?? 0));
  }
  if (blocks && !inlines && !positioned) return blocks;
  if (!blocks && inlines && !positioned) return inlines;
  if (!blocks && !inlines && positioned) return positioned;
  return [...(blocks ?? []), ...(inlines ?? []), ...(positioned ?? [])];
}

/** A style's straight line glyph, for lattice segments. */
export function lineGlyph(style: BorderStyle, axis: "h" | "v"): string {
  const glyphs = borderGlyphs(style);
  return axis === "h" ? glyphs.h : glyphs.v;
}

/** Junction glyph for a lattice intersection, from which of the four
 * arms exist. `double` has a full junction set; dashed/dotted (and mixed
 * styles, decided by the caller) use the light set — the corner
 * convention (specs/cell-model.md). Stubs (≤1 arm) fall back to plain
 * line glyphs. */
export function junctionGlyph(
  style: BorderStyle,
  up: boolean,
  down: boolean,
  left: boolean,
  right: boolean,
): string {
  const set = style === "double" ? DOUBLE_JUNCTIONS : LIGHT_JUNCTIONS;
  return set[(up ? 8 : 0) | (down ? 4 : 0) | (left ? 2 : 0) | (right ? 1 : 0)]!;
}

// Indexed by the up/down/left/right bitmask (8/4/2/1).
const LIGHT_JUNCTIONS = [
  " ",
  "─",
  "─",
  "─", // no vertical arm
  "│",
  "┌",
  "┐",
  "┬",
  "│",
  "└",
  "┘",
  "┴",
  "│",
  "├",
  "┤",
  "┼",
];
const DOUBLE_JUNCTIONS = [
  " ",
  "═",
  "═",
  "═",
  "║",
  "╔",
  "╗",
  "╦",
  "║",
  "╚",
  "╝",
  "╩",
  "║",
  "╠",
  "╣",
  "╬",
];

/** Rings are junction special cases: lines are two collinear arms,
 * corners two perpendicular ones. Only dashed/dotted lines need their own
 * glyphs (`╌`/`╎` — the double dash pair reads cleaner than the triple
 * dash, which looks like dots in many fonts; `┄`/`┊` for dotted). Their
 * corners fall back to light via the junction set, as before. */
function borderGlyphs(style: BorderStyle): Glyphs {
  const j = (up: boolean, down: boolean, left: boolean, right: boolean) =>
    junctionGlyph(style, up, down, left, right);
  const base: Glyphs = {
    h: j(false, false, true, true),
    v: j(true, true, false, false),
    tl: j(false, true, false, true),
    tr: j(false, true, true, false),
    bl: j(true, false, false, true),
    br: j(true, false, true, false),
  };
  if (style === "dashed") return { ...base, h: "╌", v: "╎" };
  if (style === "dotted") return { ...base, h: "┄", v: "┊" };
  return base;
}

// ---------------------------------------------------------------------------
// Gap decorations (specs/gap-decorations.md)

/** One gap band a rule may occupy: `bandStart`/`bandSize` across the
 * band's axis (x for a vertical rule), `start`/`end` along it. All in
 * content-box cells. A `half` endpoint is an overlap-join extension
 * tip: its ink reaches only the end cell's centerline, so meeting
 * rules connect there (`┘`) instead of crossing past each other. */
export interface RuleSegment {
  bandStart: number;
  bandSize: number;
  start: number;
  end: number;
  startHalf?: boolean;
  endHalf?: boolean;
}

/** One cross-axis strip of a gap band: the cells beside a crossing
 * track, `[start, end)` along the band, with what borders it. */
export interface GapStrip {
  start: number;
  end: number;
  /** An item spans ACROSS the gap here — the gap doesn't exist. */
  spanned: boolean;
  /** The cells on either side of the gap hold items. */
  beforeOccupied: boolean;
  afterOccupied: boolean;
}

export interface GapSegment {
  start: number;
  end: number;
  startHalf?: boolean;
  endHalf?: boolean;
}

/**
 * Split one gap band into painted segments (specs/gap-decorations.md
 * "Segments", probed in Chromium 151): track strips kept per spanning
 * occupancy and rule-visibility-items, crossing-gap strips joined per
 * rule-break, contiguous runs merged, endpoints retracted by the inset.
 */
export function ruleBandSegments(
  strips: GapStrip[],
  ruleBreak: RuleBreak,
  visibility: RuleVisibilityItems,
  inset: number | "overlap-join",
): GapSegment[] {
  const covered = strips.map((strip) => {
    if (strip.spanned) return false;
    if (visibility === "between") return strip.beforeOccupied && strip.afterOccupied;
    if (visibility === "around") return strip.beforeOccupied || strip.afterOccupied;
    return true; // all — and grid's normal
  });
  const pieces: { start: number; end: number; covered: boolean }[] = [];
  for (let i = 0; i < strips.length; i++) {
    pieces.push({ start: strips[i]!.start, end: strips[i]!.end, covered: covered[i]! });
    if (i + 1 < strips.length) {
      const joined =
        ruleBreak === "intersection"
          ? false
          : ruleBreak === "none"
            ? covered[i]! || covered[i + 1]!
            : covered[i]! && covered[i + 1]!;
      pieces.push({ start: strips[i]!.end, end: strips[i + 1]!.start, covered: joined });
    }
  }
  const segments: GapSegment[] = [];
  for (const piece of pieces) {
    if (!piece.covered) continue;
    const last = segments[segments.length - 1];
    if (last && last.end === piece.start) last.end = piece.end;
    else segments.push({ start: piece.start, end: piece.end });
  }
  if (inset === "overlap-join") {
    // Junction endpoints extend into the crossing gap to its centerline
    // (half the gap plus half the crossing rule, probed — Chromium
    // extends whether or not a crossing rule paints there); segments
    // that run through a crossing don't end at its boundary, so the
    // lookups miss them. Cap endpoints stay put, per the spec.
    const startExtension = new Map<number, number>();
    const endExtension = new Map<number, number>();
    for (let i = 0; i + 1 < strips.length; i++) {
      const crossingStart = strips[i]!.end;
      const width = strips[i + 1]!.start - crossingStart;
      if (width <= 0) continue;
      endExtension.set(crossingStart, crossingStart + Math.ceil(width / 2));
      startExtension.set(strips[i + 1]!.start, crossingStart + Math.floor(width / 2));
    }
    return segments.map((segment) => {
      const start = startExtension.get(segment.start);
      const end = endExtension.get(segment.end);
      return {
        start: start ?? segment.start,
        end: end ?? segment.end,
        startHalf: start !== undefined,
        endHalf: end !== undefined,
      };
    });
  }
  return segments
    .map((segment) => ({ start: segment.start + inset, end: segment.end - inset }))
    .filter((segment) => segment.end > segment.start);
}

export interface GapRuleContext {
  ruleX: GapRule | null;
  ruleY: GapRule | null;
  /** Column-gap bands (vertical lines) and row-gap bands (horizontal). */
  vertical: RuleSegment[];
  horizontal: RuleSegment[];
  contentWidth: number;
  contentHeight: number;
  border: Insets;
  borderStyle: PerSide<BorderStyle>;
  borderColor: PerSide<string | undefined>;
  padding: Insets;
}

/**
 * Paint gap rules as node-local glyph runs: each rule centers in its
 * band (floor on the leading side), crossings get junction glyphs from
 * their arms, and a rule that reaches the content edge through zero
 * padding tees into the container's innermost border ring. Mixed styles
 * fall back to the light set; all-double crossings use the double set.
 */
export function collectGapRuleRuns(ctx: GapRuleContext): BorderRun[] {
  const out: BorderRun[] = [];
  const originX = ctx.border.left + ctx.padding.left;
  const originY = ctx.border.top + ctx.padding.top;
  const placed = (rule: GapRule, seg: RuleSegment) => ({
    line: seg.bandStart + Math.floor((seg.bandSize - rule.width) / 2),
    start: seg.start,
    end: seg.end,
    startHalf: seg.startHalf === true,
    endHalf: seg.endHalf === true,
  });
  const vLines = ctx.ruleX ? ctx.vertical.map((seg) => placed(ctx.ruleX!, seg)) : [];
  const hLines = ctx.ruleY ? ctx.horizontal.map((seg) => placed(ctx.ruleY!, seg)) : [];
  const vWidth = ctx.ruleX?.width ?? 0;
  const hWidth = ctx.ruleY?.width ?? 0;
  /** Junction arms come from INK AT CELL BOUNDARIES over the union of
   * segments: a segment through boundary `b`, or full-ending exactly
   * there — a `half` overlap-join tip stops at its cell's centerline
   * and contributes no arm past it (elbows over crosses). */
  const inkAtBoundary = (lines: typeof vLines, width: number, across: number, b: number): boolean =>
    lines.some(
      (l) =>
        across >= l.line &&
        across < l.line + width &&
        ((l.start < b && l.end > b) ||
          (l.end === b && !l.endHalf) ||
          (l.start === b && !l.startHalf)),
    );
  /** Is the cell inside a horizontal segment? (Those cells belong to
   * the horizontal pass, which paints the junctions — no double glyphs.) */
  const insideHorizontal = (x: number, y: number): boolean =>
    hLines.some((l) => y >= l.line && y < l.line + hWidth && x >= l.start && x < l.end);

  if (ctx.ruleX) {
    const glyph = lineGlyph(ctx.ruleX.style, "v");
    for (const line of vLines) {
      for (let t = 0; t < vWidth; t++)
        for (let y = line.start; y < line.end; y++) {
          if (insideHorizontal(line.line + t, y)) continue;
          out.push({
            glyph,
            x: originX + line.line + t,
            y: originY + y,
            length: 1,
            color: ctx.ruleX.color,
          });
        }
      collectRuleBorderTees(ctx, out, "x", line.line, line.start, line.end);
    }
  }
  if (ctx.ruleY) {
    const allDouble = ctx.ruleY.style === "double" && ctx.ruleX?.style === "double";
    for (const line of hLines) {
      for (let t = 0; t < hWidth; t++) {
        const y = line.line + t;
        for (let x = line.start; x < line.end; x++) {
          const up = inkAtBoundary(vLines, vWidth, x, y);
          const down = inkAtBoundary(vLines, vWidth, x, y + 1);
          out.push({
            glyph:
              up || down
                ? junctionGlyph(
                    allDouble ? "double" : "solid",
                    up,
                    down,
                    inkAtBoundary(hLines, hWidth, y, x),
                    inkAtBoundary(hLines, hWidth, y, x + 1),
                  )
                : lineGlyph(ctx.ruleY.style, "h"),
            x: originX + x,
            y: originY + y,
            length: 1,
            color: ctx.ruleY.color,
          });
        }
      }
      collectRuleBorderTees(ctx, out, "y", line.line, line.start, line.end);
    }
  }
  return out;
}

/** Tee a full-extent rule into the container's own innermost border
 * ring (only through ZERO padding — otherwise they don't touch). */
function collectRuleBorderTees(
  ctx: GapRuleContext,
  out: BorderRun[],
  axis: "x" | "y",
  line: number,
  start: number,
  end: number,
): void {
  const rule = axis === "x" ? ctx.ruleX! : ctx.ruleY!;
  const originX = ctx.border.left + ctx.padding.left;
  const originY = ctx.border.top + ctx.padding.top;
  const nodeWidth = originX + ctx.contentWidth + ctx.padding.right + ctx.border.right;
  const nodeHeight = originY + ctx.contentHeight + ctx.padding.bottom + ctx.border.bottom;
  const tee = (
    x: number,
    y: number,
    borderSide: BorderStyle,
    color: string | undefined,
    up: boolean,
    down: boolean,
    left: boolean,
    right: boolean,
  ) => {
    const style = rule.style === "double" && borderSide === "double" ? "double" : "solid";
    out.push({ glyph: junctionGlyph(style, up, down, left, right), x, y, length: 1, color });
  };
  if (axis === "x") {
    for (let t = 0; t < rule.width; t++) {
      const x = originX + line + t;
      if (start <= 0 && ctx.padding.top === 0 && ctx.border.top > 0)
        tee(
          x,
          ctx.border.top - 1,
          ctx.borderStyle.top,
          ctx.borderColor.top,
          false,
          true,
          true,
          true,
        );
      if (end >= ctx.contentHeight && ctx.padding.bottom === 0 && ctx.border.bottom > 0)
        tee(
          x,
          nodeHeight - ctx.border.bottom,
          ctx.borderStyle.bottom,
          ctx.borderColor.bottom,
          true,
          false,
          true,
          true,
        );
    }
  } else {
    for (let t = 0; t < rule.width; t++) {
      const y = originY + line + t;
      if (start <= 0 && ctx.padding.left === 0 && ctx.border.left > 0)
        tee(
          ctx.border.left - 1,
          y,
          ctx.borderStyle.left,
          ctx.borderColor.left,
          true,
          true,
          false,
          true,
        );
      if (end >= ctx.contentWidth && ctx.padding.right === 0 && ctx.border.right > 0)
        tee(
          nodeWidth - ctx.border.right,
          y,
          ctx.borderStyle.right,
          ctx.borderColor.right,
          true,
          true,
          true,
          false,
        );
    }
  }
}
