import {
  firstLineIndent,
  fixedMargins,
  isFlowChild,
  isGap,
  laysOutAsTextLeaf,
  makeIntrinsicCache,
  resolveLength,
  resolveMargin,
  widthContribution,
} from "./layout.ts";
import { leafRendererFor, renderLeafContent } from "./leaf.ts";
import type { LeafRegistration } from "./leaf.ts";
import { pxToCells } from "./metrics.ts";
import {
  computedDisplay,
  isTransparentColor,
  lineGapRows,
  readAnchorNames,
  readAnchorScope,
  markerOf,
  readCellStyle,
  readDecoration,
  readElementInsets,
  readGlyph,
  readOpacity,
  readOverflow,
  readTextStyle,
  readVisible,
  skipsContents,
  trackingCells,
} from "./style.ts";
import { ownTransitionLists } from "./animate.ts";
import type { TransitionLists } from "./animate.ts";
import { animatedProperties } from "./animation.ts";
import {
  countersOf,
  isQuote,
  LIST_ITEM,
  pageCounterStyles,
  parseChanges,
  parseResets,
  partText,
  readsCounter,
  withBullets,
} from "./counters.ts";
import type { CounterNode, Counters, CounterStyles } from "./counters.ts";
import {
  GeneratedNode,
  GeneratedText,
  generatedElements,
  nameOf,
  PSEUDOS,
  quotePairs,
  quoteWriter,
  readGenerated,
} from "./generated.ts";
import type { Pseudo } from "./generated.ts";
import { bulletGlyph, controlGlyphs, glyphSetFor, glyphSetOf } from "./glyphs.ts";
import { inlineMembersOf, inlineOwners } from "./stacking.ts";
import { casedClusters, readTextCase } from "./text-transform.ts";
import type { TextCase } from "./text-transform.ts";
import {
  clipsAxis,
  CONTROL_READ_FLAG,
  createNode,
  decorationOf,
  defaultCellStyle,
  isToggle,
  NO_DECORATION,
  parentElementOf,
  preservedSpaces,
  zeroInsets,
} from "./types.ts";
import { warnOnce } from "./warn.ts";
import { clusterAdvance, clusterAdvances, graphemes, textCells } from "./width.ts";
import {
  eachObjectMarker,
  hardLineSpans,
  INLINE_PAD,
  lineAdvance,
  OBJECT_REPLACEMENT,
  wrapLineCount,
  WBR_MARKER,
} from "./wrap.ts";
import type {
  CellLength,
  CellMetrics,
  CellStyle,
  ContentPart,
  CharSourceRun,
  InlineElement,
  LayoutNode,
  Marker,
  MarkerStyle,
  TextDecoration,
} from "./types.ts";

/** Per-textarea content width in cells, captured by the host BEFORE
 * the measuring attribute goes on — the engine's width rule is off
 * during measuring, so `textarea.clientWidth` read then would reflect
 * the browser-default width instead of our engine-assigned one (which
 * may itself be constrained by max-width / flex parent). */
export type TextareaWidths = Map<HTMLTextAreaElement, number>;

/**
 * Build a LayoutNode tree from an element subtree (specs/cell-model.md
 * "Inline detection"): an element with no in-flow block below it
 * through inline ones is a text leaf, any other a container whose
 * children recurse, the text beside them in anonymous runs ("Inline
 * content"). The host goes through `buildRoot` (specs/host-leaf.md).
 *
 * `cellMetrics` (measured by the host) is the basis for leading and
 * tracking; absent in headless tests (see readCellStyle).
 */
export function buildTree(
  root: Element,
  rootFontSizePx: number,
  cellMetrics?: CellMetrics,
  textareaWidths?: TextareaWidths,
): LayoutNode | null {
  const context = newContext(root, rootFontSizePx, cellMetrics, textareaWidths);
  const tree = buildNode(root, context);
  if (tree) {
    propagateDecorations(tree, NO_DECORATION);
    attachMarkers(context);
  }
  return tree;
}

/** What every node of a tree is built with (buildTree), and the list
 * items it builds. */
interface BuildContext {
  rootFontSizePx: number;
  cellMetrics: CellMetrics | undefined;
  textareaWidths: TextareaWidths | undefined;
  /** Each checkbox's and radio's own `appearance` (readControls). */
  appearances: ReadonlyMap<Element, string> | undefined;
  items: LayoutNode[];
  /** The elements each pseudo-element may give content. */
  generated: Record<Pseudo, ReadonlySet<Element>>;
  /** What a build reads once: each element's pseudo-elements, their
   * text, and each list item's marker. */
  pseudoElements: Map<Element, PseudoElements>;
  texts: Map<GeneratedNode, string>;
  markers: Map<Element, MarkerStyle | null>;
  /** The page's counter styles, which generated text and markers draw in. */
  counterStyles: CounterStyles;
  /** The counters in scope at each writer of one (specs/lists.md
   * "Numbering"), walked once a build, where one is first read. */
  counters: () => ReadonlyMap<Element | GeneratedNode, Counters>;
  /** Each quote's text, written in the build's tree order. */
  quote: ReturnType<typeof quoteWriter>;
}

function newContext(
  root: Element,
  rootFontSizePx: number,
  cellMetrics: CellMetrics | undefined,
  textareaWidths: TextareaWidths | undefined,
  appearances?: ReadonlyMap<Element, string>,
): BuildContext {
  // Held here, as each run's context copies this one.
  let counters: ReadonlyMap<Element | GeneratedNode, Counters> | undefined;
  const context: BuildContext = {
    rootFontSizePx,
    cellMetrics,
    textareaWidths,
    appearances,
    items: [],
    generated: generatedElements(root),
    pseudoElements: new Map(),
    texts: new Map(),
    markers: new Map(),
    counterStyles: pageCounterStyles(root),
    counters: () => {
      if (!counters) {
        const tree = counterTree(root, context);
        counters = tree ? countersOf(tree) : new Map();
      }
      return counters;
    },
    quote: quoteWriter(),
  };
  return context;
}

/** A child node the builder takes: the DOM's, or a pseudo-element. */
type BuildChild = ChildNode | GeneratedNode;

/** A node a run collects: a child, or a pseudo-element box's text. */
type RunNode = BuildChild | GeneratedText;

/** A child that builds a box of its own, or rides a run as one. */
type BoxOrigin = Element | GeneratedNode;

const isBoxOrigin = (node: RunNode): node is BoxOrigin =>
  node instanceof Element || node instanceof GeneratedNode;

/** A box's origin: its pseudo-element, else its element. */
const originOf = (box: LayoutNode): BoxOrigin => box.generated ?? box.source;

/** A child's box: an element's, or a pseudo-element's. */
function buildChild(node: BoxOrigin, context: BuildContext): LayoutNode | null {
  return node instanceof GeneratedNode
    ? buildGeneratedBox(node, context)
    : buildNode(node, context);
}

/** A pseudo-element's box (specs/generated-content.md "Pseudo-element
 * boxes"), built as a leaf over its generated text. */
function buildGeneratedBox(node: GeneratedNode, context: BuildContext): LayoutNode | null {
  const el = node.parentElement;
  const style = readCellStyle(el, context.rootFontSizePx, context.cellMetrics, { generated: node });
  if (style.display === "none") return null;
  const text = new GeneratedText(node, generatedText(node, context, style.glyphSet));
  const box = buildLeaf(el, style, [], [], context, [text]);
  box.generated = node;
  return box;
}

/** A pseudo-element's text, its parts written once a build: its quotes
 * move the build's depth. */
function generatedText(
  node: GeneratedNode,
  context: BuildContext,
  glyphSet = glyphSetOf(node.cs),
): string {
  let text = context.texts.get(node);
  if (text === undefined) {
    const parts = withQuotes(node.parts, node.cs.quotes, node.parentElement, context);
    text = contentText(node, parts, glyphSet, context);
    context.texts.set(node, text);
  }
  return text;
}

/** A writer's parts with its quotes written, from the build's depth. */
function withQuotes(
  parts: readonly ContentPart[],
  quotes: string,
  element: Element,
  context: BuildContext,
): readonly ContentPart[] {
  if (!parts.some(isQuote)) return parts;
  const pairs = quotePairs(quotes, languageOf(element));
  return parts.map((part) => (isQuote(part) ? context.quote(part, pairs) : part));
}

/** A writer's parts as text, in its glyph set's bullets, their counters
 * the walk's where they read any. */
