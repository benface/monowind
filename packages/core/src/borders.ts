import type { BorderStyle, CellStyle, PerSide, Rect } from "./types.ts";

/** One run of identical border glyphs, in absolute cell coordinates. */
export interface BorderRun {
  glyph: string;
  x: number;
  y: number;
  length: number;
  color: string | undefined;
}

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

function borderGlyphs(style: BorderStyle): Glyphs {
  switch (style) {
    case "double":
      return { h: "═", v: "║", tl: "╔", tr: "╗", bl: "╚", br: "╝" };
    // Light double dash pair: two dashes per cell, cleaner than the triple
    // dash `┄`/`┆` which reads as dots in many fonts.
    case "dashed":
      return { h: "╌", v: "╎", tl: "┌", tr: "┐", bl: "└", br: "┘" };
    case "dotted":
      return { h: "┄", v: "┊", tl: "┌", tr: "┐", bl: "└", br: "┘" };
    default:
      return { h: "─", v: "│", tl: "┌", tr: "┐", bl: "└", br: "┘" };
  }
}
