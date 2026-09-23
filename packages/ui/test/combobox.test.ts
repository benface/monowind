import * as Combobox from "@zag-js/combobox";
import { describe, expect, it, vi } from "vitest";
import { normalizeProps } from "@zag-js/vanilla";
import { api, collection, combobox, props } from "../src/combobox.ts";
import { start } from "../src/vanilla.ts";
import { by, settle } from "./helpers.ts";

/** The combobox on the grid (specs/ui.md): a listbox under what the
 * reader types into, so the anchor is the control and not the trigger
 * beside the input. */

describe("the api", () => {
  it("names the control as the anchor, leaving the trigger its own props", () => {
    const gridProps = props({ id: "c", collection: collection({ items: ["main"] }) });
    const machine = start(Combobox.machine, gridProps);
    const grid = api(Combobox.connect(machine.service, normalizeProps), normalizeProps, gridProps);
    // The list lines up under the whole control, not under the button.
    expect(grid.getControlProps()["style"]).toMatchObject({ anchorName: "--mw-ui-c" });
    expect(grid.getTriggerProps()["style"]).toBeUndefined();
    const positioner = grid.getPositionerProps();
    expect(positioner["popover"]).toBe("manual");
    expect(positioner["style"]).toMatchObject({
      positionAnchor: "--mw-ui-c",
      positionArea: "bottom span-right",
    });
    expect(grid.getContentProps()).not.toHaveProperty("hidden");
    machine.stop();
  });

  it("takes the placement and the gap a props names, in cells", () => {
    const gridProps = props({
      id: "c",
      collection: collection({ items: ["main"] }),
      positioning: { placement: "top-end", gutter: 1 },
    });
    const machine = start(Combobox.machine, gridProps);
    const grid = api(Combobox.connect(machine.service, normalizeProps), normalizeProps, gridProps);
    expect(grid.getPositionerProps()["style"]["positionArea"]).toBe("top span-left");
    expect(grid.getPositionerProps()["style"]["marginBottom"]).toBe("0.25rem");
    machine.stop();
  });
});

