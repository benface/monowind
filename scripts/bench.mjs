/**
 * Time to interactive on a page the grid finds hard, in one of four
 * shapes (`SHAPES` below). Reports the median of several runs so a
 * number is comparable across commits; record what it gives in
 * .agents/architecture/performance.md when it moves.
 *
 *   pnpm bench                 300 bordered boxes, no throttling
 *   pnpm bench --shape blocks  a field of block glyphs instead
 *   pnpm bench --shape prose   paragraphs of nested inline elements
 *   pnpm bench --shape faded   filled boxes, every other at half opacity
 *   pnpm bench --count 600     a heavier page
 *   pnpm bench --rate 4        a quarter of the CPU, as a slow client
 *   pnpm bench --runs 7        more samples
 *   pnpm bench --bundle <path> an already-built cdn.js, to compare tags
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const repoRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
// Boxes, rows or paragraphs, by the shape.
const count = Number(flag("count", 300));
const runs = Number(flag("runs", 5));
const rate = Number(flag("rate", 1));
const shape = flag("shape", "boxes");
const given = flag("bundle", null);

const BANDS = ["\u2588", "\u2580", "\u2584", "\u2591", "\u2592", "\u2593"];
const repeat = (render, separator = "") =>
  Array.from({ length: count }, (_, i) => render(i)).join(separator);

/** Each shape's page body and the words the report names it by. */
const SHAPES = {
  // Every border cell is a stroke the font may draw off its row.
  boxes: {
    label: "bordered boxes",
    body: () =>
      `<div class="flex flex-wrap gap-1">${repeat(
        (i) => `<div class="border px-1 rounded-sm"><span>item ${i}</span></div>`,
      )}</div>`,
  },
  // A run of block glyphs shares one box, and the fills take a
  // different fit and share of the row (specs/wide-characters.md).
  blocks: {
    label: "rows of blocks",
    body: () => `<div>${repeat((i) => BANDS[i % BANDS.length].repeat(40), "<br>")}</div>`,
  },
  // The run walk, its paragraphs nesting the inline elements a page
  // really has.
  prose: {
    label: "paragraphs",
    body: () =>
      `<div>${repeat(
        (i) =>
          `<p>Paragraph ${i} of the page, with <span>a <b>bold <i>and italic</i></b> run</span> in it, ` +
          `<em>an <code>inline code</code> span</em>, and <a href="#">a link <strong>inside</strong></a>.</p>`,
      )}</div>`,
  },
  // The blending (specs/cell-model.md "Opacity and translucency"):
  // half of them groups, on a translucent card, under a translucent
  // overlay.
  faded: {
    label: "boxes, half faded",
    body: () =>
      `<div class="relative bg-slate-900 p-1 text-slate-100"><div class="flex flex-wrap gap-1 bg-white/10 p-1">${repeat(
        (i) =>
          `<div class="border bg-slate-700 px-1 rounded-sm${i % 2 ? " opacity-50" : ""}"><span>item ${i}</span></div>`,
      )}</div><div class="absolute inset-x-0 top-0 h-8 bg-black/50"></div></div>`,
  },
};
if (!Object.hasOwn(SHAPES, shape)) {
  console.error(`Unknown --shape ${shape}: one of ${Object.keys(SHAPES).join(", ")}`);
  process.exit(1);
}
const body = SHAPES[shape].body();

// The bundle under test: built here so the number always belongs to
// the working tree, unless `--bundle` names one built elsewhere (an
// older tag's, to compare against).
if (!given) {
  const built = spawnSync("pnpm", ["-C", "packages/core", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const bundle = readFileSync(given ?? resolve(repoRoot, "packages/core/dist/cdn.js"), "utf8");

const page = `<!doctype html><html><head><meta charset="utf-8">
<style>html{background:#fff;color:#000}body{margin:0;padding:8px}</style>
<script>${bundle}</script>
</head><body>
<mono-wind id="host">${body}</mono-wind>
</body></html>`;

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(page);
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const { port } = server.address();

const browser = await chromium.launch();
const samples = [];
for (let run = 0; run < runs; run++) {
  // A plain desktop client: a 2x screen doubles the rasterizing and
  // tells you less about the engine's own work.
  const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const client = await tab.context().newCDPSession(tab);
  await client.send("Performance.enable");
  if (rate > 1) await client.send("Emulation.setCPUThrottlingRate", { rate });
  const started = Date.now();
  await tab.goto(`http://127.0.0.1:${port}/`);
  // Interactive is the host's own signal: the grid is painted and the
  // engine is listening.
  await tab.waitForFunction(() => document.querySelector("mono-wind[data-mw-ready]"), null, {
    timeout: 60000,
  });
  const interactive = Date.now() - started;
  const metrics = Object.fromEntries(
    (await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]),
  );
  const spans = await tab.evaluate(
    () => document.querySelector("mono-wind").shadowRoot.querySelectorAll("#grid span").length,
  );
  samples.push({
    interactive,
    spans,
    style: metrics.RecalcStyleDuration * 1000,
    layout: metrics.LayoutDuration * 1000,
  });
  await tab.close();
}
await browser.close();
server.close();

const median = (of) => {
  const sorted = samples.map(of).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const ms = (value) => `${value.toFixed(1)} ms`;
console.log(
  `\n${given ?? "working tree"}: ${count} ${SHAPES[shape].label},` +
    ` ${runs} runs at ${rate}x CPU — medians\n` +
    `  interactive  ${ms(median((s) => s.interactive))}\n` +
    `  style recalc ${ms(median((s) => s.style))}\n` +
    `  layout       ${ms(median((s) => s.layout))}\n` +
    `  grid spans   ${samples[0].spans}\n` +
    `  every run    ${samples.map((s) => `${s.interactive}ms`).join("  ")}\n`,
);
