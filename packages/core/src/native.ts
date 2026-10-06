import type { CellSize } from "./gradient.ts";
import { altText } from "./image.ts";
import type { PaintedLayer } from "./plain-text.ts";
import { setVar } from "./render.ts";
import { renderedLines } from "./rendered-text.ts";
import type { HostPart } from "./rendered-text.ts";
import type { LayoutNode } from "./types.ts";

/** The engine's mark on a native region (specs/native-regions.md "The
 * utility"), whose contents the companion's locks skip: `inline` where
 * its display is, which the companion makes an atomic inline box. */
export const NATIVE_MARK = "data-mw-native";

/** The engine's mark on each native region while its host's grid drag
 * is in flight, its contents giving up the pointer: a name of its own,
 * as the style engines restyle a descendant rule's whole subtree
 * wherever its attribute flips, the host's included. */
export const NATIVE_DRAG = "data-mw-native-drag";

/** The engine's marks on a host holding a native region and on one
 * holding none, which key the companion's twin locks (styles.css, the
 * header); a host has one of them from its connection. */
export const REGIONS_MARK = "data-mw-regions";
export const NO_REGIONS_MARK = "data-mw-no-regions";

/** The engine's mark on a host inside another host's light DOM, in no
 * native region of it: unsupported, its engine off, its contents the
 * outer host's (specs/native-regions.md "Nesting"). */
export const NESTED_MARK = "data-mw-nested";

/** The replaced elements, whose region takes its natural size where it
 * has one, an inline SVG's measured (specs/native-regions.md "Layout"). */
export const REPLACED = new Set(["img", "iframe", "video", "canvas", "embed", "object", "svg"]);

/** The native region of `host`'s a node is, or lies in — past the
 * regions of a host running in it; null where none is. Read from the
 * marks, so a region as of the host's last layout. */
export function regionOf(node: Node, host: Element): Element | null {
  if (!host.hasAttribute(REGIONS_MARK)) return null;
  let region: Element | null = null;
  let el = node instanceof Element ? node : node.parentElement;
  for (;;) {
    const next = el?.closest(`[${NATIVE_MARK}]`);
    if (!next || next === host || !host.contains(next)) return region;
    region = next;
    el = next.parentElement;
  }
}

/** Whether a node is a native region's content, the browser's: inside
 * one of `host`'s regions, the region's own element not. */
export const insideRegion = (node: Node, host: Element): boolean =>
  node.parentNode !== null && regionOf(node.parentNode, host) !== null;

/** The host's light elements but its native regions' contents. */
export function lightElements(host: Element): Iterable<Element> {
  if (!host.hasAttribute(REGIONS_MARK)) return host.querySelectorAll("*");
  const elements: Element[] = [];
  const walker = host.ownerDocument.createTreeWalker(host, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      node.parentElement?.hasAttribute(NATIVE_MARK)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) elements.push(node as Element);
  return elements;
}

/** Each native region a tree holds, with its mark's value. */
export const regionsOf = (root: LayoutNode): Map<Element, string> =>
  new Map(root.regions?.map(({ source, native }) => [source, native!.inline ? "inline" : ""]));

/** A region's part of a copy (specs/native-regions.md "Interaction"):
 * an image's alt, nothing of other replaced contents, and the text a
 * range holds of flowed ones (all of it where no range is given) as the
 * page renders it, a host running there its part as `nested` gives it. */
export function regionText(node: LayoutNode, range?: Range, nested?: HostPart): string {
  const el = node.source;
  if (node.native?.replaced) {
    return el.localName === "img" && node.style.visible
      ? altText((el as HTMLImageElement).alt)
      : "";
  }
  if (!range) {
    range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
  }
  return renderedLines(range, el, nested).join("\n");
}

/** An image's or a region's part of a copy: its alt, or the region's
 * text (`regionText`). */
export const surfaceText = (node: LayoutNode, range?: Range, nested?: HostPart): string =>
  node.native ? regionText(node, range, nested) : altText((node.source as HTMLImageElement).alt);

/** A region's clip where later ink covers it (specs/native-regions.md
 * "Paint"): its covered cells cut from a plane past any overflow, in px
 * of its border box, each row's run of them one rectangle; the whole
 * region under a backdrop; null where nothing covers it. */
export function regionClip(surface: PaintedLayer, cell: CellSize): string | null {
  if (surface.whole) return "inset(50%)";
  if (surface.holes.size === 0) return null;
  const { box, x, y, width } = surface;
  const cells = [...surface.holes].sort((a, b) => a - b);
  let path = "M-1e6 -1e6H1e6V1e6H-1e6Z";
  for (let i = 0; i < cells.length;) {
    const start = cells[i]!;
    let end = start + 1;
    while (cells[++i] === end && end % width !== 0) end++;
    const left = (x + (start % width) - box.x) * cell.width;
    const top = (y + Math.floor(start / width) - box.y) * cell.height;
    path += `M${left} ${top}h${(end - start) * cell.width}v${cell.height}h${(start - end) * cell.width}Z`;
  }
  return `path(evenodd, "${path}")`;
}

/** Each native region clipped where the ink painted after it covers it
 * (`regionClip`, styles.css `data-mw-native-clip`), its clip lifted
 * where nothing covers it any more. */
export function clipRegions(
  regions: Iterable<Element>,
  surfaces: readonly PaintedLayer[],
  cell: CellSize,
): void {
  const clips = new Map<Element, string>();
  for (const surface of surfaces) {
    const clip = surface.surface === "region" ? regionClip(surface, cell) : null;
    if (clip) clips.set(surface.node.source, clip);
  }
  for (const el of regions) clip(el, clips.get(el) ?? null);
}

/** A region's clip written, or lifted where null. */
export function clip(el: Element, path: string | null): void {
  el.toggleAttribute("data-mw-native-clip", path !== null);
  setVar(el as HTMLElement, "--mw-clip", path);
}