function contentText(
  source: Element | GeneratedNode,
  parts: readonly ContentPart[],
  glyphSet: string | null,
  context: BuildContext,
): string {
  if (parts.every((part) => typeof part === "string")) return parts.join("");
  const set = glyphSetFor(glyphSet);
  const styles = withBullets(context.counterStyles, (bullet) => bulletGlyph(set, bullet));
  const counters = parts.some(readsCounter) ? context.counters().get(source) : undefined;
  return parts.map((part) => partText(part, counters ?? NO_COUNTERS, styles)).join("");
}

function buildNode(root: Element, context: BuildContext): LayoutNode | null {
  const node = buildElement(root, context);
  if (!node) return null;
  if (node.style.marker) context.items.push(node);
  const { read } = pseudoElementsOf(root, context);
  if (read.length > 0) node.authoredPseudos = read.flatMap((each) => each?.pseudo ?? []);
  return node;
}

function buildElement(root: Element, context: BuildContext): LayoutNode | null {
  const { markers } = context;
  const style = readCellStyle(root, context.rootFontSizePx, context.cellMetrics, { markers });
  if (style.display === "none") return null;
  // A marker's quotes come before its item's contents'.
  const { marker } = style;
  if (marker?.quotes !== undefined) {
    style.marker = { ...marker, parts: withQuotes(marker.parts, marker.quotes, root, context) };
  }
  if (style.skipsContents) return buildLeaf(root, style, [], [], context, []);

  // Registered leaf renderers (specs/leaf-renderers.md) supply their
  // own grid content; children are skipped entirely. The light DOM
  // stays untouched — it keeps the a11y tree and select="text"
  // semantics while the grid shows the rendered content.
  const leaf = leafRendererFor(root.tagName);
  if (leaf) return buildRendererLeaf(root, style, leaf);
  if (isToggle(root)) {
    const { appearance, accentColor } = getComputedStyle(root);
    if ((context.appearances?.get(root) ?? appearance) !== "none") {
      return buildToggleLeaf(root as HTMLInputElement, style, accentColor);
    }
  }

  const childNodes = shownChildNodes(root, context);
  const elementChildren = childNodes.filter(isBoxOrigin);
  const roles = elementChildren.map(childRole);

  // Form controls are always leaves — descending into a <select>'s
  // <option>s would leak that text into the grid.
  // A grid's text is an anonymous item of its own (specs/grid.md).
  if (
    isFormControlTag(root.tagName) ||
    (style.display !== "grid" &&
      !roles.includes("block") &&
      !splitsForBlock(elementChildren, roles, context))
  ) {
    return buildLeaf(root, style, elementChildren, roles, context);
  }
  return createNode(root, style, buildChildren(root, childNodes, context));
}

/** Each list item's marker (specs/lists.md): on the item where it sits
 * outside, on the leaf holding its first line where inside. */
function attachMarkers(context: BuildContext): void {
  for (const item of context.items) {
    const style = item.style.marker!;
    const text = contentText(item.source, style.parts, item.style.glyphSet, context);
    if (!text) continue;
    const advances = clusterAdvances(text, item.style.tracking);
    const marker: Marker = {
      style,
      text,
      advances,
      width: advances.reduce((sum, advance) => sum + advance, 0),
      gaps: Array.from(text).filter(isGap).length,
    };
    if (style.inside) {
      holdInsideMarker(item, marker, context);
    } else {
      item.marker = marker;
      // An item with no in-flow content is its marker's line.
      if (!item.text && laysOutAsTextLeaf(item)) {
        item.intrinsicHeight = Math.max(1, item.intrinsicHeight);
      }
    }
  }
}

const NO_COUNTERS: ReadonlyMap<string, readonly number[]> = new Map();

/** An inside marker on the leaf holding its item's first line: the item
 * itself, its first run, or a run of the marker alone before a leading
 * block (specs/lists.md "Inside"), which it widens by its cells. */
function holdInsideMarker(item: LayoutNode, marker: Marker, context: BuildContext): void {
  let holder = item;
  if (!laysOutAsTextLeaf(item)) {
    const index = item.children.findIndex(isFlowChild);
    const first = item.children[index];
    if (first?.anonymous) {
      holder = first;
    } else {
      // Built after the decorations propagate, it takes its item's.
      const style = {
        ...leafStyleOf(item.source, context),
        textDecoration: item.style.textDecoration,
      };
      holder = createNode(item.source, style, [], "", 0, 0);
      holder.anonymous = true;
      item.children.splice(index < 0 ? item.children.length : index, 0, holder);
    }
  }
  holder.marker = marker;
  const { text, advances, style } = holder;
  const firstLine = lineAdvance(text, 0, hardLineSpans(text)[0]!.end, advances, style.tracking);
  holder.intrinsicWidth = Math.max(
    holder.intrinsicWidth,
    firstLineIndent(holder, undefined) + firstLine,
  );
  holder.intrinsicHeight = Math.max(1, holder.intrinsicHeight);
}

/** The host's elements and pseudo-elements as the counter walk reads
 * them (specs/lists.md "Numbering"): all but a `display: none` one and a
 * skipped box's contents, HTML's list hints under the author's counters. */
export function counterTree(root: Element, context?: BuildContext): CounterNode | null {
  const cs = getComputedStyle(root);
  const display = computedDisplay(root, cs);
  if (display === "none") return null;
  const listItem = display.includes(LIST_ITEM);
  const parts = listItem ? (markerOf(root, cs, display, context?.markers)?.parts ?? []) : [];
  const node = counterNode(root, cs, listItem, parts.some(readsCounter));
  const { resets, sets } = node;
  const { localName } = root;
  if (LISTS.has(localName) && !resets.some(({ name }) => name === LIST_ITEM)) {
    const start = localName === "ol" ? htmlInteger(root.getAttribute("start")) : undefined;
    const reversed = localName === "ol" && root.hasAttribute("reversed");
    const value = reversed ? (start === undefined ? undefined : start + 1) : (start ?? 1) - 1;
    resets.push({ name: LIST_ITEM, value, reversed });
  }
  const value = localName === "li" ? htmlInteger(root.getAttribute("value")) : undefined;
  if (value !== undefined && !sets.has(LIST_ITEM)) sets.set(LIST_ITEM, value);
  if (!skipsContents(cs, display)) {
    // Every pseudo-element read, an empty one's counters counting too.
    for (const child of shownChildNodes(root, context, "read")) {
      const counted =
        child instanceof GeneratedNode
          ? pseudoCounterNode(child)
          : child instanceof Element && counterTree(child, context);
      if (counted) node.children.push(counted);
    }
  }
  return node;
}

/** A node's counter properties. */
function counterNode(
  source: Element | GeneratedNode,
  cs: CSSStyleDeclaration,
  listItem: boolean,
  reads: boolean,
): CounterNode {
  return {
    source,
    resets: parseResets(cs.counterReset),
    increments: parseChanges(cs.counterIncrement, 1, true),
    sets: parseChanges(cs.counterSet, 0, false),
    listItem,
    reads,
    children: [],
  };
}

/** The elements HTML's rendering resets `list-item` on. */
const LISTS = new Set(["ol", "ul", "menu"]);

/** HTML's rules for parsing integers: a sign and digits after white
 * space, anything after ignored. */
function htmlInteger(text: string | null): number | undefined {
  const match = text?.match(/^[\t\n\f\r ]*([+-]?\d+)/);
  return match ? Number(match[1]) : undefined;
}

/** An element's child nodes as the page renders them: a `details`
 * without `open` shows its first `summary` alone (HTML's rendering
 * rules, specs/visibility.md "Skipped contents"). */
function shownChildNodes(
  el: Element,
  context?: BuildContext,
  pseudos: keyof PseudoElements = "shown",
): BuildChild[] {
  let nodes: BuildChild[] = Array.from(el.childNodes);
  if (el.tagName === "DETAILS" && !el.hasAttribute("open")) {
    const summary = Array.from(el.children).find((child) => child.tagName === "SUMMARY");
    nodes = summary ? [summary] : [];
  }
  // Its pseudo-elements as its first and last children
  // (specs/generated-content.md).
  if (!context) return nodes;
  const [before, after] = pseudoElementsOf(el, context)[pseudos];
  if (before) nodes.unshift(before);
  if (after) nodes.push(after);
  return nodes;
}

/** An element's `::before` and `::after` with content — each one a rule
 * may give it — and those it shows, an empty inline one drawing
 * nothing. */
interface PseudoElements {
  read: readonly (GeneratedNode | null)[];
  shown: readonly (GeneratedNode | null)[];
}

const NO_PSEUDOS: PseudoElements = { read: [], shown: [] };

