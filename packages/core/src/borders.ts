import {
  cornerGlyph,
  glyphSetFor,
  JUNCTION_ROLES,
  junctionWeight,
  shadowRamp,
  weightBand,
} from "./glyphs.ts";
import type { BorderGlyphSet } from "./glyphs.ts";
import { colorAlpha } from "./color.ts";
import { contentOrigin } from "./layout.ts";
import { SIDES, zeroInsets } from "./types.ts";
import type {
  RuleBreak,
  RuleVisibilityItems,
  BorderRun,
  BorderStyle,
  CellStyle,
  CornerRole,
  GapRule,
  Insets,
  LayoutNode,
  PerSide,
  Rect,
  Side,
} from "./types.ts";

export type { BorderRun } from "./types.ts";

type RingSides = Record<Side, boolean>;

/** A ring's corners: role, then the sides giving its row (and color) and its column. */
const CORNERS = [
  ["tl", "top", "left"],
  ["tr", "top", "right"],
  ["bl", "bottom", "left"],
  ["br", "bottom", "right"],
] as const;

/** Border glyph runs for the box's border cells: a weight band of N
 * cells (specs/theming.md) paints N concentric rings of the per-side
 * styles, weights and colors (paintRing); a box under 2 cells thin gets
 * straight runs only, no overlapping corners. */
export function collectBorderRuns(style: CellStyle, box: Rect, out: BorderRun[]): void {
  const border = style.border;
  if (border.top === 0 && border.right === 0 && border.bottom === 0 && border.left === 0) return;
  const rings = Math.max(border.top, border.right, border.bottom, border.left);
  for (let ring = 0; ring < rings; ring++) {
    const sides: RingSides = { top: false, right: false, bottom: false, left: false };
    // A ring starts past a thinner edge's cells, which keep their glyphs.
    const inset = zeroInsets();
    for (const side of SIDES) {
      sides[side] = ring < border[side];
      inset[side] = Math.min(ring, border[side]);
    }
    const ringRect = {
      x: box.x + inset.left,
      y: box.y + inset.top,
      width: box.width - inset.left - inset.right,
      height: box.height - inset.top - inset.bottom,
    };
    if (ringRect.width <= 0 || ringRect.height <= 0) continue;
    // A ring inside loses a cell of radius, as CSS's inner edge does.
    const radii = { ...style.borderRadius };
    for (const [role] of CORNERS) radii[role] = Math.max(0, radii[role] - ring);
    paintRing(
      out,
      style.borderStyle,
      style.borderWeight,
      style.borderColor,
      radii,
      ringRect,
      sides,
      glyphSetFor(style.glyphSet),
    );
  }
}

/**
 * Emit a box's shadows (specs/box-shadow.md), `inset` the ones drawn
 * inside the padding box, else the outer ones: each a silhouette in the
 * owner's shade ramp — an outer shadow the border box moved by its
 * offsets and grown by its spread, blurred into `round(blur / 2)` rings
 * fading outward, the cells under the box left out; an inset shadow the
 * padding box less that same rectangle moved inward, its rings fading
 * into the box — the last declared first, so the first paints on top.
 */
