import { expect, test } from "@playwright/test";

/**
 * Selection-invert regression: drag a REAL selection across each
 * fixture and screenshot the painted result, in both select modes —
 * "text" guards the engine's painted highlight over a light-DOM range
 * (reverse video per cell, the colored banner as a band of its color,
 * specs/wide-characters.md) and the invisibility of the native one
 * beneath it; "grid" guards the <pre>'s own ::selection ink (the
 * bbfc59c class of bug: the text-fill-color invisibility lock silently
 * defeating it in Safari) and the full-row sweep of its padded rows
 * (specs/cell-model.md "Selection"). The mode goes through the
 * preview's Select toolbar global, which rewrites every host's
 * attribute after render. Runs in all three engines
 * (playwright.config projects) — they paint native selection ink
 * differently, so each keeps its own golden.
 */
const FIXTURES = [
  "test-selection--light-text",
  "test-selection--banner",
  "test-selection--host-text",
];
const MODES = ["text", "grid"];

for (const id of FIXTURES) {
  for (const mode of MODES) {
    test(`${id} selection invert (${mode})`, async ({ page, browserName }) => {
      await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=select:${mode}`);
      await page.waitForFunction((mode) => {
        const hosts = [...document.querySelectorAll("mono-wind")];
        return (
          hosts.length > 0 &&
          hosts.every(
            (host) => host.hasAttribute("data-mw-ready") && host.getAttribute("select") === mode,
          )
        );
      }, mode);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      // Drag corner to corner of the light element (the banner's shadow
      // transcript, the host itself for its own text): its text in
      // "text", the grid under it in "grid".
      const box = await page.evaluate(() => {
        const el = document.querySelector('[data-test="target"]')!;
        const rect = (el.shadowRoot?.getElementById("mirror") ?? el).getBoundingClientRect();
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      });
      await page.mouse.move(box.x + 2, box.y + 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.w - 2, box.y + box.h - 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      // Firefox paints selection edges with run-to-run sub-pixel jitter;
      // the guarded regression (unpainted glyphs) moves far more pixels.
      await expect(page).toHaveScreenshot(`${id}-${mode}-${browserName}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
      });
    });
  }
}

/**
 * A word or paragraph gesture survives its release
 * (specs/semantic-selection.md): the engine takes the multi-click
 * press over, and the browser's mouse-up default would otherwise
 * collapse the selection the press landed in (Chromium, WebKit). A
 * real mouse, since a synthetic release has no default to cancel.
 */
for (const mode of MODES) {
  test(`double- and triple-click keep their selection (${mode})`, async ({ page }) => {
    await page.goto(
      `/iframe.html?id=test-selection--light-text&viewMode=story&globals=select:${mode}`,
    );
    await page.waitForFunction((mode) => {
      const host = document.querySelector("mono-wind");
      return host?.hasAttribute("data-mw-ready") && host.getAttribute("select") === mode;
    }, mode);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const box = await page.locator('[data-test="target"]').boundingBox();
    // The middle of the target's first letter.
    const letter = await page.evaluate(() => {
      const target = document.querySelector('[data-test="target"]')!;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent!.search(/\S/);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      throw new Error("no text");
    });
    const selected = () => page.evaluate(() => document.getSelection()!.toString());
    // A drag first, so the multi-click lands inside a selection.
    await page.mouse.move(box!.x + 2, box!.y + 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height - 2, { steps: 8 });
    await page.mouse.up();
    await page.mouse.dblclick(letter.x, letter.y);
    await page.waitForTimeout(150);
    expect(await selected()).toMatch(/^\S+\s?$/);
    await page.mouse.click(letter.x, letter.y, { clickCount: 3 });
    await page.waitForTimeout(150);
    expect((await selected()).split(/\s+/).length).toBeGreaterThan(3);
    // A plain click inside the selection still collapses it.
    await page.mouse.click(letter.x, letter.y);
    await page.waitForTimeout(150);
    expect(await selected()).toBe("");
  });
}

/**
 * A form control's selection swaps the control's own colors, as the
 * grid swaps a selected cell's (specs/cell-model.md "Form controls"):
 * Chromium and WebKit hand a control its parent's `::selection` —
 * transparent, for the grid-painted selection — so the control's own
 * rule swaps the ink and ground the engine wrote on it. The focused
 * control's ink spreads over the selected cells as a band, its glyphs
 * on the band in the ground color: on the focus invert, and on an
 * author's focus colors.
 */
