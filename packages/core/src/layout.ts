import { percentToCells } from "./metrics.ts";
import {
  advanceOf,
  eachObjectMarker,
  hardLineSpans,
  lineAdvance,
  longestSegmentAdvance,
  OBJECT_REPLACEMENT,
  wrapLineSpans,
} from "./wrap.ts";
import type { LineSpan } from "./wrap.ts";
import {
  alignCrossOffset,
  effectiveJustify,
  layoutFlexColumn,
  layoutFlexRow,
  mainAxisOffsets,
} from "./flex.ts";
import { gridIntrinsicInnerWidths, layoutGrid } from "./grid.ts";
import {
  layoutMulticol,
  multicolIntrinsicInnerWidth,
  multicolLeafGeometry,
  multicolLeafRuleRuns,
  resolveLeafColumns,
  restrictingHeight,
} from "./multicol.ts";
import { layoutTable, tableIntrinsicInnerWidths, tableUsedOuterWidth } from "./table.ts";
import type { TableData } from "./table.ts";
import { walkPositioned } from "./positioning.ts";
import { warnOnce } from "./warn.ts";
import type {
  CellLength,
  CellStyle,
  Insets,
  LayoutNode,
  MulticolLeafGeometry,
  NullableInsets,
  PerSide,
  Size,
  SizeLimit,
} from "./types.ts";

/**
 * Core layout: the per-node sizing pipeline, block flow, and the shared
 * sizing/intrinsic machinery. Flex lives in flex.ts, the positioning pass
 * in positioning.ts, each mirroring its spec file. The modules are
 * mutually recursive (children lay out through layoutNode), so the import
 * cycle between them is deliberate — safe because they contain only
 * hoisted function declarations with no top-level cross-module execution.
 */

/**
 * Layout entry point: mutates localRect on the root and each descendant.
 * Coordinates are parent-relative (root's rect is at 0,0).
 */
export function layoutRoot(root: LayoutNode, availableWidth: number): { height: number } {
  const cache = makeIntrinsicCache();
  layoutNode(root, availableWidth, undefined, 0, 0, "fill", cache);
  // Positioning pass (specs/positioning.md): out-of-flow boxes were skipped
  // by flow layout; place them against their containing blocks, and apply
  // relative offsets. Runs top-down so ancestor rects are final first.
  walkPositioned(root, 0, 0, [{ node: root, absX: 0, absY: 0 }], cache);
  return { height: root.localRect.height };
}

/** absolute / fixed boxes are out of normal flow. */
export function isOutOfFlow(style: CellStyle): boolean {
  return style.position === "absolute" || style.position === "fixed";
}

/** A containing block for absolute descendants, per CSS. */
export function isPositioned(style: CellStyle): boolean {
  return style.position !== "static";
}

export type SizingMode = "fill" | "shrink";

export interface IntrinsicCache {
  maxContent: WeakMap<LayoutNode, number>;
  minContent: WeakMap<LayoutNode, number>;
  /** Grid containers compute both intrinsic widths in one placement +
   * sizing pass — cached here so the min and max lookups share it. */
  gridIntrinsic: WeakMap<LayoutNode, { min: number; max: number }>;
  /** Table structure + chrome + column bounds, shared by the intrinsic,
   * width-resolution, and layout passes. */
  tableData: WeakMap<LayoutNode, TableData>;
}

export function makeIntrinsicCache(): IntrinsicCache {
  return {
    maxContent: new WeakMap(),
    minContent: new WeakMap(),
    gridIntrinsic: new WeakMap(),
    tableData: new WeakMap(),
  };
}

/**
 * `forced` carries flex-assigned ("used") sizes from a parent flex pass —
 * they are authoritative and skip resolution/clamping entirely (the flex
 * loop already applied min/max). With sizes forced, `availableWidth` stays
 * the CONTAINING BLOCK's content width, which percent padding, margins,
 * and min/max resolve against — never the assigned size itself.
 */
