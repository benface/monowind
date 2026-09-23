import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";

/** The CDN bundle's lazy font loading (README "CDN"): same-origin
 * `fonts/` first, then the published package. */
it("passes over a page an app serves in a font's place, on to the published file", async () => {
  vi.stubGlobal("__MONOWIND_ASCII_VERSION__", "0.0.0");
  const slant = readFileSync(resolve("fonts", "slant.flf"), "utf8");
  // A single-page app answers every path with its own page.
  const fetch = vi.fn(async (url: string) =>
    url.startsWith("fonts/")
      ? new Response("<!doctype html><title>app</title>")
      : new Response(url.endsWith("slant.flf") ? slant : "", {
          status: url.endsWith("slant.flf") ? 200 : 404,
        }),
  );
  vi.stubGlobal("fetch", fetch);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await import("../src/cdn.ts");
  const { ascii } = (
    globalThis as unknown as {
      monowind: {
        ascii: { loadFont(name: string): Promise<unknown>; asciiFont(name: string): unknown };
      };
    }
  ).monowind;
  const font = await ascii.loadFont("slant");
  expect(font).not.toBeNull();
  expect(ascii.asciiFont("slant")).toBe(font);
  expect(fetch.mock.calls.at(-1)?.[0]).toContain("cdn.jsdelivr.net");
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
  vi.unstubAllGlobals();
});
