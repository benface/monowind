import { configure } from "storybook/test";
import { beforeEach } from "vitest";
import { commands, page } from "vitest/browser";

declare module "vitest/browser" {
  interface BrowserCommands {
    movePointerOffPage: () => Promise<void>;
  }
}

/** A wait that needs the engine's next layout can outlast testing
 * library's one-second default on a starved browser (three engines run
 * at once); the test timeout still bounds a wait that never resolves. */
configure({ asyncUtilTimeout: 10_000 });

/** Vitest 5's browser default is a mobile viewport (414×896); every
 * play that measures rendered width or wraps text needs a desktop
 * width. */
beforeEach(async () => {
  await page.viewport(1200, 900);
});

/** Chromium on Linux rests the pointer at the page's top-left, over a
 * story's first host, whose hover lays it out again: moved off the page. */
beforeEach(() => commands.movePointerOffPage());

/** Silence lit's dev-mode banner: the test server serves the dev build
 * by design, and the line would otherwise repeat for every story file. */
const NOISE = [/Lit is in dev mode/];

const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (NOISE.some((pattern) => typeof args[0] === "string" && pattern.test(args[0]))) return;
  warn(...args);
};
