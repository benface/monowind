import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";

/**
 * Arrow-key focus navigation (specs/focus-navigation.md): under
 * `focus="arrows"` an unmodified arrow moves focus to the nearest
 * focusable element beyond that edge on the grid, controls keep the
 * arrows they use, and a scrolled-away target is revealed. The default
 * host leaves every arrow native. Hidden from the sidebar and the
 * story sweep.
 */
const meta: Meta = {
  title: "Test / Focus",
  tags: ["!dev"],
};
export default meta;

export const Arrows: StoryObj = {
  render: () => html`
    <mono-wind focus="arrows" data-test="arrows">
      <div class="flex gap-4">
        <div class="grid w-24 grid-cols-2 gap-x-2 gap-y-1">
          <button data-test="b1">one</button>
          <button data-test="b2">two</button>
          <button data-test="b3">three</button>
          <button data-test="b4">four</button>
          <button data-test="b5">five</button>
          <button data-test="b6">six</button>
        </div>
        <div class="flex w-48 flex-col gap-1">
          <p data-test="para">
            See <a data-test="l1" href="#">this</a> and <a data-test="l2" href="#">that</a> or
            <a data-test="l3" href="#">a link that wraps around the line end</a>
          </p>
          <input data-test="input" class="w-20 border" value="text" />
          <textarea data-test="textarea" class="w-20 border" rows="2">two lines</textarea>
          <select data-test="select" class="w-20 border">
            <option>alpha</option>
            <option>beta</option>
          </select>
          <div class="flex gap-2">
            <label><input data-test="r1" type="radio" name="r" checked /> r1</label>
            <label><input data-test="r2" type="radio" name="r" /> r2</label>
          </div>
          <select data-test="listbox" size="2" class="border">
            <option>x</option>
            <option>y</option>
          </select>
          <div data-test="editable" contenteditable tabindex="0" class="border">edit me</div>
          <div data-test="scroller" class="h-3 w-20 overflow-y-auto border">
            <div class="flex flex-col">
              <button data-test="s1">s1</button>
              <button data-test="s2">s2</button>
              <button data-test="s3">s3</button>
              <button data-test="s4">s4</button>
              <button data-test="s5">s5</button>
            </div>
          </div>
        </div>
      </div>
    </mono-wind>
    <mono-wind data-test="tab" class="mt-2">
      <div class="flex gap-2">
        <button data-test="t1">t1</button>
        <button data-test="t2">t2</button>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const hosts = canvasElement.querySelectorAll<HTMLElement>("mono-wind");
    for (const host of hosts) {
      await waitFor(() => expect(host).toHaveAttribute("data-mw-ready"), { timeout: 10_000 });
    }
    const by = (name: string) => canvasElement.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
    const active = () => document.activeElement?.getAttribute("data-test") ?? null;
    // A keydown on the focused element; true when the engine left it native.
    const press = (key: string, init: KeyboardEventInit = {}): boolean =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          composed: true,
          cancelable: true,
          ...init,
        }),
      );
    const arrow = (name: string, key: string) => {
      by(name).focus();
      const native = press(key);
      return { to: active(), native };
    };

    // The default is reflected; the button grid navigates spatially and
    // stops at its edges.
    expect(by("arrows")).toHaveAttribute("focus", "arrows");
    expect(by("tab")).toHaveAttribute("focus", "tab");
    expect(arrow("b1", "ArrowRight")).toEqual({ to: "b2", native: false });
    expect(arrow("b1", "ArrowDown")).toEqual({ to: "b3", native: false });
    expect(arrow("b4", "ArrowLeft")).toEqual({ to: "b3", native: false });
    expect(arrow("b4", "ArrowUp")).toEqual({ to: "b2", native: false });
    expect(arrow("b1", "ArrowLeft")).toEqual({ to: "b1", native: true });
    expect(arrow("b1", "ArrowUp")).toEqual({ to: "b1", native: true });
    // Links inside a paragraph are candidates at their cells: the next
    // link on the line, the wrapped one below.
    expect(arrow("l1", "ArrowRight")).toEqual({ to: "l2", native: false });
    expect(arrow("l1", "ArrowDown")).toEqual({ to: "l3", native: false });
    // Controls keep the arrows they use.
    expect(arrow("input", "ArrowRight")).toEqual({ to: "input", native: true });
    expect(arrow("input", "ArrowDown")).toEqual({ to: "textarea", native: false });
    expect(arrow("textarea", "ArrowDown")).toEqual({ to: "textarea", native: true });
    expect(arrow("select", "ArrowDown")).toEqual({ to: "r1", native: false });
    expect(arrow("r1", "ArrowRight")).toEqual({ to: "r1", native: true });
    expect(arrow("listbox", "ArrowDown")).toEqual({ to: "listbox", native: true });
    expect(arrow("editable", "ArrowUp")).toEqual({ to: "editable", native: true });
    // A modifier makes any arrow native.
    by("b1").focus();
    expect(press("ArrowRight", { shiftKey: true })).toBe(true);
    expect(active()).toBe("b1");
    // Down through a scroll container reaches the item past the fold
    // and reveals it.
    const scroller = by("scroller");
    expect(scroller.scrollTop).toBe(0);
    expect(arrow("s1", "ArrowDown")).toEqual({ to: "s2", native: false });
    expect(arrow("s3", "ArrowDown")).toEqual({ to: "s4", native: false });
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
    // The default host leaves every arrow native; Tab stays native in both.
    expect(arrow("t1", "ArrowRight")).toEqual({ to: "t1", native: true });
    expect(press("Tab")).toBe(true);
    by("b1").focus();
    expect(press("Tab")).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();
  },
};
