import { spawnSync } from "node:child_process";

/**
 * The shared body of the framework example smoke tests: build, serve,
 * and drive the ownership loop, plus the menu and dialog from the
 * framework's @monowind/ui bindings where it has them (`ui`). The
 * caller passes its own `chromium` and `createServer` (resolved from
 * the app's own deps), its directory, and its name.
 */
export async function runFrameworkSmoke({ name, dir, chromium, createServer, ui = true }) {
  const build = spawnSync("pnpm", ["exec", "vite", "build"], {
    cwd: dir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (build.status !== 0) {
    console.error(`${name} smoke test FAILED: vite build failed`);
    process.exit(1);
  }

  const server = await createServer({ root: dir, server: { port: 0 } });
  await server.listen();
  const url = server.resolvedUrls.local[0];

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(url);
  await page.waitForSelector("mono-wind[data-mw-ready]");

  // The ownership loop: clicking the button updates framework state, the
  // framework rewrites the text, monowind observes the mutation and
  // relayouts without disturbing the framework.
  await page.click("button");
  await page.click("button");
  await page.waitForFunction(() => document.body.textContent?.includes("count is 2"));

  const result = await page.evaluate(() => {
    const container = document.querySelector("mono-wind > div");
    const style = container?.getAttribute("style") ?? "";
    const grid = document.querySelector("mono-wind")?.shadowRoot?.getElementById("grid");
    return {
      laidOut: /--mw-w: \d+/.test(style),
      minHeightApplied: Number(style.match(/--mw-h: (\d+)/)?.[1] ?? 0) >= 5,
      hasBorderGlyphs: (grid?.textContent ?? "").includes("┌"),
      tailwindRan: getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)",
      stateFlowedThrough: document.body.textContent?.includes("count is 2") ?? false,
    };
  });

  if (ui) {
    // The menu from @monowind/ui: opened under its button in the top
    // layer, an item picked; the dialog opened in the top layer and
    // dismissed.
    await page.click('button[aria-haspopup="menu"]');
    await page.waitForSelector('[data-part="positioner"]:popover-open[data-mw-area]');
    result.menuUnderButton = await page.evaluate(() => {
      const trigger = document
        .querySelector('button[aria-haspopup="menu"]')
        .getBoundingClientRect();
      const positioner = document
        .querySelector('[data-part="positioner"]:popover-open')
        .getBoundingClientRect();
      return (
        Math.abs(positioner.top - trigger.bottom) < 1 &&
        Math.abs(positioner.left - trigger.left) < 1
      );
    });
    await page.click('[role="menuitem"][data-value="open"]');
    await page.waitForFunction(() => document.body.textContent?.includes("picked open"));
    result.menuPicked = await page.evaluate(
      () => document.body.textContent?.includes("picked open") ?? false,
    );
    await page.click('button[aria-haspopup="dialog"]');
    await page.waitForSelector(
      '[data-part="positioner"]:popover-open [role="dialog"][data-state="open"]',
    );
    await page.keyboard.press("Escape");
    await page.waitForSelector('[role="dialog"][data-state="closed"]', {
      state: "attached",
    });
  }

  await browser.close();
  await server.close();

  const failures = Object.entries(result).filter(([, ok]) => !ok);
  if (failures.length > 0) {
    console.error(`${name} smoke test FAILED:`, JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(`${name} smoke test passed:`, JSON.stringify(result));
}
