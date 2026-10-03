/**
 * An image's picture (specs/images.md): its place in its box as
 * `object-fit` and `object-position` give it, its pixels averaged from
 * the source over the area each covers, and its colors reduced to a
 * palette or to levels, dithered; and its alt in its cells. Pure: the
 * paint hands it bitmaps.
 */

import { parseColor, splitTopLevel, srgbOklab } from "./color.ts";
import type { LayoutNode } from "./types.ts";
import { clusterAdvances } from "./width.ts";
import { wrapLines } from "./wrap.ts";

/** An alt as rendered text, its white space collapsed. */
export const altText = (alt: string): string => alt.replace(/\s+/g, " ").trim();

/** An alt's lines in an image's `columns` by `rows` cells
 * (specs/images.md "The light DOM"): wrapped at its words from the top,
 * cut at the last cell. */
export function altLines(alt: string, columns: number, rows: number): string[] {
  const text = altText(alt);
  const lines =
    text && columns > 0 ? wrapLines(text, columns, { advances: clusterAdvances(text) }) : [];
  return Array.from({ length: Math.max(0, rows) }, (_, i) => lines[i] ?? "");
}

/** An image's content box in its cells, from its border box's corner:
 * where its picture and its alt go. */
export function contentCells(node: LayoutNode): {
  x: number;
  y: number;
  columns: number;
  rows: number;
} {
  const { border } = node.style;
  const padding = node.resolvedPadding;
  const x = border.left + padding.left;
  const y = border.top + padding.top;
  return {
    x,
    y,
    columns: node.localRect.width - x - border.right - padding.right,
    rows: node.localRect.height - y - border.bottom - padding.bottom,
  };
}

/** An image's alt in its content box's cells, from its border box's
 * corner: a box's lines from its first row, an inline image's on the row
 * its line's text sits on — what a copy reads there. */
export function altCells(node: LayoutNode): {
  x: number;
  y: number;
  columns: number;
  lines: string[];
} {
  const { x, y: top, columns, rows } = contentCells(node);
  const alt = (node.source as HTMLImageElement).alt;
  if (!node.inlineBox) return { x, y: top, columns, lines: altLines(alt, columns, rows) };
  const y = Math.max(top, Math.min(top + rows - 1, node.inlineTextRow ?? top + rows - 1));
  return { x, y, columns, lines: altLines(alt, columns, 1) };
}

/** RGBA bytes, row by row. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

interface Size {
  width: number;
  height: number;
}

/** A rectangle in px, or in the picture's pixels. */
export interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ObjectFit = "fill" | "contain" | "cover" | "none" | "scale-down";

/** The fit a picture draws with: `fill` as `cover` where its box lies
 * within rounding — half a cell — of the image's ratio, its shape the
 * engine's rather than the author's: rounding never distorts a picture
 * (specs/images.md "The picture"). */
export function pictureFit(fit: ObjectFit, natural: Size, box: Size, cell: Size): ObjectFit {
  if (fit !== "fill") return fit;
  const ratio = natural.width / natural.height;
  const rounded =
    Math.abs(box.height - box.width / ratio) <= cell.height / 2 ||
    Math.abs(box.width - box.height * ratio) <= cell.width / 2;
  return rounded ? "cover" : "fill";
}

/** Where the picture lands in its box (CSS `object-fit` and
 * `object-position`): `own` is its size unscaled, every size in the
 * same unit; the place may overflow the box, which crops it. */
export function placePicture(
  own: Size,
  box: Size,
  fit: ObjectFit,
  position: { x: string; y: string },
): Place {
  let { width, height } = box;
  if (fit !== "fill") {
    const contain = Math.min(box.width / own.width, box.height / own.height);
    const scale =
      fit === "contain"
        ? contain
        : fit === "cover"
          ? Math.max(box.width / own.width, box.height / own.height)
          : fit === "none"
            ? 1
            : Math.min(1, contain);
    width = own.width * scale;
    height = own.height * scale;
  }
  // `+ 0`: a zero offset of a negative free space is no `-0`.
  return {
    x: offset(position.x, box.width - width, "left", "right") + 0,
    y: offset(position.y, box.height - height, "top", "bottom") + 0,
    width,
    height,
  };
}

