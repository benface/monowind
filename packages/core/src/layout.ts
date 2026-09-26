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
  resolveFlexEdge,
} from "./flex.ts";
import { gridIntrinsicInnerWidths, layoutGrid } from "./grid.ts";
import {
  layoutMulticol,
  multicolIntrinsicInnerWidth,
  multicolLeafGeometry,
  multicolLeafRuleRuns,
  resolveColumns,
  restrictingHeight,
} from "./multicol.ts";
import { layoutTable, tableIntrinsicInnerWidths, tableUsedOuterWidth } from "./table.ts";
import type { TableData } from "./table.ts";
import { positionOutOfFlow } from "./positioning.ts";
import type { Remembered } from "./positioning.ts";
import { placePainted } from "./paint-origin.ts";
import { inlineBoxesOf, scrollGutter, scrollGutterBands, scrollsAxis } from "./types.ts";
import { bandAt, clearanceBelow, floatsBottom, placeFloat } from "./floats.ts";
import type { FloatBox } from "./floats.ts";
import type {
  CellLength,
  CellStyle,
  Insets,
  LayoutNode,
  LineBand,
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
 * Coordinates are parent-relative (root's rect is at 0,0). `remembered`
 * carries anchored boxes' last successful placements between layouts
 * (specs/anchor-positioning.md). Last, every box gets its `paintOrigin`
 * under the synced scroll offsets (paint-origin.ts).
 */
export function layoutRoot(
  root: LayoutNode,
  availableWidth: number,
  syncScroll?: (node: LayoutNode) => void,
  remembered?: Map<Element, Remembered>,
): { height: number } {
  const cache = makeIntrinsicCache();
  layoutNode(root, availableWidth, undefined, 0, 0, "fill", cache);
  // The scroll containers' offsets, for the anchors the positioning
  // pass reads through them (specs/anchor-positioning.md).
  syncScroll?.(root);
  // Positioning pass (specs/positioning.md): out-of-flow boxes were skipped
  // by flow layout; place them against their containing blocks, and apply
  // relative offsets. Runs top-down so ancestor rects are final first.
  positionOutOfFlow(root, cache, remembered, syncScroll);
  // The host keeps its in-flow height; the grid covers the INK — visible
  // overflow paints past the host like CSS paints it past any box
  // (specs/cell-model.md "Overflow"). A clipping axis keeps the box: the
  // root leaf under `truncate` (specs/host-leaf.md) cuts at its width.
  const height = root.localRect.height;
  const ink = contentExtent(root);
  const { overflow } = root.style;
  if (overflow.x === "visible") root.localRect.width = Math.max(root.localRect.width, ink.x);
  if (overflow.y === "visible") root.localRect.height = Math.max(height, ink.y);
  placePainted(root);
  return { height };
}

/** absolute / fixed boxes are out of normal flow. */
export function isOutOfFlow(style: CellStyle): boolean {
  return style.position === "absolute" || style.position === "fixed";
}

/** The static position of an out-of-flow box whose margin box starts at
 * (`x`, `y`) with no sibling margin to collapse with
 * (specs/positioning.md): its border box, past its resolved left and top
 * `margin`. */
export function blockStaticSlot(
  margin: NullableInsets,
  x: number,
  y: number,
): { kind: "block"; x: number; y: number } {
  return { kind: "block", x: x + (margin.left ?? 0), y: y + (margin.top ?? 0) };
}

/** A formatting-context root beside floats (specs/float.md): it steps
 * aside from them as one box, where a text leaf or an empty box passes
 * under with its lines shortened — a container of in-flow children, a
 * non-block display (flex, grid, table, multicol), or an overflow other
 * than visible (a scroll container, clipping, truncation), which CSS
 * makes roots too. */
export function isFormattingContextRoot(node: LayoutNode): boolean {
  const { display, overflow } = node.style;
  return (
    display !== "block" ||
    overflow.x !== "visible" ||
    overflow.y !== "visible" ||
    node.children.some(isInFlowBox)
  );
}

/** A child that lays out as a box of its parent's: in flow, and no
 * atomic inline box riding the parent's text run. */
export function isInFlowBox(child: LayoutNode): boolean {
  return !isOutOfFlow(child.style) && !child.inlineBox;
}

/** The floats a leaf's lines wrap against (specs/float.md): its
 * container's exclusion boxes and content width, and the leaf's
 * border-box origin in that content box. */
interface Intrusions {
  boxes: FloatBox[];
  contentWidth: number;
  x: number;
  y: number;
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
 * `forced` is a parent's used size (flex, grid area, table cell): a
 * forced width skips resolution and clamping; a forced height still
 * clamps to min/max. With sizes forced, `availableWidth` stays the
 * CONTAINING BLOCK's content width, which percent padding, margins, and
 * min/max resolve against — never the assigned size itself.
 */
export function layoutNode(
  node: LayoutNode,
  availableWidth: number,
  availableHeight: number | undefined,
  parentX: number,
  parentY: number,
  widthMode: SizingMode,
  cache: IntrinsicCache,
  forced?: {
    width?: number | undefined;
    height?: number | undefined;
    /** Second-pass auto-gutter reservation (see the scrollRange block):
     * an overflowing `auto` axis re-lays out once WITH its gutter and
     * keeps it regardless of the new extent — no oscillation. */
    gutter?: { right: boolean; bottom: boolean };
  },
  intrusions?: Intrusions,
): void {
  const style = node.style;
  const forcedHeight = forced?.height;
  // Fresh per layout: only the pass that runs (table lattice, flex/grid
  // gap rules, multicol) repopulates them.
  delete node.decorationRuns;
  delete node.lattice;
  delete node.latticeRuns;
  delete node.multicolGeometry;
  delete node.multicolFlow;
  delete node.multicolFlowSpan;
  delete node.flow;
  delete node.textExtent;
  delete node.lineBands;

  // Width is clamped to min/max BEFORE laying out content — wrapping and
  // child sizing must see the constrained width, not the raw resolved one —
  // and so is an explicit height (below); an auto height is the content's
  // output, clamped after, overflow handling the spill.
  // Percent min/max (`max-w-full`) resolve against the available size; a
  // percent height limit with indefinite available height is ignored, per CSS.
  const minWidth = resolveWidthLimit(style.minWidth, availableWidth, node, cache) ?? 0;
  const maxWidth = resolveWidthLimit(style.maxWidth, availableWidth, node, cache);
  const minHeight = resolveLimit(style.minHeight, availableHeight) ?? 0;
  const maxHeight = resolveLimit(style.maxHeight, availableHeight);
  // Percent padding resolves against the containing block's width (CSS: all
  // four sides use the inline size) — `availableWidth` is that width here.
  // Stored on the node, where the layout modes and the renderers read it.
  const gutter = scrollGutter(style);
  const bands = scrollGutterBands(style);
  if (forced?.gutter?.right) gutter.right = bands.right;
  if (forced?.gutter?.bottom) gutter.bottom = bands.bottom;
  const padding: Insets = {
    top: resolveLength(style.padding.top, availableWidth),
    right: resolveLength(style.padding.right, availableWidth) + gutter.right,
    bottom: resolveLength(style.padding.bottom, availableWidth) + gutter.bottom,
    left: resolveLength(style.padding.left, availableWidth),
  };
  node.resolvedPadding = padding;
  // A border box is at least its edges (specs/cell-model.md "Box
  // model"): a zero-height box with a top border is its border row.
  const outerWidth = Math.max(
    forced?.width ??
      clampSize(resolveWidth(node, availableWidth, widthMode, cache), minWidth, maxWidth),
    edges(style.border, padding, "x"),
  );
  const outerHeightExplicit = resolveHeight(style, availableHeight);
  // A forced height overrides an explicit `height` and a `min-height`
  // floor. Otherwise the content lays out against the explicit height as
  // its limits leave it, or a `min-height` floor, so items-center /
  // items-end see the enforced size.
  const outerHeightFloor =
    forcedHeight ??
    (outerHeightExplicit === undefined
      ? minHeight > 0
        ? minHeight
        : undefined
      : clampSize(outerHeightExplicit, minHeight, maxHeight));

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

  // `height` and `max-height` both RESTRICT multicol column heights
  // (css-multicol §7), unlike other displays where max-height only clamps
  // the final rect and overflow spills.
  const maxInnerHeight =
    maxHeight === undefined
      ? undefined
      : Math.max(0, maxHeight - edges(style.border, padding, "y"));

  // Content layout against an inner height and whether it is definite.
  // Flex and grid containers size their content against a definite
  // height, and a `max-height` on an indefinite one caps the USED size,
  // not just the box (css-flexbox §9.2 / §9.4, css-grid §11.1): content
  // past the cap re-flexes against it — a scroll-container item
  // (automatic minimum 0) shrinks and scrolls.
  const isLeaf = laysOutAsTextLeaf(node);
  const layoutContent = (height: number, definite: boolean): number => {
    const width = inner.width;
    const definiteInner = definite && Number.isFinite(height) ? height : undefined;
    if (isLeaf) {
      return layoutTextLeaf(node, width, height, definiteInner, maxInnerHeight, cache, intrusions);
    }
    switch (style.display) {
      case "flex": {
        const layoutFlex = style.flexDirection === "row" ? layoutFlexRow : layoutFlexColumn;
        return layoutFlex(node, width, height, definiteInner, cache);
      }
      case "grid":
        return layoutGrid(node, width, height, definiteInner, cache);
      case "table":
        return layoutTable(node, width, definiteInner, cache);
      case "multicol":
        return layoutMulticol(node, width, definiteInner, maxInnerHeight, cache);
      default:
        return layoutBlock(node, width, definiteInner, cache);
    }
  };
  // Taken before the content lays out: a flex/grid text leaf folds its
  // alignment into the padding, which is no part of its content height.
  const chromeY = edges(style.border, padding, "y");
  let contentHeight = layoutContent(inner.height, heightIsDefinite);
  const capsUsedHeight = !isLeaf && (style.display === "flex" || style.display === "grid");
  if (capsUsedHeight && !heightIsDefinite && maxHeight !== undefined) {
    // The USED size: max clamps, and a larger min wins over it (CSS).
    const usedInner = clampSize(contentHeight + chromeY, minHeight, maxHeight) - chromeY;
    if (usedInner < contentHeight) contentHeight = layoutContent(Math.max(0, usedInner), true);
  }

  const naturalHeight = contentHeight + chromeY;
  node.naturalContentHeight = naturalHeight;
  const finalHeight = Math.max(
    clampSize(forcedHeight ?? outerHeightExplicit ?? naturalHeight, minHeight, maxHeight),
    edges(style.border, padding, "y"),
  );

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
    const finalContentHeight = finalHeight - edges(style.border, padding, "y");
    if (finalContentHeight > multicolGeometry.totalRows)
      padding.bottom += finalContentHeight - multicolGeometry.totalRows;
    multicolLeafRuleRuns(node, multicolGeometry);
  }

  node.localRect = { x: parentX, y: parentY, width: outerWidth, height: finalHeight };

  // Scroll geometry (specs/scrolling.md): content extent and max
  // offset, from the ENGINE's layout — never native scrollHeight.
  if (scrollsAxis(style.overflow.x) || scrollsAxis(style.overflow.y)) {
    const extent = contentExtent(node);
    const origin = contentOrigin(node);
    const sizeX = Math.max(0, extent.x - origin.x);
    const sizeY = Math.max(0, extent.y - origin.y);
    const contentW = Math.max(0, outerWidth - edges(style.border, padding, "x"));
    const contentH = Math.max(0, finalHeight - edges(style.border, padding, "y"));
    node.scrollRange = {
      sizeX,
      sizeY,
      maxX: scrollsAxis(style.overflow.x) ? Math.max(0, sizeX - contentW) : 0,
      maxY: scrollsAxis(style.overflow.y) ? Math.max(0, sizeY - contentH) : 0,
    };
    // CSS parity for `auto`: reserve the gutter only when content
    // actually overflows, and keep it even if the narrower re-layout no
    // longer overflows (browsers' own anti-oscillation rule). One axis's
    // gutter can push the OTHER axis into overflow, so the pass repeats
    // while a newly overflowing axis lacks its gutter — gutters only
    // accrue, so at most one more pass.
    if (style.scrollbarWidth !== "none") {
      const have = forced?.gutter ?? { right: false, bottom: false };
      const needY = have.right || (style.overflow.y === "auto" && node.scrollRange.maxY > 0);
      const needX = have.bottom || (style.overflow.x === "auto" && node.scrollRange.maxX > 0);
      if (needY !== have.right || needX !== have.bottom) {
        layoutNode(node, availableWidth, availableHeight, parentX, parentY, widthMode, cache, {
          ...forced,
          gutter: { right: needY, bottom: needX },
        });
        return;
      }
    }
    node.scrollGutterCells = { right: gutter.right, bottom: gutter.bottom };
  } else {
    delete node.scrollRange;
    delete node.scrollGutterCells;
  }
}

/**
 * Layout for a TEXT LEAF (possibly carrying out-of-flow children), or an
 * empty box. `white-space: nowrap` text never soft-wraps: its height is
 * the hard-line (`<br>`) count, regardless of width. `leading-*` adds
 * `lineGap` empty rows BETWEEN lines only (specs/cell-model.md). Returns
 * content height (rows used); mutates `resolvedPadding` for quantized
 * content alignment and multicol column folding.
 */
function layoutTextLeaf(
  node: LayoutNode,
  innerWidth: number,
  innerHeight: number,
  definiteInnerHeight: number | undefined,
  maxInnerHeight: number | undefined,
  cache: IntrinsicCache,
  intrusions?: Intrusions,
): number {
  const style = node.style;
  const padding = node.resolvedPadding;
  let contentHeight: number;
  if (node.text) {
    // Atomic inline boxes first: lay each out (shrink-to-fit; height =
    // its own content) and resolve its U+FFFC marker's advance to the
    // laid-out width, so the wrap below treats it as an unbreakable
    // unit of exactly that many cells.
    const boxes = inlineBoxesOf(node);
    eachObjectMarker(node.text, (charIndex, boxIndex) => {
      const box = boxes[boxIndex]!;
      layoutNode(box, innerWidth, undefined, 0, 0, "shrink", cache);
      node.advances![charIndex] = Math.max(1, box.localRect.width);
    });
    let geometry: {
      spans: LineSpan[];
      lineY: number[];
      textY: number[];
      totalRows: number;
      bands?: LineBand[] | undefined;
    };
    if (style.display === "multicol") {
      // Direct-text multicol leaf (specs/multicol.md): fragment the
      // wrapped lines into columns, the fill restricted by a definite
      // height or max-height (css-multicol §7). The division remainder
      // folds into the engine-owned right padding so the browser's
      // equal fractional columns start on the engine's whole cells;
      // vertical slack folds after the final height clamp (layoutNode).
      const gap = resolveGap(style, "x", innerWidth);
      const columns = resolveColumns(style, innerWidth, gap);
      padding.right += columns.leftover;
      const multicol = multicolLeafGeometry(
        node,
        columns,
        gap,
        restrictingHeight(definiteInnerHeight, maxInnerHeight),
      );
      node.multicolGeometry = multicol;
      geometry = multicol;
    } else {
      geometry = leafLineGeometry(node, innerWidth, intrusions);
      if (geometry.bands) node.lineBands = geometry.bands;
    }
    contentHeight = geometry.totalRows;
    const lineWidths = geometry.spans.map((span) =>
      lineAdvance(node.text, span.start, span.end, node.advances, style.tracking),
    );
    const bands = node.lineBands;
    const lineX = node.multicolGeometry?.lineX;
    node.textExtent = {
      width: lineWidths.reduce(
        (max, width, index) =>
          Math.max(max, (lineX?.[index] ?? 0) + (bands?.[index]?.x ?? 0) + width),
        0,
      ),
      rows: geometry.totalRows,
    };
    const alignedWidth = alignLeafText(
      node,
      lineWidths,
      geometry.totalRows,
      innerWidth,
      innerHeight,
    );
    // The last line's row, the baseline the box aligns by natively.
    const lastText = geometry.textY.at(-1);
    if (lastText !== undefined) node.baselineRow = contentOrigin(node).y + lastText;
    // Place each box at its marker's wrapped (line, column), past the
    // line's indent and alignment as its text is — the browser's own
    // line layout puts the in-flow box in the same spot because both
    // models reserve exactly the same cells for it, and a taller box
    // grows its LINE (per CSS; the box is vertical-align: top, so its
    // top sits on the line's first row like the text).
    if (boxes.length > 0) {
      const origin = contentOrigin(node);
      const { spans } = geometry;
      // Markers and lines both run in text order.
      let line = 0;
      eachObjectMarker(node.text, (charIndex, boxIndex) => {
        while (line < spans.length && spans[line]!.end <= charIndex) line++;
        const span = spans[line];
        if (span === undefined || charIndex < span.start) return; // e.g. width 0 edge; box stays at origin
        boxes[boxIndex]!.localRect = {
          ...boxes[boxIndex]!.localRect,
          x:
            origin.x +
            lineStart(node, line, span, alignedWidth, lineWidths[line]).x +
            advanceOf(span.start, charIndex, node.advances),
          y: origin.y + geometry.lineY[line]!,
        };
      });
    }
  } else {
    contentHeight = node.intrinsicHeight;
  }
  // Out-of-flow children of a leaf start at the content-box origin (CSS's
  // hypothetical inline position approximated by the run's origin).
  const { x, y } = contentOrigin(node);
  for (const child of node.children) {
    if (!child.inlineBox) {
      child.staticSlot = blockStaticSlot(resolveMargin(child.style.margin, innerWidth), x, y);
    }
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
  if (node.children.some(isInFlowBox)) return false;
  return node.text !== "" || (node.style.display !== "flex" && node.style.display !== "grid");
}

/** A size between its min and max, per CSS: a min above the max wins. */
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
 * Mutates `node.resolvedPadding`, which the renderers and this leaf's
 * box/slot placement all read; returns the width the text aligns in, the
 * padded content box's.
 */
function alignLeafText(
  node: LayoutNode,
  lineWidths: number[],
  rows: number,
  innerWidth: number,
  innerHeight: number,
): number {
  const style = node.style;
  const padding = node.resolvedPadding;
  if (style.display !== "flex" && style.display !== "grid") return innerWidth;
  if (lineWidths.length === 0) return innerWidth;
  const isColumn = style.display === "flex" && style.flexDirection === "column";
  // A stretched anonymous item keeps its text at its start under wrap-reverse.
  const isFlex = style.display === "flex";
  const crossAlign = resolveFlexEdge(style.alignItems, isFlex && style.wrapReverse, isFlex);
  let alignedWidth = innerWidth;

  const itemWidth = lineWidths.reduce((max, width) => Math.max(max, width), 0);
  const leftoverX = Math.max(0, innerWidth - itemWidth);
  if (leftoverX > 0) {
    const tx =
      style.display === "grid"
        ? alignCrossOffset(style.justifyItems, innerWidth, itemWidth)
        : isColumn
          ? alignCrossOffset(crossAlign, innerWidth, itemWidth)
          : mainAxisOffsets(effectiveJustify(style, 1), [itemWidth], leftoverX)[0]!;
    if (tx > 0) {
      padding.left += tx;
      padding.right += leftoverX - tx;
      alignedWidth = itemWidth;
    }
  }

  // Vertical offsets only exist inside a bounded box (explicit height,
  // min-height floor, or a flex/grid-assigned size).
  if (Number.isFinite(innerHeight)) {
    const leftoverY = Math.max(0, innerHeight - rows);
    if (leftoverY > 0) {
      const ty =
        style.display === "grid" || !isColumn
          ? alignCrossOffset(crossAlign, innerHeight, rows)
          : mainAxisOffsets(effectiveJustify(style, 1), [rows], leftoverY)[0]!;
      if (ty > 0) {
        padding.top += ty;
        padding.bottom += leftoverY - ty;
      }
    }
  }
  return alignedWidth;
}

/** A single-column text leaf's wrapped lines with their vertical
 * geometry: `lineGap` rows between lines, per-line heights and text
 * drops from leafLineMetrics (multicol leaves fragment through
 * multicolLeafGeometry instead). Marker advances must be resolved. */
export function leafLineGeometry(
  node: LayoutNode,
  contentWidth: number,
  intrusions?: Intrusions,
): {
  spans: LineSpan[];
  lineY: number[];
  textY: number[];
  totalRows: number;
  bands: LineBand[] | undefined;
} {
  // Beside floats the opener records the bands; a later pass (the
  // paint's) replays the recorded ones.
  let bands: LineBand[] | undefined;
  let opener: LineOpener | undefined;
  if (intrusions) {
    bands = [];
    opener = lineOpener(node, contentWidth, intrusions, bands);
  } else if (node.lineBands) {
    const recorded = node.lineBands;
    bands = recorded;
    opener = (index) => recorded[index]?.width ?? contentWidth;
  }
  const spans = leafLineSpans(node, contentWidth, opener);
  const { heights, textOffsets } = leafLineMetrics(node, spans);
  const lineY: number[] = [];
  const textY: number[] = [];
  let y = 0;
  for (let s = 0; s < spans.length; s++) {
    if (bands) y = bands[s]!.row;
    lineY.push(y);
    textY.push(y + textOffsets[s]!);
    y += heights[s]! + (s < spans.length - 1 ? node.style.lineGap : 0);
  }
  return { spans, lineY, textY, totalRows: y, bands };
}

/** Where a leaf's line starts in its content box, for the paint and the
 * inline-box placement alike (specs/cell-model.md "Text alignment"):
 * the width it aligns in (its band's beside floats; its column's less
 * the trailing letter-spacing gap in multicol, which the browser's own
 * alignment includes; else the content's), its indent (the first line's
 * alone: a `<br>` re-indents nothing, per CSS), and its `x` — the
 * column's and the band's edge, the indent, and the `text-align`
 * offset, whole cells. `lineWidth` is the span's advance, where the
 * caller has it. */
export function lineStart(
  node: LayoutNode,
  index: number,
  span: LineSpan,
  contentWidth: number,
  lineWidth = lineAdvance(node.text, span.start, span.end, node.advances, node.style.tracking),
): { width: number; indent: number; x: number } {
  const style = node.style;
  const band = node.lineBands?.[index];
  const multicol = node.multicolGeometry;
  const width = band
    ? band.width
    : multicol
      ? Math.max(1, multicol.columnWidth - style.tracking)
      : contentWidth;
  const indent = index === 0 ? style.textIndent : 0;
  const leftover = Math.max(0, width - indent - lineWidth);
  const offset =
    style.textAlign === "end"
      ? leftover
      : style.textAlign === "center"
        ? Math.floor(leftover / 2)
        : 0;
  return {
    width,
    indent,
    x: (multicol?.lineX[index] ?? 0) + (band?.x ?? 0) + indent + offset,
  };
}

type LineOpener = (index: number, closed: readonly LineSpan[]) => number;

/** The line opener for a leaf beside floats (specs/float.md "A line box
 * opens at the first row with a free cell"): line `index` starts on the
 * row after the closed lines, moved down past rows the floats leave
 * nothing of — until the floats end — and gets that row's band clipped
 * to the leaf's content box, in the leaf's cells; each band is recorded
 * for the paint. */
function lineOpener(
  node: LayoutNode,
  contentWidth: number,
  intrusions: Intrusions,
  bands: LineBand[],
): LineOpener {
  const { lineGap } = node.style;
  const origin = contentOrigin(node);
  const x0 = intrusions.x + origin.x;
  const y0 = intrusions.y + origin.y;
  const floatsEnd = floatsBottom(intrusions.boxes);
  // Only an inline box makes a line taller than a row: its rows, by its
  // marker's index.
  const boxes = inlineBoxesOf(node);
  const boxRows = new Map<number, number>();
  if (boxes.length > 0) {
    eachObjectMarker(node.text, (charIndex, boxIndex) => {
      boxRows.set(charIndex, boxes[boxIndex]!.localRect.height);
    });
  }
  const lineRows = (span: LineSpan): number => {
    let rows = 1;
    if (boxRows.size > 0) {
      for (let i = span.start; i < span.end; i++) rows = Math.max(rows, boxRows.get(i) ?? 1);
    }
    return rows;
  };
  return (index, closed) => {
    let row = 0;
    if (index > 0) row = bands[index - 1]!.row + lineRows(closed[index - 1]!) + lineGap;
    for (;;) {
      const band = bandAt(intrusions.boxes, intrusions.contentWidth, y0 + row);
      const start = Math.max(band.x, x0);
      const end = Math.min(band.x + band.width, x0 + contentWidth);
      if (end > start || y0 + row >= floatsEnd) {
        const band = { row, x: Math.max(0, start - x0), width: Math.max(0, end - start) };
        bands[index] = band;
        return band.width;
      }
      row++;
    }
  };
}

/** A leaf's line spans: hard `<br>` lines under nowrap/pre, greedy
 * word-wrap at the content width otherwise — each line opened through
 * `openLine` when given (a hard line takes its row's band too). */
export function leafLineSpans(
  node: LayoutNode,
  contentWidth: number,
  openLine?: LineOpener,
): LineSpan[] {
  if (node.style.whiteSpace !== "normal") {
    const spans = hardLineSpans(node.text);
    if (openLine) {
      const closed: LineSpan[] = [];
      for (const span of spans) {
        openLine(closed.length, closed);
        closed.push(span);
      }
    }
    return spans;
  }
  return wrapLineSpans(node.text, contentWidth, {
    advances: node.advances,
    tracking: node.style.tracking,
    firstLineIndent: node.style.textIndent,
    openLine,
  });
}

/**
 * Per-line height and text drop for a leaf's wrapped lines. Lines are one
 * row tall unless an atomic inline box on the line is taller — the line
 * grows to the tallest box (per CSS line-box growth). `vertical-align:
 * bottom` on a box drops the line's TEXT to the box's last row
 * (grid-exact in every engine, probed); a middle-aligned box puts it on
 * the box's middle row, the lower of two for an even height; the
 * largest offset wins. top/baseline behave as top (cell-model
 * deviation — baseline is off-grid). Each box records its line's text
 * row for its native placement. Requires the leaf's inline boxes to be
 * laid out already (their rect heights are read here).
 */
export function leafLineMetrics(
  node: LayoutNode,
  spans: readonly LineSpan[],
): { heights: number[]; textOffsets: number[] } {
  const boxes = inlineBoxesOf(node);
  const heights: number[] = [];
  const textOffsets: number[] = [];
  let boxIndex = 0;
  for (const span of spans) {
    let height = 1;
    let textOffset = 0;
    const lineBoxes: LayoutNode[] = [];
    for (let i = span.start; i < span.end; i++) {
      if (node.text[i] !== OBJECT_REPLACEMENT) continue;
      const box = boxes[boxIndex++]!;
      lineBoxes.push(box);
      const rows = box.localRect.height;
      height = Math.max(height, rows);
      if (box.style.verticalAlign === "end") textOffset = Math.max(textOffset, rows - 1);
      else if (box.style.verticalAlign === "center") {
        textOffset = Math.max(textOffset, Math.floor((rows - 1) / 2));
      }
    }
    const offset = Math.min(textOffset, height - 1);
    for (const box of lineBoxes) box.inlineTextRow = offset;
    heights.push(height);
    textOffsets.push(offset);
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

/** A box's border and padding on an axis, which its size never goes
 * below (specs/cell-model.md "Box model"). */
export function edges(border: Insets, padding: Insets, axis: "x" | "y"): number {
  return axis === "x"
    ? border.left + border.right + padding.left + padding.right
    : border.top + border.bottom + padding.top + padding.bottom;
}

/** Where a laid-out box's content box starts in its border box. */
export function contentOrigin(node: LayoutNode): { x: number; y: number } {
  const { border } = node.style;
  const padding = node.resolvedPadding;
  return { x: border.left + padding.left, y: border.top + padding.top };
}

/** A box's border, padding and reserved scrollbar gutter on an axis
 * from its style, before it lays out: percent padding resolves against
 * `basis`, as 0 where that is indefinite (intrinsic sizing). */
export function boxChrome(style: CellStyle, axis: "x" | "y", basis?: number): number {
  const { border, padding } = style;
  const gutter = scrollGutter(style);
  return axis === "x"
    ? border.left +
        border.right +
        resolveLength(padding.left, basis) +
        resolveLength(padding.right, basis) +
        gutter.right
    : border.top +
        border.bottom +
        resolveLength(padding.top, basis) +
        resolveLength(padding.bottom, basis) +
        gutter.bottom;
}

/** Resolve a spacing length to cells against its containing-block basis.
 * An indefinite basis (percent gap in an unbounded axis) resolves to 0. */
export function resolveLength(length: CellLength, basis: number | undefined): number {
  if (typeof length === "number") return length;
  if (basis === undefined || !Number.isFinite(basis)) return 0;
  return percentToCells(length.percent, basis) + (length.cells ?? 0);
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

/** A box's resolved margins on an axis, `auto` counting 0. */
export function fixedMargins(margin: NullableInsets, axis: "x" | "y"): number {
  return axis === "x"
    ? (margin.left ?? 0) + (margin.right ?? 0)
    : (margin.top ?? 0) + (margin.bottom ?? 0);
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
  if (available === undefined) return undefined;
  return percentToCells(limit.percent, available) + (limit.cells ?? 0);
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
 *   for two negatives, and the sum for mixed signs (standard CSS rule);
 *   between siblings only (specs/cell-model.md deviation 1).
 * - Horizontal (cross-axis) margins position the child; `auto` on either
 *   side centers or end-aligns as CSS does.
 */
function layoutBlock(
  node: LayoutNode,
  innerWidth: number,
  definiteInnerHeight: number | undefined,
  cache: IntrinsicCache,
): number {
  const { x: originX, y: startY } = contentOrigin(node);
  // The floats placed so far, in content-box cells (specs/float.md).
  const floats: FloatBox[] = [];
  let y = startY;
  let previousMarginBottom: number | null = null;
  for (const child of node.children) {
    const childMargin = resolveMargin(child.style.margin, innerWidth);
    const marginTop = childMargin.top ?? 0;
    const marginBottom = childMargin.bottom ?? 0;
    const marginLeft = childMargin.left ?? 0;
    const marginRight = childMargin.right ?? 0;
    // `y` tracks the position where the next child's top edge goes. Margins
    // are added JUST BEFORE placing each child, then only the child's height
    // afterwards — the child's own bottom margin waits until the next
    // sibling (or the end-of-container) so we can collapse them properly.
    const hypothetical =
      y +
      (previousMarginBottom === null
        ? marginTop
        : collapseMargins(previousMarginBottom, marginTop));
    if (isOutOfFlow(child.style)) {
      // Record the CSS static position (where the box would have started in
      // flow) without consuming space or disturbing margin collapsing.
      child.staticSlot = { kind: "block", x: originX + marginLeft, y: hypothetical };
      continue;
    }
    const availableWidth = Math.max(0, innerWidth - marginLeft - marginRight);
    if (child.style.float !== "none") {
      // A float's margins collapse with nothing: its margin box starts
      // where the previous bottom margin ends, cleared, and CSS 2.1
      // §9.5.1 places it; the cursor never sees it.
      const top = clearanceBelow(
        floats,
        child.style.clear,
        y + (previousMarginBottom ?? 0) - startY,
      );
      layoutNode(child, availableWidth, definiteInnerHeight, 0, 0, "shrink", cache);
      const width = child.localRect.width + marginLeft + marginRight;
      const height = child.localRect.height + marginTop + marginBottom;
      const placed = placeFloat(floats, innerWidth, child.style.float, top, width, height);
      floats.push({ ...placed, width, height, side: child.style.float });
      child.localRect = {
        ...child.localRect,
        x: originX + placed.x + marginLeft,
        y: startY + placed.y + marginTop,
      };
      continue;
    }
    // Clearance: the border top is the later of the hypothetical top and
    // the named floats' bottom (§9.5.2).
    const top = startY + clearanceBelow(floats, child.style.clear, hypothetical - startY);
    if (floats.length > 0 && isFormattingContextRoot(child)) {
      const placed = layoutRootBesideFloats(
        child,
        floats,
        innerWidth,
        top - startY,
        childMargin,
        definiteInnerHeight,
        cache,
      );
      child.localRect = { ...child.localRect, x: originX + placed.x, y: startY + placed.y };
    } else {
      // The child keeps its slot; beside floats a leaf wraps against them
      // from its own top, laid out again at its cross offset when auto
      // margins move it (its width being known).
      const lay = (offsetX: number): void =>
        layoutNode(
          child,
          availableWidth,
          definiteInnerHeight,
          0,
          0,
          "fill",
          cache,
          undefined,
          floats.length > 0
            ? { boxes: floats, contentWidth: innerWidth, x: offsetX, y: top - startY }
            : undefined,
        );
      lay(marginLeft);
      let crossOffset = blockCrossOffset(childMargin, innerWidth, child.localRect.width);
      if (floats.length > 0 && crossOffset !== marginLeft) {
        lay(crossOffset);
        crossOffset = blockCrossOffset(childMargin, innerWidth, child.localRect.width);
      }
      child.localRect = { ...child.localRect, x: originX + crossOffset, y: top };
    }
    y = child.localRect.y + child.localRect.height;
    previousMarginBottom = marginBottom;
  }
  if (previousMarginBottom !== null) y += previousMarginBottom;
  if (floats.length > 0 || node.children.some((child) => child.anonymous)) {
    placeFlowChildren(node, originX, startY, innerWidth, floats);
  }
  // A container contains its floats (specs/float.md).
  return Math.max(y - startY, floatsBottom(floats));
}

/** Lays out a formatting-context root beside the floats and returns its
 * border-box origin in the container's content box, as browsers place
 * one (CSS 2.1 §9.5, specs/float.md): at the first row from `top` —
 * that row, then each float bottom below it — whose band holds its
 * margin box, an auto width shrinking to the band, and laid out again
 * when a float lower down narrows the band over the height that came
 * out. Below every float the full width is back. */
function layoutRootBesideFloats(
  child: LayoutNode,
  floats: FloatBox[],
  innerWidth: number,
  top: number,
  margin: NullableInsets,
  definiteInnerHeight: number | undefined,
  cache: IntrinsicCache,
): { x: number; y: number } {
  const marginX = fixedMargins(margin, "x");
  const minWidth = widthContribution(child, "min", cache) + marginX;
  const lay = (width: number): void =>
    layoutNode(child, Math.max(0, width - marginX), definiteInnerHeight, 0, 0, "fill", cache);
  const rows = [...new Set(floats.map((box) => box.y + box.height))]
    .filter((bottom) => bottom > top)
    .sort((a, b) => a - b);
  for (const row of [top, ...rows.slice(0, -1)]) {
    let band = bandAt(floats, innerWidth, row);
    while (band.width >= minWidth) {
      lay(band.width);
      const over = bandAt(floats, innerWidth, row, child.localRect.height);
      if (over.width >= child.localRect.width + marginX) {
        return { x: over.x + blockCrossOffset(margin, over.width, child.localRect.width), y: row };
      }
      // Nothing narrower to try: an explicit width the band can't hold.
      if (over.width === band.width) break;
      band = over;
    }
  }
  const below = rows[rows.length - 1] ?? top;
  lay(innerWidth);
  return { x: blockCrossOffset(margin, innerWidth, child.localRect.width), y: below };
}

/** Native margins that put a mixed container's in-flow block children,
 * and the run after each, where the engine did (specs/cell-model.md
 * "Inline content"): a run advances the native cursor by its line
 * boxes, `lines × (1 + gap)` rows, a child by its height, and the
 * container's half-leading lift raises it all, so a child starts
 * half a gap below its engine row. A float moves no cursor and keeps
 * its authored margins, the browser placing it as the engine did from
 * the same base: the child before it carries its pending bottom margin
 * natively (a float sits past it, probed), the float's top margin
 * absorbing any part it does not, and the child after collapses its
 * top margin with it as siblings do. A root beside a float has its
 * left margin measured from the band's edge, where the browser adds it
 * (specs/float.md). */
function placeFlowChildren(
  node: LayoutNode,
  originX: number,
  startY: number,
  innerWidth: number,
  floats: FloatBox[],
): void {
  const gap = node.style.lineGap;
  const pendingBottom = (child: LayoutNode) =>
    resolveMargin(child.style.margin, innerWidth).bottom ?? 0;
  let cursor = startY;
  let previous: LayoutNode | undefined;
  const floated: { float: LayoutNode; previous: LayoutNode | undefined }[] = [];
  for (const child of node.children) {
    if (isOutOfFlow(child.style)) continue;
    const { x, y, height } = child.localRect;
    if (child.style.float !== "none") {
      if (previous?.flow) previous.flow.bottom = Math.max(0, pendingBottom(previous));
      floated.push({ float: child, previous });
      continue;
    }
    if (child.anonymous) {
      if (previous?.flow) previous.flow.bottom = y - cursor;
      cursor = y + height + gap;
    } else {
      const bandX =
        floats.length > 0 && isFormattingContextRoot(child)
          ? bandAt(floats, innerWidth, y - startY, height).x
          : 0;
      // Against the margin the child before carries, the top margin that
      // collapses to the distance: the distance itself when it is the
      // larger, else the mixed-sign sum's remainder.
      const carried = previous?.flow?.bottom ?? 0;
      const distance = y + gap / 2 - cursor;
      child.flow = {
        top: distance >= carried ? distance : distance - carried,
        right: 0,
        bottom: 0,
        left: x - originX - bandX,
      };
      cursor = y + gap / 2 + height;
    }
    previous = child;
  }
  for (const { float, previous: before } of floated) {
    const margin = resolveMargin(float.style.margin, innerWidth);
    const absorbed = before?.flow ? pendingBottom(before) - (before.flow.bottom ?? 0) : 0;
    float.flow = {
      top: (margin.top ?? 0) + absorbed,
      right: margin.right ?? 0,
      bottom: margin.bottom ?? 0,
      left: margin.left ?? 0,
    };
  }
}

/** Horizontal placement of a box inside its block-flow slot: `auto`
 * margins center or end-align, fixed margins offset (CSS block flow;
 * multicol columns use the same rule). */
export function blockCrossOffset(
  margin: NullableInsets,
  slotWidth: number,
  boxWidth: number,
): number {
  return autoMarginOffset(margin.left, margin.right, slotWidth, boxWidth) ?? margin.left!;
}

/** A box's offset in `space` along one axis where a margin (`null`) is
 * auto, in block flow, flex and grid (an absolute box's: positioning.ts):
 * the auto margins take the free space, split when both are, and zero
 * where there is none. Undefined where neither is auto. */
export function autoMarginOffset(
  before: number | null,
  after: number | null,
  space: number,
  size: number,
): number | undefined {
  if (before !== null && after !== null) return undefined;
  const free = Math.max(0, space - size - (before ?? 0) - (after ?? 0));
  if (before === null && after === null) return Math.floor(free / 2);
  return before ?? free;
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
  node: LayoutNode,
  available: number,
  mode: SizingMode,
  cache: IntrinsicCache,
): number {
  const style = node.style;
  // Tables shrink-to-fit even in block flow, floored at their min sum
  // (specs/table.md step 3); fixed layout fills, percents inflate. A
  // table degraded to a text leaf (no rows) shrink-to-fits on its plain
  // intrinsics.
  const isTable = style.display === "table";
  const laysOutAsTable = isTable && !laysOutAsTextLeaf(node);
  if (style.width !== undefined) {
    const resolved = resolveSizeAgainst(style.width, available, node, cache);
    if (!laysOutAsTable) return resolved;
    return Math.max(
      resolved,
      tableIntrinsicInnerWidths(node, cache).min + boxChrome(style, "x", available),
    );
  }
  if (laysOutAsTable) return tableUsedOuterWidth(node, available, cache);
  return mode === "shrink" || isTable
    ? Math.min(available, intrinsicOuterWidth(node, "max", cache))
    : available;
}

/** How far a box's content reaches past its border-box origin, in
 * cells: children's own scrollable extents plus its text's extent —
 * CSS scrollable overflow counts descendants' overflow unless a box
 * clips it (`scrollableExtent`). */
function contentExtent(node: LayoutNode): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const child of node.children) {
    if (child.style.position === "fixed") continue;
    const extent = scrollableExtent(child);
    x = Math.max(x, child.localRect.x + extent.x);
    y = Math.max(y, child.localRect.y + extent.y);
  }
  if (node.textExtent) {
    const origin = contentOrigin(node);
    x = Math.max(x, origin.x + node.textExtent.width);
    y = Math.max(y, origin.y + node.textExtent.rows);
  }
  return { x, y };
}

/** A box's contribution to its parent's scrollable overflow: its own
 * box, grown by its content's overflow on each axis it leaves
 * visible. */
function scrollableExtent(node: LayoutNode): { x: number; y: number } {
  const { width, height } = node.localRect;
  const clipsX = node.style.overflow.x !== "visible";
  const clipsY = node.style.overflow.y !== "visible";
  if (clipsX && clipsY) return { x: width, y: height };
  const content = contentExtent(node);
  return {
    x: clipsX ? width : Math.max(width, content.x),
    y: clipsY ? height : Math.max(height, content.y),
  };
}

function resolveHeight(style: CellStyle, available: number | undefined): number | undefined {
  if (style.height?.kind === "cells") return style.height.value;
  if (style.height?.kind === "percent" && available != null)
    return percentToCells(style.height.value, available);
  return undefined;
}

/** Resolve a width against the available width: cells as themselves, a
 * percent of it, and the intrinsic keywords as the node's content
 * widths — fit-content the available width clamped between them. */
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
      return intrinsicOuterWidth(node, "min", cache);
    case "max-content":
      return intrinsicOuterWidth(node, "max", cache);
    case "fit-content":
      return Math.min(
        intrinsicOuterWidth(node, "max", cache),
        Math.max(intrinsicOuterWidth(node, "min", cache), available),
      );
  }
}

/**
 * A box's min- or max-content outer width: its content's plus its chrome.
 * A text leaf's min-content is its longest unbreakable unit (a word under
 * normal wrapping, a whole hard line under `nowrap`), its max-content the
 * unwrapped text. A flex row sums its items, at min-content only when it
 * can't wrap; other containers take the widest child (at max-content,
 * floats share a line and multicol multiplies by its columns).
 */
export function intrinsicOuterWidth(
  node: LayoutNode,
  kind: "min" | "max",
  cache: IntrinsicCache,
): number {
  const widths = kind === "min" ? cache.minContent : cache.maxContent;
  const cached = widths.get(node);
  if (cached !== undefined) return cached;
  const result = intrinsicInnerWidth(node, kind, cache) + boxChrome(node.style, "x");
  widths.set(node, result);
  return result;
}

function intrinsicInnerWidth(node: LayoutNode, kind: "min" | "max", cache: IntrinsicCache): number {
  const style = node.style;
  const inFlow = node.children.filter(isInFlowBox);
  if (inFlow.length === 0) {
    if (kind === "max") {
      return style.display === "multicol"
        ? multicolIntrinsicInnerWidth(style, node.intrinsicWidth)
        : node.intrinsicWidth;
    }
    if (!node.text || style.whiteSpace !== "normal") return node.intrinsicWidth;
    return longestSegmentAdvance(node.text, { advances: node.advances, tracking: style.tracking });
  }
  if (style.display === "grid") return gridIntrinsicInnerWidths(node, cache)[kind];
  if (style.display === "table") return tableIntrinsicInnerWidths(node, cache)[kind];
  const contributions = inFlow.map((c) => widthContribution(c, kind, cache));
  if (
    style.display === "flex" &&
    style.flexDirection === "row" &&
    (kind === "max" || style.flexWrap === "nowrap")
  ) {
    const gap = resolveGap(style, "x", undefined) * (inFlow.length - 1);
    return contributions.reduce((sum, width) => sum + width, 0) + gap;
  }
  const widest = contributions.reduce((max, width) => Math.max(max, width), 0);
  if (kind === "min") return widest;
  if (style.display === "multicol") return multicolIntrinsicInnerWidth(style, widest);
  if (style.display === "block" && inFlow.some((c) => c.style.float !== "none")) {
    // Floats share a line with the content beside them; a cleared child
    // starts a new one (specs/float.md).
    let widestLine = 0;
    let floatsWidth = 0;
    let beside = 0;
    inFlow.forEach((c, i) => {
      const width = contributions[i]!;
      if (c.style.float !== "none") floatsWidth += width;
      else if (c.style.clear !== "none") {
        widestLine = Math.max(widestLine, floatsWidth + beside);
        floatsWidth = 0;
        beside = width;
      } else beside = Math.max(beside, width);
    });
    return Math.max(widestLine, floatsWidth + beside);
  }
  return widest;
}

/** A child's `kind` contribution to its parent's intrinsic width: an
 * explicit width in cells or as an intrinsic keyword (`w-min`, `w-max`),
 * else its `kind`-content outer width — which a percent width takes
 * (intrinsic contribution rules) and fit-content too, its contributions
 * being auto's (css-sizing-3); clamped by its own fixed min/max, and
 * floored at its border and padding. */
export function widthContribution(
  child: LayoutNode,
  kind: "min" | "max",
  cache: IntrinsicCache,
): number {
  const { width, minWidth, maxWidth } = child.style;
  const outer =
    width === undefined || width.kind === "percent" || width.kind === "fit-content"
      ? intrinsicOuterWidth(child, kind, cache)
      : resolveSizeAgainst(width, 0, child, cache);
  const min = typeof minWidth === "number" ? minWidth : 0;
  const max = typeof maxWidth === "number" ? maxWidth : undefined;
  return Math.max(boxChrome(child.style, "x"), clampSize(outer, min, max));
}

function shrinkSize(
  width: number,
  height: number,
  border: Insets,
  padding: Insets,
): { width: number; height: number } {
  return {
    width: Math.max(0, width - edges(border, padding, "x")),
    height: Math.max(0, height - edges(border, padding, "y")),
  };
}
