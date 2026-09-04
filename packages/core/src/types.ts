export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Insets where any side can be `null` to signal `auto` (used for margins). */
export interface NullableInsets {
  top: number | null;
  right: number | null;
  bottom: number | null;
  left: number | null;
}

export type Size =
  | { kind: "cells"; value: number }
  | { kind: "percent"; value: number }
  | { kind: "auto" }
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
export type FlexDirection = "row" | "column";
export type FlexWrap = "nowrap" | "wrap";
export type JustifyContent =
  | "start"
  | "center"
  | "end"
  | "space-between"
  | "space-around"
  | "space-evenly"
  /** CSS `normal` / `stretch`. In flex both behave as `start` (per
   * css-align); in grid they stretch auto-sized tracks over leftover space
   * (CSS Grid §11.8) and otherwise behave as `start`. */
  | "stretch";
export type AlignItems = "start" | "center" | "end" | "stretch";
/** Multi-line cross distribution (`content-*`); `stretch` (the CSS
 * default `normal`) grows flex lines / grid tracks instead of offsetting
 * them. */
export type AlignContent = JustifyContent;
export type AlignSelf = "auto" | "start" | "center" | "end" | "stretch";
export type BorderStyle = "solid" | "double" | "dashed" | "dotted";
/** Per-axis overflow state. `hidden` reads as `"clip"` (no scroll
 * container, cheaper — the precise semantic for what the engine
 * does); `auto` and `scroll` are both scroll containers
 * (`scrollsAxis`), differing only in the gutter — `scroll` reserves
 * it always, `auto` only once content overflows. */
export type OverflowAxis = "visible" | "clip" | "auto" | "scroll";

export function scrollsAxis(axis: OverflowAxis): boolean {
  return axis === "auto" || axis === "scroll";
}
export interface Overflow {
  x: OverflowAxis;
  y: OverflowAxis;
}
export type Position = "static" | "relative" | "absolute" | "fixed" | "sticky";
/** `nowrap` disables soft wrapping; `pre` additionally preserves the
 * source's spaces and newlines (specs/cell-model.md). Everything else
 * (`pre-wrap` included) behaves as `normal`. */
export type WhiteSpace = "normal" | "nowrap" | "pre";

/** A length in whole cells, or a percentage kept symbolic until layout.
 * Percentages resolve against the CSS-appropriate basis at layout time:
 * the available extent for min/max (`max-w-full` = 100%), the containing
 * block's WIDTH for padding and margins (all four sides, per CSS), and the
 * container's own content box in the gap's axis for gaps. */
export type CellLength = number | { percent: number };

/** A min/max constraint: a CellLength, or an intrinsic sizing keyword
 * (`max-w-max` = `max-width: max-content`, …). Keywords are honored on
 * width limits and behave as "no constraint" on height limits (content
 * height already is the intrinsic height). */
export type SizeLimit = CellLength | "min-content" | "max-content" | "fit-content";
export type TextOverflow = "clip" | "ellipsis";

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
   * auto-fill pattern `minmax(min(8rem, 100%), 1fr)`. Resolvable only
   * when every argument is (a percent argument needs a definite axis);
   * otherwise the whole function behaves as `auto`. `calc()` arithmetic
   * stays unsupported (specs/grid.md deviations). */
  | { kind: "math"; fn: "min" | "max"; args: TrackBreadth[] };

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
  | { kind: "subgrid" }
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

/** A gap-decoration rule (specs/gap-decorations.md), from the rule-*
 * utilities' `--mw-rule-*` mirrors. `color` is always concrete:
 * currentColor resolves to the container's computed color at read time,
 * like border colors. */
export interface GapRule {
  width: number;
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
  style: PerSide<BorderStyle>;
  color: PerSide<string | undefined>;
  /** `border-style: hidden` (`border-hidden`): suppresses the shared
   * segment outright, beating any neighbor — its computed width is 0, so
   * the flag must ride separately (CSS 2.1 §17.6.2.1). */
  hidden: PerSide<boolean>;
}

/** One value per box edge (border style, border color, …). */
export interface PerSide<T> {
  top: T;
  right: T;
  bottom: T;
  left: T;
}

