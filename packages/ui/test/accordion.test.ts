import { describe, expect, it } from "vitest";
import { accordion } from "../src/accordion.ts";
import { by, settle } from "./helpers.ts";

/** The accordion on the grid (specs/ui.md): Zag's machine over marked
 * markup, its parts in the flow, the items its markup marks open. */

const item = (value: string, marks = "") => `
  <div data-part="item" data-value="${value}" ${marks}>
    <button data-part="item-trigger">${value}</button>
    <div data-part="item-content"><p>${value} body</p></div>
  </div>`;

const markup = (items: string): HTMLElement => {
  const root = document.createElement("div");
  root.id = "faq";
  root.innerHTML = items;
  document.body.append(root);
  return root;
};

describe("the mount", () => {
  it("wires every part a tick after the mount, each item by its value", async () => {
    const root = markup(item("a") + item("b"));
    const mounted = accordion(root, { id: "f" });
    await settle();
    expect(root.dataset["part"]).toBe("root");
    expect(root.id, "the markup's own id names it").toBe("faq");
    const trigger = by(root, "item", "a").querySelector("[data-part='item-trigger']")!;
    const content = by(root, "item", "a").querySelector<HTMLElement>("[data-part='item-content']")!;
    expect(trigger.getAttribute("aria-controls")).toBe(content.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(content.getAttribute("role")).toBe("region");
    expect(content.hidden).toBe(true);
    // A browser focuses a pressed button, where Zag's click lands.
    (trigger as HTMLElement).focus();
    (trigger as HTMLElement).click();
    await settle();
    expect(content.hidden).toBe(false);
    expect(mounted.api.value).toEqual(["a"]);
    mounted.destroy();
    root.remove();
  });

  it("opens the items its markup marks open, the first alone unless multiple", async () => {
    const marked = item("a") + item("b", 'data-state="open"') + item("c", 'data-state="open"');
    for (const [multiple, open] of [
      [false, ["b"]],
      [true, ["b", "c"]],
    ] as const) {
      const root = markup(marked);
      const mounted = accordion(root, { id: `m${multiple}`, multiple });
      await settle();
      expect(mounted.api.value, `multiple: ${multiple}`).toEqual(open);
      mounted.destroy();
      root.remove();
    }
    const root = markup(marked);
    const mounted = accordion(root, { id: "p", defaultValue: ["a"] });
    await settle();
    expect(mounted.api.value, "the props' own over the markup's").toEqual(["a"]);
    mounted.destroy();
    root.remove();
  });

  it("walks its triggers by the arrows, Zag finding them under the markup's own id", async () => {
    const root = markup(item("a") + item("b") + item("c"));
    const mounted = accordion(root, { id: "k" });
    await settle();
    const trigger = (value: string) =>
      by(root, "item", value).querySelector<HTMLElement>("[data-part='item-trigger']")!;
    trigger("a").focus();
    for (const [key, to] of [
      ["ArrowDown", "b"],
      ["End", "c"],
      ["Home", "a"],
    ] as const) {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await settle();
      expect(document.activeElement, key).toBe(trigger(to));
    }
    mounted.destroy();
    root.remove();
  });

  it("disables an item its markup marks", async () => {
    const root = markup(item("a") + item("b", "data-disabled"));
    const mounted = accordion(root, { id: "d" });
    await settle();
    const trigger = by(root, "item", "b").querySelector<HTMLButtonElement>(
      "[data-part='item-trigger']",
    )!;
    expect(trigger.disabled).toBe(true);
    mounted.destroy();
    root.remove();
  });

  it("leaves an accordion inside an item's content that one's own items", async () => {
    const root = markup(
      item("a", 'data-state="open"').replace(
        "<p>a body</p>",
        `<div data-test="inner">${item("x")}${item("y")}</div>`,
      ),
    );
    const inner = root.querySelector<HTMLElement>('[data-test="inner"]')!;
    const outer = accordion(root, { id: "outer", collapsible: true });
    const nested = accordion(inner, { id: "inner" });
    await settle();
    expect(outer.api.value).toEqual(["a"]);
    // The outer one's own render, after the inner's.
    outer.api.setValue([]);
    await settle();
    outer.api.setValue(["a"]);
    await settle();
    expect(nested.api.value).toEqual([]);
    expect(by(inner, "item", "x").querySelector("[data-part='item-trigger']")!.id).toBe(
      "accordion:inner:trigger:x",
    );
    outer.destroy();
    nested.destroy();
    root.remove();
  });

  it("finds an item's own trigger past a nested accordion in its content, wherever it sits", async () => {
    const root = markup(`
      <div data-part="item" data-value="a">
        <div data-part="item-content"><div data-test="inner">${item("x")}</div></div>
        <button data-part="item-trigger" data-test="own">a</button>
      </div>`);
    const inner = root.querySelector<HTMLElement>('[data-test="inner"]')!;
    const nested = accordion(inner, { id: "inner" });
    const outer = accordion(root, { id: "outer" });
    await settle();
    const own = root.querySelector<HTMLElement>('[data-test="own"]')!;
    expect(own.getAttribute("aria-controls")).toBe(by(root, "item", "a").firstElementChild!.id);
    expect(by(inner, "item", "x").querySelector("[data-part='item-trigger']")!.id).toBe(
      "accordion:inner:trigger:x",
    );
    outer.destroy();
    nested.destroy();
    root.remove();
  });
});
