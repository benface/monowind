import { collectGapRuleRuns } from "./borders.ts";
import type { RuleSegment } from "./borders.ts";
import { insetSegments } from "./flex.ts";
import {
  blockCrossOffset,
  collapseMargins,
  isOutOfFlow,
  layoutNode,
  leafLineMetrics,
  leafLineSpans,
  resolveGap,
  resolveMargin,
} from "./layout.ts";
import type { IntrinsicCache } from "./layout.ts";
import { wrapLineSpans } from "./wrap.ts";
import type {
  CellStyle,
  Insets,
  LayoutNode,
  MulticolLeafGeometry,
  NullableInsets,
} from "./types.ts";

/**
 * Multi-column layout (specs/multicol.md): css-multicol §3.4 column
 * resolution in cells, sequential/balanced fill, spanners, and column
 * rules through the gap-decoration pipeline. Direct-text leaves fragment
 * at line granularity; element children distribute atomically. Part of
 * the deliberate layout-module import cycle (see layout.ts).
 */

/** Used column count per css-multicol §3.4, from the computed
 * `column-count`/`column-width` pair. */
function usedColumnCount(style: CellStyle, available: number, gap: number): number {
  const fit =
    style.columnWidth !== null
      ? Math.max(1, Math.floor((available + gap) / (style.columnWidth + gap)))
      : null;
  if (style.columnCount !== null && fit !== null)
    return Math.max(1, Math.min(style.columnCount, fit));
  if (fit !== null) return fit;
  return Math.max(1, style.columnCount ?? 1);
}

/** Column tracks for an element-children container: base width
 * `floor((available − (count − 1) × gap) / count)` with the remainder
 * distributed one cell per column left to right. */
export function resolveColumnTracks(style: CellStyle, available: number, gap: number): number[] {
  const count = usedColumnCount(style, available, gap);
  const base = Math.max(1, Math.floor((available - (count - 1) * gap) / count));
  const leftover = Math.max(0, available - (count * base + (count - 1) * gap));
  return Array.from({ length: count }, (_, i) => base + (i < leftover ? 1 : 0));
}

/** Max-content inner width: `count × content + (count − 1) × gap` when
 * `column-count` drives the count (probed: all three engines agree);
 * with only `column-width`, the content's own max-content floored at
 * one `W`-wide column (Chromium/WebKit; Firefox clamps to `W` — a
 * documented divergence, specs/multicol.md). */
export function multicolIntrinsicInnerWidth(style: CellStyle, contentMax: number): number {
  const gap = Math.max(typeof style.gapX === "number" ? style.gapX : 0, style.ruleX?.width ?? 0);
  if (style.columnCount !== null) {
    return style.columnCount * contentMax + (style.columnCount - 1) * gap;
  }
  return Math.max(style.columnWidth ?? 1, contentMax);
}

/** The column-height restriction (css-multicol §7): the smaller of the
 * definite height and the max-height, either alone, or none. */
export function restrictingHeight(
  definite: number | undefined,
  max: number | undefined,
): number | undefined {
  if (definite === undefined) return max;
  if (max === undefined) return definite;
  return Math.min(definite, max);
}

