import { describe, expect, it } from "vitest";
import { collapsible } from "../src/collapsible.ts";
import { by, settle } from "./helpers.ts";

/** The collapsible on the grid (specs/ui.md): Zag's machine over marked
 * markup, its parts in the flow, its content's size variables dropped. */

const markup = (inner = ""): HTMLElement => {
  const root = document.createElement("div");
  root.id = "more";
  root.innerHTML = `
    <button data-part="trigger">More <span data-part="indicator">+</span></button>
    <div data-part="content"><p>Folded text</p>${inner}</div>`;
  document.body.append(root);
  return root;
};

describe("the mount", () => {
  it("wires every part a tick after the mount, the root the element it was given", async () => {
    const root = markup();
    const mounted = collapsible(root, { id: "c" });
    await settle();
    expect(root.dataset["part"]).toBe("root");
    expect(root.id, "the markup's own id names it").toBe("more");
    const trigger = by(root, "trigger");
    const content = by(root, "content");
    expect(trigger.getAttribute("aria-controls")).toBe(content.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(content.hidden, "closed, the content leaves the layout").toBe(true);
    expect(by(root, "indicator").dataset["state"]).toBe("closed");
    trigger.click();
    await settle();
    expect(content.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(by(root, "indicator").dataset["state"]).toBe("open");
    mounted.destroy();
    root.remove();
  });

  it("drops the content's size variables, which the grid would read on its spacing scale", async () => {
    const root = markup();
    const mounted = collapsible(root, { id: "s" });
    await settle();
    by(root, "trigger").click();
    await settle();
    const { style } = by(root, "content");
    expect([style.getPropertyValue("--height"), style.getPropertyValue("--width")]).toEqual([
      "",
      "",
    ]);
    mounted.destroy();
    root.remove();
  });

  it("keeps the author's collapsed size, its content shown to that height", async () => {
    const root = markup();
    const mounted = collapsible(root, { id: "k", collapsedHeight: 8 });
    await settle();
    const content = by(root, "content");
    expect(content.hidden).toBe(false);
    expect(content.style.maxHeight).toBe("8px");
    mounted.destroy();
    root.remove();
  });

  it("leaves a collapsible nested in it, under a root of its own, its own parts", async () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-part="trigger">Outer</button>
      <div data-part="content">
        <div data-part="root" data-test="inner">
          <button data-part="trigger">Inner <span data-part="indicator">+</span></button>
          <div data-part="content"><p>Inner text</p></div>
        </div>
      </div>`;
    document.body.append(root);
    const inner = root.querySelector<HTMLElement>('[data-test="inner"]')!;
    const outer = collapsible(root, { id: "outer" });
    const nested = collapsible(inner, { id: "inner" });
    await settle();
    by(root, "trigger").click();
    await settle();
    expect(outer.api.open).toBe(true);
    expect(by(inner, "trigger").getAttribute("aria-controls")).toBe("collapsible:inner:content");
    expect(by(inner, "indicator").dataset["state"], "the inner one's, closed").toBe("closed");
    outer.destroy();
    nested.destroy();
    root.remove();
  });
});
