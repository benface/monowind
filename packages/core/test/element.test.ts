import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OWN_TRANSITION_VARS } from "../src/animate.ts";
import { CONTROL_READ_FLAG } from "../src/types.ts";
import { CONTEXTUAL_COLOR, defineMonoWind } from "../src/element.ts";
import type { MonoWindElement } from "../src/element.ts";
import { SHADES } from "../src/glyph-box.ts";
import { registerLeafRenderer } from "../src/leaf.ts";

beforeAll(() => defineMonoWind());

let host: HTMLElement;
afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

/** A host holding `content`, connected. */
const connect = (content = ""): HTMLElement => {
  host = document.createElement("mono-wind");
  host.innerHTML = content;
  document.body.append(host);
  return host;
};

/** The layout the host has pending, on a cell of 8 × 16 px, ten cells
 * wide: once the host's observers have seen what changed, the plain-text
 * read runs it in place of its frame. */
const layOut = async (target = host): Promise<void> => {
  const probe = target.querySelector<HTMLElement>(":scope > [data-mw-probe]")!;
  probe.getBoundingClientRect = () => new DOMRect(0, 0, 800, 16);
  Object.defineProperty(target, "clientWidth", { value: 80, configurable: true });
  await Promise.resolve();
  (target as MonoWindElement).toPlainText();
};

/** A selection starting at `target`, as the browser announces it. */
const selectStart = (target: Node): void => {
  target.dispatchEvent(new Event("selectstart", { bubbles: true, composed: true }));
};

describe("the host's listeners", () => {
  /** A primary press on the grid, then a move with the button held: the
   * host marks the drag. */
  const dragOnGrid = (): void => {
    const grid = host.shadowRoot!.getElementById("grid")!;
    const pointer = { bubbles: true, composed: true, isPrimary: true, pointerType: "mouse" };
    grid.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, button: 0 }));
    host.dispatchEvent(new PointerEvent("pointermove", { ...pointer, buttons: 1 }));
  };
  const release = (): void => {
    window.dispatchEvent(new PointerEvent("pointerup", { isPrimary: true, pointerType: "mouse" }));
  };

  it("go with the connection, the window's included, and come back with the next", () => {
    connect();
    dragOnGrid();
    expect(host.hasAttribute("data-mw-dragging")).toBe(true);
    release();
    expect(host.hasAttribute("data-mw-dragging")).toBe(false);

    host.remove();
    dragOnGrid();
    expect(host.hasAttribute("data-mw-dragging")).toBe(false);
    host.setAttribute("data-mw-dragging", "");
    release();
    expect(host.hasAttribute("data-mw-dragging")).toBe(true);
    host.removeAttribute("data-mw-dragging");

    document.body.append(host);
    dragOnGrid();
    expect(host.hasAttribute("data-mw-dragging")).toBe(true);
    release();
    expect(host.hasAttribute("data-mw-dragging")).toBe(false);
  });

  it("drop the states their release or selectionchange would end with the connection", () => {
    connect("<p>text</p>");
    dragOnGrid();
    selectStart(host.querySelector("p")!.firstChild!);
    // A live semantic selection's lift (specs/semantic-selection.md).
    host.setAttribute("data-mw-semantic-selection", "");
    const states = ["data-mw-dragging", "data-mw-selection", "data-mw-semantic-selection"];
    expect(states.filter((state) => host.hasAttribute(state))).toEqual(states);
    host.remove();
    expect(states.filter((state) => host.hasAttribute(state))).toEqual([]);
  });
});

describe("the selection lock (specs/wide-characters.md)", () => {
  it("holds for a selection starting in the light DOM, or from an ancestor", () => {
    connect("<p>text</p>");
    selectStart(host.querySelector("p")!.firstChild!);
    expect(host.hasAttribute("data-mw-selection")).toBe(true);
    host.removeAttribute("data-mw-selection");
    selectStart(document.body);
    expect(host.hasAttribute("data-mw-selection")).toBe(true);
  });

  it("leaves a control's or an editable's selection its own highlight", () => {
    connect(
      '<input value="field"><textarea>area</textarea><div contenteditable="true"><p>edit</p></div>',
    );
    selectStart(host.querySelector("input")!);
    selectStart(host.querySelector("textarea")!);
    selectStart(host.querySelector("[contenteditable] p")!.firstChild!);
    expect(host.hasAttribute("data-mw-selection")).toBe(false);
  });

  it("holds for a selection in a region that is not editable, an editable's island included", () => {
    connect(
      '<div contenteditable="false"><p>fixed</p></div>' +
        '<div contenteditable="true"><p contenteditable="false">island</p></div>',
    );
    selectStart(host.querySelector("[contenteditable='true'] p")!.firstChild!);
    expect(host.hasAttribute("data-mw-selection")).toBe(false);
    selectStart(host.querySelector("p")!.firstChild!);
    expect(host.hasAttribute("data-mw-selection")).toBe(true);
  });

  it("ends a press whose release a page stopped short of the window", () => {
    connect("<p>text</p>");
    const stop = (event: Event): void => event.stopPropagation();
    document.body.addEventListener("pointerup", stop);
    const pointer = { bubbles: true, isPrimary: true, pointerType: "mouse", button: 0 };
    document.body.dispatchEvent(new PointerEvent("pointerdown", pointer));
    document.body.dispatchEvent(new PointerEvent("pointerup", pointer));
    document.body.removeEventListener("pointerup", stop);
    // A key's selection: its lock lasts to its first selectionchange.
    selectStart(host.querySelector("p")!.firstChild!);
    document.dispatchEvent(new Event("selectionchange"));
    expect(host.hasAttribute("data-mw-selection")).toBe(false);
  });
});

