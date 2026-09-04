import { hasSynthesizedTransitions, resolvePendingTransitions } from "./animate.ts";
import { onGlyphRegistryChange } from "./glyphs.ts";
import { leafObservedAttributes, leafRendererFor, onLeafRegistryChange } from "./leaf.ts";
import { hitChain, hitStack } from "./pointer.ts";
import { charIndexAtCell, renderPlainText, scrollbarGeometry, thumbSpan } from "./plain-text.ts";
import {
  classifySelection,
  comparePoints,
  isTextLeaf,
  leafExtent,
  positionOf,
  selectionRangeThrough,
  serializeSelection,
  wordAt,
} from "./selection.ts";
import type { BoundaryPoints } from "./selection.ts";
import { nodeAtOffset, paintGrid } from "./paint.ts";
import { getRootFontSizePx, measureCellMetrics } from "./metrics.ts";
import { layoutRoot } from "./layout.ts";
import { render } from "./render.ts";
import { buildRootLeaf, buildTree, DIRECT_TEXT_DROPPED, hasDirectText } from "./tree.ts";
import type { TextareaWidths } from "./tree.ts";
import { defaultCellStyle, zeroInsets } from "./types.ts";
import { warnSubject } from "./warn.ts";
import type { CellMetrics, LayoutNode } from "./types.ts";

const SHADOW_TEMPLATE = `
<style>
  :host { display: block; position: relative; contain: layout style; }
  #viewport { position: relative; width: 100%; height: 100%; background: inherit; }
  /* The slot as a positioned box: the light DOM paints ABOVE the grid
   * (the elements are absolute; the host's own in-flow text, specs/host-leaf.md,
   * would otherwise sit under the <pre> and lose its selection ink) and
   * laid-out elements position against it — the same origin as #viewport. */
  slot { display: block; position: relative; }
  /* The host's own dropped direct text (specs/cell-model.md deviation 7)
   * hides through the slot; laid-out children re-declare visible in
   * styles.css. */
  :host([data-mw-dropped-text]) slot { visibility: hidden; }
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
  #grid { position: absolute; top: 0; left: 0; margin: 0; background: inherit; font: inherit; line-height: inherit; letter-spacing: inherit; white-space: pre; pointer-events: none; user-select: none; -webkit-user-select: none; -webkit-text-fill-color: currentColor; }
  :host([select="grid"]) #grid { pointer-events: auto; user-select: text; -webkit-user-select: text; }
  :host([select="grid"]) slot { pointer-events: none; user-select: none; -webkit-user-select: none; }
  /* A live semantic selection (specs/semantic-selection.md) lifts the
   * lock so the element selection copies; pointer events stay off. */
  :host([select="grid"][data-mw-semantic-selection]) slot { user-select: text; -webkit-user-select: text; }
  /* Selection invert — mirror of the canonical rule in styles.css
   * (which explains the field choices); update together. */
  ::selection { color: var(--mw-bg, canvas); text-shadow: 0 0 0 var(--mw-bg, canvas); background: var(--mw-fg, canvastext); }
</style>
<div id="viewport">
  <pre id="grid" aria-hidden="true"></pre>
  <slot></slot>
</div>
`;

/** The `select` attribute's default, reflected onto the attribute when
 * it is absent or unrecognized so every stylesheet keys on an explicit
 * value — the single place the default lives. */
const DEFAULT_SELECT = "grid";

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

interface SemanticGesture {
  unit: "word" | "paragraph";
  anchor: SelectionUnit;
}

/** Light elements that legitimately receive pointer events in grid
 * mode — the styles.css opt-in list. Any other light target got the
 * event by a browser quirk (Firefox hit-tests a multicol spanner's
 * anonymous wrapper as its container despite pointer-events: none)
 * and is handled as a grid event at the same coordinates. */
const INTERACTIVE = "a, button, input, select, textarea, label, [tabindex], [role='button']";

