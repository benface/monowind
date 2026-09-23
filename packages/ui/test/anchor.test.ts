import { normalizeProps } from "@zag-js/vanilla";
import { describe, expect, it } from "vitest";
import {
  FALLBACKS,
  anchorName,
  positionerProps,
  omit,
  pick,
  positioning,
  triggerProps,
  withHandlers,
  withProps,
  type Placement,
} from "../src/anchor.ts";

/** The grid's props for a floating part (specs/ui.md): the placement's
 * area, the anchor's name, and the merge into Zag's props. */

describe("the placement", () => {
  it("maps each of Zag's placements to the area that places it", () => {
    const area = (placement: Placement) =>
      positionerProps("--a", { placement, gutter: 0, shift: 0 }).style["positionArea"];
    expect(area("bottom")).toBe("bottom");
    expect(area("bottom-start")).toBe("bottom span-right");
    expect(area("bottom-end")).toBe("bottom span-left");
    expect(area("top")).toBe("top");
    expect(area("top-start")).toBe("top span-right");
    expect(area("top-end")).toBe("top span-left");
    expect(area("right")).toBe("right");
    expect(area("right-start")).toBe("right span-bottom");
    expect(area("right-end")).toBe("right span-top");
    expect(area("left")).toBe("left");
    expect(area("left-start")).toBe("left span-bottom");
    expect(area("left-end")).toBe("left span-top");
  });

  it("names the anchor from the id, as a dashed ident, and a trigger's value", () => {
    expect(anchorName("menu")).toBe("--mw-ui-menu");
    expect(anchorName(":r0:")).toBe("--mw-ui--r0-");
    expect(anchorName("menu", "a:b")).toBe("--mw-ui-menu-a-b");
    expect(triggerProps("x").style.anchorName).toBe("--mw-ui-x");
    expect(triggerProps("x", "v").style.anchorName).toBe("--mw-ui-x-v");
    expect(
      positionerProps("--a", { placement: "top", gutter: 0, shift: 0 }).style["positionAnchor"],
    ).toBe("--a");
  });

  it("gives the positioner the popover, the flips, one width, and the gutter on the anchor's side", () => {
    const below = positionerProps("--a", { placement: "bottom-start", gutter: 1, shift: 0 });
    expect(below.popover).toBe("manual");
    expect(below.style["positionTryFallbacks"]).toBe(FALLBACKS);
    expect(below.style["minWidth"]).toBe("max-content");
    expect(below.style["marginTop"]).toBe("0.25rem");
    expect(
      positionerProps("--a", { placement: "left", gutter: 2, shift: 0 }).style["marginRight"],
    ).toBe("0.5rem");
    expect(
      positionerProps("--a", { placement: "top", gutter: -1, shift: 0 }).style["marginBottom"],
    ).toBe("-0.25rem");
    expect(
      positionerProps("--a", { placement: "top", gutter: 0, shift: 0 }).style,
    ).not.toHaveProperty("marginBottom");
  });

  it("shifts the positioner along its anchor from the edge it aligns to, or its center", () => {
    const beside = positionerProps("--a", { placement: "right-start", gutter: 0, shift: -1 });
    expect(beside.style["marginTop"]).toBe("-0.25rem");
    const belowEnd = positionerProps("--a", { placement: "bottom-end", gutter: 1, shift: 2 });
    expect(belowEnd.style["marginRight"]).toBe("0.5rem");
    expect(belowEnd.style["marginTop"]).toBe("0.25rem");
    // A centered box centers with its margins: twice the shift on one
    // side moves it by the shift.
    expect(
      positionerProps("--a", { placement: "top", gutter: 0, shift: 1 }).style["marginLeft"],
    ).toBe("0.5rem");
  });

  it("turns Zag's own positioning off, its px sizes with it", () => {
    const off = {
      applyStyles: false,
      flip: false,
      listeners: false,
      sizeMiddleware: false,
      sameWidth: false,
      fitViewport: false,
    };
    expect(positioning({ placement: "top", gutter: 4, sameWidth: true })).toEqual({
      placement: "top",
      gutter: 4,
      ...off,
    });
    expect(positioning(undefined)).toEqual(off);
  });
});

describe("the merge", () => {
  it("spreads object styles for the adapter, and joins strings from an adapter that gives them", () => {
    // Vanilla, React, Vue, Solid: styles are objects the DOM sets one
    // property at a time.
    const merged = withProps(
      normalizeProps,
      { id: "t", style: { color: "red" } },
      { style: { anchorName: "--a" } },
    );
    expect(merged).toEqual({ id: "t", style: { color: "red", anchorName: "--a" } });
    // Svelte's adapter stringifies both sides.
    const strings = { element: (props: object) => props } as never;
    const svelte = withProps(strings, { style: "color:red;" }, { style: "anchor-name:--a;" });
    expect(svelte).toEqual({ style: "color:red;anchor-name:--a;" });
  });

  it("takes the grid's style alone where Zag's is dropped, and lifts hidden", () => {
    const replaced = withProps(normalizeProps, omit({ style: { top: "0" } }, "style"), {
      style: { minWidth: "max-content" },
    });
    expect(replaced).toEqual({ style: { minWidth: "max-content" } });
    expect(omit({ hidden: true, "data-state": "closed" }, "hidden")).toEqual({
      "data-state": "closed",
    });
  });

  it("runs Zag's handler and ours in turn, under the key the adapter gives it", () => {
    const ran: string[] = [];
    // The vanilla adapter reads `onFocus` as the element's `focusin`,
    // so ours lands on Zag's own key or on none at all.
    const merged = withHandlers(
      normalizeProps,
      { onfocusin: () => ran.push("zag"), "data-part": "content" },
      { onFocus: () => ran.push("ours") },
    ) as { onfocusin: (event: unknown) => void; "data-part": string };
    merged.onfocusin({});
    expect(ran).toEqual(["zag", "ours"]);
    expect(merged["data-part"], "the rest of Zag's props ride along").toBe("content");
    const alone = withHandlers(normalizeProps, {}, { onFocus: () => ran.push("alone") }) as {
      onfocusin: (event: unknown) => void;
    };
    alone.onfocusin({});
    expect(ran).toEqual(["zag", "ours", "alone"]);
  });

  it("picks a parent's set props for a submenu, an explicit undefined left out", () => {
    const onSelect = () => {};
    expect(
      pick({ id: "p", onSelect, closeOnSelect: undefined, typeahead: false }, [
        "onSelect",
        "closeOnSelect",
        "typeahead",
      ]),
    ).toEqual({ onSelect, typeahead: false });
  });
});
