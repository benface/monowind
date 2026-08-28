import { pxToCells } from "./metrics.ts";
import { readCellStyle, trackingCells } from "./style.ts";
import { zeroInsets } from "./types.ts";
import { lineAdvance } from "./wrap.ts";
import type { CellMetrics, LayoutNode, PerSide } from "./types.ts";

/**
 * Build a LayoutNode tree from an element subtree.
 *
 * Rules:
 * - Elements with computed `display: none` are skipped entirely.
 * - An element becomes a **leaf** if it has no element children, or if all
 *   its element children have computed `display: inline`/`inline-*`/`contents`
 *   (they're part of the inline text flow, not laid out separately). The
 *   leaf's `text` is the element's combined `textContent`, so text nodes
 *   interleaved with inline elements (`<div>hello <span>world</span></div>`)
 *   participate in the wrap calculation and render correctly.
 * - Elements with at least one block-level element child become **containers**
 *   and recurse. Direct text nodes on containers (uncommon in utility-first
 *   markup) are not laid out — CSS creates anonymous inline boxes for them,
 *   but our absolutely-positioned children escape that flow. This is
 *   documented as a deviation in specs/cell-model.md.
 *
 * `cellMetrics` (measured by the host) is the basis for leading and
 * tracking; absent in headless tests (see readCellStyle).
 */
export function buildTree(
  root: Element,
  rootFontSizePx: number,
  cellMetrics?: CellMetrics,
): LayoutNode | null {
  const style = readCellStyle(root, rootFontSizePx, cellMetrics);
  if (style.display === "none") return null;

  const elementChildren = Array.from(root.children);
  const isInlineOnly = elementChildren.every(hasInlineDisplay);

  if (isInlineOnly) {
    const run = extractLeafRun(
      root,
      style.tracking,
      rootFontSizePx,
      cellMetrics?.letterSpacing ?? 0,
    );
    const text = run.chars.join("");
    const intrinsicWidth = longestLineAdvance(text, run.advances, style.tracking);
    const intrinsicHeight = text.length > 0 ? countHardLines(text) : 0;
    const node: LayoutNode = {
      source: root,
      style,
      children: [],
      text,
      intrinsicWidth,
      intrinsicHeight,
      localRect: { x: 0, y: 0, width: intrinsicWidth, height: intrinsicHeight },
      unclampedHeight: 0,
      resolvedPadding: zeroInsets(),
    };
    if (run.advances.some((a) => a !== 1)) node.advances = run.advances;
    if (run.inlineElements.length > 0) node.inlineElements = run.inlineElements;
    return node;
  }

  const children: LayoutNode[] = [];
  for (const child of elementChildren) {
    const node = buildTree(child, rootFontSizePx, cellMetrics);
    if (node) children.push(node);
  }
  return {
    source: root,
    style,
    children,
    text: "",
    intrinsicWidth: 0,
    intrinsicHeight: 0,
    localRect: { x: 0, y: 0, width: 0, height: 0 },
    unclampedHeight: 0,
    resolvedPadding: zeroInsets(),
  };
}

/**
 * HTML tags whose default display is inline. Checked BEFORE computed display
 * because a flex/grid parent "blockifies" its direct children (per CSS), so
 * `<br>`/`<span>`/etc. inside a `display: flex` element compute to "block".
 * For our purposes those are still semantically inline text-flow markers
 * and shouldn't force their parent into container mode.
 */
const INLINE_BY_DEFAULT_TAGS = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "BR",
  "CITE",
  "CODE",
  "DATA",
  "DFN",
  "EM",
  "I",
  "KBD",
  "MARK",
  "Q",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
  "WBR",
]);

function hasInlineDisplay(el: Element): boolean {
  if (INLINE_BY_DEFAULT_TAGS.has(el.tagName)) return true;
  const display = getComputedStyle(el).display;
  return display.startsWith("inline") || display === "contents";
}

interface LeafRun {
  chars: string[];
  /** Cells each character occupies: `1 + tracking` of its innermost element. */
  advances: number[];
  inlineElements: NonNullable<LayoutNode["inlineElements"]>;
}

