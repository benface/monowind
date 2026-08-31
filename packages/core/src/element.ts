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
   * (one monospace character = one cell). In select="grid" the grid
   * catches drags for native selection of the ASCII; interactive
   * elements opt back into pointer-events via styles.css so clicks
   * still work. In default select="text" the grid is inert to events
   * and drag selects the light DOM natively. */
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

const DYNAMIC_RELAYOUT_EVENTS = [
  "pointerover",
  "pointerleave",
  "focusin",
  "focusout",
  "input",
  "change",
] as const;

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
    // Before the observers connect, so its insertion isn't observed.
    if (this.#probe.parentNode !== this) this.appendChild(this.#probe);

    this.#resizeObserver = new ResizeObserver(() => this.#scheduleLayout());
    this.#resizeObserver.observe(this);
    // Viewport-relative lengths (h-screen, h-[95dvh], …) read
    // window.innerWidth/Height at layout time; a window resize that
    // doesn't change the HOST's size (height-only, typically) would
    // otherwise never retrigger them.
    window.addEventListener("resize", this.#onWindowResize);

    // Any surviving record is a user mutation: everything the engine
    // writes happens synchronously inside #performLayout and is drained
    // there before observation resumes.
    this.#mutationObserver = new MutationObserver(() => this.#scheduleLayout());
    this.#mutationObserver.observe(this, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      // colspan/rowspan/span are layout inputs too (specs/table.md).
      attributeFilter: ["class", "style", "colspan", "rowspan", "span"],
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

    MonoWindElement.#watchHead(this);
    this.#scheduleLayout();
  }

  disconnectedCallback(): void {
    window.removeEventListener("resize", this.#onWindowResize);
    this.#resizeObserver?.disconnect();
    this.#mutationObserver?.disconnect();
    this.#resizeObserver = null;
    this.#mutationObserver = null;
    document.fonts?.removeEventListener("loadingdone", this.#onFontsLoaded);
    for (const evt of DYNAMIC_RELAYOUT_EVENTS) {
      this.removeEventListener(evt, this.#scheduleDynamicRelayout);
    }
    MonoWindElement.#unwatchHead(this);
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
    if (name === "select" && next !== null && next !== "text" && next !== "grid") {
      console.warn(
        `[monowind] Ignoring unrecognized select="${next}". Expected "text" (default) or "grid".`,
        this,
      );
    }
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
      // the values change.
      const metrics = measureCellMetrics(this, this.#probe);
      const previous = this.#cellMetrics;
      if (
        previous === null ||
        previous.width !== metrics.width ||
        previous.height !== metrics.height ||
        previous.letterSpacing !== metrics.letterSpacing
      ) {
        this.style.setProperty("--mw-cw", `${metrics.width}px`);
        this.style.setProperty("--mw-ch", `${metrics.height}px`);
        this.style.setProperty("--mw-rls", `${metrics.letterSpacing}px`);
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
      paintGrid(virtualRoot, this.#grid);
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
      this.removeAttribute("measuring");
      // Drain the records our own writes queued (takeRecords is
      // synchronous). Deferring this to a microtask would open a window
      // where a USER mutation gets dropped with the engine's own.
      this.#mutationObserver?.takeRecords();
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
