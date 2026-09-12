import type { BorderStyle, CornerRole } from "./types.ts";

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
  /** QR modules (specs/qr-code.md): a full cell, its upper half, its
   * lower half — `█ ▀ ▄` by default. A set naming `qrFull` without
   * both halves has no half blocks: its modules are full cells, two
   * per module at the usual cell. */
  qrFull?: string;
  qrUpper?: string;
  qrLower?: string;
  /** Shadow shades from a box's shadow core outward (specs/box-shadow.md);
   * `█ ▓ ▒ ░` by default. */
  shadow?: string[];
  /** Corner glyphs by border radius (specs/cell-model.md "Borders:
   * glyph mapping"): a corner draws the registration nearest its
   * radius, the plain corner counting at 0. Registering `rounded`
   * (even empty) or a plain corner replaces the defaults' arcs. */
  rounded?: CornerBand[];
}

/** Corner glyphs registered for a radius, in cells; every corner
 * optional. */
export interface CornerBand {
  radius: number;
  tl?: string;
  tr?: string;
  bl?: string;
  br?: string;
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

/** The defaults' arcs: the light-line styles round from half a cell. */
const ARCS: CornerBand = { radius: 1, tl: "╭", tr: "╮", bl: "╰", br: "╯" };
const DEFAULT_BANDS: Partial<Record<BorderStyle, CornerBand[]>> = {
  solid: [ARCS],
  dashed: [ARCS],
  dotted: [ARCS],
};

/** A corner's glyph for its radius: the registration nearest it,
 * ties to the larger radius — `plain` at 0, and the set's `rounded`
 * bands, or the defaults' for a style the set leaves untouched. */
export function cornerGlyph(
  style: BorderStyle,
  role: CornerRole,
  radius: number,
  plain: string,
  set?: BorderGlyphSet,
): string {
  const table = set?.[style];
  const bands = table?.rounded ?? (table?.[role] === undefined ? (DEFAULT_BANDS[style] ?? []) : []);
  let best = { radius: 0, glyph: plain };
  for (const band of bands) {
    const glyph = band[role];
    if (glyph === undefined) continue;
    const gap = Math.abs(band.radius - radius);
    const bestGap = Math.abs(best.radius - radius);
    if (gap < bestGap || (gap === bestGap && band.radius > best.radius)) {
      best = { radius: band.radius, glyph };
    }
  }
  return best.glyph;
}

/** A table's glyph roles: every field but the corner bands and the
 * shadow ramp. */
export type GlyphRole = Exclude<keyof GlyphTable, "rounded" | "shadow">;

/** The role a junction bitmask (up 8 / down 4 / left 2 / right 1)
 * plays — stubs (≤1 arm per axis alone) read as plain lines. */
export function junctionRole(mask: number): GlyphRole | null {
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
  solid: { ...asciiTable, scrollTrack: "|", scrollThumb: "#", shadow: ["#", "+", ":", "."] },
  double: { ...asciiTable, h: "=" },
  dashed: asciiTable,
  dotted: { ...asciiTable, h: ".", v: ":" },
});

const lightTable = tableFrom(LIGHT_JUNCTIONS);

// DEC/VT-style terminals drew one line style only: double, dashed,
// and dotted all downgrade to solid light lines — and no arcs, so
// corners stay square at any radius (the VGA font the amber and
// phosphor themes pair it with has none either).
registerBorderGlyphs("single", {
  solid: { rounded: [] },
  double: lightTable,
  dashed: lightTable,
  dotted: lightTable,
});

// CP437 hardware: double survives, but the dashed/dotted line glyphs
// don't exist in the codepage (bitmap fonts lack them — a fallback
// font would break the grid), so they downgrade to solid; the arcs are
// missing too, so corners stay square at any radius.
registerBorderGlyphs("cp437", { solid: { rounded: [] }, dashed: lightTable, dotted: lightTable });

/** The shade ramp of a box's shadows through the owner's set — a
 * solid-table role, core outward (specs/box-shadow.md). */
export function shadowRamp(set: BorderGlyphSet | undefined): string[] {
  const ramp = set?.solid?.shadow;
  return ramp && ramp.length > 0 ? ramp : ["\u2588", "\u2593", "\u2592", "\u2591"];
}

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
