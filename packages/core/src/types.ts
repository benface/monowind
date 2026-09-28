import type { BorderGlyphSet } from "./glyphs.ts";
import type { ColorSpace, HueMode, Rgba } from "./color.ts";
import type { TextCase } from "./text-transform.ts";

/** The glyph properties: inherited ones that change how a glyph draws,
 * never its advance. The grid's spans take each from their element
 * where it differs from the host's, which the grid inherits
 * (specs/cell-model.md "Typography"); a property joins by its name. */
export const GLYPH_PROPERTIES = [
  "font-weight",
  "font-style",
  "font-variant-numeric",
  "-webkit-font-smoothing",
  "text-shadow",
  "text-underline-offset",
] as const;

export type GlyphProperty = (typeof GLYPH_PROPERTIES)[number];

/** An element's glyph properties, as computed. */
export type GlyphValues = Readonly<Record<GlyphProperty, string>>;

/** The glyph properties' initial values. */
export const INITIAL_GLYPH: GlyphValues = {
  "font-weight": "400",
  "font-style": "normal",
  "font-variant-numeric": "normal",
  "-webkit-font-smoothing": "auto",
  "text-shadow": "none",
  "text-underline-offset": "auto",
};

/** A marker's text, part by part: a string, a `counter()` or
 * `counters()` (joined by its separator), or `list-style-type`'s counter
 * style over the item's `list-item`, prefix and suffix included. */
export type ContentPart = string | CounterPart | { listStyle: string };

export interface CounterPart {
  counter: string;
  style: string;
  separator?: string;
}

/** A list item's marker, its text written (specs/lists.md). */
export interface Marker {
  style: MarkerStyle;
  text: string;
  /** Per code unit, as a leaf's `advances`: each cluster's cells, the
   * item's tracking included, and 0 for its later units. */
  advances: number[];
  /** Its cells: an inside marker's first-line indent, and an outside
   * one's reach left of where it ends. */
  width: number;
  /** Its spaces, which a justified line spreads (specs/lists.md "Inside"). */
  gaps: number;
  /** An outside marker's cells' origin in its item's border box, as laid out. */
  x?: number;
  y?: number;
}

/** A list item's marker as read (specs/lists.md "What the engine
 * reads"): its text's parts, where it sits, and its `::marker`'s paint. */
export interface MarkerStyle {
  parts: readonly ContentPart[];
  inside: boolean;
  /** Its own color, null where it is its item's, which a transition's
   * frames resample onto the item. */
  color: string | null;
  glyph: GlyphValues;
  /** Its `content` holds an image, which the grid draws as nothing and
   * its native marker must not draw (specs/lists.md deviation 3). */
  image: boolean;
}

/** A rect by its edges, the far ones exclusive: as a clip, the cells
 * overflow leaves visible (specs/scrolling.md). */
export type Clip = { x0: number; y0: number; x1: number; y1: number };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Insets = PerSide<number>;

/** Insets where any side can be `null` to signal `auto` (used for margins). */
export type NullableInsets = PerSide<number | null>;

/** A width, height or flex basis; `auto` is undefined. */
export type Size =
  | { kind: "cells"; value: number }
  | { kind: "percent"; value: number }
  /** Intrinsic sizing keywords (`w-min` / `w-max` / `w-fit`). Resolved
   * against content: min-content = longest unbreakable unit, max-content =
   * unwrapped size, fit-content = shrink-to-fit within the available space.
   * Only honored for `width`; on `height` they behave as `auto` (content
   * height already is the intrinsic height). */
  | { kind: "min-content" }
  | { kind: "max-content" }
  | { kind: "fit-content" };

export type Display = "block" | "flex" | "grid" | "table" | "multicol" | "none";
/** Table-internal role from the computed display (specs/table.md).
 * `"none"` on everything that isn't table-internal. Cells and captions
 * keep `display: "block"` — they ARE block containers; the table
 * container finds them by role. */
export type TableRole =
  | "none"
  | "header-group"
  | "row-group"
  | "footer-group"
  | "row"
  | "cell"
  | "caption"
  | "column"
  | "column-group";
type FlexDirection = "row" | "column";
type FlexWrap = "nowrap" | "wrap";
/** A flex line's edges, which a reversed axis swaps, `start` and `end`
 * elsewhere; a baseline is one for an item in its baseline group. */
type FlexEdge = "flex-start" | "flex-end";
type Baseline = "baseline" | "last baseline";
export type JustifyContent =
  | "start"
  | "center"
  | "end"
  | FlexEdge
  | "space-between"
  | "space-around"
  | "space-evenly"
  /** CSS `normal` / `stretch`. In flex both behave as `flex-start` (per
   * css-align); in grid they stretch auto-sized tracks over leftover space
   * (CSS Grid §11.8) and otherwise behave as `start`. */
  | "stretch";
export type AlignItems = "start" | "center" | "end" | FlexEdge | Baseline | "stretch";
/** Multi-line cross distribution (`content-*`); `stretch` (the CSS
 * default `normal`) grows flex lines / grid tracks instead of offsetting
 * them. */
type AlignContent = JustifyContent;
type AlignSelf = "auto" | AlignItems;
export type BorderStyle = "solid" | "double" | "dashed" | "dotted";
/** Per-axis overflow state. `hidden` and `clip` both clip, and the
 * engine scrolls neither; `hidden` is a scroll container to CSS
 * (`isScrollContainer`: its automatic minimum 0, a formatting-context
 * root), `clip` not. `auto` and `scroll` scroll (`scrollsAxis`),
 * differing only in the gutter — `scroll` reserves it always, `auto`
 * only once content overflows. */
export type OverflowAxis = "visible" | "clip" | "hidden" | "auto" | "scroll";

export function scrollsAxis(axis: OverflowAxis): boolean {
  return axis === "auto" || axis === "scroll";
}

/** Clips, unscrolled: `hidden` or `clip`. */
export function clipsAxis(axis: OverflowAxis): boolean {
  return axis === "hidden" || axis === "clip";
}

export function isScrollContainer(axis: OverflowAxis): boolean {
  return axis === "hidden" || scrollsAxis(axis);
}

/** A box that is a scroll container, on either axis. */
export const hasScrollport = ({ x, y }: Overflow): boolean =>
  isScrollContainer(x) || isScrollContainer(y);
export interface Overflow {
  x: OverflowAxis;
  y: OverflowAxis;
}
export type Position = "static" | "relative" | "absolute" | "fixed" | "sticky";

/** `float` and `clear` (specs/float.md); `start`/`end` compute to the
 * LTR side. */
export type Float = "none" | "left" | "right";
export type Clear = "none" | "left" | "right" | "both";

/** A leaf line's row and the cells floats leave it (specs/float.md). */
export interface LineBand {
  row: number;
  x: number;
  width: number;
}
/** `white-space` (specs/cell-model.md "White-space and truncation"):
 * `nowrap` and `pre` never soft-wrap, `pre` keeping the source's spaces
 * and newlines; `pre-line` keeps its newlines, `pre-wrap` and
 * `break-spaces` its spaces too, all three wrapping. */
type WhiteSpace = "normal" | "nowrap" | "pre" | "pre-line" | "pre-wrap" | "break-spaces";

/** Whether lines soft-wrap under a `white-space`. */
export function softWraps(whiteSpace: WhiteSpace): boolean {
  return whiteSpace !== "nowrap" && whiteSpace !== "pre";
}

