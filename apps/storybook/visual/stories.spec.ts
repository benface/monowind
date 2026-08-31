import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * One screenshot test per story, discovered from the built Storybook's
 * index.json — new stories are covered automatically. Test-only stories
 * (`tags: ["!dev"]`, hidden from the sidebar) are skipped like Storybook
 * itself skips them.
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
  (entry) => entry.type === "story" && entry.tags.includes("dev"),
);

for (const story of stories) {
  test(story.id, async ({ page }) => {
    // Pin `select=text`: both modes render identically, but the visible
    // cursor differs (text-select over the grid in `select=grid`) and
    // that would flicker some goldens.
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=select:text`);
    // Wait for every <mono-wind> to finish its first layout, then for fonts
    // (a late font load triggers a relayout), then one more settle frame.
    await page.waitForFunction(() => {
      const hosts = [...document.querySelectorAll("mono-wind")];
      return hosts.length > 0 && hosts.every((host) => host.hasAttribute("data-mw-ready"));
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await expect(page).toHaveScreenshot(`${story.id}.png`, { fullPage: true });
  });
}
