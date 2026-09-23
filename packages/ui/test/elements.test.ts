import { describe, expect, it, vi } from "vitest";
import { props as comboboxProps } from "@zag-js/combobox";
import { props as dialogProps } from "@zag-js/dialog";
import { props as listboxProps } from "@zag-js/listbox";
import { props as menuProps } from "@zag-js/menu";
import { props as popoverProps } from "@zag-js/popover";
import { props as selectProps } from "@zag-js/select";
import { props as tooltipProps } from "@zag-js/tooltip";
import type { MonoElement } from "../src/elements/element.ts";
import { defineElement, defineMonoUi, MonoListbox } from "../src/elements/index.ts";
import { collection as listboxCollection } from "../src/listbox.ts";
import type { Api as MenuApi } from "../src/menu.ts";
import { by, posted, settle } from "./helpers.ts";

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

  it("drops a prop whose attribute goes, the machine back at its default", async () => {
    const element = render(MENU);
    await settle();
    element.removeAttribute("placement");
    await settle();
    // The menu's own placement, back once the markup's is taken away.
    const positioner = by(element, "positioner");
    expect(positioner.style.getPropertyValue("position-area")).toBe("bottom span-right");
    element.setAttribute("close-on-select", "false");
    await settle();
    const api = (element as HTMLElement & { api: { setOpen(open: boolean): void } }).api;
    api.setOpen(true);
    await settle();
    by(element, "item", "cut").click();
    await settle();
    expect(by(element, "content").getAttribute("data-state"), "kept open").toBe("open");
    element.removeAttribute("close-on-select");
    await settle();
    by(element, "item", "cut").click();
    await settle();
    expect(by(element, "content").getAttribute("data-state"), "closed again").toBe("closed");
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

  it("takes a fresh array or object alike the last as no change, as a render hands one", async () => {
    const element = render<HTMLElement & { value: string[]; ids: object; api: unknown }>(`
      <mono-listbox id="fresh">
        <div data-part="content">
          <div data-part="item" data-value="main"><span data-part="item-text">main</span></div>
        </div>
      </mono-listbox>`);
    element.value = ["main"];
    element.ids = { content: "list" };
    await settle();
    const api = element.api;
    element.value = ["main"];
    element.ids = { content: "list" };
    expect(element.api, "the mount left alone").toBe(api);
    element.value = [];
    expect(element.api).not.toBe(api);
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

  it("drops a behavior its menu shares with it when the menu's attribute goes", async () => {
    const element = render(MENU.replace(' id="m"', ' id="shared" close-on-select="false"'));
    const submenu = element.querySelector("mono-submenu")!;
    await settle();
    element.removeAttribute("close-on-select");
    await settle();
    (element as HTMLElement & { api: MenuApi }).api.setOpen(true);
    await settle();
    by(element, "trigger-item").click();
    await settle();
    expect(submenu.hasAttribute("open")).toBe(true);
    by(submenu, "item", "mail").click();
    await settle();
    // Zag's default, as a menu never given the attribute has it.
    expect(submenu.hasAttribute("open"), "the submenu closed").toBe(false);
    expect(element.hasAttribute("open"), "its menu too").toBe(false);
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

  it("takes a collection set as a property, whole, every time", async () => {
    const element = render(SELECT);
    await settle();
    const select = element as HTMLElement & {
      collection: unknown;
      api: { collection: { firstValue: string; getValues(): string[] } };
    };
    // A framework sets a property it finds on every render, so the
    // second one goes through the mount's partial merge: a class
    // spread into an object literal there would keep its items and
    // lose the accessors the machine navigates by.
    select.collection = listboxCollection({ items: ["next", "release"] });
    await settle();
    select.collection = listboxCollection({ items: ["release", "main"] });
    await settle();
    expect(select.api.collection.getValues()).toEqual(["release", "main"]);
    expect(select.api.collection.firstValue).toBe("release");
    element.remove();
  });

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

describe("a selection", () => {
  it("starts at the items the markup marks selected", async () => {
    const element = render(`
      <mono-select id="picked" name="branch">
        <div data-part="control"><button data-part="trigger">
          <span data-part="value-text">branch…</span>
        </button></div>
        <div data-part="positioner"><div data-part="content">
          <div data-part="item" data-value="main"><span data-part="item-text">main</span></div>
          <div data-part="item" data-value="next" data-selected>
            <span data-part="item-text">next</span>
          </div>
        </div></div>
        <select data-part="hidden-select"></select>
      </mono-select>`);
    await settle();
    expect((element as HTMLElement & { api: { value: string[] } }).api.value).toEqual(["next"]);
    expect(by(element, "value-text").textContent).toBe("next");
    element.remove();
  });

  it("takes a value set as a property, whole, as a framework sets it", async () => {
    const element = render(`
      <mono-listbox id="controlled">
        <div data-part="content">
          <div data-part="item" data-value="main"><span data-part="item-text">main</span></div>
          <div data-part="item" data-value="next"><span data-part="item-text">next</span></div>
        </div>
      </mono-listbox>`);
    const listbox = element as HTMLElement & { value: string[]; api: { value: string[] } };
    listbox.value = ["next"];
    await settle();
    expect(listbox.api.value).toEqual(["next"]);
    expect(by(element, "item", "next").getAttribute("aria-selected")).toBe("true");
    listbox.value = ["main"];
    await settle();
    expect(listbox.api.value).toEqual(["main"]);
    // Controlled: a press asks, and the page's listener answers.
    by(element, "item", "next").click();
    await settle();
    expect(listbox.api.value).toEqual(["main"]);
    element.addEventListener("valuechange", (event) => {
      listbox.value = (event as CustomEvent<{ value: string[] }>).detail.value;
    });
    by(element, "item", "next").click();
    await settle();
    expect(listbox.api.value).toEqual(["next"]);
    element.remove();
  });

  const LIST = `
    <div data-part="content">
      <div data-part="item" data-value="main"><span data-part="item-text">main</span></div>
      <div data-part="item" data-value="next"><span data-part="item-text">next</span></div>
    </div>`;

  it("starts at a default set as a property, a mount again reading the reader's choice", async () => {
    const element = document.createElement("mono-listbox") as HTMLElement & {
      defaultValue: string[];
      api: { value: string[] };
    };
    element.id = "defaulted";
    element.defaultValue = ["main"];
    element.innerHTML = LIST;
    document.body.append(element);
    await settle();
    expect(element.api.value).toEqual(["main"]);
    by(element, "item", "next").click();
    await settle();
    expect(element.api.value).toEqual(["next"]);
    // An item arriving mounts again, which starts from the reader's
    // choice.
    by(element, "content").insertAdjacentHTML(
      "beforeend",
      `<div data-part="item" data-value="release"><span data-part="item-text">release</span></div>`,
    );
    await settle();
    expect(element.api.value).toEqual(["next"]);
    element.remove();
  });

  /** A `<mono-select>` in a form, the items named, and a default set as
   * a property where one is given. */
  function selectInForm(id: string, items: string[], defaultValue?: string[]) {
    const form = document.createElement("form");
    const element = document.createElement("mono-select") as HTMLElement & {
      defaultValue: string[];
      api: { value: string[]; setValue(value: string[]): void };
    };
    element.id = id;
    element.setAttribute("name", "branch");
    if (defaultValue) element.defaultValue = defaultValue;
    element.innerHTML = `
      <button data-part="trigger"><span data-part="value-text">branch…</span></button>
      <div data-part="positioner"><div data-part="content">
        ${items.map((value) => itemMarkup(value)).join("")}
      </div></div>
      <select data-part="hidden-select"></select>`;
    form.append(element);
    document.body.append(form);
    return { form, element };
  }

  const itemMarkup = (value: string): string =>
    `<div data-part="item" data-value="${value}"><span data-part="item-text">${value}</span></div>`;

  it("keeps a default whose item arrives after it, and posts it once the item does", async () => {
    const { form, element } = selectInForm("arriving", ["main"], ["release"]);
    await settle();
    expect(posted(form), "no option chosen in its place").toEqual([]);
    by(element, "content").insertAdjacentHTML("beforeend", itemMarkup("release"));
    await settle();
    expect(element.api.value).toEqual(["release"]);
    expect(posted(form)).toEqual(["release"]);
    form.remove();
  });

  it("goes back to the page's default at a reset after a mount again, the reader's choice kept till then", async () => {
    const { form, element } = selectInForm("remounted", ["main", "next"], ["main"]);
    await settle();
    element.api.setValue(["next"]);
    await settle();
    const changes = vi.fn();
    element.addEventListener("valuechange", changes);
    by(element, "content").insertAdjacentHTML("beforeend", itemMarkup("release"));
    await settle();
    expect(element.api.value).toEqual(["next"]);
    expect(posted(form)).toEqual(["next"]);
    expect(changes, "no change of the reader's to announce").not.toHaveBeenCalled();
    form.reset();
    await settle();
    expect(element.api.value).toEqual(["main"]);
    expect(posted(form)).toEqual(["main"]);
    expect(changes).toHaveBeenCalledTimes(1);
    form.remove();
  });

  it("takes items that arrive marked as its selection and its default, as a page loading them sends", async () => {
    const { form, element } = selectInForm("loaded", []);
    await settle();
    by(element, "content").innerHTML =
      itemMarkup("main") +
      itemMarkup("next").replace('data-part="item"', "data-part='item' data-selected");
    await settle();
    expect(element.api.value).toEqual(["next"]);
    element.api.setValue(["main"]);
    await settle();
    form.reset();
    await settle();
    expect(element.api.value).toEqual(["next"]);
    form.remove();
  });

  it("keeps the reader's choice through a move, and the page's default for a reset", async () => {
    const { form, element } = selectInForm("moved", ["main", "next"], ["main"]);
    await settle();
    element.api.setValue(["next"]);
    await settle();
    const elsewhere = document.createElement("div");
    form.append(elsewhere);
    elsewhere.append(element);
    await settle();
    expect(element.api.value).toEqual(["next"]);
    form.reset();
    await settle();
    expect(element.api.value).toEqual(["main"]);
    form.remove();
  });

  it("takes a property set before the element was defined", async () => {
    const tag = "mono-late-listbox";
    const element = document.createElement(tag) as HTMLElement & {
      defaultValue?: string[];
      api?: { value: string[] };
    };
    element.defaultValue = ["next"];
    element.innerHTML = LIST;
    document.body.append(element);
    customElements.define(tag, defineElement(MonoListbox.definition));
    await settle();
    expect(element.api?.value).toEqual(["next"]);
    element.remove();
  });
});

describe("a combobox", () => {
  it("mounts on its markup and anchors its list under the control", async () => {
    const element = render(`
      <mono-combobox id="c" placeholder="branch…">
        <div data-part="control">
          <input data-part="input" />
          <button data-part="trigger">▼</button>
        </div>
        <div data-part="positioner">
          <div data-part="content">
            <div data-part="item" data-value="main"><span data-part="item-text">main</span></div>
          </div>
        </div>
      </mono-combobox>`);
    await settle();
    const input = by(element, "input") as HTMLInputElement;
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.placeholder).toBe("branch…");
    // The list lines up under the control, not the button beside it.
    expect(by(element, "control").style.getPropertyValue("anchor-name")).toBe("--mw-ui-c");
    expect(by(element, "positioner").style.getPropertyValue("position-anchor")).toBe("--mw-ui-c");
    element.remove();
  });
});

describe("every element", () => {
  /** Handled off the definition: the id and `open` attributes, the
   * flattened `positioning`, and `getRootNode`, which the DOM owns. */
  const BASE = ["id", "open", "defaultOpen", "positioning", "getRootNode"];
  /** Where the floating part goes, which an anchored element flattens
   * into `positioning`. */
  const POSITIONING = ["placement", "gutter", "offsetMainAxis", "offsetCrossAxis"];

  const camel = (attribute: string): string =>
    attribute.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

  /** Each element with the props its machine takes, Zag's own list. */
  const ELEMENTS: [string, readonly string[]][] = [
    ["mono-menu", menuProps],
    ["mono-listbox", listboxProps],
    ["mono-select", selectProps],
    ["mono-combobox", comboboxProps],
    ["mono-dialog", dialogProps],
    ["mono-popover", popoverProps],
    ["mono-tooltip", tooltipProps],
  ];

  const elementOf = (tag: string) => customElements.get(tag) as unknown as typeof MonoElement;

  /** The prop each of an element's attributes names: its alias, else
   * the attribute camel-cased. */
  function attributePropsOf(tag: string): string[] {
    const element = elementOf(tag);
    return Object.keys(element.table).map(
      (name) => element.definition.aliases?.[name] ?? camel(name),
    );
  }

  /** Everything an element declares: those, its callbacks and its
   * properties. */
  function declaredBy(tag: string): string[] {
    const { callbacks, properties } = elementOf(tag).definition;
    return [...callbacks, ...(properties ?? []), ...attributePropsOf(tag)];
  }

  it.each(ELEMENTS)("takes every prop its machine has: %s", (tag, machineProps) => {
    const declared = new Set([...BASE, ...declaredBy(tag)]);
    expect(machineProps.filter((prop) => !declared.has(prop))).toEqual([]);
  });

  it.each(ELEMENTS)("names each prop once: %s", (tag) => {
    // An attribute and an accessor for one prop are two ways in that
    // write the same thing, with no rule for which wins.
    const attributeProps = attributePropsOf(tag);
    const { properties } = elementOf(tag).definition;
    expect((properties ?? []).filter((prop) => attributeProps.includes(prop))).toEqual([]);
  });

  it.each(ELEMENTS)("declares no prop its machine lacks: %s", (tag, machineProps) => {
    // A name an element declares that its machine has never heard of
    // is a prop that goes nowhere.
    expect(
      declaredBy(tag).filter((prop) => !machineProps.includes(prop) && !POSITIONING.includes(prop)),
    ).toEqual([]);
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