/** How a wrapping `white-space` keeps its spaces (wrap.ts `preserve`). */
export function preservedSpaces(whiteSpace: WhiteSpace): "hang" | "break" | undefined {
  return whiteSpace === "pre-wrap" ? "hang" : whiteSpace === "break-spaces" ? "break" : undefined;
}

/** A length in whole cells, or a percentage kept symbolic until layout.
 * Percentages resolve against the CSS-appropriate basis at layout time:
 * the available extent for min/max (`max-w-full` = 100%), the containing
 * block's WIDTH for padding and margins (all four sides, per CSS), and the
 * container's own content box in the gap's axis for gaps. A `calc()` of a
 * percentage and lengths keeps the percentage symbolic and carries the
 * lengths as `cells`, added once it resolves (specs/cell-model.md
 * "Mixed-unit calc()"). */
export type CellLength = number | { percent: number; cells?: number };

/** A min/max constraint: a CellLength, or an intrinsic sizing keyword
 * (`max-w-max` = `max-width: max-content`, …). Keywords are honored on
 * width limits and behave as "no constraint" on height limits (content
 * height already is the intrinsic height). */
export type SizeLimit = CellLength | "min-content" | "max-content" | "fit-content";

/** A size property an `anchor-size()` can take. */
export type AnchorSizeProperty =
  | "width"
  | "height"
  | "minWidth"
  | "minHeight"
  | "maxWidth"
  | "maxHeight";

/** An `anchor-size()` (specs/anchor-positioning.md): the anchor it
 * names, the box's own when null, and the anchor's dimension it reads. */
export interface AnchorSize {
  anchor: string | null;
  dimension: "width" | "height";
  /** The length where no anchor resolves it. */
  fallback?: CellLength;
}

export type AnchorSizes = Partial<Record<AnchorSizeProperty, AnchorSize>>;

/** An inset's `anchor()` (specs/anchor-positioning.md): the anchor it
 * names, the box's own when null, and the point of the anchor on the
 * inset's axis it lands on, from the start edge (0) to the end (1) —
 * null for another axis's side, which only the fallback resolves. */
export interface AnchorInset {
  anchor: string | null;
  fraction: number | null;
  /** The length where no anchor resolves it. */
  fallback?: CellLength;
}

export type AnchorInsets = Partial<Record<Side, AnchorInset>>;
/** A box's corners, top-left through bottom-right. */
export type CornerRole = "tl" | "tr" | "bl" | "br";

/** One `box-shadow` (specs/box-shadow.md): offsets and spread in cells,
 * the blur in cells unrounded, the color as computed, `inset` for one
 * drawn inside the padding box. */
export interface BoxShadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

/** A length along a gradient (specs/gradients.md): a fraction of the
 * line, ellipse, or box, or cells on the spacing scale (a px length),
 * resolved to px at paint by the measured cell. */
export type GradientLength = { fraction: number } | { cells: number };
export interface GradientPoint {
  x: GradientLength;
  y: GradientLength;
}
export interface GradientStop {
  color: Rgba;
  /** Along the line; null spreads evenly between its neighbours. */
  position: GradientLength | null;
  /** The transition hint after this stop, where the midpoint sits. */
  hint?: GradientLength;
}
export type RadialSize =
  | "closest-side"
  | "farthest-side"
  | "closest-corner"
  | "farthest-corner"
  | { rx: GradientLength; ry: GradientLength };
interface GradientBase {
  repeating: boolean;
  /** The interpolation space: as named, else oklab, or srgb when
   * every stop is a legacy color, as CSS defaults. */
  space: ColorSpace;
  /** How a polar space's hue turns between stops, `shorter` unless
   * named. */
  hue: HueMode;
  stops: GradientStop[];
}
export type BackgroundClip = "border-box" | "padding-box" | "content-box" | "text";
/** A layer root's `backdrop-filter` as computed (specs/layers.md): the
 * companion locks it on the light element, whose backdrop would take
 * in the layer's own cells, so the layer's box takes it from here —
 * the root's other effects from the element's computed style, as the
 * box is placed. */
export interface Layer {
  backdropFilter: string;
  /** Whether the layer's effects RESAMPLE its cells — scaled, rotated,
   * skewed — as against carrying them whole: a tiling box's clip edge is
   * then antialiased at every row, a seam the glyph unboxed covers
   * (specs/wide-characters.md). */
  resampled: boolean;
}
/** A `background-image` layer the grid paints as a color per cell. */
export type Gradient =
  | (GradientBase & {
      kind: "linear";
      /** Degrees clockwise from `to top`, or a side or corner (`toX`,
       * `toY` in −1, 0, 1), whose angle the box decides at paint. */
      direction: { angle: number } | { toX: number; toY: number };
    })
  | (GradientBase & {
      kind: "radial";
      shape: "circle" | "ellipse";
      size: RadialSize;
      at: GradientPoint;
    })
  | (GradientBase & { kind: "conic"; from: number; at: GradientPoint });
type TextOverflow = "clip" | "ellipsis";

/** One bound of a grid track size (specs/grid.md). `fr` is only valid as a
 * max (the reader normalizes bare `<n>fr` to `minmax(auto, <n>fr)`, per
 * CSS); percent resolves against the container's content box in the
 * track's axis (indefinite axis → treated as `auto`). */
export type TrackBreadth =
  | { kind: "cells"; value: number }
  | { kind: "percent"; value: number }
  | { kind: "fr"; value: number }
  | { kind: "auto" }
  | { kind: "min-content" }
  | { kind: "max-content" }
  /** `min()` / `max()` over fixed breadths — the canonical responsive
   * auto-fill pattern `minmax(min(8rem, 100%), 1fr)` — and a `calc()`,
   * its percentage and cells summed. Resolvable only when every
   * argument is (a percent argument needs a definite axis); otherwise
   * the whole function behaves as `auto`. */
  | { kind: "math"; fn: "min" | "max" | "sum"; args: TrackBreadth[] }
  /** `fit-content(L)`'s maximum: max-content, capped at `limit`. */
  | { kind: "fit-content"; limit: TrackBreadth };

/** A grid track as a normalized minmax pair — every track-size form reads
 * as one (`8rem` → minmax(cells, cells), `1fr` → minmax(auto, fr), …). */
export interface TrackSize {
  min: TrackBreadth;
  max: TrackBreadth;
}

/** A parsed `grid-template-columns` / `grid-template-rows`. Fixed repeats
 * are expanded at read time; an `auto-fill` / `auto-fit` repetition stays
 * symbolic (`autoRepeat`, spliced in at `tracks[autoRepeat.index]`) and
 * resolves its count at layout time against the definite axis size. */
export type GridTemplate =
  | { kind: "none" }
  /** `subgrid`, its own line names from its first line (`subgrid [a]
   * [b]`) beside the parent's it inherits. */
  | { kind: "subgrid"; lineNames?: string[][] }
  | {
      kind: "tracks";
      tracks: TrackSize[];
      /** `[name …]` groups: `lineNames[i]` names line i (0 … tracks.length).
       * Absent when the template names no lines. */
      lineNames?: string[][];
      autoRepeat?: {
        index: number;
        tracks: TrackSize[];
        /** Names inside the repetition (tracks.length + 1 entries); the
         * edge groups merge with neighbors at every iteration boundary. */
        lineNames?: string[][];
        /** Names authored just before the `repeat()` — they attach to the
         * first repeated line once the count is known. */
        leadingNames?: string[];
        mode: "auto-fill" | "auto-fit";
      };
    };