/** Smallest `height` in `[lo, hi]` accepted by `fits` (monotonic). */
function minimalHeight(lo: number, hi: number, fits: (height: number) => boolean): number {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Column geometry for a TEXT LEAF: all columns equal at the base width,
 * the remainder reported so layout can fold it into the engine-owned
 * right padding — the browser's equal fractional columns then start on
 * the same whole cells as the engine's. */
export function resolveLeafColumns(
  style: CellStyle,
  available: number,
  gap: number,
): { count: number; width: number; leftover: number } {
  const count = usedColumnCount(style, available, gap);
  const width = Math.max(1, Math.floor((available - (count - 1) * gap) / count));
  const leftover = Math.max(0, available - (count * width + (count - 1) * gap));
  return { count, width, leftover };
}

/** Whether a rule paints in a gap given which side columns hold content:
 * CSS paints rules only between two columns that both have content
 * (`normal`/`between`); `around` needs either side, `all` always paints
 * (specs/gap-decorations.md item visibility). */
function ruleVisible(
  mode: CellStyle["ruleVisibilityItems"],
  before: boolean,
  after: boolean,
): boolean {
  if (mode === "all") return true;
  if (mode === "around") return before || after;
  return before && after;
}

/**
 * Fragment a multicol text leaf into columns (specs/multicol.md "Direct
 * text"): wrap at the column width, then fill columns sequentially into
 * the fill height — every line box spans its own leading (`height +
 * lineGap` rows, the browser's line-box model), and a line never splits
 * across columns. `balance` packs into the minimal height that needs at
 * most `count` columns (clamped to a definite height); `auto` with a
 * definite height fills each column to it, overflow columns catching
 * the rest.
 */
export function multicolLeafGeometry(
  node: LayoutNode,
  columns: { count: number; width: number },
  gap: number,
  definiteHeight: number | undefined,
): MulticolLeafGeometry {
  // Tracked text wraps at `width − tracking`: the browser fits a line
  // into its column COUNTING the phantom trailing letter-spacing gap
  // (probed in all three engines — the single-column carve-out has no
  // per-column equivalent, so the fit rule tightens instead).
  const spans = leafLineSpans(node, Math.max(1, columns.width - node.style.tracking));
  const { heights, textOffsets } = leafLineMetrics(node, spans);
  const lineGap = node.style.lineGap;
  const units = lineUnits(heights.map((h) => h + lineGap));

  let height: number;
  if (node.style.columnFill === "auto" && definiteHeight !== undefined) {
    height = Math.max(1, definiteHeight);
  } else {
    const balanced = minimalHeight(
      units.reduce((max, unit) => Math.max(max, unit.rows - lineGap), 1),
      Math.max(1, units.reduce((sum, unit) => sum + unit.rows, 0) - lineGap),
      (limit) => fillLineColumns(units, lineGap, limit).columns <= columns.count,
    );
    height =
      definiteHeight !== undefined ? Math.max(1, Math.min(balanced, definiteHeight)) : balanced;
  }

  const filled = fillLineColumns(units, lineGap, height);
  return {
    spans,
    lineY: filled.top,
    textY: filled.top.map((top, s) => top + textOffsets[s]!),
    lineX: filled.column.map((c) => c * (columns.width + gap)),
    totalRows: filled.maxUsed,
    columnCount: columns.count,
    columnWidth: columns.width,
    gap,
    columnsUsed: spans.length > 0 ? filled.columns : 0,
  };
}

/** One unit of a column fill: its rows (line box heights + trailing
 * leading), the collapsed margin rows before it (0 within a child),
 * whether a forced break precedes it, and its line count — an
 * unbreakable `break-inside: avoid` child contributes ONE unit
 * carrying all its lines. */
interface FillUnit {
  rows: number;
  pre: number;
  /** Glued trailing rows (a paragraph gap as padding-bottom): counted
   * with the unit at break checks, never trimmed or spilled. */
  post: number;
  forced: boolean;
  lines: number;
}

/** How `pre` rows behave at a column break (specs/multicol.md):
 * - "truncate": a break swallows the margin it lands in (CSS
 *   Fragmentation §5.2) — the spanless forced-height reconstruction,
 *   where the native gaps ARE margins.
 * - "glue": the spanner path, where the companion rewrites each gap as
 *   padding-bottom on the PRECEDING paragraph (`post` rows) —
 *   Chromium/Firefox keep a trailing padding monolithic with its last
 *   line (probed pixel-exact), so the gap sits invisibly at a column
 *   bottom and the next paragraph starts flush at the column top, the
 *   CSS-truncation look. WebKit instead slice-spills padding across
 *   breaks AND adds further in-engine divergences (fractional balance
 *   heights, post-spanner segment misplacement), so
 *   `detectGluedPreBreak` gates it back to the zero-margin constraint —
 *   see the layoutMulticol dispatch. */
type PreBreakMode = "truncate" | "glue";

/** Greedy sequential fill of line units into columns at `limit`:
 * LINE-major columns and top rows. Heights are TIGHT — a column of L
 * lines occupies `Σ(h + lineGap) − lineGap` rows, its last line's
 * trailing leading trimmed like a single-column leaf's (the companion
 * re-extends the native box by `lineGap` so the browser still counts
 * full line boxes). `pre` rows follow `mode` at breaks (see
 * PreBreakMode); the very first margin stays — a multicol container is
 * an independent formatting context, so it never parent-collapses. A
 * multi-line unit too tall for ANY column breaks to a fresh column and
 * then splits greedily (probed: Chromium/Firefox; WebKit instead
 * abandons `avoid` — documented divergence). Drives the balance
 * searches, the final maps, and the public `multicolLines` predictor. */
function fillLineColumns(
  units: FillUnit[],
  lineGap: number,
  limit: number,
  mode: PreBreakMode = "truncate",
): { columns: number; maxUsed: number; column: number[]; top: number[] } {
  let column = 0;
  let used = 0;
  let maxUsed = 0;
  const columnOf: number[] = [];
  const top: number[] = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    let lead = mode === "glue" || i === 0 || used > 0 ? unit.pre : 0;
    // A glued trailing pad is monolithic with its unit: the break check
    // counts it, and it never spills to the next column (probed).
    if (used > 0 && (unit.forced || used + lead + unit.rows + unit.post - lineGap > limit)) {
      if (mode === "truncate") lead = 0;
      column += 1;
      used = 0;
    }
    const lineRows = unit.rows / unit.lines;
    if (unit.lines > 1 && unit.rows - lineGap > limit) {
      // Too tall to keep whole: split greedily from the (fresh) column.
      for (let line = 0; line < unit.lines; line++) {
        if (used > 0 && used + lead + lineRows - lineGap > limit) {
          if (mode === "truncate") lead = 0;
          column += 1;
          used = 0;
        }
        columnOf.push(column);
        top.push(used + lead);
        used += lead + lineRows;
        lead = 0;
        maxUsed = Math.max(maxUsed, used - lineGap);
      }
      used += unit.post;
      if (unit.post > 0) maxUsed = Math.max(maxUsed, used);
      continue;
    }
    for (let line = 0; line < unit.lines; line++) {
      columnOf.push(column);
      top.push(used + lead + line * lineRows);
    }
    used += lead + unit.rows + unit.post;
    // A column ending in a bare line trims its trailing leading (tight
    // model); a glued pad sits below the FULL line box, untrimmed.
    maxUsed = Math.max(maxUsed, used - (unit.post > 0 ? 0 : lineGap));
  }
  return { columns: column + 1, maxUsed, column: columnOf, top };
}

