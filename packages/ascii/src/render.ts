/**
 * Horizontal FIGlet composition: glyphs join under the font's own
 * layout mode — full width, kerning, or smushing (universal, or
 * controlled by the header's rule bits 1–6, per the FIGfont spec).
 * Vertical smushing is out of scope (single-line banners). Per-cell
 * color state from SGR-colored glyphs rides along and comes out as
 * paint runs.
 */

import type { AsciiFont, Glyph } from "./font.ts";
import type { CellColor } from "./sgr.ts";
import type { LeafPaint, LeafRun } from "monowind";

export interface RenderedAscii {
  lines: string[];
  runs: LeafRun[];
}

interface Row {
  chars: string[];
  paints: (CellColor | undefined)[];
}

export function renderAscii(text: string, font: AsciiFont): RenderedAscii {
  const rows: Row[] = Array.from({ length: font.height }, () => ({ chars: [], paints: [] }));
  const missing: Glyph = {
    lines: Array.from({ length: font.height }, () => " "),
    width: 1,
  };
  let first = true;
  for (const ch of text) {
    const glyph = font.glyphs.get(ch.codePointAt(0)!) ?? missing;
    const overlap = first ? 0 : smushAmount(rows, glyph, font);
    merge(rows, glyph, overlap, font);
    first = false;
  }
  const lines = rows.map((row) => row.chars.map((c) => (c === font.hardblank ? " " : c)).join(""));
  return { lines, runs: collectRuns(rows) };
}

/** How far the next glyph slides left: the minimum over rows of
 * (trailing spaces + leading spaces), plus one when the touching pair
 * can smush. */
function smushAmount(rows: Row[], glyph: Glyph, font: AsciiFont): number {
  if (font.layout === "full") return 0;
  let amount = Number.POSITIVE_INFINITY;
  for (let y = 0; y < rows.length; y++) {
    const a = rows[y]!.chars;
    const b = glyph.lines[y] ?? "";
    let trailing = 0;
    while (trailing < a.length && a[a.length - 1 - trailing] === " ") trailing++;
    let leading = 0;
    while (leading < b.length && b.charAt(leading) === " ") leading++;
    let amt = trailing + leading;
    if (font.layout !== "kerning") {
      const c1 = a[a.length - 1 - trailing];
      const c2 = b.charAt(leading);
      if (c1 !== undefined && c2 !== "" && smushem(c1, c2, font) !== null) amt++;
    }
    amount = Math.min(amount, amt);
  }
  return Number.isFinite(amount) ? amount : 0;
}

function merge(rows: Row[], glyph: Glyph, overlap: number, font: AsciiFont): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    const line = glyph.lines[y] ?? "";
    const colors = glyph.colors?.[y];
    const cut = Math.min(overlap, row.chars.length, line.length);
    const base = row.chars.length - cut;
    for (let k = 0; k < cut; k++) {
      const c1 = row.chars[base + k]!;
      const c2 = line.charAt(k);
      const p1 = row.paints[base + k];
      const p2 = colors?.[k];
      if (c1 === " ") {
        row.chars[base + k] = c2;
        row.paints[base + k] = c2 === " " ? p1 : p2;
      } else if (c2 !== " ") {
        const smushed = smushem(c1, c2, font);
        row.chars[base + k] = smushed ?? c2;
        row.paints[base + k] = smushed === c1 ? p1 : p2;
      }
    }
    for (let k = cut; k < line.length; k++) {
      row.chars.push(line.charAt(k));
      row.paints.push(colors?.[k]);
    }
  }
}

/** The smushed character for a touching pair, or null when the pair
 * cannot smush (FIGfont spec, horizontal rules). */
function smushem(c1: string, c2: string, font: AsciiFont): string | null {
  if (c1 === " ") return c2;
  if (c2 === " ") return c1;
  const { hardblank } = font;
  if (font.layout === "smush-universal") {
    // Universal smushing: the later character wins; hardblanks only
    // yield to other hardblanks.
    if (c1 === hardblank || c2 === hardblank) return null;
    return c2;
  }
  const rules = font.rules;
  if (c1 === hardblank || c2 === hardblank) {
    return rules & 32 && c1 === hardblank && c2 === hardblank ? hardblank : null;
  }
  if (rules & 1 && c1 === c2) return c1;
  if (rules & 2) {
    if (c1 === "_" && "|/\\[]{}()<>".includes(c2)) return c2;
    if (c2 === "_" && "|/\\[]{}()<>".includes(c1)) return c1;
  }
  if (rules & 4) {
    const classOf = (c: string) =>
      c === "|"
        ? 1
        : "/\\".includes(c)
          ? 2
          : "[]".includes(c)
            ? 3
            : "{}".includes(c)
              ? 4
              : "()".includes(c)
                ? 5
                : "<>".includes(c)
                  ? 6
                  : 0;
    const k1 = classOf(c1);
    const k2 = classOf(c2);
    if (k1 && k2 && k1 !== k2) return k1 > k2 ? c1 : c2;
  }
  if (rules & 8) {
    const pairs = ["[]", "][", "{}", "}{", "()", ")("];
    if (pairs.includes(c1 + c2)) return "|";
  }
  if (rules & 16) {
    if (c1 === "/" && c2 === "\\") return "|";
    if (c1 === "\\" && c2 === "/") return "Y";
    if (c1 === ">" && c2 === "<") return "X";
  }
  return null;
}

function collectRuns(rows: Row[]): LeafRun[] {
  const runs: LeafRun[] = [];
  rows.forEach((row, line) => {
    let start = -1;
    let current: CellColor | undefined;
    const flush = (end: number) => {
      if (start >= 0 && current) runs.push({ line, start, end, paint: toPaint(current) });
      start = -1;
      current = undefined;
    };
    row.paints.forEach((paint, x) => {
      if (!samePaint(paint, current)) {
        flush(x);
        if (paint) {
          start = x;
          current = paint;
        }
      }
    });
    flush(row.paints.length);
  });
  return runs;
}

function toPaint(color: CellColor): LeafPaint {
  const paint: LeafPaint = {};
  if (color.color) paint.color = color.color;
  if (color.backgroundColor) paint.backgroundColor = color.backgroundColor;
  if (color.bold) paint.fontWeight = "bold";
  return paint;
}

function samePaint(a: CellColor | undefined, b: CellColor | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.color === b.color && a.backgroundColor === b.backgroundColor && a.bold === b.bold;
}
