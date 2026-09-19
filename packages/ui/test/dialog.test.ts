import * as Dialog from "@zag-js/dialog";
import { expect, it } from "vitest";
import { normalizeProps } from "@zag-js/vanilla";
import { api, dialog, props } from "../src/dialog.ts";
import { popover } from "../src/popover.ts";
import { start } from "../src/vanilla.ts";
import { by, settle } from "./helpers.ts";

/** The dialog and the popover on the grid (specs/ui.md): the
 * positioner a manual popover, and the titled parts the two share
 * wired on the markup. */

const markup = () => {
  const root = document.createElement("div");
  root.innerHTML = `
    <button data-part="trigger">open</button>
    <div data-part="positioner">
      <div data-part="content">
        <p data-part="title">Title</p>
        <p data-part="description">Description</p>
        <button data-part="close-trigger">close</button>
      </div>
    </div>`;
  document.body.append(root);
  return root;
};

it("gives the dialog's positioner the popover, and the content its title and description", () => {
  const gridProps = props({ id: "d" });
  const machine = start(Dialog.machine, gridProps);
  const grid = api(Dialog.connect(machine.service, normalizeProps), normalizeProps, gridProps);
  expect(grid.getPositionerProps()["popover"]).toBe("manual");
  expect(grid.getPositionerProps()).not.toHaveProperty("style");
  expect(grid.getContentProps()).not.toHaveProperty("hidden");
  expect(grid.getContentProps()["aria-labelledby"]).toBe(grid.getTitleProps()["id"]);
  machine.stop();
});

for (const [name, mountOn] of [
  ["dialog", dialog],
  ["popover", popover],
] as const) {
  it(`wires the ${name}'s titled parts, the close trigger closing it`, async () => {
    const root = markup();
    const mounted = mountOn(root, { id: name });
    await settle();
    expect(by(root, "content").getAttribute("role")).toBe("dialog");
    expect(by(root, "content").getAttribute("aria-labelledby")).toBe(by(root, "title").id);
    expect(by(root, "content").getAttribute("aria-describedby")).toBe(by(root, "description").id);
    expect(by(root, "positioner").getAttribute("popover")).toBe("manual");
    mounted.api.setOpen(true);
    await settle();
    expect(mounted.api.open).toBe(true);
    by(root, "close-trigger").click();
    await settle();
    expect(mounted.api.open).toBe(false);
    mounted.destroy();
    root.remove();
  });
}