export function collectShadowRuns(
  style: CellStyle,
  box: Rect,
  inset: boolean,
  out: BorderRun[],
): void {
  const shadows = style.boxShadow.filter((shadow) => shadow.inset === inset);
  if (shadows.length === 0) return;
  const ramp = shadowRamp(glyphSetFor(style.glyphSet));
  const last = ramp.length - 1;
  const { border } = style;
  const padding = {
    x: box.x + border.left,
    y: box.y + border.top,
    width: box.width - border.left - border.right,
    height: box.height - border.top - border.bottom,
  };
  for (const shadow of shadows.slice().reverse()) {
    // A translucent color: its alpha picks the base shade (a tenth is
    // the second-lightest, leaving blur room to fade), and the ink leans
    // on the theme's foreground by the rest — Tailwind's default, black
    // at a tenth, is the text's shade on any theme.
    const alpha = colorAlpha(shadow.color);
    if (alpha === 0) continue;
    const base = Math.round((1 - Math.sqrt(alpha)) * last);
    const color =
      alpha < 1
        ? `color-mix(in srgb, ${shadow.color} ${Math.round(alpha * 100)}%, var(--mw-fg, canvastext))`
        : shadow.color;
    const rings = Math.max(0, Math.round(shadow.blur / 2));
    // The rings fade from the base to the lightest glyph at the edge, and
    // in ink toward transparent — a level per ring, the core the last.
    const levels = Array.from({ length: rings + 1 }, (_, depth) => {
      if (depth === rings) return { glyph: ramp[base]!, color };
      const index = base + Math.round(((rings - depth) * (last - base)) / rings);
      const fade = Math.round((100 * (depth + 1)) / (rings + 1));
      return { glyph: ramp[index]!, color: `color-mix(in srgb, ${color} ${fade}%, transparent)` };
    });
    if (inset) {
      // The lit rectangle: the padding box moved by the offsets and shrunk
      // by the spread; the shadow is the padding box around it, fading
      // into it over the rings.
      const lit = {
        x0: padding.x + shadow.x + shadow.spread,
        y0: padding.y + shadow.y + shadow.spread,
        x1: padding.x + shadow.x + padding.width - shadow.spread,
        y1: padding.y + shadow.y + padding.height - shadow.spread,
      };
      for (let y = padding.y; y < padding.y + padding.height; y++) {
        for (let x = padding.x; x < padding.x + padding.width; x++) {
          const inside = Math.min(x - lit.x0, lit.x1 - 1 - x, y - lit.y0, lit.y1 - 1 - y);
          if (inside >= rings) continue;
          const depth = inside < 0 ? rings : rings - 1 - inside;
          out.push({ ...levels[depth]!, x, y, length: 1 });
        }
      }
      continue;
    }
    const grow = shadow.spread + rings;
    const x0 = box.x + shadow.x - grow;
    const y0 = box.y + shadow.y - grow;
    const x1 = box.x + shadow.x + box.width + grow;
    const y1 = box.y + shadow.y + box.height + grow;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const under = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
        if (under) continue;
        const depth = Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y, rings);
        out.push({ ...levels[depth]!, x, y, length: 1 });
      }
    }
  }
}

/** Paint one ring, each edge in its own style and weight. A corner takes
 * the style its edges share, else the light one (Unicode lacks most
 * mixed junctions), the heavier weight (junctionWeight), its radius's
 * glyph (cornerGlyph) and the horizontal edge's color. */
function paintRing(
  out: BorderRun[],
  styles: PerSide<BorderStyle>,
  weights: PerSide<number>,
  colors: PerSide<string | undefined>,
  radii: Record<CornerRole, number>,
  rect: Rect,
  sides: RingSides,
  set?: BorderGlyphSet,
): void {
  const top = weightBand(styles.top, weights.top, set).roles;
  const right = weightBand(styles.right, weights.right, set).roles;
  const bottom = weightBand(styles.bottom, weights.bottom, set).roles;
  const left = weightBand(styles.left, weights.left, set).roles;
  const corner = (a: Side, b: Side, role: CornerRole): string => {
    const style = styles[a] === styles[b] ? styles[a] : "solid";
    const weight = Math.max(
      junctionWeight(styles[a], weights[a], set),
      junctionWeight(styles[b], weights[b], set),
    );
    return cornerGlyph(style, role, radii[role], weightBand(style, weight, set), set);
  };
  const { x, y, width, height } = rect;
  const hasCorners = width >= 2 && height >= 2;
  const interiorStartX = x + (sides.left ? 1 : 0);
  const interiorEndX = x + width - (sides.right ? 1 : 0);
  const interiorStartY = y + (sides.top ? 1 : 0);
  const interiorEndY = y + height - (sides.bottom ? 1 : 0);

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
  if (sides.left) {
    for (let vy = interiorStartY; vy < interiorEndY; vy++)
      out.push({ glyph: left.v, x, y: vy, length: 1, color: colors.left });
  }
  if (sides.right && width > (sides.left ? 1 : 0)) {
    for (let vy = interiorStartY; vy < interiorEndY; vy++)
      out.push({ glyph: right.v, x: x + width - 1, y: vy, length: 1, color: colors.right });
  }
  // Corners (only when we have interior room to distinguish them)
  if (!hasCorners) return;
  for (const [role, row, column] of CORNERS) {
    if (!sides[row] || !sides[column]) continue;
    out.push({
      glyph: corner(row, column, role),
      x: column === "left" ? x : x + width - 1,
      y: row === "top" ? y : y + height - 1,
      length: 1,
      color: colors[row],
    });
  }
}