export function layoutNode(
  node: LayoutNode,
  availableWidth: number,
  availableHeight: number | undefined,
  parentX: number,
  parentY: number,
  widthMode: SizingMode,
  cache: IntrinsicCache,
  forced?: { width?: number | undefined; height?: number | undefined },
): void {
  const style = node.style;
  const forcedHeight = forced?.height;
  // Fresh per layout: only the pass that runs (table lattice, flex/grid
  // gap rules, multicol) repopulates them.
  delete node.decorationRuns;
  delete node.multicolGeometry;
  delete node.multicolFlow;
  delete node.multicolFlowSpan;

  // Width is clamped to min/max BEFORE laying out content — wrapping and
  // child sizing must see the constrained width, not the raw resolved one.
  // (Height differs: max-height clamps the final rect after layout, since
  // content height is an output, and overflow handles the spill.)
  // Percent min/max (`max-w-full`) resolve against the available size; a
  // percent height limit with indefinite available height is ignored, per CSS.
  const minWidth = resolveWidthLimit(style.minWidth, availableWidth, node, cache) ?? 0;
  const maxWidth = resolveWidthLimit(style.maxWidth, availableWidth, node, cache);
  const minHeight = resolveLimit(style.minHeight, availableHeight) ?? 0;
  const maxHeight = resolveLimit(style.maxHeight, availableHeight);
  // Percent padding resolves against the containing block's width (CSS: all
  // four sides use the inline size) — `availableWidth` is that width here.
  // Stored on the node because the renderers need the resolved cells too.
  const padding: Insets = {
    top: resolveLength(style.padding.top, availableWidth),
    right: resolveLength(style.padding.right, availableWidth),
    bottom: resolveLength(style.padding.bottom, availableWidth),
    left: resolveLength(style.padding.left, availableWidth),
  };
  node.resolvedPadding = padding;
  const outerWidth =
    forced?.width ??
    clampSize(resolveWidth(style, availableWidth, widthMode, node, cache), minWidth, maxWidth);
  const outerHeightExplicit = resolveHeight(style, availableHeight);
  // A `forcedHeight` (set by a parent flex-column when grow/shrink assigned a
  // main-axis size) overrides both explicit `height` and `min-height` — the
  // flex algorithm's "used main size" is authoritative. Otherwise, `min-height`
  // is a lower bound so items-center / items-end see the enforced size, not
  // just the natural content size.
  const outerHeightFloor =
    forcedHeight ?? outerHeightExplicit ?? (minHeight > 0 ? minHeight : undefined);

  const inner = shrinkSize(
    outerWidth,
    outerHeightFloor ?? Number.POSITIVE_INFINITY,
    style.border,
    padding,
  );

  // Whether the height is definite (explicit `height` or a parent-assigned
  // flex size) rather than only a `min-height` floor. Column flex: a floor
  // adds grow space but never triggers shrink. Everywhere: only a DEFINITE
  // content height is the basis for children's percent heights, per CSS.
  const heightIsDefinite = forcedHeight !== undefined || outerHeightExplicit !== undefined;
  const definiteInnerHeight =
    heightIsDefinite && Number.isFinite(inner.height) ? inner.height : undefined;

  // `height` and `max-height` both RESTRICT multicol column heights
  // (css-multicol §7), unlike other displays where max-height only clamps
  // the final rect and overflow spills.
  const maxInnerHeight =
    maxHeight === undefined
      ? undefined
      : Math.max(
          0,
          maxHeight - style.border.top - style.border.bottom - padding.top - padding.bottom,
        );

  let contentHeight: number;
  if (laysOutAsTextLeaf(node)) {
    contentHeight = layoutTextLeaf(
      node,
      inner.width,
      inner.height,
      definiteInnerHeight,
      maxInnerHeight,
      padding,
      cache,
    );
  } else if (style.display === "flex" && style.flexDirection === "row") {
    contentHeight = layoutFlexRow(
      node,
      inner.width,
      inner.height,
      definiteInnerHeight,
      style.border,
      padding,
      cache,
    );
  } else if (style.display === "flex" && style.flexDirection === "column") {
    contentHeight = layoutFlexColumn(
      node,
      inner.width,
      inner.height,
      heightIsDefinite,
      style.border,
      padding,
      cache,
    );
  } else if (style.display === "grid") {
    contentHeight = layoutGrid(node, inner.width, inner.height, style.border, padding, cache);
  } else if (style.display === "table") {
    contentHeight = layoutTable(
      node,
      inner.width,
      definiteInnerHeight,
      style.border,
      padding,
      cache,
    );
  } else if (style.display === "multicol") {
    contentHeight = layoutMulticol(
      node,
      inner.width,
      definiteInnerHeight,
      maxInnerHeight,
      style.border,
      padding,
      cache,
    );
  } else {
    contentHeight = layoutBlock(
      node,
      inner.width,
      definiteInnerHeight,
      style.border,
      padding,
      cache,
    );
  }

  const naturalHeight =
    contentHeight + style.border.top + style.border.bottom + padding.top + padding.bottom;
  // Order matters: min-* is a floor, max-* is a ceiling; when both apply,
  // max wins per CSS (min-width < max-width is required, but if the author
  // sets an inconsistent pair CSS clamps to `max(min, min(max, value))`).
  // The pre-clamp height is the column flex algorithm's base size (CSS
  // distributes from UNclamped bases; min/max apply via its freeze loop).
  const unclampedHeight = forcedHeight ?? outerHeightExplicit ?? naturalHeight;
  node.unclampedHeight = unclampedHeight;
  node.naturalContentHeight = naturalHeight;
  const finalHeight = clampSize(unclampedHeight, minHeight, maxHeight);

  // Multicol browser agreement (leaf and paragraph-flow container,
  // specs/multicol.md): fold the FINAL box's vertical slack into the
  // engine-owned bottom padding so the browser's column box is exactly
  // as tall as the engine's fill (its sequential fill then breaks on
  // the same lines), and only then paint the column rules — the fold
  // decides whether they tee into the bottom border.
  // The cast defeats stale narrowing from the `delete` above (the leaf
  // pass re-populates the property behind a call TS doesn't track).
  const multicolGeometry = node.multicolGeometry as MulticolLeafGeometry | undefined;
  if (multicolGeometry) {
    const finalContentHeight =
      finalHeight - style.border.top - style.border.bottom - padding.top - padding.bottom;
    if (finalContentHeight > multicolGeometry.totalRows)
      padding.bottom += finalContentHeight - multicolGeometry.totalRows;
    multicolLeafRuleRuns(node, multicolGeometry, style.border, padding);
  }

  node.localRect = { x: parentX, y: parentY, width: outerWidth, height: finalHeight };
}

