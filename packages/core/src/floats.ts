/**
 * Float geometry (specs/float.md): the exclusion rectangles a block
 * container's floats reserve, and the queries block layout makes of
 * them — the usable span for a line box, where the next float lands,
 * and how far `clear` pushes a box down. Pure rect math in the
 * container's CONTENT-box cells; placement and native flow live in
 * layout.ts.
 */

export interface FloatBox {
  /** Margin box, in the container's content-box cells. */
  x: number;
  y: number;
  width: number;
  height: number;
  side: "left" | "right";
}

/** The horizontal span left for a line box of `height` rows at row `y`:
 * past the left floats it overlaps, short of the right ones. */
export function bandAt(
  boxes: FloatBox[],
  contentWidth: number,
  y: number,
  height = 1,
): { x: number; width: number } {
  let left = 0;
  let right = contentWidth;
  for (const box of boxes) {
    if (y + height <= box.y || y >= box.y + box.height) continue;
    if (box.side === "left") left = Math.max(left, box.x + box.width);
    else right = Math.min(right, box.x);
  }
  return { x: left, width: Math.max(0, right - left) };
}

/** Where a float of this margin-box size lands (CSS 2.1 §9.5.1): the
 * first fit from the flow cursor, never above an earlier float's top. */
export function placeFloat(
  boxes: FloatBox[],
  contentWidth: number,
  side: "left" | "right",
  top: number,
  width: number,
  height: number,
): { x: number; y: number } {
  let y = top;
  for (const box of boxes) y = Math.max(y, box.y);
  return firstFit(boxes, contentWidth, side, y, width, height);
}

/** The first row from `top` whose band holds a box of this margin-box
 * size — that row, else the first float bottom below it that does —
 * and the box's x at the band's `side`. A box wider than every band
 * starts at the last candidate's edge and overflows, per CSS. */
export function firstFit(
  boxes: FloatBox[],
  contentWidth: number,
  side: "left" | "right",
  top: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const candidates = [
    top,
    ...boxes.map((box) => box.y + box.height).filter((bottom) => bottom > top),
  ].sort((a, b) => a - b);
  const y =
    candidates.find((row) => bandAt(boxes, contentWidth, row, height).width >= width) ??
    candidates[candidates.length - 1]!;
  const band = bandAt(boxes, contentWidth, y, height);
  return { x: side === "left" ? band.x : Math.max(band.x, band.x + band.width - width), y };
}

/** The row a `clear` box starts at: below the margin boxes of the floats
 * it names, when they reach past the flow cursor. */
export function clearanceBelow(
  boxes: FloatBox[],
  clear: "none" | "left" | "right" | "both",
  y: number,
): number {
  if (clear === "none") return y;
  let cleared = y;
  for (const box of boxes) {
    if (clear !== "both" && box.side !== clear) continue;
    cleared = Math.max(cleared, box.y + box.height);
  }
  return cleared;
}

/** The lowest float bottom, or zero: a container contains its floats
 * (specs/float.md), so its content height reaches here. */
export function floatsBottom(boxes: FloatBox[]): number {
  return clearanceBelow(boxes, "both", 0);
}
