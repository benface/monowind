import { describe, expect, it } from "vitest";
import { renderPlainText } from "../src/plain-text.ts";
import { layoutRoot } from "../src/layout.ts";
import { multicolLines } from "../src/multicol.ts";
import { buildTree } from "../src/tree.ts";

/**
 * Multi-column layout (specs/multicol.md): §3.4 count/width resolution in
 * cells, direct-text fragmentation, atomic child distribution, balancing,
 * spanners, fixed-height sequential fill, and column rules.
 */

function plainText(html: string, availableWidth = 60): string {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  const node = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(node, availableWidth);
  return renderPlainText(node);
}

describe("column resolution", () => {
  it("splits a text leaf into column-count columns and balances lines", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px">aaa bbb ccc ddd</div>`,
    );
    expect(art).toBe(["aaa  ccc", "bbb  ddd"].join("\n"));
  });

  it("derives the count from column-width, columns flexing to fill", () => {
    const art = plainText(
      `<div style="column-width: 16px; column-gap: 4px; width: 56px">a b c d e f</div>`,
    );
    expect(art).toBe("a b  c d  e f");
  });

  it("uses the min of count and width-derived fit when both are set", () => {
    const art = plainText(
      `<div style="column-count: 5; column-width: 16px; column-gap: 4px; width: 56px">a b c d e f</div>`,
    );
    expect(art).toBe("a b  c d  e f");
  });

  it("falls back to one full-width column when too narrow for column-width", () => {
    const art = plainText(
      `<div style="column-width: 40px; column-gap: 4px; width: 24px">aaa bbb</div>`,
    );
    expect(art).toBe(["aaa", "bbb"].join("\n"));
  });

  it("defaults the gap to 1em (column-gap: normal)", () => {
    const art = plainText(`<div style="column-count: 2; width: 48px">aaaa bbbb</div>`);
    expect(art).toBe("aaaa    bbbb");
  });

  it("sizes max-content as count columns of the widest child plus gaps", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: max-content"><div>aaaa</div><div>bb</div></div>`,
    );
    expect(art).toBe("aaaa bb");
  });

  it("centers text within its own column", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 52px; text-align: center">aaaa bb</div>`,
    );
    expect(art).toBe(" aaaa    bb");
  });

  it("distributes remainder cells to element-children tracks left to right", () => {
    // The background pins the ATOMIC path (a decorated child opts the
    // container out of paragraph flow) without changing the text.
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 48px"><div style="background-color: red">aa</div><div>bb</div><div>cc</div></div>`,
    );
    expect(art).toBe(["aa     cc", "bb"].join("\n"));
  });
});

describe("direct-text fragmentation", () => {
  it("trims the last line's trailing leading from each column under leading-*", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px; font-size: 16px; line-height: 32px">aaa bbb ccc ddd</div>`,
    );
    expect(art).toBe(["aaa  ccc", "", "bbb  ddd"].join("\n"));
  });

  it("wraps tracked text at width minus tracking (trailing-gap fit rule)", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 52px; letter-spacing: 0.4px">ab cd ef</div>`,
    );
    expect(art).toBe(["a b    e f", "c d"].join("\n"));
  });

  it("multicolLines predicts exactly the engine's fragmentation", () => {
    // Lockstep guard for external predictors (the browser stories'
    // agreement helper): the public utility and the engine share their
    // wrap and fill code, so tracked, leaded text must map identically.
    const text = "alpha beta gamma delta epsilon zeta eta theta";
    const host = document.createElement("div");
    host.innerHTML = `<div style="column-count: 3; column-gap: 4px; width: 96px; letter-spacing: 0.4px; line-height: 32px; font-size: 16px">${text}</div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 24);
    const geometry = node.multicolGeometry!;
    const predicted = multicolLines(text, {
      columnWidth: geometry.columnWidth,
      columnCount: geometry.columnCount,
      tracking: node.style.tracking,
      lineGap: node.style.lineGap,
      restrictingHeight: geometry.totalRows,
    });
    expect(predicted.map((line) => line.text)).toEqual(
      geometry.spans.map((span) => text.slice(span.start, span.end)),
    );
    expect(predicted.map((line) => line.column * (geometry.columnWidth + geometry.gap))).toEqual(
      geometry.lineX,
    );
    expect(predicted.map((line) => line.top)).toEqual(geometry.lineY);
  });

  it("carries an atomic inline box into its line's column", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px">aa <span style="display: inline-block">XX</span> bb cc</div>`,
    );
    expect(art).toBe(["aa   bb", "XX   cc"].join("\n"));
  });

  it("leaves trailing columns empty when lines run out", () => {
    const art = plainText(`<div style="column-count: 3; column-gap: 4px; width: 56px">aa bb</div>`);
    expect(art).toBe("aa   bb");
  });
});

