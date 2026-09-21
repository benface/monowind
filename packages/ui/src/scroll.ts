/** What Zag's `scrollToIndexFn` is given: where the item sits in the
 * collection, and the element showing it. */
interface ScrollDetails {
  index: number;
  getElement(): HTMLElement | null;
}

/** The nearest ancestor scrolling the item, up to the component's
 * content; none outside one. */
function scrollerOf(item: HTMLElement): HTMLElement | null {
  for (let el = item.parentElement; el && el !== item.ownerDocument.body; el = el.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
    if (el.dataset["part"] === "content") break;
  }
  return null;
}

/** The pixels of a side's border and padding together; a DOM that
 * computes neither reads as none. */
const pixels = (value: string): number => parseFloat(value) || 0;
const inset = (style: CSSStyleDeclaration, side: "Top" | "Bottom"): number =>
  pixels(style[`border${side}Width`]) + pixels(style[`padding${side}`]);

/** The highlighted item scrolled into its scroller's content box: the
 * engine reserves a box's border cells as padding, so a scroll into
 * the scrollport would stop with the item under the border
 * (specs/ui.md). The first item takes the list to its top, a group's
 * label above it included. */
export function scrollToItem(details: ScrollDetails): void {
  const item = details.getElement();
  const scroller = item && scrollerOf(item);
  if (!item || !scroller) return;
  if (details.index === 0) {
    scroller.scrollTop = 0;
    return;
  }
  const style = getComputedStyle(scroller);
  const box = scroller.getBoundingClientRect();
  const rect = item.getBoundingClientRect();
  const top = box.top + inset(style, "Top");
  const bottom = box.bottom - inset(style, "Bottom");
  if (rect.top < top) scroller.scrollTop -= top - rect.top;
  else if (rect.bottom > bottom) scroller.scrollTop += rect.bottom - bottom;
}