/** One side of a grid item's placement (`grid-column-start`, …): a line
 * number (negative counts from the explicit grid's end, per CSS), a span
 * (optionally counting only lines with a name), a named line (`foo`, or
 * `<n> foo` — `nth` absent for the bare form, whose area-edge lookup
 * comes first, specs/grid.md), or auto. */
export type GridLine =
  | { kind: "auto" }
  | { kind: "line"; value: number }
  | { kind: "span"; value: number; name?: string }
  | { kind: "name"; name: string; nth?: number };

/** A named area from `grid-template-areas`, as 0-based line indices
 * (`colEnd` / `rowEnd` exclusive of the last cell's track). */
export interface GridArea {
  colStart: number;
  colEnd: number;
  rowStart: number;
  rowEnd: number;
}

/** `grid-template-areas`: the row/column count it defines and its
 * (rectangular) named areas. */
export interface GridAreas {
  columns: number;
  rows: number;
  areas: Map<string, GridArea>;
}

export interface GridAutoFlow {
  direction: "row" | "column";
  dense: boolean;
}

/** One run of a leaf's character → source map (see `LayoutNode.charSource`). */
export interface CharSourceRun {
  index: number;
  length: number;
  node: Text;
  offset: number;
}

/** Tracks a subgrid inherits from its parent grid in a subgridded axis
 * (specs/grid.md), projected into the subgrid's CONTENT-box coordinates:
 * the first and last tracks are shrunk by the subgrid's own margin,
 * border, and padding on that side, so its items still land on the
 * parent's lines. `gap` is the parent's gutter. */
export interface InheritedTracks {
  positions: number[];
  sizes: number[];
  gapBefore: number[];
  gap: number;
}

/** A leaf's atomic inline boxes in MARKER order — the order of its
 * U+FFFC characters, which is document order (`children` is built in
 * document order). Every marker ↔ box pairing (layout widths and line
 * placement, copy splicing, boundary points inside a box) reads it here
 * and nowhere else. */
export function inlineBoxesOf(node: LayoutNode): LayoutNode[] {
  return node.children.filter((child) => child.inlineBox);
}

/** The gutter band each axis's bar occupies when reserved
 * (specs/scrolling.md): the bar's thickness plus the perpendicular
 * inset that moves it inward — the rightmost columns for y, the
 * bottom rows for x. */
export function scrollGutterBands(style: CellStyle): { right: number; bottom: number } {
  return {
    right: style.scrollbarSize.y + style.scrollbarInset.x,
    bottom: style.scrollbarSize.x + style.scrollbarInset.y,
  };
}

/** The gutters an explicit `scroll` axis reserves unconditionally
 * (specs/scrolling.md). Folded into padding wherever padding cells
 * are derived, so content-box math, intrinsic sizes, and the native
 * overlay (--mw-p*) agree. `auto` axes reserve only on overflow, in
 * layoutNode's second pass — never here. */
export function scrollGutter(style: CellStyle): { right: number; bottom: number } {
  if (style.scrollbarWidth === "none") return { right: 0, bottom: 0 };
  const bands = scrollGutterBands(style);
  return {
    right: style.overflow.y === "scroll" ? bands.right : 0,
    bottom: style.overflow.x === "scroll" ? bands.bottom : 0,
  };
}

/** One run of identical border glyphs, in absolute cell coordinates. */
export interface BorderRun {
  glyph: string;
  x: number;
  y: number;
  length: number;
  color: string | undefined;
}

/** A collapsed lattice segment: the border that won one piece of a
 * line, drawn as a gap rule is. */
export type LatticeSegment = GapRule;

/** A collapsed table's border geometry (specs/table.md), resolved into
 * glyphs at paint (lattice.ts) so a sticky part's lines follow it
 * (specs/sticky.md): line thicknesses, the winning segment per line
 * piece, the grid's cell geometry in table-local cells, and the placed
 * cell at each grid position (spans repeated) with its row and group. */
export interface TableLattice {
  vLines: number[];
  hLines: number[];
  vSegments: (LatticeSegment | null)[][];
  hSegments: (LatticeSegment | null)[][];
  widths: number[];
  rowHeights: number[];
  colX: number[];
  rowY: number[];
  contentLeft: number;
  contentTop: number;
  cells: ({ node: LayoutNode; row: LayoutNode; group: LayoutNode | null } | undefined)[][];
  set: BorderGlyphSet | undefined;
  /** The parts handed cells by the last paint, to clear on the next. */
  handed?: LayoutNode[];
}

/** A gap-decoration rule (specs/gap-decorations.md), from the rule-*
 * utilities' `--mw-rule-*` mirrors. `color` is always concrete:
 * currentColor resolves to the container's computed color at read time,
 * like border colors. */
export interface GapRule {
  /** The rule's thickness in cells, its weight band's. */
  width: number;
  /** The weight it draws with and carries into junctions: its px
   * width where the set has a band for it, else 1 (junctionWeight). */
  weight: number;
  style: BorderStyle;
  color: string | undefined;
}

/** Where rule segments break at gap intersections (css-gaps-1
 * rule-break; specs/gap-decorations.md "Segments"). */
export type RuleBreak = "none" | "normal" | "intersection";

/** Which segments paint next to empty grid areas (css-gaps-1
 * rule-visibility-items; `normal` acts as `all` in grid). */
export type RuleVisibilityItems = "normal" | "all" | "around" | "between";

/** A collapsed table participant's authored border, moved out of
 * `CellStyle.border` at read time (`border-collapse` inherits, so every
 * internal element knows): geometry and painting then treat the element
 * as borderless, and the table's lattice consumes this instead
 * (specs/table.md). */
export interface LatticeBorder {
  width: Insets;
  /** px per edge: a shared edge goes to the heavier (CSS 2.1 §17.6.2.1),
   * whose band then draws it. */
  weight: PerSide<number>;
  style: PerSide<BorderStyle>;
  color: PerSide<string | undefined>;
  /** `border-style: hidden` (`border-hidden`): suppresses the shared
   * segment outright, beating any neighbor — its computed width is 0, so
   * the flag must ride separately (CSS 2.1 §17.6.2.1). */
  hidden: PerSide<boolean>;
}

export type Side = "top" | "right" | "bottom" | "left";

export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

/** One value per box edge (border style, border color, …). */
export interface PerSide<T> {
  top: T;
  right: T;
  bottom: T;
  left: T;
}

/** An `anchor-scope`: the names it keeps to its element's subtree, all
 * of them, or none (specs/anchor-positioning.md). */
export type AnchorScope = "all" | readonly string[] | null;

