import { syncTopLayer } from "../src/top-layer.ts";
import { expect, it } from "vitest";
import { popoverApi } from "./helpers.ts";

/** The positioner's popover follows the machine (specs/ui.md); the
 * popover API and the animations stubbed where the DOM has none. */
const positioner = () => {
  const element = document.createElement("div");
  document.body.append(element);
  return popoverApi(element);
};

const tick = () => new Promise((resolve) => setTimeout(resolve));

it("shows the popover as the machine opens and hides it as it closes", () => {
  const popover = positioner();
  syncTopLayer(popover.element, true);
  expect(popover.isOpen()).toBe(true);
  syncTopLayer(popover.element, true);
  syncTopLayer(popover.element, false);
  expect(popover.isOpen()).toBe(false);
});

it("waits for the exit's animations, unless a reopen supersedes the hide", async () => {
  const popover = positioner();
  syncTopLayer(popover.element, true);
  popover.animate();
  syncTopLayer(popover.element, false);
  expect(popover.isOpen()).toBe(true);
  popover.end();
  await tick();
  expect(popover.isOpen()).toBe(false);
  syncTopLayer(popover.element, true);
  popover.animate();
  syncTopLayer(popover.element, false);
  syncTopLayer(popover.element, true);
  popover.end();
  await tick();
  expect(popover.isOpen()).toBe(true);
});

it("hides at once past an animation that never ends, or is paused", async () => {
  const popover = positioner();
  syncTopLayer(popover.element, true);
  popover.animate({ endTime: Infinity });
  syncTopLayer(popover.element, false);
  await tick();
  expect(popover.isOpen()).toBe(false);
  popover.end();
  syncTopLayer(popover.element, true);
  popover.animate({ playState: "paused" });
  syncTopLayer(popover.element, false);
  await tick();
  expect(popover.isOpen()).toBe(false);
});

it("takes the focus out of the positioner as it closes, before the exit ends", () => {
  const popover = positioner();
  const button = document.createElement("button");
  popover.element.append(button);
  syncTopLayer(popover.element, true);
  button.focus();
  expect(document.activeElement).toBe(button);
  popover.animate();
  syncTopLayer(popover.element, false);
  expect(document.activeElement).not.toBe(button);
  expect(popover.isOpen()).toBe(true);
  popover.end();
});

it("does nothing for no element, one not yet connected, or a DOM without popovers", () => {
  syncTopLayer(null, true);
  const detached = popoverApi(document.createElement("div"));
  syncTopLayer(detached.element, true);
  expect(detached.isOpen()).toBe(false);
  const plain = document.createElement("div");
  document.body.append(plain);
  expect("showPopover" in plain).toBe(false);
  syncTopLayer(plain, true);
});
