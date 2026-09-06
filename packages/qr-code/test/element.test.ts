import { afterEach, describe, expect, it, vi } from "vitest";
import { registerBorderGlyphs } from "monowind";
import { defineMonoQr, renderQrLeaf } from "../src/index.ts";
import { DEFAULT_GLYPHS, renderQr } from "../src/render.ts";

/** The element's attributes and fallbacks (specs/qr-code.md "The
 * element"), through the leaf renderer. happy-dom does not inherit
 * custom properties into a descendant's computed style, so `aspect`
 * is set explicitly here and the auto path (which reads 2 there) is
 * asserted in the Storybook story. */

defineMonoQr();

const VALUE = "https://play.monowind.benface.com";

function qr(attributes: Record<string, string> = {}, text = VALUE): HTMLElement {
  const el = document.createElement("mono-qr");
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

const expected = (options: Partial<Parameters<typeof renderQr>[1]> = {}, text = VALUE) =>
  renderQr(text, { level: "M", scale: 1, aspect: 2, glyphs: DEFAULT_GLYPHS, ...options })!;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("<mono-qr>", () => {
  it("renders its text with the defaults, 21 × 11 for a version-1 value", () => {
    const rows = renderQrLeaf(qr({}, "12345")).lines;
    expect(rows).toHaveLength(11);
    expect(rows[0]).toHaveLength(21);
    expect(rows).toEqual(expected({}, "12345"));
  });

  it("honors each attribute", () => {
    expect(renderQrLeaf(qr({ level: "H" })).lines).toEqual(expected({ level: "H" }));
    expect(renderQrLeaf(qr({ level: "l" })).lines).toEqual(expected({ level: "L" }));
    expect(renderQrLeaf(qr({ aspect: "1" })).lines).toEqual(expected({ aspect: 1 }));
    expect(renderQrLeaf(qr({ aspect: "0.5" })).lines).toEqual(expected({ aspect: 0.5 }));
    expect(renderQrLeaf(qr({ aspect: "1.7" })).lines).toEqual(expected({ aspect: 2 }));
    expect(renderQrLeaf(qr({ aspect: "4" })).lines).toEqual(expected({ aspect: 4 }));
    expect(renderQrLeaf(qr({ aspect: "3" })).lines).toEqual(expected({ aspect: 4 }));
    expect(renderQrLeaf(qr({ aspect: "0.3" })).lines).toEqual(expected({ aspect: 1 / 3 }));
    expect(renderQrLeaf(qr({ scale: "2" })).lines).toEqual(expected({ scale: 2 }));
    expect(renderQrLeaf(qr({ scale: "3", aspect: "1" })).lines).toEqual(
      expected({ scale: 3, aspect: 1 }),
    );
  });

  it("reads an attribute that does not parse as its default", () => {
    const rows = expected();
    expect(renderQrLeaf(qr({ level: "X" })).lines).toEqual(rows);
    expect(renderQrLeaf(qr({ scale: "0" })).lines).toEqual(rows);
    expect(renderQrLeaf(qr({ scale: "" })).lines).toEqual(rows);
    expect(renderQrLeaf(qr({ scale: "2.5" })).lines).toEqual(rows);
    expect(renderQrLeaf(qr({ scale: "big" })).lines).toEqual(rows);
    expect(renderQrLeaf(qr({ scale: "99" })).lines).toEqual(expected({ scale: 16 }));
    expect(renderQrLeaf(qr({ aspect: "auto" })).lines).toEqual(rows);
    expect(renderQrLeaf(qr({ aspect: "-2" })).lines).toEqual(rows);
  });

  it("trims collapsible whitespace around the value and keeps the inside verbatim", () => {
    const rows = renderQrLeaf(qr({}, `\n  ${VALUE}  \n`)).lines;
    expect(rows).toEqual(expected());
    expect(renderQrLeaf(qr({}, "a b")).lines).toEqual(expected({}, "a b"));
    expect(renderQrLeaf(qr({}, "a\u00a0b")).lines).toEqual(expected({}, "a\u00a0b"));
    expect(renderQrLeaf(qr({}, "a\nb")).lines).toEqual(expected({}, "a\nb"));
  });

  it("renders nothing for an empty value, and warns once for a value that does not fit", () => {
    expect(renderQrLeaf(qr({}, "   ")).lines).toEqual([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = qr({}, "x".repeat(3000));
    expect(renderQrLeaf(el).lines).toEqual([]);
    expect(renderQrLeaf(el).lines).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores element children with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = qr();
    el.appendChild(document.createElement("b"));
    renderQrLeaf(el);
    renderQrLeaf(el);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("text only");
  });

  it("renders once per value and once per packing", () => {
    const el = qr();
    const rows = renderQrLeaf(el).lines;
    expect(renderQrLeaf(el).lines).toBe(rows);
    el.setAttribute("scale", "2");
    expect(renderQrLeaf(el).lines).not.toBe(rows);
    el.setAttribute("scale", "1");
    expect(renderQrLeaf(el).lines).toEqual(rows);
  });

  it("keeps the transcript in step with the rows", () => {
    const el = qr({ scale: "2" });
    const rows = renderQrLeaf(el).lines;
    const mirror = el.shadowRoot!.getElementById("mirror")!;
    expect(mirror.textContent).toBe(rows.join("\n"));
    el.removeAttribute("scale");
    renderQrLeaf(el);
    expect(mirror.textContent).toBe(expected().join("\n"));
  });

  it("packs through the element's glyph set", () => {
    registerBorderGlyphs("test-hash", { solid: { qrFull: "#" } });
    const el = qr({ aspect: "2" });
    el.style.setProperty("--mw-border-glyphs", "test-hash");
    expect(renderQrLeaf(el).lines).toEqual(expected({ glyphs: { full: "#" } }));
  });
});