/**
 * Layout for a TEXT LEAF (possibly carrying out-of-flow children), or an
 * empty box. `white-space: nowrap` text never soft-wraps: its height is
 * the hard-line (`<br>`) count, regardless of width. `leading-*` adds
 * `lineGap` empty rows BETWEEN lines only (specs/cell-model.md). Returns
 * content height (rows used); mutates `padding` (=== resolvedPadding)
 * for quantized content alignment and multicol column folding.
 */
function layoutTextLeaf(
  node: LayoutNode,
  innerWidth: number,
  innerHeight: number,
  definiteInnerHeight: number | undefined,
  maxInnerHeight: number | undefined,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const style = node.style;
  let contentHeight: number;
  if (node.text) {
    // Atomic inline boxes first: lay each out (shrink-to-fit; height =
    // its own content) and resolve its U+FFFC marker's advance to the
    // laid-out width, so the wrap below treats it as an unbreakable
    // unit of exactly that many cells.
    const boxes = node.children.filter((child) => child.inlineBox);
    eachObjectMarker(node.text, (charIndex, boxIndex) => {
      const box = boxes[boxIndex]!;
      layoutNode(box, innerWidth, undefined, 0, 0, "shrink", cache);
      node.advances![charIndex] = Math.max(1, box.localRect.width);
    });
    let geometry: { spans: LineSpan[]; lineY: number[]; textY: number[]; totalRows: number };
    let lineX: number[] | undefined;
    if (style.display === "multicol") {
      // Direct-text multicol leaf (specs/multicol.md): fragment the
      // wrapped lines into columns, the fill restricted by a definite
      // height or max-height (css-multicol §7). The division remainder
      // folds into the engine-owned right padding so the browser's
      // equal fractional columns start on the engine's whole cells;
      // vertical slack folds after the final height clamp (layoutNode).
      const gap = resolveGap(style, "x", innerWidth);
      const columns = resolveLeafColumns(style, innerWidth, gap);
      padding.right += columns.leftover;
      const multicol = multicolLeafGeometry(
        node,
        columns,
        gap,
        restrictingHeight(definiteInnerHeight, maxInnerHeight),
      );
      node.multicolGeometry = multicol;
      geometry = multicol;
      lineX = multicol.lineX;
    } else {
      geometry = leafLineGeometry(node, innerWidth);
    }
    contentHeight = geometry.totalRows;
    // Content alignment of the anonymous text item, quantized to whole
    // cells (specs/cell-model.md): a flex/grid element whose content is
    // bare text centers/ends it by folding the leftover into the
    // engine-owned padding. The browser's own (fractional, off-grid)
    // anonymous-item alignment is reset in styles.css; padding places
    // the text instead, so browser, plain text, and decorations agree.
    // Symmetry of the wrap is preserved: the padded content box is
    // exactly the widest line, and greedy wrap breaks identically there
    // (every line fits, and every overflow still overflows).
    alignLeafText(node, geometry, innerWidth, innerHeight, padding);
    // Place each box at its marker's wrapped (line, column) — the
    // browser's own line layout puts the in-flow box in the same spot
    // because both models reserve exactly the same cells for it, and a
    // taller box grows its LINE (per CSS; the box is vertical-align:
    // top, so its top sits on the line's first row like the text).
    if (boxes.length > 0) {
      const lineOfChar = (charIndex: number) =>
        geometry.spans.findIndex((span) => charIndex >= span.start && charIndex < span.end);
      eachObjectMarker(node.text, (charIndex, boxIndex) => {
        const line = lineOfChar(charIndex);
        if (line === -1) return; // e.g. width 0 edge; box stays at origin
        const span = geometry.spans[line]!;
        boxes[boxIndex]!.localRect = {
          ...boxes[boxIndex]!.localRect,
          x:
            style.border.left +
            padding.left +
            (lineX?.[line] ?? 0) +
            advanceOf(span.start, charIndex, node.advances),
          y: style.border.top + padding.top + geometry.lineY[line]!,
        };
      });
    }
  } else {
    contentHeight = node.intrinsicHeight;
  }
  // Out-of-flow children of a leaf: static position = the content-box
  // origin plus their margins (specs/positioning.md — CSS's hypothetical
  // inline position is approximated by the run's origin).
  for (const child of node.children) {
    if (child.inlineBox) continue;
    const margin = resolveMargin(child.style.margin, innerWidth);
    child.staticSlot = {
      kind: "block",
      x: style.border.left + padding.left + (margin.left ?? 0),
      y: style.border.top + padding.top + (margin.top ?? 0),
    };
  }
  return contentHeight;
}