/** Whether the child paints in the positioned step (Appendix E step
 * 8+): positioned elements, and flex/grid items with an explicit
 * z-index (z-index applies there per CSS, but `auto` items paint as
 * normal flow, steps 4-7 — source order only decides among them,
 * never over a positioned sibling). */
export function paintsInPositionedStep(child: LayoutNode, parent: LayoutNode): boolean {
  return (
    child.style.position !== "static" ||
    ((parent.style.display === "flex" || parent.style.display === "grid") &&
      child.style.zIndex !== null)
  );
}

/** Children in paint order (CSS 2.1 Appendix E, sibling stacking
 * only): negative z-index (asc), then non-positioned block, then
 * floats, then non-positioned inline, then positioned with z-index >=
 * 0 or auto (asc, auto counts as 0). Stable within a bucket, so DOM
 * order breaks ties. Bucketed instead of full-sorted so the common
 * case (single bucket, no z-index) is allocation-free. */
export function paintOrderedChildren(node: LayoutNode): LayoutNode[] {
  if (node.children.length <= 1) return node.children;
  let negatives: LayoutNode[] | null = null;
  let blocks: LayoutNode[] | null = null;
  let floats: LayoutNode[] | null = null;
  let inlines: LayoutNode[] | null = null;
  let positioned: LayoutNode[] | null = null;
  for (const child of node.children) {
    if (paintsInPositionedStep(child, node)) {
      if ((child.style.zIndex ?? 0) < 0) (negatives ??= []).push(child);
      else (positioned ??= []).push(child);
    } else if (child.inlineBox) (inlines ??= []).push(child);
    else if (child.style.float !== "none") (floats ??= []).push(child);
    else (blocks ??= []).push(child);
  }
  if (negatives && negatives.length > 1) {
    negatives.sort((a, b) => (a.style.zIndex ?? 0) - (b.style.zIndex ?? 0));
  }
  if (positioned && positioned.length > 1) {
    positioned.sort((a, b) => (a.style.zIndex ?? 0) - (b.style.zIndex ?? 0));
  }
  if (!negatives && blocks && !floats && !inlines && !positioned) return blocks;
  if (!negatives && !blocks && !floats && inlines && !positioned) return inlines;
  if (!negatives && !blocks && !floats && !inlines && positioned) return positioned;
  return [
    ...(negatives ?? []),
    ...(blocks ?? []),
    ...(floats ?? []),
    ...(inlines ?? []),
    ...(positioned ?? []),
  ];
}

/** A style's straight line glyph at a weight (px), for lattice
 * segments and rules. */
export function lineGlyph(
  style: BorderStyle,
  weight: number,
  axis: "h" | "v",
  set?: BorderGlyphSet,
): string {
  return weightBand(style, weight, set).roles[axis];
}

/** Junction glyph for a lattice intersection, from which of the four
 * arms exist, at a weight (px) — the heaviest arm's, decided by the
 * caller. `double` has a full junction set; dashed/dotted (and mixed
 * styles, decided by the caller) use the light set — the corner
 * convention (specs/cell-model.md). Stubs (≤1 arm) fall back to plain
 * line glyphs. An active glyph SET (specs/theming.md) overrides PER
 * GLYPH by junction role. */
