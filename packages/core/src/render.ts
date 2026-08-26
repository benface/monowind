import type { CellStyle, Insets, LayoutNode, Rect } from "./types.ts";

/**
 * Write geometry custom properties on each source element and (re)paint the
 * decoration layer. Coordinates on LayoutNode are parent-relative; borders
 * are painted in absolute coordinates so we accumulate the parent origin as
 * we walk.
 */
export function render(root: LayoutNode, decorationLayer: HTMLElement): void {
  const borderRuns: BorderRun[] = [];
  walk(root, 0, 0, borderRuns, true);
  paintDecorations(decorationLayer, borderRuns);
}

function walk(
  node: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  borderRuns: BorderRun[],
  isRoot: boolean,
): void {
  const absX = parentAbsX + node.localRect.x;
  const absY = parentAbsY + node.localRect.y;

  if (!isRoot) {
    positionElement(
      node.source as HTMLElement,
      node.localRect,
      node.style.padding,
      node.style.border,
      node.style.textAlignBlocked,
      node.style.overflow,
    );
  }

  collectBorderRuns(
    node.style,
    { x: absX, y: absY, width: node.localRect.width, height: node.localRect.height },
    borderRuns,
  );

  for (const child of node.children) {
    walk(child, absX, absY, borderRuns, false);
  }
}

function positionElement(
  el: HTMLElement,
  rect: Rect,
  padding: Insets,
  border: Insets,
  textAlignBlocked: boolean,
  overflow: "visible" | "clip",
): void {
  el.setAttribute("data-mw-laid-out", "");
  el.style.setProperty("--mw-x", String(rect.x));
  el.style.setProperty("--mw-y", String(rect.y));
  el.style.setProperty("--mw-w", String(rect.width));
  el.style.setProperty("--mw-h", String(rect.height));
  if (overflow === "clip") el.setAttribute("data-mw-clip", "");
  else el.removeAttribute("data-mw-clip");
  // The browser insets content by border + padding; the engine has already
  // allocated cells for both. We expose them separately so the companion CSS
  // reads naturally, and the CSS sums them into the actual `padding` (since
  // engine border is painted as glyphs, native border-width stays 0).
  el.style.setProperty("--mw-pt", String(padding.top));
  el.style.setProperty("--mw-pr", String(padding.right));
  el.style.setProperty("--mw-pb", String(padding.bottom));
  el.style.setProperty("--mw-pl", String(padding.left));
  el.style.setProperty("--mw-bt", String(border.top));
  el.style.setProperty("--mw-br", String(border.right));
  el.style.setProperty("--mw-bb", String(border.bottom));
  el.style.setProperty("--mw-bl", String(border.left));
  if (textAlignBlocked) el.setAttribute("data-mw-text-align-blocked", "");
  else el.removeAttribute("data-mw-text-align-blocked");
}

interface BorderRun {
  glyph: string;
  x: number;
  y: number;
  length: number;
  color: string | undefined;
}

/**
 * Emit runs of border glyphs for the box's engine-allocated border cells.
 *
 * For multi-cell borders (`border-2`, `border-3`, …) the engine allocates N
 * cells per edge; we render them as N concentric rings, all in the same
 * style. Corners of each ring share the same corner glyph.
 *
 * A single-cell-thin box (width < 2 or height < 2) has no interior; we draw
 * only vertical/horizontal runs and skip corners that would overlap.
 */
function collectBorderRuns(style: CellStyle, box: Rect, out: BorderRun[]): void {
  const border = style.border;
  if (border.top === 0 && border.right === 0 && border.bottom === 0 && border.left === 0) return;
  const glyphs = borderGlyphs(style.borderStyle);
  const color = style.borderColor;
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
    paintRing(out, glyphs, color, ringRect, sides);
  }
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

function paintRing(
  out: BorderRun[],
  glyphs: Glyphs,
  color: string | undefined,
  rect: Rect,
  sides: RingSides,
): void {
  const { x, y, width, height } = rect;
  const hasCorners = width >= 2 && height >= 2;
  const interiorStartX = x + (sides.left ? 1 : 0);
  const interiorEndX = x + width - (sides.right ? 1 : 0);
  const interiorStartY = y + (sides.top ? 1 : 0);
  const interiorEndY = y + height - (sides.bottom ? 1 : 0);

  // Horizontal edges
  if (sides.top && interiorEndX > interiorStartX) {
    out.push({
      glyph: glyphs.h,
      x: interiorStartX,
      y,
      length: interiorEndX - interiorStartX,
      color,
    });
  }
  if (sides.bottom && height > (sides.top ? 1 : 0) && interiorEndX > interiorStartX) {
    out.push({
      glyph: glyphs.h,
      x: interiorStartX,
      y: y + height - 1,
      length: interiorEndX - interiorStartX,
      color,
    });
  }
  // Vertical edges
  if (sides.left) {
    for (let vy = interiorStartY; vy < interiorEndY; vy++)
      out.push({ glyph: glyphs.v, x, y: vy, length: 1, color });
  }
  if (sides.right && width > (sides.left ? 1 : 0)) {
    for (let vy = interiorStartY; vy < interiorEndY; vy++)
      out.push({ glyph: glyphs.v, x: x + width - 1, y: vy, length: 1, color });
  }
  // Corners (only when we have interior room to distinguish them)
  if (hasCorners) {
    if (sides.top && sides.left) out.push({ glyph: glyphs.tl, x, y, length: 1, color });
    if (sides.top && sides.right)
      out.push({ glyph: glyphs.tr, x: x + width - 1, y, length: 1, color });
    if (sides.bottom && sides.left)
      out.push({ glyph: glyphs.bl, x, y: y + height - 1, length: 1, color });
    if (sides.bottom && sides.right)
      out.push({ glyph: glyphs.br, x: x + width - 1, y: y + height - 1, length: 1, color });
  }
}

function borderGlyphs(style: CellStyle["borderStyle"]): Glyphs {
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

function paintDecorations(layer: HTMLElement, runs: BorderRun[]): void {
  layer.replaceChildren();
  for (const run of runs) {
    const span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    span.style.position = "absolute";
    span.style.left = `calc(${run.x} * var(--mw-cw))`;
    span.style.top = `calc(${run.y} * var(--mw-ch))`;
    span.style.font = "inherit";
    span.style.lineHeight = "inherit";
    span.style.whiteSpace = "pre";
    span.style.pointerEvents = "none";
    span.style.userSelect = "none";
    if (run.color) span.style.color = run.color;
    span.textContent = run.glyph.repeat(run.length);
    layer.appendChild(span);
  }
}