export interface CellStyle {
  display: Display;
  flexDirection: FlexDirection;
  /** True for `row-reverse` / `column-reverse`: the main axis runs
   * backwards — items lay out in reverse order and `justify-content`'s
   * `flex-start`/`flex-end` swap meaning. */
  flexReverse: boolean;
  flexWrap: FlexWrap;
  /** True for `wrap-reverse`: lines stack from the cross-end (bottom-up). */
  wrapReverse: boolean;
  flexGrow: number;
  flexShrink: number;
  /** CSS `flex-basis`: the flex base size when not `auto` —
   * notably `0%` from Tailwind's `flex-1`, which makes grow distribute ALL
   * the space (equal columns) instead of just the extra. */
  flexBasis: Size | undefined;
  /** CSS `order` — flex items sort by it (stable, document order ties). */
  order: number;
  justifyContent: JustifyContent;
  /** `safe` in the value, css-align's overflow position; each alignment
   * field has its flag. Layout aligns every overflow as `safe`
   * (specs/cell-model.md deviation 19). */
  justifyContentSafe: boolean;
  /** Flex: multi-line (wrap-enabled) containers only, per CSS. Grid: row
   * track distribution. */
  alignContent: AlignContent;
  alignContentSafe: boolean;
  alignItems: AlignItems;
  alignItemsSafe: boolean;
  /** `align-items` is `normal`, read as `stretch` but `start` for a
   * grid item with an aspect ratio (specs/grid.md). */
  alignItemsNormal: boolean;
  alignSelf: AlignSelf;
  alignSelfSafe: boolean;
  /** Grid container inline-axis item alignment (`justify-items`); the CSS
   * default `normal` behaves as `stretch` in grid. */
  justifyItems: AlignItems;
  justifyItemsSafe: boolean;
  /** Grid item inline-axis self-alignment override (`justify-self`). */
  justifySelf: AlignSelf;
  justifySelfSafe: boolean;
  /** Parsed track templates (specs/grid.md). `none` for non-grid elements. */
  gridTemplateColumns: GridTemplate;
  gridTemplateRows: GridTemplate;
  /** Sizes for implicit tracks (`grid-auto-columns` / `grid-auto-rows`),
   * cycled across the implicit tracks in each axis. Never empty — the CSS
   * initial value is a single `auto`. */
  gridAutoColumns: TrackSize[];
  gridAutoRows: TrackSize[];
  gridAutoFlow: GridAutoFlow;
  /** Parsed `grid-template-areas`; `null` for `none` or an invalid value
   * (per CSS the whole property then doesn't apply). */
  gridTemplateAreas: GridAreas | null;
  /** Grid item placement longhands. `auto` on non-grid-item elements. */
  gridColumnStart: GridLine;
  gridColumnEnd: GridLine;
  gridRowStart: GridLine;
  gridRowEnd: GridLine;
  width: Size | undefined;
  height: Size | undefined;
  /** `"auto"` is CSS `min-width/height: auto`: 0 in block flow, but a flex
   * item's automatic minimum (its min-content size, when overflow is
   * visible) on the flex main axis — the reason text in a flex row stops
   * shrinking instead of vanishing, and why `min-w-0` exists. */
  minWidth: SizeLimit | "auto";
  minHeight: SizeLimit | "auto";
  maxWidth: SizeLimit | undefined;
  maxHeight: SizeLimit | undefined;
  /** `aspect-ratio` in columns per row, null for none
   * (specs/cell-model.md "Aspect ratio"). */
  aspectRatio: number | null;
  padding: PerSide<CellLength>;
  /** `null` = `auto`. Percentages resolve against the parent's content
   * width where the margin is consumed. */
  margin: PerSide<CellLength | null>;
  /** See specs/positioning.md: fixed behaves as absolute anchored to the
   * host; sticky shifts within its scroll container (specs/sticky.md). */
  position: Position;
  /** specs/float.md: honored on the in-flow children of a block
   * container, `none` on an out-of-flow box as CSS computes it. */
  float: Float;
  /** The floats a box moves below, in its own container (specs/float.md). */
  clear: Clear;
  /** `top/right/bottom/left`; `null` = `auto`. Percentages resolve against
   * the containing block (width for left/right, height for top/bottom). */
  insets: PerSide<CellLength | null>;
  /** `null` = `normal`: 0, or a subgrid's parent's gap (specs/grid.md). */
  gapX: CellLength | null;
  gapY: CellLength | null;
  /** Cells per edge: the weight band's thickness (specs/cell-model.md
   * "Box model") — one under the defaults, two under a set's rings. */
  border: Insets;
  /** `border-width` in px per edge, the WEIGHT the glyph set draws it
   * with (light at 1, heavy from 2 by default; specs/theming.md), 1
   * where there is no border. */
  borderWeight: PerSide<number>;
  borderStyle: PerSide<BorderStyle>;
  borderColor: PerSide<string | undefined>;
  /** Each corner's radius in cells, unrounded — the corner glyph
   * registered nearest it draws (specs/cell-model.md "Borders: glyph
   * mapping"); `Infinity` for a percentage. */
  borderRadius: Record<CornerRole, number>;
  overflow: Overflow;
  /** `scrollbar-width: none` suppresses the gutter and bar entirely;
   * `thin` and `auto` both defer to `scrollbarSize`
   * (specs/scrolling.md). */
  scrollbarWidth: "auto" | "none";
  /** A scroll container's `scroll-padding` in cells, which a reveal
   * stops clear of past its border and bars (specs/scrolling.md). */
  scrollPadding: Insets;
  /** Bar thickness in cells per axis — `x` the horizontal bar's
   * height, `y` the vertical bar's width (`--mw-scrollbar-size-x/y`,
   * the scrollbar-*, scrollbar-x-*, scrollbar-y-* utilities; default
   * 1). */
  scrollbarSize: { x: number; y: number };
  /** Cells kept clear around the bars for the author's arrow buttons
   * (`--mw-scrollbar-inset-x/y`, the scrollbar-inset-* utilities;
   * default 0; specs/scrolling.md). */
  scrollbarInset: { x: number; y: number };
  /** `scrollbar-color` thumb/track ink; `null` = currentColor pair. */
  scrollbarColor: { thumb: string; track: string } | null;
  /** Per-axis `overscroll-behavior`: whether a boundary gesture may
   * CHAIN to an ancestor scroller (the grid-mode wheel router's
   * gesture-start decision; the native path honors it natively). */
  overscroll: { x: boolean; y: boolean };
  whiteSpace: WhiteSpace;
  /** CSS `tab-size` in cells — tab stops for preserved (`pre`) text,
   * expanded by the tree builder from each hard line's start. */
  tabSize: number;
  /** The case `text-transform` puts its text in. */
  textCase: TextCase;
  /** Empty rows between wrapped lines (`leading-*` re-quantized to the
   * grid: rows per line − 1). See specs/cell-model.md. */
  lineGap: number;
  /** Extra cells after every character (`tracking-*` re-quantized:
   * floor((letter-spacing − root letter-spacing) ÷ 0.025em)). */
  tracking: number;
  /** Paint-only: with `nowrap` + clipping, the browser draws the ellipsis.
   * The engine only needs it for the plain-text renderer's mirror of that. */
  textOverflow: TextOverflow;
  /** `-webkit-line-clamp` on a vertical `-webkit-box`: a text leaf's
   * lines past it are cut, the last kept ending in `…`
   * (specs/cell-model.md "White-space and truncation"). */
  lineClamp: number | null;
  /** Computed colors: the text's ink, and the box's fill (undefined
   * where transparent). */
  color: string | undefined;
  backgroundColor: string | undefined;
  /** `bg-clear` marker (`--mw-bg-clear: 1`): the border box is wiped to
   * the ground, background and glyph, through every group it sits in
   * (specs/cell-model.md "The ground"), before the element's own fill;
   * `backgroundColor` stays undefined. */
  backgroundClear: boolean;
  /** Gradient layers, first declared first (specs/gradients.md). */
  backgroundImage: Gradient[];
  /** Where the background paints: a box, or the glyphs (`text`). */
  backgroundClip: BackgroundClip;
  /** Its glyph properties' values (`GLYPH_PROPERTIES`), which its
   * glyphs take where they differ from the host's. */
  glyph: GlyphValues;
  textDecoration: TextDecoration;
  /** Computed text-align, normalized LTR. `end` offsets each line by
   * W − line, `center` by floor((W − line) / 2), `justify` shares it
   * among a line's gaps — whole cells, painted by the grid (the
   * browser's own fractional ones only touch the invisible light-DOM
   * copy). */
  textAlign: "start" | "center" | "end" | "justify";
  /** `text-wrap-style` (specs/cell-model.md "White-space and
   * truncation"): where a wrapping leaf's lines break. */
  textWrapStyle: "auto" | "balance" | "pretty";
  /** `word-break` (specs/cell-model.md "Line breaking"); its
   * `break-word` wraps as `normal` under the `anywhere` lock. */
  wordBreak: "normal" | "break-all" | "keep-all";
  /** First-line indent (per CSS: applies once to the first formatted
   * line of the block; `<br>` doesn't re-indent), signed, a percentage
   * of the leaf's content width; a leaf resolves it (`indent`). */
  textIndent: CellLength;
  tableRole: TableRole;
  tableLayout: "auto" | "fixed";
  /** True for `border-collapse: collapse` (Tailwind preflight's default
   * on `<table>`): cell borders merge into the shared lattice. */
  borderCollapse: boolean;
  /** `border-spacing`, quantized per axis; separate borders only. */
  borderSpacingX: number;
  borderSpacingY: number;
  captionSide: "top" | "bottom";
  /** Computed `vertical-align` normalized (the companion's baseline
   * lock is measuring-gated, so the read sees the authored/UA value).
   * Consumed by table cells (`td`/`th` default to the UA's `middle`,
   * specs/table.md) and by atomic inline boxes, where `baseline` acts
   * as `start` and `end` (bottom) drops the line's text to the box's
   * last row (specs/cell-model.md). */
  verticalAlign: "start" | "center" | "end" | "baseline";
  /** Computed `opacity` (0..1): below 1, the element paints as a group
   * the walk blends into the cells beneath (specs/cell-model.md
   * "Opacity and translucency"). */
  opacity: number;
  /** `visibility: visible` (specs/visibility.md): a hidden box — `hidden`,
   * or `collapse` — keeps its space and paints none of its own ink, and
   * a visible descendant still paints. */
  visible: boolean;
  /** `content-visibility: hidden`, `hidden="until-found"`'s too: the box
   * stays, as big as it is empty, and draws none of its contents
   * (specs/visibility.md "Skipped contents"). */
  skipsContents: boolean;
  /** A list item's marker (specs/lists.md), null for any other box and
   * for an item that draws none. */
  marker: MarkerStyle | null;
  /** Its computed `pointer-events` is other than `none`: the engine's
   * hit test takes it (specs/cell-model.md "Pointer states"). */
  pointerEvents: boolean;
  /** Set on a layer root — an element with a transform or a filter —
   * whose subtree paints into its own node (specs/layers.md). */
  layer: Layer | null;
  /** Forms a stacking context by a property the paint reads nowhere
   * else (style.ts `readLayer`, `readStacking`; specs/positioning.md
   * "Paint order"). */
  stacking: boolean;
  /** Anchor positioning (specs/anchor-positioning.md): the element's
   * `anchor-name`s (an invoker's is synthesized from its target's id),
   * the name it is anchored to (a popover's implicit anchor from its
   * own id), the area it takes, the fallbacks tried on overflow, and
   * the axes `justify-self`/`align-self` center on the anchor. */
  anchorNames: string[];
  /** `anchor-scope`, read where a box is anchored by name. */
  anchorScope: AnchorScope;
  positionAnchor: string | null;
  positionArea: PositionArea | null;
  positionTryFallbacks: AnchorFallback[];
  /** `position-try-order`: the placements, the base among them, tried
   * roomiest first on an axis, the logical keywords those of a
   * horizontal host. */
  positionTryOrder: "normal" | "most-width" | "most-height";
  /** `position-visibility`'s conditions for hiding the box, none under
   * `always`: its default anchor missing, clipped out of view, or the
   * box overflowing after the fallbacks. */
  positionVisibility: { anchorValid: boolean; anchorVisible: boolean; noOverflow: boolean };
  anchorCenter: { x: boolean; y: boolean };
  /** The sizes authored as `anchor-size()`, written in the anchor's
   * cells as the box is placed; each reads `auto` (`none` for a
   * maximum) until then. */
  anchorSizes: AnchorSizes;
  /** The insets authored as `anchor()`, resolved against the anchor's
   * cells as the box is placed, over whatever the side reads. */
  anchorInsets: AnchorInsets;
  /** In the platform's top layer — an open popover, a modal dialog —
   * for the host's stack (specs/top-layer.md). */
  topLayer: boolean;
  /** The `::backdrop`'s look, for the box the browser draws under a
   * top-layer element (specs/top-layer.md); null for none. */
  backdrop: Backdrop | null;
  /** The border glyph SET name from `--mw-border-glyphs` (`null` =
   * default) — the theming vocabulary borders/lattices/rules resolve
   * through (specs/theming.md); resolved on the decoration's owner. */
  glyphSet: string | null;
  /** Shadows as declared, first on top (specs/box-shadow.md). */
  boxShadow: BoxShadow[];
  /** Authored `z-index` (`null` = auto). Browser stacking is native;
   * the renderers walk children in this order (stable, document-order
   * ties) so decorations and plain text agree with it at overlaps. */
  zIndex: number | null;
  /** Set on collapsed-table participants; null everywhere else. */
  latticeBorder: LatticeBorder | null;
  /** Gap rules on flex/grid containers (specs/gap-decorations.md);
   * null when unauthored. The used gap in a ruled axis floors at the
   * rule width (deviation: rules take layout space — ink needs cells). */
  ruleX: GapRule | null;
  ruleY: GapRule | null;
  ruleBreak: RuleBreak;
  /** Cells retracted from every rule-segment endpoint (rule-inset,
   * quantized like border widths) — or `overlap-join`, which instead
   * extends junction endpoints into the crossing gap so meeting rules
   * connect. */
  ruleInset: number | "overlap-join";
  ruleVisibilityItems: RuleVisibilityItems;
  /** Multicol container inputs (specs/multicol.md): authored
   * column-count / column-width (cells), null = auto. A container is
   * multicol (display "multicol") when either is set on a block. */
  columnCount: number | null;
  columnWidth: number | null;
  columnFill: "auto" | "balance";
  /** column-span: all on a child — closes the column row, spans the
   * container's full content width (specs/multicol.md "Spanners"). */
  columnSpan: boolean;
  /** Forced column breaks (`break-before/after-column`). */
  breakBeforeColumn: boolean;
  breakAfterColumn: boolean;
  /** `break-inside: avoid` / `avoid-column` — a paragraph-flow child
   * fragments as one unbreakable unit (specs/multicol.md). */
  breakInsideAvoid: boolean;
}