/** An element's pseudo-elements, read once a build. */
function pseudoElementsOf(el: Element, context: BuildContext): PseudoElements {
  const { generated } = context;
  if (!generated["::before"].has(el) && !generated["::after"].has(el)) return NO_PSEUDOS;
  let pseudos = context.pseudoElements.get(el);
  if (pseudos) return pseudos;
  if (NO_PSEUDO_ELEMENTS.has(el.tagName)) return NO_PSEUDOS;
  const read = PSEUDOS.map((pseudo) =>
    generated[pseudo].has(el) ? readGenerated(el, pseudo) : null,
  );
  pseudos = { read, shown: read.map((node) => (node && !emptyInline(node) ? node : null)) };
  context.pseudoElements.set(el, pseudos);
  return pseudos;
}

/** A pseudo-element as the counter walk reads it; none where it builds
 * no box. */
function pseudoCounterNode(node: GeneratedNode): CounterNode | null {
  const { display } = node;
  return display === "none"
    ? null
    : counterNode(node, node.cs, display.includes(LIST_ITEM), node.parts.some(readsCounter));
}

/** An inline pseudo-element that takes no cell — an empty `content`'s, as
 * every `before:` utility sets but `content-[…]`, with no horizontal
 * padding or margin — and no image to lock. */
const emptyInline = (node: GeneratedNode): boolean =>
  !node.image &&
  node.parts.every((part) => part === "") &&
  childRole(node) === "inline" &&
  !isAtomicInline(node.display) &&
  SPACING.every((side) => !(parseFloat(node.cs.getPropertyValue(side)) > 0));

const SPACING = ["padding-left", "padding-right", "margin-left", "margin-right"];

/** Form controls and replaced elements, whose pseudo-elements the grid
 * leaves to the browser (specs/generated-content.md "Where"). */
const NO_PSEUDO_ELEMENTS = new Set([
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "IMG",
  "VIDEO",
  "AUDIO",
  "IFRAME",
  "CANVAS",
  "EMBED",
  "OBJECT",
]);

/** A container's children in document order (specs/cell-model.md
 * "Inline content"): each block-level element a node, and each maximal
 * run of inline content between them — text, inline elements, atomic
 * boxes, any out-of-flow element among them — an anonymous leaf in
 * `runStyle`, the container's own text style unless given (the host's,
 * specs/host-leaf.md), over exactly the run's nodes, which are its DOM
 * (selection.ts `runNodes`). A stretch of nothing but whitespace and
 * out-of-flow elements is no run: those elements are the container's
 * own positioned children. */
function buildChildren(
  container: Element,
  nodes: BuildChild[],
  context: BuildContext,
  runStyle?: CellStyle,
): LayoutNode[] {
  const children: LayoutNode[] = [];
  const build = (origin: BoxOrigin): void => {
    const node = buildChild(origin, context);
    if (node) children.push(fadedBy(node, splitOpacity(origin, container)));
  };
  let style = runStyle;
  let run: BuildChild[] = [];
  let roles: ChildRole[] = [];
  let inline = false;
  const flush = (): void => {
    const elements = run.filter(isBoxOrigin);
    if (!inline) {
      for (const el of elements) build(el);
    } else {
      style ??= leafStyleOf(container, context);
      // The indent is the first formatted line's: a first run's alone.
      const own = children.some(isFlowChild) ? { ...style, textIndent: 0 } : style;
      const leaf = buildLeaf(container, own, elements, roles, context, run);
      leaf.anonymous = true;
      children.push(leaf);
    }
    run = [];
    roles = [];
    inline = false;
  };
  // Walked by index, a split splicing the inline's children in where
  // it stood: shifting each node off the front would cost the whole
  // list on every step.
  const queue = [...nodes];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!;
    if (isBoxOrigin(node)) {
      const role = childRole(node);
      if (role === "none") continue;
      if (role === "block") {
        flush();
        build(node);
        continue;
      }
      // An inline element around a block: CSS splits the inline box
      // there, and taking its children in its place splits it here —
      // the block reaches this loop, and the inline content each side
      // of it falls into the runs around it.
      if (role === "inline" && node instanceof Element && hidesBlock(node, context)) {
        queue.splice(index, 1, ...shownChildNodes(node, context));
        index--;
        continue;
      }
      roles.push(role);
      inline ||= role === "inline";
    } else if (node.nodeType !== Node.TEXT_NODE) {
      continue;
    } else {
      inline ||= /[^ \t\r\n\f]/.test(node.textContent ?? "");
    }
    run.push(node);
  }
  flush();
  return children;
}

/** The host's tree (specs/host-leaf.md) over its child nodes but the
 * metrics probe: its own inline content as the root leaf, else — a
 * block-level child, or no inline content — a container over them, its
 * text beside its children as anonymous runs. Either root takes the
 * host's text properties, which key its native locks (render.ts
 * `markRoot`), on no box, with no tracking or line gap (the host's
 * letter-spacing and line-height are the cell), and pointer events
 * whatever the host's value, as its top-level elements read them
 * (element.ts). */
export function buildRoot(
  host: Element,
  rootFontSizePx: number,
  cellMetrics?: CellMetrics,
  textareaWidths?: TextareaWidths,
  appearances?: ReadonlyMap<Element, string>,
): LayoutNode {
  const context = newContext(host, rootFontSizePx, cellMetrics, textareaWidths, appearances);
  const nodes = Array.from(host.childNodes).filter(
    (node) => !(node instanceof Element && node.hasAttribute("data-mw-probe")),
  );
  const elementChildren = nodes.filter((node): node is Element => node instanceof Element);
  const roles = elementChildren.map(childRole);
  const style = { ...leafStyleOf(host, context), tracking: 0, lineGap: 0, pointerEvents: true };
  const isLeaf =
    !roles.includes("block") &&
    !splitsForBlock(elementChildren, roles, context) &&
    (hasDirectText(host) || roles.includes("inline"));
  const tree = isLeaf
    ? buildLeaf(host, style, elementChildren, roles, context, nodes)
    : createNode(host, style, buildChildren(host, nodes, context, style));
  propagateDecorations(tree, NO_DECORATION);
  attachMarkers(context);
  return tree;
}

/** Each box's and inline element's decoration, its own and those its
 * in-flow ancestors propagate (css-text-decor-3 §2), an inline element a
 * block split among them; an out-of-flow box, a float and an atomic
 * inline box take none. */
function propagateDecorations(node: LayoutNode, propagated: TextDecoration): void {
  const { style } = node;
  style.textDecoration = withPropagated(style.textDecoration, propagated);
  const entries = node.inlineElements ?? [];
  for (const entry of entries) {
    const above = entry.parent >= 0 ? entries[entry.parent]!.textDecoration : style.textDecoration;
    entry.textDecoration = withPropagated(entry.textDecoration, above);
  }
  // Through the inline elements a block splits, from `at` out.
  const through = (at: Element | null): TextDecoration =>
    !at || at === node.source
      ? style.textDecoration
      : withPropagated(readDecoration(getComputedStyle(at)), through(at.parentElement));
  for (const child of node.children) {
    if (!isFlowChild(child)) propagateDecorations(child, NO_DECORATION);
    else if (child.anonymous) propagateDecorations(child, style.textDecoration);
    else propagateDecorations(child, through(parentElementOf(child)));
  }
}

/** A decoration with those propagated to it: their lines together,
 * drawn as the innermost box draws its own (specs/cell-model.md
 * "Typography"). */
function withPropagated(own: TextDecoration, propagated: TextDecoration): TextDecoration {
  if (propagated === NO_DECORATION || own === propagated) return own;
  if (own === NO_DECORATION) return propagated;
  const line = [...new Set(`${propagated.line} ${own.line}`.split(" "))].join(" ");
  return decorationOf({ ...own, line });
}

/** A leaf's style from an element's text and inherited paint
 * properties, on no box of its own (padding, border, margin, and size
 * stay the element's): the root leaf's and an anonymous run's. */
function leafStyleOf(el: Element, { rootFontSizePx, cellMetrics }: BuildContext): CellStyle {
  const cs = getComputedStyle(el);
  const fontSizePx = parseFloat(cs.fontSize) || rootFontSizePx;
  const style: CellStyle = {
    ...defaultCellStyle(),
    ...readTextStyle(el, cs, rootFontSizePx),
    lineGap: lineGapRows(cs.lineHeight, fontSizePx),
    tracking: trackingCells(cs.letterSpacing, fontSizePx, cellMetrics?.letterSpacing ?? 0),
    color: cs.color,
    glyph: readGlyph(cs),
    visible: readVisible(cs, el),
    pointerEvents: cs.pointerEvents !== "none",
  };
  // Truncation needs the clip; any other overflow stays the root's.
  const { x } = readOverflow(cs);
  if (clipsAxis(x)) style.overflow = { ...style.overflow, x };
  return style;
}

