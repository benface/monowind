/**
 * The shared body of the CSS-framework example smoke tests. The engine
 * reads COMPUTED styles, so what wrote them does not matter: each app
 * styles its markup with a different tool and the grid lays the same
 * page out. The caller passes its own `chromium` and `createServer`
 * (resolved from the app's own deps), its directory, and its name.
 */
export async function runStylingSmoke({ name, dir, chromium, createServer }) {
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
  // The host is ready once the engine has laid the page out, which it
  // does whether or not the tool's stylesheet has landed: a dev server
  // that re-optimizes a dependency reloads the page mid-load, and the
  // first paint after can carry no border at all. The glyphs are the
  // signal that the styles reached the grid.
  // Polled rather than waited on: a cold dev server pre-bundles, then
  // RELOADS the page when it finds a dependency mid-load, which
  // destroys the execution context a `waitForFunction` is living in —
  // it never re-evaluates and the wait runs out. Each read stands on
  // its own, so a reload costs one poll.
  const deadline = Date.now() + 60_000;
  let painted = false;
  while (!painted && Date.now() < deadline) {
    try {
      painted = await page.evaluate(() =>
        (
          document.querySelector("mono-wind")?.shadowRoot?.getElementById("grid")?.textContent ?? ""
        ).includes("│"),
      );
    } catch {
      // The reload took the context; the next read gets the new one.
    }
    if (!painted) await page.waitForTimeout(250);
  }

  const result = await page.evaluate(() => {
    const host = document.querySelector("mono-wind");
    const grid = host?.shadowRoot?.getElementById("grid");
    const box = document.querySelector("[data-test='box']");
    const text = grid?.textContent ?? "";
    return {
      // The engine measured a box the framework sized and bordered.
      laidOut: /--mw-w: \d+/.test(box?.getAttribute("style") ?? ""),
      // A border the framework wrote is drawn as glyphs.
      bordered: text.includes("│"),
      // `--mw-border-glyphs`, which Tailwind reaches through
      // `borders-rounded`, is a custom property any tool can set.
      roundedCorners: text.includes("╭"),
      // The framework's own colour reached the grid's paint.
      coloured: (
        host?.shadowRoot?.querySelector("#grid span")?.getAttribute("style") ?? ""
      ).includes("color"),
      painted: text.includes("styled by"),
    };
  });

  await browser.close();
  await server.close();

  const failures = Object.entries(result).filter(([, ok]) => !ok);
  if (failures.length > 0) {
    console.error(`${name} smoke test FAILED:`, JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(`${name} smoke test passed:`, JSON.stringify(result));
}