/**
 * True when the node lays out as a TEXT LEAF: no in-flow block children
 * (atomic inline boxes ride the text run and out-of-flow boxes hang off
 * it, so neither counts), and either text to wrap or nothing at all. The
 * one exception: a TEXTLESS flex or grid container keeps its own path —
 * flex so its out-of-flow children get the sole-flex-item static
 * position, grid so explicit tracks still size an empty container. A
 * flex/grid element WITH text is still a leaf — its text lays out as a
 * single anonymous item that must size the box (for grid this skips
 * placing the anonymous item into the track grid; specs/grid.md
 * deviation).
 */
function laysOutAsTextLeaf(node: LayoutNode): boolean {
  const hasInFlowChildren = node.children.some(
    (child) => !isOutOfFlow(child.style) && !child.inlineBox,
  );
  if (hasInFlowChildren) return false;
  return node.text !== "" || (node.style.display !== "flex" && node.style.display !== "grid");
}

export function clampSize(value: number, min: number, max: number | undefined): number {
  const clamped = max !== undefined ? Math.min(value, max) : value;
  return Math.max(min, clamped);
}

/**
 * Quantized content alignment for a flex/grid text leaf: fold the leftover
 * space around the anonymous text item into the engine-owned padding so the
 * text lands on whole cells. Flex rows justify horizontally and align
 * vertically; columns swap; grid uses item alignment (justify-items /
 * align-items — the anonymous item's single implicit track fills the box).
 * The padded content box becomes exactly the widest line, which preserves
 * the wrap: every line still fits, and greedy breaks are unchanged.
 * Mutates `padding` (=== node.resolvedPadding), which the renderers and
 * this leaf's box/slot placement below all read.
 */
