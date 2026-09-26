import { paintOrderedChildren, paintsInPositionedStep } from "./borders.ts";
import { isFormattingContextRoot } from "./layout.ts";
import { placePainted } from "./paint-origin.ts";
import type { AreaSide, InlineElement, LayoutNode, PerSide, PositionArea } from "./types.ts";

/**
 * Write each light element's geometry as custom properties in cells,
 * which the companion stylesheet turns into px, change-checked so a
 * relayout of the same result mutates nothing and an open <select>
 * picker stays up (element.ts `#openSelectPicker`).
 */
export function render(root: LayoutNode): void {
  const boxes = new Set<Element>();
  const insets = new Set<Element>();
  walk(root, null, boxes, insets);
  // Where this layout wrote no box, or no inline insets, on an element
  // an earlier one did, that one's writes go: found by their flags.
  clearUnwritten(root.source, BOX_MARKS, boxes, BOX_NAMES);
  clearUnwritten(root.source, "[data-mw-inline-inset]", insets, INSET_NAMES);
}

/** The flags one of which marks every box's element (`positionElement`). */
const BOX_MARKS =
  "[data-mw-laid-out], [data-mw-inline-box], [data-mw-multicol-flow], " +
  "[data-mw-multicol-flow-span], [data-mw-flow], [data-mw-float]";

/** Every flag and variable a box's writes leave on its element — the
 * tracking and the pointer flag aside, an inline element's writes too. */
const BOX_NAMES = (
  "data-mw-top data-mw-top-shown data-mw-laid-out data-mw-inline-box data-mw-multicol-flow " +
  "data-mw-multicol-flow-span data-mw-float data-mw-flow data-mw-area data-mw-vbottom " +
  "data-mw-vmiddle data-mw-nowrap data-mw-multicol data-mw-multicol-balance data-mw-pre " +
  "data-mw-clip data-mw-scroll data-mw-text-align-blocked data-mw-table-hidden " +
  "data-mw-force-hidden data-mw-invisible data-mw-hidden-runs --mw-z --mw-sx --mw-sy --mw-mt " +
  "--mw-mr --mw-mb --mw-ml --mw-va --mw-vb --mw-lh --mw-lhs --mw-colc --mw-colg --mw-x --mw-y " +
  "--mw-w --mw-h --mw-se-x --mw-se-y --mw-gr --mw-gb --mw-pt --mw-pr --mw-pb --mw-pl --mw-bt " +
  "--mw-br --mw-bb --mw-bl --mw-ti --mw-ink --mw-ground"
).split(" ");

/** An inline element's insets' flag and variables. */
const INSET_NAMES = ["data-mw-inline-inset", "--mw-it", "--mw-ir", "--mw-ib", "--mw-il"];

/** `names` cleared from each element under `root` a `selector` flag
 * marks and this layout did not write. */
function clearUnwritten(
  root: Element,
  selector: string,
  written: Set<Element>,
  names: readonly string[],
): void {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (written.has(el)) continue;
    for (const name of names) {
      if (name.startsWith("--")) setVar(el, name, null);
      else el.removeAttribute(name);
    }
  }
}

/** A custom property on an element's or a rule's style, removed when
 * null, written only on change. */
export function setVar(
  target: { readonly style: CSSStyleDeclaration },
  property: string,
  value: string | number | null,
): void {
  const { style } = target;
  const text = value === null ? "" : String(value);
  if (style.getPropertyValue(property) === text) return;
  if (value === null) style.removeProperty(property);
  else style.setProperty(property, text);
}

