import { describe, expect, it } from "vitest";
import { scrollToItem } from "../src/scroll.ts";

/** The highlight scrolled into the content box (specs/ui.md): the
 * engine reserves a box's border cells as padding, so the item lands
 * inside them rather than under the border. */

/** A scroller with an item in it, both boxed where the test says: a
 * DOM without layout reports every rect as empty. */
function list(scroller: { top: number; bottom: number }, item: { top: number; bottom: number }) {
  const content = document.createElement("div");
  content.dataset["part"] = "content";
  content.style.overflowY = "auto";
  // The border's cells, which the engine gives the box as padding.
  content.style.paddingTop = "18px";
  content.style.paddingBottom = "18px";
  const element = document.createElement("div");
  content.append(element);
  document.body.append(content);
  const rect = (box: { top: number; bottom: number }) => () =>
    ({ ...box, height: box.bottom - box.top }) as DOMRect;
  content.getBoundingClientRect = rect(scroller);
  element.getBoundingClientRect = rect(item);
  return { content, details: { index: 1, getElement: () => element } };
}

describe("scrollToItem", () => {
  it("scrolls an item under the bottom border into the content box", () => {
    // The item sits on the box's last row, where the border paints.
    const { content, details } = list({ top: 0, bottom: 144 }, { top: 126, bottom: 144 });
    content.scrollTop = 36;
    scrollToItem(details);
    expect(content.scrollTop, "moved down by the border's cell").toBe(54);
  });

  it("scrolls an item above the top border down into it", () => {
    const { content, details } = list({ top: 0, bottom: 144 }, { top: 0, bottom: 18 });
    content.scrollTop = 54;
    scrollToItem(details);
    expect(content.scrollTop).toBe(36);
  });

  it("leaves an item already inside the content box alone", () => {
    const { content, details } = list({ top: 0, bottom: 144 }, { top: 54, bottom: 72 });
    content.scrollTop = 36;
    scrollToItem(details);
    expect(content.scrollTop).toBe(36);
  });

  it("takes the list to its top for the collection's first item", () => {
    // Zag asks for index 0 both to highlight it and to reset the list,
    // so the top wins over the item's own box: a group's label above it
    // shows with it.
    const { content, details } = list({ top: 0, bottom: 144 }, { top: 54, bottom: 72 });
    content.scrollTop = 36;
    scrollToItem({ ...details, index: 0 });
    expect(content.scrollTop).toBe(0);
  });

  it("does nothing where no ancestor scrolls", () => {
    const element = document.createElement("div");
    document.body.append(element);
    expect(() => scrollToItem({ index: 1, getElement: () => element })).not.toThrow();
    element.remove();
  });
});
