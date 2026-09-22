import { describe, expect, it, vi } from "vitest";
import { defineMonoUi } from "../src/elements/index.ts";
import type { Api as MenuApi } from "../src/menu.ts";
import { by, settle } from "./helpers.ts";

/** The elements for markup (specs/ui.md "Component layer"): attributes
 * as the machine's props by kind, callbacks as events, `open` the
 * state both ways, and the mount following the markup it is given. */

defineMonoUi();

/** An element built from markup and connected, its parts already there
 * — the mount's own case, the parser's covered by a browser page. */
function render<T extends HTMLElement>(html: string): T {
  const host = document.createElement("div");
  host.innerHTML = html;
  const element = host.firstElementChild as T;
  document.body.append(element);
  return element;
}

const MENU = `
  <mono-menu id="m" placement="top-end" gutter="2">
    <button data-part="trigger">menu</button>
    <div data-part="positioner">
      <div data-part="content">
        <div data-part="item" data-value="cut">Cut</div>
        <div data-part="trigger-item">Share</div>
        <mono-submenu value="share" placement="left-start">
          <div data-part="positioner">
            <div data-part="content">
              <div data-part="item" data-value="mail">Mail</div>
            </div>
          </div>
        </mono-submenu>
      </div>
    </div>
  </mono-menu>`;

const escape = (content: Element): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  content.dispatchEvent(event);
  return event;
};

describe("attributes as props", () => {
  it("reads a string and a number, the positioning ones folded into one prop", async () => {
    const element = render(MENU);
    await settle();
    const positioner = by(element, "positioner");
    expect(positioner.style.getPropertyValue("position-area")).toBe("top span-left");
    expect(positioner.style.getPropertyValue("margin-bottom")).toBe("0.5rem");
    element.remove();
  });

  it("takes a boolean by presence, `false` written out turning it off", async () => {
    const element = render(`
      <mono-menu id="b" close-on-select="false" open>
        <button data-part="trigger">menu</button>
        <div data-part="positioner"><div data-part="content">
          <div data-part="item" data-value="cut">Cut</div>
        </div></div>
      </mono-menu>`);
    await settle();
    // `open` present is the initial state; `close-on-select="false"`
    // keeps it open past a selection.
    expect(by(element, "content").getAttribute("data-state")).toBe("open");
    by(element, "item", "cut").click();
    await settle();
    expect(by(element, "content").getAttribute("data-state")).toBe("open");
    element.remove();
  });

  it("names itself where the markup does not, and roots the mount again on a new id", async () => {
    const element = render(MENU.replace(' id="m"', ""));
    await settle();
    expect(element.id).toMatch(/^mono-ui-\d+$/);
    expect(by(element, "trigger").style.getPropertyValue("anchor-name")).toBe(
      `--mw-ui-${element.id}`,
    );
    element.id = "renamed";
    await settle();
    expect(by(element, "trigger").style.getPropertyValue("anchor-name")).toBe("--mw-ui-renamed");
    element.remove();
  });

  it("carries a change to the machine, the rest of the props kept", async () => {
    const element = render(MENU);
    await settle();
    element.setAttribute("placement", "bottom-start");
    await settle();
    const positioner = by(element, "positioner");
    expect(positioner.style.getPropertyValue("position-area")).toBe("bottom span-right");
    // The gutter the markup gave is still spacing it, on the new side.
    expect(positioner.style.getPropertyValue("margin-top")).toBe("0.5rem");
    element.remove();
  });

  it("takes a prop no attribute carries as a property, and does no work twice", async () => {
    const element = document.createElement("mono-menu") as HTMLElement & { ids?: object };
    element.id = "named";
    const ids = { trigger: "my-trigger" };
    // Set before the markup is there, so the mount reads it.
    element.ids = ids;
    element.innerHTML = `
      <button data-part="trigger">menu</button>
      <div data-part="positioner"><div data-part="content"></div></div>`;
    document.body.append(element);
    await settle();
    expect(by(element, "trigger").id).toBe("my-trigger");
    expect(element.ids).toBe(ids);
    // React sets such a property on every render: the same value is
    // no change, so the machine is left alone.
    const api = (element as HTMLElement & { api: MenuApi }).api;
    element.ids = ids;
    expect((element as HTMLElement & { api: MenuApi }).api).toBe(api);
    element.remove();
  });

  it("leaves a name the DOM already carries to the DOM", async () => {
    const element = render(MENU.replace(' id="m"', ' id="dom"'));
    await settle();
    // `getRootNode` is a prop of the machine's and a method of every
    // node: the node's wins, and the prop is `setProp`'s to set.
    expect(typeof element.getRootNode).toBe("function");
    expect(element.getRootNode()).toBe(document);
    element.remove();
  });
});