/** A valued attribute, removed when null, written only on change. */
function setAttr(el: Element, name: string, value: string | null): void {
  if (el.getAttribute(name) === value) return;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/** Boolean attribute toggle, skipped when already in the target state. */
function setFlag(el: Element, name: string, on: boolean): void {
  if (el.hasAttribute(name) === on) return;
  if (on) el.setAttribute(name, "");
  else el.removeAttribute(name);
}

function walk(
  node: LayoutNode,
  parent: LayoutNode | null,
  boxes: Set<Element>,
  insets: Set<Element>,
  ground?: string,
  forced = false,
): void {
  if (node.inlineElements) {
    for (const entry of node.inlineElements) {
      const { element, tracking, padLeft, padRight, sticky } = entry;
      const el = element as HTMLElement;
      setVar(el, "--mw-ls", tracking);
      setFlag(el, "data-mw-pointer-none", !entry.pointerEvents);
      // Quantized horizontal padding (specs/cell-model.md): the companion
      // stylesheet applies these cells as the element's real padding —
      // its typography lock zeroes any authored value, so browser padding
      // always equals the cells the run reserved.
      setVar(el, "--mw-ipl", padLeft > 0 ? padLeft : null);
      setVar(el, "--mw-ipr", padRight > 0 ? padRight : null);
      if (entry.insets || sticky) {
        insets.add(element);
        applyInlineInsets(el, entry.insets ?? stuckInsets(entry));
      }
    }
  }

  if (!parent) markRoot(node);
  else if (!node.anonymous) {
    boxes.add(node.source);
    positionElement(node, parent);
    // A top-layer element's box is the viewport's, so a box
    // position-visibility hides around it leaves it shown (styles.css).
    const escapes = forced && node.topLayerRank !== undefined && node.style.visible;
    setFlag(node.source, "data-mw-top-shown", escapes);
  }
  const forcedBelow = node.forceHidden === true || (forced && node.topLayerRank === undefined);
  // The ground the grid paints under this box: its own fill, else the
  // nearest above, `bg-clear` cutting through to the theme's.
  // A hidden box paints no fill: the ground stays the one above it.
  const own = node.style.visible
    ? (node.style.backgroundColor ?? (node.style.backgroundClear ? undefined : ground))
    : ground;
  if (parent && !node.anonymous) syncEditableColors(node.source as HTMLElement, node, own);
  // A hidden table box (misparented content, <col>) hides its whole
  // subtree browser-side; nothing to recurse into.
  if (node.tableHidden) return;

  for (const child of paintOrderedChildren(node)) {
    // Absolutization would otherwise activate z-index on static block
    // children too (CSS keeps it inert there): the companion reads
    // `--mw-z`, written only where CSS applies it. A run's element is
    // its container, whose own value is already written.
    if (!child.anonymous) {
      const applies = paintsInPositionedStep(child, node) && !child.inlineBox;
      setVar(child.source as HTMLElement, "--mw-z", applies ? child.style.zIndex : null);
    }
    walk(child, node, boxes, insets, own, forcedBelow);
  }
}

/** The elements whose text the browser renders and selects (the
 * companion's `::selection` rule for them, styles.css). */
const EDITABLE = "input, textarea, select, [contenteditable], [contenteditable] *";

/** An editable's ink and ground for its native selection (styles.css),
 * which swaps them as the grid swaps a selected cell's colors. Its
 * inline descendants inherit both, so the theme's ground is written out
 * too, over a filled ancestor's. */
function syncEditableColors(el: HTMLElement, node: LayoutNode, ground: string | undefined): void {
  if (!el.matches(EDITABLE)) return;
  if (node.style.color !== undefined) setVar(el, "--mw-ink", node.style.color);
  setVar(el, "--mw-ground", ground ?? "var(--mw-bg)");
}

/** The host's flags when its own text is on the grid — the root leaf,
 * or a mixed host's anonymous runs (specs/host-leaf.md): the
 * companion's host variants of the leaf typography rules key on them.
 * No geometry — the host is its own box. A new leaf flag in
 * positionElement that shapes native text needs a line here and a host
 * variant in styles.css. */
function markRoot(node: LayoutNode): void {
  const el = node.source as HTMLElement;
  const leaf = node.text.length > 0 || node.children.some((child) => child.anonymous);
  const { whiteSpace, textAlignBlocked, textIndent } = node.style;
  setFlag(el, "data-mw-leaf", leaf);
  setFlag(el, "data-mw-nowrap", leaf && whiteSpace !== "normal");
  setFlag(el, "data-mw-pre", leaf && whiteSpace === "pre");
  setFlag(el, "data-mw-text-align-blocked", leaf && textAlignBlocked);
  setVar(el, "--mw-ti", leaf ? textIndent : null);
}

/**
 * Rewrite an inline element's authored relative insets to whole-cell
 * offsets (specs/positioning.md). The values go into engine-owned custom
 * properties consumed by a measuring-gated companion rule —
 * writing `top` etc. directly would be read back as the authored value on
 * the next measure pass and compound (a feedback loop). Sides the author
 * left `auto` get no var of their own: the companion's reset leaves the
 * declaration invalid at computed-value time and the inset falls back
 * to `auto`.
 */
function applyInlineInsets(el: HTMLElement, insets: PerSide<number | null>): void {
  setFlag(el, "data-mw-inline-inset", true);
  setVar(el, "--mw-it", insets.top);
  setVar(el, "--mw-ir", insets.right);
  setVar(el, "--mw-ib", insets.bottom);
  setVar(el, "--mw-il", insets.left);
}

/** A sticky inline element's shift for the scroll (specs/sticky.md) as
 * its inset properties. */
function stuckInsets({ stickyShift }: InlineElement): PerSide<number | null> {
  return { top: stickyShift?.y ?? 0, right: null, bottom: null, left: stickyShift?.x ?? 0 };
}

/** A box's light element moved from where its parent places it to where
 * it paints: a sticky box by its shift (specs/sticky.md), a fixed one by
 * the scroll and shifts it escapes (specs/positioning.md). A top-layer
 * box's light element is placed on its painted cells: its shift is
 * zero. */
function writeShift(node: LayoutNode, parent: LayoutNode): void {
  const el = node.source as HTMLElement;
  const top = node.topLayerRank !== undefined;
  const { paintOrigin: at, scroll } = parent;
  const x = top ? 0 : node.paintOrigin.x - (at.x - (scroll?.x ?? 0) + node.localRect.x);
  const y = top ? 0 : node.paintOrigin.y - (at.y - (scroll?.y ?? 0) + node.localRect.y);
  setVar(el, "--mw-sx", x === 0 ? null : x);
  setVar(el, "--mw-sy", y === 0 ? null : y);
}

/** A scroll repaint: the offsets `sync` writes, every box placed where
 * they paint it (paint-origin.ts), and the light elements the scroll
 * moves moved with it — a box's shift beside its position, a sticky
 * inline element's as its inset properties. */
export function renderScroll(root: LayoutNode, sync: (root: LayoutNode) => void): void {
  sync(root);
  for (const { node, parent } of placePainted(root)) {
    // A run's element is its container, a box of its own.
    if (!node.anonymous) writeShift(node, parent);
    for (const entry of node.inlineElements ?? []) {
      if (entry.sticky !== undefined) {
        applyInlineInsets(entry.element as HTMLElement, stuckInsets(entry));
      }
    }
  }
}

/** The physical keyword of a side on each axis; `center` and `span-all`
 * are their own. */
const ACROSS: Partial<Record<AreaSide, string>> = {
  start: "left",
  end: "right",
  "span-start": "span-left",
  "span-end": "span-right",
};
const DOWN: Partial<Record<AreaSide, string>> = {
  start: "top",
  end: "bottom",
  "span-start": "span-top",
  "span-end": "span-bottom",
};

/** An area as the physical keywords the browsers serialize, across
 * first. */
function areaKeywords({ x, y }: PositionArea): string {
  return `${ACROSS[x] ?? x} ${DOWN[y] ?? y}`;
}

/** The row of a box's native baseline within it: its last line's, or
 * its last run's last line's; undefined for a box that draws no line
 * of its own, whose baseline is its bottom edge. */
function nativeBaselineRow(node: LayoutNode): number | undefined {
  if (node.text.length > 0) return node.baselineRow;
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i]!;
    if (child.anonymous && child.baselineRow !== undefined) {
      return child.localRect.y + child.baselineRow;
    }
  }
  return undefined;
}