function alignLeafText(
  node: LayoutNode,
  geometry: { spans: LineSpan[]; totalRows: number },
  innerWidth: number,
  innerHeight: number,
  padding: Insets,
): void {
  const style = node.style;
  if (style.display !== "flex" && style.display !== "grid") return;
  if (geometry.spans.length === 0) return;
  const isColumn = style.display === "flex" && style.flexDirection === "column";

  const itemWidth = geometry.spans.reduce(
    (max, span) => Math.max(max, lineAdvance(span.start, span.end, node.advances, style.tracking)),
    0,
  );
  const leftoverX = Math.max(0, innerWidth - itemWidth);
  if (leftoverX > 0) {
    const tx =
      style.display === "grid"
        ? alignCrossOffset(style.justifyItems, innerWidth, itemWidth)
        : isColumn
          ? alignCrossOffset(style.alignItems, innerWidth, itemWidth)
          : mainAxisOffsets(effectiveJustify(style), [itemWidth], leftoverX)[0]!;
    if (tx > 0) {
      padding.left += tx;
      padding.right += leftoverX - tx;
    }
  }

  // Vertical offsets only exist inside a bounded box (explicit height,
  // min-height floor, or a flex/grid-assigned size).
  if (Number.isFinite(innerHeight)) {
    const leftoverY = Math.max(0, innerHeight - geometry.totalRows);
    if (leftoverY > 0) {
      const ty =
        style.display === "grid" || !isColumn
          ? alignCrossOffset(style.alignItems, innerHeight, geometry.totalRows)
          : mainAxisOffsets(effectiveJustify(style), [geometry.totalRows], leftoverY)[0]!;
      if (ty > 0) {
        padding.top += ty;
        padding.bottom += leftoverY - ty;
      }
    }
  }
}

/** A single-column text leaf's wrapped lines with their vertical
 * geometry: `lineGap` rows between lines, per-line heights and text
 * drops from leafLineMetrics (multicol leaves fragment through
 * multicolLeafGeometry instead). Marker advances must be resolved. */
export function leafLineGeometry(
  node: LayoutNode,
  contentWidth: number,
): { spans: LineSpan[]; lineY: number[]; textY: number[]; totalRows: number } {
  const spans = leafLineSpans(node, contentWidth);
  const { heights, textOffsets } = leafLineMetrics(node, spans);
  const lineY: number[] = [];
  const textY: number[] = [];
  let y = 0;
  for (let s = 0; s < spans.length; s++) {
    lineY.push(y);
    textY.push(y + textOffsets[s]!);
    y += heights[s]! + (s < spans.length - 1 ? node.style.lineGap : 0);
  }
  return { spans, lineY, textY, totalRows: y };
}

/** A leaf's line spans: hard `<br>` lines under nowrap/pre, greedy
 * word-wrap at the content width otherwise. */
export function leafLineSpans(node: LayoutNode, contentWidth: number): LineSpan[] {
  return node.style.whiteSpace !== "normal"
    ? hardLineSpans(node.text)
    : wrapLineSpans(node.text, contentWidth, {
        advances: node.advances,
        tracking: node.style.tracking,
      });
}

/**
 * Per-line height and text drop for a leaf's wrapped lines. Lines are one
 * row tall unless an atomic inline box on the line is taller — the line
 * grows to the tallest box (per CSS line-box growth). `vertical-align:
 * bottom` on a box drops the line's TEXT to the box's last row
 * (grid-exact in every engine, probed); the largest such box wins.
 * top/middle/baseline behave as top (cell-model deviation — middle and
 * baseline are off-grid). Requires the leaf's inline boxes to be laid
 * out already (their rect heights are read here).
 */
export function leafLineMetrics(
  node: LayoutNode,
  spans: LineSpan[],
): { heights: number[]; textOffsets: number[] } {
  const boxes = node.children.filter((child) => child.inlineBox);
  const heights: number[] = [];
  const textOffsets: number[] = [];
  let boxIndex = 0;
  for (const span of spans) {
    let height = 1;
    let textOffset = 0;
    for (let i = span.start; i < span.end; i++) {
      if (node.text[i] !== OBJECT_REPLACEMENT) continue;
      const box = boxes[boxIndex]!;
      height = Math.max(height, box.localRect.height);
      if (box.style.verticalAlign === "end")
        textOffset = Math.max(textOffset, box.localRect.height - 1);
      else if (box.style.verticalAlign === "center")
        warnOnce(
          box.source,
          "vertical-align: middle on an inline box can't land on whole rows and " +
            "behaves as top. Use align-top or align-bottom.",
        );
      boxIndex++;
    }
    heights.push(height);
    textOffsets.push(Math.min(textOffset, height - 1));
  }
  return { heights, textOffsets };
}