describe("a layout", () => {
  it("waits for a host inside `display: none` to show, writing nothing", async () => {
    const failed = vi.spyOn(console, "error").mockImplementation(() => {});
    const hidden = document.createElement("div");
    hidden.style.display = "none";
    document.body.append(hidden);
    host = document.createElement("mono-wind");
    host.style.padding = "0 8px";
    host.innerHTML = "<p>text</p>";
    hidden.append(host);
    // The probe measures no cell there.
    await Promise.resolve();
    (host as MonoWindElement).toPlainText();
    hidden.remove();
    expect(failed).not.toHaveBeenCalled();
    expect(host.style.getPropertyValue("--mw-cw")).toBe("");
    expect(host.hasAttribute("data-mw-ready")).toBe(false);
  });

  it("flags nothing for a host inside `display: none`", async () => {
    const hidden = document.createElement("div");
    hidden.style.display = "none";
    document.body.append(hidden);
    host = document.createElement("mono-wind");
    host.innerHTML = "<p>text</p>";
    hidden.append(host);
    await Promise.resolve();
    const flagged: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) flagged.push(record.attributeName!);
    });
    observer.observe(host, { attributeFilter: ["measuring", "data-mw-measuring"], subtree: true });
    (host as MonoWindElement).toPlainText();
    flagged.push(...observer.takeRecords().map((record) => record.attributeName!));
    observer.disconnect();
    hidden.remove();
    expect(flagged).toEqual([]);
  });

  it("writes the host's colors as tokens before it flags the elements", async () => {
    connect("<p>text</p>");
    host.style.color = "rgb(1, 2, 3)";
    const tokens = host.shadowRoot!.adoptedStyleSheets[0]!.cssRules[0] as CSSStyleRule;
    let atFlags: string | undefined;
    const setAttribute = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (
      this: Element,
      name: string,
      value: string,
    ) {
      if (name === "data-mw-measuring") atFlags ??= tokens.style.getPropertyValue("--mw-fg");
      setAttribute.call(this, name, value);
    });
    await layOut();
    expect(atFlags).toBe("rgb(1, 2, 3)");
  });

  it("hands its reads what runs under the host past another host's layout inside it", async () => {
    // A leaf renderer asking another host for its text, which lays it out.
    const inner = document.createElement("mono-wind");
    inner.innerHTML = "<p>inner</p>";
    document.body.append(inner);
    registerLeafRenderer({
      tag: "nesting-leaf",
      render: () => ({ lines: [(inner as MonoWindElement).toPlainText() || "x"] }),
    });
    connect(
      '<nesting-leaf></nesting-leaf><p style="animation-name: spin; transform: matrix(1, 0, 0, 1, 0, 0)">spun</p>',
    );
    const spun = host.querySelector("p")!;
    const spin = {
      animationName: "spin",
      playState: "running",
      effect: {
        target: spun,
        pseudoElement: null,
        getKeyframes: () => [{ offset: 0, transform: "none" }],
      },
    } as unknown as Animation;
    host.getAnimations = () => [spin];
    await layOut();
    inner.remove();
    expect(host.shadowRoot!.querySelector("#layers .layer")).not.toBeNull();
  });

  it("asks what runs under the host once, no element its own", async () => {
    const asked: Element[] = [];
    vi.spyOn(Element.prototype, "getAnimations").mockImplementation(function (this: Element) {
      asked.push(this);
      return [];
    });
    connect(
      Array.from(
        { length: 4 },
        () => '<p style="animation-name: spin; transition-duration: 1s">text</p>',
      ).join(""),
    );
    await layOut();
    expect(host.hasAttribute("data-mw-ready")).toBe(true);
    expect(asked).toEqual([host]);
  });

  it("flags an anchor again where a script took its flag off", async () => {
    connect(
      '<div data-test="anchor" style="anchor-name: --a">anchor</div><p data-test="text">text</p>',
    );
    await layOut();
    const anchor = host.querySelector('[data-test="anchor"]')!;
    expect(anchor.hasAttribute("data-mw-anchor")).toBe(true);
    // A DOM-morphing library, which knows no engine flag.
    anchor.removeAttribute("data-mw-anchor");
    host.querySelector('[data-test="text"]')!.textContent = "more text";
    await layOut();
    expect(anchor.hasAttribute("data-mw-anchor")).toBe(true);
  });

  it("marks a native region, inline where its display is, and its host; unmarks them after", async () => {
    connect(
      '<div data-test="block" style="--mw-native: 1">block</div>' +
        '<p>a <span data-test="inline" style="--mw-native: 1">inline</span> b</p>',
    );
    // None found yet: the locks hold from the first read.
    expect(host.hasAttribute("data-mw-no-regions")).toBe(true);
    await layOut();
    const block = host.querySelector<HTMLElement>('[data-test="block"]')!;
    const inline = host.querySelector<HTMLElement>('[data-test="inline"]')!;
    const marks = () => [
      host.hasAttribute("data-mw-regions"),
      host.hasAttribute("data-mw-no-regions"),
      ...[block, inline].map((el) => el.getAttribute("data-mw-native")),
    ];
    expect(marks()).toEqual([true, false, "", "inline"]);
    block.style.removeProperty("--mw-native");
    await layOut();
    expect(marks()).toEqual([true, false, null, "inline"]);
    inline.style.removeProperty("--mw-native");
    await layOut();
    expect(marks()).toEqual([false, true, null, null]);
  });

  it("leaves a native region's overflow its own", async () => {
    connect(
      '<div data-test="region" style="--mw-native: 1; height: 32px; overflow: hidden"></div>',
    );
    await layOut();
    expect(host.querySelector('[data-test="region"]')!.hasAttribute("data-mw-clip")).toBe(false);
  });

  it("stops watching a sibling that left", async () => {
    const unobserved: Element[] = [];
    const unobserve = ResizeObserver.prototype.unobserve;
    vi.spyOn(ResizeObserver.prototype, "unobserve").mockImplementation(function (
      this: ResizeObserver,
      target: Element,
    ) {
      unobserved.push(target);
      unobserve.call(this, target);
    });
    const sibling = document.createElement("p");
    document.body.append(sibling);
    connect("<p>text</p>");
    await layOut();
    sibling.remove();
    host.querySelector("p")!.textContent = "more text";
    await layOut();
    expect(unobserved).toEqual([sibling]);
  });

  it("reads again the probed colors a context resolves, and those alone", async () => {
    const probed: string[] = [];
    connect('<p style="color: red">named</p><p style="color: currentcolor">current</p><p>text</p>');
    // The probe's writes (element.ts #probeColor).
    const probe = host.shadowRoot!.getElementById("color-probe")!;
    const style = new Proxy(probe.style, {
      get: (target, key) => {
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set: (target, key, value: string) => {
        if (key === "outlineColor" && value !== "") probed.push(value);
        return Reflect.set(target, key, value);
      },
    });
    Object.defineProperty(probe, "style", { get: () => style });
    await layOut();
    expect(probed).toEqual(expect.arrayContaining(["red", "currentcolor"]));
    probed.length = 0;
    host.querySelectorAll("p")[2]!.textContent = "more text";
    await layOut();
    expect(probed).toEqual(["currentcolor"]);
  });

  it("counts a color any vendor prefixes as one a context resolves", () => {
    for (const value of ["-apple-system-blue", "-webkit-link", "-moz-cellhighlight", "canvas"]) {
      expect(CONTEXTUAL_COLOR.test(value), value).toBe(true);
    }
    for (const value of ["red", "color-mix(in srgb-linear, red 50%, blue)", "rgb(1 2 3)"]) {
      expect(CONTEXTUAL_COLOR.test(value), value).toBe(false);
    }
  });
});

