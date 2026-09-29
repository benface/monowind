import { baselineRow, isFlowChild, isFormattingContextRoot, markerSpread } from "./layout.ts";
import { placePainted } from "./paint-origin.ts";
import { zIndexApplies } from "./stacking.ts";
import { PSEUDOS } from "./generated.ts";
import type { Pseudo } from "./generated.ts";
import { clipsAxis, isElementBox, softWraps } from "./types.ts";
import type { AreaSide, InlineElement, LayoutNode, PerSide, PositionArea } from "./types.ts";

/**
 * Write each light element's geometry as custom properties in cells,
 * which the companion stylesheet turns into px, change-checked so a
 * relayout of the same result mutates nothing and an open <select>
 * picker stays up (element.ts `#openSelectPicker`).
 */
export function render(root: LayoutNode): void {
  const written: Written = {
    boxes: new Set(),
    insets: new Set(),
    "::before": new Set(),
    "::after": new Set(),
  };
  walk(root, null, written);
  // Where this layout wrote no box, no inline insets, or no
  // pseudo-element, on an element an earlier one did, that one's
  // writes go: found by their flags.
  clearUnwritten(root.source, BOX_MARKS, written.boxes, BOX_NAMES);
  clearUnwritten(root.source, "[data-mw-inline-inset]", written.insets, INSET_NAMES);
  const wrote = written["::before"].size + written["::after"].size > 0;
  if (!wrote && !writtenPseudoElements.has(root.source)) return;
  for (const pseudo of PSEUDOS) {
    const { flag, all } = PSEUDO_NAMES[pseudo];
    clearUnwritten(root.source, `[${flag}]`, written[pseudo], all);
  }
  if (wrote) writtenPseudoElements.add(root.source);
  else writtenPseudoElements.delete(root.source);
}

/** The elements this layout wrote boxes, inline insets and each
 * pseudo-element on. */
type Written = Record<"boxes" | "insets" | Pseudo, Set<Element>>;

/** The roots whose last layout wrote a pseudo-element. */
const writtenPseudoElements = new WeakSet<Element>();

/** Whether a root's last layout wrote a pseudo-element. */
export const wrotePseudoElements = (root: Element): boolean => writtenPseudoElements.has(root);

/** The flags one of which marks every box's element (`positionElement`). */
const BOX_MARKS =
  "[data-mw-laid-out], [data-mw-inline-box], [data-mw-multicol-flow], " +
  "[data-mw-multicol-flow-span], [data-mw-flow], [data-mw-float]";

/** Every flag and variable a box's writes leave on its element — the
 * tracking and the pointer flag aside, an inline element's writes too. */
const BOX_NAMES = (
  "data-mw-top data-mw-laid-out data-mw-inline-box data-mw-multicol-flow " +
  "data-mw-multicol-flow-span data-mw-float data-mw-flow data-mw-area data-mw-vbottom " +
  "data-mw-vmiddle data-mw-nowrap data-mw-multicol data-mw-multicol-balance data-mw-pre " +
  "data-mw-clip data-mw-scroll data-mw-table-hidden data-mw-marker-image " +
  "data-mw-force-hidden data-mw-invisible data-mw-hidden-runs --mw-z --mw-sx --mw-sy --mw-mt " +
  "--mw-mr --mw-mb --mw-ml --mw-va --mw-vb --mw-lh --mw-lhs --mw-colc --mw-colg --mw-x --mw-y " +
  "--mw-w --mw-h --mw-se-x --mw-se-y --mw-gr --mw-gb --mw-spt --mw-spr --mw-spb --mw-spl " +
  "--mw-pt --mw-pr --mw-pb --mw-pl --mw-bt --mw-br --mw-bb --mw-bl --mw-ti --mw-ws --mw-ink " +
  "--mw-ground"
).split(" ");

/** An inline element's insets' flag and variables. */
const INSET_NAMES = ["data-mw-inline-inset", "--mw-it", "--mw-ir", "--mw-ib", "--mw-il"];

/** Each pseudo-element's flag on its element, holding its kind, and its
 * variables there (`--mw-before-x`), which styles.css reads on it: an
 * inline one's, a multi-column flow's, and a box's — each written
 * whole, as its element's descendants inherit them. */
const PSEUDO_NAMES = { "::before": pseudoNames("before"), "::after": pseudoNames("after") };