/** A place in px as the picture's pixels — a column wide, half a row
 * tall — its edges snapped to whole pixels, so no pixel is covered in
 * part: a stray translucent band, at the grid's resolution. */
export function pictureGrid(place: Place, cell: Size): Place {
  const pixel = { width: cell.width, height: cell.height / 2 };
  const x = Math.round(place.x / pixel.width);
  const y = Math.round(place.y / pixel.height);
  return {
    x,
    y,
    width: Math.round((place.x + place.width) / pixel.width) - x,
    height: Math.round((place.y + place.height) / pixel.height) - y,
  };
}

/** One axis of a position, in the forms the engines compute it: a
 * percentage of the free space, px, `calc(P% ± Npx)`, or a keyword with
 * an optional offset from its edge. */
function offset(value: string, free: number, start: string, end: string): number {
  const [keyword, length] = value.trim().split(/\s+(?![^(]*\))/);
  if (keyword === start) return length ? measure(length, free) : 0;
  if (keyword === end) return free - (length ? measure(length, free) : 0);
  if (keyword === "center") return free / 2;
  return measure(value.trim(), free);
}

function measure(value: string, free: number): number {
  const calc = /^calc\(\s*(-?[\d.]+)%\s*([+-])\s*(-?[\d.]+)px\s*\)$/.exec(value);
  if (calc) return (free * Number(calc[1])) / 100 + (calc[2] === "-" ? -1 : 1) * Number(calc[3]);
  if (value.endsWith("%")) return (free * parseFloat(value)) / 100;
  return parseFloat(value) || 0;
}

/** A computed `object-position` as its two axes, a keyword kept with
 * its offset. */
export function splitPosition(value: string): { x: string; y: string } {
  const tokens = splitTopLevel(value, " ").filter(Boolean);
  const groups: string[] = [];
  for (const token of tokens) {
    const previous = groups[groups.length - 1];
    if (previous && /^(left|right|top|bottom)$/.test(previous) && !/^[a-z]/.test(token)) {
      groups[groups.length - 1] = `${previous} ${token}`;
    } else groups.push(token);
  }
  const [first = "50%", second = "50%"] = groups;
  return /^(top|bottom)/.test(first) ? { x: second, y: first } : { x: first, y: second };
}

/** Each source pixel a target pixel draws from on one axis. */
interface Span {
  start: number;
  weights: number[];
}

function spans(
  targetSize: number,
  placeStart: number,
  placeSize: number,
  sourceSize: number,
): Span[] {
  const result: Span[] = [];
  const scale = sourceSize / placeSize;
  for (let i = 0; i < targetSize; i++) {
    const from = Math.max(i, placeStart);
    const to = Math.min(i + 1, placeStart + placeSize);
    if (to <= from) {
      result.push({ start: 0, weights: [] });
      continue;
    }
    const sourceFrom = (from - placeStart) * scale;
    const sourceTo = (to - placeStart) * scale;
    const start = Math.max(0, Math.floor(sourceFrom));
    const end = Math.min(sourceSize, Math.ceil(sourceTo));
    const weights: number[] = [];
    for (let k = start; k < end; k++) {
      weights.push(Math.min(k + 1, sourceTo) - Math.max(k, sourceFrom));
    }
    result.push({ start, weights });
  }
  return result;
}

/** The picture's pixels: each the average of the source area it covers
 * at `place` (in the picture's pixels, whole, as `pictureGrid` snaps
 * them), alpha-weighted; transparent where the place leaves it. */