function positionElement(node: LayoutNode, parent: LayoutNode): void {
  const el = node.source as HTMLElement;
  // A top-layer element's box is the viewport's (specs/top-layer.md):
  // the companion places it from the grid's client origin, in the
  // host's cells.
  const top = node.topLayerRank !== undefined;
  const rect = top ? { ...node.localRect, ...node.hostRect } : node.localRect;
  setFlag(el, "data-mw-top", top);
  // An authored `pointer-events: none` the grid-mode opt-in leaves be
  // (styles.css).
  setFlag(el, "data-mw-pointer-none", !node.style.pointerEvents);
  writeShift(node, parent);
  const padding = node.resolvedPadding;
  const { border, textAlignBlocked, overflow, whiteSpace, tracking, lineGap } = node.style;
  // Atomic inline boxes and paragraph-flow multicol children stay IN
  // FLOW (the browser's own line layout / column fragmentation places
  // them); everything else is engine-positioned. Same geometry vars, a
  // different companion rule each (see styles.css).
  const flow = node.multicolFlow;
  const flowSpan = node.multicolFlowSpan;
  setFlag(el, "data-mw-laid-out", !node.inlineBox && !flow && !flowSpan && !node.flow);
  setFlag(el, "data-mw-inline-box", Boolean(node.inlineBox));
  setFlag(el, "data-mw-multicol-flow", Boolean(flow));
  setFlag(el, "data-mw-multicol-flow-span", Boolean(flowSpan));
  // A flow child (specs/cell-model.md "Inline content"): a formatting-
  // context root keeps one natively, a leaf's lines stay open to a
  // sibling float; a float floats natively (specs/float.md).
  const float = node.flow && node.style.float !== "none" ? node.style.float : null;
  setAttr(el, "data-mw-float", float);
  setAttr(
    el,
    "data-mw-flow",
    node.flow && !float ? (isFormattingContextRoot(node) ? "box" : "text") : null,
  );
  const flowMargins = flow ?? flowSpan ?? node.flow;
  setVar(el, "--mw-mt", flowMargins ? (flowMargins.top ?? 0) : null);
  setVar(el, "--mw-mr", flowMargins ? (flowMargins.right ?? 0) : null);
  setVar(el, "--mw-mb", flowMargins ? (flowMargins.bottom ?? 0) : null);
  setVar(el, "--mw-ml", flowMargins ? (flowMargins.left ?? 0) : null);
  // The area an anchored box took (specs/anchor-positioning.md), for a
  // style to follow a flip.
  setAttr(el, "data-mw-area", node.anchorArea ? areaKeywords(node.anchorArea) : null);
  // Bottom-aligned atomic boxes keep their browser alignment (grid-exact,
  // probed); a middle-aligned one takes a whole-row baseline length
  // (specs/cell-model.md "Typography"): rows from its own baseline —
  // its last line's, or its bottom edge where it draws no line — to its
  // line's text row; everything else is pinned top by the companion rule.
  const { verticalAlign } = node.style;
  setFlag(el, "data-mw-vbottom", Boolean(node.inlineBox) && verticalAlign === "end");
  const middle =
    Boolean(node.inlineBox) && verticalAlign === "center" && node.inlineTextRow !== undefined;
  setFlag(el, "data-mw-vmiddle", middle);
  const baseline = middle ? nativeBaselineRow(node) : undefined;
  setVar(el, "--mw-va", middle ? node.inlineTextRow! - (baseline ?? rect.height) : null);
  setVar(el, "--mw-vb", middle && baseline === undefined ? 1 : null);
  // Grid typography (specs/cell-model.md): extra cells per character, rows
  // per wrapped line, and the half-leading cancellation shift.
  setVar(el, "--mw-ls", tracking);
  setVar(el, "--mw-lh", lineGap + 1);
  setVar(el, "--mw-lhs", -lineGap / 2);
  setFlag(el, "data-mw-nowrap", whiteSpace !== "normal");
  // A multicol TEXT LEAF or paragraph-flow container keeps native
  // columns, driven by the engine's used values so the browser
  // fragments on the same lines (specs/multicol.md "Browser
  // agreement"); a spanner-split flow additionally trusts the NATIVE
  // balancer per segment (probed exact). Atomic element-children
  // containers get no flag: their light DOM has nothing in flow.
  // Flow CHILDREN carry a geometry too (their line maps) but must never
  // get native columns themselves — only the container fragments.
  const multicol = flow || flowSpan ? undefined : node.multicolGeometry;
  setFlag(el, "data-mw-multicol", Boolean(multicol));
  setFlag(el, "data-mw-multicol-balance", Boolean(multicol?.nativeBalance));
  setVar(el, "--mw-colc", multicol?.columnCount ?? null);
  setVar(el, "--mw-colg", multicol?.gap ?? null);
  // `white-space: pre` leaves also keep their preserved spaces
  // browser-side (the tree builder kept them in the run) — see styles.css.
  setFlag(el, "data-mw-pre", whiteSpace === "pre");
  setVar(el, "--mw-x", rect.x);
  setVar(el, "--mw-y", rect.y);
  setVar(el, "--mw-w", rect.width);
  setVar(el, "--mw-h", rect.height);
  setFlag(el, "data-mw-clip", overflow.x === "clip" || overflow.y === "clip");
  const range = node.scrollRange;
  setFlag(el, "data-mw-scroll", range !== undefined);
  // The scroll-range spacer's end (styles.css), the first cell for an
  // axis with no range.
  const { width, height } = node.localRect;
  setVar(el, "--mw-se-x", range ? (range.maxX > 0 ? range.maxX + width : 1) : null);
  setVar(el, "--mw-se-y", range ? (range.maxY > 0 ? range.maxY + height : 1) : null);
  // The bars' cells, which --mw-pr/--mw-pb include, for scroll-padding.
  setVar(el, "--mw-gr", range ? (node.scrollGutterCells?.right ?? 0) : null);
  setVar(el, "--mw-gb", range ? (node.scrollGutterCells?.bottom ?? 0) : null);
  // Border and padding cells apart: styles.css sums them as native
  // padding and reads the border cells alone for scroll-padding.
  setVar(el, "--mw-pt", padding.top);
  setVar(el, "--mw-pr", padding.right);
  setVar(el, "--mw-pb", padding.bottom);
  setVar(el, "--mw-pl", padding.left);
  // A box's padding is these cells alone, an inline element's cleared.
  setVar(el, "--mw-ipl", null);
  setVar(el, "--mw-ipr", null);
  setVar(el, "--mw-bt", border.top);
  setVar(el, "--mw-br", border.right);
  setVar(el, "--mw-bb", border.bottom);
  setVar(el, "--mw-bl", border.left);
  // Native text-indent is authored in px; overwrite it in cells so the
  // browser's own line (the selectable, transparent-locked text under
  // the grid) sits under the glyphs the engine painted. Always set —
  // custom properties inherit, so an unset var on an `indent-0` child
  // would resolve to an indented ancestor's value.
  setVar(el, "--mw-ti", node.style.textIndent);
  setFlag(el, "data-mw-text-align-blocked", textAlignBlocked);
  setFlag(el, "data-mw-table-hidden", Boolean(node.tableHidden));
  setFlag(el, "data-mw-force-hidden", Boolean(node.forceHidden));
  setFlag(el, "data-mw-invisible", !node.style.visible);
  // A hidden run has no element of its own: its container hides its
  // text and its laid-out children show through (styles.css).
  setFlag(
    el,
    "data-mw-hidden-runs",
    node.children.some((child) => child.anonymous && child.tableHidden),
  );
}
