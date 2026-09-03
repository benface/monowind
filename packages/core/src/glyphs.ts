import type { BorderStyle } from "./types.ts";

/**
 * Border glyph sets (specs/theming.md): the rendering vocabulary
 * border STYLES resolve through — what the themed "hardware" can
 * draw. Orthogonal to styles: authors keep writing `border-double`;
 * the active set decides its glyphs (`╔═╗`, `+=+`, or a single-line
 * downgrade). Selected per decoration OWNER via the inherited
 * `--mw-border-glyphs` custom property; the property carries only a
 * NAME — tables live here. Fallback is PER GLYPH: a set may override
 * only corners and inherit everything else from the defaults.
 */

/** One style's glyph overrides, by role. Roles cover the engine's
 * full junction vocabulary (lines, four corners, four tees, cross);
 * every field optional. */
export interface GlyphTable {
  h?: string;
  v?: string;
  tl?: string;
  tr?: string;
  bl?: string;
  br?: string;
  /** `┴` — arms up, left, right. */
  teeUp?: string;
  /** `┬` — arms down, left, right. */
  teeDown?: string;
  /** `┤` — arms up, down, left. */
  teeLeft?: string;
  /** `├` — arms up, down, right. */
  teeRight?: string;
  /** `┼` — all four arms. */
  cross?: string;
  /** Scrollbar gutter ink (specs/scrolling.md); defaults `░` / `█`. */
  scrollTrack?: string;
  scrollThumb?: string;
}

export type BorderGlyphSet = Partial<Record<BorderStyle, GlyphTable>>;

const sets = new Map<string, BorderGlyphSet>();
const listeners = new Set<() => void>();

/** Register (or last-wins replace, with a warning) a glyph set.
 * Connected hosts relayout — the shared post-hoc-registration idiom. */
export function registerBorderGlyphs(name: string, set: BorderGlyphSet): void {
  const key = name.toLowerCase().trim();
  if (sets.has(key)) {
    console.warn(`[monowind] registerBorderGlyphs: replacing "${key}" (last registration wins).`);
  }
  sets.set(key, set);
  for (const listener of listeners) listener();
}

/** Resolve a `--mw-border-glyphs` value to a set — once per
 * decoration owner, then passed into the glyph primitives. Unknown or
 * empty names (headless environments read "") mean the built-in
 * defaults. */
export function glyphSetFor(name: string | null | undefined): BorderGlyphSet | undefined {
  if (!name) return undefined;
  return sets.get(name.toLowerCase().trim());
}

/** Host subscription to registrations; returns the unsubscriber. */
export function onGlyphRegistryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The role a junction bitmask (up 8 / down 4 / left 2 / right 1)
 * plays — stubs (≤1 arm per axis alone) read as plain lines. */
export function junctionRole(mask: number): keyof GlyphTable | null {
  switch (mask) {
    case 1:
    case 2:
    case 3:
      return "h";
    case 4:
    case 8:
    case 12:
      return "v";
    case 5:
      return "tl";
    case 6:
      return "tr";
    case 9:
      return "bl";
    case 10:
      return "br";
    case 7:
      return "teeDown";
    case 11:
      return "teeUp";
    case 13:
      return "teeRight";
    case 14:
      return "teeLeft";
    case 15:
      return "cross";
    default:
      return null; // mask 0: no arms
  }
}

/* === Junction tables ================================================== */

// Indexed by the up/down/left/right bitmask (8/4/2/1).
export const LIGHT_JUNCTIONS = [
  " ",
  "─",
  "─",
  "─", // no vertical arm
  "│",
  "┌",
  "┐",
  "┬",
  "│",
  "└",
  "┘",
  "┴",
  "│",
  "├",
  "┤",
  "┼",
];
export const DOUBLE_JUNCTIONS = [
  " ",
  "═",
  "═",
  "═",
  "║",
  "╔",
  "╗",
  "╦",
  "║",
  "╚",
  "╝",
  "╩",
  "║",
  "╠",
  "╣",
  "╬",
];

/** A full role table read off a junction table — first mask wins per
 * role, so every role resolves to its canonical glyph. */
function tableFrom(junctions: readonly string[]): GlyphTable {
  const table: GlyphTable = {};
  for (let mask = 1; mask < 16; mask++) {
    const role = junctionRole(mask);
    if (role && !(role in table)) table[role] = junctions[mask]!;
  }
  return table;
}

/** Every role drawn with one glyph, for sets with no junction geometry. */
const uniformTable = (glyph: string): GlyphTable =>
  tableFrom(Array.from({ length: 16 }, () => glyph));

/* === Built-in sets ==================================================== */

// `default` needs no table — an unresolved set falls through to the
// engine's built-in glyphs everywhere.
registerBorderGlyphs("default", {});

// PETSCII/C64 flavor: solid corners become arcs; everything else keeps
// the defaults (dashed/dotted corners stay square — the arc glyphs
// exist only in the light-solid weight).
registerBorderGlyphs("rounded", {
  solid: { tl: "╭", tr: "╮", bl: "╰", br: "╯" },
});

// Teletype: 7-bit ASCII only. `double` keeps emphasis via `=`.
const asciiTable: GlyphTable = { ...uniformTable("+"), h: "-", v: "|" };
registerBorderGlyphs("ascii", {
  solid: { ...asciiTable, scrollTrack: "|", scrollThumb: "#" },
  double: { ...asciiTable, h: "=" },
  dashed: asciiTable,
  dotted: { ...asciiTable, h: ".", v: ":" },
});

const lightTable = tableFrom(LIGHT_JUNCTIONS);

// DEC/VT-style terminals drew one line style only: double, dashed,
// and dotted all downgrade to solid light lines.
registerBorderGlyphs("single", {
  double: lightTable,
  dashed: lightTable,
  dotted: lightTable,
});

// CP437 hardware: double survives, but the dashed/dotted line glyphs
// don't exist in the codepage (bitmap fonts lack them — a fallback
// font would break the grid), so they downgrade to solid.
registerBorderGlyphs("cp437", { dashed: lightTable, dotted: lightTable });

/** Gutter ink through the owner's set — solid-table roles, defaults
 * `░` / `█` (specs/scrolling.md). */
export function scrollGlyphs(set: BorderGlyphSet | undefined): { track: string; thumb: string } {
  return {
    track: set?.solid?.scrollTrack ?? "\u2591",
    thumb: set?.solid?.scrollThumb ?? "\u2588",
  };
}

// BBS/ANSI-art flavor: CP437 blocks, styles mapped to shade density.
registerBorderGlyphs("blocks", {
  solid: uniformTable("█"),
  double: uniformTable("█"),
  dashed: uniformTable("▒"),
  dotted: uniformTable("░"),
});
