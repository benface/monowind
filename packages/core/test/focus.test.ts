import { describe, expect, it } from "vitest";
import { arrowIsNative, directionOf, extentOf, focusableRects, nextFocus } from "../src/focus.ts";
import { layoutRoot } from "../src/layout.ts";
import { buildTree } from "../src/tree.ts";
import type { Focusable } from "../src/focus.ts";
import type { Rect } from "../src/types.ts";

/** Arrow-key focus navigation (specs/focus-navigation.md). */

const box = (x: number, y: number, width = 4, height = 1): Rect => ({ x, y, width, height });
const named = (name: string, rect: Rect): Focusable => {
  const element = document.createElement("button");
  element.textContent = name;
  return { element, rect };
};
const pick = (direction: "up" | "down" | "left" | "right", current: Rect, all: Focusable[]) =>
  nextFocus(direction, current, all)?.textContent ?? null;

describe("nextFocus", () => {
  const current = box(10, 5);

  it("moves to the nearest box entirely beyond the edge, in each direction", () => {
    const all = [
      named("above", box(10, 2)),
      named("below-near", box(10, 7)),
      named("below-far", box(10, 9)),
      named("left", box(2, 5)),
      named("right", box(20, 5)),
    ];
    expect(pick("up", current, all)).toBe("above");
    expect(pick("down", current, all)).toBe("below-near");
    expect(pick("left", current, all)).toBe("left");
    expect(pick("right", current, all)).toBe("right");
  });

  it("ignores a box that overlaps the focused row: it is not below", () => {
    const all = [named("beside", box(16, 5, 4, 2)), named("below", box(10, 8))];
    expect(pick("down", current, all)).toBe("below");
    expect(pick("right", current, all)).toBe("beside");
  });

  it("prefers an aligned candidate over a nearer offset one", () => {
    const nearerOffset = named("nearer-offset", box(30, 7));
    const fartherAligned = named("farther-aligned", box(10, 8));
    expect(pick("down", current, [nearerOffset, fartherAligned])).toBe("farther-aligned");
    const nearerAligned = named("nearer-aligned", box(12, 7));
    expect(pick("down", current, [fartherAligned, nearerAligned])).toBe("nearer-aligned");
  });

  it("breaks an equal-distance, no-overlap tie by the smaller gap, then document order", () => {
    const far = named("far", box(40, 7));
    const near = named("near", box(16, 7));
    expect(pick("down", current, [far, near])).toBe("near");
    const twin = named("twin", box(16, 7));
    expect(pick("down", current, [near, twin])).toBe("near");
  });

  it("wraps nowhere: no candidate beyond the edge is null", () => {
    expect(pick("up", current, [named("below", box(10, 7))])).toBeNull();
    expect(pick("down", current, [])).toBeNull();
  });

  it("names the four arrow keys and nothing else", () => {
    expect(directionOf("ArrowDown")).toBe("down");
    expect(directionOf("Tab")).toBeNull();
  });
});

describe("focusableRects", () => {
  it("lists boxes, inline elements at their cells, and skips the unfocusable", () => {
    const host = document.createElement("div");
    // 20 cells wide (4px per cell in tests). The paragraph's third link
    // wraps onto its second line.
    host.innerHTML = `<div style="width: 80px">
      <div><button>one</button> <button>two</button></div>
      <p>See <a href="#">this</a> and <a href="#">that</a> or <a href="#">a link that wraps around</a></p>
      <div><button disabled>off</button> <span>plain</span></div>
      <div inert><button>inert</button></div>
      <div style="height: 4px; overflow: auto"><div>x</div><div>y</div><button>scrolled</button></div>
    </div>`;
    document.body.appendChild(host);
    const root = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(root, 20);
    // The scroll container sits one row down; simulate a scroll of 1.
    const scroller = root.children[4]!;
    scroller.scroll = { x: 0, y: 1 };
    const rects = focusableRects(root).map(({ element, rect }) => [
      element.textContent!.trim(),
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    ]);
    expect(rects).toEqual([
      ["one", 0, 0, 3, 1],
      ["two", 4, 0, 3, 1],
      ["this", 4, 1, 4, 1],
      ["that", 13, 1, 4, 1],
      // Wrapped over rows 2 and 3: one rect per line.
      ["a link that wraps around", 0, 2, 17, 1],
      ["a link that wraps around", 0, 3, 6, 1],
      // The scroll container starts on row 6; its button is on its third
      // row, painted one row up by the scroll, 19 wide beside the gutter.
      ["scrolled", 0, 7, 19, 1],
    ]);
    // The wrapped link's own extent is the union of its lines.
    const wrapped = host.querySelectorAll("a")[2]!;
    expect(extentOf(focusableRects(root), wrapped)).toEqual({ x: 0, y: 2, width: 17, height: 2 });
  });
});

describe("arrowIsNative", () => {
  const make = (html: string): Element => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    return wrapper.firstElementChild!;
  };

  it("keeps the caret's arrows in text fields and all of them in multi-line editors", () => {
    const input = make('<input type="text">');
    expect(arrowIsNative(input, "ArrowLeft")).toBe(true);
    expect(arrowIsNative(input, "ArrowDown")).toBe(false);
    expect(arrowIsNative(make("<textarea></textarea>"), "ArrowLeft")).toBe(true);
    expect(arrowIsNative(make("<textarea></textarea>"), "ArrowDown")).toBe(true);
    const editable = make("<div contenteditable><b>x</b></div>");
    expect(arrowIsNative(editable.firstElementChild!, "ArrowUp")).toBe(true);
  });

  it("keeps the arrows of controls whose arrows mean something", () => {
    expect(arrowIsNative(make('<input type="radio">'), "ArrowDown")).toBe(true);
    expect(arrowIsNative(make('<input type="number">'), "ArrowUp")).toBe(true);
    expect(arrowIsNative(make('<input type="range">'), "ArrowLeft")).toBe(true);
    expect(arrowIsNative(make("<select multiple><option>a</option></select>"), "ArrowDown")).toBe(
      true,
    );
    expect(arrowIsNative(make('<select size="3"><option>a</option></select>'), "ArrowDown")).toBe(
      true,
    );
  });

  it("navigates from buttons, links, checkboxes, and a closed single select", () => {
    expect(arrowIsNative(make("<button>b</button>"), "ArrowDown")).toBe(false);
    expect(arrowIsNative(make('<a href="#">a</a>'), "ArrowLeft")).toBe(false);
    expect(arrowIsNative(make('<input type="checkbox">'), "ArrowRight")).toBe(false);
    const select = make("<select><option>a</option></select>");
    expect(arrowIsNative(select, "ArrowDown")).toBe(false);
    expect(arrowIsNative(select, "ArrowDown", true)).toBe(true);
  });
});