describe("paragraph flow", () => {
  it("splits a chrome-less text-leaf child across columns at line granularity", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div>aaa bbb ccc</div><div>ddd</div></div>`,
    );
    expect(art).toBe(["aaa  ccc", "bbb  ddd"].join("\n"));
  });

  it("collapses margins between children and truncates them at breaks", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div style="margin-bottom: 8px">aa</div><div style="margin-top: 4px">bb</div><div>cc</div></div>`,
    );
    expect(art).toBe(["aa   bb", "     cc"].join("\n"));
  });

  it("fragments single paragraphs around an in-flow spanner", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div>aaa bbb ccc ddd</div><div style="column-span: all">SPAN</div><div>eee fff</div></div>`,
    );
    expect(art).toBe(["aaa  ccc", "bbb  ddd", "SPAN", "eee  fff"].join("\n"));
  });

  it("splits column rules per segment at an in-flow spanner", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; --mw-rule-x-width: 1px; width: 36px"><div>aaa bbb ccc ddd</div><div style="column-span: all">SPAN</div><div>eee fff</div></div>`,
    );
    expect(art).toBe(["aaa │ccc", "bbb │ddd", "SPAN", "eee │fff"].join("\n"));
  });

  it("flows margined paragraphs around a spanner (gaps as glued padding)", () => {
    // mt-4 (1 row) between the two paragraphs of segment 1: the gap
    // rides as padding-bottom glued under "aa bb", so "cc dd" starts
    // flush atop column 1 (the CSS-truncation look) and the gap row
    // sits invisibly at column 0's bottom.
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div>aa bb</div><div style="margin-top: 4px">cc dd</div><div style="column-span: all">S</div><div>ee</div></div>`,
    );
    expect(art).toBe(["aa   cc", "bb   dd", "", "S", "ee"].join("\n"));
  });

  it("transfers a trailing bottom margin into the spanner's top margin", () => {
    // The companion zeroes native paragraph bottoms, so mb-4 (1 row)
    // before the spanner survives as spanner top margin — a sum, per
    // css-multicol §6.1 (spanner margins don't collapse with content).
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div style="margin-bottom: 4px">aa bb</div><div style="column-span: all">S</div><div>cc</div></div>`,
    );
    expect(art).toBe(["aa   bb", "", "S", "cc"].join("\n"));
  });

  it("glues a gap under a break-inside: avoid paragraph in a spanner flow", () => {
    // The mt-4 (1 row) gap rides as the AVOID unit's trailing pad —
    // monolithic with the whole unit, filling column 0 to the balance
    // height while "cc dd" starts flush atop column 1.
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div style="break-inside: avoid">aa bb</div><div style="margin-top: 4px">cc dd</div><div style="column-span: all">S</div><div>ee</div></div>`,
    );
    expect(art).toBe(["aa   cc", "bb   dd", "", "S", "ee"].join("\n"));
  });

  it("reverts to atomic distribution when any child is decorated", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div>aa bb cc</div><div style="border: 1px solid">x</div></div>`,
    );
    expect(art).toBe(["aa   ┌──┐", "bb   │x │", "cc   └──┘"].join("\n"));
  });

  it("keeps a break-inside: avoid child whole, moving it to the next column", () => {
    const art = plainText(
      `<div style="width: 240px"><div style="column-count: 2; column-gap: 4px; column-fill: auto; width: 36px; height: 12px"><div>aa bb</div><div style="break-inside: avoid">cc dd ee</div><div>ff</div></div></div>`,
    );
    expect(art).toBe(["aa   cc   ff", "bb   dd", "     ee"].join("\n"));
  });

  it("balances around an unbreakable child", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div>aa bb</div><div style="break-inside: avoid">cc dd ee</div><div>ff gg</div></div>`,
    );
    expect(art).toBe(["aa   ff", "bb   gg", "cc", "dd", "ee"].join("\n"));
  });

  it("splits a too-tall avoid child from a fresh column", () => {
    const art = plainText(
      `<div style="width: 240px"><div style="column-count: 2; column-gap: 4px; column-fill: auto; width: 36px; height: 8px"><div>aa</div><div style="break-inside: avoid">cc dd ee</div></div></div>`,
    );
    expect(art).toBe(["aa   cc   ee", "     dd"].join("\n"));
  });

  it("fills flow columns sequentially into a definite height, overflowing past the tracks", () => {
    const art = plainText(
      `<div style="width: 240px"><div style="column-count: 2; column-gap: 4px; column-fill: auto; width: 36px; height: 8px"><div>aa</div><div>bb</div><div>cc</div><div>dd</div><div>ee</div><div>ff</div></div></div>`,
    );
    expect(art).toBe(["aa   cc   ee", "bb   dd   ff"].join("\n"));
  });

  it("paints rules the full flow height", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; --mw-rule-x-width: 1px; width: 36px"><div>aaa bbb</div><div>ccc</div></div>`,
    );
    expect(art).toBe(["aaa │ccc", "bbb │"].join("\n"));
  });

  it("renders column rules through the container's glyph set", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; --mw-rule-x-width: 1px; --mw-border-glyphs: ascii; width: 36px"><div>aaa bbb</div><div>ccc</div></div>`,
    );
    expect(art).toBe(["aaa |ccc", "bbb |"].join("\n"));
  });
});