export function junctionGlyph(
  style: BorderStyle,
  weight: number,
  up: boolean,
  down: boolean,
  left: boolean,
  right: boolean,
  set?: BorderGlyphSet,
): string {
  const role = JUNCTION_ROLES[(up ? 8 : 0) | (down ? 4 : 0) | (left ? 2 : 0) | (right ? 1 : 0)];
  return role ? weightBand(style, weight, set).roles[role] : " ";
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
 * rule-break, contiguous runs merged — under `overlap-join`, their
 * junction endpoints extended into the crossing gaps, else the empty
 * ones dropped. A numeric rule-inset applies in gapRuleRuns.
 */
export function ruleBandSegments(
  strips: GapStrip[],
  ruleBreak: RuleBreak,
  visibility: RuleVisibilityItems,
  overlapJoin: boolean,
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
  if (overlapJoin) {
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
  return segments.filter((segment) => segment.end > segment.start);
}

/** A flex, grid or multicol container's gap rules as glyph runs
 * (specs/gap-decorations.md), in its resolved box — `contentWidth` and
 * `contentHeight` its content box's, which overflowing tracks pass: its
 * bands' segments, retracted by a numeric rule-inset. */
export function gapRuleRuns(
  node: LayoutNode,
  vertical: RuleSegment[],
  horizontal: RuleSegment[],
  contentWidth: number,
  contentHeight: number,
): BorderRun[] {
  const { style } = node;
  return collectGapRuleRuns({
    glyphs: glyphSetFor(style.glyphSet),
    ruleX: style.ruleX,
    ruleY: style.ruleY,
    vertical: insetSegments(vertical, style.ruleInset),
    horizontal: insetSegments(horizontal, style.ruleInset),
    contentWidth,
    contentHeight,
    border: style.border,
    borderStyle: style.borderStyle,
    borderWeight: style.borderWeight,
    borderColor: style.borderColor,
    padding: node.resolvedPadding,
    origin: contentOrigin(node),
  });
}

/** Segments retracted by a numeric inset at both ends, those it empties
 * dropped. */
function insetSegments(segments: RuleSegment[], inset: number | "overlap-join"): RuleSegment[] {
  if (typeof inset !== "number" || inset <= 0) return segments;
  return segments
    .map((segment) => ({ ...segment, start: segment.start + inset, end: segment.end - inset }))
    .filter((segment) => segment.end > segment.start);
}

interface GapRuleContext {
  ruleX: GapRule | null;
  ruleY: GapRule | null;
  /** Column-gap bands (vertical lines) and row-gap bands (horizontal). */
  vertical: RuleSegment[];
  horizontal: RuleSegment[];
  contentWidth: number;
  contentHeight: number;
  border: Insets;
  borderStyle: PerSide<BorderStyle>;
  /** The border's weight per side (px): a rule tees into it with the
   * heavier of the two (junctionWeight). */
  borderWeight: PerSide<number>;
  borderColor: PerSide<string | undefined>;
  padding: Insets;
  origin: { x: number; y: number };
  /** The owning container's resolved glyph set (specs/theming.md). */
  glyphs?: BorderGlyphSet | undefined;
}

/**
 * Paint gap rules as node-local glyph runs: each rule centers in its
 * band (floor on the leading side), crossings get junction glyphs from
 * their arms, and a rule that reaches the container's innermost border
 * ring joins it (collectRuleBorderJunctions). Mixed styles fall back to
 * the light set; all-double crossings use the double set; a crossing of
 * weights draws the heavier.
 */
function collectGapRuleRuns(ctx: GapRuleContext): BorderRun[] {
  const out: BorderRun[] = [];
  const { x: originX, y: originY } = ctx.origin;
  const placed = (rule: GapRule, segment: RuleSegment) => ({
    line: segment.bandStart + Math.floor((segment.bandSize - rule.width) / 2),
    start: segment.start,
    end: segment.end,
    startHalf: segment.startHalf === true,
    endHalf: segment.endHalf === true,
  });
  const vLines = ctx.ruleX ? ctx.vertical.map((segment) => placed(ctx.ruleX!, segment)) : [];
  const hLines = ctx.ruleY ? ctx.horizontal.map((segment) => placed(ctx.ruleY!, segment)) : [];
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
    const glyph = lineGlyph(ctx.ruleX.style, ctx.ruleX.weight, "v", ctx.glyphs);
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
      collectRuleBorderJunctions(ctx, out, "x", line.line, line.start, line.end);
    }
  }
  if (ctx.ruleY) {
    const allDouble = ctx.ruleY.style === "double" && ctx.ruleX?.style === "double";
    const crossing = Math.max(ctx.ruleY.weight, ctx.ruleX?.weight ?? 0);
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
                    crossing,
                    up,
                    down,
                    inkAtBoundary(hLines, hWidth, y, x),
                    inkAtBoundary(hLines, hWidth, y, x + 1),
                    ctx.glyphs,
                  )
                : lineGlyph(ctx.ruleY.style, ctx.ruleY.weight, "h", ctx.glyphs),
            x: originX + x,
            y: originY + y,
            length: 1,
            color: ctx.ruleY.color,
          });
        }
      }
      collectRuleBorderJunctions(ctx, out, "y", line.line, line.start, line.end);
    }
  }
  return out;
}

