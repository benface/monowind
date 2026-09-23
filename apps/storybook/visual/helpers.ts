import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

/**
 * A story at rest: every host laid out (a nested one never is), the
 * story's own play function done — a play that clicks, presses, scrolls
 * or relayouts must not be caught mid-way, and a slow machine makes
 * that likely — and its fonts loaded.
 */
export async function openStory(page: Page, id: string, globals?: string): Promise<void> {
  await page.goto(`/iframe.html?id=${id}&viewMode=story${globals ? `&globals=${globals}` : ""}`);
  await page.waitForFunction(() => {
    const hosts = [...document.querySelectorAll("mono-wind:not(mono-wind *)")];
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
}

/**
 * Resolves once no host has laid out for `quiet` ms, so the next input
 * or read lands on a layout nothing is about to redo. A pass raises
 * and lowers the host's `measuring` flag, which is the signal; a host
 * still laying out after `limit` ms fails the wait, saying so.
 */
export async function engineQuiet(page: Page, quiet = 150, limit = 10_000): Promise<void> {
  await page.evaluate(
    async ([quietMs, limitMs]) => {
      let passes = 0;
      const observer = new MutationObserver(() => passes++);
      for (const host of document.querySelectorAll("mono-wind")) {
        observer.observe(host, { attributes: true, attributeFilter: ["measuring"] });
      }
      const until = performance.now() + limitMs;
      try {
        do {
          if (performance.now() > until) {
            throw new Error(`a host kept laying out for ${limitMs} ms`);
          }
          passes = 0;
          await new Promise((resolve) => setTimeout(resolve, quietMs));
        } while (passes > 0);
      } finally {
        observer.disconnect();
      }
    },
    [quiet, limit] as const,
  );
}

/** The built Storybook's stories, from its index.json. */
export function storyIndex(): { id: string; tags: string[] }[] {
  const index = JSON.parse(
    readFileSync(new URL("../storybook-static/index.json", import.meta.url), "utf8"),
  ) as { entries: Record<string, { type: string; id: string; tags: string[] }> };
  return Object.values(index.entries).filter((entry) => entry.type === "story");
}
