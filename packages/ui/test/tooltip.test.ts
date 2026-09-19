import * as Tooltip from "@zag-js/tooltip";
import { normalizeProps } from "@zag-js/vanilla";
import { expect, it } from "vitest";
import { api, props, tooltip } from "../src/tooltip.ts";
import { start } from "../src/vanilla.ts";
import { by, settle } from "./helpers.ts";

/** The tooltip on the grid (specs/ui.md): placed above or below its
 * trigger, and the vanilla mount over marked markup. */

it("places the tooltip under its trigger unless asked otherwise", () => {
  const gridProps = props({ id: "t" });
  const machine = start(Tooltip.machine, gridProps);
  const grid = api(Tooltip.connect(machine.service, normalizeProps), normalizeProps, gridProps);
  expect(grid.getPositionerProps()["style"]["positionArea"]).toBe("bottom");
  expect(grid.getContentProps()).not.toHaveProperty("hidden");
  machine.stop();
});

it("wires the parts, the trigger described by the content", async () => {
  const root = document.createElement("div");
  root.innerHTML = `
    <button data-part="trigger">save</button>
    <div data-part="positioner"><div data-part="content">Saves</div></div>`;
  document.body.append(root);
  const mounted = tooltip(root, { id: "hint", positioning: { placement: "top" } });
  await settle();
  expect(by(root, "content").getAttribute("role")).toBe("tooltip");
  expect(by(root, "positioner").style.getPropertyValue("position-area")).toBe("top");
  mounted.api.setOpen(true);
  await settle();
  expect(by(root, "trigger").getAttribute("aria-describedby")).toBe(by(root, "content").id);
  mounted.destroy();
  root.remove();
});
