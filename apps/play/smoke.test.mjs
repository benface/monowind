/**
 * Smoke test for the playground: load it from disk, verify the sample
 * renders through the engine, then type new content and verify the live
 * update, the select toggle, and the shareable hash round-trip.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const url = new URL("./index.html", import.meta.url).href;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
// The preview lives in an iframe now — wait for its mono-wind to be
// upgraded and ready before probing its shadow grid.
await page.waitForFunction(
  () =>
    document.getElementById("preview")?.contentDocument?.querySelector("mono-wind[data-mw-ready]"),
  null,
  { timeout: 10_000 },
);

const sampleRendered = await page.evaluate(() => {
  const grid = document
    .getElementById("preview")
    ?.contentDocument?.querySelector("mono-wind")
    ?.shadowRoot?.getElementById("grid");
  return (grid?.textContent ?? "").includes("┌") && (grid?.textContent ?? "").includes("│");
});

// The sample's <mono-ascii> masthead renders as art through the ascii
// CDN bundle: the semantic string stays in the light DOM only.
const asciiRendered = await page.evaluate(() => {
  const doc = document.getElementById("preview")?.contentDocument;
  const grid = doc?.querySelector("mono-wind")?.shadowRoot?.getElementById("grid");
  const banner = doc?.querySelector("mono-ascii");
  return banner?.textContent === "monowind" && !(grid?.textContent ?? "").includes("monowind");
});

// Live edit: replace the source and expect the grid to follow.
await page.fill("#source", '<div class="border border-cyan-400 px-1">EDITED</div>');
await page.waitForFunction(() => {
  const grid = document
    .getElementById("preview")
    ?.contentDocument?.querySelector("mono-wind")
    ?.shadowRoot?.getElementById("grid");
  return (grid?.textContent ?? "").includes("EDITED");
});

// The hash encodes the document; reloading it restores the edit.
await page.waitForFunction(() => location.hash.length > 1);
const hash = await page.evaluate(() => location.hash);
await page.goto(url + hash);
await page.waitForFunction(() => {
  const grid = document
    .getElementById("preview")
    ?.contentDocument?.querySelector("mono-wind")
    ?.shadowRoot?.getElementById("grid");
  return (grid?.textContent ?? "").includes("EDITED");
});
const restored = await page.evaluate(() =>
  /EDITED/.test(document.getElementById("source").value ?? ""),
);

// Theme switcher: class-scoped themes reach the iframe; selecting dos
// re-themes the preview host (bg, quantized palette) and persists in
// the query string.
await page.selectOption("#theme", "dos");
await page.waitForFunction(() => {
  const doc = document.getElementById("preview")?.contentDocument;
  const root = doc?.querySelector("mono-wind");
  if (!root?.classList.contains("theme-dos")) return false;
  const cs = doc.defaultView.getComputedStyle(root);
  return (
    cs.backgroundColor === "rgb(0, 0, 0)" &&
    cs.getPropertyValue("--color-red-500").trim() === "#ff5555"
  );
});
const themed = true;
const themeQueryPersisted = await page.evaluate(
  () => new URLSearchParams(location.search).get("theme") === "dos",
);
await page.selectOption("#theme", "");

// Grid selection is the default; the toggle switches to per-element text
// AND writes the state into the URL query so a shared link restores it.
await page.check("#select-text");
const selectMode = await page.evaluate(() =>
  document
    .getElementById("preview")
    .contentDocument.querySelector("mono-wind")
    .getAttribute("select"),
);
const selectQueryPersisted = await page.evaluate(() =>
  new URLSearchParams(location.search).get("select"),
);
// Fresh load with the query set: the toggle comes up checked and the
// preview attribute follows before first paint.
await page.goto(`${url}?select=text`);
await page.waitForFunction(
  () =>
    document
      .getElementById("preview")
      ?.contentDocument?.querySelector('mono-wind[select="text"][data-mw-ready]'),
  null,
  { timeout: 10_000 },
);
const selectRestored = await page.evaluate(() => document.getElementById("select-text").checked);
// The select-mode toggle lives in the header on desktop and reparents
// to the mobile slot (between the panels) when the viewport shrinks.
const desktopSlot = await page.evaluate(() =>
  document
    .getElementById("toggle-slot-desktop")
    .contains(document.getElementById("select-text-label")),
);
await page.setViewportSize({ width: 500, height: 800 });
await page.waitForFunction(() =>
  document
    .getElementById("toggle-slot-mobile")
    .contains(document.getElementById("select-text-label")),
);
const mobileSlot = true;

// The highlight layer mirrors the source with token spans.
const highlighted = await page.evaluate(() =>
  document.querySelector("#highlight code").innerHTML.includes('class="tok-tag"'),
);

// Sample round-trips through tidy unchanged — anything else means the
// default HTML would visibly change on the first Tidy click.
const sampleBefore = await page.evaluate(() => document.getElementById("source").value);
await page.evaluate(() => document.getElementById("tidy").click());
const sampleAfter = await page.evaluate(() => document.getElementById("source").value);
const sampleRoundTrips = sampleBefore.trim() === sampleAfter.trim();

// Tidy re-indents nested markup, sorts Tailwind classes into the
// canonical order, keeps comments, keeps phrasing content (inline
// elements + text) on one line, and re-escapes entities.
await page.fill(
  "#source",
  '<div class="rule-emerald-400 rule-y px-1 border flex mx-auto"><!-- keep --><div><p>a <em>b</em> &lt;c&gt;</p></div></div>',
);
await page.focus("#source");
await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
const tidied = await page.evaluate(() => document.getElementById("source").value);
// Sort covers monowind's own @utility rules (registered with the design
// system in cdn.ts) too — they'd otherwise be treated as unknown and
// float to the front. The paragraph mixes an inline element with text
// and an escaped entity; tidy keeps the phrasing on one line.
const tidyWorks =
  tidied.includes('class="mx-auto flex border px-1 rule-emerald-400 rule-y"') &&
  tidied.includes("<!-- keep -->") &&
  tidied.includes("\n  <div>\n    <p>a <em>b</em> &lt;c></p>\n  </div>\n</div>");

// Tab indents instead of leaving the editor: a multi-line selection
// shifts every line, Shift+Tab shifts them back, a bare caret inserts
// the indent unit.
await page.fill("#source", "a\nb");
await page.focus("#source");
await page.evaluate(() => document.getElementById("source").select());
await page.keyboard.press("Tab");
const indented = await page.evaluate(() => document.getElementById("source").value);
await page.keyboard.press("Shift+Tab");
const outdented = await page.evaluate(() => document.getElementById("source").value);
await page.evaluate(() => document.getElementById("source").setSelectionRange(0, 0));
await page.keyboard.press("Tab");
const caretIndented = await page.evaluate(() => document.getElementById("source").value);
const tabIndents = indented === "  a\n  b" && outdented === "a\nb" && caretIndented === "  a\nb";

// A short source still fills the pane, so a click below the last line
// lands in the textarea.
const editorFilled = await page.evaluate(() => {
  const editor = document.getElementById("editor");
  const source = document.getElementById("source");
  return Math.round(source.getBoundingClientRect().height) === editor.clientHeight;
});

// Synthesized pointer states reach the CDN path: rules.css (injected
// as text/tailwindcss) retargets the hover: variant to match
// data-mw-hover, so the in-browser compiler's output must too.
await page.fill("#source", '<div class="border px-1 hover:text-rose-400">HOVERME</div>');
await page.waitForFunction(() => {
  const grid = document
    .getElementById("preview")
    ?.contentDocument?.querySelector("mono-wind")
    ?.shadowRoot?.getElementById("grid");
  return (grid?.textContent ?? "").includes("HOVERME");
});
const hoverVariantCompiled = await page.evaluate(() => {
  const doc = document.getElementById("preview").contentDocument;
  const div = doc.querySelector("mono-wind div");
  const before = doc.defaultView.getComputedStyle(div).color;
  div.setAttribute("data-mw-hover", "");
  const after = doc.defaultView.getComputedStyle(div).color;
  div.removeAttribute("data-mw-hover");
  return before !== after;
});

// Lazy font loading needs same-origin fetch, which file:// forbids —
// serve the app for this one check. Typing font="slant" (bundled in
// fonts/ but not in ascii-cdn.js) must render art via loadFont.
const server = spawn(
  "node",
  [
    new URL("../../scripts/serve-static.mjs", import.meta.url).pathname,
    new URL(".", import.meta.url).pathname,
    "5183",
  ],
  { stdio: "ignore" },
);
// Even a failed run must release the port for the next one.
process.on("exit", () => server.kill());
await new Promise((resolve) => setTimeout(resolve, 800));
const served = await browser.newPage();
await served.goto("http://localhost:5183/index.html");
await served.waitForFunction(
  () =>
    document.getElementById("preview")?.contentDocument?.querySelector("mono-wind[data-mw-ready]"),
  null,
  { timeout: 10_000 },
);
await served.fill("#source", '<mono-ascii font="slant">lazy</mono-ascii>');
let fontLazyLoaded = true;
await served
  .waitForFunction(
    () => {
      const grid = document
        .getElementById("preview")
        ?.contentDocument?.querySelector("mono-wind")
        ?.shadowRoot?.getElementById("grid");
      const text = grid?.textContent ?? "";
      return text.includes("_") && !text.includes("lazy");
    },
    null,
    { timeout: 10_000 },
  )
  .catch(() => {
    fontLazyLoaded = false;
  });
server.kill();

await browser.close();

const result = {
  sampleRendered,
  asciiRendered,
  fontLazyLoaded,
  themed,
  themeQueryPersisted,
  restored,
  selectMode,
  selectQueryPersisted,
  selectRestored,
  desktopSlot,
  mobileSlot,
  highlighted,
  sampleRoundTrips,
  tidyWorks,
  tabIndents,
  editorFilled,
  hoverVariantCompiled,
};
if (
  !sampleRendered ||
  !asciiRendered ||
  !fontLazyLoaded ||
  !themed ||
  !themeQueryPersisted ||
  !restored ||
  selectMode !== "text" ||
  selectQueryPersisted !== "text" ||
  !selectRestored ||
  !desktopSlot ||
  !mobileSlot ||
  !highlighted ||
  !sampleRoundTrips ||
  !tidyWorks ||
  !tabIndents ||
  !editorFilled ||
  !hoverVariantCompiled
) {
  console.error("play smoke test FAILED:", JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("play smoke test passed:", JSON.stringify(result));