/** Margin-less, break-less line units from per-line row heights. */
function lineUnits(rows: number[]): FillUnit[] {
  return rows.map((r) => ({ rows: r, pre: 0, post: 0, forced: false, lines: 1 }));
}

/** Whether the running browser GLUES a trailing padding to its last
 * line at a column break — measured once from a hidden fixture
 * replaying the probes' distinguishing case: a 3-line paragraph with
 * one row of padding-bottom, then a 2-line one, balanced into 2
 * columns. Glue (Chromium/Firefox) keeps the pad in column 0 and the
 * second paragraph starts flush atop column 1; WebKit slice-spills the
 * pad into column 1, pushing the paragraph a row down. An environment
 * that doesn't lay the fixture out (unit tests) measures nothing and
 * counts as glued. */
let detectedGluedPreBreak: boolean | null = null;
function detectGluedPreBreak(): boolean {
  if (detectedGluedPreBreak !== null) return detectedGluedPreBreak;
  // The fixture carries its own fixed geometry (the behavior it probes
  // is font-independent): `row` px per line, one row of padding-bottom,
  // 2 columns of 10 characters.
  const row = 20;
  const fixture = document.createElement("div");
  fixture.style.cssText =
    "position:absolute;left:-9999px;visibility:hidden;columns:2;column-gap:0;" +
    `column-fill:balance;width:200px;font:10px/${row}px monospace;orphans:1;widows:1`;
  fixture.innerHTML =
    `<div style="margin:0;padding:0 0 ${row}px 0">aaaaaa aaaaaa aaaaaa</div>` +
    '<div style="margin:0"><span>bbbbbb</span> bbbbbb</div>';
  document.body.appendChild(fixture);
  const fixtureTop = fixture.getBoundingClientRect().top;
  const probe = fixture.querySelector("span")!.getBoundingClientRect();
  fixture.remove();
  // Glued: the second paragraph starts at the column top (offset 0);
  // sliced: the spilled pad pushes it a full row down. Split the
  // difference for sub-pixel robustness.
  detectedGluedPreBreak = !(probe.width > 0 && probe.top - fixtureTop >= row / 2);
  return detectedGluedPreBreak;
}

/**
 * Predict a multicol TEXT LEAF's fragmentation — the multicol analogue
 * of `wrapLines`, sharing the engine's wrap and fill code so a
 * prediction can never drift from the layout. Returns each line with
 * its column and its TIGHT top row within the column. `restrictingHeight`
 * (the content-box height in rows, e.g. read from a rendered element)
 * reproduces any final layout — sequential fill into the final height
 * IS the layout, whatever fill mode produced it; without it, lines
 * balance into `columnCount` columns.
 */