describe("an image (specs/images.md)", () => {
  it("lays the host out again as it loads, its load captured as it doesn't bubble", async () => {
    connect('<img style="display: block"><p>end</p>');
    const img = host.querySelector("img")!;
    let natural = [0, 0];
    Object.defineProperties(img, {
      naturalWidth: { get: () => natural[0] },
      naturalHeight: { get: () => natural[1] },
      complete: { get: () => natural[0]! > 0 },
    });
    await layOut();
    const row = () =>
      (host as MonoWindElement)
        .toPlainText()
        .split("\n")
        .findIndex((line) => line.includes("end"));
    expect(row()).toBe(0);
    // 40 px is 10 columns, 80 px of 8 px cells; at 2:1, 40 px tall,
    // two and a half 16 px rows, rounded to 3.
    natural = [40, 20];
    img.dispatchEvent(new Event("load"));
    await layOut();
    expect(row()).toBe(3);
  });
});

describe("a native region's content (specs/native-regions.md)", () => {
  const CONTENT =
    '<p data-test="inner">inner <button>press</button></p>' +
    '<input data-test="field"><input type="checkbox">';

  /** The engine's flags and variables on an element. */
  const marks = (el: Element): string[] => [
    ...el.getAttributeNames().filter((name) => name.startsWith("data-mw-")),
    ...Array.from({ length: (el as HTMLElement).style.length }, (_, i) =>
      (el as HTMLElement).style.item(i),
    ).filter((name) => name.startsWith("--mw-")),
  ];
  const marksIn = (region: Element): string[] => [...region.querySelectorAll("*")].flatMap(marks);

  it("keeps none of the engine's marks, a layout's before it was one included", async () => {
    connect(`<div data-test="region">${CONTENT}</div><p data-test="outside">outside</p>`);
    await layOut();
    const region = host.querySelector<HTMLElement>('[data-test="region"]')!;
    expect(marksIn(region)).toContain("data-mw-flow");
    region.style.setProperty("--mw-native", "1");
    await layOut();
    expect(marksIn(region)).toEqual([]);
    // Another layout, which walks the light DOM, leaves it be.
    host.querySelector('[data-test="outside"]')!.textContent = "changed";
    await layOut();
    expect(marksIn(region)).toEqual([]);
  });

  it("is light elements of the host again where the region stops being one", async () => {
    connect(`<div data-test="region" style="--mw-native: 1">${CONTENT}</div>`);
    await layOut();
    const region = host.querySelector<HTMLElement>('[data-test="region"]')!;
    region.style.removeProperty("--mw-native");
    await layOut();
    // Read under the gate, its marks with it, in the same layout.
    expect(marks(host.querySelector('[data-test="inner"]')!)).toContain("data-mw-flow");
    expect(marks(host.querySelector("button")!)).toContain("data-mw-interactive");
    expect(marksIn(region)).not.toContain("data-mw-measuring");
  });

  it("lays nothing out as it changes or takes input, but for a press, a change or its edge crossed", async () => {
    connect(
      `<div data-test="region" style="--mw-native: 1; width: 40px; height: 32px">${CONTENT}</div>` +
        '<input data-test="outside">',
    );
    await layOut();
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const field = host.querySelector('[data-test="field"]')!;
    const inner = host.querySelector('[data-test="inner"]')!;
    inner.textContent = "changed";
    inner.setAttribute("title", "changed");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    field.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: inner }));
    await Promise.resolve();
    expect(frames).not.toHaveBeenCalled();
    const outside = host.querySelector('[data-test="outside"]')!;
    for (const event of [
      new Event("change", { bubbles: true }),
      new PointerEvent("pointerdown", { bubbles: true }),
      new FocusEvent("focusin", { bubbles: true, relatedTarget: outside }),
      new PointerEvent("pointerover", { bubbles: true, relatedTarget: outside }),
    ]) {
      frames.mockClear();
      field.dispatchEvent(event);
      expect(frames, event.type).toHaveBeenCalled();
      await layOut();
    }
    frames.mockClear();
    outside.dispatchEvent(new Event("input", { bubbles: true }));
    expect(frames).toHaveBeenCalled();
  });

  it("takes no white-space of the grid's, its contents' own as measured", async () => {
    connect(
      '<div style="white-space: pre"><div data-test="region" style="--mw-native: 1; width: 40px; height: 32px">text</div></div>',
    );
    await layOut();
    const region = host.querySelector('[data-test="region"]')!;
    expect(marks(region).filter((mark) => /nowrap|pre|--mw-ws/.test(mark))).toEqual([]);
  });

  it("releases what an element moved into it carries", async () => {
    connect(
      '<p data-test="moved">moved</p><div data-test="region" style="--mw-native: 1; width: 40px; height: 32px"></div>',
    );
    await layOut();
    const moved = host.querySelector('[data-test="moved"]')!;
    expect(marks(moved)).not.toEqual([]);
    host.querySelector('[data-test="region"]')!.append(moved);
    await layOut();
    expect(marks(moved)).toEqual([]);
  });

  it("is left marked where it moves to another host", async () => {
    connect('<div data-test="region" style="--mw-native: 1; width: 40px; height: 32px">text</div>');
    const other = document.createElement("mono-wind");
    document.body.append(other);
    try {
      await layOut();
      await layOut(other);
      const region = host.querySelector('[data-test="region"]')!;
      other.append(region);
      // The host it moved to lays out first.
      await layOut(other);
      await layOut();
      expect(region.hasAttribute("data-mw-native")).toBe(true);
    } finally {
      other.remove();
    }
  });

  it("releases what a former region held where a new one around it holds it", async () => {
    connect(
      `<div data-test="outer"><div data-test="region" style="--mw-native: 1">${CONTENT}</div></div>`,
    );
    await layOut();
    const outer = host.querySelector<HTMLElement>('[data-test="outer"]')!;
    host.querySelector<HTMLElement>('[data-test="region"]')!.style.removeProperty("--mw-native");
    outer.style.setProperty("--mw-native", "1");
    await layOut();
    expect(marksIn(outer)).toEqual([]);
  });

  it("keeps none of the engine's variables a page restyled it under", async () => {
    connect(`<div data-test="region">${CONTENT}</div>`);
    await layOut();
    const region = host.querySelector<HTMLElement>('[data-test="region"]')!;
    host.querySelector<HTMLElement>('[data-test="inner"]')!.style.color = "red";
    region.style.setProperty("--mw-native", "1");
    await layOut();
    expect(marksIn(region)).toEqual([]);
  });

  it("lays nothing out as a region that is a field takes input, but for its change", async () => {
    connect(
      '<textarea data-test="region" style="--mw-native: 1; width: 40px; height: 32px"></textarea>',
    );
    await layOut();
    await layOut();
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const region = host.querySelector('[data-test="region"]')!;
    region.dispatchEvent(new Event("input", { bubbles: true }));
    expect(frames).not.toHaveBeenCalled();
    region.dispatchEvent(new Event("change", { bubbles: true }));
    expect(frames).toHaveBeenCalled();
  });

  it("leaves the scrolls inside it to the host running there", async () => {
    connect(
      '<div style="--mw-native: 1; width: 40px; height: 32px"><div data-test="scroller"></div></div>',
    );
    await layOut();
    const scroller = host.querySelector('[data-test="scroller"]')!;
    // As a host running in the region marks its own.
    scroller.setAttribute("data-mw-scroll", "");
    const frames = vi.spyOn(window, "requestAnimationFrame");
    scroller.dispatchEvent(new Event("scroll"));
    expect(frames).not.toHaveBeenCalled();
  });

  it("is measured afresh where the cell changes", async () => {
    connect(
      '<p>a <span data-test="region" style="--mw-native: 1">text</span> b</p><p data-test="outside">x</p>',
    );
    await layOut();
    const region = host.querySelector('[data-test="region"]')!;
    const measured: string[] = [];
    new MutationObserver((records) => {
      for (const { oldValue } of records) if (oldValue === null) measured.push("measured");
    }).observe(region, { attributeFilter: ["data-mw-native-measure"], attributeOldValue: true });
    const relayOut = async (cell: DOMRect): Promise<void> => {
      host.querySelector<HTMLElement>(":scope > [data-mw-probe]")!.getBoundingClientRect = () =>
        cell;
      host.querySelector('[data-test="outside"]')!.textContent += "x";
      await Promise.resolve();
      (host as MonoWindElement).toPlainText();
      await Promise.resolve();
    };
    await relayOut(new DOMRect(0, 0, 800, 16));
    expect(measured, "the same cell").toEqual([]);
    await relayOut(new DOMRect(0, 0, 1000, 20));
    expect(measured.length, "a new cell").toBeGreaterThan(0);
  });

  it("is measured afresh where it moves", async () => {
    connect(
      '<div data-test="region" style="--mw-native: 1">text</div><div data-test="other"></div>',
    );
    await layOut();
    const region = host.querySelector('[data-test="region"]')!;
    let measures = 0;
    new MutationObserver((records) => (measures += records.length)).observe(region, {
      attributeFilter: ["data-mw-native-measure"],
    });
    host.querySelector('[data-test="other"]')!.append(region);
    await layOut();
    await Promise.resolve();
    expect(measures).toBeGreaterThan(0);
  });

  it("is measured afresh where a layout in the same dispatch takes its change", async () => {
    connect(
      '<div data-test="region" style="--mw-native: 1">a</div><select data-test="select"></select>',
    );
    await layOut();
    const region = host.querySelector('[data-test="region"]')!;
    let measures = 0;
    new MutationObserver((records) => (measures += records.length)).observe(region, {
      attributeFilter: ["data-mw-native-measure"],
    });
    // A page's change, then a select's focus, which lays out at once.
    region.firstChild!.textContent = "a longer text";
    host
      .querySelector('[data-test="select"]')!
      .dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await Promise.resolve();
    expect(measures).toBeGreaterThan(0);
  });

  it("measures its regions again together where something changed them", async () => {
    connect(
      '<div data-test="a" style="--mw-native: 1"><p>a</p></div><div data-test="b" style="--mw-native: 1"><p>b</p></div>',
    );
    await layOut();
    const toggles: string[] = [];
    const { setAttribute, removeAttribute } = Element.prototype;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (
      this: Element,
      name,
      value,
    ) {
      if (name === "data-mw-native-measure") toggles.push(`${this.getAttribute("data-test")}+`);
      setAttribute.call(this, name, value);
    });
    vi.spyOn(Element.prototype, "removeAttribute").mockImplementation(function (
      this: Element,
      name,
    ) {
      if (name === "data-mw-native-measure") toggles.push(`${this.getAttribute("data-test")}-`);
      removeAttribute.call(this, name);
    });
    window.dispatchEvent(new Event("resize"));
    await layOut();
    // Each width a round, both regions in it.
    expect(toggles.join(" ")).toMatch(/^(a\+ b\+ a- b- ?)+$/);
  });

  it("lays out as it changes where it sizes the region, not where its author does", async () => {
    connect(
      `<div style="--mw-native: 1"><p data-test="auto">auto</p></div>` +
        `<div style="--mw-native: 1; width: 40px; height: 32px"><p data-test="sized">sized</p></div>`,
    );
    await layOut();
    const frames = vi.spyOn(window, "requestAnimationFrame");
    host.querySelector('[data-test="sized"]')!.textContent = "changed";
    await Promise.resolve();
    expect(frames).not.toHaveBeenCalled();
    host.querySelector('[data-test="auto"]')!.textContent = "changed";
    await Promise.resolve();
    expect(frames).toHaveBeenCalled();
  });
});

