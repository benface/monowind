/// <reference types="vite/client" />
import { hasSynthesizedTransitions, resolvePendingTransitions } from "./animate.ts";
import { compositeColors, parseColor, serializeColor } from "./color.ts";
import type { Rgba } from "./color.ts";
import {
  EFFECTS,
  animationPath,
  nodeIndex,
  readingAnimations,
  runningUnder,
  transitionSampling,
} from "./animation.ts";
import type { AnimationPath } from "./animation.ts";
import { holdVisible, isTransparentColor, readPaintStyle } from "./style.ts";
import { onGlyphRegistryChange } from "./glyphs.ts";
import { leafRendererFor, onLeafRegistryChange } from "./leaf.ts";
import { rendersAttribute } from "./observed.ts";
import {
  arrowIsNative,
  BUTTON_INPUTS,
  directionOf,
  extentOf,
  focusableRects,
  nextFocus,
} from "./focus.ts";
import type { Direction } from "./focus.ts";
import type { Remembered } from "./positioning.ts";
import {
  cellAtPoint,
  chainOf,
  hitRect,
  hitStack,
  isInert,
  nearestCells,
  pointKey,
  scrollStep,
  stackAt,
} from "./pointer.ts";
import type { PointerHit } from "./pointer.ts";
import {
  charIndexAtCell,
  clipBounds,
  renderPlainText,
  scrollbarGeometry,
  thumbSpan,
} from "./plain-text.ts";
import {
  charVisible,
  classifySelection,
  comparePoints,
  isTextLeaf,
  leafExtent,
  leafShadowRoots,
  positionOf,
  selectedRanges,
  selectionRangeThrough,
  serializeSelection,
  textPositionAt,
  wordAt,
} from "./selection.ts";
import type { BoundaryPoints } from "./selection.ts";
import { GlyphBoxes, SHADES } from "./glyph-box.ts";
import shadowCss from "./shadow.css?inline";
import { hardLineSpans, INLINE_PAD } from "./wrap.ts";
import { gridOffsetAt, paintedCell, paintGrid, syncLayers } from "./paint.ts";
import { getRootFontSizePx, measureCellMetrics, sameMetrics } from "./metrics.ts";
import { edges, layoutRoot } from "./layout.ts";
import { render, renderScroll, setVar } from "./render.ts";
import { namedAnchors } from "./positioning.ts";
import { TopLayer, isTopLayer } from "./top-layer.ts";
import { buildRoot } from "./tree.ts";
import type { TextareaWidths } from "./tree.ts";
import { warnOnce, warnSubject } from "./warn.ts";
import type { CellMetrics, LayoutNode, Rect } from "./types.ts";

/** Each shade's copies drawn from a literal of its glyph, so Chromium
 * shares one computed style among them (architecture/performance.md
 * "Shades drawn once"). */
const SHADE_RULES = [...SHADES]
  .map((shade) => {
    const selector = `.grid span[data-shade="${shade}"]`;
    return `${selector}::before, ${selector}::after { content: "${shade}"; }`;
  })
  .join("");

const SHADOW_TEMPLATE = `
<style>${shadowCss}${SHADE_RULES}</style>
<div id="viewport">
  <pre id="grid" class="grid" aria-hidden="true"></pre>
  <div id="layers"></div>
  <slot></slot>
  <i id="color-probe" hidden style="color: var(--mw-fg, canvastext); background-color: var(--mw-bg, canvas); border-top-color: canvas"></i>
</div>
`;

/** The host's keyword attributes and their values, the default first —
 * reflected onto the attribute when it is absent or unrecognized, so
 * every stylesheet keys on an explicit value. `focus="arrows"` adds
 * arrow-key navigation to Tab's (specs/focus-navigation.md). */
const HOST_KEYWORDS = { select: ["grid", "text"], focus: ["tab", "arrows"] } as const;

/** Set on the host while an element selection made by a semantic
 * gesture is live (specs/semantic-selection.md): the shadow stylesheet
 * lifts the grid-mode user-select lock under it. */
const SEMANTIC_SELECTION = "data-mw-semantic-selection";

/** Set on the host while a selection is live in its light DOM, or a
 * selection gesture that may reach it is under way: the companion's
 * transparent `::selection` lock holds under it (styles.css). */
const SELECTION = "data-mw-selection";

/** The light elements that paint their own selection, which the lock
 * exempts (styles.css), an editable's subtree with it. */
export const OWN_HIGHLIGHT =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

interface Point {
  node: Node;
  offset: number;
}

/** A selectable unit — a word's or paragraph's DOM range. */
interface SelectionUnit {
  start: Point;
  end: Point;
}

/** An engine-routed selection gesture: a text-mode drag extends by
 * character, a double- or triple-click by word or paragraph. */
type GestureUnit = "character" | "word" | "paragraph";

/** An engine-driven grid drag: its anchor as a flat text offset of the
 * grid it started in (a layer's, at its origin, or the main one). */
interface GridDrag {
  anchor: number;
  grid: HTMLElement;
  x: number;
  y: number;
}

interface Gesture {
  unit: GestureUnit;
  anchor: SelectionUnit;
  /** The unit last extended to; the same one again writes nothing. */
  extent?: SelectionUnit;
}

/** ARIA's composite widgets, by role: a container whose items are the
 * widgets and its focus indication, its own cells the grid's
 * (specs/cell-model.md). */
const COMPOSITE = [
  "[role='grid']",
  "[role='listbox']",
  "[role='menu']",
  "[role='menubar']",
  "[role='radiogroup']",
  "[role='tablist']",
  "[role='tree']",
  "[role='treegrid']",
].join(", ");

/** The light elements that keep pointer events in grid mode
 * (specs/cell-model.md "Pointer states"): the natively interactive, a
 * focus target other than a COMPOSITE container, and the ARIA widgets.
 * Any other light target got the event by a browser quirk (Firefox
 * hit-tests a multicol spanner's anonymous wrapper as its container
 * despite pointer-events: none) and is handled as a grid event at the
 * same coordinates. */
const INTERACTIVE = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  `[tabindex]:not([tabindex='-1'], ${COMPOSITE})`,
  "[role='button']",
  "[role^='menuitem']",
  "[role='option']",
  "[role='tab']",
  "[role='treeitem']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='slider']",
  "[role='link']",
  "[role='combobox']",
].join(", ");

/** The marks the companion keys the two lists' rules on (styles.css):
 * grid mode's pointer opt-in and text cursor, and the focus invert's
 * exclusion. A forced toggle writes only a change. */
export function markInteractivity(el: Element): void {
  el.toggleAttribute("data-mw-interactive", el.matches(INTERACTIVE));
  el.toggleAttribute("data-mw-composite", el.matches(COMPOSITE));
}

/** The element painted behind one: its parent, or past a shadow root
 * the host holding it. */
const behind = (el: Element): Element | null =>
  el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);

/** Whether a client point lies in an element's own border box. */
function inBox(el: Element, x: number, y: number): boolean {
  const box = el.getBoundingClientRect();
  return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
}

/** The events a covered element must not take (see #onCoveredEvent):
 * the press, whose default moves the focus, and the activations. A
 * context menu is left alone — canceling it shows none at all, and
 * its items are the browser's, not the page's. */
const COVERED_EVENTS = ["mousedown", "click", "dblclick", "auxclick"] as const;

/** Whether the grid shows `el` where the cell's own element is
 * `innermost`: that element, one containing it, or one it contains
 * that has no box of its own — an inline element's cells are its
 * block's, and native hover climbs to its ancestors. A descendant
 * WITH a box would have been the cell's element had the grid shown it
 * there, so one that was not hit is not shown: an item scrolled under
 * its container's glyph border is inside the native padding box, the
 * engine having drawn that border in cells the browser gives the
 * content. */
const showsElement = (innermost: Element, el: Element, hasBox: HasBox): boolean =>
  el === innermost || el.contains(innermost) || (innermost.contains(el) && !hasBox(el));

/** Whether an element has a layout box of its own. */
type HasBox = (el: Element) => boolean;

/** Two cell rects, or the absence of one, the same. */
const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height);

const DYNAMIC_RELAYOUT_EVENTS = [
  "pointerover",
  "pointerleave",
  // `:active` styles (`active:opacity-50`) need a repaint on both edges
  // of a press — pointer and keyboard (Space/Enter, filtered in
  // #scheduleDynamicRelayout).
  "pointerdown",
  "pointerup",
  "pointercancel",
  "keydown",
  "keyup",
  "focusin",
  "focusout",
  "input",
  "change",
] as const;

/** How far a resize may report the host from the size a layout wrote,
 * in px: the rounding of layout units (1/64 px in Chromium and WebKit,
 * 1/60 in Firefox). */
const SIZE_TOLERANCE = 0.05;

/** Whether a lock's snap back could start a transition on an element:
 * a non-zero duration or delay in any entry of its lists. */
const mayTransition = (style: CSSStyleDeclaration): boolean =>
  /[1-9]/u.test(style.transitionDuration) || /[1-9]/u.test(style.transitionDelay);

/** css-color-4's system colors, the deprecated ones after the rest. */
const SYSTEM_COLORS =
  "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext " +
  "field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem " +
  "selecteditemtext visitedtext activeborder activecaption appworkspace background " +
  "buttonhighlight buttonshadow captiontext inactiveborder inactivecaption inactivecaptiontext " +
  "infobackground infotext menu menutext scrollbar threeddarkshadow threedface threedhighlight " +
  "threedlightshadow threedshadow window windowframe windowtext";

/** A color whose value depends on where it resolves — through a custom
 * property, the current color, or the color scheme (a system color, a
 * prefixed one, or `light-dark()`) — which the probe reads again each
 * layout. */
export const CONTEXTUAL_COLOR = new RegExp(
  `var\\(|currentcolor|light-dark\\(|-[a-z]+-|\\b(?:${SYSTEM_COLORS.replaceAll(" ", "|")})\\b`,
  "iu",
);

/* Wheel-gesture model (specs/scrolling.md "Gesture latching"). */
/** Ticks further apart than this begin a new gesture — and settle. */
const WHEEL_QUIESCE_MS = 200;
/** Pointer jitter that still counts as stationary. */
const WHEEL_POINTER_SLOP_PX = 3;
/** An undecided first tick this small is eaten, not latched. */
const WHEEL_LEAD_IN_PX = 4;
/** Non-increasing ticks that confirm momentum. */
const INERTIA_TICKS = 8;
/** Settle only once scrolling has gone QUIET after `scrollend`: a held
 * key fires scrollend after every step's animation, and an immediate
 * (instant) settle would cut the next step's animation short. */
const SETTLE_QUIESCE_MS = 100;
/** Settle debounce after the last `scroll` event where no `scrollend`
 * comes: older Safari has none, WebKit fires none after a keyboard
 * scroll. */
const SETTLE_FALLBACK_MS = 160;
/** A scroll this soon after a key press is the key's, and the longest
 * a key holds relayouts (#onScrollKey). */
const KEY_SCROLL_MS = 500;
/** The keys that scroll a focused container natively, and which way. */
const SCROLL_KEYS: Readonly<Record<string, readonly [dx: number, dy: number]>> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  PageUp: [0, -1],
  PageDown: [0, 1],
  Home: [0, -1],
  End: [0, 1],
  " ": [0, 1],
};
/** The browsers' own autoscroll timer: a held gesture past its
 * scroller's edge scrolls it this often (specs/wide-characters.md). */
const AUTOSCROLL_TICK_MS = 50;
/** The delay before a held track press starts repeating, and the beat
 * it repeats on, as a native scrollbar's. */
const TRACK_PAGE_DELAY_MS = 300;
const TRACK_PAGE_REPEAT_MS = 50;

/** Whether a native scroller has room in the delta's direction. */
function hasRoom(el: Element, dx: number, dy: number): boolean {
  return (
    (dy > 0 && el.scrollTop < el.scrollHeight - el.clientHeight - 0.5) ||
    (dy < 0 && el.scrollTop > 0.5) ||
    (dx > 0 && el.scrollLeft < el.scrollWidth - el.clientWidth - 0.5) ||
    (dx < 0 && el.scrollLeft > 0.5)
  );
}

/** Whether a scroll container has room in the delta's direction: native
 * room on an axis with engine range (the native ceiling IS the
 * engine's max, and an axis without range never consumes). */
function containerHasRoom(node: LayoutNode, dx: number, dy: number): boolean {
  const { maxX, maxY } = node.scrollRange!;
  const el = node.source as HTMLElement;
  return (
    (dy !== 0 && maxY > 0 && hasRoom(el, 0, dy)) || (dx !== 0 && maxX > 0 && hasRoom(el, dx, 0))
  );
}

/** Whether a focused control keeps a scrolling key: text entry every
 * one, a radio its arrows and Space, a button-like control Space. */
function controlKeeps(target: Element, key: string): boolean {
  if (target.closest("textarea, select, [contenteditable]:not([contenteditable='false'])")) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    if (target.type === "radio") return key === " " || key.startsWith("Arrow");
    return BUTTON_INPUTS.has(target.type) ? key === " " : true;
  }
  return key === " " && target.matches("button, summary");
}

/** The sum of a computed style's lengths, in px. */
const pxSum = (style: CSSStyleDeclaration, ...properties: string[]): number =>
  properties.reduce(
    (sum, property) => sum + (parseFloat(style.getPropertyValue(property)) || 0),
    0,
  );

/** An element's padding box in client pixels. */
function paddingBox(el: Element): DOMRectReadOnly {
  const rect = el.getBoundingClientRect();
  return new DOMRectReadOnly(
    rect.left + el.clientLeft,
    rect.top + el.clientTop,
    el.clientWidth,
    el.clientHeight,
  );
}

// Import-safe outside the browser (SSR, Node scripts using renderPlainText):
// `HTMLElement` doesn't exist there, and a bare `extends HTMLElement` throws
// at IMPORT time. Substitute an inert base — the class is only instantiated
// by the browser after defineMonoWind(), which no-ops without a DOM.
const HTMLElementBase = (
  typeof HTMLElement === "undefined" ? class {} : HTMLElement
) as typeof HTMLElement;

export class MonoWindElement extends HTMLElementBase {
  static observedAttributes = Object.keys(HOST_KEYWORDS);

  // Stylesheets can apply after a host's first layout (vite dev
  // injection, the CDN's in-browser Tailwind compile, HMR) — a pure
  // <head> mutation no per-host observer sees, which would otherwise
  // leave UA-styled geometry until an unrelated trigger. One shared
  // watcher relayouts every connected host on any head change (rare, and
  // relayout coalesces per frame); a still-loading <link> applies its CSS
  // at load time, so those get a one-shot listener too.
  static #headHosts = new Set<MonoWindElement>();
  static #headWatcher: MutationObserver | null = null;

  static #onHeadStylesChanged = (): void => {
    for (const host of MonoWindElement.#headHosts) host.#scheduleLayout();
  };

  static #watchLoadingLink(node: Node): void {
    if (node instanceof HTMLLinkElement && node.rel === "stylesheet" && !node.sheet) {
      node.addEventListener("load", MonoWindElement.#onHeadStylesChanged, { once: true });
    }
  }