function pseudoNames(name: string) {
  const vars = (names: string) => names.split(" ").map((each) => `--mw-${name}-${each}`);
  // An inline one's are a flow's first five.
  const flow = vars("ls pl pr ml mr pt pb mt mb");
  const box = vars("position x y w h mt mr mb ml z va contain");
  const flag = `data-mw-${name}`;
  return { flag, flow, box, all: [flag, ...new Set([...flow, ...box])] };
}

/** `names` cleared from each element under `root` a `selector` flag
 * marks and this layout did not write. */
function clearUnwritten(
  root: Element,
  selector: string,
  written: Set<Element>,
  names: readonly string[],
): void {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (!written.has(el)) clearNames(el, names);
  }
}

function clearNames(el: HTMLElement, names: readonly string[]): void {
  for (const name of names) {
    if (name.startsWith("--")) setVar(el, name, null);
    else el.removeAttribute(name);
  }
}

/** A custom property on an element's or a rule's style, removed when
 * null, written only on change: compared with the engine's last write
 * there, no style read back — written where there is none. */
export function setVar(
  target: { readonly style: CSSStyleDeclaration },
  property: string,
  value: string | number | null,
): void {
  const text = value === null ? "" : String(value);
  let last = written.get(target);
  if (!last) written.set(target, (last = new Map()));
  if (last.get(property) === text) return;
  last.set(property, text);
  if (value === null) target.style.removeProperty(property);
  else target.style.setProperty(property, text);
}

/** Each element's or rule's variables as the engine last wrote them. */
const written = new WeakMap<object, Map<string, string>>();

/** What the engine wrote forgotten where a page's mutations may have
 * changed it: a `style` written, or an element taken out, whose style
 * may change while it is. */
export function forgetWrites(records: Iterable<MutationRecord>): void {
  for (const record of records) {
    if (record.type === "attributes") {
      if (record.attributeName === "style") written.delete(record.target);
      continue;
    }
    for (const node of record.removedNodes) {
      if (!(node instanceof Element)) continue;
      written.delete(node);
      if (node.firstElementChild) for (const el of node.querySelectorAll("*")) written.delete(el);
    }
  }
}

