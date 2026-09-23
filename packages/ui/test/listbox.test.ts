import { describe, expect, it, vi } from "vitest";
import { collection, listbox } from "../src/listbox.ts";
import { by, fromKeyboard, fromPointer, hover, press, settle } from "./helpers.ts";

/** The listbox on the grid (specs/ui.md): Zag's machine over marked
 * markup, its parts in the flow. */

describe("the mount", () => {
  const markup = (): HTMLElement => {
    const root = document.createElement("div");
    root.id = "branches";
    root.innerHTML = `
      <span data-part="label">Branch</span>
      <div data-part="content">
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
      </div>`;
    document.body.append(root);
    return root;
  };

  it("wires every part a tick after the mount, the root the element it was given", async () => {
    const root = markup();
    const mounted = listbox(root, { id: "l" });
    expect(by(root, "content").getAttribute("role")).toBe(null);
    await settle();
    expect(root.dataset["part"]).toBe("root");
    expect(root.getAttribute("data-orientation")).toBe("vertical");
    expect(root.id, "the markup's own id names it").toBe("branches");
    expect(by(root, "content").getAttribute("role")).toBe("listbox");
    expect(by(root, "content").getAttribute("id")).toBe("listbox:l:content");
    expect(by(root, "content").getAttribute("aria-labelledby")).toBe("listbox:l:label");
    expect(by(root, "label").getAttribute("id")).toBe("listbox:l:label");
    expect(by(root, "item-group", "local").getAttribute("role")).toBe("group");
    expect(by(root, "item-group-label", "local").getAttribute("role")).toBe("presentation");
    const item = by(root, "item", "main");
    expect(item.getAttribute("role")).toBe("option");
    expect(item.getAttribute("aria-selected")).toBe("false");
    expect(by(root, "item", "stale").getAttribute("aria-disabled")).toBe("true");
    mounted.destroy();
    root.remove();
  });

  it("takes the collection from the marked items, an item-text naming each", async () => {
    const root = markup();
    const mounted = listbox(root, { id: "c" });
    await settle();
    expect(mounted.api.collection.items).toEqual([
      { value: "main", label: "main", disabled: false },
      { value: "stale", label: "stale", disabled: true },
      { value: "next", label: "next", disabled: false },
    ]);
    // Typeahead reads the label: the item's text past its indicator.
    press(root, "n");
    await settle();
    expect(mounted.api.highlightedValue).toBe("next");
    mounted.destroy();
    root.remove();
  });

  it("selects on a press, the item's indicator shown with it", async () => {
    const root = markup();
    const onValueChange = vi.fn();
    const mounted = listbox(root, { id: "s", onValueChange });
    await settle();
    const item = by(root, "item", "main");
    const indicator = item.querySelector<HTMLElement>('[data-part="item-indicator"]')!;
    expect(indicator.hasAttribute("hidden")).toBe(true);
    item.click();
    await settle();
    expect(mounted.api.value).toEqual(["main"]);
    expect(onValueChange).toHaveBeenCalledWith({
      value: ["main"],
      items: [{ value: "main", label: "main", disabled: false }],
    });
    expect(item.getAttribute("aria-selected")).toBe("true");
    expect(item.getAttribute("data-state")).toBe("checked");
    expect(indicator.hasAttribute("hidden")).toBe(false);
    // A second selection replaces the first: the mode is Zag's default.
    by(root, "item", "next").click();
    await settle();
    expect(mounted.api.value).toEqual(["next"]);
    mounted.destroy();
    root.remove();
  });

  it("starts at the items the markup marks selected, the first alone in one-value mode", async () => {
    const root = markup();
    by(root, "item", "main").setAttribute("data-selected", "");
    by(root, "item", "next").setAttribute("data-selected", "");
    const single = listbox(root, { id: "m" });
    await settle();
    expect(single.api.value).toEqual(["main"]);
    // The marker follows the selection, so a mount after it reads what
    // the reader chose: the one it left is cleared on the first spread.
    expect(by(root, "item", "next").hasAttribute("data-selected")).toBe(false);
    by(root, "item", "next").click();
    await settle();
    expect(by(root, "item", "main").hasAttribute("data-selected")).toBe(false);
    expect(by(root, "item", "next").hasAttribute("data-selected")).toBe(true);
    single.destroy();
    const again = listbox(root, { id: "m" });
    await settle();
    expect(again.api.value).toEqual(["next"]);
    again.destroy();
    by(root, "item", "main").setAttribute("data-selected", "");
    const several = listbox(root, { id: "m", selectionMode: "multiple" });
    await settle();
    expect(several.api.value).toEqual(["main", "next"]);
    several.destroy();
    // A props' own selection wins over the markup's.
    const own = listbox(root, { id: "m", defaultValue: ["stale"] });
    await settle();
    expect(own.api.value).toEqual(["stale"]);
    own.destroy();
    root.remove();
  });

  it("walks the items with the arrows, past the disabled one", async () => {
    const root = markup();
    const mounted = listbox(root, { id: "k" });
    await settle();
    expect(press(root, "ArrowDown")).toBe(true);
    await settle();
    expect(mounted.api.highlightedValue).toBe("main");
    expect(by(root, "item", "main").hasAttribute("data-highlighted")).toBe(true);
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

  it("moves the highlight under the pointer where the root asks for it", async () => {
    const root = markup();
    root.setAttribute("data-highlight-on-hover", "");
    const mounted = listbox(root, { id: "h" });
    await settle();
    // Zag highlights under a pointer it has seen; `data-highlighted`
    // stays the keyboard's focus, so the active descendant is the state
    // a pointer moves.
    fromPointer();
    hover(by(root, "item", "next"));
    await settle();
    expect(mounted.api.highlightedValue).toBe("next");
    expect(by(root, "content").getAttribute("aria-activedescendant")).toBe("listbox:h:item:next");
    mounted.destroy();
    root.remove();
  });

  it("gives the selection the highlight when the content takes focus", async () => {
    const root = markup();
    const mounted = listbox(root, { id: "t", defaultValue: ["next"] });
    await settle();
    expect(mounted.api.highlightedValue, "nothing holds it yet").toBe(null);
    // Tabbed to: the keyboard's own focus, which `data-highlighted`
    // follows, and the selection takes the highlight so the grid shows
    // where the focus is (specs/cell-model.md).
    fromKeyboard();
    by(root, "content").focus();
    await settle();
    expect(mounted.api.highlightedValue).toBe("next");
    expect(by(root, "content").getAttribute("aria-activedescendant")).toBe("listbox:t:item:next");
    expect(by(root, "item", "next").hasAttribute("data-highlighted")).toBe(true);
    mounted.destroy();
    root.remove();
  });

  it("takes the focus back to the selection from a highlight left behind", async () => {
    const root = markup();
    root.setAttribute("data-highlight-on-hover", "");
    const mounted = listbox(root, { id: "m", defaultValue: ["next"] });
    await settle();
    // A pointer over an item highlights it with the list unfocused,
    // where nothing shows it; the keyboard could have left one there
    // as well. Either way the focus starts at the selection, as ARIA's
    // listbox pattern has it.
    fromPointer();
    hover(by(root, "item", "main"));
    await settle();
    expect(mounted.api.highlightedValue).toBe("main");
    fromKeyboard();
    by(root, "content").focus();
    await settle();
    expect(mounted.api.highlightedValue).toBe("next");
    mounted.destroy();
    root.remove();
  });

  it("starts at the first item where nothing is selected", async () => {
    const root = markup();
    const mounted = listbox(root, { id: "e" });
    await settle();
    press(root, "ArrowDown");
    await settle();
    press(root, "ArrowDown");
    await settle();
    expect(mounted.api.highlightedValue).toBe("next");
    by(root, "content").blur();
    by(root, "content").focus();
    await settle();
    expect(mounted.api.highlightedValue).toBe("main");
    mounted.destroy();
    root.remove();
  });

  it("brings the item the focus lands on back into view", async () => {
    const root = markup();
    const content = by(root, "content");
    content.style.overflowY = "auto";
    const mounted = listbox(root, { id: "v", defaultValue: ["main"] });
    await settle();
    fromKeyboard();
    content.focus();
    await settle();
    expect(mounted.api.highlightedValue).toBe("main");
    // Scrolled past it, as a reader's wheel would: the item sits above
    // the content box, and a DOM without layout says where.
    content.getBoundingClientRect = () => ({ top: 0, bottom: 144, height: 144 }) as DOMRect;
    const item = by(root, "item", "main");
    item.getBoundingClientRect = () => ({ top: -36, bottom: -18, height: 18 }) as DOMRect;
    content.scrollTop = 36;
    content.blur();
    content.focus();
    await settle();
    expect(content.scrollTop, "the focus scrolls back to it").toBe(0);
    mounted.destroy();
    root.remove();
  });

  it("leaves the scroll alone where a press moves the focus", async () => {
    const root = markup();
    const content = by(root, "content");
    content.style.overflowY = "auto";
    const mounted = listbox(root, { id: "p", defaultValue: ["main"] });
    await settle();
    content.getBoundingClientRect = () => ({ top: 0, bottom: 144, height: 144 }) as DOMRect;
    const item = by(root, "item", "main");
    item.getBoundingClientRect = () => ({ top: -36, bottom: -18, height: 18 }) as DOMRect;
    content.scrollTop = 36;
    // A press on a visible item focuses the content first: the list
    // must not jump to the selection under the reader's pointer.
    fromPointer();
    content.focus();
    await settle();
    expect(content.scrollTop).toBe(36);
    mounted.destroy();
    root.remove();
  });

  it("takes the props' own collection, an item outside it left plain", async () => {
    const root = markup();
    const mounted = listbox(root, {
      id: "p",
      selectionMode: "multiple",
      collection: collection({ items: [{ value: "main" }, { value: "next" }] }),
    });
    await settle();
    expect(by(root, "item", "stale").getAttribute("role")).toBe(null);
    by(root, "item", "main").click();
    by(root, "item", "next").click();
    await settle();
    expect(mounted.api.value).toEqual(["main", "next"]);
    mounted.destroy();
    root.remove();
  });

  it("names the mount that found none of its collection's items", async () => {
    // A mount reads its parts once, so markup a template commits
    // after it is markup it never sees: the rest of the component
    // works, and only the items are missing.
    const root = document.createElement("div");
    root.innerHTML = `<div data-part="content"></div>`;
    document.body.append(root);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mounted = listbox(root, {
      id: "late",
      collection: collection({ items: ["main", "next"] }),
    });
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("listbox mounted with 2 items");
    warn.mockRestore();
    mounted.destroy();
    root.remove();
  });

  it("says nothing where the markup marks its items", async () => {
    const root = markup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mounted = listbox(root, { id: "quiet" });
    await settle();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    mounted.destroy();
    root.remove();
  });

  it("destroy takes Zag's handlers off the parts", async () => {
    const root = markup();
    const mounted = listbox(root, { id: "d" });
    await settle();
    expect(press(root, "ArrowDown")).toBe(true);
    mounted.destroy();
    expect(press(root, "ArrowDown")).toBe(false);
    root.remove();
  });
});
