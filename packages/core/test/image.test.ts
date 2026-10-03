import { describe, expect, it } from "vitest";
import {
  altLines,
  pictureGrid,
  placePicture,
  readImageColor,
  reducePicture,
  samplePicture,
  type Bitmap,
} from "../src/image.ts";

/** The picture (specs/images.md): its place in the box, its pixels
 * averaged from the source, and its colors reduced — on known bitmaps,
 * against pixels computed by hand. */

/** A bitmap from rows of `[r, g, b, a]`. */
function bitmap(rows: number[][][]): Bitmap {
  const height = rows.length;
  const width = rows[0]!.length;
  return { width, height, data: new Uint8ClampedArray(rows.flat(2)) };
}

/** A bitmap's pixels as rows of `[r, g, b, a]`. */
function pixels({ width, height, data }: Bitmap): number[][][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      Array.from(data.slice((y * width + x) * 4, (y * width + x + 1) * 4)),
    ),
  );
}

/** A flat bitmap of one color. */
const flat = (width: number, height: number, rgba: number[]): Bitmap =>
  bitmap(Array.from({ length: height }, () => Array.from({ length: width }, () => rgba)));

describe("the place", () => {
  const own = { width: 200, height: 100 };
  const box = { width: 100, height: 100 };
  const center = { x: "50%", y: "50%" };

  it("stretches to the box with fill", () => {
    expect(placePicture(own, box, "fill", center)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("fits inside the box with contain, and covers it with cover, at its position", () => {
    expect(placePicture(own, box, "contain", center)).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    });
    expect(placePicture(own, box, "cover", center)).toEqual({
      x: -50,
      y: 0,
      width: 200,
      height: 100,
    });
    expect(placePicture(own, box, "cover", { x: "0%", y: "50%" }).x).toBe(0);
    expect(placePicture(own, box, "cover", { x: "100%", y: "50%" }).x).toBe(-100);
  });

  it("keeps its own size with none, and the smaller of none and contain with scale-down", () => {
    const small = { width: 40, height: 20 };
    expect(placePicture(small, box, "none", center)).toEqual({
      x: 30,
      y: 40,
      width: 40,
      height: 20,
    });
    expect(placePicture(small, box, "scale-down", center)).toEqual({
      x: 30,
      y: 40,
      width: 40,
      height: 20,
    });
    expect(placePicture(own, box, "scale-down", center)).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    });
  });

  it("reads a position in px, keywords and calc() as the engines compute them", () => {
    expect(placePicture(own, box, "cover", { x: "10px", y: "0px" }).x).toBe(10);
    expect(placePicture(own, box, "cover", { x: "calc(100% - 10px)", y: "50%" }).x).toBe(-110);
    expect(placePicture(own, box, "cover", { x: "right", y: "top" })).toEqual({
      x: -100,
      y: 0,
      width: 200,
      height: 100,
    });
  });
});

describe("the place in pixels", () => {
  it("snaps the place to whole pixels, so no pixel is covered in part", () => {
    // A column a pixel wide, a 16 px row two pixels tall.
    const cell = { width: 8, height: 16 };
    expect(pictureGrid({ x: 4, y: 3, width: 81, height: 27 }, cell)).toEqual({
      x: 1,
      y: 0,
      width: 10,
      height: 4,
    });
  });
});

