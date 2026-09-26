import { mount, unmount, tick } from "svelte";
import { beforeEach, describe, expect, it } from "vitest";
import Harness from "./Harness.svelte";
import Provided from "./Provided.svelte";
import Bound from "./Bound.svelte";
import Hidden from "./Hidden.svelte";
import Triggered from "./Triggered.svelte";
import Mixed from "./Mixed.svelte";
import { ListboxItem, type createSelect } from "../src/index.svelte.ts";
import { by, popoverApi, posted, resetByClick, settle } from "../../ui/test/helpers.ts";

/** The compound components (specs/ui.md "Component layer"): the parts
 * over the same `create…` functions, a nested `MenuRoot` the submenu
 * of the menu around it, and a listbox and a select whose roots are
 * elements of their own. Mounting the tree is also what compiles
 * every component the package ships. */

let container: HTMLElement;
let tree: Record<string, unknown>;

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
    expect(by(container, "trigger").getAttribute("aria-haspopup")).toBe("menu");
    expect(by(container, "trigger").style.getPropertyValue("anchor-name")).toBe("--mw-ui-file");
    expect(by(container, "content").getAttribute("role")).toBe("menu");
    expect(by(container, "item", "new").getAttribute("role")).toBe("menuitem");
    expect(by(container, "separator").getAttribute("role")).toBe("separator");
    const triggerItem = by(container, "trigger-item");
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
    // Scoped: a popover's trigger says `dialog` too.
    expect(all('[data-scope="dialog"][aria-haspopup="dialog"]')).toHaveLength(1);
  });

  it("hands a child snippet the part's props to spread itself", () => {
    // Svelte's stand-in for asChild: one element, the author's, with
    // the part's props on it. An attribute written after the spread
    // beats it, so the author keeps both classes by saying so.
    const close = container.querySelector<HTMLElement>("[data-test='close']")!;
    expect(close.tagName).toBe("BUTTON");
    expect(close.className.split(" ").sort()).toEqual(["from-child", "from-part"]);
    expect(close.getAttribute("data-part")).toBe("close-trigger");
    // Scoped: a popover has a close trigger of its own.
    expect(all('[data-scope="dialog"][data-part="close-trigger"]')).toHaveLength(1);
  });

  it("passes every HTML attribute through, a form's action included", () => {
    const form = container.querySelector<HTMLFormElement>("[data-test='form']")!;
    expect(form.getAttribute("data-part")).toBe("content");
    expect(form.getAttribute("action")).toBe("/delete");
    expect(form.getAttribute("method")).toBe("post");
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
    // Scoped: a combobox's trigger says `listbox` too.
    expect(all('[data-scope="select"][aria-haspopup="listbox"]')).toHaveLength(1);
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
    // The placeholder until something is chosen, as the mount writes it.
    expect(by(container, "value-text").textContent?.trim()).toBe("branch…");
    const positioner = popoverApi(by(container, "positioner"));
    api.api.setOpen(true);
    await tick();
    expect(by(container, "content").getAttribute("data-state")).toBe("open");
    // The positioner's action puts it in the top layer as it opens.
    expect(positioner.isOpen()).toBe(true);
    by(container, "item", "next").click();
    await tick();
    expect(api.api.value).toEqual(["next"]);
    expect(by(container, "value-text").textContent?.trim()).toBe("next");
    // The selection marked as a listbox's items and the mount's are.
    expect(by(container, "item", "next").hasAttribute("data-selected")).toBe(true);
    expect(by(container, "item", "main").hasAttribute("data-selected")).toBe(false);
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("next");
    await unmount(tree);
    container.remove();
  });
});

describe("a listbox", () => {
  it("selects on a click, the state and the indicator following", async () => {
    by(container, "item", "next").click();
    await tick();
    expect(by(container, "item", "next").getAttribute("data-state")).toBe("checked");
    expect(by(container, "item", "main").getAttribute("data-state")).toBe("unchecked");
    const indicator = by(container, "item", "next").querySelector('[data-part="item-indicator"]')!;
    expect(indicator.getAttribute("data-state")).toBe("checked");
  });
});

describe("an item part", () => {
  it("reads the nearest list root, whichever of the three it is named for", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const tree = mount(Mixed, { target: container });
    await tick();
    const item = by(container, "item");
    expect(item.getAttribute("data-scope")).toBe("listbox");
    expect(item.getAttribute("role")).toBe("option");
    await unmount(tree);
    container.remove();
  });

  it("says where it belongs, outside a list root or its item", () => {
    const container = document.createElement("div");
    expect(() => mount(ListboxItem, { target: container, props: { value: "main" } })).toThrow(
      "an item part must be inside <ListboxRoot>, <SelectRoot> or <ComboboxRoot>",
    );
    expect(() => mount(Mixed, { target: container, props: { stray: true } })).toThrow(
      "an item's text and indicator must be inside its Item",
    );
  });
});

