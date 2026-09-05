import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * Synthesized pointer states (specs/cell-model.md "Pointer states"):
 * under select="grid" the light DOM is pointer-events: none, so
 * :hover/:active can never match — the engine hit-tests the pointer's
 * cell and marks the chain with data-mw-hover / data-mw-active, and
 * variants.css retargets the Tailwind variants to match either source.
 * The engine listens for plain pointer events, so synthetic dispatches
 * drive the whole path (unlike native :hover, which needs a trusted
 * pointer).
 */
const meta: Meta = {
  title: "Features / Pointer",
  // Test-only: the hoverable Effects/Transitions story is the showcase.
  tags: ["!dev"],
};
export default meta;

const at = (el: Element): { clientX: number; clientY: number } => {
  const rect = el.getBoundingClientRect();
  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
};

export const SynthesizedPointerStates: StoryObj = {
  render: () => html`
    <mono-wind>
      <div class="flex max-w-max flex-col gap-1">
        <div class="group cursor-pointer border px-1 hover:text-rose-400" data-test="tile">
          <span class="group-hover:underline">alpha</span> tile
        </div>
        <div class="border px-1 active:text-amber-400" data-test="press">press tile</div>
        <div inert class="cursor-pointer border px-1 hover:text-rose-400" data-test="inert">
          inert tile
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("mono-wind")!;
    await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    const grid = host.shadowRoot!.getElementById("grid")!;
    const tile = canvasElement.querySelector<HTMLElement>('[data-test="tile"]')!;
    const press = canvasElement.querySelector<HTMLElement>('[data-test="press"]')!;

    // CSS wiring alone: the compiled hover: variant matches the
    // attribute with no pointer machinery involved.
    tile.setAttribute("data-mw-hover", "");
    const rose = getComputedStyle(tile).color;
    tile.removeAttribute("data-mw-hover");
    expect(rose).not.toBe(getComputedStyle(tile).color);

    // Engine-driven: a pointermove over the tile's cells marks the
    // chain, mirrors the cursor, and repaints the grid.
    host.dispatchEvent(new PointerEvent("pointermove", { ...at(tile), bubbles: true }));
    await waitFor(
      () => {
        expect(tile).toHaveAttribute("data-mw-hover");
        expect(getComputedStyle(tile).color).toBe(rose);
        // group-hover: on the inline child composes from the ancestor's
        // attribute (inline elements carry no attribute themselves).
        const span = tile.querySelector("span")!;
        expect(span).not.toHaveAttribute("data-mw-hover");
        expect(getComputedStyle(span).textDecorationLine).toContain("underline");
        expect(grid.style.cursor).toBe("pointer");
        const painted = Array.from(grid.querySelectorAll("span")).find((s) =>
          s.textContent!.includes("alpha"),
        )!;
        expect(painted.style.textDecorationLine).toContain("underline");
      },
      { timeout: 10_000 },
    );

    // An inert tile is absent for interaction: its parent hovers, it
    // never does, and the mirrored cursor is the parent's grid-mode
    // text cursor, not the tile's pointer.
    const inert = canvasElement.querySelector<HTMLElement>('[data-test="inert"]')!;
    host.dispatchEvent(new PointerEvent("pointermove", { ...at(inert), bubbles: true }));
    await waitFor(() => expect(inert.parentElement).toHaveAttribute("data-mw-hover"), {
      timeout: 10_000,
    });
    expect(inert).not.toHaveAttribute("data-mw-hover");
    expect(grid.style.cursor).toBe("text");

    // Press: data-mw-active while held (bypasses the hover-capability
    // gate — touch has :active). Like native :active it drops when the
    // held pointer leaves the pressed element, returns on re-entry,
    // and clears on release.
    host.dispatchEvent(
      new PointerEvent("pointerdown", { ...at(press), bubbles: true, isPrimary: true, button: 0 }),
    );
    await waitFor(() => expect(press).toHaveAttribute("data-mw-active"), { timeout: 10_000 });
    expect(getComputedStyle(press).color).not.toBe(getComputedStyle(tile).color);
    host.dispatchEvent(new PointerEvent("pointermove", { ...at(tile), bubbles: true }));
    await waitFor(() => expect(press).not.toHaveAttribute("data-mw-active"), { timeout: 10_000 });
    host.dispatchEvent(new PointerEvent("pointermove", { ...at(press), bubbles: true }));
    await waitFor(() => expect(press).toHaveAttribute("data-mw-active"), { timeout: 10_000 });
    host.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, isPrimary: true }));
    await waitFor(() => expect(press).not.toHaveAttribute("data-mw-active"), { timeout: 10_000 });

    // Leaving the host clears hover; select="text" gates the synthesis
    // off entirely (native states own that mode).
    host.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    await waitFor(() => expect(tile).not.toHaveAttribute("data-mw-hover"), { timeout: 10_000 });
    host.setAttribute("select", "text");
    host.dispatchEvent(new PointerEvent("pointermove", { ...at(tile), bubbles: true }));
    expect(tile).not.toHaveAttribute("data-mw-hover");
    host.setAttribute("select", "grid");
  },
};