describe("the sampling", () => {
  const RED = [255, 0, 0, 255];
  const BLUE = [0, 0, 255, 255];
  const WHITE = [255, 255, 255, 255];
  const BLACK = [0, 0, 0, 255];
  const whole = (width: number, height: number) => ({ x: 0, y: 0, width, height });

  it("keeps a bitmap drawn at its own size as it is", () => {
    const source = bitmap([
      [RED, BLUE],
      [WHITE, BLACK],
    ]);
    expect(pixels(samplePicture(source, { width: 2, height: 2 }, whole(2, 2)))).toEqual(
      pixels(source),
    );
  });

  it("averages the source area each pixel covers", () => {
    const source = bitmap([[RED, BLUE, WHITE, BLACK]]);
    expect(pixels(samplePicture(source, { width: 2, height: 1 }, whole(2, 1)))).toEqual([
      [
        [128, 0, 128, 255],
        [128, 128, 128, 255],
      ],
    ]);
  });

  it("weighs a source pixel a pixel covers in part by the part it covers", () => {
    // Three source pixels across two: the middle one halves between them.
    const source = bitmap([[RED, BLUE, BLUE]]);
    expect(pixels(samplePicture(source, { width: 2, height: 1 }, whole(2, 1)))).toEqual([
      [
        [170, 0, 85, 255],
        [0, 0, 255, 255],
      ],
    ]);
  });

  it("averages a transparent pixel's color out, its alpha in", () => {
    const source = bitmap([[RED, [0, 0, 0, 0]]]);
    expect(pixels(samplePicture(source, { width: 1, height: 1 }, whole(1, 1)))).toEqual([
      [[255, 0, 0, 128]],
    ]);
  });

  it("leaves the pixels outside the picture's place transparent", () => {
    const source = flat(2, 2, RED);
    const sampled = samplePicture(
      source,
      { width: 4, height: 1 },
      { x: 1, y: 0, width: 2, height: 1 },
    );
    expect(pixels(sampled)[0]!.map((pixel) => pixel[3])).toEqual([0, 255, 255, 0]);
  });

  it("crops what lies past the box", () => {
    const source = bitmap([[RED, BLUE, WHITE, BLACK]]);
    // Drawn twice the box's width, from its left: the box holds the
    // source's first half.
    expect(
      pixels(samplePicture(source, { width: 2, height: 1 }, { x: 0, y: 0, width: 4, height: 1 })),
    ).toEqual([[RED, BLUE]]);
  });
});

