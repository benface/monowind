import { intrinsicOuterWidth, makeIntrinsicCache } from "./layout.ts";
import { pxToCells } from "./metrics.ts";
import { readCellStyle, trackingCells } from "./style.ts";
import { zeroInsets } from "./types.ts";
import { warnOnce } from "./warn.ts";
import { eachObjectMarker, INLINE_PAD, lineAdvance, OBJECT_REPLACEMENT } from "./wrap.ts";
import type { CellMetrics, LayoutNode, PerSide } from "./types.ts";

/**
 * Build a LayoutNode tree from an element subtree.
 *
 * Rules (specs/cell-model.md "Inline detection"):
 * - Elements with computed `display: none` are skipped entirely (their
 *   text never joins a run).
 * - An element is a **leaf** when it has no IN-FLOW block-level element
 *   children: in-flow inline children (computed `inline`/`inline-*`/
 *   `contents`) are part of the text run, and out-of-flow children
 *   (absolute/fixed — blockified per CSS) hang off the leaf as layout
 *   nodes for the positioning pass. The leaf's `text` is its combined
 *   in-flow text, so text nodes interleaved with inline elements
 *   (`<div>hello <span>world</span></div>`) participate in the wrap
 *   calculation and render correctly.
 * - Elements with at least one in-flow block-level element child become
 *   **containers** and recurse. Direct text nodes on containers (uncommon
 *   in utility-first markup) are not laid out — a documented deviation.
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
  const roles = elementChildren.map(childRole);

  if (!roles.includes("block")) {
    // Leaf: in-flow inline content forms the text run (atomic inline
    // boxes ride it as U+FFFC markers); out-of-flow children become
    // layout nodes for the positioning pass.
    const run = extractLeafRun(root, style.tracking, {
      rootFontSizePx,
      rootLetterSpacingPx: cellMetrics?.letterSpacing ?? 0,
      cellMetrics,
      preserve: style.whiteSpace === "pre",
      tabSize: style.tabSize,
    });
    const text = run.chars.join("");
    // Intrinsic advances for the box markers use the boxes' max-content
    // widths; layout overwrites them with the laid-out widths per pass.
    if (run.boxes.length > 0) {
      const cache = makeIntrinsicCache();
      eachObjectMarker(run.chars, (charIndex, boxIndex) => {
        run.advances[charIndex] = Math.max(1, intrinsicOuterWidth(run.boxes[boxIndex]!, cache));
      });
    }
    const intrinsicWidth = longestLineAdvance(text, run.advances, style.tracking);
    const intrinsicHeight = text.length > 0 ? countHardLines(text) : 0;
    const children: LayoutNode[] = [...run.boxes];
    for (let i = 0; i < elementChildren.length; i++) {
      if (roles[i] !== "out-of-flow") continue;
      const child = buildTree(elementChildren[i]!, rootFontSizePx, cellMetrics);
      if (child) children.push(child);
    }
    const node: LayoutNode = {
      source: root,
      style,
      children,
      text,
      intrinsicWidth,
      intrinsicHeight,
      localRect: { x: 0, y: 0, width: intrinsicWidth, height: intrinsicHeight },
      unclampedHeight: 0,
      resolvedPadding: zeroInsets(),
    };
    if (run.advances.some((a) => a !== 1) || run.boxes.length > 0) node.advances = run.advances;
    if (run.inlineElements.length > 0) {
      node.inlineElements = run.inlineElements;
      node.charInline = run.chars.map((_, i) => run.inlineIndex[i] ?? -1);
    }
    return node;
  }

  const children: LayoutNode[] = [];
  for (let i = 0; i < elementChildren.length; i++) {
    if (roles[i] === "none") continue;
    const node = buildTree(elementChildren[i]!, rootFontSizePx, cellMetrics);
    if (node) children.push(node);
  }
  const container: LayoutNode = {
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
  flagDroppedText(root, container);
  return container;
}

/**
 * HTML tags whose default display is inline — a FALLBACK for environments
 * whose getComputedStyle returns "" for un-styled elements (happy-dom in
 * the headless tests). Real browsers always resolve a computed display,
 * so there this list is never consulted: computed display decides, and
 * CSS blockification (flex/grid children, absolute positioning) is
 * honored (specs/cell-model.md "Inline detection").
 */
