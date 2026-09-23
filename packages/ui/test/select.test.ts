import * as Select from "@zag-js/select";
import { describe, expect, it, vi } from "vitest";
import { normalizeProps } from "@zag-js/vanilla";
import { api, collection, props, select } from "../src/select.ts";
import { by, popoverApi, posted, press, resetByClick, settle } from "./helpers.ts";
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

  /** The markup moved into a form, which is what a reset reaches. */
  const inForm = (root: HTMLElement): HTMLFormElement => {
    const form = document.createElement("form");
    root.replaceWith(form);
    form.append(root);
    return form;
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

  it("starts at the item the markup marks selected, the value text and form control with it", async () => {
    const root = markup();
    by(root, "item", "next").setAttribute("data-selected", "");
    const mounted = select(root, { id: "i" });
    await settle();
    expect(mounted.api.value).toEqual(["next"]);
    expect(by(root, "value-text").textContent).toBe("next");
    expect(root.querySelector<HTMLSelectElement>("select")!.value).toBe("next");
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

  it("gives the form an option for a value a new collection brings", async () => {
    const root = markup();
    const mounted = select(root, { id: "n", name: "branch" });
    await settle();
    mounted.updateProps({ collection: collection({ items: ["main", "release"] }) });
    await settle();
    const hidden = by(root, "hidden-select") as HTMLSelectElement;
    expect([...hidden.options].map((option) => option.value)).toEqual(["main", "release"]);
    mounted.api.setValue(["release"]);
    await settle();
    expect(hidden.value, "the form posts it").toBe("release");
    mounted.destroy();
    root.remove();
  });

  it("selects the option of a value that arrived before it, and none until then", async () => {
    const root = markup();
    const form = inForm(root);
    const mounted = select(root, { id: "e", name: "branch", defaultValue: ["release"] });
    await settle();
    expect(posted(form), "no option chosen in its place").toEqual([]);
    mounted.updateProps({ collection: collection({ items: ["main", "release"] }) });
    await settle();
    expect(posted(form)).toEqual(["release"]);
    mounted.destroy();
    form.remove();
  });

  it("posts nothing for a value no option holds", async () => {
    const root = markup();
    const form = inForm(root);
    const mounted = select(root, { id: "g", name: "branch", defaultValue: ["gone"] });
    await settle();
    expect(posted(form)).toEqual([]);
    mounted.destroy();
    form.remove();
  });

  it("goes back to its default at a form's reset, the machine and the form alike", async () => {
    const root = markup();
    const form = inForm(root);
    const mounted = select(root, { id: "r", name: "branch", defaultValue: ["next"] });
    await settle();
    // A reset the machine sees as no change: the form's own reset alone
    // puts the default back.
    form.reset();
    await settle();
    expect(posted(form)).toEqual(["next"]);
    mounted.api.setValue(["main"]);
    await settle();
    expect(posted(form)).toEqual(["main"]);
    form.reset();
    await settle();
    expect(mounted.api.value).toEqual(["next"]);
    expect(by(root, "value-text").textContent).toBe("next");
    expect(posted(form)).toEqual(["next"]);
    mounted.destroy();
    form.remove();
  });

  it("goes back to its default at a reset the reader clicks", async () => {
    const root = markup();
    const form = inForm(root);
    const mounted = select(root, { id: "rc", name: "branch", defaultValue: ["next"] });
    await settle();
    await resetByClick(form);
    expect(posted(form)).toEqual(["next"]);
    mounted.api.setValue(["main"]);
    await settle();
    await resetByClick(form);
    expect(mounted.api.value).toEqual(["next"]);
    expect(posted(form)).toEqual(["next"]);
    mounted.destroy();
    form.remove();
  });

  it("chooses no option at a reset the reader clicks where the default is none", async () => {
    const root = markup();
    const form = inForm(root);
    const mounted = select(root, { id: "re", name: "branch" });
    await settle();
    mounted.api.setValue(["main"]);
    await settle();
    await resetByClick(form);
    expect(mounted.api.value).toEqual([]);
    expect(posted(form), "no option chosen in its place").toEqual([]);
    mounted.destroy();
    form.remove();
  });

  it("goes back to several values at a reset where it takes several", async () => {
    const root = markup();
    const form = inForm(root);
    const mounted = select(root, {
      id: "rm",
      name: "branch",
      multiple: true,
      defaultValue: ["main", "next"],
    });
    await settle();
    mounted.api.setValue([]);
    await settle();
    expect(posted(form)).toEqual([]);
    form.reset();
    await settle();
    expect(mounted.api.value).toEqual(["main", "next"]);
    expect(posted(form)).toEqual(["main", "next"]);
    mounted.destroy();
    form.remove();
  });

  it("leaves its form control no choice of its own where the value has none", async () => {
    const root = markup();
    const form = inForm(root);
    const mounted = select(root, { id: "o", name: "branch" });
    await settle();
    const hidden = by(root, "hidden-select") as HTMLSelectElement;
    // What a browser's reset does where no option is a default, and what
    // this DOM does too: a single control of one row picks its first.
    hidden.options[2]!.selected = true;
    hidden.options[2]!.selected = false;
    expect(posted(form)).toEqual([]);
    mounted.destroy();
    form.remove();
  });

  it("follows a disabled fieldset around it", async () => {
    const root = markup();
    const fieldset = document.createElement("fieldset");
    root.replaceWith(fieldset);
    fieldset.append(root);
    fieldset.disabled = true;
    const mounted = select(root, { id: "d", name: "branch" });
    await settle();
    expect(mounted.api.disabled).toBe(true);
    expect(by(root, "trigger").hasAttribute("disabled")).toBe(true);
    fieldset.disabled = false;
    await settle();
    expect(mounted.api.disabled).toBe(false);
    mounted.destroy();
    fieldset.remove();
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