/** A leaf over `nodes` (the element's child nodes by default): in-flow
 * inline content forms the text run (atomic inline boxes ride it as
 * U+FFFC markers); out-of-flow children become layout nodes for the
 * positioning pass. */
function buildLeaf(
  root: Element,
  style: CellStyle,
  elementChildren: BoxOrigin[],
  roles: ChildRole[],
  context: BuildContext,
  nodes?: RunNode[],
): LayoutNode {
  const tag = root.tagName;
  const formControl = isFormControlTag(tag);
  const run = extractLeafRun(
    root,
    style.tracking,
    {
      ...context,
      preserve: style.whiteSpace === "pre" || preservedSpaces(style.whiteSpace) !== undefined,
      breaks: style.whiteSpace === "pre-line",
      tabSize: style.tabSize,
      textCase: style.textCase,
    },
    nodes,
  );
  const text = run.chars.join("");
  // The run's per-cluster arrays expand to code units, like `text`: a
  // cluster's advance sits on its first unit and its inline index on
  // every unit (specs/wide-characters.md).
  const { advances, charInline } = expandClusters(run);
  // Intrinsic advances for the box markers are the boxes' own width
  // contributions and margins — a sized box counts its width, not its
  // content; layout overwrites them with the laid-out margin boxes per
  // pass.
  if (run.boxes.length > 0) {
    const cache = makeIntrinsicCache();
    eachObjectMarker(text, (charIndex, boxIndex) => {
      const box = run.boxes[boxIndex]!;
      const margins = fixedMargins(resolveMargin(box.style.margin, 0), "x");
      advances[charIndex] = Math.max(0, widthContribution(box, "max", cache) + margins);
    });
  }
  // Form controls with no explicit width would otherwise be 0 cells
  // wide (their leaf is empty; the value renders natively). Intrinsic
  // widths mirror the native ones: an input's (`inputWidth`), textarea's
  // cols, and a select's option labels — the longest by default, the
  // SELECTED one under `field-sizing: content`, like the browser.
  let intrinsicWidth = longestLineAdvance(text, advances, style.tracking, style.textIndent);
  if (formControl && intrinsicWidth === 0) {
    // Number(): happy-dom (tests) returns `size` and `cols` as strings.
    if (tag === "INPUT") intrinsicWidth = inputWidth(root as HTMLInputElement, style, context);
    else if (tag === "TEXTAREA") intrinsicWidth = Number((root as HTMLTextAreaElement).cols) || 20;
    else {
      const select = root as HTMLSelectElement;
      // .label ?? .textContent: happy-dom (tests) lacks option.label.
      const labelOf = (option: HTMLOptionElement | undefined) =>
        option?.label || option?.textContent || "";
      const labels =
        getComputedStyle(root).getPropertyValue("field-sizing") === "content"
          ? [labelOf(select.selectedOptions[0])]
          : Array.from(select.options, labelOf);
      intrinsicWidth = Math.max(1, ...labels.map((label) => textCells(label.trim())));
    }
  }
  // Form controls always reserve at least one content row (native
  // shows a caret-height field even empty). CSS `min-height` can't
  // do it — it floors the outer box, which the border already
  // exceeds.
  const contentHeight = text.length > 0 ? countHardLines(text) : 0;
  let intrinsicHeight: number;
  if (tag === "TEXTAREA") {
    const textarea = root as HTMLTextAreaElement;
    const value = textarea.value ?? "";
    // The value wrapped at its width snapshot (TextareaWidths): pure
    // and monotonic, so the box grows and shrinks with its width.
    // Without a snapshot, its hard lines, the host laying out again at
    // the width it gives.
    const contentCells = context.textareaWidths?.get(textarea);
    // Unlike `<br>` (whose trailing break is dropped, per CSS),
    // a textarea SHOWS the empty line after a trailing `\n` — that
    // extra visible row is where the caret sits after Enter.
    const trailingLine = value.endsWith("\n") ? 1 : 0;
    const wrappedLines =
      contentCells !== undefined && contentCells > 0
        ? wrapLineCount(value, contentCells, {
            advances: clusterAdvances(value),
            preserve: "hang",
          }) + trailingLine
        : value === ""
          ? 0
          : value.split(/\r\n?|\n/).length;
    const rowsFloor =
      getComputedStyle(root).getPropertyValue("field-sizing") === "content"
        ? 1
        : Number(textarea.rows) || 2;
    const lines = Math.max(rowsFloor, wrappedLines);
    // Leading: N lines occupy N + (N − 1) × gap rows, same as any
    // laid-out leaf (specs/cell-model.md "Line height on the grid").
    intrinsicHeight = lines + Math.max(0, lines - 1) * style.lineGap;
  } else if (formControl && !isToggle(root)) {
    intrinsicHeight = Math.max(1, contentHeight);
  } else {
    intrinsicHeight = contentHeight;
  }
  // `children` in DOCUMENT order: paint-order ties (same z-index)
  // resolve as CSS would — later DOM wins — and the atomic inline
  // boxes come out in U+FFFC marker order (inlineBoxesOf). Direct
  // boxes interleave with out-of-flow siblings by construction; a
  // box nested in an inline ancestor is sorted into place.
  // What the loop below places, which is not always the root's own
  // children: an anonymous leaf takes the run's elements, and a split
  // inline puts its children among them.
  // An out-of-flow box the run met below one the loop places never
  // reaches that loop, so it joins the nested boxes and sorts into
  // document order with them.
  const placed = new Set<BoxOrigin>(elementChildren);
  const directBoxes = new Map<BoxOrigin, LayoutNode>();
  const nestedBoxes: LayoutNode[] = [];
  for (const box of [...run.boxes, ...run.positioned]) {
    if (placed.has(originOf(box))) directBoxes.set(originOf(box), box);
    else nestedBoxes.push(box);
  }
  const children: LayoutNode[] = [];
  for (let i = 0; i < elementChildren.length; i++) {
    const origin = elementChildren[i]!;
    const box = directBoxes.get(origin);
    if (box) children.push(box);
    else if (roles[i] === "out-of-flow") {
      const child = buildChild(origin, context);
      if (child) children.push(fadedBy(child, splitOpacity(origin, root)));
    }
  }
  if (nestedBoxes.length > 0) {
    children.push(...nestedBoxes);
    children.sort((a, b) => compareOrigins(originOf(a), originOf(b)));
  }
  const node = createNode(root, style, children, text, intrinsicWidth, intrinsicHeight);
  if (advances.some((a) => a !== 1) || run.boxes.length > 0) node.advances = advances;
  if (run.inlineElements.length > 0) {
    node.inlineElements = run.inlineElements;
    node.charInline = charInline;
    const members = inlineMembersOf(run.inlineElements, -1);
    if (members.length > 0) {
      node.inlineMembers = members;
      node.inlineOwners = inlineOwners(run.inlineElements);
    }
  }
  const charSource = charSourceRuns(run);
  if (charSource.length > 0) node.charSource = charSource;
  // Each spot's character as a code unit of the text, the spots in run
  // order.
  const units = new Map<BoxOrigin, number>();
  let index = 0;
  let unit = 0;
  for (const [origin, at] of run.spots) {
    while (index < at) unit += run.chars[index++]!.length;
    units.set(origin, unit);
  }
  for (const child of children) {
    const at = units.get(originOf(child));
    if (at !== undefined) child.runSpot = runSpotOf(child, at);
  }
  return node;
}

/** Two boxes' document order: an element's place before it, a
 * pseudo-element's at its element's edge, a `::before` ahead of a first
 * child. */
function compareOrigins(a: BoxOrigin, b: BoxOrigin): number {
  if (a instanceof Element && b instanceof Element) {
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }
  const place = (origin: BoxOrigin) => {
    const range = new Range();
    if (origin instanceof GeneratedNode) range.setStart(origin.parentElement, origin.offset);
    else range.setStartBefore(origin);
    return range;
  };
  const rank = (origin: BoxOrigin) =>
    origin instanceof GeneratedNode ? (origin.pseudo === "::before" ? -1 : 1) : 0;
  return place(a).compareBoundaryPoints(Range.START_TO_START, place(b)) || rank(a) - rank(b);
}

/** Where an out-of-flow child sits in its leaf's run: before `char`,
 * and, where an axis lacks insets to place it, whether it was
 * inline-level — its display read with its position held static
 * (styles.css `data-mw-static-read`, a pseudo-element's under its
 * name). */