/** Join a rule to the container's own innermost border ring where its
 * cells [start, end) reach the ring's straight run — through zero
 * padding, or across the padding over overflowing tracks: a tee where
 * it ends there, a cross where it runs on past, as CSS paints a rule
 * over the border. */
function collectRuleBorderJunctions(
  ctx: GapRuleContext,
  out: BorderRun[],
  axis: "x" | "y",
  line: number,
  start: number,
  end: number,
): void {
  const rule = axis === "x" ? ctx.ruleX! : ctx.ruleY!;
  const { border, padding, origin } = ctx;
  const nodeWidth = origin.x + ctx.contentWidth + padding.right + border.right;
  const nodeHeight = origin.y + ctx.contentHeight + padding.bottom + border.bottom;
  const junction = (
    x: number,
    y: number,
    side: Side,
    up: boolean,
    down: boolean,
    left: boolean,
    right: boolean,
  ) => {
    const style =
      rule.style === "double" && ctx.borderStyle[side] === "double" ? "double" : "solid";
    const weight = Math.max(
      rule.weight,
      junctionWeight(ctx.borderStyle[side], ctx.borderWeight[side], ctx.glyphs),
    );
    out.push({
      glyph: junctionGlyph(style, weight, up, down, left, right, ctx.glyphs),
      x,
      y,
      length: 1,
      color: ctx.borderColor[side],
    });
  };
  // The innermost ring's cells, content-relative.
  if (axis === "x") {
    const top = -padding.top - 1;
    const bottom = ctx.contentHeight + padding.bottom;
    for (let t = 0; t < rule.width; t++) {
      const x = origin.x + line + t;
      if (x < border.left || x >= nodeWidth - border.right) continue;
      if (border.top > 0 && start <= top + 1)
        junction(x, origin.y + top, "top", start < top, true, true, true);
      if (border.bottom > 0 && end >= bottom)
        junction(x, origin.y + bottom, "bottom", true, end > bottom + 1, true, true);
    }
  } else {
    const left = -padding.left - 1;
    const right = ctx.contentWidth + padding.right;
    for (let t = 0; t < rule.width; t++) {
      const y = origin.y + line + t;
      if (y < border.top || y >= nodeHeight - border.bottom) continue;
      if (border.left > 0 && start <= left + 1)
        junction(origin.x + left, y, "left", true, true, start < left, true);
      if (border.right > 0 && end >= right)
        junction(origin.x + right, y, "right", true, true, true, end > right + 1);
    }
  }
}