describe('a host inside another (specs/native-regions.md "Nesting")', () => {
  const REGION = '<div data-test="region" style="--mw-native: 1; width: 80px; height: 64px">';
  const INNER = '<mono-wind data-test="inner"><p data-test="text">inner text</p></mono-wind>';
  const inner = () => host.querySelector<HTMLElement>('[data-test="inner"]')!;
  const unsupported = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.filter(([message]) => String(message).includes("is unsupported")).length;
  /** The hosts laid out from here on, by their test hooks. */
  const layoutsOf = (hosts: Element[]): Set<string> => {
    const laidOut = new Set<string>();
    const layouts = new MutationObserver((records) => {
      for (const { target } of records) {
        laidOut.add((target as Element).getAttribute("data-test") ?? "outer");
      }
    });
    for (const each of hosts) layouts.observe(each, { attributeFilter: ["measuring"] });
    return laidOut;
  };

  it("runs in one of the outer host's regions, as the outer host's marks stand", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(`${REGION}${INNER}</div>`);
    // Nested until the outer host's first layout marks its region.
    expect(inner().hasAttribute("data-mw-nested")).toBe(true);
    await layOut();
    expect(inner().hasAttribute("data-mw-nested")).toBe(false);
    await layOut(inner());
    expect((inner() as MonoWindElement).toPlainText()).toContain("inner text");
    expect(inner().hasAttribute("data-mw-ready")).toBe(true);
    expect((host as MonoWindElement).toPlainText()).not.toContain("inner text");
    expect(unsupported(warn)).toBe(0);
  });

  it("stays off in no region, warned of once the outer host lays out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(`<div>${INNER}</div>`);
    expect(inner().hasAttribute("data-mw-nested")).toBe(true);
    expect(unsupported(warn)).toBe(0);
    await layOut();
    expect(unsupported(warn)).toBe(1);
    expect((host as MonoWindElement).toPlainText()).toContain("inner text");
    host.querySelector('[data-test="text"]')!.textContent = "changed";
    await layOut();
    expect(unsupported(warn)).toBe(1);
    expect(inner().hasAttribute("data-mw-ready")).toBe(false);
  });

  it("turns off where its region stops being one, what it wrote taken back, and on again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(`${REGION}${INNER}</div>`);
    await layOut();
    await layOut(inner());
    const region = host.querySelector<HTMLElement>('[data-test="region"]')!;
    inner().setAttribute("focus", "arrows");
    region.style.removeProperty("--mw-native");
    await layOut();
    const grid = inner().shadowRoot!.getElementById("grid")!;
    expect(inner().hasAttribute("data-mw-nested")).toBe(true);
    expect(
      inner()
        .getAttributeNames()
        .filter((name) => name.startsWith("data-mw-")),
    ).toEqual(["data-mw-nested"]);
    expect(inner().style.getPropertyValue("--mw-cw")).toBe("");
    // The keywords it reflected taken back too, its author's kept.
    expect(["select", "focus"].map((name) => inner().getAttribute(name))).toEqual([null, "arrows"]);
    expect(inner().querySelector("[data-mw-probe]")).toBeNull();
    expect(grid.textContent).toBe("");
    // Its contents the outer host's now.
    expect((host as MonoWindElement).toPlainText()).toContain("inner text");
    region.style.setProperty("--mw-native", "1");
    await layOut();
    expect(inner().hasAttribute("data-mw-nested")).toBe(false);
    await layOut(inner());
    expect((inner() as MonoWindElement).toPlainText()).toContain("inner text");
    expect(grid.textContent).toContain("inner text");
    expect(["select", "focus"].map((name) => inner().getAttribute(name))).toEqual([
      "grid",
      "arrows",
    ]);
  });

  it("turns off where it moves out of the region, what it wrote taken back", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(`${REGION}${INNER}</div><div data-test="plain"></div>`);
    await layOut();
    await layOut(inner());
    host.querySelector('[data-test="plain"]')!.append(inner());
    expect(
      inner()
        .getAttributeNames()
        .filter((name) => name.startsWith("data-mw-")),
    ).toEqual(["data-mw-nested"]);
    expect(inner().querySelector("[data-mw-probe]")).toBeNull();
    expect(inner().shadowRoot!.getElementById("grid")!.textContent).toBe("");
  });

  it("turns off where it moves out of the region, its children just replaced", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(`${REGION}${INNER}</div><div data-test="plain"></div>`);
    await layOut();
    await layOut(inner());
    // Its probe out until its next layout.
    inner().replaceChildren(Object.assign(document.createElement("p"), { textContent: "new" }));
    host.querySelector('[data-test="plain"]')!.append(inner());
    expect(
      inner()
        .getAttributeNames()
        .filter((name) => name.startsWith("data-mw-")),
    ).toEqual(["data-mw-nested"]);
    expect(inner().shadowRoot!.getElementById("grid")!.textContent).toBe("");
  });

  it("checks a keyword its author set while it was off, as it starts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(`<div data-test="region" style="width: 80px; height: 64px">${INNER}</div>`);
    await layOut();
    inner().setAttribute("select", "bogus");
    host.querySelector<HTMLElement>('[data-test="region"]')!.style.setProperty("--mw-native", "1");
    await layOut();
    expect(inner().hasAttribute("data-mw-nested")).toBe(false);
    expect(inner().getAttribute("select")).toBe("grid");
    expect(warn.mock.calls.some(([message]) => String(message).includes('select="bogus"'))).toBe(
      true,
    );
  });

  it("starts a host in a region of a host turning off, the outer host's region now", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(
      `${REGION}<mono-wind data-test="inner">` +
        '<div data-test="inner-region" style="--mw-native: 1; width: 40px; height: 32px">' +
        '<mono-wind data-test="deepest"><p>deep</p></mono-wind></div>' +
        "</mono-wind></div>",
    );
    const deepest = () => host.querySelector<HTMLElement>('[data-test="deepest"]')!;
    await layOut();
    await layOut(inner());
    await layOut(deepest());
    host.querySelector<HTMLElement>('[data-test="region"]')!.style.removeProperty("--mw-native");
    await layOut();
    expect(inner().hasAttribute("data-mw-nested")).toBe(true);
    expect(host.querySelector('[data-test="inner-region"]')!.hasAttribute("data-mw-native")).toBe(
      true,
    );
    expect(deepest().hasAttribute("data-mw-nested")).toBe(false);
    expect(deepest().querySelector("[data-mw-probe]"), "running").not.toBeNull();
    expect(unsupported(warn), "the inner host's warning alone").toBe(1);
  });

  it("hands its regions to the outer host as it turns off", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(
      `${REGION}<mono-wind data-test="inner">` +
        '<div data-test="inner-region" style="--mw-native: 1; width: 40px; height: 32px"><p>inner text</p></div>' +
        "</mono-wind></div>",
    );
    await layOut();
    await layOut(inner());
    const innerRegion = host.querySelector('[data-test="inner-region"]')!;
    expect(innerRegion.hasAttribute("data-mw-native")).toBe(true);
    host.querySelector<HTMLElement>('[data-test="region"]')!.style.removeProperty("--mw-native");
    await layOut();
    expect(inner().hasAttribute("data-mw-nested")).toBe(true);
    expect(innerRegion.hasAttribute("data-mw-native"), "the outer host's region now").toBe(true);
  });

  it("takes no mw-native of its own, warned of, and stays off as plain content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(
      '<mono-wind data-test="inner" style="--mw-native: 1; width: 80px; height: 64px"><p>inner text</p></mono-wind>',
    );
    await layOut();
    expect(inner().hasAttribute("data-mw-native")).toBe(false);
    expect(inner().hasAttribute("data-mw-nested")).toBe(true);
    expect((host as MonoWindElement).toPlainText()).toContain("inner text");
    expect(warn.mock.calls.some(([message]) => String(message).includes("wrap it"))).toBe(true);
  });

  it("stops sampling its animations as it turns off", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(`${REGION}${INNER}</div>`);
    await layOut();
    const text = host.querySelector('[data-test="text"]')!;
    const fade = {
      animationName: "fade",
      playState: "running",
      effect: { target: text, pseudoElement: null, getKeyframes: () => [{ opacity: "0.5" }] },
    } as unknown as Animation;
    inner().getAnimations = () => [fade];
    await layOut(inner());
    host.querySelector<HTMLElement>('[data-test="region"]')!.style.removeProperty("--mw-native");
    await layOut();
    const frames = vi.spyOn(window, "requestAnimationFrame");
    await new Promise((done) => setTimeout(done, 120));
    expect(frames.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("is left its own writes and records by the outer host", async () => {
    connect(`<div style="--mw-native: 1">${INNER}</div><p data-test="outside">outside</p>`);
    await layOut();
    await layOut(inner());
    const text = host.querySelector('[data-test="text"]')!;
    const written = text.getAttributeNames().filter((name) => name.startsWith("data-mw-"));
    expect(written).not.toEqual([]);
    host.querySelector('[data-test="outside"]')!.textContent = "changed";
    await layOut();
    expect(text.getAttributeNames().filter((name) => name.startsWith("data-mw-"))).toEqual(written);
    // A change inside it lays out the inner host alone, though the
    // outer one measures the region.
    const laidOut = layoutsOf([host, inner()]);
    text.textContent = "changed";
    await Promise.resolve();
    for (const each of [host, inner()]) (each as MonoWindElement).toPlainText();
    // Nor does the inner host's layout, its marks on itself included.
    await Promise.resolve();
    (host as MonoWindElement).toPlainText();
    await Promise.resolve();
    expect([...laidOut]).toEqual(["inner"]);
  });
});

