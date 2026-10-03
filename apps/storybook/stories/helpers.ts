import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { StoryObj } from "@storybook/web-components-vite";
import { useCallback, useEffect, useRef } from "storybook/preview-api";
import { expect, waitFor } from "storybook/test";
import { wrapLines, type MonoWindElement } from "monowind";
import { roundUpToLayoutUnit } from "../../../packages/core/src/metrics.ts";

/** Firefox breaks BEFORE hyphens (documented divergence, cell-model.md);
 * hyphen-sensitive assertions gate on this. */
export const isFirefox = navigator.userAgent.includes("Firefox");

/** Chromium, where a check leans on what only its engine does. */
export const isChromium = navigator.userAgent.includes("Chrome/");

export type Engine = "chromium" | "firefox" | "webkit";
const engine: Engine = isChromium ? "chromium" : isFirefox ? "firefox" : "webkit";

/** Typed OM, which tells the engine the cascade's pick (Firefox before 157
 * has none). */
export const hasTypedOM = typeof Element.prototype.computedStyleMap === "function";

/** Whether Typed OM reads an unset minimum as `auto` (WebKit reads 0px). */
export const readsAutoMinimum = ((): boolean => {
  if (!hasTypedOM) return false;
  const probe = document.createElement("div");
  document.documentElement.append(probe);
  const value = String(probe.computedStyleMap().get("min-width"));
  probe.remove();
  return value === "auto";
})();

/** What a copy of the current selection puts on the clipboard as
 * text/plain — via a synthetic copy event on the host. Read the
 * EVENT's clipboardData: Firefox gives a dispatched event a
 * DataTransfer of its own. */
export function copyText(host: HTMLElement): string {
  const event = new ClipboardEvent("copy", {
    clipboardData: new DataTransfer(),
    bubbles: true,
    cancelable: true,
  });
  host.dispatchEvent(event);
  return event.clipboardData!.getData("text/plain");
}

export interface Point {
  x: number;
  y: number;
}
export interface PressInit {
  pointerType?: string;
  shiftKey?: boolean;
  target?: Element;
}

/** A primary press at client coordinates: the pointerdown the engine
 * reads the pointer type from, then the mousedown that carries the
 * click count. Returns false when the engine took it (preventDefault). */
export function pressAt(target: Element, at: Point, detail: number, init: PressInit = {}): boolean {
  const common = { bubbles: true, composed: true, cancelable: true, clientX: at.x, clientY: at.y };
  target.dispatchEvent(
    new PointerEvent("pointerdown", {
      ...common,
      pointerType: init.pointerType ?? "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
    }),
  );
  return target.dispatchEvent(
    new MouseEvent("mousedown", {
      ...common,
      detail,
      button: 0,
      buttons: 1,
      shiftKey: init.shiftKey ?? false,
    }),
  );
}

export function release(): void {
  window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse", isPrimary: true }));
}

/** A mouse move to `at` with `buttons` held, dispatched on `target`. */
export function moveTo(target: Element, at: Point, buttons = 0): void {
  target.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      composed: true,
      clientX: at.x,
      clientY: at.y,
      pointerType: "mouse",
      isPrimary: true,
      buttons,
    }),
  );
}

/** A primary-button drag to `at`, dispatched on `target`. */
export function dragTo(target: Element, at: Point): void {
  moveTo(target, at, 1);
}

/** What `mountedOn` keeps: the vanilla mount's `Mounted`. */
interface Mount {
  destroy(): void;
  updateProps(partial: object): void;
}

/** A component mounted on the directive's element once it is in the
 * document, and destroyed when another element takes its place or the
 * story ends (Storybook remounts by wiping the canvas, past Lit's ref)
 * — called from a story's render, whose re-renders share the one
 * mount, each after the first handing it `update` (a control changed). */
export function mountedOn(
  mount: (root: Element) => Mount,
  update?: object,
): ReturnType<typeof ref> {
  const current = useRef<{ root: Element; mounted: Mount } | null>(null);
  const renders = useRef(0);
  useEffect(() => {
    if (renders.current++ > 0 && update) current.current?.mounted.updateProps(update);
  });
  const destroy = () => {
    current.current?.mounted.destroy();
    current.current = null;
  };
  useEffect(() => destroy, []);
  // One callback for the story's life, which Lit hands every element
  // the template renders, each after an `undefined` — the Code panel's
  // detached copy of the story among them, never in the document. A
  // microtask on, the live one is.
  const onElement = useCallback((element?: Element) => {
    if (!element) return;
    queueMicrotask(() => {
      if (!element.isConnected || element === current.current?.root) return;
      destroy();
      current.current = { root: element, mounted: mount(element) };
    });
  }, []);
  return ref(onElement);
}