export interface CellStyle {
  display: Display;
  flexDirection: FlexDirection;
  /** True for `row-reverse` / `column-reverse`: the main axis runs
   * backwards — items lay out in reverse order and `justify-content`
   * start/end swap meaning. */
  flexReverse: boolean;
  flexWrap: FlexWrap;
  /** True for `wrap-reverse`: lines stack from the cross-end (bottom-up). */
  wrapReverse: boolean;
  flexGrow: number;
  flexShrink: number;
  /** CSS `flex-basis`: the flex base size when not `auto`/undefined —
   * notably `0%` from Tailwind's `flex-1`, which makes grow distribute ALL
   * the space (equal columns) instead of just the extra. */
  flexBasis: Size | undefined;
  /** CSS `order` — flex items sort by it (stable, document order ties). */
  order: number;
  justifyContent: JustifyContent;
  /** Flex: multi-line (wrap-enabled) containers only, per CSS. Grid: row
   * track distribution. */
  alignContent: AlignContent;
  alignItems: AlignItems;
  alignSelf: AlignSelf;
  /** Grid container inline-axis item alignment (`justify-items`); the CSS
   * default `normal` behaves as `stretch` in grid. */
  justifyItems: AlignItems;
  /** Grid item inline-axis self-alignment override (`justify-self`). */
  justifySelf: AlignSelf;
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
  padding: PerSide<CellLength>;
  /** `null` = `auto`. Percentages resolve against the parent's content
   * width where the margin is consumed. */
  margin: PerSide<CellLength | null>;
  /** See specs/positioning.md: fixed behaves as absolute anchored to the
   * host; sticky behaves as relative until the scrolling milestone. */
  position: Position;
  /** `top/right/bottom/left`; `null` = `auto`. Percentages resolve against
   * the containing block (width for left/right, height for top/bottom). */
  insets: PerSide<CellLength | null>;
  gapX: CellLength;
  gapY: CellLength;
  border: Insets;
  borderStyle: PerSide<BorderStyle>;
  borderColor: PerSide<string | undefined>;
  overflow: Overflow;
  /** `scrollbar-width: none` suppresses the gutter and bar entirely;
   * `thin` and `auto` both defer to `scrollbarSize`
   * (specs/scrolling.md). */
  scrollbarWidth: "auto" | "none";
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
  /** Empty rows between wrapped lines (`leading-*` re-quantized to the
   * grid: rows per line − 1). See specs/cell-model.md. */
  lineGap: number;
  /** Extra cells after every character (`tracking-*` re-quantized:
   * floor((letter-spacing − root letter-spacing) ÷ 0.025em)). */
  tracking: number;
  /** Paint-only: with `nowrap` + clipping, the browser draws the ellipsis.
   * The engine only needs it for the plain-text renderer's mirror of that. */
  textOverflow: TextOverflow;
  /**
   * Paint-only colors, reserved for the visual-system milestone. `color` will
   * feed decoration glyphs that visually belong to the text (control framing
   * like `[ Save ]`, cursors, selection carets); `backgroundColor` will feed
   * cell-level highlights (selection ranges, decoration backgrounds). Read
   * from the source element now so the future work has the data available.
   */
  color: string | undefined;
  backgroundColor: string | undefined;
  /** `bg-clear` marker (`--mw-bg-clear: 1`): occlude ancestor decoration
   * glyphs under this element's border box WITHOUT painting a bg color.
   * `backgroundColor` stays undefined; the renderer fills with plain
   * spaces instead of colored spaces. */
  backgroundClear: boolean;
  /** Paint-only text styling, passed through to the browser and
   * mirrored per-segment by the plain-text mode's spans. */
  fontWeight: string;
  fontStyle: string;
  textDecorationLine: string;
  /** True when text-align is `justify` — forced back to `start` (its
   * extra per-line word spacing is fractional). See cell-model spec. */
  textAlignBlocked: boolean;
  /** Computed text-align, normalized LTR. `end` offsets each line by
   * W − line, `center` by floor((W − line) / 2) — whole cells, painted
   * by the grid (the browser's own fractional centering only touches
   * the invisible light-DOM copy). */
  textAlign: "start" | "center" | "end";
  /** First-line indent in cells (per CSS: applies once to the first
   * formatted line of the block; `<br>` doesn't re-indent). Charged
   * against the wrap width of the first line and offsets that line's
   * paint x. Percentages resolve to 0 (unsupported). */
  textIndent: number;
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
   * Consumed by table cells (`td`/`th` default to the UA's `middle`;
   * `baseline` behaves as `start`) and by atomic inline boxes, where
   * only `end` (bottom) acts — it drops the line's text to the box's
   * last row (specs/cell-model.md). */
  verticalAlign: "start" | "center" | "end";
  /** Effective element opacity input (0..1). Ancestors MULTIPLY down
   * the paint walk (CSS opacity nests, it doesn't inherit); the product
   * rides on every emitted grid span, which composites against the
   * page — translucency blends with what's behind the host, never with
   * covered cells (deviation; front paint wins a cell as always). */
  opacity: number;
  /** The border glyph SET name from `--mw-border-glyphs` (`null` =
   * default) — the theming vocabulary borders/lattices/rules resolve
   * through (specs/theming.md); resolved on the decoration's owner. */
  glyphSet: string | null;
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

export interface LayoutNode {
  source: Element;
  style: CellStyle;
  children: LayoutNode[];
  /** The leaf's text run (inline descendants included, `<br>` as `\n`).
   * Empty for containers — their direct text nodes are not laid out. */
  text: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  localRect: Rect;
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
  inlineElements?: {
    element: Element;
    tracking: number;
    padLeft: number;
    padRight: number;
    insets: PerSide<number | null> | null;
    /** Paint-only styling mirrored into the grid (the browser's own
     * ink is transparent-locked). `backgroundColor` fills the run's
     * cells — how a focus-inverted inline link shows its highlight. */
    color: string | undefined;
    backgroundColor: string | undefined;
    fontWeight: string;
    fontStyle: string;
    textDecorationLine: string;
  }[];
  /** Per-character index into `inlineElements` (-1 = direct leaf text);
   * present only when the run contains inline elements. Plain-text
   * rendering maps colors, font styling, and relative inset shifts from
   * it. */
  charInline?: number[];
  /** True on an atomic inline-level box (`inline-flex`/`inline-block`/
   * `inline-grid`) riding its parent leaf's text run as a single
   * unbreakable unit: the leaf's run holds an OBJECT REPLACEMENT
   * CHARACTER (U+FFFC) for it whose advance is the box's laid-out width.
   * The box stays IN FLOW in the browser (sized to whole cells by the
   * companion stylesheet) so the browser's own line layout places it —
   * engine and browser agree because both treat it as an atomic unit of
   * the same width (specs/cell-model.md). */
  inlineBox?: boolean;
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
      }
    | undefined;
  /** True on a container whose direct text nodes were dropped (mixed
   * text + in-flow block children — cell-model deviation). The renderer
   * hides that text and warns instead of letting the browser paint it
   * unpositioned. */
  droppedText?: boolean;
  /** Engine-generated glyph runs in this node's local coordinates
   * (offset by its absolute position at paint time). Today: a collapsed
   * table's border lattice; future producers (css-gaps rules,
   * specs/gap-decorations.md) plug in here with no renderer changes. */
  decorationRuns?: BorderRun[];
  /** True on a node the table pass removed from rendering: misparented
   * table content (no anonymous boxes — specs/table.md) and `<col>`/
   * `<colgroup>` boxes (width carriers, never rendered). */
  tableHidden?: boolean;
  /** Outer height before min/max clamping — written by layoutNode; the
   * column flex algorithm's base main size (CSS distributes from unclamped
   * bases; limits apply via its freeze loop). */
  unclampedHeight: number;
  /** Content-derived outer height, before explicit-height/min-height
   * flooring — written by layoutNode. Table cells align their content
   * against this: an explicit cell height tallens the box (and floors
   * the row), but `vertical-align` centers the CONTENT, per CSS. */
  naturalContentHeight?: number;
  /** A text leaf's ink extent in content cells (widest line, rows) —
   * written by the leaf pass; scrollable-overflow accounting reads it
   * instead of re-wrapping. */
  textExtent?: { width: number; rows: number };
  /** Scroll geometry (specs/scrolling.md), written by layoutNode on
   * containers with a scroll axis: content extent and the derived
   * max offset, both in cells. Absent elsewhere. */
  scrollRange?: { sizeX: number; sizeY: number; maxX: number; maxY: number };
  /** Current scroll offset in cells (paint-time input, written by the
   * element from native scrollTop/scrollLeft; absent = 0/0). */
  scroll?: { x: number; y: number };
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
  width: number;
  height: number;
  letterSpacing: number;
  /** How far a glyph's ink extends past the cell's line box, in px
   * (some fonts' ascent + descent exceed their `normal` line box).
   * WebKit breaks columns at ink bottoms, so multicol leaves get this
   * much extra native column height (see styles.css). */
  inkOverhang?: number;
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
    alignContent: "stretch",
    alignItems: "stretch",
    alignSelf: "auto",
    justifyItems: "stretch",
    justifySelf: "auto",
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
    padding: zeroInsets(),
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    position: "static",
    insets: { top: null, right: null, bottom: null, left: null },
    gapX: 0,
    gapY: 0,
    border: zeroInsets(),
    borderStyle: { top: "solid", right: "solid", bottom: "solid", left: "solid" },
    overflow: { x: "visible", y: "visible" },
    scrollbarWidth: "auto",
    scrollbarSize: { x: 1, y: 1 },
    scrollbarInset: { x: 0, y: 0 },
    overscroll: { x: true, y: true },
    scrollbarColor: null,
    whiteSpace: "normal",
    tabSize: 8,
    lineGap: 0,
    tracking: 0,
    textOverflow: "clip",
    color: undefined,
    backgroundColor: undefined,
    backgroundClear: false,
    fontWeight: "400",
    fontStyle: "normal",
    textDecorationLine: "none",
    borderColor: { top: undefined, right: undefined, bottom: undefined, left: undefined },
    textAlignBlocked: false,
    textAlign: "start",
    textIndent: 0,
    tableRole: "none",
    tableLayout: "auto",
    borderCollapse: false,
    borderSpacingX: 0,
    borderSpacingY: 0,
    captionSide: "top",
    verticalAlign: "start",
    glyphSet: null,
    opacity: 1,
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

/** The CSS initial implicit-track size: `minmax(auto, auto)`. */
export function autoTrack(): TrackSize {
  return { min: { kind: "auto" }, max: { kind: "auto" } };
}
