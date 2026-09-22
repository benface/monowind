import { mount, unmount, tick } from "svelte";
import { beforeEach, describe, expect, it } from "vitest";
import Harness from "./Harness.svelte";
import Provided from "./Provided.svelte";
import Bound from "./Bound.svelte";
import type { createSelect } from "../src/index.svelte.ts";

/** The compound components (specs/ui.md "Component layer"): the parts
 * over the same `create…` functions, a nested `MenuRoot` the submenu
 * of the menu around it, and a listbox and a select whose roots are
 * elements of their own. Mounting the tree is also what compiles
 * every component the package ships. */

let container: HTMLElement;
let tree: Record<string, unknown>;

const by = (part: string, value?: string) =>
  container.querySelector<HTMLElement>(
    value ? `[data-part="${part}"][data-value="${value}"]` : `[data-part="${part}"]`,
  )!;
const all = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector));

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  tree = mount(Harness, { target: container });
  await tick();
  return async () => {
    await unmount(tree);
    container.remove();
  };
});

describe("a menu", () => {
  it("wires every part, and a nested root is its submenu", () => {
    expect(by("trigger").getAttribute("aria-haspopup")).toBe("menu");
    expect(by("trigger").style.getPropertyValue("anchor-name")).toBe("--mw-ui-file");
    expect(by("content").getAttribute("role")).toBe("menu");
    expect(by("item", "new").getAttribute("role")).toBe("menuitem");
    expect(by("separator").getAttribute("role")).toBe("separator");
    const triggerItem = by("trigger-item");
    expect(triggerItem.getAttribute("aria-haspopup")).toBe("menu");
    expect(triggerItem.style.getPropertyValue("anchor-name")).toBe("--mw-ui-share");
    // The submenu takes the side it opens on from the menu above it.
    const submenu = all('[data-part="positioner"]')[1]!;
    expect(submenu.style.getPropertyValue("position-anchor")).toBe("--mw-ui-share");
    expect(submenu.style.getPropertyValue("position-area")).toBe("right span-bottom");
  });
});

describe("a dialog", () => {
  it("names its parts and anchors its positioner in the top layer", () => {
    const dialog = all('[role="dialog"]')[0]!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-state")).toBe("closed");
    expect(all('[aria-haspopup="dialog"]')).toHaveLength(1);
  });

  it("hands a child snippet the part's props to spread itself", () => {
    // Svelte's stand-in for asChild: one element, the author's, with
    // the part's props on it. An attribute written after the spread
    // beats it, so the author keeps both classes by saying so.
    const close = container.querySelector<HTMLElement>("[data-test='close']")!;
    expect(close.tagName).toBe("BUTTON");
    expect(close.className.split(" ").sort()).toEqual(["from-child", "from-part"]);
    expect(close.getAttribute("data-part")).toBe("close-trigger");
    expect(all('[data-part="close-trigger"]')).toHaveLength(1);
  });
});

describe("a listbox", () => {
  it("renders its own root element, the author's attributes on it", () => {
    const root = container.querySelector<HTMLElement>("[data-test='listbox']")!;
    expect(root.className).toBe("border");
    expect(root.getAttribute("data-part")).toBe("root");
    expect(root.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    const options = Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options).toHaveLength(2);
    // The text and the indicator find their item through the item they
    // are inside, not through a value of their own.
    expect(options[0]!.querySelector('[data-part="item-text"]')?.textContent).toBe("main");
    expect(options[0]!.querySelector('[data-part="item-indicator"]')).not.toBeNull();
  });
});

describe("a select", () => {
  it("renders its parts and hides its form control out of the grid", () => {
    expect(all('[aria-haspopup="listbox"]')).toHaveLength(1);
    const hidden = container.querySelector<HTMLSelectElement>("select")!;
    expect(hidden.name).toBe("branch");
    // Hidden by display, not by Zag's visually-hidden box, which would
    // take cells on the grid.
    expect(hidden.style.display).toBe("none");
    expect(hidden.querySelectorAll("option")).toHaveLength(2);
  });
});

describe("an API the caller holds", () => {
  it("drives a select through a root provider, the choice written into its trigger", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let api!: ReturnType<typeof createSelect>;
    const tree = mount(Provided, {
      target: container,
      props: { ready: (held: ReturnType<typeof createSelect>) => (api = held) },
    });
    await tick();
    const at = (part: string, value?: string) =>
      container.querySelector<HTMLElement>(
        value ? `[data-part="${part}"][data-value="${value}"]` : `[data-part="${part}"]`,
      )!;
    // The placeholder until something is chosen, as the mount writes it.
    expect(at("value-text").textContent?.trim()).toBe("branch…");
    api.api.setOpen(true);
    await tick();
    expect(at("content").getAttribute("data-state")).toBe("open");
    at("item", "next").click();
    await tick();
    expect(api.api.value).toEqual(["next"]);
    expect(at("value-text").textContent?.trim()).toBe("next");
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("next");
    await unmount(tree);
    container.remove();
  });
});

describe("a listbox", () => {
  it("selects on a click, the state and the indicator following", async () => {
    by("item", "next").click();
    await tick();
    expect(by("item", "next").getAttribute("data-state")).toBe("checked");
    expect(by("item", "main").getAttribute("data-state")).toBe("unchecked");
    const indicator = by("item", "next").querySelector('[data-part="item-indicator"]')!;
    expect(indicator.getAttribute("data-state")).toBe("checked");
  });
});

describe("a bound prop", () => {
  it("follows the machine both ways, as bind: asks", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let state = { open: false, value: [] as string[] };
    const tree = mount(Bound, {
      target: container,
      props: { read: (next: { open: boolean; value: string[] }) => (state = next) },
    });
    await tick();
    const at = (part: string, value?: string) =>
      container.querySelector<HTMLElement>(
        value ? `[data-part="${part}"][data-value="${value}"]` : `[data-part="${part}"]`,
      )!;
    at("trigger").click();
    await tick();
    expect(state.open).toBe(true);
    at("item", "next").click();
    await tick();
    expect(state.value).toEqual(["next"]);
    expect(state.open).toBe(false);
    await unmount(tree);
    container.remove();
  });
});
