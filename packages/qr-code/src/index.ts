/**
 * `@monowind/qr-code` — QR codes on the monowind grid: the `<mono-qr>`
 * element, a leaf renderer (specs/leaf-renderers.md, specs/qr-code.md
 * in the monowind repo). The element's text is the value; the grid
 * shows the code packed into cells; the light DOM keeps the value for
 * assistive technology, and a shadow transcript of the rows is what a
 * selection reads.
 */

import { glyphSetFor, registerLeafRenderer } from "monowind";
import type { LeafContent } from "monowind";
import { LEVELS, encode, pack, resolveGlyphs, scaleUp, snapAspect } from "./render.ts";
import type { Aspect, Encoded, Level } from "./render.ts";

export {
  DEFAULT_GLYPHS,
  encode,
  pack,
  renderQr,
  resolveGlyphs,
  scaleUp,
  snapAspect,
} from "./render.ts";
export type { Aspect, Encoded, Level, QrGlyphs, RenderOptions } from "./render.ts";

// Import-safe outside the browser (SSR, Node scripts): same guard as
// the core element.
const HTMLElementBase = (
  typeof HTMLElement === "undefined" ? class {} : HTMLElement
) as typeof HTMLElement;

/* The shadow pairs the two representations, as the ascii element's
 * does: a transparent transcript of the rows over the grid (the host
 * inherits the engine's typography lock, so the pre aligns cell for
 * cell) — what a selection reads and a copy pastes — and the slotted
 * value, visually hidden for the accessibility tree. */
const SHADOW_TEMPLATE = `<style>
  :host { display: block; }
  #mirror { margin: 0; font: inherit; line-height: inherit; letter-spacing: inherit; white-space: pre; color: transparent; }
  /* The engine paints a selection on its grid (specs/wide-characters.md);
   * the transcript's own highlight stays invisible, ungated: one element. */
  #mirror::selection { color: transparent; text-shadow: none; background: transparent; }
  .alt { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; user-select: none; -webkit-user-select: none; }
</style><pre id="mirror" aria-hidden="true"></pre><span class="alt"><slot></slot></span>`;

/** `<mono-qr>`: renders its text content as a QR code. Attributes:
 * `level` (L | M | Q | H, default M), `aspect` (auto, or the cell's
 * height over its width), `scale` (integer ≥ 1). The rows are the
 * bare symbol: its quiet zone is padding the author gives it. */
export class MonoQrElement extends HTMLElementBase {
  #mirror: HTMLElement | null = null;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = SHADOW_TEMPLATE;
    this.#mirror = shadow.getElementById("mirror");
  }

  /** Keep the transcript in step with the rows (called from the leaf
   * renderer each pass — the shadow is invisible to the engine). */
  syncMirror(lines: string[]): void {
    const text = lines.join("\n");
    if (this.#mirror && this.#mirror.textContent !== text) this.#mirror.textContent = text;
  }
}

const warnedChildren = new WeakSet<Element>();
const warnedLength = new WeakSet<Element>();

/** Per element, the last encoding and the last packing, so a layout
 * pass that changes neither costs neither (encoding a long value is
 * milliseconds; `render` runs every pass). */
interface Memo {
  encodeKey: string;
  encoded: Encoded | null;
  rowsKey: string;
  rows: string[];
}
const memos = new WeakMap<Element, Memo>();
/** The matrix grows with the square of `scale`; past this it freezes
 * the tab. */
const MAX_SCALE = 16;

/** The rows for an element — the leaf renderer, exported for tests. */
export function renderQrLeaf(el: Element): LeafContent {
  const rows = rowsFor(el);
  (el as Partial<MonoQrElement>).syncMirror?.(rows);
  return { lines: rows };
}

function rowsFor(el: Element): string[] {
  const value = (el.textContent ?? "").replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, "");
  if (el.children.length > 0 && !warnedChildren.has(el)) {
    warnedChildren.add(el);
    console.warn("[monowind] <mono-qr> takes text only; element children are ignored.", el);
  }
  if (!value) return [];
  const level = levelOf(el);
  let memo = memos.get(el);
  if (!memo) memos.set(el, (memo = { encodeKey: "", encoded: null, rowsKey: "", rows: [] }));
  const encodeKey = `${level}\0${value}`;
  if (memo.encodeKey !== encodeKey) {
    memo.encodeKey = encodeKey;
    memo.encoded = encode(value, level);
    memo.rowsKey = "";
  }
  if (!memo.encoded) {
    if (!warnedLength.has(el)) {
      warnedLength.add(el);
      console.warn(`[monowind] <mono-qr>: the value does not fit a QR code at level ${level}.`, el);
    }
    return [];
  }
  // The measured cell and the glyph set are inherited custom
  // properties: one computed style serves both (none outside a DOM).
  const style = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  const scale = scaleOf(el);
  const aspect = aspectOf(el, style);
  const glyphs = resolveGlyphs(glyphSetFor(style?.getPropertyValue("--mw-border-glyphs")));
  const rowsKey = `${scale}\0${aspect}\0${glyphs.full}\0${glyphs.upper ?? ""}\0${glyphs.lower ?? ""}`;
  if (memo.rowsKey !== rowsKey) {
    memo.rowsKey = rowsKey;
    memo.rows = pack(scaleUp(memo.encoded.modules, scale), aspect, glyphs);
  }
  return memo.rows;
}

function levelOf(el: Element): Level {
  const raw = (el.getAttribute("level") ?? "M").toUpperCase() as Level;
  return LEVELS.includes(raw) ? raw : "M";
}

/** `scale`: an integer from 1 to `MAX_SCALE` (larger reads as the
 * max); anything else, an empty attribute included, reads as 1. */
function scaleOf(el: Element): number {
  const value = Number(el.getAttribute("scale") || NaN);
  return Number.isInteger(value) && value >= 1 ? Math.min(value, MAX_SCALE) : 1;
}

/** `aspect`: an authored ratio, else the measured cell's (the host's
 * `--mw-ch` over `--mw-cw`), else 2 — before the first measurement or
 * without a DOM. */
function aspectOf(el: Element, style: CSSStyleDeclaration | null): Aspect {
  const authored = Number(el.getAttribute("aspect"));
  if (Number.isFinite(authored) && authored > 0) return snapAspect(authored);
  const width = parseFloat(style?.getPropertyValue("--mw-cw") ?? "");
  const height = parseFloat(style?.getPropertyValue("--mw-ch") ?? "");
  return width > 0 && height > 0 ? snapAspect(height / width) : 2;
}

/** Idempotent registration of the element + leaf renderer (safe under
 * HMR and multiple entry loads). */
export function defineMonoQr(): void {
  if (typeof customElements === "undefined") return;
  if (customElements.get("mono-qr")) return;
  customElements.define("mono-qr", MonoQrElement);
  registerLeafRenderer({
    tag: "mono-qr",
    render: renderQrLeaf,
    selectionTarget: (el) => el.shadowRoot?.getElementById("mirror") ?? null,
  });
}

defineMonoQr();