function runSpotOf(child: LayoutNode, char: number): NonNullable<LayoutNode["runSpot"]> {
  const el = child.source;
  const { top, right, bottom, left } = child.style.insets;
  if ((left !== null || right !== null) && (top !== null || bottom !== null)) {
    return { char, inline: false };
  }
  const { generated } = child;
  const flag = generated
    ? `data-mw-${nameOf(generated.pseudo)}-static-read`
    : "data-mw-static-read";
  el.setAttribute(flag, "");
  try {
    const display = generated ? generated.display : computedDisplay(el, getComputedStyle(el));
    return { char, inline: display.startsWith("inline") };
  } finally {
    el.removeAttribute(flag);
  }
}

/** A registered leaf renderer's node (specs/leaf-renderers.md): the
 * renderer's lines become the leaf's preformatted text (white-space
 * styling does not apply — the lines ARE the content), and its paint
 * runs ride the existing inline-run machinery as paint-only entries
 * with neutral geometry, so the painters need no new path. */
function buildRendererLeaf(
  root: Element,
  style: ReturnType<typeof readCellStyle>,
  leaf: LeafRegistration,
): LayoutNode {
  const content = renderLeafContent(leaf, root);
  const lines = content?.lines ?? [];
  const text = lines.join("\n");
  style.whiteSpace = "pre";
  // Replaced-element sizing (like <img>): auto width means intrinsic,
  // not stretch — and it must live HERE, not in companion CSS, because
  // Gecko's computed styles never surface intrinsic keywords (only the
  // class scan would see a `w-max`, and a stylesheet rule has neither).
  style.width ??= { kind: "max-content" };
  // Cluster widths plus tracking, applied uniformly so the art
  // stretches coherently (columns stay aligned across rows, like
  // letter-spacing on a pre).
  const advances = clusterAdvances(text, style.tracking);
  const intrinsicWidth = longestLineAdvance(text, advances, style.tracking, style.textIndent);
  const node = createNode(root, style, [], text, intrinsicWidth, lines.length);
  if (advances.some((a) => a !== 1)) node.advances = advances;
  const runs = content?.runs ?? [];
  if (runs.length > 0 && text.length > 0) {
    // Line start offsets into the joined text (newlines included).
    const lineStart: number[] = [0];
    for (const line of lines) lineStart.push(lineStart[lineStart.length - 1]! + line.length + 1);
    const charInline = Array.from({ length: text.length }, () => -1);
    node.inlineElements = runs.map((run) => ({
      element: root,
      tracking: 0,
      padLeft: 0,
      padRight: 0,
      insets: null,
      anchorNames: [],
      // What a run leaves unset is the leaf's, as a span inherits it.
      color: run.paint.color ?? style.color,
      backgroundColor: run.paint.backgroundColor,
      glyph: {
        ...style.glyph,
        "font-weight": run.paint.fontWeight ?? style.glyph["font-weight"],
        "font-style": run.paint.fontStyle ?? style.glyph["font-style"],
      },
      textDecoration:
        run.paint.textDecorationLine === undefined
          ? style.textDecoration
          : decorationOf({ ...NO_DECORATION, line: run.paint.textDecorationLine }),
      visible: node.style.visible,
      pointerEvents: node.style.pointerEvents,
      opacity: 1,
      parent: -1,
      positioned: false,
      zIndex: null,
      context: false,
    }));
    runs.forEach((run, index) => {
      const line = lines[run.line];
      if (line === undefined) return;
      const from = Math.max(0, run.start);
      const to = Math.min(line.length, run.end);
      for (let col = from; col < to; col++) charInline[lineStart[run.line]! + col] = index;
    });
    node.charInline = charInline;
  }
  return node;
}

/** Each checkbox's and radio's own appearance and transitions, read in
 * one batch under the flag that lifts their locks: before a layout's
 * masks and first geometry read (specs/checkboxes.md "The light DOM"). */
export function readControls(root: Element): {
  appearances: Map<Element, string>;
  transitions: Map<Element, TransitionLists>;
} {
  const toggles = root.querySelectorAll('input[type="checkbox"], input[type="radio"]');
  const appearances = new Map<Element, string>();
  const transitions = new Map<Element, TransitionLists>();
  for (const el of toggles) el.setAttribute(CONTROL_READ_FLAG, "");
  for (const el of toggles) {
    const cs = getComputedStyle(el);
    appearances.set(el, cs.appearance);
    transitions.set(el, ownTransitionLists(cs));
  }
  for (const el of toggles) el.removeAttribute(CONTROL_READ_FLAG);
  return { appearances, transitions };
}

/** A checkbox or radio drawn as its widget: its state's glyphs,
 * padded to its type's widest so a flip never reflows the line, in its
 * accent where checked, enabled and unfocused, without the chrome no
 * engine draws around a widget (specs/checkboxes.md). A radio group
 * none of which is checked is `:indeterminate`, its radios drawn
 * unchecked. */
function buildToggleLeaf(
  input: HTMLInputElement,
  style: ReturnType<typeof readCellStyle>,
  accentColor: string,
): LayoutNode {
  const glyphs = controlGlyphs(glyphSetFor(style.glyphSet), input.type as "checkbox" | "radio");
  const shown = (input.indeterminate && glyphs.mixed) || (input.checked ? glyphs.on : glyphs.off);
  const cells = Math.max(...Object.values(glyphs).map((glyph) => textCells(glyph)));
  const text = shown + " ".repeat(cells - textCells(shown));
  // The focus invert is any control's: its ink and ground stay.
  const focused = input.matches(":focus-visible");
  if (!focused) style.backgroundColor = undefined;
  if (
    !focused &&
    shown !== glyphs.off &&
    !input.matches(":disabled") &&
    accentColor &&
    accentColor !== "auto"
  ) {
    style.color = accentColor;
  }
  style.whiteSpace = "pre";
  style.textAlign = "start";
  style.width ??= { kind: "max-content" };
  style.border = zeroInsets();
  style.padding = zeroInsets();
  style.backgroundImage = [];
  const advances = clusterAdvances(text, style.tracking);
  const intrinsicWidth = longestLineAdvance(text, advances, style.tracking, style.textIndent);
  const node = createNode(input, style, [], text, intrinsicWidth, 1);
  if (advances.some((a) => a !== 1)) node.advances = advances;
  return node;
}

/** True for content that flows WITH the surrounding text (computed
 * `inline` or `contents`). */
function isRunInline(display: string): boolean {
  return display === "inline" || display === "contents";
}

/** Atomic inline-level boxes (`inline-flex`/`inline-block`/`inline-grid`)
 * ride the line as single unbreakable units with their own internal
 * layout (specs/cell-model.md). */
function isAtomicInline(display: string): boolean {
  return display.startsWith("inline") && display !== "inline";
}

/** Classify a direct child: skipped, out-of-flow box, text-run content
 * (plain inline AND atomic inline boxes), or in-flow block (which forces
 * container mode). */
type ChildRole = "none" | "out-of-flow" | "inline" | "block";

/** A block hiding under a run-inline element, which CSS lays out by
 * splitting the inline box around it (CSS 2.1 block-in-inline): the
 * engine splits by flattening that element into its parent's children,
 * so the block becomes a node of its own and the inline content each
 * side of it an anonymous run. An atomic inline box is its own
 * formatting context and keeps its blocks; an inline element with no
 * element children — nearly all of them — answers before reading a
 * style. */
function hidesBlock(el: Element, context: BuildContext): boolean {
  const blockPseudo = pseudoElementsOf(el, context).shown.some(
    (node) => node !== null && childRole(node) === "block",
  );
  if (el.children.length === 0 && !blockPseudo) return false;
  if (!isRunInline(computedDisplay(el, getComputedStyle(el)))) return false;
  if (blockPseudo) return true;
  for (const child of el.children) {
    const role = childRole(child);
    if (role === "block") return true;
    if (role === "inline" && hidesBlock(child, context)) return true;
  }
  return false;
}

/** Whether an element's children hold a block below an inline one,
 * which makes their parent a container rather than a leaf. */
function splitsForBlock(children: BoxOrigin[], roles: ChildRole[], context: BuildContext): boolean {
  return children.some(
    (child, index) =>
      roles[index] === "inline" && child instanceof Element && hidesBlock(child, context),
  );
}

