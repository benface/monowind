/**
 * `@monowind/ascii` — FIGlet/TOIlet banner text on the monowind grid:
 * the `<mono-ascii>` element (a leaf renderer, specs/leaf-renderers.md
 * in the monowind repo) plus the font registry. The package entry
 * registers the element and the default fonts; additional fonts are
 * per-module imports (`@monowind/ascii/fonts/<name>`) or
 * `registerAsciiFont(name, data)` with data you source yourself.
 */

import { invalidateLeaves, registerLeafRenderer } from "monowind";
// Default fonts (self-registering): figlet's canonical `standard`,
// its compact sibling, and a TLF representative.
import "./fonts/standard.ts";
import "./fonts/small.ts";
import "./fonts/mono9.ts";
import { asciiFont } from "./registry.ts";
import { renderAscii } from "./render.ts";
import { effectRuns, isEffect } from "./effects.ts";
import type { AsciiFont } from "./font.ts";
import type { LeafContent } from "monowind";

export { asciiFont, registerAsciiFont } from "./registry.ts";
export { parseFont } from "./font.ts";
export { renderAscii } from "./render.ts";
export type { AsciiFont, Glyph, HorizontalLayout } from "./font.ts";
export type { RenderedAscii } from "./render.ts";

const warned = new Set<string>();
const warnedChildren = new WeakSet<Element>();

/** CDN hook: called once per unknown font NAME so the bundle can
 * lazy-load it (bundler consumers import font modules instead). */
let unknownFontHandler: ((name: string) => void) | null = null;
export function onUnknownAsciiFont(handler: (name: string) => void): void {
  unknownFontHandler = handler;
}

// Import-safe outside the browser (SSR, Node scripts): same guard as
// the core element.
const HTMLElementBase = (
  typeof HTMLElement === "undefined" ? class {} : HTMLElement
) as typeof HTMLElement;

/* The shadow pairs the two representations (grid glyphs stay the
 * visible paint): a transparent art transcript that overlays the grid
 * cell-for-cell — the host inherits the engine's typography lock, so
 * the pre aligns by construction — and the slotted semantic string,
 * visually hidden for the accessibility tree. Selection and copy read
 * the transcript natively (real text, real newlines, in every
 * sweep — drags, overshoots, select-all); the string never leaks into
 * a copy. */
// No whitespace between top-level nodes: the host inherits the
// engine's white-space: pre lock, so stray template newlines would
// render as real empty lines above the transcript.
const SHADOW_TEMPLATE = `<style>
  :host { display: block; }
  #mirror { margin: 0; font: inherit; line-height: inherit; letter-spacing: inherit; white-space: pre; color: transparent; }
  /* The engine paints a selection on its grid (specs/wide-characters.md);
   * the transcript's own highlight stays invisible, like the light DOM's. */
  #mirror::selection { color: transparent; text-shadow: none; background: transparent; }
  .alt { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; user-select: none; -webkit-user-select: none; }
</style><pre id="mirror" aria-hidden="true"></pre><span class="alt"><slot></slot></span>`;

/** `<mono-ascii>`: renders its text content as ascii art. The `font`
 * ATTRIBUTE names a registered font (default: "standard"); the `font`
 * PROPERTY takes a parsed font object directly and wins over the
 * attribute. The light DOM keeps the semantic text (a11y); the shadow
 * transcript is what select="text" selects and copies. */
export class MonoAsciiElement extends HTMLElementBase {
  #font: AsciiFont | null = null;
  #mirror: HTMLElement | null = null;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = SHADOW_TEMPLATE;
    this.#mirror = shadow.getElementById("mirror");
  }

  get font(): AsciiFont | null {
    return this.#font;
  }

  set font(font: AsciiFont | null) {
    this.#font = font;
    invalidateLeaves();
  }

  /** Keep the transcript in step with the art (called from the leaf
   * renderer each pass — the shadow is invisible to the engine, so
   * the sync never feeds back into layout). */
  syncMirror(lines: string[]): void {
    const text = lines.join("\n");
    if (this.#mirror && this.#mirror.textContent !== text) this.#mirror.textContent = text;
  }
}

function renderLeaf(el: Element): LeafContent {
  const content = renderContent(el);
  (el as Partial<MonoAsciiElement>).syncMirror?.(content.lines);
  return content;
}

function renderContent(el: Element): LeafContent {
  // The banner is the normalized textContent: trimmed, all whitespace
  // (newlines included) collapsed — a one-line banner by contract.
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (el.children.length > 0 && !warnedChildren.has(el)) {
    warnedChildren.add(el);
    console.warn("[monowind] <mono-ascii> takes text only; element children are ignored.", el);
  }
  const name = el.getAttribute("font") ?? "standard";
  const font = (el as MonoAsciiElement).font ?? asciiFont(name);
  if (!font) {
    // Content never disappears: no (or unknown) font falls back to
    // the plain text.
    if (!warned.has(`font:${name}`)) {
      warned.add(`font:${name}`);
      if (unknownFontHandler) unknownFontHandler(name);
      else
        console.warn(
          `[monowind] <mono-ascii>: no registered font "${name}"; rendering plain text.`,
          el,
        );
    }
    return { lines: text ? [text] : [] };
  }
  if (!text) return { lines: [] };
  const rendered = renderAscii(text, font);
  const effect = el.getAttribute("effect");
  if (effect && isEffect(effect)) {
    return { lines: rendered.lines, runs: effectRuns(effect, rendered.lines) };
  }
  return { lines: rendered.lines, runs: rendered.runs };
}

/** Idempotent registration of the element + leaf renderer (safe under
 * HMR and multiple entry loads). */
export function defineMonoAscii(): void {
  if (typeof customElements === "undefined") return;
  if (customElements.get("mono-ascii")) return;
  customElements.define("mono-ascii", MonoAsciiElement);
  registerLeafRenderer({
    tag: "mono-ascii",
    observedAttributes: ["font", "effect"],
    render: renderLeaf,
    selectionTarget: (el) => el.shadowRoot?.getElementById("mirror") ?? null,
  });
}

defineMonoAscii();
