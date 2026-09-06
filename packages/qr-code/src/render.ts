import type { BorderGlyphSet } from "monowind";
import encodeQR from "qr";

/**
 * A QR code as grid rows (specs/qr-code.md): the module matrix from
 * the encoder, scaled, then packed into cells by the font's aspect —
 * half blocks where a cell is twice as tall as wide (repeated across
 * cells for taller ones), one full block per module where cells are
 * square, stacked where they are wider than tall. Pure and DOM-free.
 */

export type Level = "L" | "M" | "Q" | "H";
/** A cell's height over its width, snapped to a packing: `2k` (half
 * blocks, `k` cells per module), `1` (a full block per module), or
 * `1 / m` (one column, `m` rows per module). */
export type Aspect = number;

/** The module glyphs a glyph set provides: a full cell, and the two
 * halves when it has them (specs/qr-code.md "Glyphs through the
 * registry"). */
export interface QrGlyphs {
  full: string;
  upper?: string;
  lower?: string;
}

export const DEFAULT_GLYPHS: QrGlyphs = { full: "█", upper: "▀", lower: "▄" };

const ECC = { L: "low", M: "medium", Q: "quartile", H: "high" } as const;
export const LEVELS: readonly Level[] = ["L", "M", "Q", "H"];

export interface Encoded {
  /** `modules[y][x]`, true for a dark module. */
  modules: boolean[][];
  version: number;
  /** The level actually used — the requested one, or a higher one the
   * chosen version had room for. */
  level: Level;
}

/** The borderless matrix, or null when the value overflows: the
 * encoder adds a border of at least one module around the symbol, so
 * one is asked for and sliced off. */
function modulesAt(value: string, level: Level, version?: number): boolean[][] | null {
  try {
    const bordered = encodeQR(value, "raw", { ecc: ECC[level], border: 1, version });
    return bordered.slice(1, -1).map((row) => row.slice(1, -1));
  } catch (error) {
    if (error instanceof Error && error.message === "Capacity overflow") return null;
    throw error;
  }
}

/** Encode `value` at the smallest version that holds it at `level`,
 * then raise the level as far as that version allows; null when
 * nothing up to version 40 holds it. */
export function encode(value: string, level: Level): Encoded | null {
  let modules = modulesAt(value, level);
  if (!modules) return null;
  const version = (modules.length - 17) / 4;
  let used = level;
  for (const higher of LEVELS.slice(LEVELS.indexOf(level) + 1).reverse()) {
    const boosted = modulesAt(value, higher, version);
    if (boosted) {
      modules = boosted;
      used = higher;
      break;
    }
  }
  return { modules, version, level: used };
}

/** Every module repeated `n × n`. */
export function scaleUp(modules: boolean[][], n: number): boolean[][] {
  if (n === 1) return modules;
  const rows: boolean[][] = [];
  for (const row of modules) {
    const wide = row.flatMap((dark) => Array.from({ length: n }, () => dark));
    for (let i = 0; i < n; i++) rows.push(wide);
  }
  return rows;
}

/** A cell's measured height over width, snapped to the nearest
 * packing: half blocks `round(ratio / 2)` cells wide from 1.5 up, a
 * full block between, `round(1 / ratio)` full blocks tall from 0.75
 * down. */
export function snapAspect(ratio: number): Aspect {
  if (ratio >= 1.5) return 2 * Math.max(1, Math.round(ratio / 2));
  if (ratio <= 0.75) return 1 / Math.max(2, Math.round(1 / ratio));
  return 1;
}

/** The module glyphs of a set: each role falls back to its default;
 * halves exist when the set declares both or neither, so a set that
 * declares `qrFull` alone has none. */
export function resolveGlyphs(set: BorderGlyphSet | undefined): QrGlyphs {
  const solid = set?.solid;
  const full = solid?.qrFull ?? DEFAULT_GLYPHS.full;
  if (solid?.qrUpper && solid.qrLower) return { full, upper: solid.qrUpper, lower: solid.qrLower };
  if (!solid?.qrFull && !solid?.qrUpper && !solid?.qrLower) return { ...DEFAULT_GLYPHS };
  return { full };
}

/** Pack a (scaled) matrix into rows of cells at a cell aspect (any
 * ratio; snapped). */
export function pack(modules: boolean[][], ratio: number, glyphs: QrGlyphs): string[] {
  const aspect = snapAspect(ratio);
  const rows: string[] = [];
  if (aspect >= 2 && glyphs.upper && glyphs.lower) {
    // Two module rows per cell row, each module `aspect / 2` cells
    // wide; an odd count leaves the last lower half light.
    const columns = aspect / 2;
    for (let y = 0; y < modules.length; y += 2) {
      const top = modules[y]!;
      const bottom = modules[y + 1];
      let row = "";
      for (let x = 0; x < top.length; x++) {
        const up = top[x]!;
        const down = bottom?.[x] ?? false;
        const glyph = up && down ? glyphs.full : up ? glyphs.upper : down ? glyphs.lower : " ";
        row += glyph.repeat(columns);
      }
      rows.push(row);
    }
    return rows;
  }
  // Full blocks: a module `aspect` cells wide above 1, `1 / aspect`
  // rows tall below.
  const columns = aspect >= 1 ? aspect : 1;
  const tall = aspect < 1 ? Math.round(1 / aspect) : 1;
  const dark = glyphs.full.repeat(columns);
  const light = " ".repeat(columns);
  for (const moduleRow of modules) {
    const row = moduleRow.map((on) => (on ? dark : light)).join("");
    for (let i = 0; i < tall; i++) rows.push(row);
  }
  return rows;
}

export interface RenderOptions {
  level: Level;
  scale: number;
  /** The cell's height over its width, any ratio. */
  aspect: number;
  glyphs: QrGlyphs;
}

/** The whole pipeline: rows for `value` (the bare symbol — its quiet
 * zone is the element's padding), or null when it does not fit. */
export function renderQr(value: string, options: RenderOptions): string[] | null {
  const encoded = encode(value, options.level);
  if (!encoded) return null;
  return pack(scaleUp(encoded.modules, options.scale), options.aspect, options.glyphs);
}