const FALLBACK_INLINE_TAGS = new Set([
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

/** Resolve a computed display, falling back per tag for environments
 * that return "" (happy-dom). */
function resolvedDisplay(el: Element, display: string): string {
  return display || (FALLBACK_INLINE_TAGS.has(el.tagName) ? "inline" : "block");
}

/** True for content that flows WITH the surrounding text (computed
 * `inline` or `contents`). */
function isRunInline(el: Element, display: string): boolean {
  const resolved = resolvedDisplay(el, display);
  return resolved === "inline" || resolved === "contents";
}

/** Atomic inline-level boxes (`inline-flex`/`inline-block`/`inline-grid`)
 * ride the line as single unbreakable units with their own internal
 * layout (specs/cell-model.md). */
function isAtomicInline(el: Element, display: string): boolean {
  const resolved = resolvedDisplay(el, display);
  return resolved.startsWith("inline") && resolved !== "inline";
}

/** Classify a direct child: skipped, out-of-flow box, text-run content
 * (plain inline AND atomic inline boxes), or in-flow block (which forces
 * container mode). */
function childRole(el: Element): "none" | "out-of-flow" | "inline" | "block" {
  const cs = getComputedStyle(el);
  if (cs.display === "none") return "none";
  if (cs.position === "absolute" || cs.position === "fixed") return "out-of-flow";
  if (isRunInline(el, cs.display) || isAtomicInline(el, cs.display)) return "inline";
  return "block";
}

interface LeafRun {
  chars: string[];
  /** Cells each character occupies: `1 + tracking` of its innermost element. */
  advances: number[];
  /** Per character: index into `inlineElements` (-1 = direct leaf text). */
  inlineIndex: number[];
  inlineElements: NonNullable<LayoutNode["inlineElements"]>;
  /** Atomic inline boxes, in run order — each corresponds to one U+FFFC
   * marker in `chars` (layout resolves the marker's advance to the box's
   * laid-out width). */
  boxes: LayoutNode[];
}

interface RunContext {
  rootFontSizePx: number;
  rootLetterSpacingPx: number;
  cellMetrics: CellMetrics | undefined;
  /** Leaf-level `white-space: pre`: keep the source's spaces and newlines
   * (tabs expand to `tabSize` stops from each hard line's start) instead
   * of collapsing. Applies to the whole run — a `white-space` override on
   * an inline descendant is not honored (specs/cell-model.md). */
  preserve: boolean;
  tabSize: number;
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
 * at it. A `white-space: pre` leaf skips all of that: spaces and newlines
 * survive as authored and tabs expand to tab stops (see RunContext).
 */
function extractLeafRun(el: Element, tracking: number, ctx: RunContext): LeafRun {
  const run: LeafRun = { chars: [], advances: [], inlineIndex: [], inlineElements: [], boxes: [] };
  collectRun(el, tracking, ctx, run);
  if (ctx.preserve) {
    // Browsers give a final newline in `pre` content no line box of its
    // own — drop exactly one (the HTML parser already ate the one right
    // after the opening tag).
    if (run.chars[run.chars.length - 1] === "\n") {
      run.chars.pop();
      run.advances.pop();
      run.inlineIndex.pop();
    }
    return run;
  }
  return normalizeRun(run);
}

function collectRun(el: Element, tracking: number, ctx: RunContext, run: LeafRun): void {
  // Cells since the current hard line began — the tab-stop basis.
  const column = (): number => {
    let cells = 0;
    for (let i = run.chars.length - 1; i >= 0 && run.chars[i] !== "\n"; i--) {
      cells += run.advances[i]!;
    }
    return cells;
  };
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (ctx.preserve) {
        // `white-space: pre`: spaces and newlines survive as authored;
        // tabs expand to the next `tabSize` stop (spaces are pushed
        // untracked — tab stops are grid columns, not glyphs).
        for (const ch of (node.textContent ?? "").replace(/\r\n?/g, "\n")) {
          if (ch === "\n") {
            run.chars.push("\n");
            run.advances.push(0);
          } else if (ch === "\t") {
            const target = (Math.floor(column() / ctx.tabSize) + 1) * ctx.tabSize;
            for (let cells = column(); cells < target; cells++) {
              run.chars.push(" ");
              run.advances.push(1);
            }
          } else {
            run.chars.push(ch);
            run.advances.push(1 + tracking);
          }
        }
      } else {
        for (const ch of (node.textContent ?? "").replace(/[ \t\r\n\f]+/g, " ")) {
          run.chars.push(ch);
          run.advances.push(1 + tracking);
        }
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
      // Skipped or out-of-flow content never joins the run (a hidden
      // span's text must not render; an absolute span leaves the flow).
      if (cs.display === "none" || cs.position === "absolute" || cs.position === "fixed") continue;
      // An atomic inline box rides the run as ONE unbreakable unit: a
      // U+FFFC marker whose advance layout resolves to the box's width.
      if (isAtomicInline(child, cs.display)) {
        const box = buildTree(child, ctx.rootFontSizePx, ctx.cellMetrics);
        if (box) {
          box.inlineBox = true;
          run.chars.push(OBJECT_REPLACEMENT);
          run.advances.push(1);
          run.boxes.push(box);
        }
        continue;
      }
      // A BLOCK-level element nested inside the run can't be laid out
      // from here — skip its subtree and warn, mirroring dropped text.
      if (!isRunInline(child, cs.display)) {
        warnSkippedRunContent(child);
        continue;
      }
      const childTracking = trackingCells(
        cs.letterSpacing,
        parseFloat(cs.fontSize) || ctx.rootFontSizePx,
        ctx.rootLetterSpacingPx,
      );
      // Horizontal padding on an inline element (`px-1` badges), quantized
      // to cells: the run reserves the cells as 1-cell INLINE_PAD markers
      // glued to the element's edges, and the renderer writes the same
      // cells back as real padding (percent padding is unsupported and
      // reads as 0; vertical inline padding never moves layout, per CSS,
      // and passes through untouched).
      const padLeft = inlinePadCells(cs.paddingLeft, ctx.rootFontSizePx);
      const padRight = inlinePadCells(cs.paddingRight, ctx.rootFontSizePx);
      run.inlineElements.push({
        element: child,
        tracking: childTracking,
        padLeft,
        padRight,
        insets: cs.position === "static" ? null : inlineInsets(cs, ctx.rootFontSizePx),
        color: cs.color,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        textDecorationLine: cs.textDecorationLine,
      });
      const inlineIndex = run.inlineElements.length - 1;
      for (let i = 0; i < padLeft; i++) {
        run.chars.push(INLINE_PAD);
        run.advances.push(1);
      }
      const start = run.chars.length;
      collectRun(child, childTracking, ctx, run);
      // Chars the recursion added belong to this element unless a deeper
      // one claimed them first.
      for (let i = start; i < run.chars.length; i++)
        if (run.inlineIndex[i] === undefined) run.inlineIndex[i] = inlineIndex;
      for (let i = 0; i < padRight; i++) {
        run.chars.push(INLINE_PAD);
        run.advances.push(1);
      }
    }
  }
}

/** Quantize an inline element's horizontal padding to cells. Computed
 * padding is px in every browser; a percent that survives (pre-Typed-OM
 * quirk) is unsupported on inline elements and reads as 0. */
function inlinePadCells(value: string, rootFontSizePx: number): number {
  if (!value || value.endsWith("%")) return 0;
  const px = parseFloat(value);
  return Number.isFinite(px) ? Math.max(0, pxToCells(px, rootFontSizePx)) : 0;
}

/** Authored relative insets of an inline (relative/sticky) element,
 * rewritten to whole cells by the renderer (specs/positioning.md).
 * Percent insets on inline elements are unsupported (`null`), a
 * documented deviation. (Absolute/fixed inline elements never reach
 * here — they leave the run as out-of-flow boxes.) */
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
  const inlineIndex: number[] = [];
  const lineStart = () => {
    let i = chars.length;
    while (i > 0 && chars[i - 1] !== "\n") i--;
    return i;
  };
  const trimLineEnd = () => {
    while (chars.length > lineStart() && chars[chars.length - 1] === " ") {
      chars.pop();
      advances.pop();
      inlineIndex.pop();
    }
  };
  for (let i = 0; i < run.chars.length; i++) {
    const ch = run.chars[i]!;
    if (ch === " ") {
      // Skip spaces at a line start and after another space. Collapsing
      // looks THROUGH inline-padding markers: white-space processing is
      // character-based, so padding between two spaces doesn't stop them
      // collapsing (and a space preceded only by padding still counts as
      // line-start, both per CSS).
      let previous = chars.length - 1;
      while (previous >= 0 && chars[previous] === INLINE_PAD) previous--;
      const atLineStart = previous < 0 || chars[previous] === "\n";
      if (atLineStart || chars[previous] === " ") continue;
    } else if (ch === "\n") {
      trimLineEnd();
    }
    chars.push(ch);
    advances.push(run.advances[i]!);
    inlineIndex.push(run.inlineIndex[i] ?? -1);
  }
  trimLineEnd();
  // Drop leading/trailing blank hard lines (source formatting), like trim().
  while (chars[0] === "\n") {
    chars.shift();
    advances.shift();
    inlineIndex.shift();
  }
  while (chars[chars.length - 1] === "\n") {
    chars.pop();
    advances.pop();
    inlineIndex.pop();
  }
  return { chars, advances, inlineIndex, inlineElements: run.inlineElements, boxes: run.boxes };
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

function warnSkippedRunContent(el: Element): void {
  warnOnce(
    el,
    "A block-level element nested inside a text run can't be laid out and was " +
      "skipped. Give it its own place in the layout instead.",
  );
}

/** Mixed direct text + in-flow block children: the text can't be laid out
 * (no element to position — cell-model deviation). Hide it (via the
 * renderer) and tell the author how to fix their markup, once. */
function flagDroppedText(el: Element, node: LayoutNode): void {
  const hasText = Array.from(el.childNodes).some(
    (child) => child.nodeType === Node.TEXT_NODE && /[^ \t\r\n\f]/.test(child.textContent ?? ""),
  );
  if (!hasText) return;
  node.droppedText = true;
  warnOnce(
    el,
    "Direct text next to block-level children can't be laid out and was hidden. " +
      "Wrap each text segment in its own element (e.g. a <div>).",
  );
}