describe("the sampling loop (specs/animations.md)", () => {
  it("reads the animations a query found until a start brings news", async () => {
    connect("<p>faded</p>");
    const faded = host.querySelector("p")!;
    const fade = {
      animationName: "fade",
      playState: "running",
      effect: { target: faded, pseudoElement: null, getKeyframes: () => [{ opacity: "0.5" }] },
    } as unknown as Animation;
    let queries = 0;
    host.getAnimations = () => (queries++, [fade]);
    await layOut();
    const frames = (count: number): Promise<void> =>
      new Promise((done) => {
        const next = (): void => void (count-- > 0 ? requestAnimationFrame(next) : done());
        next();
      });
    await frames(5);
    expect(queries, "the layout's query, read by every frame").toBe(1);
    faded.dispatchEvent(new Event("animationstart", { bubbles: true }));
    await frames(5);
    expect(queries).toBe(2);
  });
});

describe("the shadow's sheet", () => {
  it("draws each shade the grid boxes from a literal of its glyph", () => {
    const sheet = connect().shadowRoot!.querySelector("style")!.textContent;
    const drawn = [...SHADES].filter((shade) =>
      sheet.includes(`[data-shade="${shade}"]::after { content: "${shade}"; }`),
    );
    expect(drawn).toEqual(["\u2591", "\u2592", "\u2593"]);
  });
});