/**
 * Walk a leaf's childNodes and produce its text run — with `<br>` emitted as
 * `\n` so the wrap calculation counts the line break the browser will honor
 * — plus per-character advances and the inline elements the renderer must
 * write grid typography (and rewritten relative insets) onto.
 *
 * Whitespace inside text nodes (including literal newlines from source
 * formatting) collapses to single spaces, exactly like the browser under
 * `white-space: normal` — ONLY `<br>` produces a hard `\n`. Whitespace
 * around a hard break is stripped (the browser strips it at line edges too).
 * CSS collapsible white space only (space/tab/CR/LF/FF) — NOT `\s`, which
 * would also eat NBSP (U+00A0); the browser preserves NBSP and never breaks
 * at it.
 */
function extractLeafRun(
  el: Element,
  tracking: number,
  rootFontSizePx: number,
  rootLetterSpacingPx: number,
): LeafRun {
  const run: LeafRun = { chars: [], advances: [], inlineElements: [] };
  collectRun(el, tracking, rootFontSizePx, rootLetterSpacingPx, run);
  return normalizeRun(run);
}

function collectRun(
  el: Element,
  tracking: number,
  rootFontSizePx: number,
  rootLetterSpacingPx: number,
  run: LeafRun,
): void {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const ch of (node.textContent ?? "").replace(/[ \t\r\n\f]+/g, " ")) {
        run.chars.push(ch);
        run.advances.push(1 + tracking);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (child.tagName === "BR") {
        run.chars.push("\n");
        run.advances.push(0);
        continue;
      }
      // Reads happen during the measure pass, so authored values are visible.
      const cs = getComputedStyle(child);
      const childTracking = trackingCells(
        cs.letterSpacing,
        parseFloat(cs.fontSize) || rootFontSizePx,
        rootLetterSpacingPx,
      );
      run.inlineElements.push({
        element: child,
        tracking: childTracking,
        insets: cs.position === "static" ? null : inlineInsets(cs, rootFontSizePx),
      });
      collectRun(child, childTracking, rootFontSizePx, rootLetterSpacingPx, run);
    }
  }
}

/** Authored relative insets of an inline element, rewritten to whole cells
 * by the renderer (specs/positioning.md). Percent insets on inline elements
 * are unsupported (`null`); `absolute`/`fixed` behave as relative — both
 * documented deviations. */
function inlineInsets(cs: CSSStyleDeclaration, rootFontSizePx: number): PerSide<number | null> {
  const side = (value: string): number | null => {
    if (!value || value === "auto" || value.endsWith("%")) return null;
    const px = parseFloat(value);
    return Number.isFinite(px) ? pxToCells(px, rootFontSizePx) : null;
  };
  return { top: side(cs.top), right: side(cs.right), bottom: side(cs.bottom), left: side(cs.left) };
}

/** Collapse consecutive spaces (also across inline-element boundaries), trim
 * spaces at hard-line edges, and drop leading/trailing blank lines — keeping
 * chars and advances in lockstep. */
function normalizeRun(run: LeafRun): LeafRun {
  const chars: string[] = [];
  const advances: number[] = [];
  const lineStart = () => {
    let i = chars.length;
    while (i > 0 && chars[i - 1] !== "\n") i--;
    return i;
  };
  const trimLineEnd = () => {
    while (chars.length > lineStart() && chars[chars.length - 1] === " ") {
      chars.pop();
      advances.pop();
    }
  };
  for (let i = 0; i < run.chars.length; i++) {
    const ch = run.chars[i]!;
    if (ch === " ") {
      // Skip spaces at a line start and after another space.
      const atLineStart = chars.length === lineStart();
      if (atLineStart || chars[chars.length - 1] === " ") continue;
    } else if (ch === "\n") {
      trimLineEnd();
    }
    chars.push(ch);
    advances.push(run.advances[i]!);
  }
  trimLineEnd();
  // Drop leading/trailing blank hard lines (source formatting), like trim().
  while (chars[0] === "\n") {
    chars.shift();
    advances.shift();
  }
  while (chars[chars.length - 1] === "\n") {
    chars.pop();
    advances.pop();
  }
  return { chars, advances, inlineElements: run.inlineElements };
}

function longestLineAdvance(text: string, advances: number[], tracking: number): number {
  let max = 0;
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      max = Math.max(max, lineAdvance(lineStart, i, advances, tracking));
      lineStart = i + 1;
    }
  }
  return max;
}

function countHardLines(text: string): number {
  return text.split("\n").length;
}
