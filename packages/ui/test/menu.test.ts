import * as Menu from "@zag-js/menu";
import { describe, expect, it, vi } from "vitest";
import { normalizeProps } from "@zag-js/vanilla";
import { api, menu, props } from "../src/menu.ts";
import { start } from "../src/vanilla.ts";
import { by, popoverApi, settle } from "./helpers.ts";

/** The menu on the grid (specs/ui.md): Zag's API with the grid's props,
 * and the vanilla mount over marked markup. */

describe("the api", () => {
  it("names the trigger, anchors the positioner as a manual popover, shows the content", () => {
    const gridProps = props({ id: "m", positioning: { placement: "bottom-end", gutter: 1 } });
    expect(gridProps.positioning).toMatchObject({
      applyStyles: false,
      flip: false,
      listeners: false,
    });
    const machine = start(Menu.machine, gridProps);
    const grid = api(Menu.connect(machine.service, normalizeProps), normalizeProps, gridProps);
    expect(grid.getTriggerProps()["style"]).toEqual({ anchorName: "--mw-ui-m" });
    const positioner = grid.getPositionerProps();
    expect(positioner["popover"]).toBe("manual");
    expect(positioner["style"]).toEqual({
      positionAnchor: "--mw-ui-m",
      positionArea: "bottom span-left",
      positionTryFallbacks: "flip-block, flip-inline, flip-block flip-inline",
      minWidth: "max-content",
      overflow: "visible",
      marginTop: "0.25rem",
    });
    expect(grid.getContentProps()).not.toHaveProperty("hidden");
    expect(grid.getContentProps()["data-state"]).toBe("closed");
    machine.stop();
  });

  it("takes the gap and the shift from Zag's offset, in cells", () => {
    const gridProps = props({
      id: "m",
      positioning: { placement: "right-start", gutter: 1, offset: { mainAxis: 2, crossAxis: -1 } },
    });
    const machine = start(Menu.machine, gridProps);
    const grid = api(Menu.connect(machine.service, normalizeProps), normalizeProps, gridProps);
    expect(grid.getPositionerProps()["style"]["marginLeft"]).toBe("0.5rem");
    expect(grid.getPositionerProps()["style"]["marginTop"]).toBe("-0.25rem");
    machine.stop();
  });

  it("names each of several triggers, the positioner anchored to the current one", () => {
    const gridProps = props({ id: "m", triggerValue: "b" });
    const machine = start(Menu.machine, gridProps);
    const grid = api(Menu.connect(machine.service, normalizeProps), normalizeProps, gridProps);
    expect(grid.getTriggerProps({ value: "a" })["style"]).toEqual({ anchorName: "--mw-ui-m-a" });
    expect(grid.getPositionerProps()["style"]["positionAnchor"]).toBe("--mw-ui-m-b");
    machine.stop();
  });

  it("names a submenu's trigger item for the submenu", () => {
    const parentProps = props({ id: "p" });
    const parent = start(Menu.machine, parentProps);
    const childProps = props({ id: "c" });
    const child = start(Menu.machine, childProps);
    const parentApi = api(
      Menu.connect(parent.service, normalizeProps),
      normalizeProps,
      parentProps,
    );
    const childApi = api(Menu.connect(child.service, normalizeProps), normalizeProps, childProps);
    expect(parentApi.getTriggerItemProps(childApi)["style"]).toMatchObject({
      anchorName: "--mw-ui-c",
    });
    expect(childApi.getPositionerProps()["style"]).toMatchObject({
      positionAnchor: "--mw-ui-c",
    });
    parent.stop();
    child.stop();
  });
});

