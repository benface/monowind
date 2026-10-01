import { describe, expect, it } from "vitest";
import { accordion } from "../src/accordion.ts";
import { collapsible } from "../src/collapsible.ts";
import { combobox } from "../src/combobox.ts";
import { dialog } from "../src/dialog.ts";
import { listbox } from "../src/listbox.ts";
import { menu } from "../src/menu.ts";
import { select } from "../src/select.ts";
import { by, settle } from "./helpers.ts";

/** The vanilla mount's destroy (specs/ui.md): the markup back as the
 * author wrote it, but for what the reader chose and what the page
 * changed since. */

const markup = (html: string): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

const LIST = `
  <div data-part="content">
    <div data-part="item" data-value="main"><span data-part="item-text">main</span></div>
    <div data-part="item" data-value="next"><span data-part="item-text">next</span></div>
  </div>`;

const FAQ = ["a", "b"]
  .map(
    (value) => `
      <div data-part="item" data-value="${value}">
        <button data-part="item-trigger">${value}</button>
        <div data-part="item-content">${value} body</div>
      </div>`,
  )
  .join("");

describe("the destroy", () => {
  it("puts the markup back as it was written", async () => {
    const root = markup(`
      <button data-part="trigger" class="px-1">More</button>
      <div data-part="content" id="own">Folded</div>`);
    const written = root.outerHTML;
    const mounted = collapsible(root, { id: "c" });
    await settle();
    by(root, "trigger").click();
    await settle();
    expect(root.outerHTML).not.toBe(written);
    mounted.destroy();
    expect(root.outerHTML).toBe(written);
    root.remove();
  });

  it("puts an inline style back, the author's own properties kept", async () => {
    const root = markup(`
      <button data-part="trigger">File</button>
      <div data-part="positioner" style="color: red"><div data-part="content"></div></div>`);
    const mounted = menu(root, { id: "m", positioning: { gutter: 6 } });
    await settle();
    const positioner = by(root, "positioner");
    expect(positioner.style.marginTop).toBe("1.5rem");
    mounted.destroy();
    expect(positioner.style.marginTop).toBe("");
    expect(positioner.style.color).toBe("red");
    expect(positioner.style.length).toBe(1);
    root.remove();
  });

  it("leaves a mount again on other props none of the last one's state", async () => {
    const root = markup(`<div id="own-root">${LIST}</div>`).firstElementChild as HTMLElement;
    const mounted = listbox(root, { id: "l" });
    await settle();
    mounted.api.highlightValue("next");
    await settle();
    const content = by(root, "content");
    expect(content.getAttribute("aria-activedescendant")).toBe("listbox:l:item:next");
    mounted.destroy();
    const again = listbox(root, { id: "l2" });
    await settle();
    expect(again.api.highlightedValue).toBe(null);
    expect(content.hasAttribute("aria-activedescendant")).toBe(false);
    again.destroy();
    root.parentElement!.remove();
  });

  it("leaves what the page changed since the mount wrote it", async () => {
    const list = markup(LIST);
    const next = by(list, "item", "next");
    next.setAttribute("data-disabled", "");
    const mounted = listbox(list, { id: "d" });
    await settle();
    // Enabled by the page, for a mount again to read.
    next.removeAttribute("data-disabled");
    mounted.destroy();
    expect(next.hasAttribute("data-disabled")).toBe(false);
    list.remove();
  });

  it("keeps what the reader typed", async () => {
    const root = markup(`
      <div data-part="control"><input data-part="input" /></div>
      <div data-part="positioner"><div data-part="content">
        <div data-part="item" data-value="main"><span data-part="item-text">main</span></div>
      </div></div>`);
    const mounted = combobox(root, { id: "t" });
    await settle();
    const input = by(root, "input") as HTMLInputElement;
    input.value = "ma";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    mounted.destroy();
    expect(input.value).toBe("ma");
    root.remove();
  });

  it("keeps the markers a mount again reads: a list's selection, an accordion's open items", async () => {
    const list = markup(LIST);
    const mountedList = listbox(list, { id: "s" });
    await settle();
    mountedList.api.setValue(["next"]);
    await settle();
    mountedList.destroy();
    const listAgain = listbox(list, { id: "s" });
    await settle();
    expect(listAgain.api.value).toEqual(["next"]);
    listAgain.destroy();
    list.remove();

    const faq = markup(FAQ);
    const mountedFaq = accordion(faq, { id: "f" });
    await settle();
    mountedFaq.api.setValue(["b"]);
    await settle();
    mountedFaq.destroy();
    const faqAgain = accordion(faq, { id: "f" });
    await settle();
    expect(faqAgain.api.value).toEqual(["b"]);
    faqAgain.destroy();
    faq.remove();
  });
});

describe("the parts", () => {
  it('leave a component nested by script under a root marked `data-part="root"` its own', async () => {
    const root = markup(`
      <button data-part="trigger">Open</button>
      <div data-part="positioner"><div data-part="content">
        <div data-part="root" data-test="nested">
          <button data-part="trigger" data-test="pick">Pick</button>
          <div data-part="positioner"><div data-part="content">
            <div data-part="item" data-value="a"><span data-part="item-text">a</span></div>
          </div></div>
        </div>
      </div></div>`);
    const outer = dialog(root, { id: "d" });
    const nested = select(root.querySelector('[data-test="nested"]')!, { id: "s" });
    await settle();
    // Each renders after the other: a part both took would end the
    // dialog's.
    outer.api.setOpen(true);
    await settle();
    outer.api.setOpen(false);
    await settle();
    const pick = root.querySelector<HTMLElement>('[data-test="pick"]')!;
    expect(pick.getAttribute("aria-controls")).toBe("select:s:content");
    pick.click();
    await settle();
    expect(outer.api.open).toBe(false);
    nested.destroy();
    outer.destroy();
    root.remove();
  });
});
