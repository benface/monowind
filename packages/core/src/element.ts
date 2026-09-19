import { hasSynthesizedTransitions, resolvePendingTransitions } from "./animate.ts";
import { animatedProperties, animationPath, drainAnimated, nodeIndex } from "./animation.ts";
import type { AnimationPath } from "./animation.ts";
import { isTransparentColor, readPaintStyle } from "./style.ts";
import { onGlyphRegistryChange } from "./glyphs.ts";
import { leafRendererFor, onLeafRegistryChange } from "./leaf.ts";
import { rendersAttribute } from "./observed.ts";
import { arrowIsNative, directionOf, extentOf, focusableRects, nextFocus } from "./focus.ts";
import { hitChain, hitRect, hitStack, isInert, nearestCells, scrollStep } from "./pointer.ts";
import { charIndexAtCell, renderPlainText, scrollbarGeometry, thumbSpan } from "./plain-text.ts";
import {
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
import { GlyphBoxes } from "./glyph-box.ts";
import { hardLineSpans, INLINE_PAD } from "./wrap.ts";
import { gridOffsetAt, layerAt, layerGridAt, paintedCell, paintGrid, syncLayers } from "./paint.ts";
import type { CellHit } from "./paint.ts";
import { getRootFontSizePx, measureCellMetrics } from "./metrics.ts";
import { layoutRoot } from "./layout.ts";
import { render, syncStickyVars } from "./render.ts";
import { applyStickyShifts, collectStickyBoxes } from "./sticky.ts";
import { TopLayer, isTopLayer } from "./top-layer.ts";
import type { StickyBox } from "./sticky.ts";
import { buildChildren, buildRootLeaf, hostLeafStyle } from "./tree.ts";
import type { TextareaWidths } from "./tree.ts";
import { zeroInsets } from "./types.ts";
import { warnOnce, warnSubject } from "./warn.ts";
import type { CellMetrics, LayoutNode } from "./types.ts";

const SHADOW_TEMPLATE = `
<style>
  :host { display: block; position: relative; contain: layout style; }
  #viewport { position: relative; width: 100%; height: 100%; background: inherit; }
  /* The slot as a positioned box: the light DOM paints ABOVE the grid
   * (the elements are absolute; the host's own in-flow text, specs/host-leaf.md,
   * would otherwise sit under the <pre> and lose its selection ink) and
   * laid-out elements position against it — the same origin as #viewport.
   * A block formatting context, so a flow child's top margin
   * (specs/cell-model.md "Inline content") stays inside it, where the
   * engine put the child. */
  slot { display: flow-root; position: relative; }
  /* The unified grid: one <pre> with same-paint-run spans, cell-precise
   * (one monospace character = one cell). In select="grid" (the
   * default, reflected onto the attribute — see DEFAULT_SELECT) the
   * grid catches drags for native selection of the ASCII; interactive
   * elements opt back into pointer-events via styles.css so clicks
   * still work. In select="text" the grid is inert to events and drag
   * selects the light DOM natively. */
  /* Sized by the engine's ink extent (element.ts), not the host box:
   * visible overflow paints past the host (specs/cell-model.md
   * "Overflow"), and the host's background follows it there — the
   * host is the canvas, as the root element's background covers a
   * document's overflow — inherited through #viewport, the shadow
   * parent. (A translucent host background paints repeatedly inside
   * the box.) */
  /* The text-fill reset: the host's own invisibility lock (specs/host-leaf.md)
   * inherits across the shadow boundary; currentColor stays a keyword
   * at computed time, so every run keeps its own color. */
  .grid { position: absolute; top: 0; left: 0; margin: 0; background: inherit; font: inherit; line-height: inherit; letter-spacing: inherit; white-space: pre; pointer-events: none; user-select: none; -webkit-user-select: none; -webkit-text-fill-color: currentColor; }
  /* A layer (specs/layers.md): a box at the extent carrying the root's
   * transform and filter, its grid transparent where the subtree
   * painted nothing; a nested box sits in its parent's, a clipped one
   * in a clipping box at its ancestors' clip. */
  #layers, .layer, .clip, .backdrop { position: absolute; top: 0; left: 0; pointer-events: none; }
  .clip { overflow: clip; }
  .layer > .grid { background: transparent; }
  /* A background reaches the row's edges: the host's measured half-gap
   * between the line box and the font's content area, which an inline
   * span paints without moving the line (specs/cell-model.md). */
  .grid span { padding-block: var(--mw-bgpad, 0px); }
  /* A shade's lattice runs on from row to row (specs/wide-characters.md):
   * copies a period above and below the glyph, in its own line box. */
  .grid span[data-shade] { position: relative; }
  .grid span[data-shade]::before, .grid span[data-shade]::after { content: attr(data-shade); position: absolute; inset-inline: 0; }
  .grid span[data-shade]::before { top: calc(-1 * var(--mw-period)); }
  .grid span[data-shade]::after { top: var(--mw-period); }
  :host([select="grid"]) .grid { pointer-events: auto; user-select: text; -webkit-user-select: text; }
  /* A grid-mode drag stays in the grid it started in, where the engine
   * supports it (specs/layers.md, deviations 3 and 8). */
  :host([select="grid"]) .layer > .grid { user-select: contain; -webkit-user-select: contain; }
  :host([select="grid"]) slot { pointer-events: none; user-select: none; -webkit-user-select: none; }
  /* A live semantic selection (specs/semantic-selection.md) lifts the
   * lock so the element selection copies; pointer events stay off. */
  :host([select="grid"][data-mw-semantic-selection]) slot { user-select: text; -webkit-user-select: text; }
  /* The grid's own selection (a grid-mode drag) keeps the browser's
   * invert — mirror of the field choices in styles.css. Slotted text
   * takes the slot's rule in Chromium and WebKit: invisible, the engine
   * paints that selection on the grid (specs/wide-characters.md). */
  .grid::selection, .grid *::selection { color: var(--mw-bg, canvas); text-shadow: 0 0 0 var(--mw-bg, canvas); background: var(--mw-fg, canvastext); }
  slot::selection { color: transparent; text-shadow: none; background: transparent; }
</style>
<div id="viewport">
  <pre id="grid" class="grid" aria-hidden="true"></pre>
  <div id="layers"></div>
  <slot></slot>
</div>
`;

/** The `select` attribute's default, reflected onto the attribute when
 * it is absent or unrecognized so every stylesheet keys on an explicit
 * value — the single place the default lives. */
const DEFAULT_SELECT = "grid";

/** The `focus` attribute's default (specs/focus-navigation.md): Tab
 * alone moves focus; `focus="arrows"` adds arrow-key navigation.
 * Reflected like `select`. */
const DEFAULT_FOCUS = "tab";

/** Set on the host while an element selection made by a semantic
 * gesture is live (specs/semantic-selection.md): the shadow stylesheet
 * lifts the grid-mode user-select lock under it. */
const SEMANTIC_SELECTION = "data-mw-semantic-selection";

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
 * (specs/cell-model.md); styles.css mirrors the list, interactive.test.ts
 * holds them equal. */
export const COMPOSITE = [
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
export const INTERACTIVE = [
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

/** The element painted behind one: its parent, or past a shadow root
 * the host holding it. */
const behind = (el: Element): Element | null =>
  el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);

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

/** Transition properties the engine SAMPLES per animation frame (the
 * grid repaints with true mid-fade values): computed `color` stays live
 * under the text-fill lock, and nothing locks border colors, opacity,
 * or a layer's transforms and filter. Lock-owned properties
 * (backgrounds, decoration color, geometry, backdrop-filter) are
 * snapped by the measuring/settling `transition-property` allow-list
 * instead — keep the two in sync (styles.css "Lock toggles must
 * never…"). */
const SAMPLED_TRANSITION =
  /^(color|opacity|border-(top|right|bottom|left)-color|border-color|transform|translate|rotate|scale|filter)$/;

/** The sampled properties a layer's box copies (specs/layers.md
 * "Animation is sampled"): a transition of one alone re-places the
 * boxes per frame, the layout left as it is. */
const LAYER_TRANSITION = /^(transform|translate|rotate|scale|filter)$/;

/** Safety valve for the sampling loop: a transition whose end/cancel
 * event never arrives (subtree torn down mid-fade) must not pin a rAF
 * loop forever. */
const SAMPLING_VALVE_MS = 30_000;

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
/** A scroll this soon after a key press is the key's. */
const KEY_SCROLL_MS = 500;
/** The browsers' own autoscroll timer: a held gesture past its
 * scroller's edge scrolls it this often (specs/wide-characters.md). */
const AUTOSCROLL_TICK_MS = 50;

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
  static observedAttributes = ["select", "focus"];

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

  #shadow: ShadowRoot;
  /** The shadow's `:host {}` rule the engine writes into — the theme
   * tokens and the grid's origin, inherited by the light DOM, never a
   * light-DOM mutation — seeded with the system colors, so a token is
   * valid before the first layout. */
  #hostSheet = new CSSStyleSheet();
  /** Inside another host: the engine stays off (connectedCallback). */
  #nested = false;
  #grid: HTMLElement;
  #layers: HTMLElement;
  #probe: HTMLElement;
  #resizeObserver: ResizeObserver | null = null;
  /** The ancestors' `class` and `style`, which reach the host's cells
   * through the cascade — a theme class on the page, the derived tokens'
   * colors among them. */
  #ancestorObserver: MutationObserver | null = null;
  #colorScheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  #onColorSchemeChange = (): void => this.#scheduleLayout();
  #mutationObserver: MutationObserver | null = null;
  #layoutPending = false;
  #cellMetrics: CellMetrics | null = null;
  #lastLayout: LayoutNode | null = null;
  #unsubscribeLeafRegistry: (() => void) | null = null;
  #unsubscribeGlyphRegistry: (() => void) | null = null;
  #paintPending = false;
  /** Scroll containers of the LAST layout (specs/scrolling.md). */
  #scrollNodes: LayoutNode[] = [];
  /** The sticky boxes of the last layout, shifted on every paint
   * (specs/sticky.md). */
  #stickyBoxes: StickyBox[] = [];
  #settleTimers = new Map<Element, ReturnType<typeof setTimeout>>();
  /** Last routed-scroll activity per scroll container (a wheel tick, an
   * auto-scroll tick): each scrollBy is a separate PROGRAMMATIC scroll,
   * so the browser fires scrollend between ticks — mid-gesture settles
   * would keep snapping small deltas back (the "resistance"). Recent
   * activity suppresses them; the quiesce timer settles instead. */
  #routedScrollAt = new WeakMap<Element, number>();
  /** What the current wheel gesture is LATCHED to — a scroll container, or the
   * page (`el: null`): chaining is a gesture-START decision (native
   * scroll-chaining semantics), so mid-gesture boundary hits stay on
   * the scroll container and a scroll container sliding under the pointer never captures a
   * page gesture. `mag`/`decayed` track the delta trend (see
   * #onWheel). */
  #wheelLatch: WheelLatch | null = null;
  #thumbDrag: ThumbDrag | null = null;
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
  /** When the last key went down (see #onScroll). */
  #lastKeyAt = 0;
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
    this.#shadow = this.attachShadow({ mode: "open" });
    this.#shadow.innerHTML = SHADOW_TEMPLATE;
    this.#hostSheet.replaceSync(":host { --mw-fg: canvastext; --mw-bg: canvas }");
    this.#shadow.adoptedStyleSheets = [this.#hostSheet];
    this.#grid = this.#shadow.getElementById("grid") as HTMLElement;
    this.#layers = this.#shadow.getElementById("layers") as HTMLElement;
    // Cell-metrics probe (see measureCellMetrics): persistent, hidden but
    // measurable, inheriting the host's font/line-height/letter-spacing.
    // It lives in the LIGHT DOM so it is font-matched in exactly the same
    // context as the content it stands in for (shadow-tree font matching
    // has its own quirks on some Chromium builds). Measurement happens
    // under the `measuring` attribute, so the companion stylesheet's
    // typography locks are off; the inline `!important`s guard the
    // box/wrap properties that must hold regardless.
    this.#probe = document.createElement("span");
    this.#probe.setAttribute("aria-hidden", "true");
    this.#probe.setAttribute("data-mw-probe", "");
    this.#probe.style.cssText =
      "position:absolute!important;top:0!important;left:0!important;" +
      "visibility:hidden!important;pointer-events:none!important;user-select:none!important;" +
      "white-space:pre!important;overflow-wrap:normal!important;" +
      "padding:0!important;margin:0!important;border:0!important;";
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
    box.style.cssText = `display:inline-block;vertical-align:top;overflow:hidden;padding:0;height:${this.#cellMetrics?.height ?? 0}px;line-height:${lineHeight}px;font-size:${scale * 100}%`;
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
    this.#nested = this.parentElement?.closest("mono-wind") !== null;
    if (this.#nested) {
      warnOnce(
        this,
        "A <mono-wind> inside another <mono-wind> is unsupported; it is laid out as plain content of the outer one.",
      );
      return;
    }
    // attributeChangedCallback only fires on changes; an absent
    // attribute reflects its default here.
    if (!this.hasAttribute("select")) this.setAttribute("select", DEFAULT_SELECT);
    if (!this.hasAttribute("focus")) this.setAttribute("focus", DEFAULT_FOCUS);
    // Before the observers connect, so its insertion isn't observed.
    if (this.#probe.parentNode !== this) this.appendChild(this.#probe);

    this.#resizeObserver = new ResizeObserver(() => this.#scheduleLayout());
    this.#ancestorObserver = new MutationObserver(() => this.#scheduleLayout());
    this.#colorScheme?.addEventListener("change", this.#onColorSchemeChange);
    this.#resizeObserver.observe(this);
    this.#observeSurroundings();
    // The probe too: a freshly inserted probe can transiently font-match
    // the FALLBACK at first layout even when the real font is already
    // loaded (WebKit; no fonts event ever follows). The swap changes the
    // probe's size, so observing it is the missing re-measure signal.
    // (The probe is absolutely positioned, hence blockified — inline
    // boxes would be unobservable.)
    this.#resizeObserver.observe(this.#probe);
    // Viewport-relative lengths (h-screen, h-[95dvh], …) read
    // window.innerWidth/Height at layout time; a window resize that
    // doesn't change the HOST's size (height-only, typically) would
    // otherwise never retrigger them.
    window.addEventListener("resize", this.#onWindowResize);

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
    document.fonts?.addEventListener("loadingdone", this.#onFontsLoaded);

    // Pseudo-classes (:hover/:focus-visible/:active) and form-control
    // value changes flip computed styles without any MutationObserver
    // signal. Delegated events on the host schedule a relayout; the
    // rAF debouncer collapses hover storms into at most one per frame.
    for (const evt of DYNAMIC_RELAYOUT_EVENTS) {
      this.addEventListener(evt, this.#scheduleDynamicRelayout);
    }

    // Animation sampling (specs/cell-model.md "Animation"): a running
    // transition of a sampled property re-lays-out every frame, so the
    // grid repaints with the browser's own interpolated values.
    this.addEventListener("transitionrun", this.#onTransitionRun);
    this.addEventListener("transitionend", this.#onTransitionDone);
    this.addEventListener("transitioncancel", this.#onTransitionDone);
    // Keyframe animations join the same loop (specs/animations.md):
    // an iteration is a start for one resumed or begun before the
    // host listened, an end lands the state of one the loop dropped.
    this.addEventListener("animationstart", this.#onAnimationStart);
    this.addEventListener("animationiteration", this.#onAnimationStart);
    this.addEventListener("animationend", this.#onAnimationDone);
    this.addEventListener("animationcancel", this.#onAnimationDone);
    // A popover's or a dialog's toggle bubbles from neither: captured.
    this.addEventListener("toggle", this.#onToggle, true);

    // Synthesized pointer states (specs/cell-model.md "Pointer
    // states"): under select="grid" the light DOM is pointer-events:
    // none, so :hover/:active can't match — the engine hit-tests the
    // pointer's cell and marks the chain with data-mw-hover /
    // data-mw-active (utilities.css retargets the Tailwind variants).
    this.addEventListener("pointermove", this.#onPointerMove);
    this.addEventListener("pointerleave", this.#onPointerLeave);
    this.addEventListener("pointerdown", this.#onPointerDown);
    // Scroll events don't bubble — capture catches every light-DOM
    // container's scroll (specs/scrolling.md).
    this.addEventListener("scroll", this.#onScroll, { capture: true, passive: true });
    this.addEventListener("scrollend", this.#onScrollEnd, { capture: true });
    this.addEventListener("wheel", this.#onWheel, { passive: false });
    // A selection in the light DOM copies as the engine's plain text
    // (specs/semantic-selection.md): the browsers' serializers lose
    // block breaks for the out-of-flow boxes the render uses.
    this.addEventListener("copy", this.#onCopy);
    // Multi-click gestures (specs/semantic-selection.md): the click
    // count rides mousedown (PointerEvent.detail is 0).
    this.addEventListener("mousedown", this.#onMouseDown);
    this.addEventListener("keydown", this.#onKeyDown);
    document.addEventListener("selectionchange", this.#onSelectionChange);
    // Release on the window: a selection drag routinely ends outside
    // the host, and the press state must thaw wherever it ends.
    window.addEventListener("pointerup", this.#onPointerUp);
    window.addEventListener("pointercancel", this.#onPointerUp);
    window.addEventListener("mouseup", this.#onMouseUp, { capture: true });
    // Content scrolling under a stationary pointer moves cells beneath
    // it — native :hover re-evaluates there, so the synthesis must
    // too. Capture catches nested scrollers (scroll doesn't bubble).
    document.addEventListener("scroll", this.#onAnyScroll, { capture: true, passive: true });

    MonoWindElement.#watchHead(this);
    this.#scheduleLayout();
  }

  disconnectedCallback(): void {
    window.removeEventListener("resize", this.#onWindowResize);
    this.#resizeObserver?.disconnect();
    this.#mutationObserver?.disconnect();
    this.#ancestorObserver?.disconnect();
    this.#colorScheme?.removeEventListener("change", this.#onColorSchemeChange);
    this.#resizeObserver = null;
    this.#mutationObserver = null;
    this.#ancestorObserver = null;
    this.#unsubscribeLeafRegistry?.();
    this.#unsubscribeLeafRegistry = null;
    this.#unsubscribeGlyphRegistry?.();
    this.#unsubscribeGlyphRegistry = null;
    document.fonts?.removeEventListener("loadingdone", this.#onFontsLoaded);
    for (const evt of DYNAMIC_RELAYOUT_EVENTS) {
      this.removeEventListener(evt, this.#scheduleDynamicRelayout);
    }
    this.removeEventListener("transitionrun", this.#onTransitionRun);
    this.removeEventListener("transitionend", this.#onTransitionDone);
    this.removeEventListener("transitioncancel", this.#onTransitionDone);
    this.removeEventListener("animationstart", this.#onAnimationStart);
    this.removeEventListener("animationiteration", this.#onAnimationStart);
    this.removeEventListener("animationend", this.#onAnimationDone);
    this.removeEventListener("animationcancel", this.#onAnimationDone);
    this.removeEventListener("toggle", this.#onToggle, true);
    this.#activeTransitions = 0;
    this.#animated.clear();
    this.removeEventListener("pointermove", this.#onPointerMove);
    this.removeEventListener("pointerleave", this.#onPointerLeave);
    this.removeEventListener("pointerdown", this.#onPointerDown);
    this.removeEventListener("scroll", this.#onScroll, { capture: true });
    this.removeEventListener("scrollend", this.#onScrollEnd, { capture: true });
    this.removeEventListener("wheel", this.#onWheel);
    this.removeEventListener("copy", this.#onCopy);
    this.removeEventListener("keydown", this.#onKeyDown);
    this.removeEventListener("mousedown", this.#onMouseDown);
    document.removeEventListener("selectionchange", this.#onSelectionChange);
    for (const timer of this.#settleTimers.values()) clearTimeout(timer);
    this.#settleTimers.clear();
    this.#thumbDrag = null;
    this.#wheelLatch = null;
    this.#stopAutoscroll();
    window.removeEventListener("pointerup", this.#onPointerUp);
    window.removeEventListener("pointercancel", this.#onPointerUp);
    window.removeEventListener("mouseup", this.#onMouseUp, { capture: true });
    document.removeEventListener("scroll", this.#onAnyScroll, { capture: true });
    this.#hoverClient = null;
    this.#pressTarget = null;
    this.#pressing = false;
    this.#paintHeld = false;
    this.#ownsRelease = false;
    this.#updatePointerStates();
    MonoWindElement.#unwatchHead(this);
  }

  /* === Synthesized pointer states ==================================== */

  #hovered = new Set<Element>();
  #pressed = new Set<Element>();
  #pressTarget: Element | null = null;
  #pressing = false;
  #paintHeld = false;
  #hoverClient: { x: number; y: number } | null = null;
  #hoverCol = NaN;
  #hoverRow = NaN;
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
      this.#syncScrollOffsets(metrics);
      // Sticky boxes follow the offsets; their light-DOM shift writes
      // are the engine's own, drained like a layout pass's.
      applyStickyShifts(this.#stickyBoxes);
      syncStickyVars(this.#stickyBoxes);
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
   * repaint. */
  #syncScrollOffsets(metrics: CellMetrics, snapshot?: ScrollSnapshot): void {
    for (const node of this.#scrollNodes) {
      const el = node.source as HTMLElement;
      const { maxX, maxY } = node.scrollRange!;
      const entry = snapshot?.get(el);
      node.scroll = entry
        ? {
            x: entry.pinX ? maxX : Math.min(entry.x, maxX),
            y: entry.pinY ? maxY : Math.min(entry.y, maxY),
          }
        : this.#quantize(node, metrics);
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
    clearTimeout(this.#settleTimers.get(el));
    this.#settleTimers.set(
      el,
      setTimeout(() => this.#settle(el), delay),
    );
  }

  #onScroll = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === this) return;
    if (!target.hasAttribute("data-mw-scroll")) return;
    this.#containerScrolled = true;
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
      clearTimeout(this.#settleTimers.get(target));
    }
  };

  #onScrollEnd = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === this) return;
    if (!target.hasAttribute("data-mw-scroll")) return;
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
    if (this.#thumbDrag?.el === el) return; // release settles
    // Repaint unconditionally: scroll events can coalesce away under
    // load (observed in Firefox), and the settle is the gesture's
    // reliable terminal signal — a current grid makes this a no-op.
    this.#schedulePaint();
    const metrics = this.#cellMetrics;
    const node = this.#scrollNodes.find((candidate) => candidate.source === el);
    if (!metrics || !node) return;
    const range = node.scrollRange!;
    // Quantized from the live position: a scroll since the last paint
    // (its event still to come) settles on its own cell.
    const cells = this.#quantize(node, metrics);
    const top =
      cells.y === range.maxY ? el.scrollHeight - el.clientHeight : cells.y * metrics.height;
    const left = cells.x === range.maxX ? el.scrollWidth - el.clientWidth : cells.x * metrics.width;
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
    // Chromium marks every tick after an uncanceled first one in a
    // native scroll sequence non-cancelable: the page owns that
    // gesture — unless nothing outside the host can scroll that way,
    // where routing is the only thing the tick can usefully do.
    if (!e.cancelable && this.#outsideCanScroll(dx, dy)) return;
    const { col, row } = this.#cellAt(e.clientX, e.clientY, metrics);
    const now = Date.now();
    const mag = Math.abs(dx) + Math.abs(dy);
    // Zero-delta ticks mark gesture phases (Safari's, and Chromium's
    // momentum cancel when a finger lands mid-inertia): a boundary.
    // Canceled, so a sequence they open stays cancelable.
    if (mag === 0) {
      this.#wheelLatch = null;
      e.preventDefault();
      return;
    }
    // Native room decides (the native ceiling IS the engine's max);
    // an axis without engine range never consumes.
    const canMove = (node: LayoutNode): boolean => containerHasRoom(node, dx, dy);
    // Gesture boundaries without native phase info: a gesture ends
    // when ticks quiesce or the delta RISES after confirmed inertia —
    // momentum never rises (it often repeats a delta: 3, 3, 2, 2, 1…),
    // finger ticks wobble — so a scroll container at its end hands a new push to
    // the page instead of blocking until the inertia dies. Confirmed
    // inertia STICKS: a new push usually starts below the momentum it
    // interrupts, and only its second tick rises. Momentum follows the
    // pointer (its ticks land wherever the cursor went), so after a
    // move a same-axis tick that continues the decay is still the old
    // gesture; any rise or a new dominant axis is the new one.
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
      target = this.#scrollNodes.find((node) => node.source === latch.el) ?? null;
    }
    if (!target) {
      const stack = hitStack(layout, col, row);
      for (let i = stack.length - 1; i >= 0; i--) {
        const node = stack[i]!.node;
        if (!node.scrollRange || isInert(node.source)) continue;
        if (canMove(node)) {
          target = node;
          break;
        }
        // At its boundary already: chain outward only if this scroll container's
        // overscroll-behavior allows it on the gesture's axis.
        const overscroll = node.style.overscroll;
        if ((dy !== 0 && !overscroll.y) || (dx !== 0 && !overscroll.x)) {
          target = node; // contain/none: the gesture stays here, inert
          break;
        }
      }
      // A swipe's first tick often carries only a tiny cross-axis
      // delta; over a scroll container that cannot consume it, it decides nothing
      // yet: eaten (keeping the sequence cancelable), unlatched — the
      // next, decisive tick picks the scroll container.
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

  /** The host's width is capped to whole cells (styles.css), so a
   * growing slot no longer resizes the host: observe the parent (a
   * growing container) and the siblings (a flex or grid slot that
   * grows because a sibling shrank), and every ancestor's `class` and
   * `style` for the cascade. Re-run per layout — observe() is
   * idempotent, and new siblings and ancestors join. */
  #observeSurroundings(): void {
    const parent = this.parentElement;
    if (!parent || !this.#resizeObserver || !this.#ancestorObserver) return;
    this.#resizeObserver.observe(parent);
    for (const sibling of parent.children) {
      if (sibling !== this) this.#resizeObserver.observe(sibling);
    }
    for (let el = behind(this); el; el = behind(el)) {
      this.#ancestorObserver.observe(el, { attributes: true, attributeFilter: ["class", "style"] });
    }
  }

  /** The grid cell under a client point — through a layer's transform
   * where one shows there (specs/layers.md) — with the grid it is
   * painted in: a layer's, with the layer's origin, or the main one.
   * The origin is cached until the next layout or page scroll
   * invalidates it. */
  #cellAt(clientX: number, clientY: number, metrics: CellMetrics): CellHit {
    if (!this.#gridOrigin) {
      const rect = this.#grid.getBoundingClientRect();
      this.#gridOrigin = { left: rect.left, top: rect.top };
    }
    const x = clientX - this.#gridOrigin.left;
    const y = clientY - this.#gridOrigin.top;
    return (
      layerAt(this.#layers, x, y) ?? {
        col: Math.floor(x / metrics.width),
        row: Math.floor(y / metrics.height),
        grid: this.#grid,
        x: 0,
        y: 0,
      }
    );
  }

  /** The glyph painted at a cell: the layer painted last over it, or
   * the main grid's. */
  #glyphAt(col: number, row: number): string | undefined {
    const layer = layerGridAt(this.#layers, col, row);
    if (layer) {
      const glyph = paintedCell(layer.grid, col - layer.x, row - layer.y);
      if (glyph !== undefined && glyph !== " ") return glyph;
    }
    return paintedCell(this.#grid, col, row);
  }

  /** A pointerdown on a visible gutter bar begins a thumb drag —
   * engine-routed in BOTH modes (the gutter is grid ink; there is no
   * native scrollbar). Proportional: the draggable track maps onto
   * the scroll range. */
  #gutterDragAt(clientX: number, clientY: number): ThumbDrag | null {
    const layout = this.#lastLayout;
    const metrics = this.#cellMetrics;
    if (!layout || !metrics || this.#scrollNodes.length === 0) return null;
    const { col, row } = this.#cellAt(clientX, clientY, metrics);
    const stack = hitStack(layout, col, row);
    for (let i = stack.length - 1; i >= 0; i--) {
      const { node, x, y } = stack[i]!;
      const range = node.scrollRange;
      if (!range || isInert(node.source)) continue;
      const el = node.source as HTMLElement;
      const { y: yBar, x: xBar } = scrollbarGeometry(node, x, y);
      if (
        yBar &&
        range.maxY > 0 &&
        col >= yBar.col &&
        col < yBar.col + yBar.thick &&
        row >= yBar.row &&
        row < yBar.row + yBar.len
      ) {
        const thumbLen = thumbSpan(yBar.len, range.sizeY, range.maxY, 0).len;
        const draggablePx = Math.max(1, (yBar.len - thumbLen) * metrics.height);
        return {
          el,
          axis: "y",
          startClient: clientY,
          startPx: el.scrollTop,
          factor: (range.maxY * metrics.height) / draggablePx,
        };
      }
      if (
        xBar &&
        range.maxX > 0 &&
        row >= xBar.row &&
        row < xBar.row + xBar.thick &&
        col >= xBar.col &&
        col < xBar.col + xBar.len
      ) {
        const thumbLen = thumbSpan(xBar.len, range.sizeX, range.maxX, 0).len;
        const draggablePx = Math.max(1, (xBar.len - thumbLen) * metrics.width);
        return {
          el,
          axis: "x",
          startClient: clientX,
          startPx: el.scrollLeft,
          factor: (range.maxX * metrics.width) / draggablePx,
        };
      }
    }
    return null;
  }

  #onPointerMove = (event: Event): void => {
    if (isTouchInProgress(event)) return; // see #scheduleDynamicRelayout
    const { clientX, clientY } = event as PointerEvent;
    const drag = this.#thumbDrag;
    if (drag) {
      const delta = (drag.axis === "y" ? clientY : clientX) - drag.startClient;
      const target = drag.startPx + delta * drag.factor;
      if (drag.axis === "y") drag.el.scrollTop = target;
      else drag.el.scrollLeft = target;
      return;
    }
    const held = ((event as PointerEvent).buttons & 1) !== 0;
    if (held && this.#gesture) this.#extendGesture(this.#gesture, clientX, clientY);
    if (held && this.#gridDrag) this.#extendGridDrag(this.#gridDrag, clientX, clientY);
    if (held && this.#pressOnGrid && !this.hasAttribute("data-mw-dragging")) {
      this.setAttribute("data-mw-dragging", "");
    }
    this.#hoverClient = { x: clientX, y: clientY };
    // High-frequency path: skip the update while the pointer stays in
    // the same cell (state can only change with the cell — relayouts
    // and scrolls have their own refresh calls).
    const metrics = this.#cellMetrics;
    if (metrics) {
      const { col, row } = this.#cellAt(clientX, clientY, metrics);
      if (col === this.#hoverCol && row === this.#hoverRow) return;
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
    } else if (mode !== "grid" || (!onGrid && !this.#isPhantomTarget(e.target))) return;
    const finePointer = this.#lastPointerType === "mouse" || this.#lastPointerType === "pen";
    if (e.detail <= 1) {
      if (e.detail !== 1) return;
      this.removeAttribute(SEMANTIC_SELECTION);
      if (!finePointer) return;
      if (asText) {
        this.#startCharacterDrag(e);
        this.#startAutoscroll(e);
        return;
      }
      // A press that moves the focus — off a control inside the host,
      // onto a focus target under the cell — repaints the focus invert,
      // a structural rebuild a native drag anchor would not survive
      // (paintGrid holds those until release). Take such a press over,
      // like a phantom one: move the focus as the click would, drag
      // through the engine.
      const metrics = this.#cellMetrics;
      const at = metrics ? this.#cellAt(e.clientX, e.clientY, metrics) : null;
      const target = at ? this.#focusTargetAt(at.col, at.row) : null;
      if (!onGrid || target || this.#focusedInside()) this.#startGridDrag(e, target);
      return;
    }
    if (!finePointer) return;
    const unit = e.detail === 2 ? "word" : "paragraph";
    const selection = document.getSelection();
    const layout = this.#lastLayout;
    const metrics = this.#cellMetrics;
    if (!selection || !layout || !metrics) return;
    const { col, row } = this.#cellAt(e.clientX, e.clientY, metrics);
    const target = this.#unitUnder(layout, col, row, unit);
    if (!target) {
      // No word or paragraph under the cell (a gap, a border, a blank):
      // the browser's own gesture on the grid — a run of glyphs, or the
      // grid line on a triple-click.
      this.removeAttribute(SEMANTIC_SELECTION);
      this.#gesture = null;
      return;
    }
    // Ours from here: no native word/whole-grid selection, no native
    // drag.
    e.preventDefault();
    this.#focusAsPress(col, row);
    this.#liftLock(target);
    // Shift extends the existing element selection from its anchor.
    const anchor: SelectionUnit =
      e.shiftKey && selection.anchorNode && this.#elementSelection()
        ? pointUnit({ node: selection.anchorNode, offset: selection.anchorOffset })
        : target;
    this.#selectThrough(selection, anchor, target);
    this.#gesture = { unit, anchor };
    this.#startAutoscroll(e);
  };

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
    const { col, row } = this.#cellAt(e.clientX, e.clientY, metrics);
    const stack = hitStack(layout, col, row);
    let container: HTMLElement | null = null;
    for (let i = stack.length - 1; i >= 0 && !container; i--) {
      const { node } = stack[i]!;
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
    const node = this.#scrollNodes.find((candidate) => candidate.source === el);
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
    const layout = this.#lastLayout;
    const target = e.target;
    if (!layout || !(target instanceof Element) || target === this) return;
    if (arrowIsNative(target, e.key, this.#openSelectPicker())) return;
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
    (next as HTMLElement).focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  /** The root as a container over its child nodes: the element
   * children as nodes, the host's own text beside them as anonymous
   * runs in the host's leaf style (specs/host-leaf.md), the metrics
   * probe never one. The root carries that style too: its text
   * properties key the host's native locks (render.ts `markRoot`). */
  #buildRootContainer(
    rootFontSizePx: number,
    metrics: CellMetrics,
    textareaWidths: TextareaWidths,
  ): LayoutNode {
    const nodes = Array.from(this.childNodes).filter((node) => node !== this.#probe);
    const style = hostLeafStyle(this, rootFontSizePx, metrics);
    return {
      source: this,
      style,
      children: buildChildren(this, nodes, rootFontSizePx, metrics, textareaWidths, style),
      text: "",
      intrinsicWidth: 0,
      intrinsicHeight: 0,
      localRect: { x: 0, y: 0, width: 0, height: 0 },
      unclampedHeight: 0,
      resolvedPadding: zeroInsets(),
    };
  }

  /** The focus a click on a cell would move to: the nearest `tabindex`
   * above the element under it — a dialog's content, a menu's, a scroll
   * region. From the cell, since a grid press targets the shadow's
   * grid, retargeted to the host. */
  #focusTargetAt(col: number, row: number): HTMLElement | null {
    const layout = this.#lastLayout;
    const target = layout
      ? hitChain(layout, col, row).at(-1)?.closest<HTMLElement>("[tabindex]")
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

  #focusAsPress(col: number, row: number): void {
    this.#focusAs(this.#focusTargetAt(col, row));
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
   * browser-internal anchor would not survive a rebuild; a press on a
   * control is the control's, and an engine-driven grid drag re-derives
   * its points from flat offsets. */
  #holdsNativeDrag(): boolean {
    return this.#pressing && this.#pressOnGrid && !this.#gridDrag;
  }

  /** A non-interactive light element inside the host: never a legitimate
   * pointer target in grid mode, so an event there is a grid event. */
  #isPhantomTarget(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      target !== this &&
      this.contains(target) &&
      !target.matches(INTERACTIVE)
    );
  }

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

  /** Drag extension: the anchor unit through the unit under the pointer,
   * in DOM order (base at the anchor's far edge, so the browser's
   * selection direction matches the drag). */
  #extendGesture(gesture: Gesture, clientX: number, clientY: number): void {
    const metrics = this.#cellMetrics;
    const selection = document.getSelection();
    if (!metrics || !selection) return;
    const { col, row } = this.#cellAt(clientX, clientY, metrics);
    const current = this.#unitAt(col, row, gesture.unit);
    if (!current || (gesture.extent && sameUnit(gesture.extent, current))) return;
    gesture.extent = current;
    this.#selectThrough(selection, gesture.anchor, current);
  }

  /** Select from the anchor unit through `unit`: the anchor's far edge
   * becomes the base, so the browser's selection direction matches the
   * gesture. Points inside a custom leaf's shadow cannot pair with
   * light-tree points, so each side is expressed at light-tree edges
   * unless both are the same shadow unit. */
  #selectThrough(selection: Selection, anchor: SelectionUnit, unit: SelectionUnit): void {
    if (sameUnit(anchor, unit)) {
      selectBetween(selection, unit.start, unit.end);
      return;
    }
    // Two units in one tree pair directly — a drag inside a custom
    // leaf's transcript selects its characters; across trees, each side
    // is expressed at light-tree edges.
    const sameTree = anchor.start.node.getRootNode() === unit.start.node.getRootNode();
    const from = sameTree ? anchor : this.#lightEdges(anchor);
    const to = sameTree ? unit : this.#lightEdges(unit);
    const forward =
      comparePoints(from.start.node, from.start.offset, to.start.node, to.start.offset) <= 0;
    if (forward) selectBetween(selection, from.start, to.end);
    else selectBetween(selection, from.end, to.start);
  }

  /** A text-mode press (specs/wide-characters.md "Text-mode drags are
   * routed"): the character nearest the cell anchors a collapsed range
   * the drag extends by character; Shift extends the existing
   * selection to it instead. An empty grid leaves the press native. */
  #startCharacterDrag(e: MouseEvent): void {
    const selection = document.getSelection();
    const metrics = this.#cellMetrics;
    if (!selection || !metrics) return;
    const { col, row } = this.#cellAt(e.clientX, e.clientY, metrics);
    const target = this.#unitAt(col, row, "character");
    if (!target) return;
    e.preventDefault();
    this.#focusAsPress(col, row);
    const anchor: SelectionUnit =
      e.shiftKey && selection.anchorNode && this.#elementSelection()
        ? pointUnit({ node: selection.anchorNode, offset: selection.anchorOffset })
        : pointUnit(target.start);
    this.#selectThrough(selection, anchor, e.shiftKey ? target : anchor);
    this.#gesture = { unit: "character", anchor };
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
   * a point resolves inside its containing block — then the grid. */
  #unitAt(col: number, row: number, unit: GestureUnit): SelectionUnit | null {
    const layout = this.#lastLayout;
    if (!layout) return null;
    const grid = { x: 0, y: 0, width: layout.localRect.width, height: layout.localRect.height };
    const c = Math.max(0, Math.min(col, grid.width - 1));
    const r = Math.max(0, Math.min(row, grid.height - 1));
    const inner = hitStack(layout, c, r).at(-1);
    // An inert element's cells are nobody's (the browser ignores the
    // press there too).
    if (inner && isInert(inner.node.source)) return null;
    const boxes = inner ? [hitRect(inner.node, inner.x, inner.y), grid] : [grid];
    for (const box of boxes) {
      for (const cell of nearestCells(box.width, box.height, c - box.x, r - box.y)) {
        const x = box.x + cell.x;
        const y = box.y + cell.y;
        const { edge } = cell;
        // Only painted glyphs can be neighbors: blank cells cost a lookup,
        // not a hit test (a wide cluster's continuation cell is its
        // cluster's, not blank). The pressed cell itself is always hit
        // tested — a space in a text run is a character.
        const painted = this.#glyphAt(x, y);
        if (painted === undefined || (painted === " " && edge !== "self")) continue;
        const found = this.#unitUnder(layout, x, y, unit, box === grid ? null : inner!.node);
        if (!found) continue;
        if (edge === "self" || unit !== "character") return found;
        return pointUnit(edge === "start" ? found.start : found.end);
      }
    }
    return null;
  }

  /** The unit under a cell — null unless a CHARACTER of a text leaf is
   * painted there (padding, borders, gaps, and blank tails are the
   * browser's), or the cell is outside `within` (a box clipped by its
   * scroll container paints other content past the clip). The
   * innermost hit text leaf; its selectionTarget's contents for a
   * custom leaf; a Segmenter word mapped to DOM positions for the word
   * gesture (falling back to the paragraph where the text has no
   * positions). */
  #unitUnder(
    layout: LayoutNode,
    col: number,
    row: number,
    unit: GestureUnit,
    within: LayoutNode | null = null,
  ): SelectionUnit | null {
    const stack = hitStack(layout, col, row);
    if (within && !stack.some((entry) => entry.node === within)) return null;
    for (let i = stack.length - 1; i >= 0; i--) {
      const { node, x, y } = stack[i]!;
      // An inert leaf's text is unselectable natively: no unit there.
      if (isTextLeaf(node)) {
        return isInert(node.source) ? null : this.#leafUnit(node, x, y, col, row, unit);
      }
    }
    // The host's own text (specs/host-leaf.md): the root leaf lies under
    // every cell no child covers.
    return isTextLeaf(layout) ? this.#leafUnit(layout, 0, 0, col, row, unit) : null;
  }

  /** The character, word, or paragraph of a text leaf at a cell; null
   * off its characters (an inline padding cell is blank for a character).
   * A character is positioned through the leaf's source map or a custom
   * leaf's transcript, a word on a custom leaf is the art's line; either
   * without a position is the leaf's whole contents (#leafContents). */
  #leafUnit(
    node: LayoutNode,
    x: number,
    y: number,
    col: number,
    row: number,
    unit: GestureUnit,
  ): SelectionUnit | null {
    const index = charIndexAtCell(node, x, y, col, row);
    if (index === null) return null;
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
   * selectable content. */
  #liftLock(unit: SelectionUnit): void {
    this.setAttribute(SEMANTIC_SELECTION, "");
    const node = unit.start.node;
    const element = node instanceof Element ? node : node.parentElement;
    if (element) void getComputedStyle(element).userSelect;
  }

  /** The document selection when it is a non-collapsed range in this
   * host's light DOM (a custom leaf's shadow selection reads as the
   * light range around its host); null otherwise. */
  #elementSelection(): BoundaryPoints | null {
    const layout = this.#lastLayout;
    const range = selectionRangeThrough(
      this.#grid.getRootNode() as ShadowRoot,
      layout ? leafShadowRoots(layout) : [],
    );
    if (!range || classifySelection(this, this.#grid, range) !== "light") return null;
    const collapsed =
      range.startContainer === range.endContainer && range.startOffset === range.endOffset;
    return collapsed ? null : range;
  }

  /** The lift ends once the selection left the light DOM or collapsed;
   * the grid repaints its highlight (a frame, through #schedulePaint —
   * an unchanged paint costs a signature). */
  #onSelectionChange = (): void => {
    const selected = this.#elementSelection() !== null;
    if (this.hasAttribute(SEMANTIC_SELECTION) && !selected) {
      this.removeAttribute(SEMANTIC_SELECTION);
    }
    // A selection elsewhere in the document is none of this host's
    // business unless it just left it.
    if ((selected || this.#paintedSelection) && this.#lastLayout) this.#schedulePaint();
    this.#paintedSelection = selected;
  };

  /** Paint the grid from `root`: the glyph boxes for this font, the
   * light-DOM selection as inverted cells, structural rebuilds held
   * while a native drag may be in flight. */
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
    });
  }

  #onPointerLeave = (): void => {
    this.#hoverClient = null;
    this.#updatePointerStates();
  };

  #onPointerDown = (event: Event): void => {
    const e = event as PointerEvent;
    if (!e.isPrimary || e.button !== 0) return;
    this.#lastPointerType = e.pointerType;
    this.#lastPointerId = e.pointerId;
    this.#ownsRelease = false;
    // A finger pans natively (styles.css "Touch panning") and must not
    // relayout before release (see #scheduleDynamicRelayout): no thumb
    // drag, no synthesized press.
    if (isTouchInProgress(e)) return;
    const drag = this.#gutterDragAt(e.clientX, e.clientY);
    if (drag) {
      this.#thumbDrag = drag;
      e.preventDefault();
      // Keep tracking past the host's edge, like a native thumb
      // (synthetic events have no pointer to capture).
      if (e.isTrusted) this.setPointerCapture(e.pointerId);
      return;
    }
    this.#hoverClient = { x: e.clientX, y: e.clientY };
    this.#pressing = true;
    this.#pressOnGrid = this.#onGrid(e.composedPath());
    this.#updatePointerStates(true);
  };

  #onPointerUp = (event: Event): void => {
    if (!(event as PointerEvent).isPrimary) return;
    this.#ownsRelease = event.type === "pointerup" && this.#gesture !== null;
    this.#gesture = null;
    this.#stopAutoscroll();
    this.#gridDrag = null;
    this.#pressOnGrid = false;
    this.removeAttribute("data-mw-dragging");
    if (this.#thumbDrag) {
      this.#settle(this.#thumbDrag.el);
      this.#thumbDrag = null;
      return;
    }
    if (!this.#pressing && !this.#pressTarget) return;
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
    this.#gridOrigin = null;
    this.#syncTopLayerOrigin();
    if (!this.#hoverClient) return;
    this.#followPointer();
    this.#updatePointerStates();
  };

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
      const { col, row } = this.#cellAt(this.#hoverClient.x, this.#hoverClient.y, metrics);
      this.#hoverCol = col;
      this.#hoverRow = row;
      chain = hitChain(layout, col, row);
    } else {
      this.#hoverCol = NaN;
      this.#hoverRow = NaN;
    }
    const innermost = chain.at(-1) ?? null;
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

  #activeTransitions = 0;
  #activeLayerTransitions = 0;
  #samplingLoopRunning = false;
  #lastTransitionRun = 0;
  /** The light elements with a running keyframe animation, each with
   * what a frame does for it (specs/animations.md). */
  #animated = new Map<Element, AnimationPath>();
  /** The last layout's nodes by element, built when a frame needs
   * one. */
  #nodes: Map<Element, LayoutNode> | null = null;

  /** An animation on a light element joins the sampling loop: its
   * keyframes' properties pick its path, and a layout opens the layer
   * it may need. The loop's ticks follow it from there — each one
   * asks the element's animations what still runs — so an infinite
   * animation samples for as long as it runs. */
  #onAnimationStart = (event: Event): void => {
    const el = event.target;
    if (!(el instanceof Element) || !this.#owns(el) || this.#animated.has(el)) return;
    this.#follow(el);
    this.#scheduleLayout();
  };

  /** An end lands its state with a layout: the value it leaves beside
   * an animation still running, or a resumed one-shot's the loop never
   * followed, is the last layout's to read. */
  #onAnimationDone = (event: Event): void => {
    const el = event.target;
    if (el instanceof Element && this.#owns(el)) this.#scheduleLayout();
  };

  /** A light element of this host. */
  #owns(el: Element): boolean {
    return el !== this && this.contains(el);
  }

  /** The host's top-layer stack (specs/top-layer.md). */
  #topLayer = new TopLayer();

  /** A popover's or a dialog's toggle: an opening into the top layer
   * enters the stack, and either state lays out — nothing else of a
   * popover's opening reaches the observers. */
  #onToggle = (event: Event): void => {
    const el = event.target;
    if (!(el instanceof Element) || !this.#owns(el)) return;
    if (isTopLayer(el)) this.#topLayer.enter(el);
    this.#scheduleLayout();
  };

  get #hostRule(): CSSStyleDeclaration {
    return (this.#hostSheet.cssRules[0] as CSSStyleRule).style;
  }

  /** `--mw-fg`/`--mw-bg` follow the host's own colors (specs/theming.md):
   * its computed `color`, and its background or the nearest ancestor's
   * where its own is transparent, `canvas` past the root — written
   * before the measure, so the invert reads them; an outer rule's token
   * still outranks `:host`. */
  #syncTokens(hostStyle: CSSStyleDeclaration): void {
    let background = hostStyle.backgroundColor;
    for (let el = behind(this); el && isTransparentColor(background); el = behind(el)) {
      background = getComputedStyle(el).backgroundColor;
    }
    const tokens = this.#hostRule;
    const fg = hostStyle.color;
    const bg = isTransparentColor(background) ? "canvas" : background;
    if (tokens.getPropertyValue("--mw-fg") !== fg) tokens.setProperty("--mw-fg", fg);
    if (tokens.getPropertyValue("--mw-bg") !== bg) tokens.setProperty("--mw-bg", bg);
  }

  /** The grid's client origin, for the companion to place the top-layer
   * elements' light boxes in the viewport (specs/top-layer.md); current
   * through layouts and page scrolls. */
  #syncTopLayerOrigin(): void {
    if (!this.#lastLayout?.topLayer) return;
    const rect = this.#grid.getBoundingClientRect();
    const origin = this.#hostRule;
    const [ox, oy] = [`${rect.left}px`, `${rect.top}px`];
    if (origin.getPropertyValue("--mw-ox") !== ox) origin.setProperty("--mw-ox", ox);
    if (origin.getPropertyValue("--mw-oy") !== oy) origin.setProperty("--mw-oy", oy);
  }

  /** An element found animating joins the set with its path — a
   * layout's until its animations answer — and the loop runs. */
  #follow(el: Element): void {
    this.#animated.set(el, this.#animationPathOf(el) ?? "layout");
    this.#startSamplingLoop();
  }

  #animationPathOf(el: Element): AnimationPath | null {
    return animationPath(animatedProperties(el), this.#nodeOf(el));
  }

  #nodeOf(el: Element): LayoutNode | null {
    if (!this.#lastLayout) return null;
    this.#nodes ??= nodeIndex(this.#lastLayout);
    return this.#nodes.get(el) ?? null;
  }

  /** A frame of the paint path (specs/animations.md): the animated
   * elements' live paint-only properties onto their nodes, then the
   * last layout painted again, its layers placed with it. */
  #resampleAndPaint(): void {
    const layout = this.#lastLayout;
    if (!layout) return;
    for (const [el, path] of this.#animated) {
      if (path !== "paint") continue;
      const node = this.#nodeOf(el);
      if (node) Object.assign(node.style, readPaintStyle(getComputedStyle(el)));
    }
    this.#paintHeld = !this.#paint(layout);
  }

  #onTransitionRun = (event: Event): void => {
    const property = (event as TransitionEvent).propertyName;
    if (!SAMPLED_TRANSITION.test(property)) return;
    if (LAYER_TRANSITION.test(property)) {
      this.#activeLayerTransitions++;
      // The layer the frames copy onto: opened by a layout, for an
      // effect that arrived without one (a rule outside the host).
      this.#scheduleLayout();
    } else this.#activeTransitions++;
    this.#lastTransitionRun = performance.now();
    this.#startSamplingLoop();
  };

  #onTransitionDone = (event: Event): void => {
    const property = (event as TransitionEvent).propertyName;
    // A popover's exit rides a display or overlay transition: its end
    // lands with a layout (specs/top-layer.md).
    if (property === "display" || property === "overlay") {
      this.#scheduleLayout();
      return;
    }
    if (!SAMPLED_TRANSITION.test(property)) return;
    if (LAYER_TRANSITION.test(property)) {
      this.#activeLayerTransitions = Math.max(0, this.#activeLayerTransitions - 1);
    } else this.#activeTransitions = Math.max(0, this.#activeTransitions - 1);
  };

  #startSamplingLoop(): void {
    if (this.#samplingLoopRunning) return;
    this.#samplingLoopRunning = true;
    const tick = (): void => {
      // Each animated element's path follows its animations as they
      // run, pause, and end.
      for (const el of this.#animated.keys()) {
        const path = this.#owns(el) ? this.#animationPathOf(el) : null;
        if (path) this.#animated.set(el, path);
        else this.#animated.delete(el);
      }
      // The valve is the transitions': an animation's liveness is
      // asked above.
      if (performance.now() - this.#lastTransitionRun > SAMPLING_VALVE_MS) {
        this.#activeTransitions = 0;
        this.#activeLayerTransitions = 0;
      }
      const paths = new Set(this.#animated.values());
      const sampled =
        this.#activeTransitions > 0 || hasSynthesizedTransitions() || paths.has("layout");
      if (
        !this.isConnected ||
        (!sampled && this.#activeLayerTransitions === 0 && this.#animated.size === 0)
      ) {
        this.#samplingLoopRunning = false;
        // One final settle pass so the grid lands exactly on the
        // transitions' target values and an animation's end state.
        this.#scheduleLayout();
        return;
      }
      // A relayout reads everything; live paint-only properties need
      // a repaint; a layer's transform or filter alone moves its box.
      if (sampled) this.#performLayoutSafely();
      else if (paths.has("paint")) this.#resampleAndPaint();
      else syncLayers(this.#layers);
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
    // cuts short the smooth scroll it starts (Firefox). Space on a
    // focused scroll container pages it.
    if (event.type === "keydown" || event.type === "keyup") {
      const { key, target } = event as KeyboardEvent;
      const scrolls = target instanceof Element && target.hasAttribute("data-mw-scroll");
      if (key !== "Enter" && (key !== " " || scrolls)) return;
    }
    // Focus moving onto or off a <select>: relayout NOW, while still
    // inside the event dispatch — the click's default action opens the
    // picker right after, and once it's open relayouts are held (see
    // #openSelectPicker). Deferring here would freeze the grid with
    // the PREVIOUS focus-invert while native text colors update,
    // leaving the old select white-on-white.
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
    if (name === "focus") {
      // Keyboard-only: no layout depends on it.
      if (next !== "tab" && next !== "arrows") {
        if (next !== null) {
          console.warn(
            `[monowind] Ignoring unrecognized focus="${next}". Expected "tab" (default) or "arrows".`,
            warnSubject(this),
          );
        }
        this.setAttribute("focus", DEFAULT_FOCUS);
      }
      return;
    }
    if (name === "select" && next !== "text" && next !== "grid") {
      if (next !== null) {
        console.warn(
          `[monowind] Ignoring unrecognized select="${next}". Expected "grid" (default) or "text".`,
          warnSubject(this),
        );
      }
      // Reflect the default so the attribute is the single source of
      // truth — every selector keys on an explicit value, and no CSS
      // has to know what an absent attribute means.
      this.setAttribute("select", DEFAULT_SELECT);
      return;
    }
    // select="text" hands pointer events back to the light DOM — the
    // synthesized chains must not double up with the native states.
    if (name === "select") this.#updatePointerStates();
    this.#scheduleLayout();
  }

  /** The current render as plain text — the same deterministic mirror
   * the golden tests diff (borders as box-drawing glyphs, text on its
   * grid rows, interior whitespace real, row ends trimmed). Flushes a
   * pending layout so the snapshot is current; empty before the first
   * layout or when the host has no laid-out content. */
  toPlainText(): string {
    // The already-queued rAF will re-run the layout; that's idempotent.
    if (this.#layoutPending) this.#performLayout();
    return this.#lastLayout ? renderPlainText(this.#lastLayout) : "";
  }

  #onWindowResize = (): void => {
    this.#scheduleLayout();
  };

  #onFontsLoaded = (): void => {
    // Defer a frame: rAF callbacks run BEFORE the style recalc that
    // applies a freshly loaded font, so an immediate layout could measure
    // the PRE-swap fallback metrics when the event and the swap land in
    // the same frame (seen consistently on slow CI runners). One frame
    // later the swap has rendered; #scheduleLayout adds its own rAF.
    // The glyph boxes measured under the fallback go with it.
    requestAnimationFrame(() => {
      this.#glyphs.invalidate();
      this.#scheduleLayout();
    });
  };

  /** True while a focused in-host <select> has its picker open. A
   * relayout then would churn styles and make Chrome dismiss the
   * picker instantly (`:open` on <select> is Chromium-only for now;
   * browsers without it don't dismiss and fall through). */
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
    requestAnimationFrame(() => {
      this.#layoutPending = false;
      // Hold the relayout while a select picker is up — re-arm so it
      // runs the frame after the picker closes (change or dismiss).
      if (this.#openSelectPicker()) {
        this.#scheduleLayout();
        return;
      }
      this.#performLayoutSafely();
    });
  }

  #performLayout(): void {
    // A queued frame can outlive the host's removal (story/app teardown,
    // SPA navigation): computed styles on a detached tree read as empty
    // strings, which would misclassify every element and misfire author
    // warnings. Reconnection schedules a fresh layout.
    if (!this.isConnected) return;
    // Container positions are read before the mask and written back after
    // it (specs/scrolling.md); bottom-stick resolves in between.
    const scrollState = this.#captureScrollState();
    // Snapshot each textarea's content-area width in cells BEFORE the
    // measuring attribute goes on. Inside measuring the engine's width
    // rule is off — the textarea reverts to its browser-default width
    // and any read would be wrong. The tree builder wraps the value
    // against this width to compute the row count.
    const textareaWidths: TextareaWidths = new Map();
    const hostStyle = getComputedStyle(this);
    this.#syncTokens(hostStyle);
    const cellWidth = hostStyle.getPropertyValue("--mw-cw").trim();
    const cellWidthPx = parseFloat(cellWidth);
    if (Number.isFinite(cellWidthPx) && cellWidthPx > 0) {
      for (const ta of this.querySelectorAll<HTMLTextAreaElement>("textarea")) {
        const style = getComputedStyle(ta);
        const contentPx =
          ta.clientWidth -
          (parseFloat(style.paddingLeft) || 0) -
          (parseFloat(style.paddingRight) || 0);
        // `round` (not `floor`) so subpixel remainders don't chop one
        // cell off the width — the browser rarely wraps a character
        // that fits within half a cell of the edge.
        textareaWidths.set(ta, Math.max(0, Math.round(contentPx / cellWidthPx)));
      }
    }
    // The write phase is bracketed by the `measuring` attribute (gates the
    // companion stylesheet so reads see authored values). Everything the
    // engine writes to the light DOM — geometry vars, data-mw-* attributes
    // — happens synchronously in here, so the synchronous takeRecords() in
    // `finally` drains exactly our own mutation records. Observation
    // resumes the moment #performLayout returns: a user mutation in the
    // same task (right after a layout) is seen normally.
    this.setAttribute("measuring", "");
    try {
      // (1) Cell metrics — measured EVERY layout from the persistent
      // probe (one getBoundingClientRect on a hidden node; layout is
      // already being forced). No cache to go stale: fonts settling out of
      // order with our rAFs once left a fallback-font measurement cached
      // with nothing to invalidate it. The vars are only rewritten when
      // the values change. A host innerHTML swap wipes the probe (a
      // detached node measures 0×0, and 0-px cells blow the layout up) —
      // re-adopt it here; the childList record drains with the engine's
      // own writes below.
      if (this.#probe.parentNode !== this) this.appendChild(this.#probe);
      const metrics = measureCellMetrics(this, this.#probe);
      const previous = this.#cellMetrics;
      if (
        previous === null ||
        previous.width !== metrics.width ||
        previous.height !== metrics.height ||
        previous.letterSpacing !== metrics.letterSpacing ||
        previous.gridLetterSpacing !== metrics.gridLetterSpacing ||
        previous.inkOverhang !== metrics.inkOverhang ||
        previous.backgroundGap !== metrics.backgroundGap
      ) {
        this.style.setProperty("--mw-cw", `${metrics.width}px`);
        this.style.setProperty("--mw-ch", `${metrics.height}px`);
        this.style.setProperty("--mw-rls", `${metrics.letterSpacing}px`);
        this.style.setProperty("--mw-ink", `${metrics.inkOverhang ?? 0}px`);
        // A whole pixel: Chromium snaps an inline box's fractional padding
        // and drags its text a pixel with it.
        this.style.setProperty("--mw-bgpad", `${Math.ceil((metrics.backgroundGap ?? 0) / 2)}px`);
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
        },
      );

      // (2) Available cells from the host's CONTENT box — authored padding
      // on the host stays outside the grid (the shadow slot box, which
      // laid-out children position against, already sits inside it).
      // clientWidth excludes the border; subtract the padding ourselves.
      const cs = getComputedStyle(this);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const availableCols = Math.max(0, Math.floor((this.clientWidth - padX) / metrics.width));
      if (availableCols === 0) return;

      // (3) Build a tree from the light DOM: the host's own inline
      // content is the root leaf (specs/host-leaf.md); with a block-level
      // child the root is a virtual container over its child nodes, the
      // host's own text as anonymous runs.
      const rootFontSizePx = getRootFontSizePx();
      const virtualRoot =
        buildRootLeaf(this, rootFontSizePx, metrics, textareaWidths) ??
        this.#buildRootContainer(rootFontSizePx, metrics, textareaWidths);

      // (4) Compute integer layout, and the top-layer stack over it.
      const { height } = layoutRoot(virtualRoot, availableCols, (root) => {
        this.#scrollNodes = collectScrollContainers(root);
        this.#syncScrollOffsets(metrics, scrollState);
      });
      this.#topLayer.assign(virtualRoot);

      // (5) Write geometry to light DOM + paint the shadow grid. Do this
      // before clearing the measuring attribute so the browser only
      // paints the final state.
      render(virtualRoot);
      this.#stickyBoxes = collectStickyBoxes(virtualRoot);
      applyStickyShifts(this.#stickyBoxes);
      syncStickyVars(this.#stickyBoxes);
      // Style-only paints patch nodes in place (drag anchors survive);
      // a STRUCTURAL rebuild while a primary press holds a selection
      // anchor in the grid is deferred to release — a drag in flight
      // re-derives from the browser's internal anchor, which the
      // rebuild would destroy (Chromium collapses even across a
      // capture-and-restore).
      // The layers' boxes are placed after the settle below: their
      // roots' effects read as the light elements finally sit.
      this.#paintHeld = !this.#paint(virtualRoot, false);
      this.#lastLayout = virtualRoot;
      this.#nodes = null;
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
        cs.boxSizing === "border-box"
          ? (parseFloat(cs.paddingTop) || 0) +
            (parseFloat(cs.paddingBottom) || 0) +
            (parseFloat(cs.borderTopWidth) || 0) +
            (parseFloat(cs.borderBottomWidth) || 0)
          : 0;
      const hostHeight = `${height * metrics.height + chrome}px`;
      if (this.style.height !== hostHeight) this.style.height = hostHeight;
      // Cap the width to the columns laid out (specs/cell-model.md "Host
      // sizing"); the companion applies it outside measuring.
      const chromeX =
        cs.boxSizing === "border-box"
          ? padX + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)
          : 0;
      const hostWidth = `${availableCols * metrics.width + chromeX}px`;
      if (this.style.getPropertyValue("--mw-host-w") !== hostWidth)
        this.style.setProperty("--mw-host-w", hostWidth);

      // (7) Reveal the host now that layout is done — kills the FOUC where
      // the browser paints raw flex/block layout before the engine runs.
      if (!this.hasAttribute("data-mw-ready")) this.setAttribute("data-mw-ready", "");
    } finally {
      // The measured real values are about to snap back to the locks —
      // a delta that must never start a native fade (transitions beat
      // `!important`, and a native background fade paints the light-DOM
      // element's box ON TOP of the grid). [settling] holds the
      // transition-property mask up while the snap-back COMMITS: the
      // forced flush consumes every lock delta under the mask, so the
      // unmasked commits that follow (this frame's end included) see no
      // delta and the authored lists stay fully respected.
      this.setAttribute("settling", "");
      this.removeAttribute("measuring");
      void getComputedStyle(this).transitionProperty;
      this.removeAttribute("settling");
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
      // Synthesized transitions (animate.ts): background changes the
      // read detected arm HERE, outside the masks, where the authored
      // `transition-property` list is readable — then the sampling loop
      // drives the fade. A pending change that did NOT arm was painted
      // stale this pass; one more relayout paints its target.
      // The animations the reads found (specs/animations.md): resumed,
      // or begun before this host listened.
      for (const el of drainAnimated(this)) if (!this.#animated.has(el)) this.#follow(el);
      if (resolvePendingTransitions(this)) {
        if (hasSynthesizedTransitions()) {
          this.#lastTransitionRun = performance.now();
          this.#startSamplingLoop();
        } else {
          this.#scheduleLayout();
        }
      }
      // Surroundings, outside the mask so the reads are authored values:
      // the resize signals a capped host needs, and the native scrollers
      // a page-owned wheel sequence may still have room in.
      this.#observeSurroundings();
      this.#outerScrollers = [];
      const scrolling = document.scrollingElement ?? document.documentElement;
      for (let el = this.parentElement; el; el = el.parentElement) {
        if (el === scrolling || /auto|scroll/.test(getComputedStyle(el).overflow)) {
          this.#outerScrollers.push(el);
        }
      }
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

/** An in-flight scrollbar-thumb drag (specs/scrolling.md). */
interface ThumbDrag {
  el: HTMLElement;
  axis: "x" | "y";
  startClient: number;
  startPx: number;
  factor: number;
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
  const ceiling =
    axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  return quantizeScroll(px, ceiling, cellSize, max, base);
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