describe("the mount", () => {
  const markup = () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <label data-part="label">Branch</label>
      <div data-part="control">
        <input data-part="input" />
        <button data-part="trigger">▼</button>
        <button data-part="clear-trigger">×</button>
      </div>
      <div data-part="positioner">
        <div data-part="content">
          <div data-part="item" data-value="main"><span data-part="item-text">main</span></div>
          <div data-part="item" data-value="next"><span data-part="item-text">next</span></div>
        </div>
      </div>`;
    document.body.append(root);
    return root;
  };

  it("wires every part, the marked items its collection", async () => {
    const root = markup();
    const mounted = combobox(root, { id: "b" });
    await settle();
    expect(by(root, "input").getAttribute("role")).toBe("combobox");
    expect(by(root, "input").getAttribute("aria-autocomplete")).toBe("list");
    expect(by(root, "content").getAttribute("role")).toBe("listbox");
    expect(by(root, "item", "main").getAttribute("role")).toBe("option");
    expect(by(root, "control").style.getPropertyValue("anchor-name")).toBe("--mw-ui-b");
    expect(by(root, "positioner").style.getPropertyValue("position-anchor")).toBe("--mw-ui-b");
    // The markup's items are the collection where the props name none.
    expect(mounted.api.collection.getValues()).toEqual(["main", "next"]);
    mounted.destroy();
    root.remove();
  });

  it("starts at the item the markup marks selected", async () => {
    const root = markup();
    by(root, "item", "next").setAttribute("data-selected", "");
    const mounted = combobox(root, { id: "i" });
    await settle();
    expect(mounted.api.value).toEqual(["next"]);
    expect(by(root, "item", "next").getAttribute("aria-selected")).toBe("true");
    mounted.destroy();
    root.remove();
  });

  it("selects an item, and follows a collection the page narrows", async () => {
    const root = markup();
    const typed: string[] = [];
    const chosen: string[] = [];
    const mounted = combobox(root, {
      id: "f",
      onInputValueChange: ({ inputValue }) => typed.push(inputValue),
      onValueChange: ({ value }) => chosen.push(...value),
    });
    await settle();
    mounted.api.setOpen(true);
    await settle();
    by(root, "item", "next").click();
    await settle();
    expect(chosen).toEqual(["next"]);
    expect((by(root, "input") as HTMLInputElement).value).toBe("next");
    // Filtering is the page's: it hands back a narrowed collection.
    mounted.updateProps({ collection: collection({ items: ["next"] }) });
    await settle();
    expect(mounted.api.collection.getValues()).toEqual(["next"]);
    mounted.destroy();
    root.remove();
  });

  it("keeps the reader's caret when a keystroke opens the list", async () => {
    const root = markup();
    const mounted = combobox(root, { id: "k" });
    await settle();
    const input = by(root, "input") as HTMLInputElement;
    input.focus();
    await settle();
    // A backspace in the middle of "main", the list closed until then.
    input.value = "man";
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(mounted.api.open).toBe(true);
    expect(input.selectionStart).toBe(2);
    mounted.destroy();
    root.remove();
  });

  it("keeps the reader's caret when a keystroke opens a list whose open state is controlled", async () => {
    const root = markup();
    // Controlled as a framework's binding controls it: the machine asks,
    // the page writes the state back, and the machine opens on that.
    const mounted = combobox(root, {
      id: "c",
      open: false,
      onOpenChange: ({ open }) => mounted.updateProps({ open }),
    });
    await settle();
    const input = by(root, "input") as HTMLInputElement;
    input.focus();
    await settle();
    input.value = "man";
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(mounted.api.open).toBe(true);
    expect(input.selectionStart).toBe(2);
    mounted.destroy();
    root.remove();
  });

  it("clears the marker of a selection left out of a narrowed collection", async () => {
    const root = markup();
    const mounted = combobox(root, { id: "m", defaultValue: ["main"] });
    await settle();
    expect(by(root, "item", "main").hasAttribute("data-selected")).toBe(true);
    // Narrowed to the other item, then that one chosen: the first,
    // hidden, has left the selection, and a remount reads the second.
    mounted.updateProps({ collection: collection({ items: ["next"] }) });
    await settle();
    mounted.api.selectValue("next");
    await settle();
    expect(by(root, "item", "main").hasAttribute("data-selected")).toBe(false);
    expect(by(root, "item", "next").hasAttribute("data-selected")).toBe(true);
    mounted.destroy();
    const again = combobox(root, { id: "m" });
    await settle();
    expect(again.api.value).toEqual(["next"]);
    again.destroy();
    root.remove();
  });

  it("hides the items a narrowed collection leaves out, and shows them again", async () => {
    const root = markup();
    const mounted = combobox(root, { id: "n" });
    await settle();
    // Filtering is the page narrowing the collection; an item it drops
    // would otherwise stand in the list as plain markup.
    mounted.updateProps({ collection: collection({ items: ["next"] }) });
    await settle();
    expect(by(root, "item", "main").hidden).toBe(true);
    expect(by(root, "item", "next").hidden).toBe(false);
    mounted.updateProps({ collection: collection({ items: ["main", "next"] }) });
    await settle();
    expect(by(root, "item", "main").hidden).toBe(false);
    mounted.destroy();
    root.remove();
  });

  it("narrows from inside the callback, where the machine would undo it", async () => {
    const root = markup();
    const BRANCHES = ["main", "next"];
    const mounted = combobox(root, {
      id: "t",
      collection: collection({ items: BRANCHES }),
      // Filtering as the reader types is the whole point of a
      // combobox, and it happens inside a machine transition.
      onInputValueChange: ({ inputValue }) => {
        const matches = BRANCHES.filter((branch) => branch.includes(inputValue));
        mounted.updateProps({ collection: collection({ items: matches }) });
      },
    });
    await settle();
    const input = by(root, "input") as HTMLInputElement;
    input.focus();
    await settle();
    input.value = "ne";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    // The machine's own render comes after the callback's: the
    // narrowed collection has to survive it.
    expect(mounted.api.collection.getValues()).toEqual(["next"]);
    expect(by(root, "item", "main").hidden).toBe(true);
    expect(by(root, "item", "next").hidden).toBe(false);
    mounted.destroy();
    root.remove();
  });

  it("walks the narrowed items, the machine told its collection changed", async () => {
    const root = markup();
    const BRANCHES = ["main", "next"];
    const mounted = combobox(root, {
      id: "w",
      collection: collection({ items: BRANCHES }),
      onInputValueChange: ({ inputValue }) => {
        const matches = BRANCHES.filter((branch) => branch.includes(inputValue));
        mounted.updateProps({ collection: collection({ items: matches }) });
      },
    });
    await settle();
    const input = by(root, "input") as HTMLInputElement;
    input.focus();
    await settle();
    input.value = "ne";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    await settle();
    // Zag watches the collection and sends itself `CHILDREN_CHANGE`,
    // which only a re-run of its watchers fires: without it the list
    // narrows on screen while the keyboard walks the old items.
    expect(mounted.api.highlightedValue).toBe("next");
    expect(by(root, "item", "next").getAttribute("data-highlighted")).toBe("");
    mounted.destroy();
    root.remove();
  });

  it("keeps a narrowed collection whole, accessors and all", async () => {
    const root = markup();
    const mounted = combobox(root, { id: "m", collection: collection({ items: ["main"] }) });
    await settle();
    mounted.updateProps({ collection: collection({ items: ["next", "release"] }) });
    await settle();
    // A partial merges a level deep, which must not reach into a
    // class: spread into an object literal a collection keeps its
    // items and loses the accessors the machine navigates by.
    expect(mounted.api.collection.firstValue).toBe("next");
    expect(mounted.api.collection.getValues()).toEqual(["next", "release"]);
    mounted.destroy();
    root.remove();
  });

  it("costs the same per change, however many came before", async () => {
    const root = markup();
    const mounted = combobox(root, { id: "c", collection: collection({ items: ["main"] }) });
    await settle();
    const hundred = (): number => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        mounted.updateProps({ collection: collection({ items: ["main", "next"] }) });
      }
      return performance.now() - start;
    };
    const first = hundred();
    for (let round = 0; round < 3; round++) hundred();
    // A ratio, not a time: Zag's own `updateProps` wraps the props
    // source per call, which made the fifth hundred cost nine times
    // the first (671 ms against 6022 ms). Four times over a floor
    // leaves that caught and ordinary noise alone.
    expect(hundred()).toBeLessThan(Math.max(first, 25) * 4);
    mounted.destroy();
    root.remove();
  });

  it("destroy takes Zag's handlers off the parts", async () => {
    const root = markup();
    const mounted = combobox(root, { id: "d" });
    await settle();
    const removed = vi.spyOn(by(root, "input"), "removeEventListener");
    mounted.destroy();
    expect(removed.mock.calls.map(([type]) => type)).toContain("input");
    root.remove();
  });
});
