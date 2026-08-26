import { getRootFontSizePx, measureCellMetrics } from "./metrics.ts";
import { layoutRoot } from "./layout.ts";
import { render } from "./render.ts";
import { buildTree } from "./tree.ts";
import { defaultCellStyle } from "./types.ts";
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

export class MonoWindElement extends HTMLElement {
  #shadow: ShadowRoot;
  #decorations: HTMLElement;
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

    if (document.fonts?.ready) {
      document.fonts.ready
        .then(() => {
          this.#cellMetrics = null; // font may have changed dimensions
          this.#scheduleLayout();
        })
        .catch((err: unknown) => {
          console.warn("[monowind] document.fonts.ready failed:", err);
        });
    }

    this.#scheduleLayout();
  }

  disconnectedCallback(): void {
    this.#resizeObserver?.disconnect();
    this.#mutationObserver?.disconnect();
    this.#resizeObserver = null;
    this.#mutationObserver = null;
    // Invalidate metrics — if the element is re-connected somewhere else,
    // the surrounding font/size may differ.
    this.#cellMetrics = null;
  }

  #isOwnedMutation = (record: MutationRecord): boolean => {
    if (record.type !== "attributes") return false;
    const name = record.attributeName;
    if (name === "data-mw-laid-out") return true;
    if (name === "data-mw-ready") return true;
    if (name === "data-mw-text-align-blocked") return true;
    if (name === "data-mw-clip") return true;
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
    // and (b) setting the `measuring` attribute. Anything the engine writes
    // to the light DOM during this phase — geometry vars, data-mw-*
    // attributes, decoration DOM — is either filtered by the counter or
    // drained via takeRecords() at the end. The counter can slightly
    // over-filter (a third-party script mutating in the same task would
    // also be swallowed); that's an accepted trade-off for MVP.
    this.#suppressMutations++;
    this.setAttribute("measuring", "");
    try {
      // (1) Cell metrics — cached; invalidated by disconnected callback
      // (implicit) and by document.fonts.ready.
      if (!this.#cellMetrics) {
        this.#cellMetrics = measureCellMetrics(this);
        this.style.setProperty("--mw-cw", `${this.#cellMetrics.width}px`);
        this.style.setProperty("--mw-ch", `${this.#cellMetrics.height}px`);
      }
      const metrics = this.#cellMetrics;

      // (2) Available cells from host's padding-box (clientWidth, not
      // getBoundingClientRect().width — the former excludes any user-set
      // border/padding on the host itself).
      const availableCols = Math.max(0, Math.floor(this.clientWidth / metrics.width));
      if (availableCols === 0) return;

      // (3) Build a tree from the light DOM. Root is a virtual container
      // over the light-DOM children so we can lay them out as a block.
      const rootFontSizePx = getRootFontSizePx();
      const childNodes: LayoutNode[] = [];
      for (const child of Array.from(this.children)) {
        const node = buildTree(child, rootFontSizePx);
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
      };

      // (4) Compute integer layout.
      const { height } = layoutRoot(virtualRoot, availableCols);

      // (5) Write geometry + paint decorations. Do this before clearing the
      // measuring attribute so the browser only paints the final state.
      render(virtualRoot, this.#decorations);

      // (6) Size the host to match content rows (content-driven height).
      this.style.height = `${height * metrics.height}px`;

      // (7) Reveal the host now that layout is done — kills the FOUC where
      // the browser paints raw flex/block layout before the engine runs.
      this.setAttribute("data-mw-ready", "");
    } finally {
      this.removeAttribute("measuring");
      // Flush pending mutation records that our own writes caused before
      // re-enabling observation. Microtask ordering isn't strictly
      // guaranteed here (see note at top of #performLayout).
      queueMicrotask(() => {
        this.#mutationObserver?.takeRecords();
        this.#suppressMutations--;
      });
    }
  }
}

/** Register the <mono-wind> element (idempotent). */
export function defineMonoWind(): void {
  if (customElements.get("mono-wind")) return;
  customElements.define("mono-wind", MonoWindElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "mono-wind": MonoWindElement;
  }
}