/** An element's middle, in client coordinates. */
export function centerOf(element: Element): Point {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** A pointer move onto an element's middle, as a mouse makes it. */
export function hoverOver(element: Element): void {
  moveTo(element, centerOf(element));
}

/** `count` animation frames: the last one's timestamp. */
export async function frames(count = 1): Promise<number> {
  let time = performance.now();
  for (let i = 0; i < count; i++) {
    time = await new Promise<number>((next) => requestAnimationFrame(next));
  }
  return time;
}

/** A duration no runner's frames reach, which `transitionLayouts`
 * steps a transition through a twelfth a frame and a test finishes a
 * held keyframe exit itself: a loaded runner's long frames would end
 * either in wall time before a check saw it run. */
export const STEPPED_DURATION = "60s";

/** The frames a stepped transition runs past its change's. */
const STEPS = 12;

/** Every running CSS transition a step further along. */
function stepTransitions(): void {
  for (const animation of document.getAnimations()) {
    if (!(animation instanceof CSSTransition) || animation.playState !== "running") continue;
    const duration = Number(animation.effect!.getTiming().duration);
    animation.currentTime = Math.min(duration, Number(animation.currentTime) + duration / STEPS);
  }
}

/** A tally of a host's layouts, each of which sets its `measuring` flag
 * once, read with the records not yet delivered. */
export interface LayoutCount {
  readonly count: number;
  stop(): void;
}

export function countLayouts(host: Element): LayoutCount {
  let count = 0;
  const tally = (records: MutationRecord[]) => {
    count += records.filter((record) => record.oldValue === null).length;
  };
  const observer = new MutationObserver(tally);
  observer.observe(host, { attributeFilter: ["measuring"], attributeOldValue: true });
  return {
    get count() {
      tally(observer.takeRecords());
      return count;
    },
    stop: () => observer.disconnect(),
  };
}

/** Resolves once `host` lays nothing out for `quiet` frames running, so
 * a count begun after holds only what follows; a host still laying out
 * after a second's rounds fails. */
export async function layoutsQuiet(host: Element, quiet = 3): Promise<void> {
  for (let round = 0; round < 20; round++) {
    const layouts = countLayouts(host);
    await frames(quiet);
    layouts.stop();
    if (layouts.count === 0) return;
  }
  throw new Error("the host kept laying out");
}

/** The frames after a change where its own layout and a transition's
 * start land, left out of the transition's layouts. */
const CHANGE_FRAMES = 3;

/** The most frames a transition runs before `transitionLayouts` fails. */
const TRANSITION_FRAME_LIMIT = 120;

/** A change's transition, stepped frame by frame to `ended`: the
 * layouts past the change's own frames to `settle` frames past the end,
 * and the frames it ran, `sample` read at each. An end not reached in
 * `TRANSITION_FRAME_LIMIT` frames fails. */
export async function transitionLayouts(
  layouts: LayoutCount,
  change: () => void,
  ended: () => boolean,
  { sample, settle = 0 }: { sample?: () => void; settle?: number } = {},
): Promise<{ during: number; frames: number }> {
  change();
  await frames(CHANGE_FRAMES);
  const start = layouts.count;
  let ran = 0;
  while (!ended() && ran < TRANSITION_FRAME_LIMIT) {
    ran++;
    sample?.();
    stepTransitions();
    await frames();
  }
  expect(ended(), `the transition's end within ${TRANSITION_FRAME_LIMIT} frames`).toBe(true);
  await frames(settle);
  return { during: layouts.count - start, frames: ran };
}

/** The host's cell, in px, as the engine measured it. */
export const cellSize = (host: HTMLElement): { width: number; height: number } => ({
  width: parseFloat(getComputedStyle(host).getPropertyValue("--mw-cw")),
  height: parseFloat(getComputedStyle(host).getPropertyValue("--mw-ch")),
});

/** The host's shadow grid, and its text as rows. */
export const gridOf = (host: HTMLElement): HTMLElement => host.shadowRoot!.getElementById("grid")!;
export const rowsOf = (host: HTMLElement): string[] => gridOf(host).textContent!.split("\n");

/** The layer box whose own grid holds `text` (specs/layers.md). */
export const layerBox = (host: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(host.shadowRoot!.querySelectorAll<HTMLElement>(".layer")).find((box) =>
    box.querySelector("pre")!.textContent!.includes(text),
  );

/** Whether the grid painted a row holding `text`. */
export const showsRow = (host: HTMLElement, text: string): boolean =>
  rowsOf(host).some((row) => row.includes(text));

/** Each case's markup laid out by the browser beside its host: case
 * `i`'s `[data-test="case-i"]` holds the host, then a native box, which
 * takes the markup as wide as the host, in its grid's font and
 * letter-spacing (a glyph a cell wide), at its cell's height. Each
 * case's host and native box. */
async function nativeCopies(
  canvasElement: HTMLElement,
  host: HTMLElement,
  markups: readonly string[],
): Promise<[HTMLElement, HTMLElement][]> {
  const cell = cellSize(host);
  // Longhands: the shorthand serializes empty where they came apart.
  const { fontFamily, fontSize, fontWeight, fontStyle, letterSpacing } = getComputedStyle(
    gridOf(host),
  );
  const pairs = markups.map((markup, i) => {
    const [caseHost, native] = canvasElement.querySelectorAll<HTMLElement>(
      `[data-test="case-${i}"] > *`,
    );
    Object.assign(native!.style, {
      width: `${caseHost!.getBoundingClientRect().width}px`,
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
      lineHeight: `${cell.height}px`,
      letterSpacing,
    });
    native!.innerHTML = markup;
    return [caseHost!, native!] as [HTMLElement, HTMLElement];
  });
  await frames(2);
  return pairs;
}

/** Each run of non-space text under an element, with its range. */
function* words(el: Element): Generator<{ word: string; range: Range }> {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    for (const match of text.textContent!.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(text, match.index);
      range.setEnd(text, match.index + match[0].length);
      yield { word: match[0], range };
    }
  }
}

/** Each word of a native copy's text (`nativeCopies`) on the host's
 * grid where the browser puts it: the same row, and the column the
 * browser's rounds to — either neighbor where the browser's lies within
 * `halfSlack` of a half, which its layout units decide. */
export function expectWordsAsNative(host: HTMLElement, native: HTMLElement, halfSlack = 0): void {
  const cell = cellSize(host);
  const origin = native.getBoundingClientRect();
  const rows = rowsOf(host);
  // Each row searched past its last word, a word repeated or inside
  // another's not matched early.
  const searched: number[] = [];
  for (const { word, range } of words(native)) {
    const rect = range.getBoundingClientRect();
    const row = Math.floor((rect.top + rect.height / 2 - origin.top) / cell.height);
    const column = (rect.left - origin.left) / cell.width;
    const drawn = rows[row]?.indexOf(word, searched[row]) ?? -1;
    searched[row] = drawn + word.length;
    const message = `${word} on row ${row}, the browser's at ${column.toFixed(2)}`;
    if (Math.abs(column - Math.floor(column) - 0.5) < halfSlack) {
      expect([Math.floor(column), Math.ceil(column)], message).toContain(drawn);
    } else {
      expect(drawn, message).toBe(Math.round(column));
    }
  }
}

/** A `[data-test]` element's offset from `root`'s box, in cells. */
export function cellOffset(
  root: Element,
  name: string,
  cell: { width: number; height: number },
): { x: number; y: number } {
  const origin = root.getBoundingClientRect();
  const box = root.querySelector(`[data-test="${name}"]`)!.getBoundingClientRect();
  return { x: (box.left - origin.left) / cell.width, y: (box.top - origin.top) / cell.height };
}

/** Each row of a native copy's text (`nativeCopies`) as the host's grid
 * draws it: the same characters, row by row — a soft hyphen the row
 * ends at shown as `-`, invisible ones left out. */
export function expectLinesAsNative(host: HTMLElement, native: HTMLElement): void {
  const cell = cellSize(host);
  const top = native.getBoundingClientRect().top;
  const rows: string[] = [];
  const walker = document.createTreeWalker(native, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    let offset = 0;
    for (const char of text.textContent!) {
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + char.length);
      offset += char.length;
      const rect = range.getBoundingClientRect();
      if (rect.height === 0) continue;
      const row = Math.floor((rect.top + rect.height / 2 - top) / cell.height);
      rows[row] = (rows[row] ?? "") + char;
    }
  }
  const shown = (row: string | undefined) =>
    (row ?? "")
      .replace(/\u00ad$/, "-")
      .replace(/[\u00ad\u200b\u2063]/g, "")
      .trim();
  const drawn = rowsOf(host).map(shown);
  rows.forEach((row, i) => expect(drawn[i], `row ${i}`).toBe(shown(row)));
}