export function multicolLines(
  text: string,
  options: {
    columnWidth: number;
    columnCount: number;
    tracking?: number;
    lineGap?: number;
    restrictingHeight?: number;
    /** `text-indent` charged to the first line (cells). */
    firstLineIndent?: number;
  },
): { text: string; column: number; top: number }[] {
  const { columnWidth, columnCount, tracking = 0, lineGap = 0, restrictingHeight } = options;
  const advances = tracking > 0 ? Array.from(text, () => 1 + tracking) : undefined;
  const spans = wrapLineSpans(text, Math.max(1, columnWidth - tracking), {
    advances,
    tracking,
    firstLineIndent: options.firstLineIndent,
  });
  const units = lineUnits(spans.map(() => 1 + lineGap));
  const height =
    restrictingHeight ??
    minimalHeight(1, Math.max(1, spans.length * (1 + lineGap) - lineGap), (limit) => {
      return fillLineColumns(units, lineGap, limit).columns <= columnCount;
    });
  const filled = fillLineColumns(units, lineGap, height);
  return spans.map((span, i) => ({
    text: text.slice(span.start, span.end),
    column: filled.column[i]!,
    top: filled.top[i]!,
  }));
}

/** Column rules for a multicol leaf or paragraph-flow container: one
 * band per gap per SEGMENT (a spanless geometry paints one full-height
 * segment), visibility per the side columns' occupancy. */
export function multicolLeafRuleRuns(
  node: LayoutNode,
  geometry: MulticolLeafGeometry,
  border: Insets,
  padding: Insets,
): void {
  const style = node.style;
  if (!style.ruleX) return;
  const contentWidth =
    geometry.columnCount * geometry.columnWidth + (geometry.columnCount - 1) * geometry.gap;
  const extents = geometry.ruleSegments ?? [
    { start: 0, end: geometry.totalRows, columns: geometry.columnsUsed },
  ];
  const vertical: RuleSegment[] = [];
  for (const extent of extents) {
    const occupied = Math.min(extent.columns, geometry.columnCount);
    for (let g = 0; g < geometry.columnCount - 1; g++) {
      if (!ruleVisible(style.ruleVisibilityItems, g < occupied, g + 1 < occupied)) continue;
      vertical.push({
        bandStart: (g + 1) * geometry.columnWidth + g * geometry.gap,
        bandSize: geometry.gap,
        start: extent.start,
        end: extent.end,
      });
    }
  }
  node.decorationRuns = collectGapRuleRuns({
    ruleX: style.ruleX,
    ruleY: null,
    vertical: insetSegments(vertical, style.ruleInset),
    horizontal: [],
    contentWidth,
    contentHeight: geometry.totalRows,
    border,
    borderStyle: style.borderStyle,
    borderColor: style.borderColor,
    padding,
  });
}

interface MulticolUnit {
  node: LayoutNode;
  margin: NullableInsets;
  breakBefore: boolean;
}

/** A chrome-less text-leaf child, eligible to fragment at line
 * granularity in a paragraph-flow container (specs/multicol.md
 * "Fragmenting text-leaf children"): static block, childless text, no
 * border/padding/background/sizing/span, normal white-space, and the
 * container's own line gap (the native box shares the container's
 * inherited line-height and trailing-leading extension). */
function isFragmentableLeaf(child: LayoutNode, container: CellStyle): boolean {
  const style = child.style;
  const insets = style.padding;
  return (
    child.text !== "" &&
    child.children.length === 0 &&
    style.display === "block" &&
    style.position === "static" &&
    !style.columnSpan &&
    style.whiteSpace === "normal" &&
    style.lineGap === container.lineGap &&
    style.border.top === 0 &&
    style.border.right === 0 &&
    style.border.bottom === 0 &&
    style.border.left === 0 &&
    insets.top === 0 &&
    insets.right === 0 &&
    insets.bottom === 0 &&
    insets.left === 0 &&
    style.backgroundColor === undefined &&
    !style.backgroundClear &&
    (style.width === undefined || style.width.kind === "auto") &&
    (style.height === undefined || style.height.kind === "auto") &&
    (style.minWidth === "auto" || style.minWidth === 0 || style.minWidth === undefined) &&
    (style.minHeight === "auto" || style.minHeight === 0 || style.minHeight === undefined) &&
    style.maxWidth === undefined &&
    style.maxHeight === undefined
  );
}

/**
 * Paragraph flow (specs/multicol.md "Fragmenting text-leaf children"):
 * every in-flow child is a chrome-less text leaf, so children fragment
 * at line granularity like the container's own direct text. One unit
 * stream drives the fill — each child's wrapped lines as full line
 * boxes, collapsed margins between children, a break truncating any
 * margin it lands in, the column end trimming the trailing leading
 * (tight model). Children keep their per-line maps
 * (`multicolGeometry`, container-content coordinates) and stay IN FLOW
 * in the browser (`multicolFlow`); the container gets a spanless
 * geometry for its rules, height fold, and native column vars.
 * Returns content height (rows used).
 */