describe("the mount", () => {
  const markup = () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-part="trigger">menu</button>
      <div data-part="positioner">
        <div data-part="content">
          <div data-part="item-group" data-value="edit">
            <div data-part="item-group-label" data-value="edit">Edit</div>
            <div data-part="item" data-value="cut">Cut</div>
            <div data-part="item" data-value="copy" data-disabled>Copy</div>
          </div>
          <hr data-part="separator" />
          <div data-part="trigger-item">Share</div>
          <div data-part="submenu" data-value="share">
            <div data-part="positioner">
              <div data-part="content">
                <div data-part="item" data-value="mail">Mail</div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    document.body.append(root);
    return root;
  };

  it("wires every part a tick after the mount, opens on the trigger, and links the submenu", async () => {
    const root = markup();
    const shown = popoverApi(by(root, "positioner"));
    const mounted = menu(root, { id: "m" });
    expect(by(root, "trigger").hasAttribute("aria-haspopup")).toBe(false);
    await settle();
    expect(by(root, "trigger").getAttribute("aria-haspopup")).toBe("menu");
    expect(by(root, "positioner").getAttribute("popover")).toBe("manual");
    expect(by(root, "positioner").style.getPropertyValue("position-area")).toBe(
      "bottom span-right",
    );
    expect(by(root, "content").getAttribute("role")).toBe("menu");
    expect(by(root, "content").hasAttribute("hidden")).toBe(false);
    expect(by(root, "item", "cut").getAttribute("role")).toBe("menuitem");
    expect(by(root, "item", "copy").getAttribute("aria-disabled")).toBe("true");
    expect(by(root, "item-group", "edit").getAttribute("role")).toBe("group");
    expect(by(root, "separator").getAttribute("role")).toBe("separator");
    // The trigger item is the submenu's trigger and its anchor, spread as
    // one from the first render on; the submenu's own positioner points
    // at it.
    const triggerItem = root.querySelector<HTMLElement>('[data-uid="m-share"]')!;
    expect(triggerItem.dataset["part"]).toBe("trigger-item");
    expect(triggerItem.getAttribute("aria-haspopup")).toBe("menu");
    expect(triggerItem.style.getPropertyValue("anchor-name")).toBe("--mw-ui-m-share");
    const submenu = by(root, "submenu");
    expect(by(submenu, "positioner").style.getPropertyValue("position-anchor")).toBe(
      "--mw-ui-m-share",
    );
    expect(by(submenu, "positioner").style.getPropertyValue("position-area")).toBe(
      "right span-bottom",
    );
    expect(by(submenu, "item", "mail").getAttribute("role")).toBe("menuitem");
    by(root, "trigger").click();
    await settle();
    expect(mounted.api.open).toBe(true);
    expect(by(root, "content").getAttribute("data-state")).toBe("open");
    expect(shown.isOpen()).toBe(true);
    mounted.destroy();
    expect(shown.isOpen()).toBe(false);
    root.remove();
  });

  it("places a right-to-left menu's submenu on the left", async () => {
    const root = markup();
    const mounted = menu(root, { id: "r", dir: "rtl" });
    await settle();
    expect(by(by(root, "submenu"), "positioner").style.getPropertyValue("position-area")).toBe(
      "left span-bottom",
    );
    mounted.destroy();
    root.remove();
  });

  it("wires several triggers by value, the positioner anchored to the current one", async () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-part="trigger" data-value="a">a</button>
      <button data-part="trigger" data-value="b">b</button>
      <div data-part="positioner"><div data-part="content"></div></div>`;
    document.body.append(root);
    const mounted = menu(root, { id: "t", triggerValue: "b" });
    await settle();
    expect(by(root, "trigger", "a").style.getPropertyValue("anchor-name")).toBe("--mw-ui-t-a");
    expect(by(root, "trigger", "b").getAttribute("aria-haspopup")).toBe("menu");
    expect(by(root, "positioner").style.getPropertyValue("position-anchor")).toBe("--mw-ui-t-b");
    mounted.destroy();
    root.remove();
  });

  it("a submenu selects through the parent's onSelect, on the parent's behavior props", async () => {
    const root = markup();
    const onSelect = vi.fn();
    const mounted = menu(root, { id: "s", onSelect, closeOnSelect: false });
    await settle();
    mounted.api.setOpen(true);
    await settle();
    by(root, "trigger-item").click();
    await settle();
    const submenu = by(root, "submenu");
    expect(by(submenu, "content").getAttribute("data-state")).toBe("open");
    by(submenu, "item", "mail").click();
    await settle();
    // Zag calls the onSelect of the menu whose item it is: the submenu's,
    // the parent's handed down; closeOnSelect false, handed down too,
    // keeps it open.
    expect(onSelect).toHaveBeenCalledWith({ value: "mail" });
    expect(by(submenu, "content").getAttribute("data-state")).toBe("open");
    mounted.destroy();
    root.remove();
  });

  it("destroy takes Zag's handlers off the parts", async () => {
    const root = markup();
    const mounted = menu(root, { id: "u" });
    await settle();
    mounted.api.setOpen(true);
    await settle();
    const content = by(root, "content");
    const arrow = () => {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      content.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // Wired: the content takes the arrow.
    expect(arrow()).toBe(true);
    const removed = vi.spyOn(by(root, "trigger"), "removeEventListener");
    mounted.destroy();
    expect(removed.mock.calls.map(([type]) => type)).toContain("click");
    expect(arrow()).toBe(false);
    root.remove();
  });

  it("mounts again on the same markup after a destroy, at once or later", async () => {
    const root = markup();
    const first = menu(root, { id: "m" });
    first.destroy();
    const second = menu(root, { id: "n" });
    await settle();
    const triggerItem = root.querySelector<HTMLElement>('[data-uid="n-share"]')!;
    expect(triggerItem.dataset["part"]).toBe("trigger-item");
    expect(triggerItem.style.getPropertyValue("anchor-name")).toBe("--mw-ui-n-share");
    second.destroy();
    const third = menu(root, { id: "o" });
    await settle();
    expect(root.querySelector<HTMLElement>('[data-uid="o-share"]')?.dataset["part"]).toBe(
      "trigger-item",
    );
    third.destroy();
    root.remove();
  });
});