/** A length of `cells` along an axis, as CSS. */
export type Unit = (cells: number, axis?: "x" | "y") => string;

/** A case beside the browser: its markup, and the engines a spec says
 * depart from CSS there, whose copies go unchecked. */
export type NativeCase = string | { markup: string; departs?: readonly Engine[] | undefined };
const markupOf = (nativeCase: NativeCase): string =>
  typeof nativeCase === "string" ? nativeCase : nativeCase.markup;

/** A story's render and play laying out each case by the engine, its
 * lengths on the spacing scale, and by the browser beside it at the
 * measured cell (`nativeCopies`), each pair `check`ed, every word where
 * the browser puts it by default. Test-only: the story tags itself
 * `!dev` and `!golden`, which the indexer reads from its own literal. */
export const besideNative = (
  cases: (u: Unit) => readonly NativeCase[],
  check: (host: HTMLElement, native: HTMLElement, i: number) => unknown = (host, native) =>
    expectWordsAsNative(host, native),
  hostClass = "w-80",
): StoryObj => ({
  render: () =>
    html`${cases((cells) => `${cells * 0.25}rem`).map(
      (nativeCase, i) => html`
        <div data-test="case-${i}" class="mb-2 flex gap-4">
          <mono-wind class=${hostClass} .innerHTML=${markupOf(nativeCase)}></mono-wind>
          <div data-test="native" style="contain: layout"></div>
        </div>
      `,
    )}`,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const cell = cellSize(host);
    const measured = cases(
      (cells, axis = "x") => `${cells * cell[axis === "x" ? "width" : "height"]}px`,
    );
    const copies = await nativeCopies(canvasElement, host, measured.map(markupOf));
    for (const [i, [caseHost, native]] of copies.entries()) {
      const nativeCase = measured[i]!;
      if (typeof nativeCase !== "string" && nativeCase.departs?.includes(engine)) continue;
      await check(caseHost, native, i);
    }
  },
});