/** One axis of a `position-area`, in the axis's own direction: the
 * cell before the anchor, the anchor's own, the cell after, a span of
 * the anchor's with one side, or the whole containing block
 * (specs/anchor-positioning.md). */
export type AreaSide = "start" | "center" | "end" | "span-start" | "span-end" | "span-all";

/** A `position-area`, physical: `x` across, `y` down. */
export interface PositionArea {
  x: AreaSide;
  y: AreaSide;
}

/** A try tactic's flip (specs/anchor-positioning.md): the block axis
 * mirrored, the inline one, or the two swapped. */
export type Flip = "block" | "inline" | "start";

/** One entry of `position-try-fallbacks`: a tactic's flips, in their
 * written order, or an area of its own. */
export type AnchorFallback = { flips: Flip[] } | PositionArea;

/** A `::backdrop`'s computed look, as the backdrop box copies it. */
export interface Backdrop {
  backgroundColor: string;
  backgroundImage: string;
  backdropFilter: string;
  opacity: string;
}

/** A top-layer element's node with its ancestors from the root down. */
export interface TopLayerEntry {
  node: LayoutNode;
  ancestors: LayoutNode[];
}

/** An inline descendant of a leaf (`LayoutNode.inlineElements`). */
export interface InlineElement {
  element: Element;
  tracking: number;
  padLeft: number;
  padRight: number;
  /** A relative element's insets as authored, and in cells against its
   * leaf's content box (`insets`, each layout's; specs/positioning.md
   * "Inline elements"). */
  insetLengths?: PerSide<CellLength | null>;
  insets: PerSide<number | null> | null;
  /** A sticky element's insets, constraints for its shift against its
   * scrollport (specs/sticky.md), and the shift for the current scroll
   * offsets. */
  sticky?: PerSide<CellLength | null>;
  stickyShift?: { x: number; y: number };
  /** Its `anchor-name`s, for the boxes anchored to it
   * (specs/anchor-positioning.md), and its own `anchor-scope`. */
  anchorNames: string[];
  anchorScope?: AnchorScope;
  /** Paint-only styling mirrored into the grid (the browser's own
   * ink is transparent-locked). `backgroundColor` fills the run's
   * cells — how a focus-inverted inline link shows its highlight. */
  color: string | undefined;
  backgroundColor: string | undefined;
  glyph: GlyphValues;
  textDecoration: TextDecoration;
  /** Its computed `visibility` is `visible`: a hidden one's cells stay
   * blank, their space kept. */
  visible: boolean;
  /** Its computed `pointer-events` is other than `none`. */
  pointerEvents: boolean;
  /** Its own opacity — times that of the inline elements a block
   * split left above it, which are no entries — and its parent
   * entry's index, -1 for none: the paint folds the chain as groups
   * nest (specs/cell-model.md "Opacity and translucency"). */
  opacity: number;
  parent: number;
  /** Relative or sticky, its `z-index` (null for `auto`), and whether
   * it forms a stacking context: its glyphs paint in the positioned
   * step (specs/positioning.md "Paint order"). */
  positioned: boolean;
  zIndex: number | null;
  context: boolean;
}