/** The used gap in an axis: the resolved gap floored at the axis's rule
 * width (specs/gap-decorations.md deviation 1 — rules take layout
 * space, so `rule` alone behaves as `gap-1 rule`). */
export function resolveGap(style: CellStyle, axis: "x" | "y", basis: number | undefined): number {
  const gap = resolveLength(axis === "x" ? style.gapX : style.gapY, basis);
  const rule = axis === "x" ? style.ruleX : style.ruleY;
  return Math.max(gap, rule?.width ?? 0);
}

/** Resolve a spacing length to cells against its containing-block basis.
 * An indefinite basis (percent gap in an unbounded axis) resolves to 0. */
export function resolveLength(length: CellLength, basis: number | undefined): number {
  if (typeof length === "number") return length;
  return basis === undefined || !Number.isFinite(basis) ? 0 : percentToCells(length.percent, basis);
}

/** Resolve all four margin sides (preserving `auto` as null) against the
 * parent's content width — the CSS basis for every side. */
export function resolveMargin(margin: PerSide<CellLength | null>, basis: number): NullableInsets {
  const side = (v: CellLength | null) => (v === null ? null : resolveLength(v, basis));
  return {
    top: side(margin.top),
    right: side(margin.right),
    bottom: side(margin.bottom),
    left: side(margin.left),
  };
}

/** The cells of a CellLength for intrinsic sizing: percentages count as 0,
 * per CSS intrinsic-size contribution rules. */
function intrinsicCells(length: CellLength): number {
  return typeof length === "number" ? length : 0;
}

/** Resolve a height limit to cells: percent needs a definite available
 * size; intrinsic keywords behave as "no constraint" on heights. `"auto"`
 * resolves to none here (0 in block flow) — flex main-axis code
 * substitutes the item's content-based automatic minimum itself. */
export function resolveLimit(
  limit: SizeLimit | "auto" | undefined,
  available: number | undefined,
): number | undefined {
  if (limit === undefined || typeof limit === "string") return undefined;
  if (typeof limit === "number") return limit;
  return available === undefined ? undefined : percentToCells(limit.percent, available);
}

/** Resolve a WIDTH limit to cells — like resolveLimit, but intrinsic
 * keywords (`max-w-max` = max-content, …) resolve against the node's
 * content. */
export function resolveWidthLimit(
  limit: SizeLimit | "auto" | undefined,
  available: number,
  node: LayoutNode,
  cache: IntrinsicCache,
): number | undefined {
  if (limit === "min-content" || limit === "max-content" || limit === "fit-content") {
    return resolveSizeAgainst({ kind: limit }, available, node, cache);
  }
  return resolveLimit(limit, available);
}

/**
 * Lay out children in vertical block flow. Returns content height (rows used).
 *
 * - Vertical (main-axis) margins on adjacent siblings **collapse** — the
 *   effective gap is `max(prev.bottom, curr.top)` for two positives, `min`
 *   for two negatives, and the sum for mixed signs (standard CSS rule).
 *   Parent–child collapsing is intentionally NOT implemented (see the cell-
 *   model spec's Deviations section).
 * - Horizontal (cross-axis) margins position the child; `auto` on either
 *   side centers or end-aligns as CSS does.
 */
