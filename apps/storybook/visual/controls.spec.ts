import { expect, test, type Page } from "@playwright/test";
import { hook, openStory } from "./helpers.ts";

/** The story's args changed as the Controls panel changes them. */
const updateArgs = (page: Page, storyId: string, updatedArgs: Record<string, unknown>) =>
  page.evaluate(
    (update) =>
      (
        window as {
          __STORYBOOK_PREVIEW__?: { onUpdateArgs(update: object): Promise<void> };
        }
      ).__STORYBOOK_PREVIEW__!.onUpdateArgs(update),
    { storyId, updatedArgs },
  );

/**
 * A control reaches the running component (stories/controls.ts). The
 * re-render also renders a detached copy of the story for the Code
 * panel, which must leave the vanilla mount on the live markup: a mount
 * taken over and put back would start from the story's first args, the
 * last one's inline styles left behind.
 */
test("a control reaches the Menu story's running mount, a zero offset its gutter too", async ({
  page,
}) => {
  await openStory(page, "packages-ui--menu");
  const margin = () =>
    page
      .locator(hook("positioner"))
      .evaluate((element) => (element as HTMLElement).style.marginTop);
  await updateArgs(page, "packages-ui--menu", { "offset-main-axis": 6 });
  await expect.poll(margin).toBe("1.5rem");
  await updateArgs(page, "packages-ui--menu", { "offset-main-axis": 0 });
  await expect.poll(margin).toBe("");
});
