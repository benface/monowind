import { html } from "lit";
import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { countLayouts, paintedSpan, readyGrid } from "./helpers.ts";

const meta: Meta = {
  title: "Features / Generated Content",
};
export default meta;

type Measured = ReturnType<Awaited<ReturnType<typeof readyGrid>>["measure"]>;

/** Each of an element's native characters on the grid's cell under it:
 * the generated text between them, which is no DOM text, the grid's
 * alone. */
const expectCharsOnGrid = (el: HTMLElement, { rows, cellOf }: Measured): void => {
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const { data } = node as Text;
    for (let i = 0; i < data.length; i++) {
      if (/\s/.test(data[i]!)) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const { row, col } = cellOf(range.getBoundingClientRect());
      expect(rows[row]?.[col], `"${data[i]}" of "${data.trim()}" at ${row}:${col}`).toBe(data[i]);
    }
  }
};

/**
 * Generated content (specs/generated-content.md): the text `::before`
 * and `::after` give their elements — strings, `attr()`, counters and
 * quotes — as the elements' first and last text, in its own color and
 * cells. A link's underline reaches its inline `↗`, as CSS propagates
 * it, and stops at the `inline-block` `→`.
 */
export const GeneratedContent: StoryObj = {
  name: "Generated Content",
  render: () => html`
    <mono-wind>
      <div class="grid max-w-120 gap-x-4 gap-y-1 sm:grid-cols-2">
        <p data-test="icons">
          <a href="#docs" class="underline before:mr-1 before:inline-block before:content-['→']"
            >Docs</a
          >
          and
          <a href="#out" class="underline after:text-cyan-400 after:content-['_↗']">elsewhere</a>
        </p>
        <label data-test="required" class="after:ml-1 after:text-red-400 after:content-['*']"
          >Name</label
        >
        <p data-test="label">
          <span
            data-label="NEW"
            class="before:mr-1 before:bg-amber-400 before:px-1 before:text-black before:content-[attr(data-label)]"
            >A badge from an attribute</span
          >
        </p>
        <ol data-test="steps" class="[counter-reset:step]">
          <li
            class="before:text-cyan-400 before:content-['Step_'_counter(step)_':_'] before:[counter-increment:step]"
          >
            Open the file
          </li>
          <li
            class="before:text-cyan-400 before:content-['Step_'_counter(step)_':_'] before:[counter-increment:step]"
          >
            Save it, and wrap onto a second line where it runs long
          </li>
        </ol>
        <p data-test="quotes">
          <q>Quotes <q>nest</q> by depth</q>, <q lang="fr">et par langue</q>
        </p>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by, measure } = await readyGrid(canvasElement);
    await waitFor(() => {
      const measured = measure();
      const { rows } = measured;
      for (const text of [
        "→ Docs and elsewhere ↗",
        "Name *",
        " NEW  A badge from an attribute",
        "Step 1: Open the file",
        "Step 2: Save it,",
        "“Quotes ‘nest’ by depth”, «et par langue»",
      ]) {
        expect(
          rows.some((row) => row.includes(text)),
          `"${text}" in\n${rows.join("\n")}`,
        ).toBe(true);
      }
      for (const name of ["icons", "required", "label", "steps", "quotes"]) {
        expectCharsOnGrid(by(name), measured);
      }
    });
    // The link's underline reaches its inline icon, not its atomic one.
    const underlined = (text: string) =>
      paintedSpan(host, text)!.style.textDecorationLine.includes("underline");
    expect(underlined("↗")).toBe(true);
    expect(underlined("→")).toBe(false);
  },
};

/**
 * Pseudo-elements that are boxes of their own (specs/generated-content.md
 * "Pseudo-element boxes"), laid out and painted as elements of their
 * kind: a heading's absolute underline, and a card's block title and
 * its link stretched over the whole card, its border included, where a
 * press on any of the card's cells follows the link.
 */
export const PseudoElementBoxes: StoryObj = {
  name: "Pseudo-Element Boxes",
  render: () => html`
    <mono-wind>
      <div class="grid max-w-120 gap-x-4 gap-y-1 sm:grid-cols-2">
        <h3
          data-test="underline"
          class="relative w-fit self-start pb-1 font-bold after:absolute after:inset-x-0 after:bottom-0 after:h-1 after:border-b after:border-cyan-400"
        >
          A decorated heading
        </h3>
        <div
          data-test="card"
          class="relative border border-neutral-500 px-1 before:block before:font-bold before:content-['Card']"
        >
          <p>The whole card is its link:</p>
          <a data-test="stretched" href="#card" class="underline after:absolute after:-inset-1"
            >Read more</a
          >
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { by, measure, width, height } = await readyGrid(canvasElement);
    await waitFor(() => {
      const measured = measure();
      const { rows, cellAt, boxOf } = measured;
      expect(
        rows.some((row) => row.includes("│ Card")),
        rows.join("\n"),
      ).toBe(true);
      const heading = boxOf(by("underline"));
      // Its underline spans it, and stops at its edge.
      const underline = rows[heading.row + 1]!.slice(heading.col, heading.col + 20);
      expect(underline).toBe(`${"─".repeat(19)} `);
      for (const name of ["underline", "card"]) expectCharsOnGrid(by(name), measured);
      // The stretched link's native box is its grid box: each of the
      // card's cells takes its press, its border's too, and none past it.
      const { col, row } = boxOf(by("card"));
      const [right, bottom] = [col + width(by("card")) - 1, row + height(by("card")) - 1];
      const hit = (x: number, y: number) => {
        const at = cellAt(x, y);
        return document.elementFromPoint(at.x, at.y) === by("stretched");
      };
      expect([hit(col, row), hit(right, bottom), hit(col + 1, row + 1)]).toEqual([
        true,
        true,
        true,
      ]);
      expect([
        hit(col - 1, row + 1),
        hit(right + 1, row + 1),
        hit(col + 1, row - 1),
        hit(col + 1, bottom + 1),
      ]).toEqual([false, false, false, false]);
    });
    // The card's title keeps its native flow, the underline its cells.
    const position = (name: string, pseudo: string) =>
      by(name).style.getPropertyValue(`--mw-${pseudo}-position`);
    expect([position("card", "before"), position("underline", "after")]).toEqual([
      "relative",
      "absolute",
    ]);
  },
};

