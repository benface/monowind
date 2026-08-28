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
  /* Cell-metrics probe (see measureCellMetrics): inherits the host's font,
   * line-height, and letter-spacing; hidden but measurable. Light-DOM
   * companion rules don't reach into the shadow root, so it always shows
   * authored typography. */
  #probe { position: absolute; top: 0; left: 0; visibility: hidden; pointer-events: none; user-select: none; white-space: pre; }
</style>
<div id="viewport">
  <div id="decorations" aria-hidden="true"></div>
  <slot></slot>
</div>
<div id="probe" aria-hidden="true">${"M".repeat(100)}</div>`;

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
  #suppressMutations = 0;
  #cellMetrics: CellMetrics | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    this.#shadow.innerHTML = SHADOW_TEMPLATE;
    this.#decorations = this.#shadow.getElementById("decorations") as HTMLElement;
    this.#probe = this.#shadow.getElementById("probe") as HTMLElement;
  }

  connectedCallback(): void {
    this.#resizeObserver = new ResizeObserver(() => this.#scheduleLayout());
    this.#resizeObserver.observe(this);

    this.#mutationObserver = new MutationObserver((records) => {
      if (this.#suppressMutations > 0) return;
      if (records.every(this.#isOwnedMutation)) return;
      // A class or style change on the host itself can shift font metrics
      // (font-size, font-family, letter-spacing). Invalidate the cache so
      // the next layout re-measures.
      if (records.some((r) => r.target === this && r.type === "attributes")) {
        this.#cellMetrics = null;
      }
      this.#scheduleLayout();
    });
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
    // Invalidate metrics — if the element is re-connected somewhere else,
    // the surrounding font/size may differ.
    this.#cellMetrics = null;
  }

  #onFontsLoaded = (): void => {
    // Defer the re-measure by a frame: rAF callbacks run BEFORE the style
    // recalc that applies a freshly loaded font, so invalidating and
    // measuring straight away can capture the PRE-swap (fallback) metrics
    // when the load event and the swap land in the same frame (seen
    // consistently on slow CI runners). One frame later the swap has
    // rendered; #scheduleLayout adds its own rAF after that.
    requestAnimationFrame(() => {
      this.#cellMetrics = null; // font may have changed dimensions
      this.#scheduleLayout();
    });
  };

  #isOwnedMutation = (record: MutationRecord): boolean => {
    if (record.type !== "attributes") return false;
    const name = record.attributeName;
    if (name === "data-mw-laid-out") return true;
    if (name === "data-mw-ready") return true;
    if (name === "data-mw-text-align-blocked") return true;
    if (name === "data-mw-clip") return true;
    if (name === "data-mw-nowrap") return true;
    if (name === "data-mw-inline-inset") return true;
    // Style attribute mutations are hard to filter precisely from the record
    // alone (we can't tell which property was set). Rely on the counter that
    // brackets our write phase — if we're inside it, treat as owned.
    if (name === "style") return this.#suppressMutations > 0;
    return false;
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
    // The write phase is bracketed by (a) incrementing #suppressMutations
    // and (b) setting the `measuring` attribute. Everything the engine
    // writes to the light DOM during this phase — geometry vars, data-mw-*
    // attributes, decoration DOM — happens synchronously, so a synchronous
    // takeRecords() at the end drains exactly our own records. Observation
    // resumes the moment #performLayout returns: a user mutation in the
    // same task (right after a layout) is seen normally.
    this.#suppressMutations++;
    this.setAttribute("measuring", "");
    try {
      // (1) Cell metrics — cached; invalidated on disconnect, on font
      // loads, and on class/style changes to the host itself.
      if (!this.#cellMetrics) {
        this.#cellMetrics = measureCellMetrics(this, this.#probe);
        this.style.setProperty("--mw-cw", `${this.#cellMetrics.width}px`);
        this.style.setProperty("--mw-ch", `${this.#cellMetrics.height}px`);
        this.style.setProperty("--mw-rls", `${this.#cellMetrics.letterSpacing}px`);
      }
      const metrics = this.#cellMetrics;

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
      // synchronous) and resume observation. Deferring this to a microtask
      // would open a window where a USER mutation gets swallowed as
      // engine-owned and never triggers a relayout.
      this.#mutationObserver?.takeRecords();
      this.#suppressMutations--;
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
