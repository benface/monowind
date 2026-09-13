import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * One screenshot test per story tagged `golden`, discovered from the
 * built Storybook's index.json — the preview gives every story the
 * tag, so new stories are covered automatically, and a story opts out
 * with `!golden`: the test-only fixtures (`!dev`, hidden from the
 * sidebar) whose state is not a picture, and a visible story that runs
 * forever. A hidden fixture whose resting state is worth a screenshot
 * keeps the tag.
 */
interface IndexEntry {
  type: string;
  id: string;
  tags: string[];
}

const index = JSON.parse(
  readFileSync(new URL("../storybook-static/index.json", import.meta.url), "utf8"),
) as { entries: Record<string, IndexEntry> };

const stories = Object.values(index.entries).filter(
  (entry) => entry.type === "story" && entry.tags.includes("golden"),
);

for (const story of stories) {
  test(story.id, async ({ page }) => {
    // Pin `select=text`: both modes render identically, but the visible
    // cursor differs (text-select over the grid in `select=grid`) and
    // that would flicker some goldens.
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=select:text`);
    // Wait for every <mono-wind> to finish its first layout, for the
    // story's play function to finish (a play that scrolls or dispatches
    // events must not be caught mid-way), then for fonts (a late font
    // load triggers a relayout), then one more settle frame.
    await page.waitForFunction(() => {
      const hosts = [...document.querySelectorAll("mono-wind")];
      return hosts.length > 0 && hosts.every((host) => host.hasAttribute("data-mw-ready"));
    });
    await page.waitForFunction(() => {
      const preview = (window as { __STORYBOOK_PREVIEW__?: { storyRenders: { phase: string }[] } })
        .__STORYBOOK_PREVIEW__;
      return preview?.storyRenders.every((render) =>
        ["finished", "errored", "aborted"].includes(render.phase),
      );
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await expect(page).toHaveScreenshot(`${story.id}.png`, { fullPage: true });
  });
}