export function samplePicture(source: Bitmap, size: Size, place: Place): Bitmap {
  const columns = spans(size.width, place.x, place.width, source.width);
  const rows = spans(size.height, place.y, place.height, source.height);
  const { data } = source;
  // Across first: each source row's premultiplied sums per column.
  const firstRow = rows.find((row) => row.weights.length > 0)?.start ?? 0;
  const lastRow = rows.reduce((last, row) => Math.max(last, row.start + row.weights.length), 0);
  const across = new Float64Array(Math.max(0, lastRow - firstRow) * size.width * 4);
  for (let y = firstRow; y < lastRow; y++) {
    for (let i = 0; i < size.width; i++) {
      const { start, weights } = columns[i]!;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < weights.length; k++) {
        const from = (y * source.width + start + k) * 4;
        const weight = weights[k]! * data[from + 3]!;
        r += data[from]! * weight;
        g += data[from + 1]! * weight;
        b += data[from + 2]! * weight;
        a += weight;
      }
      const at = ((y - firstRow) * size.width + i) * 4;
      across[at] = r;
      across[at + 1] = g;
      across[at + 2] = b;
      across[at + 3] = a;
    }
  }
  const sum = (weights: number[]): number => weights.reduce((total, weight) => total + weight, 0);
  const columnWeights = columns.map((column) => sum(column.weights));
  const out = new Uint8ClampedArray(size.width * size.height * 4);
  for (let j = 0; j < size.height; j++) {
    const row = rows[j]!;
    const rowWeight = sum(row.weights);
    for (let i = 0; i < size.width; i++) {
      const area = rowWeight * columnWeights[i]!;
      if (area === 0) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < row.weights.length; k++) {
        const at = ((row.start + k - firstRow) * size.width + i) * 4;
        const weight = row.weights[k]!;
        r += across[at]! * weight;
        g += across[at + 1]! * weight;
        b += across[at + 2]! * weight;
        a += across[at + 3]! * weight;
      }
      const target = (j * size.width + i) * 4;
      if (a > 0) {
        out[target] = r / a;
        out[target + 1] = g / a;
        out[target + 2] = b / a;
      }
      out[target + 3] = a / area;
    }
  }
  return { width: size.width, height: size.height, data: out };
}

type Dither = "ordered" | "diffusion" | "none";

/** How a picture's colors are reduced: to a palette (matched by
 * lightness alone for a monochrome theme's), to levels per channel,
 * or both, levels first; the last of them dithered. */
export interface ImageColor {
  palette: { colors: [number, number, number][]; lightness: boolean } | null;
  levels: number | null;
  dither: Dither;
}

/** The color reduction the inherited properties ask for, as computed —
 * the palette's colors serialized by the browser, whatever the author
 * wrote — null where they ask for none: full color. */
export function readImageColor(values: {
  palette: string;
  match: string;
  levels: string;
  dither: string;
}): ImageColor | null {
  const lightness = values.match.trim() === "lightness";
  const colors = splitTopLevel(values.palette.trim(), " ").flatMap((token) => {
    const rgba = parseColor(token);
    return rgba ? [[rgba.r * 255, rgba.g * 255, rgba.b * 255] as [number, number, number]] : [];
  });
  const levels = Math.round(Number(values.levels));
  const palette = colors.length > 0 ? { colors, lightness } : null;
  const steps = Number.isFinite(levels) && levels >= 2 ? levels : null;
  if (!palette && !steps) return null;
  const dither = values.dither.trim();
  return {
    palette,
    levels: steps,
    dither: dither === "none" || dither === "diffusion" ? dither : "ordered",
  };
}

/** A 4×4 Bayer matrix's thresholds, centered on zero. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (v) => (v + 0.5) / 16 - 0.5,
);

const posterize = (value: number, step: number): number =>
  Math.min(255, Math.max(0, Math.round(value / step) * step));

/** A palette's nearest color to a pixel: by OKLab distance, or by its
 * lightness alone. */