describe("callbacks as events", () => {
  it("dispatches one per callback, the argument its detail, and it bubbles", async () => {
    const element = render(MENU);
    const selected = vi.fn();
    document.body.addEventListener("itemselect", selected);
    await settle();
    (element as HTMLElement & { api: MenuApi }).api.setOpen(true);
    await settle();
    by(element, "item", "cut").click();
    await settle();
    expect(selected).toHaveBeenCalledTimes(1);
    expect((selected.mock.calls[0]![0] as CustomEvent).detail).toEqual({ value: "cut" });
    document.body.removeEventListener("itemselect", selected);
    element.remove();
  });

  it("relays a cancelled event to the argument's own `preventDefault`", async () => {
    const element = render(MENU);
    await settle();
    (element as HTMLElement & { api: MenuApi }).api.setOpen(true);
    await settle();
    let cancelable: boolean | null = null;
    element.addEventListener("escapekeydown", (event) => {
      cancelable = event.cancelable;
      event.preventDefault();
    });
    const pressed = escape(by(element, "content"));
    expect(cancelable).toBe(true);
    expect(pressed.defaultPrevented).toBe(true);
    element.remove();
  });
});

describe("open", () => {
  it("opens from the attribute and writes it back from the machine, neither looping", async () => {
    const element = render(MENU);
    // The attribute an event announces is written before it fires, so
    // a listener reads the state it is being told about.
    const announced: boolean[] = [];
    const changes = vi.fn(() => announced.push(element.hasAttribute("open")));
    element.addEventListener("openchange", changes);
    await settle();
    expect(element.hasAttribute("open")).toBe(false);
    element.setAttribute("open", "");
    await settle();
    expect((element as HTMLElement & { api: MenuApi }).api.open).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(element.hasAttribute("open")).toBe(true);
    element.removeAttribute("open");
    await settle();
    expect((element as HTMLElement & { api: MenuApi }).api.open).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
    expect(element.hasAttribute("open")).toBe(false);
    expect(announced).toEqual([true, false]);
    element.remove();
  });
});

describe("a submenu", () => {
  it("marks the part its menu mounts, and places itself where its own markup says", async () => {
    const element = render(MENU);
    await settle();
    const submenu = element.querySelector("mono-submenu")!;
    expect(submenu.getAttribute("data-part")).toBe("submenu");
    expect(submenu.getAttribute("data-value")).toBe("share");
    expect(by(submenu, "positioner").style.getPropertyValue("position-anchor")).toBe(
      "--mw-ui-m-share",
    );
    expect(by(submenu, "positioner").style.getPropertyValue("position-area")).toBe(
      "left span-bottom",
    );
    element.remove();
  });

  it("dispatches and reflects its own open, its menu mounting again on a change", async () => {
    const element = render(MENU);
    const submenu = element.querySelector("mono-submenu")!;
    const changes = vi.fn();
    submenu.addEventListener("openchange", changes);
    await settle();
    (element as HTMLElement & { api: MenuApi }).api.setOpen(true);
    await settle();
    by(element, "trigger-item").click();
    await settle();
    expect(changes).toHaveBeenCalled();
    expect(submenu.hasAttribute("open")).toBe(true);
    // The markup is the props: a placement given later is read by the
    // menu mounting again over the same markup.
    submenu.setAttribute("placement", "right-start");
    await settle();
    expect(by(submenu, "positioner").style.getPropertyValue("position-area")).toBe(
      "right span-bottom",
    );
    element.remove();
  });
});