export interface LayoutNode {
  source: Element;
  style: CellStyle;
  /** In document order (tree.ts): paint-order ties resolve later-wins,
   * and a leaf's atomic inline boxes are in marker order — see
   * `inlineBoxesOf`, the one place that pairing is read. */
  children: LayoutNode[];
  /** The leaf's text run (inline descendants included, `<br>` as `\n`).
   * Empty for containers, whose text lives in their anonymous runs. */
  text: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  localRect: Rect;
  /** The border box's origin where it paints, in the host's cells, for
   * the current scroll offsets (paint-origin.ts `placePainted`): what the
   * paint, hit-testing and focus read. */
  paintOrigin: { x: number; y: number };
  /** The clips of its containing-block chain where it paints, in its
   * layer's cells (paint-origin.ts), a layer root's those of its box;
   * absent or null where nothing clips. */
  paintClip?: Clip | null;
  /** Where an out-of-flow (absolute) box would have sat in normal flow —
   * its CSS "static position", parent-relative, recorded by the parent's
   * flow pass and consumed by the absolute-positioning pass for inset-less
   * axes. Flex parents record the container's content box plus alignment
   * so the "as if sole flex item" rule can apply once the box is sized. */
  staticSlot?:
    | { kind: "block"; x: number; y: number }
    | {
        kind: "flex";
        direction: FlexDirection;
        originX: number;
        originY: number;
        innerWidth: number;
        innerHeight: number;
      }
    /** Grid parents (specs/grid.md §10.1): `area` is the child's grid
     * area (its containing block when the grid container is positioned)
     * and `staticArea` the sole-item area for inset-less axes — both
     * parent-relative border-box rects. */
    | { kind: "grid"; area: Rect; staticArea: Rect };
  /** Per-character cell advances for tracked leaf text (`1 + tracking` of
   * the character's innermost element, specs/cell-model.md); absent when
   * every character is a plain 1-cell advance. */
  advances?: number[];
  /** Inline descendants of a leaf. The renderer writes each one's grid
   * tracking, its quantized horizontal padding (the run reserves the
   * cells as INLINE_PAD markers; the browser applies the same cells as
   * real padding via engine-owned vars), and — for the positioned ones —
   * its relative insets rewritten to whole cells (specs/positioning.md);
   * `null` insets = not positioned. */
  inlineElements?: InlineElement[];
  /** The leaf's inline elements whose glyphs paint in its stacking
   * context's positioned step, those inside another that forms a
   * context aside (stacking.ts); absent for none. */
  inlineMembers?: number[];
  /** With `inlineMembers`, each inline element's glyph turn: the member
   * whose turn paints its glyphs, -1 for the leaf's own (stacking.ts). */
  inlineOwners?: number[];
  /** Per-character index into `inlineElements` (-1 = direct leaf text);
   * present only when the run contains inline elements. Plain-text
   * rendering maps colors, font styling, and relative inset shifts from
   * it. */
  charInline?: number[];
  /** Where each character of `text` came from, as runs of consecutive
   * characters (specs/semantic-selection.md): `text[index + k]` stands
   * for `node.data[offset + k]` for `k < length`, and the characters
   * standing for one cluster (a tab's spaces, `ß` as `SS`) share its
   * offset. Characters with no source position (`<br>` newlines,
   * inline-box and padding markers) fall between runs; renderer leaves
   * have no map. */
  charSource?: CharSourceRun[];
  /** On an atomic inline-level box (`inline-flex`/`inline-block`/
   * `inline-grid`) riding its parent leaf's text run as a single
   * unbreakable unit, its used margins: the leaf's run holds an OBJECT
   * REPLACEMENT CHARACTER (U+FFFC) for it whose advance is the box's
   * margin box. The box stays IN FLOW in the browser (sized to whole
   * cells, its margins too, by the companion stylesheet) so the
   * browser's own line layout places it — engine and browser agree
   * because both treat it as an atomic unit of the same width
   * (specs/cell-model.md). */
  inlineBox?: Insets;
  /** The product of the opacities of the inline elements between the box
   * and its leaf or container, which the paint walk multiplies into the
   * box's own (specs/cell-model.md "Opacity and translucency"); absent
   * at 1. */
  inlineOpacity?: number;
  /** Set by a grid parent on a child whose template is `subgrid` in at
   * least one axis: the child's span in each axis (its explicit track
   * count there — placement clamps to it) and, once the parent has sized
   * that axis, the inherited tracks. Rows arrive in the parent's second
   * pass: the first pass lays the subgrid out provisionally (its own
   * items' heights feed the parent's row sizing). Absent on everything
   * else — a `subgrid` template then behaves as `none`, per CSS. */
  subgrid?:
    | {
        colSpan: number;
        rowSpan: number;
        cols?: InheritedTracks | undefined;
        rows?: InheritedTracks | undefined;
        /** The parent's names on the lines each axis spans. */
        names: { col: string[][]; row: string[][] };
      }
    | undefined;
  /** An anonymous run (specs/cell-model.md "Inline content"): a
   * container's inline content beside its block children, `source` the
   * container, its DOM the run's own nodes (selection.ts `runNodes`). */
  anonymous?: boolean;
  /** The node's gap rules (specs/gap-decorations.md) as glyph runs in its
   * local coordinates, offset by its absolute position at paint time. */
  decorationRuns?: BorderRun[];
  /** A collapsed table's border lattice, resolved at paint (lattice.ts). */
  lattice?: TableLattice;
  /** A captioned table's box, the rows from its top that its border,
   * fill and shadows take, the caption outside it (specs/table.md
   * "Caption"). */
  tableBox?: { top: number; height: number } | undefined;
  /** A table part's lattice cells for this paint, in grid cells, handed
   * over by its table to paint in the part's own turn (lattice.ts). */
  latticeRuns?: BorderRun[];
  /** True on a node the table pass removed from rendering: misparented
   * table content (no anonymous boxes — specs/table.md) and `<col>`/
   * `<colgroup>` boxes (width carriers, never rendered). */
  tableHidden?: boolean;
  /** True on an anchored box `position-visibility` hides, its subtree
   * with it, whatever their own `visibility` (specs/anchor-positioning.md). */
  forceHidden?: boolean;
  /** Content-derived outer height, whatever height or min-height floor
   * the box has (a flex/grid text leaf's alignment padding left out) —
   * written by layoutNode. A flex column sizes an item's intrinsic basis
   * and automatic minimum from it; a table cell's `vertical-align`
   * centers it, per CSS. */
  naturalContentHeight: number;
  /** A text leaf's ink extent in content cells (widest line, rows) —
   * written by the leaf pass; scrollable-overflow accounting reads it
   * instead of re-wrapping. */
  textExtent?: { width: number; rows: number };
  /** Per-line row, x, and usable width in the leaf's content box, the
   * bands floats left its lines (specs/float.md) — written by the leaf
   * pass beside floats, and what a later re-derivation of the leaf's
   * lines (the paint's) wraps against. */
  lineBands?: LineBand[];
  /** A leaf's first-line indent in cells, resolved against its content
   * width as it lays out — its `text-indent` and an inside marker's
   * cells: charged against the first line's wrap width (a negative one
   * widening it) and offsetting that line's x. */
  indent?: number;
  /** A list item's marker (specs/lists.md): on the item where it sits
   * outside, on the leaf holding the item's first line where inside. */
  marker?: Marker;
  /** Scroll geometry (specs/scrolling.md), written by layoutNode on
   * containers with a scroll axis: content extent and the derived
   * max offset, both in cells. Absent elsewhere. */
  scrollRange?: { sizeX: number; sizeY: number; maxX: number; maxY: number };
  /** Current scroll offset in cells (paint-time input, written by the
   * element from native scrollTop/scrollLeft; absent = 0/0). */
  scroll?: { x: number; y: number };
  /** A sticky box's shift for the current scroll offsets (specs/sticky.md),
   * part of its `paintOrigin`; absent = none. */
  stickyShift?: { x: number; y: number };
  /** An inline box's line's text row, from the box's top, as the line
   * metrics settled it (specs/cell-model.md "Typography"). */
  inlineTextRow?: number;
  /** The area an anchored box took, its fallbacks tried
   * (specs/anchor-positioning.md); written onto the light element. */
  anchorArea?: PositionArea;
  /** A fixed box's origin in the host's cells (specs/positioning.md),
   * written by the positioning pass: its `paintOrigin`, outside its
   * ancestors' scroll and clips. */
  hostRect?: { x: number; y: number };
  /** The box's place in the host's top-layer stack
   * (specs/top-layer.md), assigned per layout: the walks skip it in
   * place and take it after the tree, in this order. */
  topLayerRank?: number;
  /** The root's top-layer stack in paint order, each element with its
   * ancestors from the root down; absent when empty. */
  topLayer?: TopLayerEntry[];
  /** On the root: the scroll containers whose scroll moves an anchor
   * under a box it does not move (specs/anchor-positioning.md), so a
   * scroll of one relays out. */
  anchorScrollers?: Set<Element>;
  /** On the root: the cells of the grid its reader can see, where the
   * top layer's UA placement resolves (specs/top-layer.md) — so a
   * dialog opens in view however tall the host. Absent where nothing
   * measured a window; the placement clamps it to the host itself. */
  visibleCells?: Rect;
  /** The gutter cells this container actually reserved — `scroll`
   * axes always, `auto` axes only when content overflows (the layout
   * second pass). Paint, hit-testing, and thumb drags read THIS, not
   * the style. */
  scrollGutterCells?: { right: number; bottom: number };
  /** Padding with percentages resolved to cells — written by layoutNode
   * (percent resolves against the containing block width, which only
   * layout knows); the renderers read this, never `style.padding`. */
  resolvedPadding: Insets;
  /** Fragmented line map of a multicol text leaf (specs/multicol.md):
   * text wrapped at the column width, each line assigned a column and
   * column-local rows. Written by layout; the plain-text renderer reads
   * it back so both place lines identically. A paragraph-flow container
   * carries a spanless one for its rules, height fold, and native
   * column vars; its children carry their own line maps in
   * container-content coordinates. */
  multicolGeometry?: MulticolLeafGeometry;
  /** A text leaf's lines as its layout wrapped them, and each one's text
   * row in its content box: the paint and the hit place its glyphs by
   * them. */
  lines?: Pick<MulticolLeafGeometry, "spans" | "textY" | "lineY"> & { clamped?: boolean };
  /** An out-of-flow element of a leaf's run: the leaf's character it
   * sits before, and whether it was inline-level before its position
   * blockified it (specs/positioning.md "Static position"). */
  runSpot?: { char: number; inline: boolean };
  /** Paragraph-flow multicol child (specs/multicol.md "Fragmenting
   * text-leaf children"): stays IN FLOW in the browser inside the
   * container's native columns so the browser fragments it itself.
   * Carries the engine-resolved margins the companion re-applies
   * quantized. */
  multicolFlow?: NullableInsets;
  /** In-flow multicol SPANNER (specs/multicol.md): a normally laid-out
   * box that stays in the native flow with `column-span: all`, its
   * geometry forced like a laid-out element's. Carries the quantized
   * native margins (`left` = the engine's cross offset). */
  multicolFlowSpan?: NullableInsets;
  /** A mixed block container's in-flow child (specs/cell-model.md
   * "Inline content"): stays in the browser's flow, engine-sized, with
   * these engine margins placing it where the engine did, so the
   * container's anonymous runs sit natively on their rows. */
  flow?: NullableInsets;
}