describe("a host with no width to lay out in", () => {
  it("warns once where its display gives it none, not where it is hidden", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warned: string[] = [];
    for (const display of ["inline", "contents", "none"]) {
      connect("text");
      host.style.display = display;
      const probe = host.querySelector<HTMLElement>("[data-mw-probe]")!;
      probe.getBoundingClientRect = () => new DOMRect(0, 0, 800, 16);
      Object.defineProperty(host, "clientWidth", { value: 0, configurable: true });
      await Promise.resolve();
      (host as MonoWindElement).toPlainText();
      (host as MonoWindElement).toPlainText();
      warned.push(...warn.mock.calls.map(([message]) => message as string));
      warn.mockClear();
      host.remove();
    }
    expect(warned).toEqual([
      "[monowind] A <mono-wind> with display: inline lays nothing out; give it a box, such as block or inline-block.",
      "[monowind] A <mono-wind> with display: contents lays nothing out; give it a box, such as block or inline-block.",
    ]);
  });
});

describe("the host's keyword attributes", () => {
  it("reflect their defaults, and fall back to them from an unrecognized value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    connect();
    expect(host.getAttribute("select")).toBe("grid");
    expect(host.getAttribute("focus")).toBe("tab");
    host.setAttribute("select", "text");
    host.setAttribute("focus", "arrows");
    expect(host.getAttribute("select")).toBe("text");
    expect(host.getAttribute("focus")).toBe("arrows");

    host.setAttribute("select", "cells");
    host.setAttribute("focus", "spatial");
    expect(host.getAttribute("select")).toBe("grid");
    expect(host.getAttribute("focus")).toBe("tab");
    host.setAttribute("focus", "arrows");
    host.removeAttribute("select");
    host.removeAttribute("focus");
    expect(host.getAttribute("select")).toBe("grid");
    expect(host.getAttribute("focus")).toBe("tab");
    const ignored = warn.mock.calls.map(([message]) => message as string);
    expect(ignored.filter((message) => message.includes("Ignoring"))).toEqual([
      '[monowind] Ignoring unrecognized select="cells". Expected "grid" (default) or "text".',
      '[monowind] Ignoring unrecognized focus="spatial". Expected "tab" (default) or "arrows".',
    ]);
  });
});

