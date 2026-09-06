import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import decodeQR from "qr/decode.js";

/**
 * Scannability end to end (specs/qr-code.md "Testing"): each code in
 * the fixture is screenshotted as the engine paints it — its
 * real glyphs in its real font — and read back by a decoder, which
 * wants the standard quiet zone around it. Runs in all three engines,
 * since glyph rendering differs.
 */
const VALUE = "https://play.monowind.benface.com";
const CODES = ["default", "dos"];

for (const name of CODES) {
  test(`the ${name} code decodes to its value`, async ({ page }, testInfo) => {
    await page.goto("/iframe.html?id=test-qr--fonts&viewMode=story");
    await page.waitForFunction((count) => {
      const hosts = [...document.querySelectorAll("mono-wind")];
      return hosts.length === count && hosts.every((host) => host.hasAttribute("data-mw-ready"));
    }, CODES.length);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const shot = await page.locator(`[data-test="qr-${name}"]`).screenshot();
    await testInfo.attach(name, { body: shot, contentType: "image/png" });
    const png = PNG.sync.read(shot);
    expect(
      decodeQR({
        width: png.width,
        height: png.height,
        data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
      }),
    ).toBe(VALUE);
  });
}
