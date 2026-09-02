import { hasSynthesizedTransitions, resolvePendingTransitions } from "./animate.ts";
import { leafObservedAttributes, onLeafRegistryChange } from "./leaf.ts";
import { hitChain } from "./pointer.ts";
import { renderPlainText } from "./plain-text.ts";
import { paintGrid } from "./paint.ts";
import { getRootFontSizePx, measureCellMetrics } from "./metrics.ts";
import { layoutRoot } from "./layout.ts";
import { render } from "./render.ts";
import { buildTree, DIRECT_TEXT_DROPPED, hasDirectText } from "./tree.ts";
import type { TextareaWidths } from "./tree.ts";
import { defaultCellStyle, zeroInsets } from "./types.ts";
import type { CellMetrics, LayoutNode } from "./types.ts";

const SHADOW_TEMPLATE = `
<style>
  :host { display: block; position: relative; contain: layout style; }
  #viewport { position: relative; width: 100%; height: 100%; }
  /* When the host hides its own dropped direct text (visibility, see
   * styles.css), the render layer must not sink with it. Scoped to that
   * state so an authored 'invisible' on the host stays intact. */
  :host([data-mw-dropped-text]) #viewport { visibility: visible; }
  /* The unified grid: one <pre> with same-paint-run spans, cell-precise
   * (one monospace character = one cell). In select="grid" (the
   * default, reflected onto the attribute — see DEFAULT_SELECT) the
   * grid catches drags for native selection of the ASCII; interactive
   * elements opt back into pointer-events via styles.css so clicks
   * still work. In select="text" the grid is inert to events and drag
   * selects the light DOM natively. */
  #grid { position: absolute; inset: 0; margin: 0; font: inherit; line-height: inherit; letter-spacing: inherit; white-space: pre; pointer-events: none; user-select: none; -webkit-user-select: none; }
  :host([select="grid"]) #grid { pointer-events: auto; user-select: text; -webkit-user-select: text; }
  :host([select="grid"]) slot { pointer-events: none; user-select: none; -webkit-user-select: none; }
  /* Full invert on selection (TUI-native, matches focus-visible).
   * Both fields spelled out — setting only color makes some engines
   * drop the OS default background. */
  ::selection { color: var(--mw-bg, canvas); background: var(--mw-fg, canvastext); }
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
    // data-mw-active (rules.css retargets the Tailwind variants).
    this.addEventListener("pointermove", this.#onPointerMove);
    this.addEventListener("pointerleave", this.#onPointerLeave);
    this.addEventListener("pointerdown", this.#onPointerDown);
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

  #onPointerMove = (event: Event): void => {
    const { clientX, clientY } = event as PointerEvent;
    this.#hoverClient = { x: clientX, y: clientY };
    // High-frequency path: skip the update while the pointer stays in
    // the same cell (state can only change with the cell — relayouts
    // and scrolls have their own refresh calls).
    const origin = this.#gridOrigin;
    const metrics = this.#cellMetrics;
    if (origin && metrics) {
      const col = Math.floor((clientX - origin.left) / metrics.width);
      const row = Math.floor((clientY - origin.top) / metrics.height);
      if (col === this.#hoverCol && row === this.#hoverRow) return;
    }
    this.#updatePointerStates();
  };

  #onPointerLeave = (): void => {
    this.#hoverClient = null;
    this.#updatePointerStates();
  };

  #onPointerDown = (event: Event): void => {
    const e = event as PointerEvent;
    if (!e.isPrimary || e.button !== 0) return;
    this.#hoverClient = { x: e.clientX, y: e.clientY };
    this.#pressing = true;
    this.#updatePointerStates(true);
  };

  #onPointerUp = (event: Event): void => {
    if (!(event as PointerEvent).isPrimary) return;
    if (!this.#pressing && !this.#pressTarget) return;
    this.#pressing = false;
    this.#pressTarget = null;
    this.#updatePointerStates();
    if (this.#paintHeld) this.#scheduleLayout();
  };

  #onAnyScroll = (): void => {
    if (!this.#hoverClient) return;
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
      if (!this.#gridOrigin) {
        const rect = this.#grid.getBoundingClientRect();
        this.#gridOrigin = { left: rect.left, top: rect.top };
      }
      this.#hoverCol = Math.floor((this.#hoverClient.x - this.#gridOrigin.left) / metrics.width);
      this.#hoverRow = Math.floor((this.#hoverClient.y - this.#gridOrigin.top) / metrics.height);
      chain = hitChain(layout, this.#hoverCol, this.#hoverRow);
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
          this,
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
      // on the host stays outside the grid (the shadow #viewport, which
      // laid-out children position against, already sits inside it).
      // clientWidth excludes the border; subtract the padding ourselves.
      const cs = getComputedStyle(this);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const availableCols = Math.max(0, Math.floor((this.clientWidth - padX) / metrics.width));
      if (availableCols === 0) return;

      // (3) Build a tree from the light DOM. Root is a virtual container
      // over the light-DOM children so we can lay them out as a block.
      const rootFontSizePx = getRootFontSizePx();
      const childNodes: LayoutNode[] = [];
      for (const child of Array.from(this.children)) {
        if (child === this.#probe) continue;
        const node = buildTree(child, rootFontSizePx, metrics, textareaWidths);
        if (node) childNodes.push(node);
      }
      // The host is a container like any other: direct text on it can't
      // be laid out — hide it and warn (cell-model deviation), same as
      // tree.ts does for nested containers.
      if (hasDirectText(this)) {
        if (!this.hasAttribute("data-mw-dropped-text")) {
          console.warn(`[monowind] ${DIRECT_TEXT_DROPPED}`, this);
        }
        this.setAttribute("data-mw-dropped-text", "");
      } else {
        this.removeAttribute("data-mw-dropped-text");
      }
      if (childNodes.length === 0) {
        this.#grid.replaceChildren();
        this.#lastLayout = null;
        this.setAttribute("data-mw-ready", "");
        return;
      }
      const virtualRoot: LayoutNode = {
        source: this,
        style: defaultCellStyle(),
        children: childNodes,
        text: "",
        intrinsicWidth: 0,
        intrinsicHeight: 0,
        localRect: { x: 0, y: 0, width: 0, height: 0 },
        unclampedHeight: 0,
        resolvedPadding: zeroInsets(),
      };

      // (4) Compute integer layout.
      const { height } = layoutRoot(virtualRoot, availableCols);

      // (5) Write geometry to light DOM + paint the shadow grid. Do this
      // before clearing the measuring attribute so the browser only
      // paints the final state.
      render(virtualRoot);
      // Style-only paints patch nodes in place (drag anchors survive);
      // a STRUCTURAL rebuild while a primary press holds a selection
      // anchor in the grid is deferred to release — a drag in flight
      // re-derives from the browser's internal anchor, which the
      // rebuild would destroy (Chromium collapses even across a
      // capture-and-restore).
      this.#paintHeld = !paintGrid(virtualRoot, this.#grid, this.#pressing);
      this.#lastLayout = virtualRoot;

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
