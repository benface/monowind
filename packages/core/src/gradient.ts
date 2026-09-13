/**
 * Gradient backgrounds as a color per cell (specs/gradients.md): each
 * cell of a box takes its layers' color at the cell's center, computed
 * in px from the measured cell so a diagonal is CSS's diagonal, the
 * stops resolved and interpolated as CSS resolves and interpolates
 * them, the layers composited last to first over the plain color.
 */

import {
  alignPair,
  compositeColors,
  mixColors,
  parseColor,
  prepareColor,
  serializeColor,
} from "./color.ts";
import type { Prepared, Rgba } from "./color.ts";
import type { Gradient, GradientLength, GradientPoint, GradientStop } from "./types.ts";

/** The cell's size in px, as measured; a 1:2 cell where none was. */
export interface CellSize {
  width: number;
  height: number;
}
export const DEFAULT_CELL: CellSize = { width: 1, height: 2 };

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** A box's colors, kept with its layers: a paint between layouts (a
 * scroll, a selection) reads the same style, so the same layers, and
 * the box is the same size, so its colors are the last paint's. */
const cache = new WeakMap<Gradient[], { key: string; rows: (string | null)[][] }>();

/** Every cell's color of a `width` × `height` box as `rgb()`: the
 * layers over `under` (the plain background, or none); null where
 * nothing paints. */
export function gradientCells(
  layers: Gradient[],
  under: string | undefined,
  width: number,
  height: number,
  cell: CellSize,
): (string | null)[][] {
  const key = `${under}|${width}|${height}|${cell.width}|${cell.height}`;
  const kept = cache.get(layers);
  if (kept?.key === key) return kept.rows;
  const base = under === undefined ? null : parseColor(under);
  const box = { width: width * cell.width, height: height * cell.height, cell };
  const placed = layers.map((layer) => place(layer, box));
  const rows: (string | null)[][] = [];
  for (let dy = 0; dy < height; dy++) {
    const row: (string | null)[] = [];
    for (let dx = 0; dx < width; dx++) {
      const x = (dx + 0.5) * cell.width;
      const y = (dy + 0.5) * cell.height;
      let color = base ?? TRANSPARENT;
      for (let i = placed.length - 1; i >= 0; i--) {
        color = compositeColors(colorAt(placed[i]!, x, y), color);
      }
      // A clear cell keeps the plain color — as written where it does
      // not parse — or, without one, the fill beneath.
      row.push(color.a === 0 && base === null ? (under ?? null) : serializeColor(color));
    }
    rows.push(row);
  }
  cache.set(layers, { key, rows });
  return rows;
}

interface Box {
  width: number;
  height: number;
  cell: CellSize;
}

/** A stop resolved to its fraction along the gradient, its color
 * prepared for the space, the hint after it as a fraction too, and
 * the pair it mixes with the next stop as — the two readied together
 * (`alignPair`), so a stop can turn one way toward its next and be
 * met another way from its previous. */
interface Resolved {
  color: Prepared;
  at: number;
  hint: number | null;
  pair: { from: Prepared; to: Prepared } | null;
}

/** A layer placed on a box, the same for every cell: its geometry in
 * px and its stops resolved along it, a px position `cells` of the
 * cell width along the line (a radial's ray). */
type Placed = { gradient: Gradient; stops: Resolved[] } & (
  | { kind: "linear"; dx: number; dy: number; length: number; cx: number; cy: number }
  | { kind: "radial"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "conic"; cx: number; cy: number; from: number }
);

function place(gradient: Gradient, box: Box): Placed {
  const cw = box.cell.width;
  if (gradient.kind === "linear") {
    const line = linearLine(gradient, box);
    const stops = resolveStops(gradient, cw / line.length);
    return { gradient, stops, kind: "linear", ...line, cx: box.width / 2, cy: box.height / 2 };
  }
  if (gradient.kind === "radial") {
    const shape = ellipse(gradient, box);
    return { gradient, stops: resolveStops(gradient, cw / shape.rx), kind: "radial", ...shape };
  }
  const { x: cx, y: cy } = point(gradient.at, box);
  return { gradient, stops: resolveStops(gradient, 0), kind: "conic", cx, cy, from: gradient.from };
}

/** A length as px along an axis of the box: a fraction of its extent,
 * or cells of the cell width — a px length, whichever the axis
 * (specs/gradients.md, deviation 1). */
const px = (length: GradientLength, extent: number, box: Box): number =>
  "fraction" in length ? length.fraction * extent : length.cells * box.cell.width;

const point = ({ x, y }: GradientPoint, box: Box): { x: number; y: number } => ({
  x: px(x, box.width, box),
  y: px(y, box.height, box),
});

/** Stops with every position a fraction — a px position `cells`
 * times `perCell`, the fraction one cell spans (0 for a conic, whose
 * positions are angles or percentages): unset ones spread evenly
 * between their neighbours (the ends at 0 and 1), none before an
 * earlier one, as CSS resolves them. */