/**
 * Test-only: the native text beside and after each kind of
 * pseudo-element box lies on the grid's cells — a float's, a middle-
 * and a bottom-aligned atomic one's, a block one's in a mixed
 * container, and in a multi-column flow, a spanner splitting it or not.
 */
export const GeneratedContentNativeText: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind>
      <div class="w-80">
        <p
          data-test="float"
          class="w-30 before:float-left before:mr-1 before:h-2 before:w-6 before:content-['F']"
        >
          long text wrapping around the float here and some more words after it
        </p>
        <p data-test="aligned" class="mt-1">
          ab
          <span class="before:inline-block before:py-1 before:align-middle before:content-['M']"
            >cd</span
          >
          ef
          <span class="before:inline-block before:pt-2 before:align-bottom before:content-['B']"
            >gh</span
          >
          ij
        </p>
        <div data-test="mixed" class="mt-1 w-30 before:mt-1 before:block before:content-['Head']">
          <span class="float-left h-3 w-6">L</span>beside the float, text
          <p>then a paragraph</p>
        </div>
        <div
          data-test="columns"
          class="mt-1 w-40 columns-2 before:mb-1 before:block before:content-['Head']"
        >
          <p>one two three four five six seven eight nine ten eleven twelve thirteen</p>
          <p>alpha beta gamma delta epsilon zeta eta theta iota kappa lambda</p>
        </div>
        <div
          data-test="split"
          class="mt-1 w-40 columns-2 before:mb-1 before:block before:content-['Head']"
        >
          <p>one two three four five six seven eight nine ten eleven twelve</p>
          <h3 class="[column-span:all]">Span</h3>
          <p>alpha beta gamma delta epsilon zeta eta theta iota kappa</p>
        </div>
      </div>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { by, measure } = await readyGrid(canvasElement);
    await waitFor(() => {
      const measured = measure();
      for (const name of ["float", "aligned", "mixed", "columns", "split"]) {
        expectCharsOnGrid(by(name), measured);
      }
    });
  },
};

/**
 * Test-only: a pseudo-element's transition runs through the layouts it
 * lives beside — the read of its box's lengths keeps it, and the
 * engine's own locks start none of the author's `transition-all` — and
 * in grid mode its box passes presses on to the grid, its own
 * `pointer-events` aside.
 */
export const GeneratedContentTransition: StoryObj = {
  tags: ["!dev", "!golden"],
  render: () => html`
    <mono-wind select="grid">
      <p
        data-test="fading"
        class="relative w-20 after:pointer-events-auto after:absolute after:inset-0 after:bg-cyan-400 after:opacity-0 after:transition-all after:duration-[5s] after:content-['']"
      >
        text
      </p>
    </mono-wind>
  `,
  play: async ({ canvasElement }) => {
    const { host, by } = await readyGrid(canvasElement);
    const fading = by("fading");
    const layouts = countLayouts(host);
    fading.classList.add("after:opacity-100");
    await waitFor(() => expect(layouts.count).toBeGreaterThan(1));
    const transitions = () =>
      fading
        .getAnimations({ subtree: true })
        .map((each) => (each as CSSTransition).transitionProperty);
    expect(transitions()).toEqual(["opacity"]);
    layouts.stop();
    const { x, y, width, height } = fading.getBoundingClientRect();
    expect(document.elementFromPoint(x + width / 2, y + height / 2)).not.toBe(fading);
  },
};