test("a form control's selection swaps its own colors", async ({ page }) => {
  await page.goto(
    `/iframe.html?id=test-selection--field-fixture&viewMode=story&globals=select:text`,
  );
  await page.waitForFunction(() =>
    document.querySelector("mono-wind")?.hasAttribute("data-mw-ready"),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  // A control's cells inside its border.
  const clipOf = (name: string) =>
    page.evaluate((name) => {
      const style = getComputedStyle(document.querySelector("mono-wind")!);
      const cw = parseFloat(style.getPropertyValue("--mw-cw"));
      const ch = parseFloat(style.getPropertyValue("--mw-ch"));
      const rect = document.querySelector(`[data-test="${name}"]`)!.getBoundingClientRect();
      return {
        x: rect.left + cw,
        y: rect.top + ch,
        width: rect.width - 2 * cw,
        height: rect.height - 2 * ch,
      };
    }, name);
  // A clip's pixels as [r, g, b] triples, row-major.
  const pixels = async (clip: Awaited<ReturnType<typeof clipOf>>) => {
    const png = (await page.screenshot({ clip })).toString("base64");
    return page.evaluate(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const rgb: [number, number, number][] = [];
      for (let i = 0; i < data.length; i += 4) rgb.push([data[i]!, data[i + 1]!, data[i + 2]!]);
      return { width: canvas.width, rgb };
    }, png);
  };
  const grounds: string[] = [];
  for (const name of ["plain", "styled"]) {
    const clip = await clipOf(name);
    // Focused with a collapsed caret: WebKit selects the value on focus.
    await page.evaluate((name) => {
      const input = document.querySelector<HTMLInputElement>(`[data-test="${name}"]`)!;
      input.focus();
      input.setSelectionRange(0, 0);
    }, name);
    await page.waitForTimeout(150);
    const focused = await pixels(clip);
    // The focused control's ground: its most common color. Pixels far
    // from it are ink (a glyph, or the band once selected — WebKit's
    // inactive window paints the band at part intensity).
    const counts = new Map<string, number>();
    for (const px of focused.rgb) counts.set(px.join(), (counts.get(px.join()) ?? 0) + 1);
    const ground = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])[0]![0]
      .split(",")
      .map(Number);
    grounds.push(ground.join());
    const distance = (px: number[]) => px.reduce((sum, v, i) => sum + Math.abs(v - ground[i]!), 0);
    const inked = (shot: typeof focused) => shot.rgb.filter((px) => distance(px) > 200).length;
    await page.evaluate(
      (name) => document.querySelector<HTMLInputElement>(`[data-test="${name}"]`)!.select(),
      name,
    );
    await page.waitForTimeout(150);
    const selected = await pixels(clip);
    // The band: far more ink than the glyphs alone.
    expect(inked(selected)).toBeGreaterThan(3 * inked(focused));
    // The glyphs on it: ground-colored pixels inside the band's bounds.
    const at = (i: number) => [i % selected.width, Math.floor(i / selected.width)] as const;
    const band = selected.rgb.flatMap((px, i) => (distance(px) > 200 ? [at(i)] : []));
    const [left, right] = [Math.min(...band.map(([x]) => x)), Math.max(...band.map(([x]) => x))];
    const [top, bottom] = [
      Math.min(...band.map(([, y]) => y)),
      Math.max(...band.map(([, y]) => y)),
    ];
    const glyphs = selected.rgb.filter((px, i) => {
      const [x, y] = at(i);
      return distance(px) < 100 && x >= left && x <= right && y >= top && y <= bottom;
    }).length;
    expect(glyphs).toBeGreaterThan(50);
  }
  // The styled control was checked on its own colors.
  expect(grounds[1]).not.toBe(grounds[0]);
});

/**
 * An engine gesture auto-scrolls its scroll container
 * (specs/wide-characters.md "auto-scrolls"), with a real mouse held
 * OUTSIDE the host: only the captured pointer's moves reach the
 * engine there. A text-mode press, a grid-mode double-click.
 */
for (const mode of MODES) {
  test(`a drag past the host scrolls the pressed cell's container (${mode})`, async ({ page }) => {
    await page.goto(
      `/iframe.html?id=test-selection--autoscroll-fixture&viewMode=story&globals=select:${mode}`,
    );
    await page.waitForFunction((mode) => {
      const host = document.querySelector("mono-wind");
      return host?.hasAttribute("data-mw-ready") && host.getAttribute("select") === mode;
    }, mode);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const host = (await page.locator("mono-wind").boundingBox())!;
    const first = (await page.locator('[data-test="s1"]').boundingBox())!;
    const box = (await page.locator('[data-test="scroller"]').boundingBox())!;
    const scrollTop = () =>
      page.evaluate(() => document.querySelector('[data-test="scroller"]')!.scrollTop);
    expect(await scrollTop()).toBe(0);
    const clickCount = mode === "grid" ? 2 : 1;
    await page.mouse.move(first.x + 4, first.y + first.height / 2);
    if (clickCount === 2) {
      await page.mouse.down();
      await page.mouse.up();
    }
    await page.mouse.down({ clickCount });
    await page.mouse.move(host.x + host.width + 24, box.y + box.height + 12, { steps: 4 });
    await page.waitForFunction(() => document.getSelection()!.toString().includes("Fifth"));
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.mouse.up({ clickCount });
    expect(await scrollTop()).toBeGreaterThan(0);
  });
}
