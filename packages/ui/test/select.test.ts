import * as Select from "@zag-js/select";
import { describe, expect, it, vi } from "vitest";
import { normalizeProps } from "@zag-js/vanilla";
import { api, props, select } from "../src/select.ts";
import { by, popoverApi, press, settle } from "./helpers.ts";
import { start } from "../src/vanilla.ts";

/** The select on the grid (specs/ui.md): Zag's API with the grid's
 * props, and the vanilla mount over marked markup. */

describe("the api", () => {
  it("names the trigger, anchors the positioner as a manual popover, shows the content", () => {
    const gridProps = props({ id: "s", collection: Select.collection({ items: ["main"] }) });
    expect(gridProps.positioning).toMatchObject({
      applyStyles: false,
      flip: false,
      listeners: false,
    });
    const machine = start(Select.machine, gridProps);
    const grid = api(Select.connect(machine.service, normalizeProps), normalizeProps, gridProps);
    expect(grid.getTriggerProps()["style"]).toEqual({ anchorName: "--mw-ui-s" });
    const positioner = grid.getPositionerProps();
    expect(positioner["popover"]).toBe("manual");
    expect(positioner["style"]).toMatchObject({
      positionAnchor: "--mw-ui-s",
      positionArea: "bottom span-right",
    });
    expect(grid.getContentProps()).not.toHaveProperty("hidden");
    machine.stop();
  });
});

describe("the mount", () => {
  const markup = (): HTMLElement => {
    const root = document.createElement("div");
    root.innerHTML = `
      <span data-part="label">Branch</span>
      <div data-part="control">
        <button data-part="trigger">
          <span data-part="value-text">Choose a branch</span>
          <span data-part="indicator">v</span>
        </button>
        <button data-part="clear-trigger">x</button>
      </div>
      <select data-part="hidden-select" name="branch"></select>
      <div data-part="positioner">
        <div data-part="content">
          <div data-part="list">
            <div data-part="item-group" data-value="local">
              <div data-part="item-group-label" data-value="local">Local</div>
              <div data-part="item" data-value="main">
                <span data-part="item-indicator">*</span><span data-part="item-text">main</span>
              </div>
              <div data-part="item" data-value="stale" data-disabled>
                <span data-part="item-indicator">*</span><span data-part="item-text">stale</span>
              </div>
              <div data-part="item" data-value="next">
                <span data-part="item-indicator">*</span><span data-part="item-text">next</span>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    document.body.append(root);
    return root;
  };

  it("wires every part a tick after the mount and opens on the trigger", async () => {
    const root = markup();
    const shown = popoverApi(by(root, "positioner"));
    const mounted = select(root, { id: "s" });
    expect(by(root, "content").getAttribute("role")).toBe(null);
    await settle();
    expect(root.dataset["part"]).toBe("root");
    expect(by(root, "trigger").getAttribute("aria-haspopup")).toBe("listbox");
    expect(by(root, "positioner").getAttribute("popover")).toBe("manual");
    expect(by(root, "positioner").style.getPropertyValue("position-area")).toBe(
      "bottom span-right",
    );
    expect(by(root, "content").getAttribute("role")).toBe("listbox");
    expect(by(root, "list").getAttribute("aria-labelledby")).toBe("select:s:trigger");
    expect(by(root, "item", "main").getAttribute("role")).toBe("option");
    expect(by(root, "item", "stale").getAttribute("aria-disabled")).toBe("true");
    expect(by(root, "item-group", "local").getAttribute("role")).toBe("group");
    by(root, "trigger").click();
    await settle();
    expect(mounted.api.open).toBe(true);
    expect(shown.isOpen()).toBe(true);
    mounted.destroy();
    expect(shown.isOpen()).toBe(false);
    root.remove();
  });

  it("shows the value in the value text, the markup's own text its placeholder", async () => {
    const root = markup();
    const onValueChange = vi.fn();
    const mounted = select(root, { id: "v", onValueChange });
    await settle();
    expect(by(root, "value-text").textContent).toBe("Choose a branch");
    mounted.api.setOpen(true);
    await settle();
    by(root, "item", "next").click();
    await settle();
    expect(mounted.api.value).toEqual(["next"]);
    expect(onValueChange).toHaveBeenCalledWith({
      value: ["next"],
      items: [{ value: "next", label: "next", disabled: false }],
    });
    expect(by(root, "value-text").textContent).toBe("next");
    // Selecting closes it, and clearing puts the placeholder back.
    expect(mounted.api.open).toBe(false);
    by(root, "clear-trigger").click();
    await settle();
    expect(mounted.api.value).toEqual([]);
    expect(by(root, "value-text").textContent).toBe("Choose a branch");
    mounted.destroy();
    root.remove();
  });

  it("carries the value into a form through the hidden select, off the grid", async () => {
    const root = markup();
    const mounted = select(root, { id: "f", name: "branch" });
    await settle();
    const hidden = by(root, "hidden-select") as HTMLSelectElement;
    expect(hidden.style.display, "the layout skips it").toBe("none");
    expect(hidden.getAttribute("name")).toBe("branch");
    expect([...hidden.options].map((option) => option.value)).toEqual(["main", "stale", "next"]);
    mounted.api.setValue(["next"]);
    await settle();
    expect(hidden.value).toBe("next");
    mounted.destroy();
    root.remove();
  });

  it("follows a change on the hidden select, as a form autofill makes it", async () => {
    const root = markup();
    const mounted = select(root, { id: "a" });
    await settle();
    const hidden = by(root, "hidden-select") as HTMLSelectElement;
    hidden.value = "next";
    // The adapter reads Zag's `onChange` as the element's `input`, the
    // event a browser sends first.
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(mounted.api.value).toEqual(["next"]);
    expect(by(root, "value-text").textContent).toBe("next");
    mounted.destroy();
    root.remove();
  });

  it("carries several values into a form where the select takes several", async () => {
    const root = markup();
    const mounted = select(root, { id: "n", multiple: true, defaultValue: ["main", "next"] });
    await settle();
    const hidden = by(root, "hidden-select") as HTMLSelectElement;
    expect(hidden.multiple).toBe(true);
    expect([...hidden.selectedOptions].map((option) => option.value)).toEqual(["main", "next"]);
    expect(by(root, "content").getAttribute("aria-multiselectable")).toBe("true");
    expect(by(root, "value-text").textContent, "the values as one string").toBe("main, next");
    // A press taking a value back out is the story's to show: this DOM
    // holds a multiple select's selection however the options are set.
    mounted.destroy();
    root.remove();
  });

  it("walks the items with the keyboard, past the disabled one", async () => {
    const root = markup();
    const mounted = select(root, { id: "k" });
    await settle();
    mounted.api.setOpen(true);
    await settle();
    expect(press(root, "ArrowDown")).toBe(true);
    await settle();
    expect(mounted.api.highlightedValue).toBe("main");
    // Past the disabled item between them, and no further at the end.
    press(root, "ArrowDown");
    await settle();
    expect(mounted.api.highlightedValue).toBe("next");
    press(root, "ArrowDown");
    await settle();
    expect(mounted.api.highlightedValue).toBe("next");
    press(root, "Enter");
    await settle();
    expect(mounted.api.value).toEqual(["next"]);
    mounted.destroy();
    root.remove();
  });
});