function resolveStops(gradient: Gradient, perCell: number): Resolved[] {
  const fraction = (value: GradientLength): number =>
    "fraction" in value ? value.fraction : value.cells * perCell;
  const stops: GradientStop[] = gradient.stops;
  const at: (number | null)[] = stops.map((stop) =>
    stop.position === null ? null : fraction(stop.position),
  );
  if (at[0] === null) at[0] = 0;
  if (at[at.length - 1] === null) at[at.length - 1] = 1;
  for (let i = 1; i < at.length; i++) {
    if (at[i] !== null) {
      at[i] = Math.max(at[i]!, at[i - 1]!);
      continue;
    }
    let next = i + 1;
    while (at[next] === null) next++;
    const from = at[i - 1]!;
    const step = (Math.max(at[next]!, from) - from) / (next - i + 1);
    for (let k = i; k < next; k++) at[k] = from + step * (k - i + 1);
  }
  const colors = stops.map((stop) => prepareColor(stop.color, gradient.space));
  const clone = (color: Prepared): Prepared => ({ c: [...color.c], a: color.a });
  return stops.map((stop, i) => {
    const next = colors[i + 1];
    let pair: Resolved["pair"] = null;
    if (next) {
      pair = { from: clone(colors[i]!), to: clone(next) };
      alignPair(pair.from, pair.to, gradient.space, gradient.hue);
    }
    return {
      color: colors[i]!,
      at: at[i]!,
      hint: stop.hint === undefined ? null : fraction(stop.hint),
      pair,
    };
  });
}

/** The color at `t` along the resolved stops: clamped to the ends,
 * tiled for a repeating gradient, eased through a hint. */
function colorAlong(gradient: Gradient, stops: Resolved[], t: number): Rgba {
  const { space } = gradient;
  const own = (stop: Resolved): Rgba => mixColors(stop.color, stop.color, 0, space);
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (gradient.repeating && last.at > first.at) {
    const span = last.at - first.at;
    t = first.at + ((((t - first.at) % span) + span) % span);
  }
  if (t <= first.at) return own(first);
  if (t >= last.at) return own(last);
  let i = 0;
  while (stops[i + 1]!.at < t) i++;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  if (b.at === a.at) return own(b);
  let u = (t - a.at) / (b.at - a.at);
  if (a.hint !== null) {
    const h = Math.min(0.999, Math.max(0.001, (a.hint - a.at) / (b.at - a.at)));
    u = u ** (Math.log(0.5) / Math.log(h));
  }
  return mixColors(a.pair!.from, a.pair!.to, u, space);
}

/** A linear gradient's line: its direction (unit vector) and length,
 * CSS's for the angle and the box — a corner's angle makes the line
 * perpendicular to the box's other diagonal. */
function linearLine(
  gradient: Gradient & { kind: "linear" },
  box: Box,
): { dx: number; dy: number; length: number } {
  const { direction } = gradient;
  let angle: number;
  if ("angle" in direction) angle = direction.angle;
  else {
    const { toX, toY } = direction;
    const corner = (Math.atan2(box.height, box.width) * 180) / Math.PI;
    if (toX === 0) angle = toY < 0 ? 0 : 180;
    else if (toY === 0) angle = toX > 0 ? 90 : 270;
    else if (toX > 0) angle = toY < 0 ? corner : 180 - corner;
    else angle = toY < 0 ? 360 - corner : 180 + corner;
  }
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  return { dx, dy, length: Math.abs(box.width * dx) + Math.abs(box.height * dy) };
}

/** A radial gradient's ending ellipse: its center and radii in px, the
 * sizes CSS names — sides, and corners through the side ellipse's
 * aspect — or explicit lengths. */
function ellipse(
  gradient: Gradient & { kind: "radial" },
  box: Box,
): { cx: number; cy: number; rx: number; ry: number } {
  const { x: cx, y: cy } = point(gradient.at, box);
  const { size } = gradient;
  if (typeof size === "object") {
    return { cx, cy, rx: px(size.rx, box.width, box), ry: px(size.ry, box.height, box) };
  }
  const closest = size.startsWith("closest");
  const pick = closest ? Math.min : Math.max;
  let rx = pick(cx, box.width - cx);
  let ry = pick(cy, box.height - cy);
  if (gradient.shape === "circle") rx = ry = pick(rx, ry);
  if (size.endsWith("corner")) {
    // Through the chosen corner, keeping the side ellipse's aspect.
    const farX = pick(cx, box.width - cx);
    const farY = pick(cy, box.height - cy);
    const k =
      gradient.shape === "circle"
        ? Math.hypot(farX, farY) / rx
        : Math.hypot(farX / (rx || 1), farY / (ry || 1));
    rx *= k;
    ry *= k;
  }
  return { cx, cy, rx: rx || 1, ry: ry || 1 };
}

/** A placed layer's color at a point of the box, in px. */
function colorAt(layer: Placed, x: number, y: number): Rgba {
  let t: number;
  if (layer.kind === "linear") {
    const { dx, dy, length, cx, cy } = layer;
    t = length === 0 ? 0 : ((x - cx) * dx + (y - cy) * dy) / length + 0.5;
  } else if (layer.kind === "radial") {
    const { cx, cy, rx, ry } = layer;
    t = Math.hypot((x - cx) / rx, (y - cy) / ry);
  } else {
    const degrees = (Math.atan2(x - layer.cx, -(y - layer.cy)) * 180) / Math.PI;
    t = ((((degrees - layer.from) % 360) + 360) % 360) / 360;
  }
  return colorAlong(layer.gradient, layer.stops, t);
}
