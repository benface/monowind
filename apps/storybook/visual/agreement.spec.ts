import { expect, test } from "@playwright/test";
import { openStory, storyIndex } from "./helpers.ts";

/**
 * The browser places some engine-sized boxes itself — an atomic inline
 * box in its line, a mixed container's flow child, a float — trusting
 * the engine's cells to make its layout agree (specs/cell-model.md).
 * Where it does not, the grid draws the box in one place and the
 * element the pointer, the caret and the reader reach sits in another.
 * Every story, in all three engines: each such box's element lies on
 * the cells the engine gave it, within half a cell.
 *
 * Measured against the box's parent element, so it is skipped where the
 * parent is no element's box: an inline box in an anonymous run (a
 * mixed container's text, a flex or grid container's bare text), or in
 * a transformed layer, which the browser draws off the cells on
 * purpose.
 */
const stories = storyIndex();

for (const story of stories) {
  test(story.id, async ({ page }) => {
    await openStory(page, story.id);
    await page.waitForTimeout(150);
    const drifts = await page.evaluate(() => {
      const found: string[] = [];
      for (const host of document.querySelectorAll<HTMLElement>("mono-wind:not(mono-wind *)")) {
        const hostStyle = getComputedStyle(host);
        const cellWidth = parseFloat(hostStyle.getPropertyValue("--mw-cw"));
        const cellHeight = parseFloat(hostStyle.getPropertyValue("--mw-ch"));
        const grid = host.shadowRoot!.getElementById("grid")!.getBoundingClientRect();
        const boxes = host.querySelectorAll<HTMLElement>(
          "[data-mw-inline-box], [data-mw-flow], [data-mw-float]",
        );
        for (const box of boxes) {
          const rect = box.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          const parent = box.parentElement!.closest<HTMLElement>(
            "[data-mw-laid-out], [data-mw-inline-box], [data-mw-flow], [data-mw-float], mono-wind",
          )!;
          if (box.hasAttribute("data-mw-inline-box")) {
            const inRun =
              /flex|grid/.test(getComputedStyle(parent).display) ||
              [...parent.children].some((child) =>
                child.matches(
                  parent === host
                    ? "[data-mw-laid-out], [data-mw-flow], [data-mw-float]"
                    : "[data-mw-flow], [data-mw-float]",
                ),
              );
            if (inRun) continue;
          }
          let transformed = false;
          for (let at: Element | null = box; at && at !== host; at = at.parentElement) {
            const style = getComputedStyle(at);
            if (
              [style.transform, style.translate, style.rotate, style.scale].some(
                (value) => value !== "none",
              )
            ) {
              transformed = true;
            }
          }
          if (transformed) continue;
          // A relative offset — a half-leading lift, a sticky shift — is
          // the engine's own, part of where it puts the box; the parent's
          // own lift is undone, the cells counting from its engine box.
          const style = getComputedStyle(box);
          const offsetX = parseFloat(style.left) || 0;
          const offsetY = parseFloat(style.top) || 0;
          const parentLift =
            parent === host
              ? 0
              : (parseFloat(getComputedStyle(parent).getPropertyValue("--mw-lhs")) || 0) *
                cellHeight;
          const origin = parent === host ? grid : parent.getBoundingClientRect();
          const scrollX = parent === host ? 0 : parent.scrollLeft;
          const scrollY = parent === host ? 0 : parent.scrollTop;
          const x = parseFloat(box.style.getPropertyValue("--mw-x")) || 0;
          const y = parseFloat(box.style.getPropertyValue("--mw-y")) || 0;
          const dx = (rect.left - (origin.left - scrollX + x * cellWidth + offsetX)) / cellWidth;
          const dy =
            (rect.top - (origin.top - parentLift - scrollY + y * cellHeight + offsetY)) /
            cellHeight;
          if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
            const name = box.dataset["test"] ?? (box.textContent ?? "").trim().slice(0, 24);
            found.push(
              `<${box.tagName.toLowerCase()}> "${name}": ${dx.toFixed(2)} cells across, ${dy.toFixed(2)} down`,
            );
          }
        }
      }
      return found;
    });
    expect(drifts, "boxes off their cells").toEqual([]);
  });
}