describe("the color", () => {
  /** A palette as the browser computes the registered property: each
   * color an `rgb()`, whatever the author wrote. */
  const computed = (...colors: [number, number, number][]): string =>
    colors.map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`).join(" ");
  const BLACK: [number, number, number] = [0, 0, 0];
  const GREEN: [number, number, number] = [0, 170, 0];
  /** The reduction `palette` and `match` ask for, undithered. */
  const plain = (palette: string, match = "color") =>
    readImageColor({ palette, match, levels: "none", dither: "none" })!;

  it("reads a palette, its match, levels and a dither", () => {
    expect(
      readImageColor({ palette: "none", match: "color", levels: "none", dither: "ordered" }),
    ).toBeNull();
    const vga = readImageColor({
      palette: computed(BLACK, [170, 0, 0], GREEN, [255, 255, 255]),
      match: "color",
      levels: "none",
      dither: "ordered",
    })!;
    expect(vga.palette?.colors).toHaveLength(4);
    expect(vga.palette?.lightness).toBe(false);
    expect(vga.dither).toBe("ordered");
    const green = readImageColor({
      palette: computed(BLACK, GREEN),
      match: "lightness",
      levels: "4",
      dither: "none",
    })!;
    expect(green.palette?.lightness).toBe(true);
    expect(green.levels).toBe(4);
    expect(green.dither).toBe("none");
    expect(
      readImageColor({ palette: "none", match: "color", levels: "3", dither: "diffusion" }),
    ).toEqual({
      palette: null,
      levels: 3,
      dither: "diffusion",
    });
  });

  it("posterizes each channel to its levels", () => {
    const picture = bitmap([[[60, 100, 200, 255]]]);
    reducePicture(picture, { palette: null, levels: 2, dither: "none" });
    expect(pixels(picture)).toEqual([[[0, 0, 255, 255]]]);
    const four = bitmap([[[60, 100, 200, 255]]]);
    reducePicture(four, { palette: null, levels: 4, dither: "none" });
    expect(pixels(four)).toEqual([[[85, 85, 170, 255]]]);
  });

  it("takes the nearest palette color in OKLab", () => {
    const picture = bitmap([
      [
        [200, 30, 20, 255],
        [240, 240, 230, 255],
        [10, 10, 20, 255],
      ],
    ]);
    reducePicture(picture, plain(computed(BLACK, [255, 0, 0], [255, 255, 255])));
    expect(pixels(picture)).toEqual([
      [
        [255, 0, 0, 255],
        [255, 255, 255, 255],
        [0, 0, 0, 255],
      ],
    ]);
  });

  it("takes a lightness palette's color by lightness alone", () => {
    // A dark gray is nearer the green by lightness, nearer the black by
    // color, which a monochrome theme's ramp must not take into account.
    const gray = () => bitmap([[[56, 56, 56, 255]]]);
    const byLightness = gray();
    reducePicture(byLightness, plain(computed(BLACK, GREEN), "lightness"));
    expect(pixels(byLightness)).toEqual([[[0, 170, 0, 255]]]);
    const byColor = gray();
    reducePicture(byColor, plain(computed(BLACK, GREEN)));
    expect(pixels(byColor)).toEqual([[[0, 0, 0, 255]]]);
  });

  it("dithers a flat midtone in an ordered pattern of the right mean, the same wherever it is drawn", () => {
    const gray = () => flat(4, 4, [128, 128, 128, 255]);
    const picture = gray();
    reducePicture(picture, { palette: null, levels: 2, dither: "ordered" });
    const whites = pixels(picture)
      .flat()
      .filter((pixel) => pixel[0] === 255).length;
    expect(whites).toBe(8);
    const again = gray();
    reducePicture(again, { palette: null, levels: 2, dither: "ordered" });
    expect(again.data).toEqual(picture.data);
  });

  it("dithers a palette's colors across the whole step between them", () => {
    // A dark and a light gray each mix in the other color, as levels do.
    const palette = computed(BLACK, [255, 255, 255]);
    for (const [gray, other] of [
      [40, 255],
      [215, 0],
    ] as const) {
      const picture = flat(4, 4, [gray, gray, gray, 255]);
      reducePicture(picture, { ...plain(palette), dither: "ordered" });
      const mixed = pixels(picture)
        .flat()
        .filter((pixel) => pixel[0] === other).length;
      expect(mixed, `${gray}`).toBeGreaterThan(0);
    }
  });

  it("diffuses the error so a flat midtone keeps its mean", () => {
    const picture = flat(8, 8, [128, 128, 128, 255]);
    reducePicture(picture, { palette: null, levels: 2, dither: "diffusion" });
    const values = pixels(picture)
      .flat()
      .map((pixel) => pixel[0]!);
    expect(new Set(values)).toEqual(new Set([0, 255]));
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(Math.abs(mean - 128)).toBeLessThan(8);
  });

  it("leaves a transparent pixel out, its black no error to diffuse", () => {
    // A light gray nears the white, unless a transparent pixel's black,
    // matched to the gray, pushes it darker.
    const picture = bitmap([
      [
        [0, 0, 0, 0],
        [180, 180, 180, 255],
      ],
    ]);
    const palette = computed([100, 100, 100], [255, 255, 255]);
    reducePicture(picture, { ...plain(palette), dither: "diffusion" });
    expect(pixels(picture)).toEqual([
      [
        [0, 0, 0, 0],
        [255, 255, 255, 255],
      ],
    ]);
  });

  it("keeps each pixel's alpha", () => {
    const picture = bitmap([[[128, 128, 128, 40]]]);
    reducePicture(picture, { palette: null, levels: 2, dither: "none" });
    expect(pixels(picture)[0]![0]![3]).toBe(40);
  });
});

describe("the alt in the image's cells", () => {
  it("wraps at words from the top, a line a row", () => {
    expect(altLines("A sunset over the hills", 10, 3)).toEqual(["A sunset", "over the", "hills"]);
  });

  it("cuts at the image's last cell", () => {
    expect(altLines("one two three four", 7, 2)).toEqual(["one two", "three"]);
  });

  it("breaks a word longer than the image", () => {
    expect(altLines("unbreakable", 4, 2)).toEqual(["unbr", "eaka"]);
  });

  it("is blank where there is none", () => {
    expect(altLines("", 3, 2)).toEqual(["", ""]);
  });

  it("collapses its white space, as rendered text", () => {
    expect(altLines("a\n\nb   c", 5, 2)).toEqual(["a b c", ""]);
  });

  it("wraps by cells, a wide character two", () => {
    expect(altLines("日本語", 4, 2)).toEqual(["日本", "語"]);
  });
});