function layoutBlock(
  node: LayoutNode,
  innerWidth: number,
  definiteInnerHeight: number | undefined,
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const originX = border.left + padding.left;
  const startY = border.top + padding.top;
  let y = startY;
  let previousMarginBottom: number | null = null;
  for (const child of node.children) {
    const childMargin = resolveMargin(child.style.margin, innerWidth);
    const marginTop = childMargin.top ?? 0;
    const marginBottom = childMargin.bottom ?? 0;
    const marginLeft = childMargin.left ?? 0;
    const marginRight = childMargin.right ?? 0;
    if (isOutOfFlow(child.style)) {
      // Record the CSS static position (where the box would have started in
      // flow) without consuming space or disturbing margin collapsing.
      child.staticSlot = {
        kind: "block",
        x: originX + marginLeft,
        y:
          y +
          (previousMarginBottom === null
            ? marginTop
            : collapseMargins(previousMarginBottom, marginTop)),
      };
      continue;
    }
    layoutNode(
      child,
      Math.max(0, innerWidth - marginLeft - marginRight),
      definiteInnerHeight,
      0,
      0,
      "fill",
      cache,
    );
    const crossOffset = blockCrossOffset(childMargin, innerWidth, child.localRect.width);

    // `y` tracks the position where the next child's top edge goes. Margins
    // are added JUST BEFORE placing each child, then only the child's height
    // afterwards — the child's own bottom margin waits until the next
    // sibling (or the end-of-container) so we can collapse them properly.
    y +=
      previousMarginBottom === null ? marginTop : collapseMargins(previousMarginBottom, marginTop);
    child.localRect = { ...child.localRect, x: originX + crossOffset, y };
    y += child.localRect.height;
    previousMarginBottom = marginBottom;
  }
  if (previousMarginBottom !== null) y += previousMarginBottom;
  return y - startY;
}

/** Horizontal placement of a box inside its block-flow slot: `auto`
 * margins center or end-align, fixed margins offset (CSS block flow;
 * multicol columns use the same rule). */
export function blockCrossOffset(
  margin: NullableInsets,
  slotWidth: number,
  boxWidth: number,
): number {
  const available = slotWidth - boxWidth;
  if (margin.left === null && margin.right === null) return Math.floor(available / 2);
  if (margin.left === null) return available - (margin.right ?? 0);
  return margin.left;
}

/**
 * CSS margin-collapsing rule for two adjacent block-flow margins:
 * - both positive → the larger absorbs the smaller.
 * - both negative → the more negative absorbs the less negative.
 * - mixed → they sum (positive shrunk by the negative).
 */
export function collapseMargins(a: number, b: number): number {
  if (a >= 0 && b >= 0) return Math.max(a, b);
  if (a <= 0 && b <= 0) return Math.min(a, b);
  return a + b;
}

function resolveWidth(
  style: CellStyle,
  available: number,
  mode: SizingMode,
  node: LayoutNode,
  cache: IntrinsicCache,
): number {
  const width = style.width;
  if (style.display === "table") {
    // Tables shrink-to-fit even in block flow, floored at their min sum
    // (specs/table.md step 3); fixed layout fills, percents inflate. A
    // table degraded to a text leaf (no rows) shrink-to-fits on its
    // plain intrinsics.
    const hasStructure = node.children.some(
      (child) => !isOutOfFlow(child.style) && !child.inlineBox,
    );
    if (!hasStructure) {
      if (width !== undefined && width.kind !== "auto")
        return resolveSizeAgainst(width, available, node, cache);
      return Math.min(available, intrinsicOuterWidth(node, cache));
    }
    if (width !== undefined && width.kind !== "auto") {
      const resolved = resolveSizeAgainst(width, available, node, cache);
      return Math.max(resolved, tableMinOuterWidth(node, available, cache));
    }
    return tableUsedOuterWidth(node, available, cache);
  }
  if (width !== undefined && width.kind !== "auto")
    return resolveSizeAgainst(width, available, node, cache);
  return mode === "shrink" ? Math.min(available, intrinsicOuterWidth(node, cache)) : available;
}

function tableMinOuterWidth(node: LayoutNode, available: number, cache: IntrinsicCache): number {
  const style = node.style;
  return (
    tableIntrinsicInnerWidths(node, cache).min +
    style.border.left +
    style.border.right +
    resolveLength(style.padding.left, available) +
    resolveLength(style.padding.right, available)
  );
}

function resolveHeight(style: CellStyle, available: number | undefined): number | undefined {
  if (style.height?.kind === "cells") return style.height.value;
  if (style.height?.kind === "percent" && available != null)
    return percentToCells(style.height.value, available);
  return undefined;
}

/** Resolve a definite Size against an available extent (`auto` falls back
 * to max-content — callers handle the auto/fill distinction themselves). */
export function resolveSizeAgainst(
  size: Size,
  available: number,
  node: LayoutNode,
  cache: IntrinsicCache,
): number {
  switch (size.kind) {
    case "cells":
      return size.value;
    case "percent":
      return percentToCells(size.value, available);
    case "min-content":
      return minContentOuterWidth(node, cache);
    case "max-content":
      return intrinsicOuterWidth(node, cache);
    case "fit-content":
      return Math.min(
        intrinsicOuterWidth(node, cache),
        Math.max(minContentOuterWidth(node, cache), available),
      );
    case "auto":
      return intrinsicOuterWidth(node, cache);
  }
}

