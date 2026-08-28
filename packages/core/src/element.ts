import { getRootFontSizePx, measureCellMetrics } from "./metrics.ts";
import { layoutRoot } from "./layout.ts";
import { render } from "./render.ts";
import { buildTree } from "./tree.ts";
import { defaultCellStyle, zeroInsets } from "./types.ts";
import type { CellMetrics, LayoutNode } from "./types.ts";

const SHADOW_TEMPLATE = `
<style>
  :host { display: block; position: relative; contain: layout style; }
  #viewport { position: relative; width: 100%; height: 100%; }
  #decorations { position: absolute; inset: 0; pointer-events: none; user-select: none; white-space: pre; }
</style>
<div id="viewport">
  <div id="decorations" aria-hidden="true"></div>
  <slot></slot>
</div>
`;

// Import-safe outside the browser (SSR, Node scripts using renderAscii):
// `HTMLElement` doesn't exist there, and a bare `extends HTMLElement` throws
// at IMPORT time. Substitute an inert base — the class is only instantiated
// by the browser after defineMonoWind(), which no-ops without a DOM.
const HTMLElementBase = (
  typeof HTMLElement === "undefined" ? class {} : HTMLElement
) as typeof HTMLElement;

export class MonoWindElement extends HTMLElementBase {
  #shadow: ShadowRoot;
  #decorations: HTMLElement;
  #probe: HTMLElement;
  #resizeObserver: ResizeObserver | null = null;
  #mutationObserver: MutationObserver | null = null;
  #layoutPending = false;
  #cellMetrics: CellMetrics | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    this.#shadow.innerHTML = SHADOW_TEMPLATE;
    this.#decorations = this.#shadow.getElementById("decorations") as HTMLElement;
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

    // Any surviving record is a user mutation: everything the engine
    // writes happens synchronously inside #performLayout and is drained
    // there before observation resumes.
    this.#mutationObserver = new MutationObserver(() => this.#scheduleLayout());
    this.#mutationObserver.observe(this, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style"],
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

    this.#scheduleLayout();
  }

  disconnectedCallback(): void {
    this.#resizeObserver?.disconnect();
    this.#mutationObserver?.disconnect();
    this.#resizeObserver = null;
    this.#mutationObserver = null;
    document.fonts?.removeEventListener("loadingdone", this.#onFontsLoaded);
  }

  #onFontsLoaded = (): void => {
    // Defer a frame: rAF callbacks run BEFORE the style recalc that
    // applies a freshly loaded font, so an immediate layout could measure
    // the PRE-swap fallback metrics when the event and the swap land in
    // the same frame (seen consistently on slow CI runners). One frame
    // later the swap has rendered; #scheduleLayout adds its own rAF.
    requestAnimationFrame(() => this.#scheduleLayout());
  };

  #scheduleLayout(): void {
    if (this.#layoutPending) return;
    this.#layoutPending = true;
    requestAnimationFrame(() => {
      this.#layoutPending = false;
      try {
        this.#performLayout();
      } catch (err) {
        console.error("[monowind] layout failed:", err);
      }
    });
  }

  #performLayout(): void {
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
        const node = buildTree(child, rootFontSizePx, metrics);
        if (node) childNodes.push(node);
      }
      if (childNodes.length === 0) {
        this.#decorations.replaceChildren();
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

      // (5) Write geometry + paint decorations. Do this before clearing the
      // measuring attribute so the browser only paints the final state.
      render(virtualRoot, this.#decorations);

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
      this.style.height = `${height * metrics.height + chrome}px`;

      // (7) Reveal the host now that layout is done — kills the FOUC where
      // the browser paints raw flex/block layout before the engine runs.
      this.setAttribute("data-mw-ready", "");
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