const DYNAMIC_RELAYOUT_EVENTS = [
  "pointerover",
  "pointerleave",
  // `:active` styles (`active:opacity-50`) need a repaint on both edges
  // of a press — pointer and keyboard (Space/Enter activation).
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
 * under the text-fill lock, and nothing locks border colors or opacity.
 * Lock-owned properties (backgrounds, decoration color, geometry) are
 * snapped by the measuring/settling `transition-property` allow-list
 * instead — keep the two in sync (styles.css "Lock toggles must
 * never…"). */
const SAMPLED_TRANSITION = /^(color|opacity|border-(top|right|bottom|left)-color|border-color)$/;

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
/** Settle debounce where `scrollend` is missing (older Safari). */
const SETTLE_FALLBACK_MS = 160;

// Import-safe outside the browser (SSR, Node scripts using renderPlainText):
// `HTMLElement` doesn't exist there, and a bare `extends HTMLElement` throws
// at IMPORT time. Substitute an inert base — the class is only instantiated
// by the browser after defineMonoWind(), which no-ops without a DOM.
const HTMLElementBase = (
  typeof HTMLElement === "undefined" ? class {} : HTMLElement
) as typeof HTMLElement;

export class MonoWindElement extends HTMLElementBase {
  static observedAttributes = ["select"];

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
  #grid: HTMLElement;
  #probe: HTMLElement;
  #resizeObserver: ResizeObserver | null = null;
  #mutationObserver: MutationObserver | null = null;
  #layoutPending = false;
  #cellMetrics: CellMetrics | null = null;
  #lastLayout: LayoutNode | null = null;
  #unsubscribeLeafRegistry: (() => void) | null = null;
  #unsubscribeGlyphRegistry: (() => void) | null = null;
  #paintPending = false;
  /** Scroll containers of the LAST layout (specs/scrolling.md). */
  #scrollNodes: LayoutNode[] = [];
  #settleTimers = new Map<Element, ReturnType<typeof setTimeout>>();
  /** Last routed-wheel activity per scroll container: each scrollBy is a separate
   * PROGRAMMATIC scroll, so the browser fires scrollend between wheel
   * ticks — mid-gesture settles would keep snapping small deltas back
   * (the "resistance"). Recent activity suppresses them; the wheel
   * quiesce timer settles instead. */
  #routedWheelAt = new WeakMap<Element, number>();
  /** What the current wheel gesture is LATCHED to — a scroll container, or the
   * page (`el: null`): chaining is a gesture-START decision (native
   * scroll-chaining semantics), so mid-gesture boundary hits stay on
   * the scroll container and a scroll container sliding under the pointer never captures a
   * page gesture. `mag`/`decayed` track the delta trend (see
   * #onWheel). */
  #wheelLatch: WheelLatch | null = null;
  #thumbDrag: ThumbDrag | null = null;
  /** The last primary pointerdown's type: a `mousedown` counts as a
   * semantic gesture only after a mouse or pen (a tap's compatibility
   * mousedown follows a touch pointerdown). */
  #lastPointerType = "";
  #semanticGesture: SemanticGesture | null = null;
  /** An engine-driven grid drag, anchored at a flat text offset: the
   * fallback when a plain mousedown lands on a phantom light target
   * (see INTERACTIVE), where no native selection can start. */
  #gridDrag: { anchor: number } | null = null;
  /** A primary press that landed on the grid: the first pointermove with
   * the button down marks the host `data-mw-dragging`, which drops
   * interactive light elements' pointer events so a native drag sweeps
   * through their cells instead of stalling at their edge. */
  #pressOnGrid = false;
  /** Native scrollers outside the host (ancestors with scrollable
   * overflow, then the page), collected per layout so a wheel tick
   * never reads computed styles (see #outsideCanScroll). */
  #outerScrollers: Element[] = [];

  /** (Re-)observe the light DOM; re-run when the leaf registry adds
   * observed attributes to the filter. `observe` on the same target
   * replaces the previous options in place. */
  #observeLightDom(): void {
    this.#mutationObserver?.observe(this, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      // colspan/rowspan/span are layout inputs too (specs/table.md);
      // leaf renderers declare theirs at registration.
      attributeFilter: [
        "class",
        "style",
        "colspan",
        "rowspan",
        "span",
        ...leafObservedAttributes(),
      ],
    });
  }

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    this.#shadow.innerHTML = SHADOW_TEMPLATE;
    this.#grid = this.#shadow.getElementById("grid") as HTMLElement;
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
  }

  connectedCallback(): void {
    // attributeChangedCallback only fires on changes; an absent
    // attribute reflects its default here.
    if (!this.hasAttribute("select")) this.setAttribute("select", DEFAULT_SELECT);
    // Before the observers connect, so its insertion isn't observed.
    if (this.#probe.parentNode !== this) this.appendChild(this.#probe);

    this.#resizeObserver = new ResizeObserver(() => this.#scheduleLayout());
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

    // Any surviving record is a user mutation: everything the engine
    // writes happens synchronously inside #performLayout and is drained
    // there before observation resumes.
    this.#mutationObserver = new MutationObserver(() => this.#scheduleLayout());
    this.#observeLightDom();
    // Leaf renderers (specs/leaf-renderers.md): a registration or
    // invalidation after this host's first layout must repaint it, and
    // new observed attributes must join the filter.
    this.#unsubscribeLeafRegistry = onLeafRegistryChange(() => {
      this.#observeLightDom();
      this.#scheduleLayout();
    });
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
    document.addEventListener("selectionchange", this.#onSelectionChange);
    // Release on the window: a selection drag routinely ends outside
    // the host, and the press state must thaw wherever it ends.
    window.addEventListener("pointerup", this.#onPointerUp);
    window.addEventListener("pointercancel", this.#onPointerUp);
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
    this.#resizeObserver = null;
    this.#mutationObserver = null;
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
    this.#activeTransitions = 0;
    this.removeEventListener("pointermove", this.#onPointerMove);
    this.removeEventListener("pointerleave", this.#onPointerLeave);
    this.removeEventListener("pointerdown", this.#onPointerDown);
    this.removeEventListener("scroll", this.#onScroll, { capture: true });
    this.removeEventListener("scrollend", this.#onScrollEnd, { capture: true });
    this.removeEventListener("wheel", this.#onWheel);
    this.removeEventListener("copy", this.#onCopy);
    this.removeEventListener("mousedown", this.#onMouseDown);
    document.removeEventListener("selectionchange", this.#onSelectionChange);
    for (const timer of this.#settleTimers.values()) clearTimeout(timer);
    this.#settleTimers.clear();
    this.#thumbDrag = null;
    this.#wheelLatch = null;
    window.removeEventListener("pointerup", this.#onPointerUp);
    window.removeEventListener("pointercancel", this.#onPointerUp);
    document.removeEventListener("scroll", this.#onAnyScroll, { capture: true });
    this.#hoverClient = null;
    this.#pressTarget = null;
    this.#pressing = false;
    this.#paintHeld = false;
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
      this.#paintHeld = !paintGrid(this.#lastLayout, this.#grid, this.#holdsNativeDrag());
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
        x,
        y,
        pinX: maxX > 0 && x >= maxX,
        pinY: maxY > 0 && y >= maxY,
      });
    }
    return snapshot;
  }

  /** Write the snapshot back after the unmask (pins to the native
   * ceiling — the new max). Firefox and WebKit hold post-reflow scroll
   * clamping in a lazy state where a write that looks like the
   * pre-clamp value coalesces with the pending clamp into "no
   * change" — no scroll event, and the container desyncs. Reading
   * FIRST commits the clamp, so the write is a real change (same-value
   * writes are no-ops). */
  #restoreScrollPositions(snapshot: ScrollSnapshot): void {
    for (const node of this.#scrollNodes) {
      const el = node.source as HTMLElement;
      const entry = snapshot.get(el);
      if (!entry) continue;
      void el.scrollTop;
      void el.scrollLeft;
      el.scrollTop = entry.pinY ? el.scrollHeight : entry.top;
      el.scrollLeft = entry.pinX ? el.scrollWidth : entry.left;
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
    this.#schedulePaint();
    // Routed wheel ticks keep their own quiesce timer (#onWheel).
    if (Date.now() - (this.#routedWheelAt.get(target) ?? 0) < WHEEL_QUIESCE_MS) return;
    // Still scrolling: a pending settle waits; without scrollend
    // (older Safari) the pause after the last event settles instead.
    clearTimeout(this.#settleTimers.get(target));
    if (!("onscrollend" in window)) this.#settleAfter(target, SETTLE_FALLBACK_MS);
  };

  #onScrollEnd = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === this) return;
    if (!target.hasAttribute("data-mw-scroll")) return;
    // Mid-gesture scrollends: routed wheel ticks and thumb drags
    // settle on quiesce/release instead (see #routedWheelAt).
    if (Date.now() - (this.#routedWheelAt.get(target) ?? 0) < WHEEL_QUIESCE_MS) return;
    this.#settleAfter(target, SETTLE_QUIESCE_MS);
  };

  /** Snap the native position to the cell the grid already SHOWS
   * (the same quantization as the paint) — never a different cell,
   * or the grid would visibly jump after the gesture. Idempotent: its
   * own scroll event changes no cell. The max cell settles on the
   * native CEILING, not the multiple: leftover native room would
   * latch the next text-mode gesture to an invisible scroll instead
   * of chaining. */
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
    // The painted cell: the settle lands where the grid already is.
    const cells = node.scroll ?? this.#quantize(node, metrics);
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
    const canMove = (node: LayoutNode): boolean => {
      const range = node.scrollRange!;
      const el = node.source as HTMLElement;
      if (dy !== 0 && range.maxY > 0) {
        if (
          (dy > 0 && el.scrollTop < el.scrollHeight - el.clientHeight - 0.5) ||
          (dy < 0 && el.scrollTop > 0.5)
        )
          return true;
      }
      if (dx !== 0 && range.maxX > 0) {
        if (
          (dx > 0 && el.scrollLeft < el.scrollWidth - el.clientWidth - 0.5) ||
          (dx < 0 && el.scrollLeft > 0.5)
        )
          return true;
      }
      return false;
    };
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
        if (!node.scrollRange) continue;
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
    const el = target.source as HTMLElement;
    const range = target.scrollRange!;
    const apply: ScrollToOptions = { behavior: "instant" };
    if (dy !== 0 && range.maxY > 0) apply.top = dy;
    if (dx !== 0 && range.maxX > 0) apply.left = dx;
    el.scrollBy(apply);
    // One gesture, not N programmatic scrolls: suppress the per-tick
    // scrollend settles and settle after quiesce.
    this.#routedWheelAt.set(el, now);
    this.#settleAfter(el, WHEEL_QUIESCE_MS);
  };

  /** Whether a native scroller outside the host has room in the
   * delta's direction (offset reads only — the list is per layout). */
  #outsideCanScroll(dx: number, dy: number): boolean {
    return this.#outerScrollers.some(
      (el) =>
        (dy > 0 && el.scrollTop < el.scrollHeight - el.clientHeight - 0.5) ||
        (dy < 0 && el.scrollTop > 0.5) ||
        (dx > 0 && el.scrollLeft < el.scrollWidth - el.clientWidth - 0.5) ||
        (dx < 0 && el.scrollLeft > 0.5),
    );
  }

  /** The host's width is capped to whole cells (styles.css), so a
   * growing slot no longer resizes the host: observe the parent (a
   * growing container) and the siblings (a flex or grid slot that
   * grows because a sibling shrank). Re-run per layout — observe() is
   * idempotent, and new siblings join. */
  #observeSurroundings(): void {
    const parent = this.parentElement;
    if (!parent || !this.#resizeObserver) return;
    this.#resizeObserver.observe(parent);
    for (const sibling of parent.children) {
      if (sibling !== this) this.#resizeObserver.observe(sibling);
    }
  }

  /** The grid cell under a client point. The origin is cached until
   * the next layout or page scroll invalidates it. */
  #cellAt(clientX: number, clientY: number, metrics: CellMetrics): { col: number; row: number } {
    if (!this.#gridOrigin) {
      const rect = this.#grid.getBoundingClientRect();
      this.#gridOrigin = { left: rect.left, top: rect.top };
    }
    return {
      col: Math.floor((clientX - this.#gridOrigin.left) / metrics.width),
      row: Math.floor((clientY - this.#gridOrigin.top) / metrics.height),
    };
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
      if (!range) continue;
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
    if (held && this.#semanticGesture)
      this.#extendSemantic(this.#semanticGesture, clientX, clientY);
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

  /** Double- and triple-click on the grid select the element's word or
   * paragraph (specs/semantic-selection.md); a plain click ends a
   * semantic selection's lift synchronously, ahead of selectionchange. */
  #onMouseDown = (event: Event): void => {
    const e = event as MouseEvent;
    if (e.button !== 0 || this.getAttribute("select") !== "grid") return;
    const onGrid = e.composedPath().includes(this.#grid);
    if (!onGrid && !this.#isPhantomTarget(e.target)) return;
    const finePointer = this.#lastPointerType === "mouse" || this.#lastPointerType === "pen";
    if (e.detail <= 1) {
      if (e.detail !== 1) return;
      this.removeAttribute(SEMANTIC_SELECTION);
      // A press that blurs a control inside the host repaints the focus
      // invert — a structural rebuild a native drag anchor would not
      // survive (paintGrid holds those until release). Take such a
      // press over, like a phantom one: blur now, drag through the
      // engine.
      const focused = this.#focusedInside();
      if (finePointer && (!onGrid || focused)) {
        focused?.blur();
        this.#startGridDrag(e);
      }
      return;
    }
    if (!finePointer) return;
    const unit = e.detail === 2 ? "word" : "paragraph";
    const selection = document.getSelection();
    const layout = this.#lastLayout;
    const metrics = this.#cellMetrics;
    if (!selection || !layout || !metrics) return;
    const { col, row } = this.#cellAt(e.clientX, e.clientY, metrics);
    const target = this.#unitAt(col, row, unit);
    if (!target) {
      // No word or paragraph under the cell (a gap, a border, a blank):
      // the browser's own gesture on the grid — a run of glyphs, or the
      // grid line on a triple-click.
      this.removeAttribute(SEMANTIC_SELECTION);
      this.#semanticGesture = null;
      return;
    }
    // Ours from here: no native word/whole-grid selection, no native
    // drag. A canceled mousedown moves no focus, so move it as the
    // click would have (a focused control would otherwise keep the
    // copy command).
    e.preventDefault();
    this.#focusedInside()?.blur();
    this.#liftLock(target);
    // Shift extends the existing element selection from its anchor.
    const anchor: SelectionUnit =
      e.shiftKey && selection.anchorNode && this.#elementSelection()
        ? pointUnit({ node: selection.anchorNode, offset: selection.anchorOffset })
        : target;
    this.#selectThrough(selection, anchor, target);
    this.#semanticGesture = { unit, anchor };
  };

  /** The root as a container over the element children. Direct text on
   * it can't be laid out then — hidden and warned (cell-model deviation),
   * as tree.ts does for nested containers. */
  #buildRootContainer(
    rootFontSizePx: number,
    metrics: CellMetrics,
    textareaWidths: TextareaWidths,
  ): LayoutNode {
    const children: LayoutNode[] = [];
    for (const child of Array.from(this.children)) {
      if (child === this.#probe) continue;
      const node = buildTree(child, rootFontSizePx, metrics, textareaWidths);
      if (node) children.push(node);
    }
    if (hasDirectText(this)) {
      if (!this.hasAttribute("data-mw-dropped-text")) {
        console.warn(`[monowind] ${DIRECT_TEXT_DROPPED}`, warnSubject(this));
      }
      this.setAttribute("data-mw-dropped-text", "");
    } else {
      this.removeAttribute("data-mw-dropped-text");
    }
    return {
      source: this,
      style: defaultCellStyle(),
      children,
      text: "",
      intrinsicWidth: 0,
      intrinsicHeight: 0,
      localRect: { x: 0, y: 0, width: 0, height: 0 },
      unclampedHeight: 0,
      resolvedPadding: zeroInsets(),
    };
  }

  /** The focused element, when it is inside the host. */
  #focusedInside(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body && this.contains(active)
      ? active
      : null;
  }

  /** Structural repaints are held while a NATIVE drag may be in flight
   * (its browser-internal anchor would not survive a rebuild); an
   * engine-driven grid drag re-derives its points from flat offsets and
   * needs no hold. */
  #holdsNativeDrag(): boolean {
    return this.#pressing && !this.#gridDrag;
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

  /** The grid's flat text offset for a cell: every row is painted at the
   * grid's full width (cell-model.md "Selection"), so a row is
   * `width + 1` characters with its newline. */
  #gridOffsetAt(col: number, row: number): number {
    const rows = this.#grid.textContent!.split("\n");
    const width = rows[0]?.length ?? 0;
    const y = Math.max(0, Math.min(row, rows.length - 1));
    return y * (width + 1) + Math.max(0, Math.min(col, width));
  }

  /** The grid text position under a client point: its flat offset and
   * the text node holding it. */
  #gridPointAt(clientX: number, clientY: number): { offset: number; at: [Text, number] } | null {
    const metrics = this.#cellMetrics;
    if (!metrics) return null;
    const { col, row } = this.#cellAt(clientX, clientY, metrics);
    const offset = this.#gridOffsetAt(col, row);
    const at = nodeAtOffset(this.#grid, offset);
    return at && { offset, at };
  }

  #startGridDrag(e: MouseEvent): void {
    const point = this.#gridPointAt(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    document.getSelection()?.setBaseAndExtent(...point.at, ...point.at);
    this.#gridDrag = { anchor: point.offset };
  }

  #extendGridDrag(drag: { anchor: number }, clientX: number, clientY: number): void {
    const base = nodeAtOffset(this.#grid, drag.anchor);
    const point = this.#gridPointAt(clientX, clientY);
    if (base && point) document.getSelection()?.setBaseAndExtent(...base, ...point.at);
  }

  /** Drag extension: the anchor unit through the unit under the pointer,
   * in DOM order (base at the anchor's far edge, so the browser's
   * selection direction matches the drag). */
  #extendSemantic(gesture: SemanticGesture, clientX: number, clientY: number): void {
    const metrics = this.#cellMetrics;
    const selection = document.getSelection();
    if (!metrics || !selection) return;
    const { col, row } = this.#cellAt(clientX, clientY, metrics);
    const current = this.#unitAt(col, row, gesture.unit);
    if (current) this.#selectThrough(selection, gesture.anchor, current);
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
    const from = this.#lightEdges(anchor);
    const to = this.#lightEdges(unit);
    const forward =
      comparePoints(from.start.node, from.start.offset, to.start.node, to.start.offset) <= 0;
    if (forward) selectBetween(selection, from.start, to.end);
    else selectBetween(selection, from.end, to.start);
  }

  /** The word or paragraph under a cell — null unless a CHARACTER of a
   * text leaf is painted there (padding, borders, gaps, and blank tails
   * are the browser's). The innermost hit text leaf; its
   * selectionTarget's contents for a custom leaf; a Segmenter word
   * mapped to DOM positions for the word gesture (falling back to the
   * paragraph where the text has no positions). */
  #unitAt(col: number, row: number, unit: "word" | "paragraph"): SelectionUnit | null {
    const layout = this.#lastLayout;
    if (!layout) return null;
    const stack = hitStack(layout, col, row);
    for (let i = stack.length - 1; i >= 0; i--) {
      const { node, x, y } = stack[i]!;
      if (isTextLeaf(node)) return this.#leafUnit(node, x, y, col, row, unit);
    }
    // The host's own text (specs/host-leaf.md): the root leaf lies under
    // every cell no child covers.
    return isTextLeaf(layout) ? this.#leafUnit(layout, 0, 0, col, row, unit) : null;
  }

  /** The word or paragraph of a text leaf at a cell; null off its
   * characters. A paragraph is the element's contents — a custom leaf's
   * selectionTarget's — or, for the root leaf, the run's own extent (the
   * host's child list also holds the metrics probe). */
  #leafUnit(
    node: LayoutNode,
    x: number,
    y: number,
    col: number,
    row: number,
    unit: "word" | "paragraph",
  ): SelectionUnit | null {
    const index = charIndexAtCell(node, x, y, col, row);
    if (index === null) return null;
    const target = leafRendererFor(node.source.tagName)?.selectionTarget?.(node.source);
    if (unit === "word" && !target) {
      const word = wordAt(node, index);
      const start = word && positionOf(node, word.start);
      const end = word && positionOf(node, word.end);
      if (start && end) return { start, end };
    }
    if (node === this.#lastLayout) return leafExtent(node);
    const container = target ?? node.source;
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
    const range = selectionRangeThrough(this.#grid.getRootNode() as ShadowRoot);
    if (!range || classifySelection(this, this.#grid, range) !== "light") return null;
    const collapsed =
      range.startContainer === range.endContainer && range.startOffset === range.endOffset;
    return collapsed ? null : range;
  }

  /** The lift ends once the selection left the light DOM or collapsed. */
  #onSelectionChange = (): void => {
    if (!this.hasAttribute(SEMANTIC_SELECTION)) return;
    if (!this.#elementSelection()) this.removeAttribute(SEMANTIC_SELECTION);
  };

  #onPointerLeave = (): void => {
    this.#hoverClient = null;
    this.#updatePointerStates();
  };

  #onPointerDown = (event: Event): void => {
    const e = event as PointerEvent;
    if (!e.isPrimary || e.button !== 0) return;
    this.#lastPointerType = e.pointerType;
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
    this.#pressOnGrid = e.composedPath().includes(this.#grid);
    this.#updatePointerStates(true);
  };

  #onPointerUp = (event: Event): void => {
    if (!(event as PointerEvent).isPrimary) return;
    this.#semanticGesture = null;
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

  #onAnyScroll = (event: Event): void => {
    if (!this.#hoverClient) return;
    // Container scrolls are #onScroll's: hover refreshes in the paint frame
    // AFTER the offsets sync (a per-event refresh here would read
    // stale offsets), and a container's scroll never moves the grid itself.
    const target = event.target;
    if (target instanceof HTMLElement && target.hasAttribute("data-mw-scroll")) return;
    this.#gridOrigin = null;
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
    this.#grid.style.cursor = cursor === "auto" ? "" : cursor;
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
  #samplingLoopRunning = false;
  #lastTransitionRun = 0;

  #onTransitionRun = (event: Event): void => {
    if (!SAMPLED_TRANSITION.test((event as TransitionEvent).propertyName)) return;
    this.#activeTransitions++;
    this.#lastTransitionRun = performance.now();
    this.#startSamplingLoop();
  };

  #onTransitionDone = (event: Event): void => {
    if (!SAMPLED_TRANSITION.test((event as TransitionEvent).propertyName)) return;
    this.#activeTransitions = Math.max(0, this.#activeTransitions - 1);
  };

  #startSamplingLoop(): void {
    if (this.#samplingLoopRunning) return;
    this.#samplingLoopRunning = true;
    const tick = (): void => {
      if (
        !this.isConnected ||
        (this.#activeTransitions === 0 && !hasSynthesizedTransitions()) ||
        performance.now() - this.#lastTransitionRun > SAMPLING_VALVE_MS
      ) {
        this.#samplingLoopRunning = false;
        this.#activeTransitions = 0;
        // One final settle pass so the grid lands exactly on the
        // transitions' target values.
        this.#scheduleLayout();
        return;
      }
      this.#performLayoutSafely();
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
    requestAnimationFrame(() => this.#scheduleLayout());
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
    if (this.#layoutPending) return;
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
    const cellWidth = getComputedStyle(this).getPropertyValue("--mw-cw").trim();
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
        previous.inkOverhang !== metrics.inkOverhang
      ) {
        this.style.setProperty("--mw-cw", `${metrics.width}px`);
        this.style.setProperty("--mw-ch", `${metrics.height}px`);
        this.style.setProperty("--mw-rls", `${metrics.letterSpacing}px`);
        this.style.setProperty("--mw-ink", `${metrics.inkOverhang ?? 0}px`);
      }
      this.#cellMetrics = metrics;

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
      // child the root is a virtual container over the element children.
      const rootFontSizePx = getRootFontSizePx();
      const virtualRoot =
        buildRootLeaf(this, rootFontSizePx, metrics, textareaWidths) ??
        this.#buildRootContainer(rootFontSizePx, metrics, textareaWidths);

      // (4) Compute integer layout.
      const { height } = layoutRoot(virtualRoot, availableCols);

      // (5) Write geometry to light DOM + paint the shadow grid. Do this
      // before clearing the measuring attribute so the browser only
      // paints the final state.
      render(virtualRoot);
      this.#scrollNodes = collectScrollContainers(virtualRoot);
      this.#syncScrollOffsets(metrics, scrollState);
      // Style-only paints patch nodes in place (drag anchors survive);
      // a STRUCTURAL rebuild while a primary press holds a selection
      // anchor in the grid is deferred to release — a drag in flight
      // re-derives from the browser's internal anchor, which the
      // rebuild would destroy (Chromium collapses even across a
      // capture-and-restore).
      this.#paintHeld = !paintGrid(virtualRoot, this.#grid, this.#holdsNativeDrag());
      this.#lastLayout = virtualRoot;
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
 * px, the cells they meant under the OLD range, and end pins. */
type ScrollSnapshot = Map<
  HTMLElement,
  { top: number; left: number; x: number; y: number; pinX: boolean; pinY: boolean }
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
