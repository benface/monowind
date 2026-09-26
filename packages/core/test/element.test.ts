import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
const layOut = async (): Promise<void> => {
  const probe = host.querySelector<HTMLElement>("[data-mw-probe]")!;
  probe.getBoundingClientRect = () => new DOMRect(0, 0, 800, 16);
  Object.defineProperty(host, "clientWidth", { value: 80, configurable: true });
  await Promise.resolve();
  (host as MonoWindElement).toPlainText();
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