/** A valued attribute, removed when null, written only on change. */
function setAttr(el: Element, name: string, value: string | null): void {
  if (el.getAttribute(name) === value) return;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

type WhiteSpace = LayoutNode["style"]["whiteSpace"];

/** Whether a box's native text needs its `white-space` restored
 * (styles.css `data-mw-pre`), the lock's `normal` or `nowrap` rendering
 * the rest. */
const restores = (whiteSpace: WhiteSpace | null): boolean =>
  whiteSpace !== null && whiteSpace !== "normal" && whiteSpace !== "nowrap";

/** A box's `white-space` restored, its value in `--mw-ws`, which its
 * inline elements inherit — on a box `inside` a restored one too, whose
 * rule reaches it. */
function restoreWhiteSpace(el: HTMLElement, whiteSpace: WhiteSpace | null, inside: boolean): void {
  const restored = restores(whiteSpace);
  setFlag(el, "data-mw-pre", restored);
  setVar(el, "--mw-ws", restored || inside ? whiteSpace : null);
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
  written: Written,
  ground?: string,
  inside = false,
): void {
  if (node.inlineElements) {
    for (const entry of node.inlineElements) {
      const { element, pseudo, tracking, padLeft, padRight, sticky } = entry;
      const el = element as HTMLElement;
      if (pseudo) {
        const { name, marginLeft, marginRight, image } = pseudo;
        // An image draws none (styles.css), as a marker's.
        const values = [tracking, padLeft, padRight, marginLeft, marginRight];
        writePseudo(el, name, image ? "image" : "text", values);
        written[name].add(element);
        continue;
      }
      setVar(el, "--mw-ls", tracking);
      setFlag(el, "data-mw-pointer-none", !entry.pointerEvents);
      // Quantized horizontal padding (specs/cell-model.md): the companion
      // stylesheet applies these cells as the element's real padding —
      // its typography lock zeroes any authored value, so browser padding
      // always equals the cells the run reserved.
      setVar(el, "--mw-ipl", padLeft > 0 ? padLeft : null);
      setVar(el, "--mw-ipr", padRight > 0 ? padRight : null);
      if (entry.insets || sticky) {
        written.insets.add(element);
        applyInlineInsets(el, entry.insets ?? stuckInsets(entry));
      }
    }
  }

  if (!parent) markRoot(node);
  else if (node.generated) {
    writePseudoBox(node, parent);
    written[node.generated.pseudo].add(node.source);
  } else if (!node.anonymous) {
    written.boxes.add(node.source);
    positionElement(node, parent, inside);
  }
  // Below a box whose white-space is restored, every box writes its own.
  const flagged = parent ? !node.anonymous : holdsText(node);
  const within = inside || (flagged && restores(node.style.whiteSpace));
  // The ground the grid paints under this box: its own fill, else the
  // nearest above, `bg-clear` cutting through to the theme's.
  // A hidden box paints no fill: the ground stays the one above it.
  const own = node.style.visible
    ? (node.style.backgroundColor ?? (node.style.backgroundClear ? undefined : ground))
    : ground;
  if (parent && isElementBox(node)) {
    syncEditableColors(node.source as HTMLElement, node, own);
  }
  // A hidden table box (misparented content, <col>) hides its whole
  // subtree browser-side; nothing to recurse into.
  if (node.tableHidden) return;

  for (const child of node.children) {
    // A run's element is its container, whose own value is already
    // written.
    if (isElementBox(child)) {
      setVar(child.source as HTMLElement, "--mw-z", appliedZIndex(child, node));
    }
    walk(child, node, written, own, within);
  }
}

/** A box's z-index where CSS applies it, which the companion reads:
 * absolutization would otherwise activate it on static block children
 * too, where CSS keeps it inert. */
const appliedZIndex = (node: LayoutNode, parent: LayoutNode): number | null =>
  zIndexApplies(node, parent) && !node.inlineBox ? node.style.zIndex : null;

/** A pseudo-element's kind in its element's flag and its variables
 * there, another kind's cleared. */
function writePseudo(
  el: HTMLElement,
  pseudo: Pseudo,
  kind: "text" | "image" | "flow" | "box",
  values: readonly (number | string)[],
): void {
  const names = PSEUDO_NAMES[pseudo];
  const was = el.getAttribute(names.flag);
  if (was !== kind) {
    if (was !== null) clearNames(el, names.all);
    el.setAttribute(names.flag, kind);
  }
  const variables = kind === "box" ? names.box : names.flow;
  for (let i = 0; i < values.length; i++) setVar(el, variables[i]!, values[i]!);
}

/** A pseudo-element box on the engine's cells, drawing no text natively
 * (styles.css): absolute where the engine places a box, else in the
 * native line or flow its element's box would take, with its margins —
 * but in a multi-column flow, whose native lines fragment as the grid's
 * do (`data-mw-multicol-flow`). */
function writePseudoBox(node: LayoutNode, parent: LayoutNode): void {
  const el = node.source as HTMLElement;
  const { pseudo } = node.generated!;
  const { multicolFlow: flow, resolvedPadding: padding } = node;
  if (flow) {
    // Its gaps as padding where the native balancer fills the flow.
    const balanced = parent.multicolGeometry?.nativeBalance === true;
    const [top, bottom] = [flow.top ?? 0, flow.bottom ?? 0];
    return writePseudo(el, pseudo, "flow", [
      node.style.tracking,
      padding.left,
      padding.right,
      flow.left ?? 0,
      flow.right ?? 0,
      balanced ? top : 0,
      balanced ? bottom : 0,
      balanced ? 0 : top,
      balanced ? 0 : bottom,
    ]);
  }
  const { localRect: rect, inlineBox, inlineTextRow } = node;
  const { verticalAlign } = node.style;
  const margins = node.multicolFlowSpan ?? node.flow ?? inlineBox;
  // A run's box is its container's natively, where the run lies.
  const run = !margins && parent.anonymous ? parent.localRect : undefined;
  const x = margins ? 0 : rect.x + (run?.x ?? 0);
  const y = inlineBox ? inlineLift(node, parent, 0) : margins ? 0 : rect.y + (run?.y ?? 0);
  // A middle-aligned box's baseline is its bottom margin edge, as it
  // draws no line (`positionElement`).
  const edge = (margins?.top ?? 0) + rect.height + (margins?.bottom ?? 0);
  const align = !inlineBox
    ? "top"
    : verticalAlign === "end"
      ? "bottom"
      : verticalAlign === "center" && inlineTextRow !== undefined
        ? `calc(${inlineTextRow - edge} * var(--mw-ch, 1px) + var(--mw-base, 0px))`
        : "top";
  const root = node.flow && node.style.float === "none" && isFormattingContextRoot(node);
  writePseudo(el, pseudo, "box", [
    margins ? "relative" : "absolute",
    x + shift(node, parent, "x"),
    y + shift(node, parent, "y"),
    rect.width,
    rect.height,
    margins?.top ?? 0,
    margins?.right ?? 0,
    margins?.bottom ?? 0,
    margins?.left ?? 0,
    appliedZIndex(node, parent) ?? "auto",
    align,
    root ? "layout" : "none",
  ]);
}

/** The rows an atomic inline box moves from where its line's leading
 * puts it natively, to hold half its own gap above its first line as a
 * laid-out box's lift does: its line's half gap down from a top edge or
 * up from a bottom one, none on a baseline, which its text holds. */
function inlineLift(node: LayoutNode, parent: LayoutNode, ownGap: number): number {
  const { verticalAlign } = node.style;
  if (verticalAlign === "center" && node.inlineTextRow !== undefined) return 0;
  const lineHalf = parent.style.lineGap / 2;
  return -ownGap / 2 + (verticalAlign === "end" ? -lineHalf : lineHalf);
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

/** Whether the root's own text is on the grid: the root leaf, or a
 * mixed host's anonymous runs. */
const holdsText = (node: LayoutNode): boolean =>
  node.text.length > 0 || node.children.some((child) => child.anonymous);

/** The host's flags when its own text is on the grid — the root leaf,
 * or a mixed host's anonymous runs (specs/host-leaf.md): the
 * companion's host variants of the leaf typography rules key on them.
 * No geometry — the host is its own box. A new leaf flag in
 * positionElement that shapes native text needs a line here and a host
 * variant in styles.css. */
function markRoot(node: LayoutNode): void {
  const el = node.source as HTMLElement;
  const leaf = holdsText(node);
  const { whiteSpace } = node.style;
  setFlag(el, "data-mw-leaf", leaf);
  setFlag(el, "data-mw-nowrap", leaf && !softWraps(whiteSpace));
  restoreWhiteSpace(el, leaf ? whiteSpace : null, false);
  setVar(el, "--mw-ti", leaf ? nativeIndent(node) : null);
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
 * it paints: a sticky box by its shift (specs/sticky.md), a fixed or
 * absolute one by the scroll and shifts it escapes (specs/positioning.md
 * "Paint order"). A top-layer box's light element is placed on its
 * painted cells: its shift is zero. */
function writeShift(node: LayoutNode, parent: LayoutNode): void {
  const el = node.source as HTMLElement;
  const x = shift(node, parent, "x");
  const y = shift(node, parent, "y");
  setVar(el, "--mw-sx", x === 0 ? null : x);
  setVar(el, "--mw-sy", y === 0 ? null : y);
}

const shift = (node: LayoutNode, parent: LayoutNode, axis: "x" | "y"): number =>
  node.topLayerRank === undefined
    ? node.paintOrigin[axis] -
      (parent.paintOrigin[axis] - (parent.scroll?.[axis] ?? 0) + node.localRect[axis])
    : 0;

/** A scroll repaint: the offsets `sync` writes, every box placed where
 * they paint it (paint-origin.ts), and the light elements the scroll
 * moves moved with it — a box's shift beside its position, a sticky
 * inline element's as its inset properties. */
export function renderScroll(root: LayoutNode, sync: (root: LayoutNode) => void): void {
  sync(root);
  for (const { node, parent } of placePainted(root)) {
    // A run's element is its container, a box of its own.
    if (node.generated) writePseudoBox(node, parent);
    else if (!node.anonymous) writeShift(node, parent);
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

/** The indent a box's own first native line takes, in cells: a leaf's,
 * or its first anonymous run's where that holds its first line, an
 * inside marker's cells and their justified spread included. */
function nativeIndent(node: LayoutNode): number {
  const first = node.children.find(isFlowChild);
  const leaf = node.indent !== undefined ? node : first?.anonymous ? first : undefined;
  return leaf ? (leaf.indent ?? 0) + markerSpread(leaf) : 0;
}

/** The row of a box's native baseline within it: its last line's, or
 * its last run's last line's; undefined for a box that draws no line
 * of its own, whose baseline is its bottom edge. */
function nativeBaselineRow(node: LayoutNode): number | undefined {
  if (node.text.length > 0) return baselineRow(node, true);
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i]!;
    const row = child.anonymous ? baselineRow(child, true) : undefined;
    if (row !== undefined) return child.localRect.y + row;
  }
  return undefined;
}

function positionElement(node: LayoutNode, parent: LayoutNode, inside: boolean): void {
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
  const { border, overflow, whiteSpace, tracking, lineGap } = node.style;
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
  const flowMargins = flow ?? flowSpan ?? node.flow ?? node.inlineBox;
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
  // its last line's, or its bottom margin edge where it draws no line —
  // to its line's text row; everything else is pinned top by the
  // companion rule.
  const { verticalAlign } = node.style;
  setFlag(el, "data-mw-vbottom", Boolean(node.inlineBox) && verticalAlign === "end");
  const middle =
    Boolean(node.inlineBox) && verticalAlign === "center" && node.inlineTextRow !== undefined;
  setFlag(el, "data-mw-vmiddle", middle);
  const baseline = middle ? nativeBaselineRow(node) : undefined;
  const margin = node.inlineBox;
  const edge = (margin?.top ?? 0) + (baseline ?? rect.height + (margin?.bottom ?? 0));
  setVar(el, "--mw-va", middle ? node.inlineTextRow! - edge : null);
  setVar(el, "--mw-vb", middle && baseline === undefined ? 1 : null);
  // Grid typography (specs/cell-model.md): extra cells per character, rows
  // per wrapped line, and the half-leading cancellation shift.
  setVar(el, "--mw-ls", tracking);
  setVar(el, "--mw-lh", lineGap + 1);
  setVar(el, "--mw-lhs", node.inlineBox ? inlineLift(node, parent, lineGap) : -lineGap / 2);
  setFlag(el, "data-mw-nowrap", !softWraps(whiteSpace));
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
  restoreWhiteSpace(el, whiteSpace, inside);
  // A run's box is its container's natively, where the run lies.
  const run = !top && parent.anonymous ? parent.localRect : undefined;
  setVar(el, "--mw-x", rect.x + (run?.x ?? 0));
  setVar(el, "--mw-y", rect.y + (run?.y ?? 0));
  setVar(el, "--mw-w", rect.width);
  setVar(el, "--mw-h", rect.height);
  // The clip lock, on a box clipping both axes: a lone clipping axis is
  // an authored `clip`, and a scroller keeps its `hidden` axis.
  setFlag(el, "data-mw-clip", clipsAxis(overflow.x) && clipsAxis(overflow.y));
  const range = node.scrollRange;
  // A scroller's vars, cleared off a box that stops scrolling, none
  // on the rest.
  if (range || el.hasAttribute("data-mw-scroll")) {
    // The scroll-range spacer's end (styles.css), the first cell for an
    // axis with no range.
    const { width, height } = node.localRect;
    setVar(el, "--mw-se-x", range ? (range.maxX > 0 ? range.maxX + width : 1) : null);
    setVar(el, "--mw-se-y", range ? (range.maxY > 0 ? range.maxY + height : 1) : null);
    // The bars' cells, which --mw-pr/--mw-pb include, for scroll-padding,
    // and the authored scroll-padding beside them.
    const { scrollPadding } = node.style;
    setVar(el, "--mw-gr", range ? (node.scrollGutterCells?.right ?? 0) : null);
    setVar(el, "--mw-gb", range ? (node.scrollGutterCells?.bottom ?? 0) : null);
    setVar(el, "--mw-spt", range ? scrollPadding.top : null);
    setVar(el, "--mw-spr", range ? scrollPadding.right : null);
    setVar(el, "--mw-spb", range ? scrollPadding.bottom : null);
    setVar(el, "--mw-spl", range ? scrollPadding.left : null);
  }
  // The scroll spacer's pseudo-element, one its author leaves free
  // (styles.css), none where both are the author's.
  const taken = node.authoredPseudos;
  const spacer = !taken?.includes("::after")
    ? "after"
    : !taken.includes("::before")
      ? "before"
      : "";
  setAttr(el, "data-mw-scroll", range ? spacer : null);
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
  setVar(el, "--mw-ti", nativeIndent(node));
  setFlag(el, "data-mw-table-hidden", Boolean(node.tableHidden));
  setFlag(el, "data-mw-force-hidden", Boolean(node.forceHidden));
  setFlag(el, "data-mw-invisible", !node.style.visible);
  setFlag(el, "data-mw-marker-image", node.style.marker?.image === true);
  // A hidden run has no element of its own: its container hides its
  // text and its laid-out children show through (styles.css).
  setFlag(
    el,
    "data-mw-hidden-runs",
    node.children.some((child) => child.anonymous && child.tableHidden),
  );
}