function childRole(node: BoxOrigin): ChildRole {
  const generated = node instanceof GeneratedNode;
  const cs = generated ? node.cs : getComputedStyle(node);
  const display = generated ? node.display : computedDisplay(node, cs);
  const { position } = cs;
  if (display === "none") return "none";
  if (position === "absolute" || position === "fixed") return "out-of-flow";
  // A float is block-level whatever its display (specs/float.md): it
  // leaves the text run, which re-wraps around it as anonymous runs.
  if (isFloated(cs.float)) return "block";
  // Registered leaf renderers are always block participants — an
  // unstyled custom element computes to `inline`, which would fold
  // its semantic text into the parent's run instead of rendering.
  if (!generated && leafRendererFor(node.tagName)) return "block";
  if (isRunInline(display) || isAtomicInline(display)) return "inline";
  return "block";
}

interface LeafRun {
  chars: string[];
  /** Cells each character occupies: `1 + tracking` of its innermost element. */
  advances: number[];
  /** Per character: its source, a Text node and its offset or a
   * pseudo-element (`null`/-1 for `<br>` newlines and markers).
   * Compacted into `charSource` runs. */
  sourceNode: (Text | GeneratedNode | null)[];
  sourceOffset: number[];
  /** Per character: index into `inlineElements` (-1 = direct leaf text). */
  inlineIndex: number[];
  inlineElements: NonNullable<LayoutNode["inlineElements"]>;
  /** Atomic inline boxes, in run order — each corresponds to one U+FFFC
   * marker in `chars` (layout resolves the marker's advance to the box's
   * laid-out width). */
  boxes: LayoutNode[];
  /** Out-of-flow elements met inside the run, at any depth: they take
   * no character, and the leaf hangs them off itself for the
   * positioning pass the way it does its own. */
  positioned: LayoutNode[];
  /** Each out-of-flow element met, direct ones included: the index of
   * the character it sits before. */
  spots: Map<BoxOrigin, number>;
}

interface RunContext extends BuildContext {
  /** Leaf-level `white-space: pre`, `pre-wrap` or `break-spaces`: keep
   * the source's spaces and newlines (tabs expand to `tabSize` stops from
   * each hard line's start) instead of collapsing. Applies to the whole
   * run — a `white-space` override on an inline descendant is not honored
   * (specs/cell-model.md). */
  preserve: boolean;
  /** `white-space: pre-line`: a source newline breaks, the white space
   * around it collapsing away as around a `<br>`. */
  breaks: boolean;
  tabSize: number;
  /** The case of the element whose text is collected. */
  textCase: TextCase;
}

/**
 * Walk a leaf's childNodes and produce its text run — with `<br>` emitted as
 * `\n` so the wrap calculation counts the line break the browser will honor
 * — plus per-character advances and the inline elements the renderer must
 * write grid typography (and rewritten relative insets) onto.
 *
 * White space CSS collapses (wrap.ts `COLLAPSIBLE`) folds to single
 * spaces, source newlines included — save under `pre-line`, whose
 * newlines break hard as `<br>` does — and is stripped around a hard
 * break (the browser strips it at line edges too). A leaf that keeps
 * its spaces (`pre`, `pre-wrap`, `break-spaces`) skips all of that:
 * spaces and newlines survive as authored and tabs expand to tab stops
 * (see RunContext).
 */
function extractLeafRun(
  el: Element,
  tracking: number,
  ctx: RunContext,
  nodes?: RunNode[],
): LeafRun {
  const run: LeafRun = {
    chars: [],
    advances: [],
    sourceNode: [],
    sourceOffset: [],
    inlineIndex: [],
    inlineElements: [],
    boxes: [],
    positioned: [],
    spots: new Map(),
  };
  if (nodes) collectRunNodes(el, nodes, tracking, ctx, run);
  else collectRun(el, tracking, ctx, run);
  if (ctx.preserve) {
    // A final newline gets no line box of its own — the wrap layer's
    // dropFinalBreakSpan rule (the HTML parser already ate the one right
    // after the opening tag).
    return run;
  }
  return normalizeRun(run);
}

/** An anonymous run's nodes, those an inline element split around a
 * block left in it (specs/cell-model.md "Inline content") under an
 * entry of that element's, so they keep its style. */
function collectRunNodes(
  container: Element,
  nodes: RunNode[],
  tracking: number,
  ctx: RunContext,
  run: LeafRun,
): void {
  for (let i = 0; i < nodes.length;) {
    const owner = nodes[i]!.parentElement;
    let end = i + 1;
    while (end < nodes.length && nodes[end]!.parentElement === owner) end++;
    const group = nodes.slice(i, end);
    if (!owner || owner === container) {
      collectNodes(group, tracking, ctx, run);
    } else {
      const cs = getComputedStyle(owner);
      const entry = inlineEntry(owner, cs, 0, 0, ctx, -1);
      entry.opacity *= splitOpacity(owner, container);
      entry.context ||= entry.opacity < 1;
      collectOwned(run, entry, (index) =>
        collectNodes(group, entry.tracking, casedContext(ctx, cs), run, entry.opacity, index),
      );
    }
    i = end;
  }
}

/** An inline element's entry, and the characters it collects, told
 * the entry's index: those a deeper element has not claimed are the
 * entry's. */
function collectOwned(
  run: LeafRun,
  entry: LeafRun["inlineElements"][number],
  collect: (index: number) => void,
): void {
  const inlineIndex = run.inlineElements.push(entry) - 1;
  const start = run.chars.length;
  collect(inlineIndex);
  for (let i = start; i < run.chars.length; i++) {
    if (run.inlineIndex[i] === undefined) run.inlineIndex[i] = inlineIndex;
  }
}

/** The opacity of the inline elements a block split left between a
 * box and its container (specs/cell-model.md "Inline content"),
 * multiplied; 1 for the container's own child. */
function splitOpacity(origin: BoxOrigin, container: Element): number {
  let opacity = 1;
  for (let at = origin.parentElement; at && at !== container; at = at.parentElement) {
    opacity *= readOpacity(getComputedStyle(at).opacity);
  }
  return opacity;
}

/** A box inside inline elements carrying `opacity`, theirs multiplied
 * (LayoutNode `inlineOpacity`). */
function fadedBy(node: LayoutNode, opacity: number): LayoutNode {
  if (opacity < 1) node.inlineOpacity = opacity;
  return node;
}

/** An inline element's entry in its run, from its computed style, under
 * the entry at `parent`; a `pseudo`-element's static and unanchored,
 * from its computed style alone. */
function inlineEntry(
  element: Element,
  cs: CSSStyleDeclaration,
  padLeft: number,
  padRight: number,
  ctx: RunContext,
  parent: number,
  pseudo?: InlineElement["pseudo"],
): InlineElement {
  const { backgroundColor } = cs;
  const position = pseudo ? "static" : cs.position;
  const anchorNames = pseudo ? [] : readAnchorNames(element, cs);
  const positioned = position === "relative" || position === "sticky";
  const zIndex =
    positioned && cs.zIndex !== "auto" && cs.zIndex !== "" ? Number(cs.zIndex) || 0 : null;
  const opacity = readOpacity(cs.opacity);
  const { letterSpacing } = cs;
  const rootLetterSpacing = ctx.cellMetrics?.letterSpacing ?? 0;
  return {
    element,
    pseudo,
    // The font size scales only a letter spacing past the root's.
    tracking:
      letterSpacing === "normal" && rootLetterSpacing >= 0
        ? 0
        : trackingCells(
            letterSpacing,
            parseFloat(cs.fontSize) || ctx.rootFontSizePx,
            rootLetterSpacing,
          ),
    padLeft,
    padRight,
    ...(position === "relative" && {
      insetLengths: readElementInsets(element, cs, ctx.rootFontSizePx),
    }),
    insets: null,
    ...(position === "sticky" && { sticky: readElementInsets(element, cs, ctx.rootFontSizePx) }),
    anchorNames,
    ...(anchorNames.length > 0 && { anchorScope: readAnchorScope(element, cs) }),
    color: cs.color,
    backgroundColor: isTransparentColor(backgroundColor) ? undefined : backgroundColor,
    glyph: readGlyph(cs),
    textDecoration: readDecoration(cs),
    visible: readVisible(cs, pseudo ? undefined : element),
    pointerEvents: cs.pointerEvents !== "none",
    opacity,
    parent,
    positioned,
    zIndex,
    // By the properties its entry holds (specs/positioning.md deviation 6).
    context:
      position === "sticky" ||
      zIndex !== null ||
      opacity < 1 ||
      (!pseudo && animatedProperties(element).has("opacity")),
  };
}

/** `opacity` is the product of the inline elements' the nodes sit in,
 * `parent` the innermost's entry. */
