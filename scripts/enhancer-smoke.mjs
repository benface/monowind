/**
 * The shared body of the HTML-enhancer example smoke tests: serve the
 * app, open it, and drive a `<mono-*>` element the way the enhancer
 * does — attributes alone, no JavaScript in the page — then build it
 * and find every file the built page loads beside it. The caller
 * passes its own `chromium`, `createServer` and `build` (resolved from
 * the app's own deps), its directory, its name, a `drive` that asserts
 * what its enhancer did with the event the menu dispatched, and
 * `pick` where what it clicks in the item is not the item itself.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The text the engine painted, which every `drive` reads. */
const gridText = (page) =>
  page.evaluate(
    () =>
      document.querySelector("mono-wind")?.shadowRoot?.getElementById("grid")?.textContent ?? "",
  );

/** The text of the element each app logs its result into. */
const logText = (page) => page.evaluate(() => document.getElementById("log")?.textContent ?? "");

/** The grid painted again with what the enhancer wrote, a relayout
 * after the event. */
const waitForGrid = (page, text) =>
  page.waitForFunction(
    (wanted) =>
      document
        .querySelector("mono-wind")
        ?.shadowRoot?.getElementById("grid")
        ?.textContent?.includes(wanted),
    text,
  );

export async function runEnhancerSmoke({
  name,
  dir,
  chromium,
  createServer,
  build,
  drive,
  pick = '[role="menuitem"][data-value="next"]',
}) {
  const server = await createServer({ root: dir, server: { port: 0 } });
  await server.listen();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  // The first navigation waits on the dev server, which holds it while
  // it pre-bundles; the host's own ready flag is the real signal.
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("mono-wind[data-mw-ready]");

  const result = {
    // Any box the engine measured, whatever the page wraps its content
    // in.
    laidOut: (await page.$("mono-wind [style*='--mw-w']")) !== null,
    tailwindRan: await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)",
    ),
    gridPainted: (await gridText(page)).includes("A page"),
  };

  // The element mounts itself: its trigger carries Zag's roles before
  // anything on the page has run a line of its own.
  await page.waitForSelector('[data-part="trigger"][aria-haspopup]');
  result.elementMounted = true;

  // Opening the menu and picking an item is the same in all four; what
  // the enhancer then does with `itemselect` is the app's own.
  await page.click('button[data-part="trigger"]');
  await page.waitForSelector('[data-part="positioner"]:popover-open[data-mw-area]');
  await page.click(pick);
  Object.assign(
    result,
    await drive({
      gridText: () => gridText(page),
      logText: () => logText(page),
      waitForGrid: (text) => waitForGrid(page, text),
    }),
  );

  await browser.close();
  await server.close();

  // The same-origin URLs the built page loads — scripts, links,
  // fragments, Vite's own assets — each shipped with it.
  const outDir = mkdtempSync(join(tmpdir(), "monowind-example-"));
  try {
    await build({ root: dir, logLevel: "silent", build: { outDir, emptyOutDir: true } });
    const built = readFileSync(join(outDir, "index.html"), "utf8");
    const urls = [...built.matchAll(/(?:src|href|hx-get)="\.?\/(?!\/)([^"#?]+)"/g)].map(
      (m) => m[1],
    );
    result.buildShipsFiles = urls.length > 0 && urls.every((url) => existsSync(join(outDir, url)));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  const failures = Object.entries(result).filter(([, ok]) => !ok);
  if (failures.length > 0) {
    console.error(`${name} smoke test FAILED:`, JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(`${name} smoke test passed:`, JSON.stringify(result));
}
