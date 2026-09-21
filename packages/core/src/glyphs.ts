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
  /** Weight bands by `border-width` (specs/theming.md): a border draws
   * the band nearest its width, the plain table at 1px; a table
   * registered for a style brings its own bands (none unless listed),
   * an untouched style the defaults' heavy from 2px. */
  weights?: WeightBand[];
}

/** The roles lines and junctions draw with. */
const LINE_ROLES = [
  "h",
  "v",
  "tl",
  "tr",
  "bl",
  "br",
  "teeUp",
  "teeDown",
  "teeLeft",
  "teeRight",
  "cross",
] as const;
export type LineRole = (typeof LINE_ROLES)[number];
export type LineRoles = Record<LineRole, string>;

/** A weight band: the glyphs a `border-width` draws (per-glyph
 * fallback to the plain table) and its thickness in `cells`, 1
 * unless said — a set without heavy glyphs may draw two rings. */
export interface WeightBand extends Partial<LineRoles> {
  width: number;
  cells?: number;
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

/** Register (or last-wins replace, with a warning) a glyph set, frozen:
 * it is read as registered (weights resolve once per set), so a change
 * is a new registration. Connected hosts relayout — the shared
 * post-hoc-registration idiom. */
export function registerBorderGlyphs(name: string, set: BorderGlyphSet): void {
  const key = name.toLowerCase().trim();
  if (sets.has(key)) {
    console.warn(`[monowind] registerBorderGlyphs: replacing "${key}" (last registration wins).`);
  }
  for (const table of Object.values(set)) {
    for (const bands of Object.values(table)) {
      if (!Array.isArray(bands)) continue;
      for (const band of bands) if (typeof band === "object") Object.freeze(band);
      Object.freeze(bands);
    }
    Object.freeze(table);
  }
  sets.set(key, Object.freeze(set));
  derived.clear();
  derivedNames.clear();
  for (const listener of listeners) listener();
}

/** Resolve a `--mw-border-glyphs` value to a set — once per
 * decoration owner, then passed into the glyph primitives. Unknown or
 * empty names (headless environments read "") mean the built-in
 * defaults. */
export function glyphSetFor(name: string | null | undefined): BorderGlyphSet | undefined {
  if (!name) return undefined;
  return derived.get(name) ?? sets.get(name.toLowerCase().trim());
}

/** Sets derived for the glyphs a font has not got, under keys no CSS
 * ident can spell (a name is trimmed, so a NUL is out of reach), and
 * the name each `(set, missing)` pair resolves to — read once per
 * ELEMENT, so a hit costs no allocation. `registerBorderGlyphs` clears
 * both: a derived set is a copy of one that just changed. */
const derived = new Map<string, BorderGlyphSet>();
const derivedNames = new Map<string, Map<string, string | null>>();

/** The clusters a `--mw-missing-glyphs` value names: a CSS string of
 * the characters the themed font has not got, commas and whitespace
 * free to separate them. */
export function missingGlyphs(value: string | null | undefined): Set<string> {
  const text = (value ?? "").trim().replace(/^["']|["']$/g, "");
  return new Set(Array.from(text).filter((cluster) => !/[\s,]/.test(cluster)));
}

/** The set name a node carries for `name` on a font whose
 * `--mw-missing-glyphs` reads `declared` (specs/theming.md): the name
 * itself where the set draws none of them, else a derived registration
 * `glyphSetFor` resolves like any other, so every call site keeps
 * taking a NAME. */
export function glyphSetNameFor(
  name: string | null,
  declared: string | null | undefined,
): string | null {
  if (!declared) return name;
  const key = name ?? "";
  let names = derivedNames.get(key);
  if (!names) derivedNames.set(key, (names = new Map()));
  const cached = names.get(declared);
  if (cached !== undefined) return cached;
  const missing = missingGlyphs(declared);
  const set = missing.size > 0 ? withoutGlyphs(glyphSetFor(name) ?? {}, missing) : undefined;
  let resolved = name;
  if (set !== undefined) {
    resolved = `${key}\u0000${declared}`;
    derived.set(resolved, set);
  }
  names.set(declared, resolved);
  return resolved;
}

/** A set with every glyph in `missing` dropped, or undefined where it
 * draws none of them. A corner band is REWRITTEN rather than removed:
 * an absent `rounded` inherits the defaults' arcs (`DEFAULT_BANDS`),
 * so the way to say "no arc here" is an empty band list, which is what
 * `cp437` and `single` register by hand. A shadow ramp goes whole —
 * its levels are a sequence, and dropping one shifts the rest. */
function withoutGlyphs(set: BorderGlyphSet, missing: Set<string>): BorderGlyphSet | undefined {
  const out: BorderGlyphSet = {};
  let changed = false;
  const styles = new Set([...Object.keys(set), ...Object.keys(DEFAULT_BANDS)] as BorderStyle[]);
  for (const style of styles) {
    const table = set[style];
    const next: GlyphTable = { ...table };
    for (const [role, glyph] of Object.entries(next)) {
      if (typeof glyph === "string" && missing.has(glyph)) {
        delete next[role as keyof GlyphTable];
        changed = true;
      }
    }
    if (next.shadow?.some((glyph) => missing.has(glyph))) {
      delete next.shadow;
      changed = true;
    }
    if (next.weights) {
      next.weights = next.weights.map((band) => {
        const kept: WeightBand = { ...band };
        for (const [role, glyph] of Object.entries(kept)) {
          if (typeof glyph === "string" && missing.has(glyph)) {
            delete kept[role as keyof LineRoles];
            changed = true;
          }
        }
        return kept;
      });
    }
    // Which bands a corner reaches is cornerGlyph's rule, read on what
    // is LEFT: a role that just lost its glyph starts reaching the
    // defaults' arcs, and dropping those is the point.
    const bands = next.rounded ?? DEFAULT_BANDS[style] ?? [];
    let dropped = false;
    const rounded = bands
      .map((band) => {
        const kept: CornerBand = { radius: band.radius };
        for (const role of ["tl", "tr", "bl", "br"] as const) {
          const glyph = band[role];
          if (glyph === undefined) continue;
          if (!missing.has(glyph)) kept[role] = glyph;
          else if (next.rounded !== undefined || next[role] === undefined) dropped = true;
        }
        return kept;
      })
      .filter((band) => band.tl ?? band.tr ?? band.bl ?? band.br);
    if (dropped) {
      next.rounded = rounded;
      changed = true;
    }
    // Frozen as a registered set is: `glyphSetFor` hands these out too.
    for (const bands of [next.weights, next.rounded]) {
      if (!bands) continue;
      for (const band of bands) Object.freeze(band);
      Object.freeze(bands);
    }
    if (Object.keys(next).length > 0) out[style] = Object.freeze(next);
  }
  return changed ? Object.freeze(out) : undefined;
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
 * ties to the larger radius — the weighted table's corner at 0, and
 * the set's `rounded` bands, or the defaults' for a style the set
 * leaves untouched. A weight band with its own corner draws it at
 * any radius: heavy stays square. */
export function cornerGlyph(
  style: BorderStyle,
  role: CornerRole,
  radius: number,
  weighted: Weighted,
  set?: BorderGlyphSet,
): string {
  const plain = weighted.roles[role];
  if (weighted.band?.[role] !== undefined) return plain;
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

/** The role a junction bitmask (up 8 / down 4 / left 2 / right 1)
 * plays — stubs (≤1 arm per axis alone) read as plain lines. */
export function junctionRole(mask: number): LineRole | null {
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
const LIGHT_JUNCTIONS = [
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
const DOUBLE_JUNCTIONS = [
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
function tableFrom(junctions: readonly string[]): LineRoles {
  const table: Partial<LineRoles> = {};
  for (let mask = 1; mask < 16; mask++) {
    const role = junctionRole(mask);
    if (role && !(role in table)) table[role] = junctions[mask]!;
  }
  return table as LineRoles;
}

/** Every role drawn with one glyph, for sets with no junction geometry. */
const uniformTable = (glyph: string): LineRoles =>
  tableFrom(Array.from({ length: 16 }, () => glyph));

const HEAVY_JUNCTIONS = [
  " ",
  "━",
  "━",
  "━",
  "┃",
  "┏",
  "┓",
  "┳",
  "┃",
  "┗",
  "┛",
  "┻",
  "┃",
  "┣",
  "┫",
  "╋",
];

const lightTable = tableFrom(LIGHT_JUNCTIONS);
const doubleTable = tableFrom(DOUBLE_JUNCTIONS);
const heavyTable = tableFrom(HEAVY_JUNCTIONS);

/** The engine's own tables per style: light junctions with the dashed
 * (`╌ ╎` — the double dash pair reads cleaner than the triple dash,
 * which looks like dots in many fonts) and dotted (`┄ ┊`) lines,
 * double's own junctions. */
const BUILT_IN: Record<BorderStyle, LineRoles> = {
  solid: lightTable,
  double: doubleTable,
  dashed: { ...lightTable, h: "╌", v: "╎" },
  dotted: { ...lightTable, h: "┄", v: "┊" },
};

/** The defaults' weights: heavy from 2px for the light-line styles,
 * one cell thick; double has no heavier weight. */
const DEFAULT_WEIGHTS: Partial<Record<BorderStyle, WeightBand[]>> = {
  solid: [{ width: 2, ...heavyTable }],
  dashed: [{ width: 2, ...heavyTable, h: "╍", v: "╏" }],
  dotted: [{ width: 2, ...heavyTable, h: "┉", v: "┋" }],
};

/** A style at a weight through a set: the line roles to draw with,
 * the cells the border takes, and the band that won (null for the
 * plain table). */
export interface Weighted {
  readonly roles: Readonly<LineRoles>;
  readonly cells: number;
  readonly band: Readonly<WeightBand> | null;
}

const lineRoles = (source: Partial<LineRoles> | null | undefined): Partial<LineRoles> => {
  const roles: Partial<LineRoles> = {};
  if (source)
    for (const role of LINE_ROLES) if (source[role] !== undefined) roles[role] = source[role];
  return roles;
};

/** Resolved weights per set, keyed by style and width: lattices and
 * rules ask per cell, and a set is replaced whole, never edited, so a
 * resolution stays good. */
const weightedBySet = new WeakMap<BorderGlyphSet, Map<string, Weighted>>();
const weightedDefaults = new Map<string, Weighted>();
const weightedCache = (set: BorderGlyphSet | undefined): Map<string, Weighted> => {
  if (!set) return weightedDefaults;
  let cache = weightedBySet.get(set);
  if (!cache) weightedBySet.set(set, (cache = new Map()));
  return cache;
};

/** A style's glyphs at a `border-width` in px (specs/theming.md): the
 * band nearest the width, ties to the wider, the plain table at 1px
 * counting as a band; roles fall back per glyph, band → the set's
 * table → the engine's. */
export function weightBand(style: BorderStyle, weight: number, set?: BorderGlyphSet): Weighted {
  const cache = weightedCache(set);
  const key = `${style}:${weight}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const table = set?.[style];
  const bands = table?.weights ?? (table ? [] : (DEFAULT_WEIGHTS[style] ?? []));
  let best: WeightBand | null = null;
  let bestGap = Math.abs(weight - 1);
  for (const band of bands) {
    const gap = Math.abs(band.width - weight);
    if (gap < bestGap || (gap === bestGap && band.width > (best?.width ?? 1))) {
      best = band;
      bestGap = gap;
    }
  }
  const result: Weighted = {
    roles: { ...BUILT_IN[style], ...lineRoles(table), ...lineRoles(best) },
    cells: best?.cells ?? 1,
    band: best,
  };
  cache.set(key, result);
  return result;
}

/** The weight a side carries into a junction with another style: its
 * own where its set has a band for it, else the plain one — a 2px
 * double side meets a light side at a light corner. */
export function junctionWeight(style: BorderStyle, weight: number, set?: BorderGlyphSet): number {
  return weightBand(style, weight, set).band ? weight : 1;
}

/* === Built-in sets ==================================================== */

// `default` needs no table — an unresolved set falls through to the
// engine's built-in glyphs everywhere.
registerBorderGlyphs("default", {});

// PETSCII/C64 flavor: solid corners become arcs; everything else keeps
// the defaults (dashed/dotted corners stay square — the arc glyphs
// exist only in the light-solid weight).
const rings: WeightBand[] = [{ width: 2, cells: 2 }];
registerBorderGlyphs("rounded", {
  solid: { tl: "╭", tr: "╮", bl: "╰", br: "╯", weights: rings },
  dashed: { weights: rings },
  dotted: { weights: rings },
});

// Teletype: 7-bit ASCII only. `double` keeps emphasis via `=`.
const asciiTable: GlyphTable = { ...uniformTable("+"), h: "-", v: "|" };
registerBorderGlyphs("ascii", {
  solid: {
    ...asciiTable,
    scrollTrack: "|",
    scrollThumb: "#",
    shadow: ["#", "+", ":", "."],
    weights: rings,
  },
  double: { ...asciiTable, h: "=" },
  dashed: { ...asciiTable, weights: rings },
  dotted: { ...asciiTable, h: ".", v: ":", weights: rings },
});

// DEC/VT-style terminals drew one line style only: double, dashed,
// and dotted all downgrade to solid light lines — no arcs, so corners
// stay square at any radius, and no heavy, so a wider border is two
// rings (the VGA font the amber and phosphor themes pair it with has
// neither).
registerBorderGlyphs("single", {
  solid: { rounded: [], weights: rings },
  double: { ...lightTable, weights: rings },
  dashed: { ...lightTable, weights: rings },
  dotted: { ...lightTable, weights: rings },
});

// CP437 hardware: double survives, but the dashed/dotted line glyphs
// don't exist in the codepage (bitmap fonts lack them — a fallback
// font would break the grid), so they downgrade to solid; the arcs are
// missing too, so corners stay square at any radius, and heavy is
// missing, so a wider border is double, as DOS interfaces emphasized.
const doubleWeights: WeightBand[] = [{ width: 2, ...doubleTable }];
registerBorderGlyphs("cp437", {
  solid: { rounded: [], weights: doubleWeights },
  dashed: { ...lightTable, weights: doubleWeights },
  dotted: { ...lightTable, weights: doubleWeights },
});

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
  solid: { ...uniformTable("█"), weights: rings },
  double: { ...uniformTable("█"), weights: rings },
  dashed: { ...uniformTable("▒"), weights: rings },
  dotted: { ...uniformTable("░"), weights: rings },
});