function collectRun(
  el: Element,
  tracking: number,
  ctx: RunContext,
  run: LeafRun,
  opacity = 1,
  parent = -1,
): void {
  // Form controls render their value / caret / selection natively —
  // leave the leaf empty so the grid doesn't double-render, and skip
  // descending into their internals (e.g. <select>'s <option>s).
  if (isFormControlTag(el.tagName)) return;
  collectNodes(shownChildNodes(el, ctx), tracking, ctx, run, opacity, parent);
}

function collectNodes(
  nodes: RunNode[],
  tracking: number,
  ctx: RunContext,
  run: LeafRun,
  opacity = 1,
  parent = -1,
): void {
  for (const node of nodes) {
    // A pseudo-element's nodes have no node type: DOM nodes first.
    const type = (node as Node).nodeType;
    if (type === Node.TEXT_NODE) {
      pushText((node as Text).data, node as Text, tracking, ctx, run);
    } else if (type === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (child.tagName === "BR" || child.tagName === "WBR") {
        pushChar(run, child.tagName === "BR" ? "\n" : WBR_MARKER, 0, null, -1);
        continue;
      }
      // Reads happen during the measure pass, so authored values are visible.
      const cs = getComputedStyle(child);
      const display = computedDisplay(child, cs);
      const { position } = cs;
      // A hidden span's text must not render.
      if (display === "none") continue;
      // Out-of-flow content leaves the run but not the tree: it takes
      // no character, and the leaf keeps it for the positioning pass
      // (a popover inside an inline element is one, and so is every
      // positioner a custom element wraps).
      if (position === "absolute" || position === "fixed") {
        pushBox(child, false, ctx, run, opacity);
        continue;
      }
      // An atomic inline box rides the run as ONE unbreakable unit: a
      // U+FFFC marker whose advance layout resolves to the box's width.
      if (isAtomicInline(display)) {
        pushBox(child, true, ctx, run, opacity);
        continue;
      }
      // A BLOCK-level element nested inside the run can't be laid out
      // from here — skip its subtree and warn.
      if (!isRunInline(display)) {
        warnSkippedRunContent(child);
        continue;
      }
      // Horizontal padding on an inline element (`px-1` badges), quantized
      // to cells: the run reserves the cells as 1-cell INLINE_PAD markers
      // glued to the element's edges, and the renderer writes the same
      // cells back as real padding (percent padding is unsupported and
      // reads as 0; vertical inline padding never moves layout, per CSS,
      // and passes through untouched).
      const padLeft = inlinePadCells(cs.paddingLeft, ctx.rootFontSizePx);
      const padRight = inlinePadCells(cs.paddingRight, ctx.rootFontSizePx);
      warnInlineBorder(child, cs);
      const entry = inlineEntry(child, cs, padLeft, padRight, ctx, parent);
      // Pad cells belong to the element too (its bg must fill them).
      collectOwned(run, entry, (index) => {
        pushPads(run, padLeft);
        collectRun(
          child,
          entry.tracking,
          casedContext(ctx, cs),
          run,
          opacity * entry.opacity,
          index,
        );
        pushPads(run, padRight);
      });
    } else if (node instanceof GeneratedText) {
      pushText(node.text, node.source, tracking, ctx, run);
    } else if (node instanceof GeneratedNode) {
      collectGenerated(node, ctx, run, opacity, parent);
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

/** A text's characters into the run: a text node's at their offsets, a
 * pseudo-element's at its element's edge (specs/generated-content.md
 * "Paint, hit, selection and copy"), their white space kept or
 * collapsed and their case transformed as the run says. */
function pushText(
  text: string,
  source: Text | GeneratedNode,
  tracking: number,
  ctx: RunContext,
  run: LeafRun,
): void {
  const clusters = graphemes(text);
  const shown =
    ctx.textCase === "none"
      ? clusters
      : casedClusters(text, clusters, ctx.textCase, languageOf(source.parentElement), run.chars);
  let offset = 0;
  if (ctx.preserve) {
    // Kept white space: spaces and newlines survive as authored;
    // tabs expand to the next `tabSize` stop (spaces are pushed
    // untracked — tab stops are grid columns, not glyphs).
    for (let i = 0; i < clusters.length; i++) {
      const ch = clusters[i]!;
      const start = offset;
      offset += ch.length;
      if (ch === "\r\n" || ch === "\r" || ch === "\n") {
        // CRLF is one cluster: the LF carries the break.
        pushChar(run, "\n", 0, source, start + ch.length - 1);
      } else if (ch === "\t") {
        const target = (Math.floor(runColumn(run) / ctx.tabSize) + 1) * ctx.tabSize;
        for (let cells = runColumn(run); cells < target; cells++) {
          pushChar(run, " ", 1, source, start);
        }
      } else {
        pushShown(run, shown[i]!, ch, tracking, source, start);
      }
    }
  } else {
    // Collapsible white space folds to one space that keeps the
    // first collapsed character's offset.
    let inSpace = false;
    for (let i = 0; i < clusters.length; i++) {
      const ch = clusters[i]!;
      const newline = ch === "\r" || ch === "\n" || ch === "\r\n";
      const collapsible = newline || ch === " " || ch === "\t" || ch === "\f";
      if (ctx.breaks && newline) pushChar(run, "\n", 0, source, offset + ch.length - 1);
      else if (!collapsible) pushShown(run, shown[i]!, ch, tracking, source, offset);
      else if (!inSpace) pushChar(run, " ", 1 + tracking, source, offset);
      inSpace = collapsible;
      offset += ch.length;
    }
  }
}

/** Cells since the run's current hard line began — the tab-stop basis. */
function runColumn(run: LeafRun): number {
  let cells = 0;
  for (let i = run.chars.length - 1; i >= 0 && run.chars[i] !== "\n"; i--) {
    cells += run.advances[i]!;
  }
  return cells;
}

/** A pseudo-element in its element's run (specs/generated-content.md):
 * its box where it has one — out of flow, or an atomic inline box —
 * else its text under an entry of its own, its padding and margins
 * quantized to cells, the margins' cells its element's. */
function collectGenerated(
  node: GeneratedNode,
  ctx: RunContext,
  run: LeafRun,
  opacity: number,
  parent: number,
): void {
  const role = childRole(node);
  if (role === "none") return;
  if (role === "block") {
    warnSkippedRunContent(node.parentElement);
    return;
  }
  if (role === "out-of-flow" || isAtomicInline(node.display)) {
    pushBox(node, role !== "out-of-flow", ctx, run, opacity);
    return;
  }
  const { cs } = node;
  const cells = (value: string) => inlinePadCells(value, ctx.rootFontSizePx);
  const padLeft = cells(cs.paddingLeft);
  const padRight = cells(cs.paddingRight);
  const marginLeft = cells(cs.marginLeft);
  const marginRight = cells(cs.marginRight);
  pushPads(run, marginLeft);
  const pseudo = { name: node.pseudo, marginLeft, marginRight, image: node.image };
  const entry = inlineEntry(node.parentElement, cs, padLeft, padRight, ctx, parent, pseudo);
  collectOwned(run, entry, () => {
    pushPads(run, padLeft);
    const text = generatedText(node, ctx);
    pushText(text, node, entry.tracking, casedContext(ctx, cs), run);
    pushPads(run, padRight);
  });
  pushPads(run, marginRight);
}

/** A box beside the run's text: out of flow at its spot, or an atomic
 * inline box on its U+FFFC marker. */
function pushBox(
  origin: BoxOrigin,
  atomic: boolean,
  ctx: RunContext,
  run: LeafRun,
  opacity: number,
): void {
  if (!atomic) run.spots.set(origin, run.chars.length);
  const box = buildChild(origin, ctx);
  if (!box) return;
  fadedBy(box, opacity);
  if (!atomic) {
    run.positioned.push(box);
    return;
  }
  box.inlineBox = zeroInsets();
  pushChar(run, OBJECT_REPLACEMENT, 1, null, -1);
  run.boxes.push(box);
}

/** `count` inline-padding cells. */
function pushPads(run: LeafRun, count: number): void {
  for (let i = 0; i < count; i++) pushChar(run, INLINE_PAD, 1, null, -1);
}

/** Collapse consecutive spaces (also across inline-element boundaries), trim
 * spaces at hard-line edges, and drop leading/trailing blank lines — keeping
 * chars and advances in lockstep. */
function normalizeRun(run: LeafRun): LeafRun {
  const chars: string[] = [];
  const advances: number[] = [];
  const sourceNode: (Text | GeneratedNode | null)[] = [];
  const sourceOffset: number[] = [];
  const inlineIndex: number[] = [];
  // Each kept character's index in the run, where the spots map from.
  const kept: number[] = [];
  const lineStart = () => {
    let i = chars.length;
    while (i > 0 && chars[i - 1] !== "\n") i--;
    return i;
  };
  // A line's end loses its spaces, a `<wbr>` after them kept.
  const trimLineEnd = () => {
    const start = lineStart();
    let end = chars.length;
    while (end > start && chars[end - 1] === WBR_MARKER) end--;
    let from = end;
    while (from > start && chars[from - 1] === " ") from--;
    if (from === end) return;
    for (const list of [chars, advances, sourceNode, sourceOffset, inlineIndex, kept]) {
      list.splice(from, end - from);
    }
  };
  for (let i = 0; i < run.chars.length; i++) {
    const ch = run.chars[i]!;
    if (ch === " ") {
      // Skip spaces at a line start and after another space. Collapsing
      // looks THROUGH inline-padding and `<wbr>` markers: white-space
      // processing is character-based, so padding between two spaces
      // doesn't stop them collapsing (and a space preceded only by
      // padding still counts as line-start, both per CSS).
      let previous = chars.length - 1;
      while (previous >= 0 && (chars[previous] === INLINE_PAD || chars[previous] === WBR_MARKER)) {
        previous--;
      }
      const atLineStart = previous < 0 || chars[previous] === "\n";
      if (atLineStart || chars[previous] === " ") continue;
    } else if (ch === "\n") {
      trimLineEnd();
    }
    chars.push(ch);
    advances.push(run.advances[i]!);
    sourceNode.push(run.sourceNode[i] ?? null);
    sourceOffset.push(run.sourceOffset[i] ?? -1);
    inlineIndex.push(run.inlineIndex[i] ?? -1);
    kept.push(i);
  }
  trimLineEnd();
  // The spots come in run order.
  const spots = new Map<BoxOrigin, number>();
  let index = 0;
  for (const [element, at] of run.spots) {
    while (index < kept.length && kept[index]! < at) index++;
    spots.set(element, index);
  }
  // Edge `\n`s stay: every leading <br> creates a line box and all but
  // the final trailing one do (probed, all engines) — the wrap layer
  // drops exactly that last one (dropFinalBreakSpan).
  return { ...run, chars, advances, sourceNode, sourceOffset, inlineIndex, spots };
}

function pushChar(
  run: LeafRun,
  ch: string,
  advance: number,
  source: Text | GeneratedNode | null,
  offset: number,
) {
  run.chars.push(ch);
  run.advances.push(advance);
  run.sourceNode.push(source);
  run.sourceOffset.push(offset);
}

/** `cluster` as its text transform shows it (`shown`), each cluster of
 * a lengthened one (`ß` as `SS`) at the source's offset, as a tab's
 * spaces are. */
function pushShown(
  run: LeafRun,
  shown: string,
  cluster: string,
  tracking: number,
  source: Text | GeneratedNode | null,
  offset: number,
): void {
  if (shown.length === cluster.length) {
    pushChar(run, shown, clusterAdvance(shown, tracking), source, offset);
  } else {
    for (const ch of graphemes(shown)) {
      pushChar(run, ch, clusterAdvance(ch, tracking), source, offset);
    }
  }
}

/** `ctx` under an inline element's own `text-transform`. */
function casedContext(ctx: RunContext, cs: CSSStyleDeclaration): RunContext {
  const textCase = readTextCase(cs.textTransform);
  return textCase === ctx.textCase ? ctx : { ...ctx, textCase };
}

/** An element's content language, its nearest `lang`. */
function languageOf(element: Element | null): string {
  return element?.closest("[lang]")?.getAttribute("lang") ?? "";
}

/** The run's per-cluster advances and inline indices, expanded to one
 * entry per code unit of the joined text: a cluster's advance on its
 * first unit and 0 on the rest, its inline index on every unit. */
function expandClusters(run: LeafRun): { advances: number[]; charInline: number[] } {
  const advances: number[] = [];
  const charInline: number[] = [];
  for (let i = 0; i < run.chars.length; i++) {
    const inline = run.inlineIndex[i] ?? -1;
    advances.push(run.advances[i]!);
    charInline.push(inline);
    for (let unit = 1; unit < run.chars[i]!.length; unit++) {
      advances.push(0);
      charInline.push(inline);
    }
  }
  return { advances, charInline };
}

/** Compact the per-character source map into runs (`LayoutNode.charSource`):
 * a run grows while the next character continues the same Text node at
 * the next offset, or stands at the same pseudo-element edge. */
function charSourceRuns(run: LeafRun): CharSourceRun[] {
  const runs: CharSourceRun[] = [];
  let index = 0;
  for (let i = 0; i < run.chars.length; i++) {
    const ch = run.chars[i]!;
    const source = run.sourceNode[i];
    const last = runs.at(-1);
    const follows = last !== undefined && last.index + last.length === index;
    if (source instanceof GeneratedNode) {
      // A pseudo-element's characters stand at one point, its edge.
      const { parentElement: node, pseudo } = source;
      if (follows && last.node === node && last.pseudo === pseudo) last.length += ch.length;
      else runs.push({ index, length: ch.length, node, offset: source.offset, pseudo });
    } else if (source) {
      const offset = run.sourceOffset[i]!;
      if (follows && last.node === source && last.offset + last.length === offset) {
        last.length += ch.length;
      } else runs.push({ index, length: ch.length, node: source, offset });
    }
    index += ch.length;
  }
  return runs;
}

/** A leaf's widest hard line, its first past a fixed `indent` (a
 * percentage counting none, intrinsically). */
function longestLineAdvance(
  text: string,
  advances: number[],
  tracking: number,
  indent: CellLength = 0,
): number {
  let max = 0;
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      const first = lineStart === 0 ? resolveLength(indent, undefined) : 0;
      max = Math.max(max, first + lineAdvance(text, lineStart, i, advances, tracking));
      lineStart = i + 1;
    }
  }
  return max;
}

function countHardLines(text: string): number {
  return hardLineSpans(text).length;
}

/** The inline elements whose border was checked, each once. */
const borderChecked = new WeakSet<Element>();

/** Warns once about an inline element's border, which draws nothing. */
function warnInlineBorder(el: Element, cs: CSSStyleDeclaration): void {
  if (borderChecked.has(el)) return;
  borderChecked.add(el);
  const widths = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth];
  if (!widths.some((width) => parseFloat(width) > 0)) return;
  warnOnce(
    el,
    "A border on an inline element is ignored — the grid draws borders around boxes. " +
      "Give it a box of its own (inline-block, or block) instead.",
  );
}