describe("a combobox", () => {
  it("names its input and anchors its list under the control", () => {
    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(input.placeholder).toBe("branch…");
    const control = all('[data-part="control"]').find((el) => el.contains(input))!;
    // The list lines up under the control, not the button beside it.
    expect(control.style.getPropertyValue("anchor-name")).toBe("--mw-ui-find");
    const positioner = all('[data-part="positioner"]').find(
      (el) => el.style.getPropertyValue("position-anchor") === "--mw-ui-find",
    );
    expect(positioner).toBeDefined();
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
    by(container, "trigger").click();
    await tick();
    expect(state.open).toBe(true);
    by(container, "item", "next").click();
    await tick();
    expect(state.value).toEqual(["next"]);
    expect(state.open).toBe(false);
    await unmount(tree);
    container.remove();
  });
});

describe("a bound trigger value and input value", () => {
  it("follows the trigger pressed and the text typed", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let state: { menu?: string; dialog?: string; input?: string } = {};
    const tree = mount(Triggered, {
      target: container,
      props: { read: (next: typeof state) => (state = next) },
    });
    await tick();
    const at = (selector: string) => container.querySelectorAll<HTMLElement>(selector);
    at('[data-scope="menu"][data-part="trigger"]')[1]!.click();
    await tick();
    at('[data-scope="dialog"][data-part="trigger"]')[1]!.click();
    await tick();
    // An idle combobox takes typing once its input has focus.
    const input = at("input")[0] as HTMLInputElement;
    input.focus();
    input.value = "ne";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(state).toEqual({ menu: "b", dialog: "b", input: "ne" });
    await unmount(tree);
    container.remove();
  });
});

describe("a select's hidden control", () => {
  const mountHidden = async (props: {
    id: string;
    initial: string[];
    multiple?: boolean;
    defaultValue?: string[];
  }) => {
    const container = document.createElement("div");
    document.body.append(container);
    let change!: {
      items(next: string[]): void;
      name(next: string): void;
      api(): ReturnType<typeof createSelect>["api"];
    };
    const tree = mount(Hidden, {
      target: container,
      props: { ...props, change: (to) => (change = to) },
    });
    await tick();
    const hidden = container.querySelector("select")!;
    return {
      hidden,
      posted: () => posted(hidden),
      change,
      unmount: () => unmount(tree).then(() => container.remove()),
    };
  };

  it("selects every option a multiple select's value holds, through a render that keeps it", async () => {
    const select = await mountHidden({
      id: "several",
      initial: ["main", "next", "old"],
      multiple: true,
      defaultValue: ["main", "old"],
    });
    expect(select.posted()).toEqual(["main", "old"]);
    select.change.name("targets");
    await tick();
    expect(select.hidden.name).toBe("targets");
    expect(select.posted()).toEqual(["main", "old"]);
    await select.unmount();
  });

  it("selects the option of a value that arrived before it, and none for one no option holds", async () => {
    const select = await mountHidden({ id: "early", initial: ["main"], defaultValue: ["release"] });
    expect(select.posted(), "no option chosen in its place").toEqual([]);
    select.change.items(["main", "release"]);
    await tick();
    expect(select.posted()).toEqual(["release"]);
    await select.unmount();
  });

  it("goes back to its default at a reset the reader clicks, or to no option", async () => {
    const select = await mountHidden({
      id: "clicked",
      initial: ["main", "next"],
      defaultValue: ["next"],
    });
    select.change.api().setValue(["main"]);
    await tick();
    expect(select.posted()).toEqual(["main"]);
    await resetByClick(select.hidden.form!);
    expect(select.change.api().value).toEqual(["next"]);
    expect(select.posted()).toEqual(["next"]);
    await select.unmount();
    const empty = await mountHidden({ id: "clicked-empty", initial: ["main", "next"] });
    empty.change.api().setValue(["main"]);
    await tick();
    await resetByClick(empty.hidden.form!);
    expect(empty.change.api().value).toEqual([]);
    expect(empty.posted(), "no option chosen in its place").toEqual([]);
    await empty.unmount();
  });

  it("keeps a single select's option through an observer that deselects it as the options change", async () => {
    const select = await mountHidden({
      id: "observed",
      initial: ["main", "next"],
      defaultValue: ["next"],
    });
    // Svelte's own on a spread <select>, from 5.20 until 5.56.8: every
    // option change, a microtask on, selects its `value`, here none.
    const observer = new MutationObserver(() => (select.hidden.selectedIndex = -1));
    observer.observe(select.hidden, { childList: true, subtree: true });
    select.change.items(["main", "next", "release"]);
    await tick();
    await settle();
    expect(select.posted()).toEqual(["next"]);
    observer.disconnect();
    await select.unmount();
  });

  it("goes back to several values at a reset the reader clicks", async () => {
    const select = await mountHidden({
      id: "clicked-several",
      initial: ["main", "next"],
      multiple: true,
      defaultValue: ["main", "next"],
    });
    select.change.api().setValue([]);
    await tick();
    await resetByClick(select.hidden.form!);
    expect(select.change.api().value).toEqual(["main", "next"]);
    expect(select.posted()).toEqual(["main", "next"]);
    await select.unmount();
  });
});
