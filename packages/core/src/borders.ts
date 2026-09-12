import {
  DOUBLE_JUNCTIONS,
  LIGHT_JUNCTIONS,
  cornerGlyph,
  glyphSetFor,
  junctionRole,
  shadowRamp,
} from "./glyphs.ts";
import type { BorderGlyphSet } from "./glyphs.ts";
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
    // A ring inside loses a cell of radius, as CSS's inner edge does.
    const radii = {
      tl: Math.max(0, style.borderRadius.tl - ring),
      tr: Math.max(0, style.borderRadius.tr - ring),
      bl: Math.max(0, style.borderRadius.bl - ring),
      br: Math.max(0, style.borderRadius.br - ring),
    };
    paintRing(
      out,
      style.borderStyle,
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

/** A computed color's alpha: a modern function's `/ a`, the fourth
 * component of `rgba()`/`hsla()`, `transparent` 0, anything else 1. */
function colorAlpha(color: string): number {
  const value = color.trim().toLowerCase();
  if (value === "transparent") return 0;
  const part = (text: string): number => {
    const amount = parseFloat(text);
    if (!Number.isFinite(amount)) return 1;
    return Math.min(1, Math.max(0, text.trim().endsWith("%") ? amount / 100 : amount));
  };
  const slash = /\/\s*([\d.]+%?)\s*\)$/.exec(value);
  if (slash) return part(slash[1]!);
  const legacy = /^(?:rgba|hsla)\(([^)]*)\)$/.exec(value);
  if (!legacy) return 1;
  const components = legacy[1]!.split(",");
  return components.length === 4 ? part(components[3]!) : 1;
}

/**
 * Paint one ring, honoring per-side styles and colors. Each edge uses its
 * own style's glyphs. A corner where both adjacent edges share a style uses
 * that style's corner glyph; mixed-style corners fall back to the light
 * corners (Unicode has no mixed junction glyphs for most pairs — same
 * convention as dashed/dotted). Corner color comes from the horizontal
 * (top/bottom) edge. A corner's radius picks its glyph (cornerGlyph).
 */
function paintRing(
  out: BorderRun[],
  styles: PerSide<BorderStyle>,
  colors: PerSide<string | undefined>,
  radii: Record<CornerRole, number>,
  rect: Rect,
  sides: RingSides,
  set?: BorderGlyphSet,
): void {
  const top = borderGlyphs(styles.top, set);
  const right = borderGlyphs(styles.right, set);
  const bottom = borderGlyphs(styles.bottom, set);
  const left = borderGlyphs(styles.left, set);
  const corner = (a: BorderStyle, b: BorderStyle, role: CornerRole): string => {
    const style = a === b ? a : "solid";
    return cornerGlyph(style, role, radii[role], borderGlyphs(style, set)[role], set);
  };
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
        glyph: corner(styles.top, styles.left, "tl"),
        x,
        y,
        length: 1,
        color: colors.top,
      });
    if (sides.top && sides.right)
      out.push({
        glyph: corner(styles.top, styles.right, "tr"),
        x: x + width - 1,
        y,
        length: 1,
        color: colors.top,
      });
    if (sides.bottom && sides.left)
      out.push({
        glyph: corner(styles.bottom, styles.left, "bl"),
        x,
        y: y + height - 1,
        length: 1,
        color: colors.bottom,
      });
    if (sides.bottom && sides.right)
      out.push({
        glyph: corner(styles.bottom, styles.right, "br"),
        x: x + width - 1,
        y: y + height - 1,
        length: 1,
        color: colors.bottom,
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

/** A style's straight line glyph, for lattice segments. */
export function lineGlyph(style: BorderStyle, axis: "h" | "v", set?: BorderGlyphSet): string {
  const glyphs = borderGlyphs(style, set);
  return axis === "h" ? glyphs.h : glyphs.v;
}

/** Junction glyph for a lattice intersection, from which of the four
 * arms exist. `double` has a full junction set; dashed/dotted (and mixed
 * styles, decided by the caller) use the light set — the corner
 * convention (specs/cell-model.md). Stubs (≤1 arm) fall back to plain
 * line glyphs. An active glyph SET (specs/theming.md) overrides PER
 * GLYPH by junction role. */
export function junctionGlyph(
  style: BorderStyle,
  up: boolean,
  down: boolean,
  left: boolean,
  right: boolean,
  set?: BorderGlyphSet,
): string {
  const mask = (up ? 8 : 0) | (down ? 4 : 0) | (left ? 2 : 0) | (right ? 1 : 0);
  if (set) {
    const role = junctionRole(mask);
    const override = role && set[style]?.[role];
    if (override) return override;
  }
  const table = style === "double" ? DOUBLE_JUNCTIONS : LIGHT_JUNCTIONS;
  return table[mask]!;
}

/** Rings are junction special cases: lines are two collinear arms,
 * corners two perpendicular ones. Only dashed/dotted lines need their own
 * glyphs (`╌`/`╎` — the double dash pair reads cleaner than the triple
 * dash, which looks like dots in many fonts; `┄`/`┊` for dotted). Their
 * corners fall back to light via the junction set, as before. */
function borderGlyphs(style: BorderStyle, set?: BorderGlyphSet): Glyphs {
  const j = (up: boolean, down: boolean, left: boolean, right: boolean) =>
    junctionGlyph(style, up, down, left, right, set);
  const base: Glyphs = {
    h: j(false, false, true, true),
    v: j(true, true, false, false),
    tl: j(false, true, false, true),
    tr: j(false, true, true, false),
    bl: j(true, false, false, true),
    br: j(true, false, true, false),
  };
  if (style === "dashed") return { h: "╌", v: "╎", ...withoutLines(base), ...setLines(set, style) };
  if (style === "dotted") return { h: "┄", v: "┊", ...withoutLines(base), ...setLines(set, style) };
  return base;
}

function withoutLines(glyphs: Glyphs): Omit<Glyphs, "h" | "v"> {
  const { h: _h, v: _v, ...rest } = glyphs;
  return rest;
}

function setLines(set: BorderGlyphSet | undefined, style: BorderStyle): Partial<Glyphs> {
  const table = set?.[style];
  const lines: Partial<Glyphs> = {};
  if (table?.h) lines.h = table.h;
  if (table?.v) lines.v = table.v;
  return lines;
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
  /** The owning container's resolved glyph set (specs/theming.md). */
  glyphs?: BorderGlyphSet | undefined;
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
    const glyph = lineGlyph(ctx.ruleX.style, "v", ctx.glyphs);
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
                    ctx.glyphs,
                  )
                : lineGlyph(ctx.ruleY.style, "h", ctx.glyphs),
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
    out.push({
      glyph: junctionGlyph(style, up, down, left, right, ctx.glyphs),
      x,
      y,
      length: 1,
      color,
    });
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