/** A wait for the grid to paint a row holding `text`. */
export const expectRow = (host: HTMLElement, text: string): Promise<void> =>
  waitFor(() => expect(showsRow(host, text), `the grid paints "${text}"`).toBe(true));

/** The first span the grid painted holding `text`. */
export const paintedSpan = (host: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(gridOf(host).querySelectorAll("span")).find((el) => el.textContent!.includes(text));

/** The background the grid painted under the first span holding `text`,
 * "" for none or no span. */
export const paintedBackground = (host: HTMLElement, text: string): string =>
  paintedSpan(host, text)?.style.backgroundColor ?? "";

let colorContext: CanvasRenderingContext2D | undefined;

/** A color's red, green, blue, and alpha, 0..255, as a detached sRGB
 * canvas draws it — any form but one an element resolves
 * (`currentcolor`, a `var()`), so a `waitFor` sees no mutation from
 * it. A value the canvas ignores throws, where it would draw the last
 * fill. */
export function channels(color: string): number[] {
  colorContext ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const context = colorContext;
  const over = (fill: string) => {
    context.fillStyle = fill;
    context.fillStyle = color;
    return context.fillStyle;
  };
  if (over("#000") !== over("#fff")) throw new Error(`not a color a canvas draws: "${color}"`);
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  return Array.from(context.getImageData(0, 0, 1, 1).data);
}

/** Whether two colors land within 2/255 a channel, alpha included, as
 * an engine's 8-bit blend does (specs/cell-model.md "Opacity and
 * translucency"). */
export function nearColor(actual: string, expected: string): boolean {
  const [a, b] = [channels(actual), channels(expected)];
  return a.every((channel, i) => Math.abs(channel - b[i]!) <= 2);
}

export function expectColor(actual: string, expected: string, message = "color"): void {
  expect(
    nearColor(actual, expected),
    `${message}: ${actual} (${channels(actual)}) against ${expected} (${channels(expected)})`,
  ).toBe(true);
}

/** `color` at `alpha`, as the grid keeps a translucent color no opaque
 * background lies under, for the browser to composite. */
export const faded = (color: string, alpha: number): string =>
  `color-mix(in srgb, ${color} ${alpha * 100}%, transparent)`;

/** A painted span's color, or its background, at the span's opacity:
 * what the browser composites over what lies beneath the grid. */
export const shown = (
  span: HTMLElement | undefined,
  property: "color" | "backgroundColor" = "color",
): string | undefined => {
  const value = span?.style[property];
  return value && span.style.opacity ? faded(value, Number(span.style.opacity)) : value;
};

/** The story's `data-test` hooks, by name. */
export const testHooks =
  (canvasElement: HTMLElement) =>
  (name: string): HTMLElement =>
    canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;

/** Two edges on the same pixel, retried: a late font load swaps the
 * cell metrics and relays out a frame after `fonts.ready`, the light
 * boxes following. */
export const expectTouching = (a: () => number, b: () => number): Promise<void> =>
  waitFor(() => expect(Math.abs(a() - b())).toBeLessThan(1));

/** The light element's box against the grid cells the engine gave it,
 * retried as `expectTouching` is. */
export function expectOnItsCells(host: HTMLElement, el: HTMLElement): Promise<void> {
  return waitFor(() => {
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    const x = parseFloat(el.style.getPropertyValue("--mw-x"));
    const y = parseFloat(el.style.getPropertyValue("--mw-y"));
    const grid = gridOf(host).getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    expect(Math.abs(rect.left - (grid.left + x * cellWidth))).toBeLessThan(1);
    expect(Math.abs(rect.top - (grid.top + y * cellHeight))).toBeLessThan(1);
  });
}

/** The cell a host's probe measures now, its 100 characters' advance
 * rounded as the engine rounds it; none for a host in no box. */
function probeCell(host: HTMLElement): { width: number; height: number } | undefined {
  const rect = host.querySelector(":scope > [data-mw-probe]")?.getBoundingClientRect();
  if (!rect || rect.width === 0) return undefined;
  return { width: roundUpToLayoutUnit(rect.width / 100), height: rect.height };
}

/** The most two-frame rounds `readyHosts` waits for the cell to settle. */
const SETTLE_ROUNDS = 60;

/** The story's hosts once laid out, the fonts loaded, and the cell
 * settled: the same two frames apart, and the one each probe measures —
 * the engine lays out again where they differ. A font that swaps in
 * late reaches the engine as the probe's resize, reported the frame the
 * swap renders, and its layout runs in the next frame's callbacks,
 * after this loop's own. A cell unsettled after `SETTLE_ROUNDS` fails,
 * naming the hosts' cells and their probes'. */
export async function readyHosts(canvasElement: HTMLElement): Promise<MonoWindElement[]> {
  const hosts = Array.from(canvasElement.querySelectorAll<MonoWindElement>("mono-wind"));
  await waitFor(() => {
    for (const host of hosts) expect(host).toHaveAttribute("data-mw-ready");
  });
  await document.fonts.ready;
  const size = (cell?: { width: number; height: number }) =>
    cell ? `${cell.width}x${cell.height}` : "none";
  const cells = () => hosts.map((host) => size(cellSize(host))).join();
  const probesAgree = () =>
    hosts.every((host) => {
      const probe = probeCell(host);
      return !probe || size(probe) === size(cellSize(host));
    });
  for (let round = 1; ; round++) {
    const was = cells();
    await frames(2);
    if (was === cells() && probesAgree()) return hosts;
    if (round === SETTLE_ROUNDS) {
      const report = hosts.map(
        (host, i) => `host ${i} at ${size(cellSize(host))}, its probe ${size(probeCell(host))}`,
      );
      throw new Error(`the cell unsettled after ${SETTLE_ROUNDS} rounds: ${report.join("; ")}`);
    }
  }
}

/** The story's host once laid out and its fonts loaded. */
export const readyHost = async (canvasElement: HTMLElement): Promise<MonoWindElement> =>
  (await readyHosts(canvasElement))[0]!;

async function textLeaves(host: Element): Promise<HTMLElement[]> {
  await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"));
  const leaves = Array.from(host.querySelectorAll<HTMLElement>("[data-mw-laid-out]")).filter(
    (el) =>
      el.textContent!.trim() !== "" &&
      !el.querySelector("[data-mw-laid-out], [data-mw-inline-box]"),
  );
  expect(leaves.length).toBeGreaterThan(0);
  return leaves;
}

/** The rects of each run of non-space text under an element. */
function wordRects(el: Element): DOMRect[] {
  return [...words(el)].flatMap(({ range }) => [...range.getClientRects()]);
}

/** Assert that the browser painted every laid-out leaf's text on exactly
 * the rows the engine allocated — the wrap models must agree in every
 * engine (specs/cell-model.md). `allowStretchedLeaves` relaxes the check
 * to "the text fits inside the box" for stories where leaves are
 * STRETCHED taller than their text (grid items spanning rows, stretched
 * flex items): there the box height is the area, not the line count. */
export async function expectBrowserRowsToMatchEngine(
  canvasElement: HTMLElement,
  { allowStretchedLeaves = false }: { allowStretchedLeaves?: boolean } = {},
): Promise<void> {
  const host = canvasElement.querySelector("mono-wind")!;
  const leaves = await textLeaves(host);
  // Retried: a late font load swaps the cell metrics and relays out a
  // frame after `fonts.ready`; the browser's lines and the engine's rows
  // agree once both have settled.
  await waitFor(() => {
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    for (const el of leaves) {
      const cells = (name: string) => Number(el.style.getPropertyValue(name));
      const contentRows =
        cells("--mw-h") - cells("--mw-bt") - cells("--mw-bb") - cells("--mw-pt") - cells("--mw-pb");
      // N lines occupy N + (N − 1) × gap rows, with gap = rows per line − 1.
      const rowsPerLine = cells("--mw-lh") || 1;
      const engineLines = (contentRows + rowsPerLine - 1) / rowsPerLine;
      const range = document.createRange();
      range.selectNodeContents(el);
      // Fragments on one line can differ slightly in top (an italic or bold
      // fallback face has its own ascent), so count rows by the fragment's
      // vertical centre rather than distinct tops.
      const top = el.getBoundingClientRect().top;
      const lines = new Set(
        Array.from(range.getClientRects(), (r) =>
          Math.floor((r.top + r.height / 2 - top) / cellHeight),
        ),
      );
      if (allowStretchedLeaves) {
        expect(lines.size, `"${el.textContent!.trim()}" lines`).toBeGreaterThan(0);
        expect(lines.size, `"${el.textContent!.trim()}" lines`).toBeLessThanOrEqual(engineLines);
      } else {
        expect(lines.size, `"${el.textContent!.trim()}" lines`).toBe(engineLines);
      }
      // Horizontal agreement: the text must hug the element's content
      // origin (left padding edge) — or the right edge for end-aligned
      // text. Guards against the browser laying the text out relative to
      // some OTHER box than the engine's — e.g. an absolutely positioned
      // grid child's §10.1 grid-area containing block before styles.css
      // neutralized grid placement.
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      if (rects.length > 0) {
        const box = el.getBoundingClientRect();
        const textAlign = getComputedStyle(el).textAlign;
        const label = el.textContent!.trim();
        if (/right|end/.test(textAlign)) {
          // Word by word: a line's fragment spans the spaces `pre-wrap`
          // hangs past the edge.
          const textRight = Math.max(...wordRects(el).map((r) => r.right));
          const expectedRight =
            box.left + (cells("--mw-w") - cells("--mw-br") - cells("--mw-pr")) * cellWidth;
          expect(Math.abs(textRight - expectedRight), `"${label}" text end`).toBeLessThan(1.5);
        } else if (/center/.test(textAlign)) {
          // Engine centers at floor(leftover / 2) whole cells; the
          // browser's own centering is fractional — they agree within
          // half a cell (specs/cell-model.md "Text alignment").
          const widest = rects.reduce((a, b) => (b.width > a.width ? b : a));
          const contentCells =
            cells("--mw-w") -
            cells("--mw-bl") -
            cells("--mw-br") -
            cells("--mw-pl") -
            cells("--mw-pr");
          const lineCells = Math.round(widest.width / cellWidth);
          const expectedLeft =
            box.left +
            (cells("--mw-bl") + cells("--mw-pl")) * cellWidth +
            Math.floor(Math.max(0, contentCells - lineCells) / 2) * cellWidth;
          expect(Math.abs(widest.left - expectedLeft), `"${label}" text center`).toBeLessThan(
            cellWidth / 2 + 1.5,
          );
        } else {
          const textLeft = Math.min(...rects.map((r) => r.left));
          const expectedLeft = box.left + (cells("--mw-bl") + cells("--mw-pl")) * cellWidth;
          expect(Math.abs(textLeft - expectedLeft), `"${label}" text start`).toBeLessThan(1.5);
        }
      }
    }
  });
}

/** Assert the browser broke each leaf's lines at the exact character
 * positions the engine's wrap model predicts (specs/cell-model.md) —
 * `expectBrowserRowsToMatchEngine` only compares line COUNTS, which
 * can't see a break landing on the wrong side of a hyphen. Applies to
 * simple leaves (element children, letter spacing, and non-normal
 * white-space are skipped: their run text isn't recoverable from bare
 * textContent). Collapsible spaces are stripped from both sides of the
 * comparison — rects for a space at a soft break are unreliable — so
 * breaks are compared through the non-space character sequence (NBSP
 * counts as a character). In Firefox, hyphenated leaves are skipped:
 * it breaks BEFORE hyphens (documented divergence, cell-model.md). */
export async function expectBrowserLineBreaksToMatchEngine(
  canvasElement: HTMLElement,
): Promise<void> {
  const host = canvasElement.querySelector("mono-wind")!;
  const leaves = await textLeaves(host);
  const cellHeight = cellSize(host).height;
  let checked = 0;
  for (const el of leaves) {
    const computed = getComputedStyle(el);
    if (el.childElementCount > 0 || computed.whiteSpace !== "normal") continue;
    if (computed.letterSpacing !== "normal" && parseFloat(computed.letterSpacing) !== 0) continue;
    const text = el.textContent!.replace(/[ \t\r\n\f]+/g, " ").trim();
    if (isFirefox && text.includes("-")) continue;
    const cells = (name: string) => Number(el.style.getPropertyValue(name));
    const contentWidth =
      cells("--mw-w") - cells("--mw-bl") - cells("--mw-br") - cells("--mw-pl") - cells("--mw-pr");
    const engineLines = wrapLines(text, contentWidth).map((line) => line.replaceAll(" ", ""));
    // Rebuild the browser's lines character by character: each glyph's
    // rect centre picks its row, rows in top-to-bottom order are lines.
    const top = el.getBoundingClientRect().top;
    const rows = new Map<number, string>();
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = (node as Text).data;
      for (let i = 0; i < data.length; i++) {
        if (/[ \t\r\n\f]/.test(data[i]!)) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        const row = Math.floor((rect.top + rect.height / 2 - top) / cellHeight);
        rows.set(row, (rows.get(row) ?? "") + data[i]!);
      }
    }
    const browserLines = [...rows.keys()].sort((a, b) => a - b).map((row) => rows.get(row)!);
    expect(browserLines, `"${text}" break positions`).toEqual(engineLines);
    checked++;
  }
  // Firefox can skip every hyphenated leaf; a story with none must check.
  if (!isFirefox) expect(checked).toBeGreaterThan(0);
}

