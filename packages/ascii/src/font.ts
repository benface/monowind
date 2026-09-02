/**
 * FIGlet `.flf` / TOIlet `.tlf` font parsing — sibling formats, one
 * parser (specs/… see the monowind repo's mono-ascii plan): a header
 * line, comment lines, glyphs for ASCII 32–126, seven code-tagged-by-
 * position German characters, then explicitly code-tagged extras.
 * TLF glyph art may be UTF-8 and may embed SGR color escapes, which
 * parse into per-cell paint instead of glyph cells.
 */

import { parseSgrLine } from "./sgr.ts";
import type { CellColors } from "./sgr.ts";

export interface Glyph {
  /** Glyph rows as plain characters (escapes stripped), equal width. */
  lines: string[];
  /** Per-row, per-cell color state from embedded SGR escapes; absent
   * for uncolored glyphs. */
  colors?: CellColors[];
  width: number;
}

export type HorizontalLayout = "full" | "kerning" | "smush-universal" | "smush-controlled";

export interface AsciiFont {
  height: number;
  baseline: number;
  hardblank: string;
  layout: HorizontalLayout;
  /** Controlled-smushing rule bits 1–6 (FIGfont spec), when layout is
   * smush-controlled. */
  rules: number;
  glyphs: Map<number, Glyph>;
}

/** The seven characters the spec appends after ASCII 32–126, by
 * position: Ä Ö Ü ä ö ü ß. */
const GERMAN_CODES = [196, 214, 220, 228, 246, 252, 223];

const CODE_TAG = /^\s*(-?\d+|-?0[xX][0-9a-fA-F]+|-?0[0-7]+)\b/;

export function parseFont(data: string): AsciiFont {
  const lines = data.split(/\r\n|\r|\n/);
  const header = lines[0] ?? "";
  const magic = header.slice(0, 5);
  if (magic !== "flf2a" && magic !== "tlf2a") {
    throw new Error(`not a figlet/toilet font (magic "${magic}"; zipped fonts must be extracted)`);
  }
  const hardblank = header.charAt(5) || "$";
  const parts = header.slice(6).trim().split(/\s+/).map(Number);
  const [height, baseline, , oldLayout, commentLines] = parts;
  const fullLayout = parts[6];
  if (!height || !Number.isFinite(height)) throw new Error("font header has no height");

  const { layout, rules } = resolveLayout(oldLayout ?? -1, fullLayout);
  const glyphs = new Map<number, Glyph>();
  let at = 1 + (commentLines ?? 0);

  const readGlyph = (): Glyph | null => {
    if (at >= lines.length) return null;
    const raw = lines.slice(at, at + height);
    if (raw.length < height) return null;
    at += height;
    // TOIlet pads glyph lines with spaces AFTER the endmark — trim
    // before detecting (first line's last visible char) and stripping
    // the trailing endmark run.
    const first = raw[0]!.replace(/\s+$/, "");
    const endmark = first.charAt(first.length - 1);
    const parsed = raw.map((line) => {
      const trimmed = line.replace(/\s+$/, "");
      let end = trimmed.length;
      while (end > 0 && trimmed.charAt(end - 1) === endmark) end--;
      return parseSgrLine(trimmed.slice(0, end));
    });
    const width = Math.max(0, ...parsed.map((p) => p.chars.length));
    const glyphLines = parsed.map((p) => p.chars.padEnd(width, " "));
    const colored = parsed.some((p) => p.colors);
    const glyph: Glyph = { lines: glyphLines, width };
    if (colored) glyph.colors = parsed.map((p) => p.colors ?? []);
    return glyph;
  };

  for (let code = 32; code <= 126; code++) {
    const glyph = readGlyph();
    if (!glyph) throw new Error(`font ends inside required character ${code}`);
    glyphs.set(code, glyph);
  }
  // German block: present unless the next line is an explicit code tag
  // (some TLF fonts skip straight to tagged extras or end here).
  if (at < lines.length && lines[at]!.trim() !== "" && !CODE_TAG.test(lines[at]!)) {
    for (const code of GERMAN_CODES) {
      const glyph = readGlyph();
      if (!glyph) break;
      glyphs.set(code, glyph);
    }
  }
  // Code-tagged extras: a tag line (code + comment), then a glyph.
  while (at < lines.length) {
    const tag = lines[at]!;
    const match = CODE_TAG.exec(tag);
    if (!match) break;
    at++;
    const glyph = readGlyph();
    if (!glyph) break;
    const code = Number(match[1]);
    if (Number.isFinite(code) && code >= 0) glyphs.set(code, glyph);
  }

  return { height, baseline: baseline ?? height, hardblank, layout, rules, glyphs };
}

/** FIGfont spec layout resolution: `fullLayout` (when present) has
 * bit 6 = kerning, bit 7 = horizontal smushing, bits 0–5 = the
 * controlled rules; `oldLayout` alone is -1 full width, 0 kerning,
 * >0 controlled smushing with its bits as rules. */
function resolveLayout(
  oldLayout: number,
  fullLayout: number | undefined,
): { layout: HorizontalLayout; rules: number } {
  if (fullLayout !== undefined && Number.isFinite(fullLayout)) {
    if (fullLayout & 128) {
      const rules = fullLayout & 63;
      return rules > 0
        ? { layout: "smush-controlled", rules }
        : { layout: "smush-universal", rules: 0 };
    }
    if (fullLayout & 64) return { layout: "kerning", rules: 0 };
    return { layout: "full", rules: 0 };
  }
  if (oldLayout === -1) return { layout: "full", rules: 0 };
  if (oldLayout === 0) return { layout: "kerning", rules: 0 };
  return { layout: "smush-controlled", rules: oldLayout & 63 };
}
