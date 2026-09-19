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
  const p = positioner();
  syncTopLayer(p.element, true);
  expect(p.isOpen()).toBe(true);
  syncTopLayer(p.element, true);
  syncTopLayer(p.element, false);
  expect(p.isOpen()).toBe(false);
});

it("waits for the exit's animations, unless a reopen supersedes the hide", async () => {
  const p = positioner();
  syncTopLayer(p.element, true);
  p.animate();
  syncTopLayer(p.element, false);
  expect(p.isOpen()).toBe(true);
  p.end();
  await tick();
  expect(p.isOpen()).toBe(false);
  syncTopLayer(p.element, true);
  p.animate();
  syncTopLayer(p.element, false);
  syncTopLayer(p.element, true);
  p.end();
  await tick();
  expect(p.isOpen()).toBe(true);
});

it("hides at once past an animation that never ends, or is paused", async () => {
  const p = positioner();
  syncTopLayer(p.element, true);
  p.animate({ endTime: Infinity });
  syncTopLayer(p.element, false);
  await tick();
  expect(p.isOpen()).toBe(false);
  p.end();
  syncTopLayer(p.element, true);
  p.animate({ playState: "paused" });
  syncTopLayer(p.element, false);
  await tick();
  expect(p.isOpen()).toBe(false);
});

it("takes the focus out of the positioner as it closes, before the exit ends", () => {
  const p = positioner();
  const button = document.createElement("button");
  p.element.append(button);
  syncTopLayer(p.element, true);
  button.focus();
  expect(document.activeElement).toBe(button);
  p.animate();
  syncTopLayer(p.element, false);
  expect(document.activeElement).not.toBe(button);
  expect(p.isOpen()).toBe(true);
  p.end();
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