function matcher(palette: NonNullable<ImageColor["palette"]>) {
  const labs = palette.colors.map(([r, g, b]) => srgbOklab(r / 255, g / 255, b / 255));
  const lightnesses = labs.map(([L]) => L).sort((a, b) => a - b);
  const gaps = lightnesses.slice(1).map((L, i) => L - lightnesses[i]!);
  /** The spread an ordered dither offsets by, a step between
   * neighboring colors: a lightness ramp's average gap, or the average
   * channel step from each color to its nearest. */
  const average = (values: number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const step = (color: readonly number[]): number =>
    Math.min(
      ...palette.colors
        .filter((other) => other !== color)
        .map((other) => Math.max(...other.map((channel, c) => Math.abs(channel - color[c]!)))),
    );
  const spread = palette.lightness
    ? average(gaps)
    : palette.colors.length > 1
      ? average(palette.colors.map(step))
      : 0;
  /** The nearest color, a dither's `offset` shifting the pixel's
   * channels, or its lightness in a lightness match. */
  const nearest = (r: number, g: number, b: number, offset = 0): [number, number, number] => {
    const shift = palette.lightness ? 0 : offset;
    const [L, A, B] = srgbOklab((r + shift) / 255, (g + shift) / 255, (b + shift) / 255);
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < labs.length; i++) {
      const [pL, pA, pB] = labs[i]!;
      const distance = palette.lightness
        ? Math.abs(pL - (L + offset))
        : (pL - L) ** 2 + (pA - A) ** 2 + (pB - B) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return palette.colors[best]!;
  };
  return { nearest, spread };
}

/** The picture's colors reduced in place (its alpha kept): posterized
 * to its levels, then matched to its palette, the last step dithered
 * — ordered, anchored to the picture's own pixels so a redraw never
 * shimmers, or by Floyd–Steinberg's error diffusion. */
export function reducePicture(picture: Bitmap, color: ImageColor): void {
  const { width, height, data } = picture;
  const { palette, levels, dither } = color;
  const step = levels ? 255 / (levels - 1) : 0;
  const level = (value: number): number => (levels ? posterize(value, step) : value);
  const match = palette ? matcher(palette) : null;
  // Diffusion's carried error, per channel.
  const error = dither === "diffusion" ? new Float64Array(width * height * 3) : null;
  const diffuse = (x: number, y: number, share: number, r: number, g: number, b: number): void => {
    if (!error || x < 0 || x >= width || y >= height) return;
    const at = (y * width + x) * 3;
    error[at] = error[at]! + r * share;
    error[at + 1] = error[at + 1]! + g * share;
    error[at + 2] = error[at + 2]! + b * share;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = (y * width + x) * 4;
      // No color, so no error to carry: a bare band or a cut-out's.
      if (data[pixel + 3] === 0) continue;
      const carried = (y * width + x) * 3;
      const threshold = dither === "ordered" ? BAYER[(y % 4) * 4 + (x % 4)]! : 0;
      let r = data[pixel]!;
      let g = data[pixel + 1]!;
      let b = data[pixel + 2]!;
      if (error) {
        r += error[carried]!;
        g += error[carried + 1]!;
        b += error[carried + 2]!;
      }
      let outR: number;
      let outG: number;
      let outB: number;
      if (match) {
        // Levels first, undithered; the palette is the last step.
        const offset = threshold * match.spread;
        [outR, outG, outB] = match.nearest(level(r), level(g), level(b), offset);
      } else {
        const offset = threshold * step;
        outR = posterize(r + offset, step);
        outG = posterize(g + offset, step);
        outB = posterize(b + offset, step);
      }
      if (error) {
        const errorR = r - outR;
        const errorG = g - outG;
        const errorB = b - outB;
        diffuse(x + 1, y, 7 / 16, errorR, errorG, errorB);
        diffuse(x - 1, y + 1, 3 / 16, errorR, errorG, errorB);
        diffuse(x, y + 1, 5 / 16, errorR, errorG, errorB);
        diffuse(x + 1, y + 1, 1 / 16, errorR, errorG, errorB);
      }
      data[pixel] = outR;
      data[pixel + 1] = outG;
      data[pixel + 2] = outB;
    }
  }
}