  static #watchHead(host: MonoWindElement): void {
    MonoWindElement.#headHosts.add(host);
    if (MonoWindElement.#headWatcher) return;
    // Stylesheets already in flight when the first host connects apply
    // without any head mutation — catch their loads too.
    for (const link of document.querySelectorAll("link[rel=stylesheet]")) {
      MonoWindElement.#watchLoadingLink(link);
    }
    const watcher = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) MonoWindElement.#watchLoadingLink(node);
      }
      MonoWindElement.#onHeadStylesChanged();
    });
    watcher.observe(document.head, { childList: true, subtree: true, characterData: true });
    MonoWindElement.#headWatcher = watcher;
  }

  static #unwatchHead(host: MonoWindElement): void {
    MonoWindElement.#headHosts.delete(host);
    if (MonoWindElement.#headHosts.size === 0) {
      MonoWindElement.#headWatcher?.disconnect();
      MonoWindElement.#headWatcher = null;
    }
  }

  /** The shadow's `:host {}` rule the engine writes into — the theme
   * tokens and the grid's origin, inherited by the light DOM, never a
   * light-DOM mutation — seeded with the system colors, so a token is
   * valid before the first layout. */
  #hostSheet = new CSSStyleSheet();
  /** Inside another host: the engine stays off (connectedCallback). */
  #nested = false;
  /** The listeners of the current connection, removed at once on disconnect. */
  #listening: AbortController | null = null;
  #shadow: ShadowRoot;
  #grid: HTMLElement;
  #layers: HTMLElement;
  #probe: HTMLElement;
  /** Resolves colors where the grid's spans inherit them
   * (specs/cell-model.md "Opacity and translucency"): the ink, the
   * ground and `canvas` from its own style, any other on demand. */
  #colorProbe: HTMLElement;
  #colorProbeStyle: CSSStyleDeclaration;
  /** The ground and ink the last layout resolved. */
  #ground: Rgba | undefined;
  #ink: Rgba | undefined;
  /** The colors the paint read through the probe, a contextual one read
   * again each layout while the style is clean. */
  #probedColors = new Map<string, Rgba | null>();
  /** An ancestor's background or color transitions the host lays out
   * again at the end of (#awaitColorTransitions). */
  #awaitedTransitions = new WeakSet<Animation>();
  #resizeObserver: ResizeObserver | null = null;
  /** The parent and siblings the resize observer watches
   * (#observeSurroundings). */
  #surroundings = new Set<Element>();
  /** The ancestors' `class` and `style`, which reach the host's cells
   * through the cascade — a theme class on the page, the derived tokens'
   * colors among them. */
  #ancestorObserver: MutationObserver | null = null;
  #colorScheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  #onColorSchemeChange = (): void => this.#scheduleLayout();
  #mutationObserver: MutationObserver | null = null;
  #layoutPending = false;
  /** The pending layout's frame request, which any layout before it
   * serves (#performLayout). */
  #layoutRequest = 0;
  /** The frame time of the last layout a frame request ran, which the
   * sampling tick in that frame reads as its own. */
  #laidOutFrame = -1;
  #cellMetrics: CellMetrics | null = null;
  /** The content box the last layout sized the host to, null until one
   * does: a resize reporting it is the layout's own (#onResize). */
  #laidOutSize: BoxSize | null = null;
  /** The size each box around the host last reported (#onResize). */
  #surroundingSizes = new WeakMap<Element, BoxSize>();
  #lastLayout: LayoutNode | null = null;
  #unsubscribeLeafRegistry: (() => void) | null = null;
  #unsubscribeGlyphRegistry: (() => void) | null = null;
  #paintPending = false;
  /** Scroll containers of the LAST layout (specs/scrolling.md). */
  #scrollNodes: LayoutNode[] = [];
  #settleTimers = new Map<Element, ReturnType<typeof setTimeout>>();
  /** Last routed-scroll activity per scroll container (a wheel tick, an
   * auto-scroll tick): each scrollBy is a separate PROGRAMMATIC scroll,
   * so the browser fires scrollend between ticks — mid-gesture settles
   * would keep snapping small deltas back (the "resistance"). Recent
   * activity suppresses them; the quiesce timer settles instead. */
  #routedScrollAt = new WeakMap<Element, number>();
  /** What the current wheel gesture is latched to: a scroll container,
   * or the page (`el: null`). */
  #wheelLatch: WheelLatch | null = null;
  #thumbDrag: ThumbDrag | null = null;
  #trackPaging: { press: TrackPress; timer: ReturnType<typeof setTimeout> } | null = null;
  /** The last primary pointerdown's type and id: a `mousedown` counts
   * as a semantic gesture only after a mouse or pen (a tap's
   * compatibility mousedown follows a touch pointerdown), and the id is
   * the capture target of a gesture the engine takes over. */
  #lastPointerType = "";
  #lastPointerId = -1;
  #gesture: Gesture | null = null;
  /** A gesture's auto-scroll (specs/wide-characters.md "auto-scrolls"):
   * the pressed cell's scroller — a scroll container, a native scroller
   * outside the host, or the page — ticked while the press is held. */
  #autoscroll: { el: HTMLElement; page: boolean; timer: ReturnType<typeof setInterval> } | null =
    null;
  /** A scroll container scrolled since the last offsets sync. */
  #containerScrolled = false;
  /** A gesture the engine took over releases through it too: armed by
   * its pointerup, spent by the mouseup after (#onMouseUp). */
  #ownsRelease = false;
  /** Whether the last selectionchange found a range in this host's
   * light DOM — the next one must repaint even when it left. */
  #paintedSelection = false;
  /** A press's selection gesture under way (#onSelectStart, or a press
   * begun outside dragged in, #onPointerMove), which holds `SELECTION`
   * until its release: its first selectionchange can find the
   * selection collapsed, the extension to come. */
  #selectionGesture = false;
  /** A primary press held anywhere in the window. */
  #pressHeld = false;
  /** Each anchored box's last successful placement, from one layout to
   * the next (specs/anchor-positioning.md). */
  #placements = new Map<Element, Remembered>();
  /** The elements carrying `data-mw-anchor`, which the companion scopes
   * while the engine reads (#scopeAnchors). */
  #anchors = new Set<Element>();
  /** Each textarea's content width in cells as the last layout gave it
   * (#rewrapsTextareas). */
  #textareaCells = new WeakMap<HTMLTextAreaElement, number>();
  /** When the last key went down (see #onScroll). */
  #lastKeyAt = 0;
  /** An arrow waiting for the end of its dispatch (#onKeyDown). */
  #pendingArrow: AbortController | null = null;
  /** A key's scroll in flight (#onScrollKey): the key, the container it
   * scrolls, whether that has scrolled since, whether a relayout waits
   * on it, and the hold's deadline. */
  #keyScroll: {
    key: KeyboardEvent;
    container: Element;
    scrolled: boolean;
    deferred: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  #glyphs = new GlyphBoxes((glyph, scale, lineHeight) =>
    this.#baselineOf(glyph, scale, lineHeight),
  );
  /** An engine-driven grid drag, anchored at a flat text offset: a
   * press the engine takes — one on a phantom light target (see
   * INTERACTIVE), or one that moves the focus — where the native
   * selection would lose its anchor to the repaint. */
  #gridDrag: GridDrag | null = null;
  /** A primary press that landed on the grid: the first pointermove with
   * the button down marks the host `data-mw-dragging`, which drops
   * interactive light elements' pointer events so a native drag sweeps
   * through their cells instead of stalling at their edge. */
  #pressOnGrid = false;
  /** Native scrollers outside the host (ancestors with scrollable
   * overflow, then the page), collected per layout so a wheel tick
   * never reads computed styles (see #outsideCanScroll). */
  #outerScrollers: Element[] = [];
  /** The boxes between the host and the page that CLIP the grid — the
   * scrollers among them included (specs/top-layer.md). */
  #outerClips: Element[] = [];

  /** Whether a record is a change the grid must follow: the tree and
   * the text always, an attribute when it renders (observed.ts); on the
   * host only `class` and `style`, its own attributes being the
   * engine's or attributeChangedCallback's. */
  #changesRendering(record: MutationRecord): boolean {
    if (record.type !== "attributes") return true;
    const name = record.attributeName ?? "";
    if (record.target === this) return name === "class" || name === "style";
    return rendersAttribute(record.target as Element, name);
  }

  constructor() {
    super();
    const shadow = (this.#shadow = this.attachShadow({ mode: "open" }));
    shadow.innerHTML = SHADOW_TEMPLATE;
    this.#hostSheet.replaceSync(":host { --mw-fg: canvastext; --mw-bg: canvas }");
    shadow.adoptedStyleSheets = [this.#hostSheet];
    this.#grid = shadow.querySelector<HTMLElement>("#grid")!;
    this.#layers = shadow.querySelector<HTMLElement>("#layers")!;
    this.#colorProbe = shadow.querySelector<HTMLElement>("#color-probe")!;
    this.#colorProbeStyle = getComputedStyle(this.#colorProbe);
    // The cell-metrics probe (measureCellMetrics), in the LIGHT DOM so it
    // is font-matched in the content's own context; read under
    // `measuring`, with the typography locks off, its inline
    // `!important`s holding its box and wrap.
    this.#probe = document.createElement("span");
    this.#probe.setAttribute("aria-hidden", "true");
    this.#probe.setAttribute("data-mw-probe", "");
    this.#probe.style.cssText =
      "position:absolute!important;top:0!important;left:0!important;" +
      "visibility:hidden!important;pointer-events:none!important;user-select:none!important;" +
      "white-space:pre!important;overflow-wrap:normal!important;" +
      "padding:0!important;margin:0!important;border:0!important;min-width:auto!important;";
    this.#probe.textContent = "M".repeat(100);
    // An empty inline-block at the probe's baseline marks it for the
    // metrics (specs/cell-model.md "Typography").
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;padding:0;margin:0;border:0";
    this.#probe.appendChild(mark);
  }

  /** The baseline of the box the grid would paint for `glyph` at that
   * scale and line-height: a throwaway box in the grid with an empty
   * inline-block at its baseline, both unpadded (specs/wide-characters.md). */
  #baselineOf(glyph: string, scale: number, lineHeight: number): number {
    const box = document.createElement("span");
    box.style.cssText =
      "display:inline-block;vertical-align:top;overflow:clip;padding:0;" +
      `height:${this.#cellMetrics?.height ?? 0}px;` +
      `line-height:${lineHeight}px;font-size:${scale * 100}%`;
    box.textContent = glyph;
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;padding:0";
    box.appendChild(mark);
    this.#grid.appendChild(box);
    const baseline = mark.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.remove();
    return baseline;
  }

  connectedCallback(): void {
    // A host inside another is unsupported: it stays plain content of
    // the outer one, laid out and painted like any element of it.
    this.#nested = (this.parentElement?.closest("mono-wind") ?? null) !== null;
    if (this.#nested) {
      warnOnce(
        this,
        "A <mono-wind> inside another <mono-wind> is unsupported; it is laid out as plain content of the outer one.",
      );
      return;
    }
    // attributeChangedCallback only fires on changes; an absent
    // attribute reflects its default here.
    for (const [name, [initial]] of Object.entries(HOST_KEYWORDS)) {
      if (!this.hasAttribute(name)) this.setAttribute(name, initial);
    }
    // Before the observers connect, so its insertion isn't observed.
    if (this.#probe.parentNode !== this) this.appendChild(this.#probe);

    this.#listening = new AbortController();
    const { signal } = this.#listening;
    this.#surroundingSizes = new WeakMap();
    this.#resizeObserver = new ResizeObserver(this.#onResize);
    this.#ancestorObserver = new MutationObserver(() => this.#scheduleLayout());
    this.#colorScheme?.addEventListener("change", this.#onColorSchemeChange, { signal });
    this.#resizeObserver.observe(this);
    this.#observeSurroundings();
    // The probe too: a font it matches late resizes it, with no fonts
    // event to say so, its first report included. Absolutely
    // positioned, it is a block, which an observer sees.
    this.#resizeObserver.observe(this.#probe);
    // Viewport-relative lengths (h-screen, h-[95dvh], …) read
    // window.innerWidth/Height at layout time; a window resize that
    // doesn't change the HOST's size (height-only, typically) would
    // otherwise never retrigger them.
    window.addEventListener("resize", this.#onWindowResize, { signal });

    // A surviving record is the author's: the engine's writes in a
    // layout are drained before observation resumes, its marks outside
    // one are filtered by name, and its origin lives in the shadow.
    this.#mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => this.#changesRendering(record))) this.#scheduleLayout();
    });
    this.#mutationObserver.observe(this, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    // Leaf renderers (specs/leaf-renderers.md): a registration or
    // invalidation after this host's first layout must repaint it.
    this.#unsubscribeLeafRegistry = onLeafRegistryChange(() => this.#scheduleLayout());
    this.#unsubscribeGlyphRegistry = onGlyphRegistryChange(() => this.#scheduleLayout());

    // Fonts can finish loading after our first layout (the first layout then
    // used fallback-font metrics), which would leave decorations positioned
    // with stale cell metrics. Two signals, both needed:
    // - `fonts.ready` — resolves when the initial font loads settle. WebKit
    //   fires this reliably; keep it for the common first-load case.
    // - `loadingdone` — fires on every later font-load batch (lazily
    //   triggered @font-face, dynamically added styles).
    // Re-measuring is cheap and layout runs at most once per frame.
    document.fonts?.ready.then(this.#onFontsLoaded).catch((err: unknown) => {
      console.warn("[monowind] document.fonts.ready failed:", err);
    });
    document.fonts?.addEventListener("loadingdone", this.#onFontsLoaded, { signal });

    // Pseudo-classes (:hover/:focus-visible/:active) and form-control
    // value changes flip computed styles without any MutationObserver
    // signal. Delegated events on the host schedule a relayout; the
    // rAF debouncer collapses hover storms into at most one per frame.
    for (const evt of DYNAMIC_RELAYOUT_EVENTS) {
      this.addEventListener(evt, this.#scheduleDynamicRelayout, { signal });
    }

    // Animation sampling (specs/cell-model.md "Animation"): a running
    // transition of a sampled property starts the loop that shows the
    // browser's own interpolated values each frame.
    this.addEventListener("transitionrun", this.#onTransitionRun, { signal });
    this.addEventListener("transitionend", this.#onTransitionDone, { signal });
    this.addEventListener("transitioncancel", this.#onTransitionDone, { signal });
    // Keyframe animations join the same loop (specs/animations.md):
    // an iteration is a start for one resumed or begun before the
    // host listened, an end lands the state of one the loop dropped.
    this.addEventListener("animationstart", this.#onAnimationStart, { signal });
    this.addEventListener("animationiteration", this.#onAnimationStart, { signal });
    this.addEventListener("animationend", this.#onAnimationDone, { signal });
    this.addEventListener("animationcancel", this.#onAnimationDone, { signal });
    // A popover's or a dialog's toggle bubbles from neither: captured.
    this.addEventListener("toggle", this.#onToggle, { capture: true, signal });

    // Synthesized pointer states (specs/cell-model.md "Pointer
    // states"): under select="grid" the light DOM is pointer-events:
    // none, so :hover/:active can't match — the engine hit-tests the
    // pointer's cell and marks the chain with data-mw-hover /
    // data-mw-active (utilities.css retargets the Tailwind variants).
    this.addEventListener("pointermove", this.#onPointerMove, { signal });
    this.addEventListener("pointerleave", this.#onPointerLeave, { signal });
    this.addEventListener("pointerdown", this.#onPointerDown, { signal });
    // Capture, so a covered element's own listeners never run.
    for (const evt of COVERED_EVENTS) {
      this.addEventListener(evt, this.#onCoveredEvent, { capture: true, signal });
    }
    // Scroll events don't bubble — capture catches every light-DOM
    // container's scroll (specs/scrolling.md).
    const scrolls = { capture: true, passive: true, signal };
    this.addEventListener("scroll", this.#onScroll, scrolls);
    this.addEventListener("scrollend", this.#onScrollEnd, { capture: true, signal });
    this.addEventListener("wheel", this.#onWheel, { passive: false, signal });
    // A selection in the light DOM copies as the engine's plain text
    // (specs/semantic-selection.md): the browsers' serializers lose
    // block breaks for the out-of-flow boxes the render uses.
    this.addEventListener("copy", this.#onCopy, { signal });
    // Multi-click gestures (specs/semantic-selection.md): the click
    // count rides mousedown (PointerEvent.detail is 0).
    this.addEventListener("mousedown", this.#onMouseDown, { signal });
    this.addEventListener("keydown", this.#onKeyDown, { signal });
    // An arrow that moves focus is cancelled at the window (#onKeyDown):
    // #moveFocus releases the hold this listener takes.
    this.addEventListener("keydown", this.#onScrollKey, { signal });
    document.addEventListener("selectionchange", this.#onSelectionChange, { signal });
    document.addEventListener("selectstart", this.#onSelectStart, { capture: true, signal });
    // Press and release on the window: a selection drag routinely
    // starts or ends outside the host, and the press state must thaw
    // wherever it ends. Captured, so no page handler keeps either from
    // the host.
    const captured = { capture: true, signal };
    window.addEventListener("pointerdown", this.#onAnyPointerDown, captured);
    window.addEventListener("pointerup", this.#onPointerUp, captured);
    window.addEventListener("pointercancel", this.#onPointerUp, captured);
    window.addEventListener("mouseup", this.#onMouseUp, captured);
    // Content scrolling under a stationary pointer moves cells beneath
    // it — native :hover re-evaluates there, so the synthesis must
    // too. Capture catches nested scrollers (scroll doesn't bubble).
    document.addEventListener("scroll", this.#onAnyScroll, scrolls);

    MonoWindElement.#watchHead(this);
    this.#scheduleLayout();
  }

  disconnectedCallback(): void {
    this.#listening?.abort();
    this.#pendingArrow?.abort();
    this.#resizeObserver?.disconnect();
    this.#mutationObserver?.disconnect();
    this.#ancestorObserver?.disconnect();
    this.#resizeObserver = null;
    this.#surroundings.clear();
    this.#mutationObserver = null;
    this.#ancestorObserver = null;
    this.#unsubscribeLeafRegistry?.();
    this.#unsubscribeLeafRegistry = null;
    this.#unsubscribeGlyphRegistry?.();
    this.#unsubscribeGlyphRegistry = null;
    this.#animated.clear();
    this.#releaseKeyScroll();
    for (const timer of this.#settleTimers.values()) clearTimeout(timer);
    this.#settleTimers.clear();
    this.#thumbDrag = null;
    this.#stopTrackPaging(false);
    this.#wheelLatch = null;
    this.#stopAutoscroll();
    this.#hoverClient = null;
    this.#pressTarget = null;
    this.#pressing = false;
    this.#pressHeld = false;
    this.#pressOnGrid = false;
    this.#gesture = null;
    this.#gridDrag = null;
    this.#paintHeld = false;
    this.#ownsRelease = false;
    this.#selectionGesture = false;
    // The states a release or a selectionchange would end, events the
    // host hears no more.
    for (const state of [SELECTION, SEMANTIC_SELECTION, "data-mw-dragging"]) {
      this.removeAttribute(state);
    }
    this.#updatePointerStates();
    MonoWindElement.#unwatchHead(this);
  }

  // Synthesized pointer states (specs/cell-model.md "Pointer states").
  #hovered = new Set<Element>();
  #pressed = new Set<Element>();
  /** The light elements the grid covers where the pointer is. */
  #covered = new Set<Element>();
  /** The light element the browser last hit, from the pointer's own
   * event: what it would hover and press. */
  #hoverTarget: Element | null = null;
  #pressTarget: Element | null = null;
  #pressing = false;
  #paintHeld = false;
  #hoverClient: { x: number; y: number } | null = null;
  /** The pointer's cells at the last update (pointKey); null where it
   * synthesized nothing. */
  #hoverKey: unknown[] | null = null;
  #gridOrigin: { left: number; top: number } | null = null;
  static #hoverCapable = typeof matchMedia === "undefined" ? null : matchMedia("(hover: hover)");

  /** Paint-only pass (specs/scrolling.md): reruns paintGrid from the
   * last layout with current scroll offsets — no measuring, no
   * layout. Scroll events coalesce into one frame. */
  #schedulePaint(): void {
    // A queued layout repaints (and re-syncs offsets) itself.
    if (this.#paintPending || this.#layoutPending) return;
    this.#paintPending = true;
    // rAF, with a timeout backstop: headless/backgrounded Firefox can
    // throttle rAF into never firing, freezing scroll mirroring.
    let done = false;
    const run = (): void => {
      if (done) return;
      done = true;
      this.#paintPending = false;
      const metrics = this.#cellMetrics;
      if (!this.isConnected || !this.#lastLayout || !metrics) return;
      // The sticky and fixed boxes' light-DOM shift writes are the
      // engine's own, drained like a layout pass's.
      renderScroll(this.#lastLayout, () => this.#syncScrollOffsets(metrics));
      this.#mutationObserver?.takeRecords();
      this.#paintHeld = !this.#paint(this.#lastLayout);
      this.#followContainerScroll();
      // The cells under a stationary pointer changed with the scroll.
      this.#updatePointerStates();
    };
    requestAnimationFrame(run);
    setTimeout(run, 50);
  }

  /** Per-container offsets for the paint: from the pre-mask snapshot during
   * a layout pass (native reads are clamped inside the mask; pins
   * resolve to the NEW max), from the live position on a scroll
   * repaint, and at zero for a scroller new to the layout, until the
   * next paint. */
  #syncScrollOffsets(
    metrics: CellMetrics,
    snapshot?: ScrollSnapshot,
    nodes = this.#scrollNodes,
  ): void {
    for (const node of nodes) {
      const el = node.source as HTMLElement;
      const { maxX, maxY } = node.scrollRange!;
      const entry = snapshot?.get(el);
      if (entry) {
        node.scroll = {
          x: entry.pinX ? maxX : Math.min(entry.x, maxX),
          y: entry.pinY ? maxY : Math.min(entry.y, maxY),
        };
      } else if (snapshot) {
        // A scroller new to this layout, which the snapshot before the
        // mask never saw: the next paint syncs it live.
        node.scroll ??= { x: 0, y: 0 };
      } else {
        node.scroll = this.#quantize(node, metrics);
      }
    }
  }

  /** A scroll container scrolled: the cells under a held pointer
   * moved, so a live gesture follows — after the paint, whose grid and
   * tree the search reads. */
  #followContainerScroll(): void {
    if (!this.#containerScrolled) return;
    this.#containerScrolled = false;
    this.#followPointer();
  }

  /** The laid-out scroll container a light element is. */
  #scrollNodeOf(el: Element): LayoutNode | undefined {
    return this.#scrollNodes.find((node) => node.source === el);
  }

  /** A container's native position in cells (see scrollCells), ties
   * broken away from the last painted offset. */
  #quantize(node: LayoutNode, metrics: CellMetrics): { x: number; y: number } {
    const el = node.source as HTMLElement;
    const { maxX, maxY } = node.scrollRange!;
    const base = node.scroll ?? { x: 0, y: 0 };
    return {
      x: scrollCells(el, "x", metrics.width, maxX, base.x),
      y: scrollCells(el, "y", metrics.height, maxY, base.y),
    };
  }

  /** Snapshot of every scroll container's native position, taken BEFORE the
   * measuring mask goes on: the mask collapses container geometry (the
   * range spacer is off) and browsers clamp native positions during
   * that reflow — Chromium eagerly, Firefox lazily — so any read inside
   * the pass is wrong. Bottom-stick rides along: a scroll container settled at a
   * real end (pre-layout max > 0) re-pins to the NEW max. */
  #captureScrollState(): ScrollSnapshot {
    const snapshot: ScrollSnapshot = new Map();
    const metrics = this.#cellMetrics;
    if (!metrics) return snapshot;
    for (const node of this.#scrollNodes) {
      const el = node.source as HTMLElement;
      const { maxX, maxY } = node.scrollRange!;
      const { x, y } = this.#quantize(node, metrics);
      snapshot.set(el, {
        top: el.scrollTop,
        left: el.scrollLeft,
        maxTop: el.scrollHeight - el.clientHeight,
        maxLeft: el.scrollWidth - el.clientWidth,
        x,
        y,
        pinX: maxX > 0 && x >= maxX,
        pinY: maxY > 0 && y >= maxY,
      });
    }
    return snapshot;
  }

  /** Write back, after the unmask, a position the clamp moved and an
   * end pin whose native max the pass changed. The reads commit
   * Firefox's and WebKit's lazy post-reflow clamp before the compare
   * (a write that looks like the pre-clamp value would coalesce with
   * it into no change), and only a real change is written: any write
   * cancels a native scroll in flight. */
  #restoreScrollPositions(snapshot: ScrollSnapshot): void {
    for (const node of this.#scrollNodes) {
      const el = node.source as HTMLElement;
      const entry = snapshot.get(el);
      if (!entry) continue;
      const top = el.scrollTop;
      const left = el.scrollLeft;
      if (entry.pinY && el.scrollHeight - el.clientHeight !== entry.maxTop) {
        el.scrollTop = el.scrollHeight;
      } else if (top !== entry.top) {
        el.scrollTop = entry.top;
      }
      if (entry.pinX && el.scrollWidth - el.clientWidth !== entry.maxLeft) {
        el.scrollLeft = el.scrollWidth;
      } else if (left !== entry.left) {
        el.scrollLeft = entry.left;
      }
    }
  }

  /** Arm (or re-arm) a pane's settle for after `delay` of quiet. */
  #settleAfter(el: HTMLElement, delay: number): void {
    this.#cancelSettle(el);
    this.#settleTimers.set(
      el,
      setTimeout(() => {
        this.#settleTimers.delete(el);
        this.#settle(el);
      }, delay),
    );
  }

  #cancelSettle(el: Element): void {
    clearTimeout(this.#settleTimers.get(el));
    this.#settleTimers.delete(el);
  }

  /** The scroll container an event is from, one the engine drives. */
  #scrollTarget(event: Event): HTMLElement | null {
    const target = event.target;
    return target instanceof HTMLElement && target !== this && target.hasAttribute("data-mw-scroll")
      ? target
      : null;
  }

  #onScroll = (event: Event): void => {
    const target = this.#scrollTarget(event);
    if (!target) return;
    this.#containerScrolled = true;
    if (this.#keyScroll?.container === target) this.#keyScroll.scrolled = true;
    this.#schedulePaint();
    // An anchor scrolled under a box the scroll leaves: placed afresh
    // (specs/anchor-positioning.md).
    if (this.#lastLayout?.anchorScrollers?.has(target)) this.#scheduleLayout();
    // Routed scrolls keep their own quiesce timer (#scrollRouted).
    if (Date.now() - (this.#routedScrollAt.get(target) ?? 0) < WHEEL_QUIESCE_MS) return;
    // Still scrolling: a pending settle waits for scrollend — or, where
    // none comes (older Safari; WebKit after a key), for the pause
    // after the last event.
    if (!("onscrollend" in window) || Date.now() - this.#lastKeyAt < KEY_SCROLL_MS) {
      this.#settleAfter(target, SETTLE_FALLBACK_MS);
    } else {
      this.#cancelSettle(target);
    }
  };

  #onScrollEnd = (event: Event): void => {
    const target = this.#scrollTarget(event);
    if (!target) return;
    // Mid-gesture scrollends: routed scrolls and thumb drags settle on
    // quiesce/release instead (see #routedScrollAt).
    if (Date.now() - (this.#routedScrollAt.get(target) ?? 0) < WHEEL_QUIESCE_MS) return;
    this.#settleAfter(target, SETTLE_QUIESCE_MS);
  };

  /** Snap the native position to the cell the grid shows for it (the
   * paint's own quantization, so the grid never jumps after the
   * gesture). Idempotent: its own scroll event changes no cell. The
   * max cell settles on the native CEILING, not the multiple: leftover
   * native room would latch the next text-mode gesture to an invisible
   * scroll instead of chaining. */
  #settle(el: HTMLElement): void {
    if (this.#keyScroll?.scrolled && this.#keyScroll.container === el) this.#releaseKeyScroll();
    if (this.#thumbDrag?.el === el) return; // release settles
    // Repaint unconditionally: scroll events can coalesce away under
    // load (observed in Firefox), and the settle is the gesture's
    // reliable terminal signal — a current grid makes this a no-op.
    this.#schedulePaint();
    const metrics = this.#cellMetrics;
    const node = this.#scrollNodeOf(el);
    if (!metrics || !node) return;
    const range = node.scrollRange!;
    // Quantized from the live position: a scroll since the last paint
    // (its event still to come) settles on its own cell.
    const cells = this.#quantize(node, metrics);
    const top = nativeOffset(el, "y", cells.y, range.maxY, metrics.height);
    const left = nativeOffset(el, "x", cells.x, range.maxX, metrics.width);
    if (Math.abs(el.scrollTop - top) > 0.5 || Math.abs(el.scrollLeft - left) > 0.5) {
      el.scrollTo({ top, left, behavior: "instant" });
    }
  }

  /** Grid-mode wheel routing (specs/scrolling.md): the light DOM is
   * pointer-inert, so the engine hit-tests the cell and scrolls the
   * nearest consuming container — chaining OUTWARD per axis, since
   * programmatic scrollBy never chains natively. preventDefault only
   * for ticks a scroll container owns, so page scrolling survives. */
  #onWheel = (event: Event): void => {
    if (this.getAttribute("select") !== "grid") return;
    const layout = this.#lastLayout;
    const metrics = this.#cellMetrics;
    if (!layout || !metrics || this.#scrollNodes.length === 0) return;
    const e = event as WheelEvent;
    const scale = e.deltaMode === 1 ? metrics.height : e.deltaMode === 2 ? this.clientHeight : 1;
    const dx = e.deltaX * scale;
    const dy = e.deltaY * scale;
    // A non-cancelable tick is the page's gesture, unless nothing
    // outside the host can scroll that way.
    if (!e.cancelable && this.#outsideCanScroll(dx, dy)) return;
    const now = Date.now();
    const mag = Math.abs(dx) + Math.abs(dy);
    // A zero-delta phase tick ends the gesture, canceled so the
    // sequence it opens stays cancelable.
    if (mag === 0) {
      this.#wheelLatch = null;
      e.preventDefault();
      return;
    }
    // Native room decides (the native ceiling IS the engine's max);
    // an axis without engine range never consumes.
    const canMove = (node: LayoutNode): boolean => containerHasRoom(node, dx, dy);
    // The latch holds while ticks keep coming on its axis: after a
    // move, one that keeps decaying; else anything but a rise after
    // confirmed inertia.
    const latch = this.#wheelLatch;
    const axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    const rise = latch !== null && mag > latch.mag * 1.25 + 1;
    const moved =
      latch !== null &&
      (Math.abs(e.clientX - latch.x) > WHEEL_POINTER_SLOP_PX ||
        Math.abs(e.clientY - latch.y) > WHEEL_POINTER_SLOP_PX);
    const inertia = latch !== null && latch.decayed >= INERTIA_TICKS;
    const held =
      latch !== null &&
      now - latch.at < WHEEL_QUIESCE_MS &&
      axis === latch.axis &&
      (moved ? mag <= latch.mag : !(inertia && rise));
    let target: LayoutNode | null = null;
    if (held) {
      const smooth = mag <= latch.mag && mag >= latch.mag * 0.5;
      latch.decayed = smooth ? latch.decayed + 1 : inertia ? latch.decayed : 0;
      latch.mag = mag;
      latch.at = now;
      if (!latch.el) return; // the page's gesture
      target = this.#scrollNodeOf(latch.el) ?? null;
    }
    if (!target) {
      const stack = stackAt(layout, this.#cellAt(e.clientX, e.clientY, metrics));
      for (let i = stack.length - 1; i >= 0; i--) {
        const node = stack[i]!;
        if (!node.scrollRange || isInert(node.source)) continue;
        if (canMove(node)) {
          target = node;
          break;
        }
        // At its boundary already: chain outward only where its
        // overscroll-behavior allows it on the gesture's axis.
        const overscroll = node.style.overscroll;
        if ((dy !== 0 && !overscroll.y) || (dx !== 0 && !overscroll.x)) {
          target = node; // contain/none: the gesture stays here, inert
          break;
        }
      }
      // A tiny first tick nothing consumes decides nothing: eaten,
      // keeping the sequence cancelable, for the next to decide.
      if (!target && mag < WHEEL_LEAD_IN_PX) {
        e.preventDefault();
        return;
      }
      this.#wheelLatch = {
        el: target ? (target.source as HTMLElement) : null,
        x: e.clientX,
        y: e.clientY,
        axis,
        at: now,
        mag,
        decayed: 0,
      };
    }
    if (!target) return; // the page's gesture
    e.preventDefault();
    if (!canMove(target)) return; // latched at the boundary: consume, no chain
    const range = target.scrollRange!;
    this.#scrollRouted(
      target.source as HTMLElement,
      range.maxX > 0 ? dx : 0,
      range.maxY > 0 ? dy : 0,
    );
  };

  /** An engine-driven scroll — a routed wheel tick, an auto-scroll
   * tick. A scroll container's is one gesture rather than N
   * programmatic scrolls: its per-tick scrollend settles are
   * suppressed and it settles after quiesce. */
  #scrollRouted(el: HTMLElement, left: number, top: number): void {
    const apply: ScrollToOptions = { behavior: "instant" };
    if (left !== 0) apply.left = left;
    if (top !== 0) apply.top = top;
    el.scrollBy(apply);
    if (!el.hasAttribute("data-mw-scroll")) return;
    this.#routedScrollAt.set(el, Date.now());
    this.#settleAfter(el, WHEEL_QUIESCE_MS);
  }

  /** Whether a native scroller outside the host has room in the
   * delta's direction (offset reads only — the list is per layout). */
  #outsideCanScroll(dx: number, dy: number): boolean {
    return this.#outerScrollers.some((el) => hasRoom(el, dx, dy));
  }

  /** The host's width is capped to whole cells (styles.css), so the
   * host keeps its size as its slot grows: observe the parent (a
   * growing container) and the siblings (a flex or grid slot that
   * grows because a sibling shrank), and every ancestor's `class` and
   * `style` for the cascade. Re-run per layout: new siblings join, and
   * the ones that left go, the observer holding each it watches. */
  #observeSurroundings(): void {
    const parent = this.parentElement;
    const resizes = this.#resizeObserver;
    if (!parent || !resizes || !this.#ancestorObserver) return;
    const surroundings = new Set<Element>([parent, ...parent.children]);
    surroundings.delete(this);
    for (const el of this.#surroundings) if (!surroundings.has(el)) resizes.unobserve(el);
    for (const el of surroundings) if (!this.#surroundings.has(el)) resizes.observe(el);
    this.#surroundings = surroundings;
    for (let el = behind(this); el; el = behind(el)) {
      this.#ancestorObserver.observe(el, { attributes: true, attributeFilter: ["class", "style"] });
    }
  }

  /** A box around the host relays out on a width change only — a
   * height change just moves the grid — and its first report counts as
   * what the last layout saw. */
  #onResize = (entries: ResizeObserverEntry[]): void => {
    let relayout = false;
    let moved = false;
    for (const { target, contentRect } of entries) {
      const size = { width: contentRect.width, height: contentRect.height };
      if (target === this) {
        const laidOut = this.#laidOutSize;
        relayout ||=
          !laidOut ||
          Math.abs(size.width - laidOut.width) > SIZE_TOLERANCE ||
          Math.abs(size.height - laidOut.height) > SIZE_TOLERANCE;
      } else if (target === this.#probe) {
        relayout ||= this.#cellChanged();
      } else {
        const last = this.#surroundingSizes.get(target);
        this.#surroundingSizes.set(target, size);
        if (!last) continue;
        if (size.width !== last.width) relayout = true;
        else if (size.height !== last.height) moved = true;
      }
    }
    if (relayout) this.#scheduleLayout();
    else if (moved) this.#onGridMoved();
  };

  /** Whether a textarea's rows are to wrap again: the width this layout
   * gave it is neither the one read before the layout, which its rows
   * wrapped at, nor the last layout's. */
  #rewrapsTextareas(textareas: Iterable<HTMLTextAreaElement>, widths: TextareaWidths): boolean {
    let rewraps = false;
    for (const area of textareas) {
      const node = this.#nodeOf(area);
      if (!node) continue;
      const cells = node.localRect.width - edges(node.style.border, node.resolvedPadding, "x");
      if (cells !== widths.get(area) && cells !== this.#textareaCells.get(area)) rewraps = true;
      this.#textareaCells.set(area, cells);
    }
    return rewraps;
  }

  /** Flags the elements naming an anchor (`data-mw-anchor`), whose names
   * the companion scopes while the engine reads
   * (specs/anchor-positioning.md "Reading"); true where one was read
   * unscoped — new, or its flag taken off by a script — and a box is
   * anchored by name, which reads again. */
  #scopeAnchors(root: LayoutNode): boolean {
    const { named, anchored } = namedAnchors(root);
    let joined = false;
    for (const el of this.#anchors) if (!named.has(el)) el.removeAttribute("data-mw-anchor");
    for (const el of named) {
      if (el.hasAttribute("data-mw-anchor")) continue;
      el.setAttribute("data-mw-anchor", "");
      joined = true;
    }
    this.#anchors = named;
    return joined && anchored;
  }

  /** Whether the probe measures a cell other than the last layout's. */
  #cellChanged(): boolean {
    const last = this.#cellMetrics;
    return last === null || !sameMetrics(last, measureCellMetrics(this, this.#probe));
  }

  /** The grid cell under a client point — through a layer's transform
   * where one shows there and takes the pointer (cellAtPoint) — with
   * the grid it is painted in: a layer's, with the layer's origin, or
   * the main one. */
  #cellAt(clientX: number, clientY: number, metrics: CellMetrics): PointerHit {
    const { x, y } = this.#gridPoint(clientX, clientY);
    return cellAtPoint(this.#lastLayout, this.#layers, this.#grid, x, y, metrics);
  }

  /** A client point in px from the grid's origin, which is cached until
   * the next layout or page scroll invalidates it. */
  #gridPoint(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.#gridOrigin) {
      const rect = this.#grid.getBoundingClientRect();
      this.#gridOrigin = { left: rect.left, top: rect.top };
    }
    return { x: clientX - this.#gridOrigin.left, y: clientY - this.#gridOrigin.top };
  }

  /** What the pointer's hit at a client point is a function of
   * (pointKey). */
  #pointKey(clientX: number, clientY: number, metrics: CellMetrics): unknown[] {
    const { x, y } = this.#gridPoint(clientX, clientY);
    return pointKey(this.#layers, x, y, metrics);
  }

  /** What a pointerdown on a visible gutter bar begins — engine-routed
   * in BOTH modes (the gutter is grid ink; there is no native
   * scrollbar). On the thumb it is a drag, proportional: the draggable
   * track maps onto the scroll range. Beside the thumb it is a page
   * toward the press. */
  #gutterPressAt(clientX: number, clientY: number): ThumbDrag | TrackPress | null {
    const layout = this.#lastLayout;
    const metrics = this.#cellMetrics;
    if (!layout || !metrics || this.#scrollNodes.length === 0) return null;
    const at = this.#cellAt(clientX, clientY, metrics);
    const { col, row } = at;
    const stack = stackAt(layout, at);
    for (let i = stack.length - 1; i >= 0; i--) {
      const node = stack[i]!;
      const range = node.scrollRange;
      if (!range || isInert(node.source)) continue;
      const bars = scrollbarGeometry(node, node.paintOrigin.x, node.paintOrigin.y);
      for (const axis of ["y", "x"] as const) {
        const bar = bars[axis];
        const vertical = axis === "y";
        const max = vertical ? range.maxY : range.maxX;
        if (!bar || max <= 0) continue;
        // The cell's place along the bar, and across it.
        const [along, across] = vertical
          ? [row - bar.row, col - bar.col]
          : [col - bar.col, row - bar.row];
        if (along < 0 || along >= bar.len || across < 0 || across >= bar.thick) continue;
        const el = node.source as HTMLElement;
        const size = vertical ? range.sizeY : range.sizeX;
        const thumb = thumbSpan(bar.len, size, max, node.scroll?.[axis] ?? 0);
        if (along < thumb.at || along >= thumb.at + thumb.len) {
          const direction = along < thumb.at ? -1 : 1;
          return { kind: "track", el, axis, direction, within: along, trackLen: bar.len };
        }
        const cell = vertical ? metrics.height : metrics.width;
        return {
          kind: "thumb",
          el,
          axis,
          startClient: vertical ? clientY : clientX,
          startPx: vertical ? el.scrollTop : el.scrollLeft,
          factor: (max * cell) / Math.max(1, (bar.len - thumb.len) * cell),
        };
      }
    }
    return null;
  }

  /** A page toward the press unless the thumb has reached it; whether it
   * paged. Measured in the grid's cells: the native scrollport counts
   * the glyph border as padding (specs/scrolling.md). */
  #pageTowardPress(press: TrackPress): boolean {
    const metrics = this.#cellMetrics;
    const node = this.#scrollNodeOf(press.el);
    const view = node && clipBounds(node, 0, 0);
    if (!metrics || !node || !view) return false;
    const range = node.scrollRange!;
    const vertical = press.axis === "y";
    const max = vertical ? range.maxY : range.maxX;
    const offset = this.#quantize(node, metrics)[press.axis];
    const thumb = thumbSpan(press.trackLen, vertical ? range.sizeY : range.sizeX, max, offset);
    const beyond =
      press.direction > 0 ? press.within >= thumb.at + thumb.len : press.within < thumb.at;
    if (!beyond) return false;
    const visible = vertical ? view.y1 - view.y0 : view.x1 - view.x0;
    const target = Math.max(0, Math.min(max, offset + press.direction * Math.max(1, visible - 1)));
    if (target === offset) return false;
    const { el } = press;
    const cellSize = vertical ? metrics.height : metrics.width;
    // Instant: the next tick reads where this page landed.
    el.scrollTo({
      [vertical ? "top" : "left"]: nativeOffset(el, press.axis, target, max, cellSize),
      behavior: "instant",
    });
    return true;
  }

  /** Pages once, then keeps paging while the press is held. */
  #startTrackPaging(press: TrackPress): void {
    this.#stopTrackPaging();
    const page = (delay: number): void => {
      if (!this.#pageTowardPress(press)) {
        this.#stopTrackPaging();
        return;
      }
      this.#trackPaging = { press, timer: setTimeout(() => page(TRACK_PAGE_REPEAT_MS), delay) };
    };
    page(TRACK_PAGE_DELAY_MS);
  }

  #stopTrackPaging(settle = true): void {
    if (!this.#trackPaging) return;
    clearTimeout(this.#trackPaging.timer);
    const { el } = this.#trackPaging.press;
    this.#trackPaging = null;
    if (settle) this.#settle(el);
  }

  #onPointerMove = (event: PointerEvent): void => {
    if (isTouchInProgress(event)) return; // see #scheduleDynamicRelayout
    const { clientX, clientY } = event;
    const drag = this.#thumbDrag;
    if (drag) {
      const delta = (drag.axis === "y" ? clientY : clientX) - drag.startClient;
      const target = drag.startPx + delta * drag.factor;
      if (drag.axis === "y") drag.el.scrollTop = target;
      else drag.el.scrollLeft = target;
      return;
    }
    const held = (event.buttons & 1) !== 0;
    // A press begun outside the host may drag a selection into its text
    // mode's light DOM: the native highlight locked before this move's
    // default extends it.
    if (
      held &&
      !this.#pressing &&
      !this.#trackPaging &&
      !this.#selectionGesture &&
      this.getAttribute("select") === "text"
    ) {
      this.#selectionGesture = true;
      this.toggleAttribute(SELECTION, true);
    }
    if (held && this.#gesture) this.#extendGesture(this.#gesture, clientX, clientY);
    if (held && this.#gridDrag) this.#extendGridDrag(this.#gridDrag, clientX, clientY);
    if (held && this.#pressOnGrid && !this.hasAttribute("data-mw-dragging")) {
      this.setAttribute("data-mw-dragging", "");
    }
    this.#hoverClient = { x: clientX, y: clientY };
    this.#hoverTarget = event.target instanceof Element ? event.target : null;
    // High-frequency path: skip the update while the pointer stays in
    // the same cells (state can only change with them — relayouts and
    // scrolls have their own refresh calls).
    const metrics = this.#cellMetrics;
    const key = this.#hoverKey;
    if (metrics && key) {
      const next = this.#pointKey(clientX, clientY, metrics);
      if (next.length === key.length && next.every((part, i) => part === key[i])) return;
    }
    this.#updatePointerStates();
  };

  #onCopy = (event: Event): void => {
    const { clipboardData } = event as ClipboardEvent;
    const layout = this.#lastLayout;
    const range = this.#elementSelection();
    if (!clipboardData || !layout || !range) return;
    clipboardData.setData("text/plain", serializeSelection(layout, range));
    event.preventDefault();
  };

  /** Engine-routed selection gestures: a text-mode press starts a
   * character drag (specs/wide-characters.md); double- and triple-click
   * select the element's word or paragraph in either mode
   * (specs/semantic-selection.md); a plain grid-mode click ends a
   * semantic selection's lift synchronously, ahead of selectionchange. */
  #onMouseDown = (event: Event): void => {
    const e = event as MouseEvent;
    if (e.button !== 0) return;
    const mode = this.getAttribute("select");
    const onGrid = this.#onGrid(e.composedPath());
    // Under a modal dialog the grid is blocked (specs/top-layer.md
    // deviation 7): a press inside the dialog selects as text mode's.
    const asText =
      mode === "text" ||
      (mode === "grid" &&
        !onGrid &&
        e.target instanceof Element &&
        e.target.closest("dialog:modal") !== null);
    if (asText) {
      if (!this.#isTextTarget(e.target)) return;
    } else if (!onGrid && !this.#isPhantomTarget(e.target) && !this.#isCoveredTarget(e)) {
      // The press is a light element's own: it is a pointer target of
      // its own, and the grid shows it where the press landed.
      return;
    }
    const finePointer = this.#lastPointerType === "mouse" || this.#lastPointerType === "pen";
    if (e.detail <= 1) {
      if (e.detail !== 1) return;
      this.removeAttribute(SEMANTIC_SELECTION);
      if (!finePointer) return;
      if (asText) {
        this.#startGesture(e, "character");
        return;
      }
      // A press that moves the focus — off a control inside the host,
      // onto a focus target under the cell — repaints the focus invert
      // (#holdsNativeDrag): taken over like a phantom one, the focus
      // moved as the click would, the drag the engine's.
      const metrics = this.#cellMetrics;
      const at = metrics ? this.#cellAt(e.clientX, e.clientY, metrics) : null;
      const target = at ? this.#focusTargetAt(at) : null;
      if (!onGrid || target || this.#focusedInside()) this.#startGridDrag(e, target);
      return;
    }
    if (finePointer) this.#startGesture(e, e.detail === 2 ? "word" : "paragraph");
  };

  /** A gesture's press: a text-mode one anchors a collapsed range at the
   * character nearest the cell, which the drag extends by character
   * (specs/wide-characters.md "Text-mode drags are routed"); a double-
   * or triple-click selects the word or paragraph under the cell. Shift
   * extends the existing element selection from its anchor instead.
   * Nothing there leaves the press native — the browser's own gesture
   * on a run of glyphs, or the grid line on a triple-click. */
  #startGesture(e: MouseEvent, unit: GestureUnit): void {
    const selection = document.getSelection();
    const layout = this.#lastLayout;
    const metrics = this.#cellMetrics;
    if (!selection || !layout || !metrics) return;
    const at = this.#cellAt(e.clientX, e.clientY, metrics);
    const character = unit === "character";
    const target = character
      ? this.#unitAt(at, unit)
      : this.#unitUnder(layout, at.col, at.row, unit, at.layerRoot);
    if (!target) {
      this.removeAttribute(SEMANTIC_SELECTION);
      this.#gesture = null;
      return;
    }
    e.preventDefault();
    this.#focusAs(this.#focusTargetAt(at));
    if (!character) this.#liftLock(target);
    const anchor: SelectionUnit =
      e.shiftKey && selection.anchorNode && this.#elementSelection()
        ? pointUnit({ node: selection.anchorNode, offset: selection.anchorOffset })
        : character
          ? pointUnit(target.start)
          : target;
    this.#selectThrough(selection, anchor, character && !e.shiftKey ? anchor : target);
    this.#gesture = { unit, anchor };
    this.#startAutoscroll(e);
  }

  /** A gesture's auto-scroll (specs/wide-characters.md "auto-scrolls"):
   * the pointer captured so moves keep coming past the host, and the
   * pressed cell's innermost scroll container — else the innermost
   * native scroller outside the host, else the page — ticked while the
   * press is held. */
  #startAutoscroll(e: MouseEvent): void {
    const layout = this.#lastLayout;
    const metrics = this.#cellMetrics;
    if (!this.#gesture || !layout || !metrics) return;
    this.#stopAutoscroll();
    if (e.isTrusted) this.setPointerCapture(this.#lastPointerId);
    const stack = stackAt(layout, this.#cellAt(e.clientX, e.clientY, metrics));
    let container: HTMLElement | null = null;
    for (let i = stack.length - 1; i >= 0 && !container; i--) {
      const node = stack[i]!;
      if (node.scrollRange && !isInert(node.source)) container = node.source as HTMLElement;
    }
    const outer = this.#outerScrollers[0] as HTMLElement | undefined;
    const el =
      container ??
      outer ??
      ((document.scrollingElement ?? document.documentElement) as HTMLElement);
    const timer = setInterval(() => this.#autoscrollTick(), AUTOSCROLL_TICK_MS);
    this.#autoscroll = { el, page: !container && !outer, timer };
  }

  /** One tick: the cells past the scroller's box toward the pointer
   * (the scrollport for the page), on the axes with room — a scroll
   * container's read from the current layout, as a press relays out. */
  #autoscrollTick(): void {
    const auto = this.#autoscroll;
    const metrics = this.#cellMetrics;
    const at = this.#hoverClient;
    if (!auto || !metrics || !at || !this.#pressing) return;
    const { el, page } = auto;
    const box = page ? new DOMRectReadOnly(0, 0, el.clientWidth, el.clientHeight) : paddingBox(el);
    const step = scrollStep(box, at, metrics);
    const node = this.#scrollNodeOf(el);
    const room = (dx: number, dy: number): boolean =>
      node ? containerHasRoom(node, dx, dy) : hasRoom(el, dx, dy);
    const left = step.x * metrics.width;
    const top = step.y * metrics.height;
    const dx = room(left, 0) ? left : 0;
    const dy = room(0, top) ? top : 0;
    if (dx !== 0 || dy !== 0) this.#scrollRouted(el, dx, dy);
  }

  #stopAutoscroll(): void {
    if (!this.#autoscroll) return;
    clearInterval(this.#autoscroll.timer);
    this.#autoscroll = null;
  }

  /** Content moved under a held gesture — an auto-scroll tick, a wheel
   * mid-drag, the page scrolling: extend it to the unit now under the
   * pointer. */
  #followPointer(): void {
    const gesture = this.#gesture;
    const at = this.#hoverClient;
    if (!gesture || !at || !this.#pressing) return;
    this.#extendGesture(gesture, at.x, at.y);
  }

  /** focus="arrows" (specs/focus-navigation.md): an unmodified arrow on a
   * focused descendant whose control does not own it moves focus to the
   * nearest focusable element beyond that edge and reveals it; nothing
   * beyond leaves the key native (no wrap). */
  #onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;
    this.#lastKeyAt = Date.now();
    if (this.getAttribute("focus") !== "arrows") return;
    const direction = directionOf(e.key);
    if (!direction || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    // A widget that handled the arrow keeps it (specs/focus-navigation.md).
    if (e.defaultPrevented) return;
    const target = e.target;
    if (!(target instanceof Element) || target === this) return;
    if (arrowIsNative(target, e.key, this.#openSelectPicker())) return;
    // A framework's handlers sit at its root (React, Svelte, Solid), past
    // the host: the move waits for the key to reach the window, the last
    // stop of its dispatch, still in time to cancel the native scroll.
    this.#pendingArrow?.abort();
    const pending = new AbortController();
    this.#pendingArrow = pending;
    window.addEventListener(
      "keydown",
      (last) => {
        pending.abort();
        if (last === e && !e.defaultPrevented) this.#moveFocus(e, direction, target);
      },
      { signal: pending.signal },
    );
  };

  /** Focus moved from `target` to the nearest candidate that way
   * (specs/focus-navigation.md), the key cancelled. */
  #moveFocus(e: KeyboardEvent, direction: Direction, target: Element): void {
    const layout = this.#lastLayout;
    if (!layout || !this.isConnected) return;
    const rects = focusableRects(layout);
    const current = extentOf(rects, target);
    if (!current) return;
    const next = nextFocus(
      direction,
      current,
      rects.filter((candidate) => candidate.element !== target),
    );
    if (!next) return;
    e.preventDefault();
    if (this.#keyScroll?.key === e) this.#releaseKeyScroll();
    (next as HTMLElement).focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** A key that scrolls one of the host's containers holds relayouts
   * until that scroll settles: one as its smooth scroll starts cancels
   * it in Firefox and WebKit (specs/scrolling.md "Keyboard
   * scrolling"). */
  #onScrollKey = (event: Event): void => {
    const e = event as KeyboardEvent;
    const step = SCROLL_KEYS[e.key];
    const target = e.target;
    if (!step || !e.isTrusted || e.defaultPrevented || !(target instanceof Element)) return;
    if (controlKeeps(target, e.key)) return;
    const [dx, dy] = e.key === " " && e.shiftKey ? [0, -1] : step;
    // The key scrolls the nearest container with room, as the browsers
    // chain it.
    const scrolls = (el: Element): boolean => {
      const node = this.#scrollNodeOf(el);
      return node !== undefined && containerHasRoom(node, dx, dy);
    };
    let container = target.closest("[data-mw-scroll]");
    while (container && this.contains(container) && !scrolls(container)) {
      container = container.parentElement?.closest("[data-mw-scroll]") ?? null;
    }
    if (!container || !this.contains(container)) return;
    clearTimeout(this.#keyScroll?.timer);
    this.#keyScroll = {
      key: e,
      container,
      scrolled: false,
      deferred: this.#keyScroll?.deferred ?? false,
      timer: setTimeout(() => this.#releaseKeyScroll(), KEY_SCROLL_MS),
    };
    // A handler past the host (a framework's root, the document) may
    // yet cancel the key, which then scrolls nothing.
    setTimeout(() => {
      if (e.defaultPrevented && this.#keyScroll?.key === e) this.#releaseKeyScroll();
    });
  };

  #releaseKeyScroll(): void {
    if (!this.#keyScroll) return;
    const { timer, deferred } = this.#keyScroll;
    clearTimeout(timer);
    this.#keyScroll = null;
    if (deferred && this.isConnected) this.#scheduleLayout();
  }

  /** The focus a click on a cell would move to: the nearest `tabindex`
   * above the element under it — a dialog's content, a menu's, a scroll
   * region. From the cell, since a grid press targets the shadow's
   * grid, retargeted to the host. */
  #focusTargetAt(at: PointerHit): HTMLElement | null {
    const layout = this.#lastLayout;
    const target = layout
      ? chainOf(stackAt(layout, at)).at(-1)?.closest<HTMLElement>("[tabindex]")
      : null;
    return target && this.contains(target) ? target : null;
  }

  /** The focus move a cancelled mousedown skipped: onto the cell's
   * focus target as the click would have, else — or where the target
   * declines, inert or disabled — off a focused control, which would
   * otherwise keep the copy command. */
  #focusAs(target: HTMLElement | null): void {
    target?.focus({ preventScroll: true });
    if (document.activeElement !== target) this.#focusedInside()?.blur();
  }

  /** The focused element, when it is inside the host. */
  #focusedInside(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body && this.contains(active)
      ? active
      : null;
  }

  /** Structural repaints are held while a NATIVE drag may be in flight
   * — a press on the grid the engine has not taken over, whose
   * browser-internal anchor would not survive a rebuild (Chromium
   * collapses it even across a capture and restore); a press on a
   * control is the control's, and an engine-driven grid drag re-derives
   * its points from flat offsets. Style-only paints patch nodes in
   * place, which an anchor survives. */
  #holdsNativeDrag(): boolean {
    return this.#pressing && this.#pressOnGrid && !this.#gridDrag;
  }

  /** A non-interactive light element inside the host: never a legitimate
   * pointer target in grid mode, so an event there is a grid event. */
  #isPhantomTarget(target: EventTarget | null): boolean {
    return target instanceof Element && this.#owns(target) && !target.matches(INTERACTIVE);
  }

  /** A light element another box paints over at the event's cell
   * (specs/cell-model.md "Pointer states"): in grid mode that box is
   * `pointer-events: none`, so the browser's hit test saw through it
   * and found the element underneath — the event belongs to the cell,
   * as a phantom target's does. Only a real pointer hit inside the
   * target's own box is corrected: a script's, a key's (`detail` 0) and
   * a label's click address the element itself, as natively, and a
   * modal dialog's subtree is the light DOM's (specs/top-layer.md
   * deviation 7). */
  #isCoveredTarget(event: Event): boolean {
    const e = event as MouseEvent;
    const target = e.target;
    if (!e.isTrusted || e.detail === 0 || this.getAttribute("select") !== "grid") return false;
    if (!(target instanceof Element) || !this.#owns(target)) return false;
    if (!inBox(target, e.clientX, e.clientY)) return false;
    if (target.closest("dialog:modal")) return false;
    const layout = this.#lastLayout;
    const metrics = this.#cellMetrics;
    if (!layout || !metrics) return false;
    const cell = chainOf(stackAt(layout, this.#cellAt(e.clientX, e.clientY, metrics))).at(-1);
    return cell !== undefined && !showsElement(cell, target, this.#hasBox);
  }

  /** A covered element takes no activation, and no focus from the
   * press — which flows on to the grid's own handling (#onMouseDown
   * takes it like a phantom target's). */
  #onCoveredEvent = (event: Event): void => {
    if (!this.#isCoveredTarget(event)) return;
    event.preventDefault();
    if (event.type !== "mousedown") event.stopPropagation();
  };

  /** An event path through the main grid or a layer's. */
  #onGrid(path: EventTarget[]): boolean {
    return path.includes(this.#grid) || path.includes(this.#layers);
  }

  /** The engine's drag from a press, claimed before the press moves
   * the focus so the move's own relayout (a select's runs at once)
   * paints — no native anchor to hold it for — and anchored after it,
   * on the nodes the grid has then. The drag stays in the grid it
   * started in — a layer's, or the main one (specs/layers.md). */
  #startGridDrag(e: MouseEvent, target: HTMLElement | null): void {
    const metrics = this.#cellMetrics;
    if (!metrics) return;
    const { col, row, grid, x, y } = this.#cellAt(e.clientX, e.clientY, metrics);
    e.preventDefault();
    const anchor = gridOffsetAt(grid, col - x, row - y);
    this.#gridDrag = { anchor, grid, x, y };
    this.#focusAs(target);
    const at = textPositionAt(grid, anchor);
    if (at) document.getSelection()?.setBaseAndExtent(...at, ...at);
  }

  #extendGridDrag(drag: GridDrag, clientX: number, clientY: number): void {
    const metrics = this.#cellMetrics;
    if (!metrics) return;
    const base = textPositionAt(drag.grid, drag.anchor);
    const { col, row } = this.#cellAt(clientX, clientY, metrics);
    const at = textPositionAt(drag.grid, gridOffsetAt(drag.grid, col - drag.x, row - drag.y));
    if (base && at) document.getSelection()?.setBaseAndExtent(...base, ...at);
  }

  /** A drag's extension: the anchor unit through the unit under the
   * pointer (#selectThrough). */
  #extendGesture(gesture: Gesture, clientX: number, clientY: number): void {
    const metrics = this.#cellMetrics;
    const selection = document.getSelection();
    if (!metrics || !selection) return;
    const current = this.#unitAt(this.#cellAt(clientX, clientY, metrics), gesture.unit);
    if (!current || (gesture.extent && sameUnit(gesture.extent, current))) return;
    gesture.extent = current;
    this.#selectThrough(selection, gesture.anchor, current);
  }

  /** Select from the anchor unit through `unit`: the anchor's far edge
   * becomes the base, so the browser's selection direction matches the
   * gesture. Units in different trees pair at light-tree edges. */
  #selectThrough(selection: Selection, anchor: SelectionUnit, unit: SelectionUnit): void {
    // The native highlight locked before a range lands, ahead of the
    // selectionchange a frame may render before.
    const collapsed = sameUnit(anchor, unit) && sameUnit(unit, pointUnit(unit.start));
    if (!collapsed) this.toggleAttribute(SELECTION, true);
    if (sameUnit(anchor, unit)) {
      selectBetween(selection, unit.start, unit.end);
      return;
    }
    const sameTree = anchor.start.node.getRootNode() === unit.start.node.getRootNode();
    const from = sameTree ? anchor : this.#lightEdges(anchor);
    const to = sameTree ? unit : this.#lightEdges(unit);
    const forward =
      comparePoints(from.start.node, from.start.offset, to.start.node, to.start.offset) <= 0;
    if (forward) selectBetween(selection, from.start, to.end);
    else selectBetween(selection, from.end, to.start);
  }

  /** In text mode the light DOM takes pointer events: a press on a
   * non-interactive element, or on the host's own text, is the
   * engine's; a control's is native. */
  #isTextTarget(target: EventTarget | null): boolean {
    if (target === this) return true;
    if (!(target instanceof Element) || !this.contains(target)) return false;
    const interactive = target.closest(INTERACTIVE);
    return !interactive || interactive === this || !this.contains(interactive);
  }

  /** The unit nearest a cell, for a drag's anchor or extent: the
   * character under the cell, or the nearest one's near edge; the
   * nearest word or paragraph whole (the browser's reach over a gap).
   * The innermost box under the cell bounds the search first — a gap
   * between stacked paragraphs reaches them, not a column beside, as
   * a point resolves inside its containing block — then the grid. The
   * search stays in the grid the press is in, a layer's or the main
   * one's (specs/layers.md). */
  #unitAt(at: PointerHit, unit: GestureUnit): SelectionUnit | null {
    const layout = this.#lastLayout;
    if (!layout) return null;
    const grid = { x: 0, y: 0, width: layout.localRect.width, height: layout.localRect.height };
    const c = Math.max(0, Math.min(at.col, grid.width - 1));
    const r = Math.max(0, Math.min(at.row, grid.height - 1));
    const inner = hitStack(layout, c, r, at.layerRoot).at(-1);
    // An inert element's cells are nobody's (the browser ignores the
    // press there too).
    if (inner && isInert(inner.source)) return null;
    const boxes = inner ? [hitRect(inner), grid] : [grid];
    for (const box of boxes) {
      for (const cell of nearestCells(box.width, box.height, c - box.x, r - box.y)) {
        const x = box.x + cell.x;
        const y = box.y + cell.y;
        const { edge } = cell;
        // Only painted glyphs can be neighbors: blank cells cost a lookup,
        // not a hit test (a wide cluster's continuation cell is its
        // cluster's, not blank). The pressed cell itself is always hit
        // tested — a space in a text run is a character.
        const painted = paintedCell(at.grid, x - at.x, y - at.y);
        if (painted === undefined || (painted === " " && edge !== "self")) continue;
        const found = this.#unitUnder(
          layout,
          x,
          y,
          unit,
          at.layerRoot,
          box === grid ? null : inner!,
        );
        if (!found) continue;
        if (edge === "self" || unit !== "character") return found;
        return pointUnit(edge === "start" ? found.start : found.end);
      }
    }
    return null;
  }

  /** The unit of the innermost text leaf under a cell (#leafUnit): null
   * unless a CHARACTER of it is painted there (padding, borders, gaps,
   * and blank tails are the browser's), and outside `within` (a box
   * clipped by its scroll container paints other content past the
   * clip). */
  #unitUnder(
    layout: LayoutNode,
    col: number,
    row: number,
    unit: GestureUnit,
    through: LayoutNode | null,
    within: LayoutNode | null = null,
  ): SelectionUnit | null {
    const stack = hitStack(layout, col, row, through);
    if (within && !stack.includes(within)) return null;
    for (let i = stack.length - 1; i >= 0; i--) {
      const node = stack[i]!;
      // An inert leaf's text is unselectable natively: no unit there.
      if (isTextLeaf(node)) {
        return isInert(node.source) ? null : this.#leafUnit(node, col, row, unit);
      }
    }
    // The host's own text (specs/host-leaf.md): the root leaf lies under
    // every cell no child covers.
    return isTextLeaf(layout) ? this.#leafUnit(layout, col, row, unit) : null;
  }

  /** The character, word, or paragraph of a text leaf at a cell; null
   * off its characters (an inline padding cell is blank for a character).
   * A character is positioned through the leaf's source map or a custom
   * leaf's transcript, a word on a custom leaf is the art's line; either
   * without a position is the leaf's whole contents (#leafContents). */
  #leafUnit(node: LayoutNode, col: number, row: number, unit: GestureUnit): SelectionUnit | null {
    const index = charIndexAtCell(node, node.paintOrigin.x, node.paintOrigin.y, col, row);
    // Hidden text takes no selection gesture, as natively.
    if (index === null || !charVisible(node, index)) return null;
    if (unit === "character" && node.text[index] === INLINE_PAD) return null;
    if (unit === "character") {
      // The cluster's continuation units; a hard break after it is not.
      let end = index + 1;
      while (end < node.text.length && node.advances?.[end] === 0 && node.text[end] !== "\n") end++;
      const start = positionOf(node, index);
      const after = positionOf(node, end);
      if (start && after) return { start, end: after };
    }
    if (unit === "word") {
      // A custom leaf's word is the art's line under the pointer (its
      // glyph runs are not words); a triple-click takes it whole.
      const span = leafRendererFor(node.source.tagName)
        ? hardLineSpans(node.text).find((line) => index >= line.start && index < line.end)
        : wordAt(node, index);
      const start = span && positionOf(node, span.start);
      const end = span && positionOf(node, span.end);
      if (start && end) return { start, end };
    }
    return this.#leafContents(node);
  }

  /** A leaf's whole contents as a unit: its selectionTarget's for a
   * custom leaf, the run's own extent for the root leaf (the host's
   * child list also holds the metrics probe), the element's otherwise. */
  #leafContents(node: LayoutNode): SelectionUnit | null {
    if (node === this.#lastLayout || node.anonymous) return leafExtent(node);
    const container =
      leafRendererFor(node.source.tagName)?.selectionTarget?.(node.source) ?? node.source;
    return {
      start: { node: container, offset: 0 },
      end: { node: container, offset: container.childNodes.length },
    };
  }

  /** A unit inside a custom leaf's shadow, as the light-tree range
   * around its host; a light unit unchanged. The edges sit at the
   * neighbors' content ends rather than on the parent: a point on this
   * host itself comes back from Firefox's getComposedRanges re-expressed
   * inside the shadow slot, which would read as outside the light DOM. */
  #lightEdges(unit: SelectionUnit): SelectionUnit {
    const root = unit.start.node.getRootNode();
    if (!(root instanceof ShadowRoot) || root === this.#grid.getRootNode()) return unit;
    const host = root.host;
    const parent = host.parentNode;
    if (!parent) return unit;
    const index = Array.prototype.indexOf.call(parent.childNodes, host);
    const before = host.previousSibling;
    const after = host.nextSibling;
    return {
      start: isPlainNode(before)
        ? {
            node: before,
            offset: before instanceof Text ? before.length : before.childNodes.length,
          }
        : { node: parent, offset: index },
      end: isPlainNode(after) ? { node: after, offset: 0 } : { node: parent, offset: index + 1 },
    };
  }

  /** Lift the grid-mode lock before the range is set — a forced style
   * resolution on the unit's element, so the range only ever lands in
   * selectable content — the highlight locked in the same resolution. */
  #liftLock(unit: SelectionUnit): void {
    this.setAttribute(SEMANTIC_SELECTION, "");
    this.setAttribute(SELECTION, "");
    const node = unit.start.node;
    const element = node instanceof Element ? node : node.parentElement;
    if (element) void getComputedStyle(element).userSelect;
  }

  /** The document selection when it is a non-collapsed range in this
   * host's light DOM (a custom leaf's shadow selection reads as the
   * light range around its host); null otherwise. */
  #elementSelection(): BoundaryPoints | null {
    const layout = this.#lastLayout;
    const range = selectionRangeThrough(this.#shadow, layout ? leafShadowRoots(layout) : []);
    if (!range || classifySelection(this, this.#grid, range) !== "light") return null;
    const collapsed =
      range.startContainer === range.endContainer && range.startOffset === range.endOffset;
    return collapsed ? null : range;
  }

  /** Whether a live selection reaches the host's light DOM, both ends in
   * it or not — a select-all, a drag in from page text, a script's range
   * across the host — which the highlight lock holds for; a grid drag's
   * is the grid's own. */
  #reachesLight(): boolean {
    if (this.#elementSelection()) return true;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.containsNode(this, true)) return false;
    const range = selectionRangeThrough(this.#shadow);
    return range !== null && classifySelection(this, this.#grid, range) !== "grid";
  }

  /** The lift ends once the selection left the light DOM or collapsed;
   * the grid repaints its highlight (a frame, through #schedulePaint —
   * an unchanged paint costs a comparison of its rows). */
  #onSelectionChange = (): void => {
    const selected = this.#elementSelection() !== null;
    if (this.hasAttribute(SEMANTIC_SELECTION) && !selected) {
      this.removeAttribute(SEMANTIC_SELECTION);
    }
    this.toggleAttribute(SELECTION, selected || this.#selectionGesture || this.#reachesLight());
    // A selection elsewhere in the document is none of this host's
    // business unless it just left it.
    if ((selected || this.#paintedSelection) && this.#lastLayout) this.#schedulePaint();
    this.#paintedSelection = selected;
  };

  /** A selection the user starts in the host's light DOM, or from an
   * ancestor (a select-all): the native highlight is locked before the
   * selection moves, to a press's release, or to the first
   * selectionchange of a key's. The grid and the elements that paint
   * their own selection keep the browser's highlight. */
  #onSelectStart = (event: Event): void => {
    const path = event.composedPath();
    if (this.#onGrid(path)) return;
    const target = event.target;
    if (!path.includes(this) && !(target instanceof Node && target.contains(this))) return;
    const element =
      target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    if (element?.closest(OWN_HIGHLIGHT)) return;
    this.#selectionGesture ||= this.#pressHeld;
    this.toggleAttribute(SELECTION, true);
  };

  /** Paint the grid from `root`: the glyph boxes for this font, the
   * light-DOM selection as inverted cells (#holdsNativeDrag). */
  #paint(root: LayoutNode, placeLayers = true): boolean {
    const range = this.#elementSelection();
    const metrics = this.#cellMetrics;
    return paintGrid(root, this.#grid, {
      holdStructural: this.#holdsNativeDrag(),
      glyphs: this.#glyphs,
      selection: range ? selectedRanges(root, range) : undefined,
      cell: metrics ? { width: metrics.width, height: metrics.height } : undefined,
      layers: this.#layers,
      placeLayers,
      ground: this.#ground,
      ink: this.#ink,
      readColor: this.#readColor,
    });
  }

  /** A color the parser leaves alone, as the probe resolves it; null
   * for none. */
  #readColor = (value: string): Rgba | null => {
    let color = this.#probedColors.get(value);
    if (color === undefined) this.#probedColors.set(value, (color = this.#probeColor(value)));
    return color;
  };

  #probeColor(value: string): Rgba | null {
    const style = this.#colorProbe.style;
    style.outlineColor = "";
    style.outlineColor = value;
    if (style.outlineColor === "") return null;
    return parseColor(this.#colorProbeStyle.outlineColor);
  }

  #onPointerLeave = (): void => {
    this.#hoverClient = null;
    this.#hoverTarget = null;
    this.#updatePointerStates();
  };

  #onPointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary || e.button !== 0) return;
    this.#lastPointerType = e.pointerType;
    this.#lastPointerId = e.pointerId;
    this.#ownsRelease = false;
    // A finger pans natively (styles.css "Touch panning") and must not
    // relayout before release (see #scheduleDynamicRelayout): no thumb
    // drag, no synthesized press.
    if (isTouchInProgress(e)) return;
    const press = this.#gutterPressAt(e.clientX, e.clientY);
    if (press) {
      e.preventDefault();
      // Keep tracking past the host's edge, like a native thumb
      // (synthetic events have no pointer to capture).
      if (e.isTrusted) this.setPointerCapture(e.pointerId);
      if (press.kind === "thumb") this.#thumbDrag = press;
      else this.#startTrackPaging(press);
      return;
    }
    this.#hoverClient = { x: e.clientX, y: e.clientY };
    this.#hoverTarget = e.target instanceof Element ? e.target : null;
    this.#pressing = true;
    this.#pressOnGrid = this.#onGrid(e.composedPath());
    this.#updatePointerStates(true);
  };

  #onAnyPointerDown = ({ isPrimary, button }: PointerEvent): void => {
    if (isPrimary && button === 0) this.#pressHeld = true;
  };

  #onPointerUp = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    this.#pressHeld = false;
    if (this.#selectionGesture) {
      this.#selectionGesture = false;
      this.toggleAttribute(SELECTION, this.#reachesLight());
    }
    this.#ownsRelease = event.type === "pointerup" && this.#gesture !== null;
    this.#gesture = null;
    this.#stopAutoscroll();
    this.#gridDrag = null;
    this.#pressOnGrid = false;
    this.removeAttribute("data-mw-dragging");
    if (this.#trackPaging) {
      this.#stopTrackPaging();
      return;
    }
    if (this.#thumbDrag) {
      // Cleared first: #settle skips the pane of a live drag.
      const { el } = this.#thumbDrag;
      this.#thumbDrag = null;
      this.#settle(el);
      return;
    }
    if (!this.#pressing) return;
    this.#pressing = false;
    this.#pressTarget = null;
    this.#updatePointerStates();
    if (this.#paintHeld) this.#scheduleLayout();
  };

  /** The browser's mouse-up default collapses a selection the press
   * landed in (Chromium, WebKit), which would undo a word or paragraph
   * gesture on release: a press the engine took over is released by
   * the engine too. */
  #onMouseUp = (event: Event): void => {
    if (!this.#ownsRelease) return;
    this.#ownsRelease = false;
    event.preventDefault();
  };

  #onAnyScroll = (event: Event): void => {
    // Container scrolls are #onScroll's: hover refreshes in the paint frame
    // AFTER the offsets sync (a per-event refresh here would read
    // stale offsets), and a container's scroll never moves the grid itself.
    const target = event.target;
    if (target instanceof HTMLElement && target.hasAttribute("data-mw-scroll")) return;
    this.#onGridMoved();
  };

  /** The grid moved in the viewport — the page scrolled, a box around
   * the host changed height, the host's own transform settled: its
   * origin is read afresh, the top layer follows it, and a pointer held
   * still is over other cells. */
  #onGridMoved(): void {
    this.#gridOrigin = null;
    this.#syncTopLayerOrigin();
    if (!this.#hoverClient) return;
    this.#followPointer();
    this.#updatePointerStates();
  }

  /** The light elements the browser hit where the grid shows another
   * box (specs/cell-model.md "Pointer states"), `innermost` the cell's
   * own element: each gives up its pointer events, so the browser
   * hovers it no more than it presses it. A mark lasts no longer than
   * the pointer's stay in that element's box — the browser hits it no
   * more, so nothing else can tell — or a press that never hovered it
   * first would find it deaf. The hit element's ancestors go with it
   * up to the cell's own, since native hover climbs to them; its
   * descendants follow in the stylesheet. */
  #coveredElements(innermost: Element | null): Element[] {
    if (innermost === null) return [];
    const covers = (el: Element): boolean =>
      el.isConnected &&
      !showsElement(innermost, el, this.#hasBox) &&
      this.#underPointer(el) &&
      // Under a modal dialog the light DOM owns the pointer
      // (specs/top-layer.md deviation 7).
      el.closest("dialog:modal") === null;
    const covered = [...this.#covered].filter(covers);
    for (let el = this.#hoverTarget; el && this.#owns(el) && covers(el); el = el.parentElement) {
      if (!covered.includes(el)) covered.push(el);
    }
    return covered;
  }

  /** Whether the pointer lies in an element's own box — how a marked
   * element's cover is judged, the browser hitting it no more. */
  #underPointer(el: Element): boolean {
    const at = this.#hoverClient;
    return at !== null && inBox(el, at.x, at.y);
  }

  /** Recompute both synthesized chains from the stored pointer
   * position and diff them onto the DOM; a change schedules a repaint.
   * `claimPress` (pointerdown only) makes the fresh chain's innermost
   * element the press target before the active chain derives from
   * it. */
  #updatePointerStates(claimPress = false): void {
    const layout = this.#lastLayout;
    const metrics = this.#cellMetrics;
    let chain: Element[] = [];
    if (
      this.#hoverClient &&
      layout &&
      metrics &&
      this.isConnected &&
      this.getAttribute("select") === "grid" &&
      (this.#pressing || MonoWindElement.#hoverCapable?.matches)
    ) {
      const { x, y } = this.#hoverClient;
      this.#hoverKey = this.#pointKey(x, y, metrics);
      chain = chainOf(stackAt(layout, this.#cellAt(x, y, metrics)));
    } else {
      this.#hoverKey = null;
    }
    const innermost = chain.at(-1) ?? null;
    this.#applyChain("data-mw-covered", this.#covered, this.#coveredElements(innermost));
    if (claimPress) this.#pressTarget = innermost;
    // Hover applies only on hover-capable pointers; the press chain
    // exists regardless (touch has :active). Like native :active, the
    // pressed element and its ancestors stay marked while the pointer
    // is over the pressed element, drop when it leaves, return when it
    // re-enters. (Mid-drag hover changes track normally — the paint
    // hold keeps their restyles off the grid until release.)
    const hover = MonoWindElement.#hoverCapable?.matches ? chain : [];
    const pressIndex = this.#pressTarget ? chain.indexOf(this.#pressTarget) : -1;
    const press = pressIndex >= 0 ? chain.slice(0, pressIndex + 1) : [];
    let changed = this.#applyChain("data-mw-hover", this.#hovered, hover);
    changed = this.#applyChain("data-mw-active", this.#pressed, press) || changed;
    // Mirror the hovered cursor onto the grid (the real hit target) —
    // `cursor-pointer` on a click-wired element is invisible otherwise.
    const cursor = innermost ? getComputedStyle(innermost).cursor : "";
    for (const grid of [this.#grid, this.#layers])
      grid.style.cursor = cursor === "auto" ? "" : cursor;
    if (changed && this.isConnected) this.#scheduleLayout();
  }

  #applyChain(attribute: string, previous: Set<Element>, next: Element[]): boolean {
    let changed = false;
    const nextSet = new Set(next);
    for (const el of previous) {
      if (!nextSet.has(el)) {
        el.removeAttribute(attribute);
        changed = true;
      }
    }
    for (const el of nextSet) {
      if (!previous.has(el)) {
        el.setAttribute(attribute, "");
        changed = true;
      }
    }
    previous.clear();
    for (const el of nextSet) previous.add(el);
    return changed;
  }

  #samplingLoopRunning = false;
  /** The animations under the host as the last query found them, which
   * the frames read until a layout's query or an animation's or
   * transition's start brings a new one: an end, a pause, a cancel and
   * a removal show in each one's play state. */
  #animations: readonly Animation[] | null = null;
  /** The light elements the last tick found animating, each with what
   * a frame does for it (specs/animations.md). */
  #animated = new Map<Element, AnimationPath>();
  /** The last layout's nodes by element, built when a frame needs
   * one. */
  #nodes: Map<Element, LayoutNode> | null = null;

  /** An animation on a light element starts the sampling loop, and a
   * layout opens the layer it may need. */
  #onAnimationStart = (event: Event): void => {
    this.#animations = null;
    const el = event.target;
    if (!(el instanceof Element) || !this.#owns(el) || this.#animated.has(el)) return;
    this.#startSamplingLoop();
    this.#scheduleLayout();
  };

  /** An end with no loop running to land it — a resumed one-shot's,
   * which no event announced — lands with a layout; the host's own may
   * have moved the grid. */
  #onAnimationDone = (event: Event): void => {
    const el = event.target;
    if (el === this) this.#onGridMoved();
    else if (el instanceof Element && this.#owns(el) && !this.#samplingLoopRunning) {
      this.#scheduleLayout();
    }
  };

  /** A light element of this host. */
  #owns(el: Element): boolean {
    return el !== this && this.contains(el);
  }

  /** The host's top-layer stack (specs/top-layer.md). */
  #topLayer = new TopLayer();
  /** The cells the reader could see at the last layout, and whether
   * the stack holds an element the UA centers in them. */
  #visibleCells: Rect | null = null;
  #centeredTopLayer = false;

  /** What around the host a layout reads, in one walk of the boxes
   * behind it: the native scrollers a page-owned wheel sequence may
   * still have room in (#outsideCanScroll), the boxes clipping the grid
   * (#visibleCells), the backgrounds the tokens derive from, the host's
   * own first, and the boxes that may be in transition. */
  #readSurroundings(hostStyle: CSSStyleDeclaration): {
    backgrounds: string[];
    transitioning: Element[];
  } {
    this.#outerScrollers = [];
    this.#outerClips = [];
    const page = this.ownerDocument.scrollingElement ?? this.ownerDocument.documentElement;
    const backgrounds = [hostStyle.backgroundColor];
    const transitioning: Element[] = [];
    for (let el = behind(this); el; el = behind(el)) {
      const style = getComputedStyle(el);
      const { overflow } = style;
      if (el === page || /auto|scroll/u.test(overflow)) this.#outerScrollers.push(el);
      // The page's own clip is the window, which #visibleCells starts from.
      if (el !== page && /auto|scroll|hidden|clip/u.test(overflow)) this.#outerClips.push(el);
      backgrounds.push(style.backgroundColor);
      if (mayTransition(style)) transitioning.push(el);
    }
    return { backgrounds, transitioning };
  }

  #awaitColorTransitions(el: Element): void {
    for (const animation of el.getAnimations?.() ?? []) {
      if (!("transitionProperty" in animation) || this.#awaitedTransitions.has(animation)) continue;
      if (!/^(background-)?color$/u.test(animation.transitionProperty as string)) continue;
      this.#awaitedTransitions.add(animation);
      const land = (): void => this.#scheduleLayout();
      animation.finished.then(land, land);
    }
  }

  /** A popover's or a dialog's toggle: an opening into the top layer
   * enters the stack, and either state lays out — nothing else of a
   * popover's opening reaches the observers. */
  #onToggle = (event: Event): void => {
    const el = event.target;
    if (!(el instanceof Element) || !this.#owns(el)) return;
    if (isTopLayer(el)) this.#topLayer.enter(el);
    this.#scheduleLayout();
  };

  get #hostRule(): CSSStyleRule {
    return this.#hostSheet.cssRules[0] as CSSStyleRule;
  }

  /** `--mw-fg`/`--mw-bg` follow the host's own colors (specs/theming.md):
   * its `color`, and its background composited over `backgrounds` down
   * to an opaque one, `canvas` past the root; an outer rule's token
   * still outranks `:host`. */
  #writeTokens(color: string, backgrounds: string[]): void {
    const translucent: Rgba[] = [];
    let background = "canvas";
    for (const each of backgrounds) {
      if (isTransparentColor(each)) continue;
      const parsed = parseColor(each);
      if (!parsed || parsed.a >= 1) {
        background = each;
        break;
      }
      translucent.push(parsed);
    }
    if (translucent.length > 0) {
      const under = background === "canvas" ? this.#colorProbeStyle.borderTopColor : background;
      let composite = parseColor(under);
      if (composite) {
        for (let i = translucent.length - 1; i >= 0; i--) {
          composite = compositeColors(translucent[i]!, composite);
        }
        background = serializeColor(composite);
      }
    }
    setVar(this.#hostRule, "--mw-fg", color);
    setVar(this.#hostRule, "--mw-bg", background);
  }

  /** The ground a selected translucent cell swaps over and the ink of a
   * glyph without a color (specs/cell-model.md "Opacity and
   * translucency"), read back once the style is clean with the
   * contextual colors the probe resolved. */
  #readGround(): void {
    const probe = this.#colorProbeStyle;
    this.#ground = parseColor(probe.backgroundColor) ?? undefined;
    this.#ink = parseColor(probe.color) ?? undefined;
    const probed = this.#probedColors;
    if (probed.size > 256) probed.clear();
    for (const value of probed.keys()) {
      if (CONTEXTUAL_COLOR.test(value)) probed.set(value, this.#probeColor(value));
    }
  }

  /** The cells of the grid its reader can see, where the top layer's
   * UA placement resolves (specs/top-layer.md): the window's box,
   * narrowed by every box that clips the host — the grid is
   * clipped to those too — in whole cells from the grid's rect,
   * clamped to the host by the placement itself. Null where the grid
   * is off-screen, or where the platform measures no window; the
   * host's own box serves then. */
  #measureVisibleCells(metrics: CellMetrics, rect: DOMRect): Rect | null {
    const view = this.ownerDocument.documentElement;
    let right = view.clientWidth;
    let bottom = view.clientHeight;
    if (right <= 0 || bottom <= 0) return null;
    let left = 0;
    let top = 0;
    for (const clip of this.#outerClips) {
      const port = clip.getBoundingClientRect();
      left = Math.max(left, port.left);
      top = Math.max(top, port.top);
      right = Math.min(right, port.right);
      bottom = Math.min(bottom, port.bottom);
    }
    const band = (
      start: number,
      from: number,
      to: number,
      cell: number,
    ): { at: number; span: number } => {
      const first = Math.max(0, Math.ceil((from - start) / cell));
      return { at: first, span: Math.floor((to - start) / cell) - first };
    };
    const x = band(rect.left, left, right, metrics.width);
    const y = band(rect.top, top, bottom, metrics.height);
    if (x.span <= 0 || y.span <= 0) return null;
    return { x: x.at, y: y.at, width: x.span, height: y.span };
  }

  /** The grid's client origin, for the companion to place the top-layer
   * elements' light boxes in the viewport (specs/top-layer.md); current
   * through layouts and page scrolls. */
  #syncTopLayerOrigin(): void {
    if (!this.#lastLayout?.topLayer) return;
    const rect = this.#grid.getBoundingClientRect();
    // The cells the reader sees move with the page under a centered
    // element, which lays out again to follow them — by whole cells,
    // so most scroll frames pass (specs/top-layer.md).
    const metrics = this.#cellMetrics;
    if (
      this.#centeredTopLayer &&
      metrics &&
      !sameRect(this.#measureVisibleCells(metrics, rect), this.#visibleCells)
    ) {
      this.#scheduleLayout();
    }
    setVar(this.#hostRule, "--mw-ox", `${rect.left}px`);
    setVar(this.#hostRule, "--mw-oy", `${rect.top}px`);
  }

  /** `showsElement`'s test, bound for it. */
  #hasBox: HasBox = (el) => this.#nodeOf(el) !== null;

  #nodeOf(el: Element): LayoutNode | null {
    if (!this.#lastLayout) return null;
    this.#nodes ??= nodeIndex(this.#lastLayout);
    return this.#nodes.get(el) ?? null;
  }

  /** A frame of the paint path (specs/animations.md): the elements'
   * live paint-only properties onto their nodes, then the last layout
   * painted again, its layers placed with it. */
  #resampleAndPaint(elements: Iterable<Element>): void {
    const layout = this.#lastLayout;
    if (!layout) return;
    for (const el of elements) {
      const node = this.#nodeOf(el);
      if (node) Object.assign(node.style, readPaintStyle(getComputedStyle(el)));
    }
    this.#paintHeld = !this.#paint(layout);
  }

  #onTransitionRun = ({ propertyName, pseudoElement, target: el }: TransitionEvent): void => {
    this.#animations = null;
    if (!(el instanceof Element)) return;
    if (!transitionSampling(propertyName, el, pseudoElement !== "", this)) return;
    // The layer an effect's frames copy onto: opened by a layout for an
    // element not yet one (an effect a rule outside the host set).
    if (EFFECTS.has(propertyName) && !this.#nodeOf(el)?.style.layer) {
      this.#scheduleLayout();
    }
    this.#startSamplingLoop();
  };

  /** A popover's exit rides a display or overlay transition, whose end
   * lands with a layout (specs/top-layer.md); the host's own ending may
   * have moved the grid. */
  #onTransitionDone = ({ propertyName, target }: TransitionEvent): void => {
    if (propertyName === "display" || propertyName === "overlay") this.#scheduleLayout();
    else if (target === this) this.#onGridMoved();
  };

  #startSamplingLoop(): void {
    if (this.#samplingLoopRunning) return;
    this.#samplingLoopRunning = true;
    /** Whether the last frame read its values through a layout. */
    let relaidOut = false;
    const tick = (time: number): void => {
      const last = this.#animated;
      this.#animated = new Map();
      let relayout = false;
      if (this.isConnected) {
        this.#animations ??= this.getAnimations?.({ subtree: true }) ?? [];
        const running = runningUnder(this, this.#animations);
        for (const [el, properties] of running.elements) {
          const path = animationPath(properties, this.#nodeOf(el));
          if (path) this.#animated.set(el, path);
        }
        relayout = running.relayout;
      }
      const paths = new Set(this.#animated.values());
      const sampled = relayout || paths.has("layout") || hasSynthesizedTransitions();
      if (!this.isConnected || (!sampled && this.#animated.size === 0)) {
        this.#samplingLoopRunning = false;
        // One final settle pass so the grid lands exactly on the
        // transitions' target values and an animation's end state.
        this.#scheduleLayout();
        return;
      }
      // What the last frame showed lands in this one by the same path:
      // a layout reads every value, a repaint what its elements paint,
      // and a layer's box is placed every frame.
      const landing = relaidOut;
      relaidOut = sampled;
      const repainted = new Set<Element>();
      for (const [el, path] of [...last, ...this.#animated]) {
        if (path === "paint" && el.isConnected) repainted.add(el);
      }
      // A layout this frame read every value already.
      if (time !== this.#laidOutFrame) {
        if (sampled || landing) {
          // Held under a key's scroll like any relayout (#onScrollKey).
          if (this.#keyScroll) this.#keyScroll.deferred = true;
          else this.#performLayoutSafely();
        } else if (repainted.size > 0) this.#resampleAndPaint(repainted);
        else syncLayers(this.#layers);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  #scheduleDynamicRelayout = (event: Event): void => {
    // A touch must not relayout before it is released: iOS decides
    // which scroller owns a pan in the first frames, and a relayout
    // reflows the light DOM under the finger, which abandons the pan
    // to the page. Touch has no hover to reflect, and the release
    // relayout picks up the tap's outcome.
    if (isTouchInProgress(event)) return;
    // Only an activating key changes what the grid shows (`:active`);
    // every other keyboard outcome arrives as its own event — input,
    // change, focus, scroll — and a relayout under a scrolling key
    // cancels the smooth scroll it starts (#onScrollKey). Space on a
    // focused scroll container pages it.
    if (event.type === "keydown" || event.type === "keyup") {
      const { key, target } = event as KeyboardEvent;
      const scrolls = target instanceof Element && target.hasAttribute("data-mw-scroll");
      if (key !== "Enter" && (key !== " " || scrolls)) return;
    }
    // Focus moving onto or off a <select> lays out in the event's
    // dispatch: the click's default opens the picker next, which holds
    // relayouts (#openSelectPicker), and the focus invert would stay
    // stale under it.
    if (
      (event.type === "focusin" || event.type === "focusout") &&
      event.target instanceof HTMLSelectElement
    ) {
      this.#performLayoutSafely();
      return;
    }
    this.#scheduleLayout();
  };

  attributeChangedCallback(name: string, _previous: string | null, next: string | null): void {
    const [initial, other] = HOST_KEYWORDS[name as keyof typeof HOST_KEYWORDS];
    if (next !== initial && next !== other) {
      if (next !== null) {
        console.warn(
          `[monowind] Ignoring unrecognized ${name}="${next}". Expected "${initial}" (default) or "${other}".`,
          warnSubject(this),
        );
      }
      this.setAttribute(name, initial);
      return;
    }
    // focus is keyboard-only: no layout depends on it.
    if (name === "focus") return;
    // select="text" hands pointer events back to the light DOM — the
    // synthesized chains must not double up with the native states.
    this.#updatePointerStates();
    this.#scheduleLayout();
  }

  /** The current render as plain text — the same deterministic mirror
   * the golden tests diff (borders as box-drawing glyphs, text on its
   * grid rows, interior whitespace real, row ends trimmed). Flushes a
   * pending layout so the snapshot is current; empty before the first
   * layout or when the host has no laid-out content. */
  toPlainText(): string {
    // The layout takes the queued frame's place.
    if (this.#layoutPending || this.#keyScroll?.deferred) {
      this.#performLayout();
      if (this.#keyScroll) this.#keyScroll.deferred = false;
    }
    return this.#lastLayout ? renderPlainText(this.#lastLayout) : "";
  }

  #onWindowResize = (): void => {
    this.#scheduleLayout();
  };

  #onFontsLoaded = (): void => {
    // Defer a frame: rAF callbacks run BEFORE the style recalc that
    // applies a freshly loaded font, so an immediate layout could measure
    // the PRE-swap fallback metrics when the event and the swap land in
    // the same frame. One frame later the swap has rendered;
    // #scheduleLayout adds its own rAF.
    // The glyph boxes measured under the fallback go with it, and a
    // layout follows only where the cell or a cached glyph measures
    // differently: fonts settle on every page.
    requestAnimationFrame(() => {
      const generation = this.#glyphs.generation;
      this.#glyphs.invalidate();
      if (this.#glyphs.generation !== generation || this.#cellChanged()) this.#scheduleLayout();
    });
  };

  /** True while a focused in-host <select> has its picker open
   * (`:open`), which a relayout's style churn dismisses in Chromium
   * (specs/cell-model.md, the held relayouts). */
  #openSelectPicker(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLSelectElement) || !this.contains(active)) return false;
    try {
      return active.matches(":open");
    } catch {
      return false;
    }
  }

  #performLayoutSafely(): void {
    try {
      this.#performLayout();
    } catch (err) {
      console.error("[monowind] layout failed:", err);
    }
  }

  #scheduleLayout(): void {
    if (this.#layoutPending || this.#nested) return;
    this.#layoutPending = true;
    this.#layoutRequest = requestAnimationFrame((time) => {
      this.#layoutPending = false;
      // Hold the relayout while a select picker is up — re-arm so it
      // runs the frame after the picker closes (change or dismiss).
      if (this.#openSelectPicker()) {
        this.#scheduleLayout();
        return;
      }
      // A key's scroll in flight holds it until the scroll settles
      // (#onScrollKey); the paint it would have made follows the scroll.
      if (this.#keyScroll) {
        this.#keyScroll.deferred = true;
        this.#schedulePaint();
        return;
      }
      this.#laidOutFrame = time;
      this.#performLayoutSafely();
    });
  }

  /** A `visibility` fade-out under the host keeps its element visible to
   * the read until it would have ended, and a layout then reads it
   * hidden: the measuring mask cancels the transition, which CSS shows
   * throughout (specs/visibility.md). Found before the mask goes on,
   * where the author's transitions run. */
  #holdFades(animations: readonly Animation[]): void {
    if (!this.hasAttribute("data-mw-ready") || typeof CSSTransition === "undefined") return;
    const now = performance.now();
    for (const animation of animations) {
      if (!(animation instanceof CSSTransition) || animation.transitionProperty !== "visibility") {
        continue;
      }
      const effect = animation.effect as KeyframeEffect | null;
      const end = effect?.getComputedTiming().endTime;
      const target = effect?.target;
      if (!target || effect.pseudoElement !== null || typeof end !== "number") continue;
      // A fade-in shows from its start: its cancel changes nothing.
      const frames = effect.getKeyframes();
      if (frames[0]?.["visibility"] !== "visible" || frames.at(-1)?.["visibility"] === "visible") {
        continue;
      }
      const until = now + end - Number(animation.currentTime ?? 0);
      // What inherits the element's visibility fades with it.
      for (const element of [target, ...target.querySelectorAll("*")]) {
        if (getComputedStyle(element).visibility === "visible") holdVisible(element, until);
      }
      this.#layoutAfter(until);
    }
  }

  /** A layout once the clock has passed `until`: a timer's delay is
   * whole milliseconds, and a layout before then would still read the
   * hold. */
  #layoutAfter(until: number): void {
    const left = until - performance.now();
    if (left <= 0) this.#scheduleLayout();
    else setTimeout(() => this.#layoutAfter(until), Math.ceil(left));
  }

  #performLayout(): void {
    // Any layout serves a pending one: it reads everything as it is.
    if (this.#layoutPending) {
      this.#layoutPending = false;
      cancelAnimationFrame(this.#layoutRequest);
    }
    // A queued frame can outlive the host's removal (story/app teardown,
    // SPA navigation): computed styles on a detached tree read as empty
    // strings, which would misclassify every element and misfire author
    // warnings. Reconnection schedules a fresh layout. A nested host
    // drops the frame an attribute queued before it connected.
    if (!this.isConnected || this.#nested) return;
    // A host in no box (inside `display: none`) lays nothing out: its
    // resize lays it out once it shows.
    if (this.checkVisibility?.() === false) {
      this.#laidOutSize = null;
      return;
    }
    // Container positions are read before the mask and written back after
    // it (specs/scrolling.md); bottom-stick resolves in between.
    const scrollState = this.#captureScrollState();
    // Each textarea's content width in cells, read before the mask takes
    // the engine's width rule off it: the tree wraps its value at that
    // width.
    const textareaWidths: TextareaWidths = new Map();
    const textareas = this.querySelectorAll<HTMLTextAreaElement>("textarea");
    const hostStyle = getComputedStyle(this);
    const cellWidth = hostStyle.getPropertyValue("--mw-cw").trim();
    const cellWidthPx = parseFloat(cellWidth);
    if (Number.isFinite(cellWidthPx) && cellWidthPx > 0) {
      for (const textarea of textareas) {
        const style = getComputedStyle(textarea);
        const contentPx = textarea.clientWidth - pxSum(style, "padding-left", "padding-right");
        // `round` (not `floor`) so subpixel remainders don't chop one
        // cell off the width — the browser rarely wraps a character
        // that fits within half a cell of the edge.
        textareaWidths.set(textarea, Math.max(0, Math.round(contentPx / cellWidthPx)));
      }
    }
    // What runs under the host, asked once for the pass
    // (specs/animations.md): the fades it holds, the layers its reads
    // keep, and the sampling it starts. The mask keeps every animation
    // the reads take, so the answer before it serves under it.
    const animations = this.getAnimations?.({ subtree: true }) ?? [];
    this.#animations = animations;
    const running = runningUnder(this, animations);
    // The write phase is bracketed by the `measuring` attribute and each
    // light element's flag (they gate the companion stylesheet so reads
    // see authored values). Everything the
    // engine writes to the light DOM — geometry vars, data-mw-* attributes
    // — happens synchronously in here, so the synchronous takeRecords() in
    // `finally` drains exactly our own mutation records. Observation
    // resumes the moment #performLayout returns: a user mutation in the
    // same task (right after a layout) is seen normally.
    this.#holdFades(animations);
    this.setAttribute("measuring", "");
    let gated: Iterable<Element> = [];
    // What the settling round masks (see finally): unknown until the
    // reads, every element then.
    let settling: { host: boolean; elements: Set<Element> } | null = null;
    const outerReading = readingAnimations(running);
    try {
      // The host's colors and what lies behind it, read under the host's
      // mask alone — which ends a transition of its background, the
      // tokens taking the value it lands on — and the tokens written
      // before the elements' flags: one style resolution serves both.
      const { backgrounds, transitioning } = this.#readSurroundings(hostStyle);
      this.#writeTokens(hostStyle.color, backgrounds);
      for (const el of transitioning) this.#awaitColorTransitions(el);
      // A flag per element, so a flip restyles that element alone
      // (styles.css "Typography locks and measuring gates"). The
      // interactivity marks go on before the read, which the focus
      // invert's exclusion shapes.
      gated = this.querySelectorAll("*");
      for (const el of gated) {
        el.setAttribute("data-mw-measuring", "");
        markInteractivity(el);
      }
      // (1) Cell metrics, from the persistent probe each layout; an
      // innerHTML swap detaches it, so re-adopt it (a detached probe
      // measures 0×0).
      if (this.#probe.parentNode !== this) this.appendChild(this.#probe);
      const metrics = measureCellMetrics(this, this.#probe);
      // A cell of no size (a zero font; a host in no box, to an engine
      // without checkVisibility) lays nothing out.
      if (!(metrics.width > 0 && metrics.height > 0)) {
        this.#laidOutSize = null;
        return;
      }
      const previous = this.#cellMetrics;
      if (previous === null || !sameMetrics(previous, metrics)) {
        this.style.setProperty("--mw-cw", `${metrics.width}px`);
        this.style.setProperty("--mw-ch", `${metrics.height}px`);
        this.style.setProperty("--mw-rls", `${metrics.letterSpacing}px`);
        this.style.setProperty("--mw-overhang", `${metrics.inkOverhang ?? 0}px`);
        // A whole pixel: Chromium snaps an inline box's fractional padding
        // and drags its text a pixel with it.
        const bgpad = Math.ceil((metrics.backgroundGap ?? 0) / 2);
        this.style.setProperty("--mw-bgpad", `${bgpad}px`);
        this.toggleAttribute("data-mw-bgpad", bgpad > 0);
        this.style.setProperty("--mw-base", `${metrics.baseline ?? 0}px`);
        // Rows cannot grow (specs/wide-characters.md): a fallback font's
        // taller line box stays inside the measured cell.
        for (const grid of [this.#grid, this.#layers]) {
          grid.style.lineHeight = `${metrics.height}px`;
          grid.style.letterSpacing = `${metrics.gridLetterSpacing ?? metrics.letterSpacing}px`;
        }
      }
      this.#cellMetrics = metrics;
      const gridStyle = getComputedStyle(this.#grid);
      this.#glyphs.configure(
        {
          style: gridStyle.fontStyle,
          weight: gridStyle.fontWeight,
          size: gridStyle.fontSize,
          family: gridStyle.fontFamily,
        },
        {
          width: metrics.width,
          height: metrics.height,
          letterSpacing: metrics.gridLetterSpacing ?? metrics.letterSpacing,
          ...(metrics.baseline === undefined ? {} : { baseline: metrics.baseline }),
        },
      );
      this.#readGround();

      // (2) Available cells from the host's CONTENT box — authored padding
      // on the host stays outside the grid (the shadow slot box, which
      // laid-out children position against, already sits inside it).
      // clientWidth excludes the border; subtract the padding ourselves.
      const padX = pxSum(hostStyle, "padding-left", "padding-right");
      const availableCols = Math.max(0, Math.floor((this.clientWidth - padX) / metrics.width));
      if (!(availableCols > 0)) {
        this.#laidOutSize = null;
        return;
      }
      // The cells the reader can see, where the top layer's UA
      // placement resolves (specs/top-layer.md). Read here, beside the
      // host's own box, so it costs no layout of its own.
      this.#visibleCells = this.#measureVisibleCells(metrics, this.#grid.getBoundingClientRect());

      // (3) Build a tree from the light DOM: the host's own inline
      // content is the root leaf (specs/host-leaf.md); with a block-level
      // child the root is a virtual container over its child nodes, the
      // host's own text as anonymous runs.
      let virtualRoot = buildRoot(this, getRootFontSizePx(), metrics, textareaWidths);
      if (this.#scopeAnchors(virtualRoot)) {
        virtualRoot = buildRoot(this, getRootFontSizePx(), metrics, textareaWidths);
      }
      // Found while the reads leave the style clean.
      settling = { host: mayTransition(hostStyle), elements: new Set() };
      for (const el of gated) if (mayTransition(getComputedStyle(el))) settling.elements.add(el);

      // (4) Compute integer layout, and the top-layer stack over it.
      if (this.#visibleCells) virtualRoot.visibleCells = this.#visibleCells;
      const { height } = layoutRoot(
        virtualRoot,
        availableCols,
        (node) => this.#syncScrollOffsets(metrics, scrollState, collectScrollContainers(node)),
        this.#placements,
      );
      this.#scrollNodes = collectScrollContainers(virtualRoot);
      this.#topLayer.assign(virtualRoot);
      // A stack element the UA centers follows the cells the reader
      // sees; an anchored one follows its anchor, which the host moves.
      this.#centeredTopLayer =
        virtualRoot.topLayer?.some((entry) => !entry.node.style.positionArea) ?? false;

      // (5) Write geometry to light DOM + paint the shadow grid. Do this
      // before clearing the measuring attribute so the browser only
      // paints the final state.
      render(virtualRoot);
      // The layers' boxes are placed after the settle below: their
      // roots' effects read as the light elements finally sit.
      this.#paintHeld = !this.#paint(virtualRoot, false);
      this.#lastLayout = virtualRoot;
      this.#nodes = null;
      if (textareas.length > 0 && this.#rewrapsTextareas(textareas, textareaWidths)) {
        this.#scheduleLayout();
      }
      // The grid box is the ink extent in engine cells: a glyph a
      // fallback font draws wider still overhangs as ink, but the box
      // (and the background it inherits) never grows from it.
      const gridWidth = `${virtualRoot.localRect.width * metrics.width}px`;
      const gridHeight = `${virtualRoot.localRect.height * metrics.height}px`;
      if (this.#grid.style.width !== gridWidth) this.#grid.style.width = gridWidth;
      if (this.#grid.style.height !== gridHeight) this.#grid.style.height = gridHeight;

      // (6) Size the host to match content rows (content-driven height).
      // Under border-box (Tailwind's preflight default) the height must
      // also cover the host's own padding and border.
      const chrome =
        hostStyle.boxSizing === "border-box"
          ? pxSum(
              hostStyle,
              "padding-top",
              "padding-bottom",
              "border-top-width",
              "border-bottom-width",
            )
          : 0;
      const hostHeight = `${height * metrics.height + chrome}px`;
      if (this.style.height !== hostHeight) this.style.height = hostHeight;
      // Cap the width to the columns laid out (specs/cell-model.md "Host
      // sizing"); the companion applies it outside measuring.
      const chromeX =
        hostStyle.boxSizing === "border-box"
          ? padX + pxSum(hostStyle, "border-left-width", "border-right-width")
          : 0;
      setVar(this, "--mw-host-w", `${availableCols * metrics.width + chromeX}px`);
      this.#laidOutSize = { width: availableCols * metrics.width, height: height * metrics.height };

      // (7) Reveal the host now that layout is done — kills the FOUC where
      // the browser paints raw flex/block layout before the engine runs.
      if (!this.hasAttribute("data-mw-ready")) this.setAttribute("data-mw-ready", "");
    } finally {
      readingAnimations(outerReading);
      // Snap back under [settling] with one forced flush (styles.css
      // "Lock toggles must never…"): every flag drops before it, so a
      // settling element snaps against its parent's locks.
      const settles = settling ?? { host: true, elements: new Set(gated) };
      if (settles.host) this.setAttribute("settling", "");
      this.removeAttribute("measuring");
      for (const el of gated) {
        if (settles.elements.has(el)) el.setAttribute("data-mw-settling", "");
        el.removeAttribute("data-mw-measuring");
      }
      if (settles.host || settles.elements.size > 0) void getComputedStyle(this).transitionProperty;
      if (settles.host) this.removeAttribute("settling");
      for (const el of settles.elements) el.removeAttribute("data-mw-settling");
      syncLayers(this.#layers);
      // Restore native container positions AFTER the unmask — the browser
      // re-clamps them when the mask lifts (Firefox lazily), so any
      // earlier write gets wiped. The grid already painted from the
      // same snapshot; a changed native position fires its scroll
      // event into a same-cell repaint.
      this.#restoreScrollPositions(scrollState);
      // Drain the records our own writes queued (takeRecords is
      // synchronous). Deferring this to a microtask would open a window
      // where a USER mutation gets dropped with the engine's own.
      this.#mutationObserver?.takeRecords();
      // What the pass found running is sampled: an animation resumed,
      // or begun before this host listened (specs/animations.md).
      if (running.relayout || running.elements.size > 0) this.#startSamplingLoop();
      // Synthesized transitions (animate.ts): background changes the
      // read detected arm HERE, outside the masks, where the authored
      // `transition-property` list is readable — then the sampling loop
      // drives the fade. A pending change that did NOT arm was painted
      // stale this pass; one more relayout paints its target.
      if (resolvePendingTransitions(this)) {
        if (hasSynthesizedTransitions()) this.#startSamplingLoop();
        else this.#scheduleLayout();
      }
      // The resize signals a capped host needs, outside the mask so the
      // reads are authored values.
      this.#observeSurroundings();
      // The layout may have moved content under a stationary pointer —
      // re-derive the synthesized pointer states (cheap when nothing
      // changed; a chain change coalesces into the next frame).
      this.#gridOrigin = null;
      this.#syncTopLayerOrigin();
      this.#followContainerScroll();
      if (this.#hoverClient) this.#updatePointerStates();
    }
  }
}

/** Register the <mono-wind> element (idempotent; no-op without a DOM, so
 * calling it from code that also runs server-side is safe). */
export function defineMonoWind(): void {
  if (typeof customElements === "undefined") return;
  if (customElements.get("mono-wind")) return;
  customElements.define("mono-wind", MonoWindElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "mono-wind": MonoWindElement;
  }
}

/** Pre-layout native container positions, by element (specs/scrolling.md):
 * px and the native max, the cells they meant under the OLD range, and
 * end pins. */
type ScrollSnapshot = Map<
  HTMLElement,
  {
    top: number;
    left: number;
    maxTop: number;
    maxLeft: number;
    x: number;
    y: number;
    pinX: boolean;
    pinY: boolean;
  }
>;

interface WheelLatch {
  /** The latched scroll container; null = the page. */
  el: HTMLElement | null;
  x: number;
  y: number;
  /** The gesture's dominant axis at its start. */
  axis: "x" | "y";
  at: number;
  /** Last tick's |delta| and how many ticks it has decayed smoothly
   * (sticky once INERTIA_TICKS confirm momentum). */
  mag: number;
  decayed: number;
}

/** A box's size in px. */
interface BoxSize {
  width: number;
  height: number;
}

/** An in-flight scrollbar-thumb drag (specs/scrolling.md). */
interface ThumbDrag {
  kind: "thumb";
  el: HTMLElement;
  axis: "x" | "y";
  startClient: number;
  startPx: number;
  factor: number;
}

/** A press on the track beside the thumb: pages toward it while held,
 * until the thumb the grid shows reaches the pressed cell
 * (specs/scrolling.md). `within` is that cell, counted from the
 * track's start. */
interface TrackPress {
  kind: "track";
  el: HTMLElement;
  axis: "x" | "y";
  direction: 1 | -1;
  within: number;
  trackLen: number;
}

/** A container's native scroll ceiling on one axis. */
function nativeCeiling(el: HTMLElement, axis: "x" | "y"): number {
  return axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
}

/** The native position of a cell offset: at max, the native ceiling,
 * a rounding pixel either side of max cells (see quantizeScroll). */
function nativeOffset(
  el: HTMLElement,
  axis: "x" | "y",
  cells: number,
  max: number,
  cellSize: number,
): number {
  return cells === max ? nativeCeiling(el, axis) : cells * cellSize;
}

/** A container's native position on one axis, in cells (see
 * quantizeScroll). */
function scrollCells(
  el: HTMLElement,
  axis: "x" | "y",
  cellSize: number,
  max: number,
  base: number,
): number {
  const px = axis === "y" ? el.scrollTop : el.scrollLeft;
  return quantizeScroll(px, nativeCeiling(el, axis), cellSize, max, base);
}

/** Native scroll position → whole-cell offset within the engine's
 * range (specs/scrolling.md). Within half a cell of `base` (the last
 * painted offset) the shown cell stays — a wobble never flips it;
 * beyond that, the NEAREST cell, ties away from `base`, so a keyboard
 * step of two and a half cells moves three in either direction. At
 * the native `ceiling` the container IS at max: the spacer ends at the
 * engine's edge, but scrollHeight and clientHeight round
 * independently, so the ceiling can sit a pixel either side of the
 * multiple. (A container still at 0 never reads as "at max", whatever
 * its ceiling — the spacer may not have applied yet.) */
export function quantizeScroll(
  px: number,
  ceiling: number,
  cellSize: number,
  max: number,
  base: number,
): number {
  if (max > 0 && px > 0 && px >= ceiling - 1) return max;
  const delta = px / cellSize - base;
  const cells =
    Math.abs(delta) <= 0.5 ? base : base + Math.sign(delta) * Math.round(Math.abs(delta));
  return Math.min(Math.max(0, cells), max);
}

/** A touch pointer that has not been lifted — the phase in which the
 * engine must not reflow anything (see #scheduleDynamicRelayout).
 * `pointercancel` counts as in progress: iOS fires it the moment it
 * takes the pan, and a relayout there kills the gesture. */
function isTouchInProgress(event: Event): boolean {
  return (
    event instanceof PointerEvent && event.pointerType === "touch" && event.type !== "pointerup"
  );
}

/** A light node that can hold a boundary point of its own: anything
 * but another shadow host. */
function isPlainNode(node: Node | null): node is Node {
  return node !== null && !(node instanceof Element && node.shadowRoot);
}

/** A collapsed unit — an existing selection's anchor, for Shift. */
function pointUnit(point: Point): SelectionUnit {
  return { start: point, end: point };
}

function selectBetween(selection: Selection, base: Point, extent: Point): void {
  selection.setBaseAndExtent(base.node, base.offset, extent.node, extent.offset);
}

function sameUnit(a: SelectionUnit, b: SelectionUnit): boolean {
  return (
    a.start.node === b.start.node &&
    a.start.offset === b.start.offset &&
    a.end.node === b.end.node &&
    a.end.offset === b.end.offset
  );
}

function collectScrollContainers(root: LayoutNode): LayoutNode[] {
  const out: LayoutNode[] = [];
  const visit = (node: LayoutNode): void => {
    if (node.scrollRange) out.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}