function layoutMulticolFlow(
  node: LayoutNode,
  inFlow: LayoutNode[],
  innerWidth: number,
  restriction: number | undefined,
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const style = node.style;
  const gap = resolveGap(style, "x", innerWidth);
  const columns = resolveLeafColumns(style, innerWidth, gap);
  padding.right += columns.leftover;
  const lineGap = style.lineGap;
  const originX = border.left + padding.left;
  const originY = border.top + padding.top;
  const contentWidth = innerWidth - columns.leftover;

  // Split the flow into segments at in-flow spanners.
  const segments: LayoutNode[][] = [[]];
  const spannerAfter: (LayoutNode | undefined)[] = [];
  for (const child of inFlow) {
    if (child.style.columnSpan) {
      spannerAfter[segments.length - 1] = child;
      segments.push([]);
    } else {
      segments[segments.length - 1]!.push(child);
    }
  }
  const hasSpanners = segments.length > 1;
  // With spanners the native balancer is trusted, and the companion
  // rewrites inter-paragraph gaps as padding-bottom on the preceding
  // paragraph (margins derail it — see the spec), glued to its last
  // line. No detection needed HERE: the dispatch gate keeps non-glue
  // (WebKit) spanner flow margin-less, and with every gap 0 the two
  // modes are identical. Spanless flow keeps real native margins under
  // a forced height, where breaks truncate them.
  const preBreakMode: PreBreakMode = hasSpanners ? "glue" : "truncate";

  const ruleSegments: { start: number; end: number; columns: number }[] = [];
  let segTop = 0;
  let columnsUsed = 0;
  for (let seg = 0; seg < segments.length; seg++) {
    const paragraphs = segments[seg]!;
    // A segment's last bottom margin: the companion zeroes native
    // paragraph bottoms, so it survives by transfer into the following
    // spanner's top margin — a SUM, per css-multicol §6.1 (spanner
    // margins never collapse with column content).
    let trailingBottom = 0;
    if (paragraphs.length > 0) {
      const children = paragraphs.map((child) => ({
        node: child,
        spans: leafLineSpans(child, Math.max(1, columns.width - child.style.tracking)),
        margin: resolveMargin(child.style.margin, columns.width),
        pre: 0,
        post: 0,
      }));
      const units: FillUnit[] = [];
      let prevBottom: number | null = null;
      let prevChild: (typeof children)[number] | null = null;
      let pendingBreak = false;
      for (const child of children) {
        const { node, spans, margin } = child;
        const gap =
          prevBottom === null ? (margin.top ?? 0) : collapseMargins(prevBottom, margin.top ?? 0);
        // Glue mode rides each inter-paragraph gap as the PRECEDING
        // child's padding-bottom (its last unit's glued `post`); the
        // segment-leading gap, which no break can precede, stays the
        // first child's own padding-top. Truncate mode keeps every gap
        // as the following child's margin (`pre`).
        let pre = gap;
        if (preBreakMode === "glue" && prevChild !== null) {
          pre = 0;
          prevChild.post = gap;
          units[units.length - 1]!.post = gap;
        } else {
          child.pre = gap;
        }
        const forced = pendingBreak || node.style.breakBeforeColumn;
        if (node.style.breakInsideAvoid && spans.length > 0) {
          // The whole child is one unbreakable unit (probed: engines
          // keep it whole, or split from a fresh column when too tall).
          units.push({
            rows: spans.length * (1 + lineGap),
            pre,
            post: 0,
            forced,
            lines: spans.length,
          });
        } else {
          for (let s = 0; s < spans.length; s++) {
            units.push({
              rows: 1 + lineGap,
              pre: s > 0 ? 0 : pre,
              post: 0,
              forced: s === 0 && forced,
              lines: 1,
            });
          }
        }
        if (spans.length > 0) {
          prevBottom = margin.bottom ?? 0;
          prevChild = child;
        }
        pendingBreak = node.style.breakAfterColumn;
      }
      trailingBottom = prevBottom ?? 0;

      let height: number;
      if (style.columnFill === "auto" && restriction !== undefined) {
        height = Math.max(1, restriction);
      } else {
        const balanced = minimalHeight(
          1,
          Math.max(
            1,
            fillLineColumns(units, lineGap, Number.POSITIVE_INFINITY, preBreakMode).maxUsed,
          ),
          (limit) => fillLineColumns(units, lineGap, limit, preBreakMode).columns <= columns.count,
        );
        height =
          restriction !== undefined ? Math.max(1, Math.min(balanced, restriction)) : balanced;
      }
      const filled = fillLineColumns(units, lineGap, height, preBreakMode);

      for (let c = 0, line = 0; c < children.length; c++) {
        const { node: child, spans, margin, pre, post } = children[c]!;
        const lineY: number[] = [];
        const lineX: number[] = [];
        for (let s = 0; s < spans.length; s++, line++) {
          lineY.push(segTop + filled.top[line]!);
          lineX.push(filled.column[line]! * (columns.width + gap));
        }
        delete child.decorationRuns;
        child.multicolGeometry = {
          spans,
          lineY,
          textY: lineY,
          lineX,
          totalRows: segTop + filled.maxUsed,
          columnCount: columns.count,
          columnWidth: columns.width,
          gap,
          columnsUsed: filled.columns,
        };
        // Spanner containers: the companion reinterprets the vertical
        // gaps as padding (engine-collapsed, so native sibling
        // collapsing can't disagree) — the segment-leading gap as this
        // child's padding-top, each inter-paragraph gap as the
        // PRECEDING child's padding-bottom — see the
        // [data-mw-multicol-balance] child rule.
        child.multicolFlow = hasSpanners
          ? { top: pre, right: margin.right, bottom: post, left: margin.left }
          : margin;
        child.localRect = { x: originX, y: originY, width: contentWidth, height: filled.maxUsed };
        child.resolvedPadding = { top: 0, right: 0, bottom: 0, left: 0 };
      }
      if (units.length > 0) {
        ruleSegments.push({ start: segTop, end: segTop + filled.maxUsed, columns: filled.columns });
        columnsUsed = Math.max(columnsUsed, filled.columns);
        // The browser stacks a non-final segment's columns as FULL line
        // boxes — its trailing leading stays before the spanner.
        segTop += filled.maxUsed + (seg < segments.length - 1 ? lineGap : 0);
      }
    }
    const spanner = spannerAfter[seg];
    if (spanner) {
      // In-flow spanner (css-multicol §6.1, probed): the columns' full
      // extent (the folded content width, so it aligns with the tracks),
      // margins never collapsing with column content, the native
      // balancer handling the segments around it.
      const margin = resolveMargin(spanner.style.margin, contentWidth);
      const marginX = (margin.left ?? 0) + (margin.right ?? 0);
      layoutNode(spanner, Math.max(0, contentWidth - marginX), undefined, 0, 0, "fill", cache);
      const cross = blockCrossOffset(margin, contentWidth, spanner.localRect.width);
      const marginTop = (margin.top ?? 0) + trailingBottom;
      segTop += marginTop;
      spanner.localRect = { ...spanner.localRect, x: originX + cross, y: originY + segTop };
      spanner.multicolFlowSpan = {
        top: marginTop,
        right: 0,
        bottom: margin.bottom ?? 0,
        left: cross,
      };
      segTop += spanner.localRect.height + (margin.bottom ?? 0);
    }
  }
  const totalRows = segTop;

  for (const child of node.children) {
    if (!isOutOfFlow(child.style)) continue;
    const margin = resolveMargin(child.style.margin, innerWidth);
    child.staticSlot = {
      kind: "block",
      x: originX + (margin.left ?? 0),
      y: originY + (margin.top ?? 0),
    };
  }
  // Spanless container geometry: drives the column rules and the
  // vertical-slack fold in layoutNode, and the native column vars.
  node.multicolGeometry = {
    spans: [],
    lineY: [],
    textY: [],
    lineX: [],
    totalRows,
    columnCount: columns.count,
    columnWidth: columns.width,
    gap,
    columnsUsed,
    ...(hasSpanners ? { ruleSegments, nativeBalance: true } : {}),
  };
  return totalRows;
}

