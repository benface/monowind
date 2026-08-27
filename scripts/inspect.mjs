#!/usr/bin/env node
/**
 * Load any page containing a <mono-wind> element in a real browser and
 * report:
 *   - console messages (log/warn/error)
 *   - page errors
 *   - failed network requests
 *   - a text dump of the <mono-wind> subtree with its own attrs + CSS vars
 *
 * A debugging/AX tool — point it at a running dev server (Storybook iframe,
 * an example app, …).
 * Usage: node scripts/inspect.mjs <url>   (BROWSER=chromium|firefox|webkit)
 */
import { chromium, firefox, webkit } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/inspect.mjs <url>");
  process.exit(1);
}
const browserName = process.env.BROWSER ?? "chromium";
const browserType = { chromium, firefox, webkit }[browserName];
if (!browserType) throw new Error(`Unknown BROWSER=${browserName} (chromium|firefox|webkit)`);
console.log(`Inspecting with ${browserName} at ${url}`);

const browser = await browserType.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const page = await context.newPage();

const consoleEntries = [];
page.on("console", (msg) => {
  consoleEntries.push({ type: msg.type(), text: msg.text(), location: msg.location() });
});
const pageErrors = [];
page.on("pageerror", (err) => {
  pageErrors.push({ message: err.message, stack: err.stack });
});
const failedRequests = [];
page.on("requestfailed", (req) => {
  failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
});

const response = await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(300);

const dump = await page.evaluate(() => {
  const host = document.querySelector("mono-wind");
  if (!host) return { error: "no <mono-wind> element found" };
  const styles = getComputedStyle(host);
  const attrs = {};
  for (const attr of host.getAttributeNames()) attrs[attr] = host.getAttribute(attr);
  const walk = (el) => {
    const rect = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const style = el.getAttribute("style") ?? "";
    return {
      tag: el.tagName.toLowerCase(),
      className: el.className || undefined,
      text: el.children.length === 0 ? el.textContent : undefined,
      style: style || undefined,
      dataMwLaidOut: el.hasAttribute("data-mw-laid-out"),
      computed: {
        display: s.display,
        position: s.position,
        left: s.left,
        top: s.top,
        width: s.width,
        height: s.height,
      },
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      children: [...el.children].map(walk),
    };
  };
  return {
    hostAttrs: attrs,
    hostSize: {
      w: Math.round(host.getBoundingClientRect().width),
      h: Math.round(host.getBoundingClientRect().height),
    },
    hostVars: {
      "--mw-cw": styles.getPropertyValue("--mw-cw"),
      "--mw-ch": styles.getPropertyValue("--mw-ch"),
    },
    shadowDecorations: host.shadowRoot?.getElementById("decorations")?.innerHTML ?? null,
    lightChildren: [...host.children].map(walk),
  };
});

const screenshot = await page.screenshot({ fullPage: true });
await browser.close();

console.log("HTTP status:", response?.status());
console.log();
console.log("=== Console (%d entries) ===", consoleEntries.length);
for (const e of consoleEntries)
  console.log(
    `[${e.type}] ${e.text}`,
    e.location?.url ? `(${e.location.url}:${e.location.lineNumber})` : "",
  );
console.log();
console.log("=== Page errors (%d) ===", pageErrors.length);
for (const e of pageErrors) console.log(`${e.message}\n${e.stack}`);
console.log();
console.log("=== Failed requests (%d) ===", failedRequests.length);
for (const r of failedRequests) console.log(`${r.url} — ${r.failure}`);
console.log();
console.log("=== DOM dump ===");
console.log(JSON.stringify(dump, null, 2));

const { writeFileSync } = await import("node:fs");
writeFileSync("/tmp/monowind-inspect.png", screenshot);
console.log("\nScreenshot written to /tmp/monowind-inspect.png (%d bytes)", screenshot.length);