describe("a select", () => {
  const SELECT = `
    <mono-select id="s" name="branch">
      <div data-part="control">
        <button data-part="trigger">
          <span data-part="value-text">branch…</span>
        </button>
      </div>
      <div data-part="positioner">
        <div data-part="content">
          <div data-part="item" data-value="main"><span data-part="item-text">main</span></div>
          <div data-part="item" data-value="next"><span data-part="item-text">next</span></div>
        </div>
      </div>
      <select data-part="hidden-select"></select>
    </mono-select>`;

  it("fills the control a form posts without mounting again for it", async () => {
    const element = render(SELECT);
    // Hidden AS IT MOUNTS, not when Zag's first spread lands a
    // microtask later: an in-flow <select> is a box as wide as its
    // longest option, and the grid would jump.
    expect(element.querySelector<HTMLSelectElement>("select")!.style.display).toBe("none");
    await settle();
    const api = (element as HTMLElement & { api: { value: string[] } }).api;
    const hidden = element.querySelector<HTMLSelectElement>("select")!;
    // The mount writes an option per item into its own markup. That
    // is a change to the markup the observer watches, so a mount that
    // took it for new markup would fill it and mount again forever.
    expect(hidden.querySelectorAll("option")).toHaveLength(2);
    expect(hidden.style.display).toBe("none");
    await settle();
    expect(hidden.querySelectorAll("option")).toHaveLength(2);
    expect((element as HTMLElement & { api: unknown }).api).toBe(api);
    element.remove();
  });
});

describe("the markup under it", () => {
  it("mounts once the parts arrive, and again as they are replaced", async () => {
    const element = document.createElement("mono-menu");
    element.id = "late";
    document.body.append(element);
    await settle();
    expect(element.querySelector("[data-part]")).toBe(null);
    element.innerHTML = `
      <button data-part="trigger">menu</button>
      <div data-part="positioner"><div data-part="content"></div></div>`;
    await settle();
    expect(by(element, "trigger").getAttribute("aria-haspopup")).toBe("menu");
    element.innerHTML = `
      <button data-part="trigger">again</button>
      <div data-part="positioner"><div data-part="content"></div></div>`;
    await settle();
    expect(by(element, "trigger").getAttribute("aria-haspopup")).toBe("menu");
    element.remove();
  });

  it("waits for the end of the parse where the document is still parsing", () => {
    // The parser connects an element at its START tag, so its parts
    // are not there yet and no microtask rescues it; this is that
    // branch, the state the parser would be in set by hand.
    const readyState = Object.getOwnPropertyDescriptor(Document.prototype, "readyState");
    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
    const element = document.createElement("mono-menu");
    element.id = "parsed";
    document.body.append(element);
    element.innerHTML = `
      <button data-part="trigger">menu</button>
      <div data-part="positioner"><div data-part="content"></div></div>`;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    // Mounted by the end of the parse, before the observer's microtask.
    expect((element as HTMLElement & { api: MenuApi }).api).toBeDefined();
    delete (document as unknown as Record<string, unknown>)["readyState"];
    if (readyState) Object.defineProperty(Document.prototype, "readyState", readyState);
    element.remove();
  });

  it("takes the handlers off the parts when it leaves the document", async () => {
    const element = render(MENU);
    await settle();
    const trigger = by(element, "trigger");
    const removed = vi.spyOn(trigger, "removeEventListener");
    element.remove();
    expect(removed.mock.calls.map(([type]) => type)).toContain("click");
  });
});
