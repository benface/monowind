import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import { asciiFont } from "@monowind/ascii";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * `<mono-ascii>` (@monowind/ascii): FIGlet/TOIlet banner text as grid
 * content, through the public leaf-renderer API. The light DOM keeps
 * the semantic string (a11y, select="text"); the grid shows the art.
 */
const meta: Meta = {
  title: "Components / mono-ascii",
};
export default meta;

const readyHost = async (canvasElement: HTMLElement): Promise<HTMLElement> => {
  const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
  await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
  return host;
};

export const Banner: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex flex-col gap-1">
        <mono-ascii class="text-emerald-400">monowind</mono-ascii>
        <mono-ascii font="small" class="text-cyan-400">small font</mono-ascii>
        <mono-ascii font="mono9" class="text-fuchsia-400">tlf!</mono-ascii>
        <div class="flex justify-center border-t pt-1">
          <mono-ascii font="small" class="transition duration-300 hover:text-rose-400"
            >centered</mono-ascii
          >
        </div>
        <mono-ascii font="small" effect="rainbow">rainbow</mono-ascii>
        <mono-ascii font="small" effect="metal">metal</mono-ascii>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const grid = host.shadowRoot!.getElementById("grid")!;
    await waitFor(
      () => {
        // The art is on the grid (standard's underscore top edge, and
        // the semantic strings are NOT there as plain text runs).
        expect(grid.textContent).toContain("_ __ ___   ___  _ __   ___"); // "mono" in standard
        expect(grid.textContent).not.toContain("monowind");
        // Rainbow effect paints theme-token stripes.
        const striped = Array.from(grid.querySelectorAll("span")).find((s) =>
          s.style.color.includes("--mw-ansi-"),
        );
        expect(striped).toBeDefined();
      },
      { timeout: 10_000 },
    );
    // Semantic text intact in the light DOM.
    const banner = canvasElement.querySelector("mono-ascii")!;
    expect(banner.textContent).toBe("monowind");
    // The shadow transcript: the art as transparent real text (real
    // newlines) overlaying the grid — what select="text" selects and
    // copies natively; the slotted semantic string is visually hidden
    // and unselectable, so it stays accessibility-only.
    const mirror = banner.shadowRoot!.getElementById("mirror")!;
    expect(mirror.textContent).toContain("_ __ ___   ___  _ __   ___");
    expect(mirror.textContent).toContain("\n");
    expect(getComputedStyle(mirror).color).toBe("rgba(0, 0, 0, 0)");
    const alt = banner.shadowRoot!.querySelector(".alt")!;
    const altStyle = getComputedStyle(alt) as CSSStyleDeclaration & { webkitUserSelect?: string };
    expect(altStyle.userSelect || altStyle.webkitUserSelect).toBe("none");
  },
};

/** Test-only behaviors: fallbacks, dynamic updates, property API. */
export const Behavior: StoryObj = {
  tags: ["!dev"],
  render: () => html`
    <mono-wind>
      <div class="flex max-w-max flex-col gap-1">
        <mono-ascii font="small" data-test="dynamic">abc</mono-ascii>
        <mono-ascii font="no-such-font" data-test="missing">fallback text</mono-ascii>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = await readyHost(canvasElement);
    const grid = host.shadowRoot!.getElementById("grid")!;
    const dynamic = canvasElement.querySelector<HTMLElement>('[data-test="dynamic"]')!;

    // Unknown font: content never disappears — plain text renders.
    await waitFor(() => expect(grid.textContent).toContain("fallback text"), { timeout: 10_000 });

    // Text mutation re-renders (characterData observation).
    dynamic.textContent = "xyz";
    await waitFor(() => expect(grid.textContent).not.toContain("abc"), { timeout: 10_000 });

    // Font ATTRIBUTE change re-renders (declared observed attribute) —
    // standard is taller than small, so the row count grows.
    const rowsBefore = grid.textContent!.split("\n").length;
    dynamic.setAttribute("font", "standard");
    await waitFor(() => expect(grid.textContent!.split("\n").length).toBeGreaterThan(rowsBefore), {
      timeout: 10_000,
    });

    // Font PROPERTY wins over the attribute.
    const small = asciiFont("small")!;
    (dynamic as HTMLElement & { font: typeof small }).font = small;
    await waitFor(() => expect(grid.textContent!.split("\n").length).toBe(rowsBefore), {
      timeout: 10_000,
    });
  },
};