/**
 * Lay out a multicol container's element children (specs/multicol.md
 * "Element children"): children are atomic (never split across columns),
 * measured at the column width, and packed sequentially — a new column
 * when the next child would exceed the fill height or at a forced break.
 * Adjacent margins collapse within a column; a margin at a column break
 * truncates at the column top. `column-span: all` children split the
 * flow into stacked segments that each balance independently. Returns
 * content height (rows used).
 */
export function layoutMulticol(
  node: LayoutNode,
  innerWidth: number,
  definiteInnerHeight: number | undefined,
  maxInnerHeight: number | undefined,
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const style = node.style;
  // Only a definite height makes `column-fill: auto` pad segments (and
  // rules) to the full fill; max-height merely restricts.
  const restriction = restrictingHeight(definiteInnerHeight, maxInnerHeight);
  // Paragraph flow: every in-flow child a chrome-less text leaf (or a
  // spanner) → text fragments at line granularity instead of
  // distributing atomically. With spanners the native balancer handles
  // the segments, which the probes pin down for unrestricted heights
  // and `column-fill: balance`; paragraph margins ride along as
  // companion-written padding glued to the preceding paragraph. Both
  // require a browser whose balancer the engine can predict. WebKit
  // slice-spills padding at breaks (so margins there fall back to
  // atomic) and balances segments in INK-HEIGHT sub-pixels — the
  // fractional height corrupts the ORIGIN of whatever segment follows,
  // flipping its distribution (probed live) — so WebKit flow also
  // requires all paragraphs in ONE segment (spanners only at the
  // edges), whose origin is engine-quantized boxes alone.
  const inFlow = node.children.filter((child) => !isOutOfFlow(child.style));
  const paragraphs = inFlow.filter((child) => !child.style.columnSpan);
  const paragraphSegments = inFlow.reduce(
    (count, child, i) =>
      !child.style.columnSpan && (i === 0 || inFlow[i - 1]!.style.columnSpan) ? count + 1 : count,
    0,
  );
  if (
    paragraphs.length > 0 &&
    paragraphs.every((child) => isFragmentableLeaf(child, style)) &&
    (paragraphs.length === inFlow.length ||
      (style.columnFill === "balance" &&
        restriction === undefined &&
        (detectGluedPreBreak() ||
          (paragraphSegments <= 1 &&
            paragraphs.every(
              (child) =>
                (child.style.margin.top === 0 || child.style.margin.top === null) &&
                (child.style.margin.bottom === 0 || child.style.margin.bottom === null),
            )))))
  ) {
    return layoutMulticolFlow(node, inFlow, innerWidth, restriction, border, padding, cache);
  }
  const gap = resolveGap(style, "x", innerWidth);
  const widths = resolveColumnTracks(style, innerWidth, gap);
  const count = widths.length;
  const xOffsets: number[] = [];
  {
    let x = 0;
    for (const w of widths) {
      xOffsets.push(x);
      x += w + gap;
    }
  }
  // Overflow columns (css-multicol §7.2) continue past the last track at
  // its width.
  const columnX = (c: number): number =>
    c < count ? xOffsets[c]! : xOffsets[count - 1]! + (c - count + 1) * (widths[count - 1]! + gap);
  const columnWidthAt = (c: number): number => widths[Math.min(c, count - 1)]!;
  // Children measure at the NARROWEST track so a remainder column never
  // overflows its fill height; placement re-lays out at the real width.
  const measureWidth = widths[count - 1]!;
  const originX = border.left + padding.left;
  const originY = border.top + padding.top;

  const vertical: RuleSegment[] = [];
  let y = 0;
  let segment: MulticolUnit[] = [];
  let pendingSlots: { child: LayoutNode; margin: NullableInsets; index: number }[] = [];
  let pendingBreak = false;

  /** Greedy sequential pack of the segment at `limit`; `place` also
   * writes child rects and resolves out-of-flow static slots at their
   * column-flow positions. Returns columns used and the tallest column. */
  const pack = (limit: number, place: boolean): { columns: number; maxUsed: number } => {
    let c = 0;
    let used = 0;
    let prevBottom: number | null = null;
    let maxUsed = 0;
    // Static position of an out-of-flow child between two units: the
    // current column-flow position, its own top margin collapsing like a
    // sibling's (specs/positioning.md).
    const resolveSlots = (index: number): void => {
      if (!place) return;
      for (const pending of pendingSlots) {
        if (pending.index !== index) continue;
        const lead =
          prevBottom === null
            ? (pending.margin.top ?? 0)
            : collapseMargins(prevBottom, pending.margin.top ?? 0);
        pending.child.staticSlot = {
          kind: "block",
          x: originX + columnX(c) + (pending.margin.left ?? 0),
          y: originY + y + used + lead,
        };
      }
    };
    for (let i = 0; i < segment.length; i++) {
      const unit = segment[i]!;
      resolveSlots(i);
      let joint =
        prevBottom === null
          ? i === 0
            ? (unit.margin.top ?? 0)
            : 0
          : collapseMargins(prevBottom, unit.margin.top ?? 0);
      const height = unit.node.localRect.height;
      if (prevBottom !== null && (unit.breakBefore || used + joint + height > limit)) {
        c += 1;
        used = 0;
        prevBottom = null;
        joint = 0;
      }
      if (place) {
        const child = unit.node;
        const colWidth = columnWidthAt(c);
        if (colWidth !== measureWidth) {
          const marginX = (unit.margin.left ?? 0) + (unit.margin.right ?? 0);
          layoutNode(
            child,
            Math.max(0, colWidth - marginX),
            definiteInnerHeight,
            0,
            0,
            "fill",
            cache,
          );
        }
        child.localRect = {
          ...child.localRect,
          x: originX + columnX(c) + blockCrossOffset(unit.margin, colWidth, child.localRect.width),
          y: originY + y + used + joint,
        };
      }
      used += joint + unit.node.localRect.height;
      maxUsed = Math.max(maxUsed, used);
      prevBottom = unit.margin.bottom ?? 0;
    }
    resolveSlots(segment.length);
    return { columns: c + 1, maxUsed };
  };

  const flushSegment = (): void => {
    if (segment.length === 0) {
      // Out-of-flow children in an empty segment sit at its start.
      for (const pending of pendingSlots) {
        pending.child.staticSlot = {
          kind: "block",
          x: originX + (pending.margin.left ?? 0),
          y: originY + y + (pending.margin.top ?? 0),
        };
      }
      pendingSlots = [];
      return;
    }
    const availableH = restriction === undefined ? undefined : Math.max(1, restriction - y);
    const fillsToHeight = style.columnFill === "auto" && availableH !== undefined;
    let height: number;
    if (fillsToHeight) {
      height = availableH!;
    } else {
      // Minimal height needing at most `count` columns; forced breaks and
      // margin collapsing are inside `pack`, so the search runs on it.
      const balanced = minimalHeight(1, pack(Number.POSITIVE_INFINITY, false).maxUsed, (limit) => {
        return pack(limit, false).columns <= count;
      });
      height = availableH !== undefined ? Math.min(balanced, availableH) : balanced;
    }
    const packed = pack(height, true);
    // A DEFINITE-height sequential fill keeps its column boxes (and
    // rules) at the full fill height; balanced and max-height-restricted
    // segments are exactly as tall as their tallest column. A lone child
    // taller than the fill height still grows the segment (monolithic
    // overflow).
    const segmentRows =
      fillsToHeight && definiteInnerHeight !== undefined
        ? Math.max(packed.maxUsed, height)
        : packed.maxUsed;
    if (style.ruleX) {
      for (let g = 0; g < count - 1; g++) {
        const columnsFilled = Math.min(packed.columns, count);
        if (!ruleVisible(style.ruleVisibilityItems, g < columnsFilled, g + 1 < columnsFilled))
          continue;
        vertical.push({
          bandStart: xOffsets[g]! + widths[g]!,
          bandSize: gap,
          start: y,
          end: y + segmentRows,
        });
      }
    }
    y += segmentRows;
    segment = [];
    pendingSlots = [];
  };

  for (const child of node.children) {
    if (isOutOfFlow(child.style)) {
      // Deferred: the placement pack resolves the static slot at the
      // column-flow position the box would have occupied.
      pendingSlots.push({
        child,
        margin: resolveMargin(child.style.margin, innerWidth),
        index: segment.length,
      });
      continue;
    }
    if (child.style.columnSpan) {
      // Spanner (css-multicol §6.1): full content width, stacked between
      // segments; its margins don't collapse with column content
      // (specs/multicol.md deviation 5).
      flushSegment();
      pendingBreak = false;
      const margin = resolveMargin(child.style.margin, innerWidth);
      const marginX = (margin.left ?? 0) + (margin.right ?? 0);
      layoutNode(
        child,
        Math.max(0, innerWidth - marginX),
        definiteInnerHeight,
        0,
        0,
        "fill",
        cache,
      );
      y += margin.top ?? 0;
      child.localRect = {
        ...child.localRect,
        x: originX + blockCrossOffset(margin, innerWidth, child.localRect.width),
        y: originY + y,
      };
      y += child.localRect.height + (margin.bottom ?? 0);
      continue;
    }
    const columnMargin = resolveMargin(child.style.margin, measureWidth);
    const marginX = (columnMargin.left ?? 0) + (columnMargin.right ?? 0);
    layoutNode(
      child,
      Math.max(0, measureWidth - marginX),
      definiteInnerHeight,
      0,
      0,
      "fill",
      cache,
    );
    segment.push({
      node: child,
      margin: columnMargin,
      breakBefore: pendingBreak || child.style.breakBeforeColumn,
    });
    pendingBreak = child.style.breakAfterColumn;
  }
  flushSegment();

  if (style.ruleX && vertical.length > 0) {
    node.decorationRuns = collectGapRuleRuns({
      ruleX: style.ruleX,
      ruleY: null,
      vertical: insetSegments(vertical, style.ruleInset),
      horizontal: [],
      contentWidth: innerWidth,
      contentHeight: y,
      border,
      borderStyle: style.borderStyle,
      borderColor: style.borderColor,
      padding,
    });
  }
  return y;
}
