import { expect, test } from "@playwright/test";
import { openStory, storyIndex } from "./helpers.ts";

/**
 * One screenshot test per story tagged `golden`, discovered from the
 * built Storybook's index.json — the preview gives every story the
 * tag, so new stories are covered automatically, and a story opts out
 * with `!golden`: the test-only fixtures (`!dev`, hidden from the
 * sidebar) whose state is not a picture, and a visible story that runs
 * forever. A hidden fixture whose resting state is worth a screenshot
 * keeps the tag.
 */
const stories = storyIndex().filter((entry) => entry.tags.includes("golden"));

for (const story of stories) {
  test(story.id, async ({ page }) => {
    // Pin `select=text`: both modes render identically, but the visible
    // cursor differs (text-select over the grid in `select=grid`) and
    // that would flicker some goldens. The story at rest, then one more
    // settle frame.
    await openStory(page, story.id, "select:text");
    await page.waitForTimeout(150);
    await expect(page).toHaveScreenshot(`${story.id}.png`, { fullPage: true });
  });
}