describe("the ground (specs/cell-model.md)", () => {
  const token = (name: string): string =>
    (host.shadowRoot!.adoptedStyleSheets[0]!.cssRules[0] as CSSStyleRule).style.getPropertyValue(
      name,
    );
  const background = (): string =>
    (host.shadowRoot!.querySelector("#grid span") as HTMLElement).style.backgroundColor;

  it("derives it through a translucent host background, down to an opaque one", async () => {
    const page = document.createElement("div");
    page.style.backgroundColor = "rgb(255, 0, 0)";
    document.body.append(page);
    host = document.createElement("mono-wind");
    host.style.backgroundColor = "rgba(0, 0, 255, 0.4)";
    page.append(host);
    await layOut();
    page.remove();
    expect(token("--mw-bg")).toBe("rgb(153 0 102)");
  });

  it("leaves a faded box with nothing beneath to its span's opacity, whatever the ground", async () => {
    host = document.createElement("mono-wind");
    host.style.setProperty("--mw-bg", "rgb(0, 0, 200)");
    host.innerHTML =
      '<div style="opacity: 0.4; background-color: rgb(0, 0, 0); color: rgb(255, 255, 255)">x</div>';
    document.body.append(host);
    await layOut();
    const glyph = host.shadowRoot!.querySelector("#grid span") as HTMLElement;
    expect([glyph.textContent, glyph.style.color, background(), glyph.style.opacity]).toEqual([
      "x",
      "rgb(255, 255, 255)",
      "rgb(0, 0, 0)",
      "0.4",
    ]);
  });
});