/** Max-content intrinsic outer width (border + padding + unwrapped content). */
export function intrinsicOuterWidth(node: LayoutNode, cache: IntrinsicCache): number {
  const cached = cache.maxContent.get(node);
  if (cached !== undefined) return cached;
  const style = node.style;
  const inner = intrinsicInnerWidth(node, cache);
  const result =
    inner +
    style.border.left +
    style.border.right +
    intrinsicCells(style.padding.left) +
    intrinsicCells(style.padding.right);
  cache.maxContent.set(node, result);
  return result;
}

function intrinsicInnerWidth(node: LayoutNode, cache: IntrinsicCache): number {
  const inFlow = node.children.filter((c) => !isOutOfFlow(c.style) && !c.inlineBox);
  if (inFlow.length === 0) {
    if (node.style.display === "multicol")
      return multicolIntrinsicInnerWidth(node.style, node.intrinsicWidth);
    return node.intrinsicWidth;
  }
  if (node.style.display === "grid") return gridIntrinsicInnerWidths(node, cache).max;
  if (node.style.display === "table") return tableIntrinsicInnerWidths(node, cache).max;
  if (node.style.display === "flex" && node.style.flexDirection === "row") {
    const gap =
      Math.max(intrinsicCells(node.style.gapX), node.style.ruleX?.width ?? 0) *
      Math.max(0, inFlow.length - 1);
    return inFlow.reduce((sum, c) => sum + intrinsicOuterWidth(c, cache), 0) + gap;
  }
  const widest = inFlow.reduce((max, c) => Math.max(max, intrinsicOuterWidth(c, cache)), 0);
  if (node.style.display === "multicol") return multicolIntrinsicInnerWidth(node.style, widest);
  return widest;
}

/**
 * Min-content intrinsic outer width: the narrowest the box can get without
 * overflow. For a text leaf that's the longest unbreakable unit — a word
 * under normal wrapping, a whole hard line under `nowrap`. A nowrap flex
 * row sums its items (they sit side by side no matter what); wrapping rows
 * and block/column containers take the widest child.
 */
export function minContentOuterWidth(node: LayoutNode, cache: IntrinsicCache): number {
  const cached = cache.minContent.get(node);
  if (cached !== undefined) return cached;
  const style = node.style;
  const inner = minContentInnerWidth(node, cache);
  const result =
    inner +
    style.border.left +
    style.border.right +
    intrinsicCells(style.padding.left) +
    intrinsicCells(style.padding.right);
  cache.minContent.set(node, result);
  return result;
}

function minContentInnerWidth(node: LayoutNode, cache: IntrinsicCache): number {
  const inFlow = node.children.filter((c) => !isOutOfFlow(c.style) && !c.inlineBox);
  if (inFlow.length === 0) {
    if (!node.text || node.style.whiteSpace !== "normal") return node.intrinsicWidth;
    return longestSegmentAdvance(node.text, {
      advances: node.advances,
      tracking: node.style.tracking,
    });
  }
  if (node.style.display === "grid") return gridIntrinsicInnerWidths(node, cache).min;
  if (node.style.display === "table") return tableIntrinsicInnerWidths(node, cache).min;
  if (
    node.style.display === "flex" &&
    node.style.flexDirection === "row" &&
    node.style.flexWrap === "nowrap"
  ) {
    const gap =
      Math.max(intrinsicCells(node.style.gapX), node.style.ruleX?.width ?? 0) *
      Math.max(0, inFlow.length - 1);
    return inFlow.reduce((sum, c) => sum + minContentOuterWidth(c, cache), 0) + gap;
  }
  return inFlow.reduce((max, c) => Math.max(max, minContentOuterWidth(c, cache)), 0);
}

function shrinkSize(
  width: number,
  height: number,
  border: Insets,
  padding: Insets,
): { width: number; height: number } {
  return {
    width: Math.max(0, width - border.left - border.right - padding.left - padding.right),
    height: Math.max(0, height - border.top - border.bottom - padding.top - padding.bottom),
  };
}