/** Assert that every painted run STARTS on its cell and every boxed
 * glyph is exactly one cell tall on its row (specs/wide-characters.md):
 * a fallback glyph drawn off its cell count carries its drift to
 * everything after it on the row, and a taller fallback line box would
 * push the rows below. Run by run, so a drift is caught where it
 * begins — a row's total width hides one until it passes half a cell.
 * Element boxes are read directly — a Range's rect would also union
 * the text inside a box, which a scaled glyph overflows by design. */
export function expectGridOnItsCells(host: HTMLElement): void {
  const grid = host.shadowRoot!.getElementById("grid")!;
  const cellWidth = cellSize(host).width;
  const cellHeight = cellSize(host).height;
  const rows: Node[][] = [[]];
  for (const node of Array.from(grid.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent === "\n") rows.push([]);
    else rows[rows.length - 1]!.push(node);
  }
  const gridRect = grid.getBoundingClientRect();
  expect(Math.abs(gridRect.height - rows.length * cellHeight)).toBeLessThan(1);
  rows.forEach((row, y) => {
    let left = Infinity;
    let right = -Infinity;
    for (const node of row) {
      let rect: DOMRect;
      const which = `row ${y} "${node.textContent}"`;
      if (node instanceof HTMLElement) {
        rect = node.getBoundingClientRect();
        // Boxed spans only: an unpainted span's rect is the font's
        // content area, which a period font draws taller than the cell
        // (Courier New by 2px) without moving a row — the grid's own
        // height above covers that.
        if (node.dataset.box !== undefined) {
          const styled = `${which} [${node.getAttribute("style")}]`;
          expect(Math.abs(rect.height - cellHeight), styled).toBeLessThan(1);
          expect(Math.abs(rect.top - (gridRect.top + y * cellHeight)), styled).toBeLessThan(1);
        }
      } else {
        const range = document.createRange();
        range.selectNodeContents(node);
        rect = range.getBoundingClientRect();
      }
      // Whole cells from the grid's left, whatever the run holds — a
      // count of columns would have to know each cluster's cells, and
      // a quarter cell is under a rounding of the run's own edges.
      const offset = rect.left - gridRect.left;
      const drift = Math.abs(offset - Math.round(offset / cellWidth) * cellWidth);
      expect(drift, which).toBeLessThan(cellWidth / 4);
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
    // And the row as a whole, so a drift of a FULL cell cannot hide in
    // the modulus above.
    if (row.length > 0) expect(Math.abs(right - left - gridRect.width)).toBeLessThan(cellWidth / 2);
  });
}

export interface Cell {
  row: number;
  col: number;
}
/** A native line of an element's text: its row and its glyphs' columns. */
export interface Line extends Cell {
  max: number;
}

/** The story's host once ready, with its readers: an element's engine
 * cells (`--mw-*`), and `measure` — the grid and its geometry, read
 * fresh each call, since a late font load swaps the cell metrics and
 * relays out a frame after `fonts.ready`; a comparison wrapped in
 * `waitFor` retries until both sides settle. */
export async function readyGrid(canvasElement: HTMLElement) {
  const host = await readyHost(canvasElement);
  const by = testHooks(canvasElement);
  const grid = host.shadowRoot!.getElementById("grid")!;
  const cells = (el: HTMLElement, name: string) => Number(el.style.getPropertyValue(name));
  const measure = () => {
    const rows = grid.textContent!.split("\n");
    const cellWidth = cellSize(host).width;
    const cellHeight = cellSize(host).height;
    const gridRect = grid.getBoundingClientRect();
    const cellOf = (rect: DOMRect): Cell => ({
      row: Math.floor((rect.top + rect.height / 2 - gridRect.top) / cellHeight),
      col: Math.round((rect.left - gridRect.left) / cellWidth),
    });
    // An element box's top-left cell (a glyph rect reads by its middle).
    const boxOf = (el: HTMLElement): Cell => {
      const rect = el.getBoundingClientRect();
      return {
        row: Math.round((rect.top - gridRect.top) / cellHeight),
        col: Math.round((rect.left - gridRect.left) / cellWidth),
      };
    };
    const cellAt = (col: number, row: number) => ({
      x: gridRect.left + (col + 0.5) * cellWidth,
      y: gridRect.top + (row + 0.5) * cellHeight,
    });
    // The browser's lines of an element's text, character by character:
    // each glyph's rect picks its row and column, and the grid must show
    // the same characters on those cells.
    const expectNativeOnGrid = (el: HTMLElement): Line[] => {
      const byRow = new Map<number, { min: number; max: number; text: string }>();
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = (node as Text).data;
        for (let i = 0; i < data.length; i++) {
          if (/[ \t\r\n\f]/.test(data[i]!)) continue;
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const { row, col } = cellOf(range.getBoundingClientRect());
          const line = byRow.get(row) ?? { min: col, max: col, text: "" };
          line.min = Math.min(line.min, col);
          line.max = Math.max(line.max, col);
          line.text += data[i];
          byRow.set(row, line);
        }
      }
      expect(byRow.size).toBeGreaterThan(0);
      for (const [row, line] of byRow) {
        expect(rows[row]!.slice(line.min, line.max + 1).replaceAll(" ", "")).toBe(line.text);
      }
      return [...byRow]
        .map(([row, line]) => ({ row, col: line.min, max: line.max }))
        .sort((a, b) => a.row - b.row);
    };
    return { rows, cellOf, boxOf, cellAt, expectNativeOnGrid };
  };
  return {
    host,
    by,
    cells,
    width: (el: HTMLElement) => cells(el, "--mw-w"),
    height: (el: HTMLElement) => cells(el, "--mw-h"),
    measure,
  };
}

/** The first text node of `root` holding `needle`. */
export function textWith(root: Node, needle: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).data.includes(needle)) return node as Text;
  }
  throw new Error(`no text node holds "${needle}"`);
}