describe("a checkbox's appearance (specs/checkboxes.md)", () => {
  it("reads as its own under its flag, which the lock hiding its widget spares", async () => {
    const lock = document.createElement("style");
    lock.textContent = `input:not([${CONTROL_READ_FLAG}]) { appearance: none !important }`;
    document.head.append(lock);
    connect(`<input type="checkbox">|<input type="checkbox" style="appearance: none">|`);
    await layOut();
    lock.remove();
    // The author's `appearance: none` draws no glyph, an empty box.
    expect((host as MonoWindElement).toPlainText().split("\n")[0]!.trimEnd()).toBe("[ ]||");
  });
});

describe("a checkbox's state (specs/checkboxes.md)", () => {
  it("lays the host out at its lock's transition, whatever flipped it", async () => {
    connect(`<input type="checkbox"> ok`);
    await layOut();
    const text = () => (host as MonoWindElement).toPlainText().split("\n")[0]!.trimEnd();
    expect(text()).toBe("[ ] ok");
    // A script's flip, which fires no input event: the lock's transition
    // is what the browser tells.
    const input = host.querySelector("input")!;
    input.checked = true;
    // happy-dom's TransitionEvent drops its init's propertyName.
    const run = new Event("transitionrun", { bubbles: true });
    input.dispatchEvent(Object.assign(run, { propertyName: "--mw-checked", pseudoElement: "" }));
    await layOut();
    expect(text()).toBe("[x] ok");
  });
});

describe("a checkbox's own transitions (specs/checkboxes.md)", () => {
  it("ride the lock's variables, read under its flag and padded, till its transition goes", async () => {
    const lock = document.createElement("style");
    lock.textContent = `input:not([${CONTROL_READ_FLAG}]) { transition-property: --mw-checked !important }`;
    document.head.append(lock);
    connect(
      `<input type="checkbox" style="transition-property: color, background-color; transition-duration: 1s">`,
    );
    await layOut();
    lock.remove();
    const input = host.querySelector("input")!;
    const written = () =>
      Object.values(OWN_TRANSITION_VARS).map((name) => input.style.getPropertyValue(name));
    expect(written().slice(0, 2)).toEqual(["color, background-color", "1s, 1s"]);
    input.style.transitionDuration = "0s";
    await layOut();
    expect(written().every((value) => value === "")).toBe(true);
  });
});