function warnSkippedRunContent(el: Element): void {
  warnOnce(
    el,
    "A block-level element nested inside a text run can't be laid out and was " +
      "skipped. Give it its own place in the layout instead.",
  );
}

/** The input types a browser draws as a button, its value the label. */
const LABELED_INPUTS = new Set(["submit", "reset", "button"]);

/** An input's intrinsic width in cells: a field's `size` (20 by
 * default), a button's label — its value, else the browser's own
 * ("Submit" in Chromium and WebKit, "Submit Query" in Firefox), read
 * off its native box where nothing sizes it — and none for a checkbox
 * or radio under `appearance: none`, as in the engines. */
function inputWidth(
  input: HTMLInputElement,
  style: CellStyle,
  { cellMetrics: metrics }: BuildContext,
): number {
  if (isToggle(input)) return 0;
  if (!LABELED_INPUTS.has(input.type)) return Number(input.size) || 20;
  if (input.value) return textCells(input.value);
  if (!metrics || style.width !== undefined) return 0;
  const cs = getComputedStyle(input);
  const chrome = [cs.paddingLeft, cs.paddingRight, cs.borderLeftWidth, cs.borderRightWidth];
  const label = chrome.reduce(
    (width, px) => width - (parseFloat(px) || 0),
    input.getBoundingClientRect().width,
  );
  return Math.max(0, Math.ceil(label / (metrics.advance ?? metrics.width) - 0.05));
}

/** True if `el` has any direct text child that isn't just whitespace. */
function hasDirectText(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (child) => child.nodeType === Node.TEXT_NODE && /[^ \t\r\n\f]/.test(child.textContent ?? ""),
  );
}

/** A computed `float` that takes the element out of the text run
 * (specs/float.md); `inline-start`/`inline-end` are the logical
 * spellings a browser may report. */
function isFloated(value: string): boolean {
  return value !== "none" && value !== "";
}

/** True for tags whose value/caret/selection are handled by the browser
 * natively — the tree builder treats them as empty leaves. */
function isFormControlTag(tag: string): boolean {
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}