/** A multicol text leaf's per-line fragmentation. `lineY`/`textY` are
 * COLUMN-local rows; `lineX` is the line's column's content-relative x.
 * Leaf columns are all `columnWidth` wide (the division remainder is
 * folded into the engine-owned right padding so the browser's equal
 * fractional columns land on the same whole cells). */
export interface MulticolLeafGeometry {
  spans: { start: number; end: number }[];
  lineY: number[];
  textY: number[];
  lineX: number[];
  totalRows: number;
  columnCount: number;
  columnWidth: number;
  gap: number;
  /** Columns holding at least one line — overflow columns included. */
  columnsUsed: number;
  /** Spanner-split flow: one rule extent per SEGMENT (content-relative
   * rows and its occupied columns); absent = one full-height segment. */
  ruleSegments?: { start: number; end: number; columns: number }[];
  /** Spanner-split flow relies on the NATIVE balancer per segment (the
   * companion keeps `column-fill: balance` and the natural height)
   * instead of the fill-to-computed-height reconstruction. */
  nativeBalance?: boolean;
}

/** The root's cell, in px: width = glyph advance + the root's
 * letter-spacing, height = the root's line box (specs/cell-model.md).
 * `letterSpacing` is the root's, kept so descendant tracking can be read
 * relative to it. */