// Throughout the atomic-path suites below, a paint-only background on
// one child pins the ATOMIC distribution (a decorated child opts the
// container out of paragraph flow) without changing the text output.
describe("element children", () => {
  it("packs children sequentially into balanced columns", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div style="background-color: red">aa</div><div>bb</div><div>cc</div><div>dd</div></div>`,
    );
    expect(art).toBe(["aa   cc", "bb   dd"].join("\n"));
  });

  it("collapses adjacent margins within a column", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; column-fill: auto; width: 36px; height: 16px"><div style="background-color: red; margin-bottom: 8px">aa</div><div style="margin-top: 4px">bb</div></div>`,
    );
    expect(art).toBe(["aa", "", "", "bb"].join("\n"));
  });

  it("truncates a leading margin at the top of a later column", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div style="background-color: red; margin-bottom: 8px">aa</div><div style="margin-top: 4px">bb</div><div>cc</div></div>`,
    );
    expect(art).toBe(["aa   bb", "     cc"].join("\n"));
  });

  it("gives an out-of-flow child its static position in the column flow", () => {
    // The background pins the ATOMIC path, whose pack resolves
    // column-interior static positions.
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div style="background-color: red">aa</div><div>bb</div><div>cc</div><div style="position: absolute">X</div></div>`,
    );
    expect(art).toBe(["aa   cc", "bb   X"].join("\n"));
  });

  it("honors forced column breaks while balancing", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div style="background-color: red; break-after: column">aa</div><div>bb</div><div>cc</div><div>dd</div></div>`,
    );
    expect(art).toBe(["aa   bb", "     cc", "     dd"].join("\n"));
  });
});

describe("column-fill: auto with a definite height", () => {
  it("fills columns sequentially and lays overflow columns after the last track", () => {
    const art = plainText(
      `<div style="width: 240px"><div style="column-count: 2; column-gap: 4px; column-fill: auto; width: 36px; height: 8px"><div style="background-color: red">aa</div><div>bb</div><div>cc</div><div>dd</div><div>ee</div><div>ff</div></div></div>`,
    );
    expect(art).toBe(["aa   cc   ee", "bb   dd   ff"].join("\n"));
  });

  it("clamps a balanced height to the definite height, overflow columns catching the rest", () => {
    const art = plainText(
      `<div style="width: 240px"><div style="column-count: 2; column-gap: 4px; width: 36px; height: 4px"><div style="background-color: red">aa</div><div>bb</div><div>cc</div></div></div>`,
    );
    expect(art).toBe("aa   bb   cc");
  });

  it("restricts column heights by max-height too (css-multicol §7)", () => {
    const art = plainText(
      `<div style="width: 240px"><div style="column-count: 2; column-gap: 4px; width: 36px; max-height: 4px"><div style="background-color: red">aa</div><div>bb</div><div>cc</div></div></div>`,
    );
    expect(art).toBe("aa   bb   cc");
  });

  it("restricts a text leaf's balance by max-height", () => {
    const art = plainText(
      `<div style="width: 240px"><div style="column-count: 2; column-gap: 4px; width: 36px; max-height: 4px">aaa bbb ccc</div></div>`,
    );
    expect(art).toBe("aaa  bbb  ccc");
  });
});

describe("spanners", () => {
  it("splits the flow into stacked segments around a column-span: all child", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; width: 36px"><div style="background-color: red">aa</div><div>bb</div><div style="column-span: all">SPAN</div><div>cc</div><div>dd</div></div>`,
    );
    expect(art).toBe(["aa   bb", "SPAN", "cc   dd"].join("\n"));
  });
});

describe("column rules", () => {
  it("paints a rule in each gap of a text leaf", () => {
    const art = plainText(
      `<div style="column-count: 3; column-gap: 4px; --mw-rule-x-width: 1px; width: 56px">aa bb cc</div>`,
    );
    expect(art).toBe("aa  │bb  │cc");
  });

  it("hides the rule beside an empty trailing column by default", () => {
    const art = plainText(
      `<div style="column-count: 3; column-gap: 4px; --mw-rule-x-width: 1px; width: 56px">aa bb</div>`,
    );
    expect(art).toBe("aa  │bb");
  });

  it("paints every gap under rule-visibility-items: all", () => {
    const art = plainText(
      `<div style="column-count: 3; column-gap: 4px; --mw-rule-x-width: 1px; --mw-rule-visibility-items: all; width: 56px">aa bb</div>`,
    );
    expect(art).toBe("aa  │bb  │");
  });

  it("runs rules the full height of element-children columns and splits at spanners", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; --mw-rule-x-width: 1px; width: 36px"><div style="background-color: red">aa</div><div>bb</div><div style="column-span: all">SPAN</div><div>cc</div><div>dd</div></div>`,
    );
    expect(art).toBe(["aa  │bb", "SPAN", "cc  │dd"].join("\n"));
  });

  it("tees a full-height rule into the container's border ring", () => {
    const art = plainText(
      `<div style="column-count: 2; column-gap: 4px; --mw-rule-x-width: 1px; border: 1px solid; width: 44px">aaa bbb</div>`,
    );
    expect(art).toBe(["┌────┬────┐", "│aaa │bbb │", "└────┴────┘"].join("\n"));
  });
});