export interface CellMetrics {
  /** The cell, a whole number of 1/64 px (see metrics.ts). */
  width: number;
  /** The light DOM's natural advance, which `width` rounds up. */
  advance?: number;
  height: number;
  letterSpacing: number;
  /** The grid's letter-spacing: the root's plus what rounds the
   * measured advance to `width`. */
  gridLetterSpacing?: number;
  /** How far a glyph's ink extends past the cell's line box, in px
   * (some fonts' ascent + descent exceed their `normal` line box).
   * WebKit breaks columns at ink bottoms, so multicol leaves get this
   * much extra native column height (see styles.css). */
  inkOverhang?: number;
  /** How far the line box exceeds the font's content area, in px: the
   * strip an inline span's background leaves bare at each row's edge.
   * The grid's spans pad by half of it (the host's `--mw-bgpad`). */
  backgroundGap?: number;
  /** The text baseline's offset within a row, in px: a middle-aligned
   * inline box with a bottom-edge baseline is lowered from it (the
   * host's `--mw-base`). */
  baseline?: number;
  /** How Typed OM reads an out-of-flow box's `auto` minimum, the
   * probe's: `auto`, or in WebKit `0px`, which a `min-*-0` reads as too
   * (specs/anchor-positioning.md deviation 1). */
  autoMinimum?: string;
}

/** How a text decoration draws (specs/cell-model.md "Typography"): its
 * lines, style, color (resolved on the decorating box) and thickness,
 * one object per distinct value (`decorationOf`), so paints compare
 * them by identity. The underline's offset, inherited, is a glyph
 * property. */
export interface TextDecoration {
  readonly line: string;
  readonly style: string;
  readonly color: string;
  readonly thickness: string;
}

export const NO_DECORATION: TextDecoration = {
  line: "none",
  style: "solid",
  color: "currentcolor",
  thickness: "auto",
};

/** At most 256, as an animation's colors are endless. */
const decorations = new Map<string, TextDecoration>();

/** A decoration's value as a string. */
export const decorationKey = (value: TextDecoration): string =>
  `${value.line}|${value.style}|${value.color}|${value.thickness}`;

/** The one object for a decoration's value. */
export function decorationOf(value: TextDecoration): TextDecoration {
  if (!value.line || value.line === "none") return NO_DECORATION;
  const key = decorationKey(value);
  let decoration = decorations.get(key);
  if (!decoration) {
    if (decorations.size === 256) decorations.clear();
    decorations.set(key, (decoration = { ...value }));
  }
  return decoration;
}

export function defaultCellStyle(): CellStyle {
  return {
    display: "block",
    flexDirection: "row",
    flexReverse: false,
    flexWrap: "nowrap",
    wrapReverse: false,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: undefined,
    order: 0,
    // The CSS initial value `normal` reads as `stretch` (flex treats it
    // as `start`; grid stretches auto tracks).
    justifyContent: "stretch",
    justifyContentSafe: false,
    alignContent: "stretch",
    alignContentSafe: false,
    alignItems: "stretch",
    alignItemsSafe: false,
    alignItemsNormal: true,
    alignSelf: "auto",
    alignSelfSafe: false,
    justifyItems: "stretch",
    justifyItemsSafe: false,
    justifySelf: "auto",
    justifySelfSafe: false,
    gridTemplateColumns: { kind: "none" },
    gridTemplateRows: { kind: "none" },
    gridAutoColumns: [autoTrack()],
    gridAutoRows: [autoTrack()],
    gridAutoFlow: { direction: "row", dense: false },
    gridTemplateAreas: null,
    gridColumnStart: { kind: "auto" },
    gridColumnEnd: { kind: "auto" },
    gridRowStart: { kind: "auto" },
    gridRowEnd: { kind: "auto" },
    width: undefined,
    height: undefined,
    minWidth: "auto",
    minHeight: "auto",
    maxWidth: undefined,
    maxHeight: undefined,
    aspectRatio: null,
    padding: zeroInsets(),
    margin: zeroInsets(),
    position: "static",
    float: "none",
    clear: "none",
    insets: { top: null, right: null, bottom: null, left: null },
    gapX: null,
    gapY: null,
    border: zeroInsets(),
    borderWeight: { top: 1, right: 1, bottom: 1, left: 1 },
    borderStyle: { top: "solid", right: "solid", bottom: "solid", left: "solid" },
    borderRadius: { tl: 0, tr: 0, bl: 0, br: 0 },
    overflow: { x: "visible", y: "visible" },
    scrollbarWidth: "auto",
    scrollPadding: zeroInsets(),
    scrollbarSize: { x: 1, y: 1 },
    scrollbarInset: { x: 0, y: 0 },
    overscroll: { x: true, y: true },
    scrollbarColor: null,
    whiteSpace: "normal",
    tabSize: 8,
    textCase: "none",
    lineGap: 0,
    tracking: 0,
    textOverflow: "clip",
    lineClamp: null,
    color: undefined,
    backgroundColor: undefined,
    backgroundClear: false,
    backgroundImage: [],
    backgroundClip: "border-box",
    glyph: INITIAL_GLYPH,
    textDecoration: NO_DECORATION,
    borderColor: { top: undefined, right: undefined, bottom: undefined, left: undefined },
    textAlign: "start",
    textWrapStyle: "auto",
    wordBreak: "normal",
    textIndent: 0,
    tableRole: "none",
    tableLayout: "auto",
    borderCollapse: false,
    borderSpacingX: 0,
    borderSpacingY: 0,
    captionSide: "top",
    verticalAlign: "start",
    glyphSet: null,
    boxShadow: [],
    opacity: 1,
    visible: true,
    skipsContents: false,
    marker: null,
    pointerEvents: true,
    layer: null,
    stacking: false,
    anchorNames: [],
    anchorScope: null,
    positionAnchor: null,
    positionArea: null,
    positionTryFallbacks: [],
    positionTryOrder: "normal",
    positionVisibility: { anchorValid: false, anchorVisible: true, noOverflow: false },
    anchorCenter: { x: false, y: false },
    anchorSizes: {},
    anchorInsets: {},
    topLayer: false,
    backdrop: null,
    zIndex: null,
    latticeBorder: null,
    ruleX: null,
    ruleY: null,
    ruleBreak: "normal",
    ruleInset: 0,
    ruleVisibilityItems: "normal",
    columnCount: null,
    columnWidth: null,
    columnFill: "balance",
    columnSpan: false,
    breakBeforeColumn: false,
    breakAfterColumn: false,
    breakInsideAvoid: false,
  };
}

export function zeroInsets(): Insets {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/** A node as the tree builder makes it: laid out at its intrinsic size. */
export function createNode(
  source: Element,
  style: CellStyle,
  children: LayoutNode[] = [],
  text = "",
  intrinsicWidth = 0,
  intrinsicHeight = 0,
): LayoutNode {
  return {
    source,
    style,
    children,
    text,
    intrinsicWidth,
    intrinsicHeight,
    localRect: { x: 0, y: 0, width: intrinsicWidth, height: intrinsicHeight },
    paintOrigin: { x: 0, y: 0 },
    naturalContentHeight: 0,
    resolvedPadding: zeroInsets(),
  };
}

/** The CSS initial implicit-track size: `minmax(auto, auto)`. */
export function autoTrack(): TrackSize {
  return { min: { kind: "auto" }, max: { kind: "auto" } };
}
