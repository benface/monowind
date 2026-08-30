import { describe, expect, it, vi } from "vitest";
import { renderAscii } from "../src/ascii.ts";
import { layoutRoot } from "../src/layout.ts";
import { buildTree } from "../src/tree.ts";
import type { LayoutNode } from "../src/types.ts";

/**
 * Table layout tests (specs/table.md), DOM → ASCII end to end: happy-dom
 * parses real table markup (auto-inserting <tbody>, inheriting
 * border-collapse), the tag fallback supplies the roles, and the ASCII
 * renderer exposes the lattice. Root font size 16 → 1 cell = 4px.
 */

function build(html: string): LayoutNode {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  return buildTree(host.firstElementChild!, 16)!;
}

function ascii(html: string, availableWidth = 60): string {
  const node = build(html);
  layoutRoot(node, availableWidth);
  return renderAscii(node);
}

const CELL_BORDER = "border: 1px solid";

describe("collapsed borders", () => {
  it("renders adjacent cells as a shared lattice with tee junctions", () => {
    const art = ascii(
      `<table style="border-collapse: collapse">
        <tr><td style="${CELL_BORDER}">hello</td><td style="${CELL_BORDER}">hello</td></tr>
      </table>`,
    );
    expect(art).toBe(["┌─────┬─────┐", "│hello│hello│", "└─────┴─────┘"].join("\n"));
  });

  it("renders a 2×2 grid with a full cross junction", () => {
    const art = ascii(
      `<table style="border-collapse: collapse">
        <tr><td style="${CELL_BORDER}">aa</td><td style="${CELL_BORDER}">bb</td></tr>
        <tr><td style="${CELL_BORDER}">cc</td><td style="${CELL_BORDER}">dd</td></tr>
      </table>`,
    );
    expect(art).toBe(["┌──┬──┐", "│aa│bb│", "├──┼──┤", "│cc│dd│", "└──┴──┘"].join("\n"));
  });

  it("suppresses lattice segments through a colspan and tees around it", () => {
    const art = ascii(
      `<table style="border-collapse: collapse">
        <tr><td colspan="2" style="${CELL_BORDER}">wide</td></tr>
        <tr><td style="${CELL_BORDER}">aa</td><td style="${CELL_BORDER}">bb</td></tr>
      </table>`,
    );
    expect(art).toBe(["┌─────┐", "│wide │", "├──┬──┤", "│aa│bb│", "└──┴──┘"].join("\n"));
  });

  it("row side borders (border-l/r on tr) draw at the table's edge lines", () => {
    const art = ascii(
      `<table style="border-collapse: collapse">
        <tr style="border-left: 1px solid; border-right: 1px solid"><td>aa</td></tr>
      </table>`,
    );
    expect(art).toBe("│aa│");
  });

  it("row borders (border-b on tr) draw full-width lines, cells win conflicts", () => {
    const art = ascii(
      `<table style="border-collapse: collapse">
        <tr style="border-bottom: 1px solid"><td>aa</td><td>bb</td></tr>
        <tr><td>cc</td><td>dd</td></tr>
      </table>`,
    );
    expect(art).toBe(["aabb", "────", "ccdd"].join("\n"));
  });

  it("border-hidden suppresses the shared segment, beating the neighbor", () => {
    const art = ascii(
      `<table style="border-collapse: collapse">
        <tr><td style="border: 1px solid; border-right-style: hidden">aa</td><td style="${CELL_BORDER}">bb</td></tr>
      </table>`,
    );
    // The shared line vanishes entirely (width 0), fusing the cells.
    expect(art).toBe(["┌────┐", "│aabb│", "└────┘"].join("\n"));
  });

  it("double borders win over solid and use the double junction set", () => {
    const art = ascii(
      `<table style="border-collapse: collapse">
        <tr><td style="border: 3px double">aa</td><td style="${CELL_BORDER}">bb</td></tr>
      </table>`,
    );
    // 3px quantizes to 1 cell: same width, double outranks solid at the
    // shared line. Mixed-style junctions fall back to the light set, so
    // only the all-double corner shows the double junction.
    expect(art).toContain("║");
    expect(art).toContain("╔");
  });
});

describe("separate borders", () => {
  it("gives every cell its own ring, spaced by border-spacing", () => {
    const art = ascii(
      `<table style="border-spacing: 4px">
        <tr><td style="${CELL_BORDER}">aa</td><td style="${CELL_BORDER}">bb</td></tr>
      </table>`,
    );
    expect(art).toBe(["", " ┌──┐ ┌──┐", " │aa│ │bb│", " └──┘ └──┘", ""].join("\n"));
  });

  it("zero spacing renders rings back to back", () => {
    const art = ascii(
      `<table><tr><td style="${CELL_BORDER}">aa</td><td style="${CELL_BORDER}">bb</td></tr></table>`,
    );
    expect(art).toBe(["┌──┐┌──┐", "│aa││bb│", "└──┘└──┘"].join("\n"));
  });
});

describe("column sizing", () => {
  it("sizes columns to their widest cell and shrink-to-fits the table", () => {
    const node = build(
      `<table><tr><td>ab</td><td>abcdef</td></tr><tr><td>abcd</td><td>x</td></tr></table>`,
    );
    layoutRoot(node, 60);
    expect(node.localRect.width).toBe(10); // 4 + 6, no borders
  });

  it("wraps cell text when a fixed cell width caps the column", () => {
    const art = ascii(`<table><tr><td style="width: 12px">aa bb</td></tr></table>`);
    expect(art).toBe(["aa", "bb"].join("\n"));
  });

  it("honors <col> widths", () => {
    const node = build(
      `<table><colgroup><col style="width: 32px"><col style="width: 16px"></colgroup>
        <tr><td>a</td><td>b</td></tr></table>`,
    );
    layoutRoot(node, 60);
    const row = node.children.find((c) => c.style.tableRole !== "column-group")!;
    const cells = row.children[0]!.children;
    expect(cells.map((c) => c.localRect.width)).toEqual([8, 4]);
  });

  it("distributes a colspan cell's excess over the spanned columns", () => {
    const node = build(
      `<table><tr><td colspan="2">abcdefgh</td></tr><tr><td>ab</td><td>ab</td></tr></table>`,
    );
    layoutRoot(node, 60);
    expect(node.localRect.width).toBe(8);
  });

  it("inflates the table to full width for a 100% cell", () => {
    const node = build(`<table><tr><td style="width:100%">hello</td><td>hello</td></tr></table>`);
    layoutRoot(node, 40);
    expect(node.localRect.width).toBe(40);
    const row = node.children[0]!.children[0]!;
    expect(row.children.map((c) => c.localRect.width)).toEqual([35, 5]);
  });

  it("inflates a 50% column to double the rest (probed browser behavior)", () => {
    const node = build(`<table><tr><td style="width:50%">ab</td><td>abcdefgh</td></tr></table>`);
    layoutRoot(node, 60);
    // Non-percent max 8 ÷ (1 − 0.5) = 16; 50% of 16 = 8 each.
    expect(node.localRect.width).toBe(16);
    const row = node.children[0]!.children[0]!;
    expect(row.children.map((c) => c.localRect.width)).toEqual([8, 8]);
  });

  it("table-fixed splits the width equally among unsized columns", () => {
    const node = build(
      `<table style="table-layout: fixed; width: 48px">
        <tr><td>abcdefghij</td><td>x</td></tr></table>`,
    );
    layoutRoot(node, 60);
    const row = node.children[0]!.children[0]!;
    expect(row.children.map((c) => c.localRect.width)).toEqual([6, 6]);
  });

  it("shrink-to-fits a rowless table (text leaf) instead of filling", () => {
    const node = build(`<table>plain text</table>`);
    layoutRoot(node, 60);
    expect(node.localRect.width).toBe(10);
  });

  it("floors an authored table width at the min-content sum", () => {
    const node = build(`<table style="width: 4px"><tr><td>abcdef</td></tr></table>`);
    layoutRoot(node, 60);
    expect(node.localRect.width).toBe(6);
  });
});

describe("rows and spans", () => {
  it("sizes rows to their tallest cell; short cells center via UA vertical-align", () => {
    const art = ascii(`<table><tr><td>a<br>b<br>c</td><td>x</td></tr></table>`);
    expect(art).toBe(["a", "bx", "c"].join("\n"));
  });

  it("aligns cells top and bottom via inline vertical-align", () => {
    const art = ascii(
      `<table><tr><td>a<br>b<br>c</td><td style="vertical-align: top">t</td><td style="vertical-align: bottom">z</td></tr></table>`,
    );
    expect(art).toBe(["at", "b", "c z"].join("\n"));
  });

  it("distributes a rowspan cell's excess height over the spanned rows", () => {
    const node = build(
      `<table><tr><td rowspan="2">a<br>b<br>c<br>d</td><td>x</td></tr><tr><td>y</td></tr></table>`,
    );
    layoutRoot(node, 60);
    const rows = node.children[0]!.children;
    expect(rows.map((r) => r.localRect.height)).toEqual([2, 2]);
  });

  it("rowspan 0 spans to the end of the row group", () => {
    const node = build(
      `<table><tbody>
        <tr><td rowspan="0">s</td><td>a</td></tr>
        <tr><td>b</td></tr>
        <tr><td>c</td></tr>
      </tbody></table>`,
    );
    layoutRoot(node, 60);
    const cell = node.children[0]!.children[0]!.children[0]!;
    expect(cell.localRect.height).toBe(3);
  });

  it("pins percent rows against a definite table height, rest to the others (probed)", () => {
    const node = build(
      `<table style="height: 112px"><tr style="height: 50%"><td>a</td></tr><tr><td>b</td></tr></table>`,
    );
    layoutRoot(node, 60);
    const rows = node.children[0]!.children;
    expect(rows.map((r) => r.localRect.height)).toEqual([14, 14]);
  });

  it("ignores percent row heights when the table height is auto (probed)", () => {
    const node = build(`<table><tr style="height: 50%"><td>a</td></tr><tr><td>b</td></tr></table>`);
    layoutRoot(node, 60);
    const rows = node.children[0]!.children;
    expect(rows.map((r) => r.localRect.height)).toEqual([1, 1]);
  });

  it("lets a percent CELL height floor its row too", () => {
    const node = build(
      `<table style="height: 112px"><tr><td style="height: 25%">a</td></tr><tr><td>b</td></tr></table>`,
    );
    layoutRoot(node, 60);
    const rows = node.children[0]!.children;
    expect(rows.map((r) => r.localRect.height)).toEqual([7, 21]);
  });

  it("distributes extra authored table height equally to rows", () => {
    const node = build(
      `<table style="height: 24px"><tr><td>a</td></tr><tr><td>b</td></tr></table>`,
    );
    layoutRoot(node, 60);
    const rows = node.children[0]!.children;
    expect(rows.map((r) => r.localRect.height)).toEqual([3, 3]);
  });
});

describe("percent heights and legacy attributes", () => {
  it("resolves h-full children against the final row height (second pass)", () => {
    const node = build(
      `<table><tr><td>a<br>b<br>c</td><td><div style="height:100%">x</div></td></tr></table>`,
    );
    layoutRoot(node, 60);
    const cells = node.children[0]!.children[0]!.children;
    const full = cells[1]!.children[0]!;
    expect(cells[1]!.localRect.height).toBe(3);
    expect(full.localRect.height).toBe(3);
  });

  it("centers content in a cell made tall by its own explicit height", () => {
    const art = ascii(`<table><tr><td style="height: 12px">x</td></tr></table>`);
    expect(art).toBe(["", "x", ""].join("\n"));
  });

  it("table-fixed without an authored width falls back to the auto algorithm", () => {
    const node = build(
      `<table style="table-layout: fixed"><tr><td>abcdefgh</td><td>x</td></tr></table>`,
    );
    layoutRoot(node, 60);
    const row = node.children[0]!.children[0]!;
    expect(row.children.map((c) => c.localRect.width)).toEqual([8, 1]);
  });

  it("honors the legacy valign attribute and blocks align=center", () => {
    const art = ascii(`<table><tr><td>a<br>b<br>c</td><td valign="bottom">z</td></tr></table>`);
    expect(art).toBe(["a", "b", "cz"].join("\n"));
    const node = build(`<table><tr><td align="center">x</td></tr></table>`);
    const cell = node.children[0]!.children[0]!.children[0]!;
    expect(cell.style.textAlignBlocked).toBe(true);
  });
});

describe("integration", () => {
  it("lays out nested tables (a table inside a cell)", () => {
    const art = ascii(
      `<table style="border-collapse: collapse"><tr><td style="border: 1px solid">
        <table><tr><td>in</td><td>ner</td></tr></table>
      </td><td style="border: 1px solid">out</td></tr></table>`,
    );
    expect(art).toBe(["┌─────┬───┐", "│inner│out│", "└─────┴───┘"].join("\n"));
  });

  it("sizes a table as a flex item from its intrinsic widths", () => {
    const node = build(
      `<div style="display: flex"><table><tr><td>abcd</td><td>ef</td></tr></table><div>rest of the row</div></div>`,
    );
    layoutRoot(node, 60);
    const [table, sibling] = node.children;
    expect(table!.localRect.width).toBe(6);
    expect(sibling!.localRect.x).toBe(6);
  });

  it("tolerates an empty row", () => {
    const node = build(`<table><tr></tr><tr><td>a</td></tr></table>`);
    layoutRoot(node, 60);
    expect(node.localRect).toMatchObject({ width: 1, height: 1 });
  });
});

describe("out-of-flow and container cells", () => {
  it("shifts a container cell's block children for vertical-align", () => {
    const art = ascii(
      `<table><tr><td>a<br>b<br>c</td><td><div>x</div><div>y</div></td></tr></table>`,
    );
    // The container cell's two blocks center as a unit (UA middle;
    // delta 1 floors to a 0 offset, so they hug the top).
    expect(art).toBe(["ax", "by", "c"].join("\n"));
  });

  it("anchors an abspos child of the table at the content origin", () => {
    // Imperative: the HTML parser would foster-parent the div out.
    const table = document.createElement("table");
    table.setAttribute("style", "position: relative");
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.textContent = "abc";
    tr.appendChild(td);
    const abs = document.createElement("div");
    abs.setAttribute("style", "position: absolute; top: 0; right: 0");
    abs.textContent = "z";
    table.append(tr, abs);
    document.body.appendChild(table);
    const node = buildTree(table, 16)!;
    layoutRoot(node, 60);
    const absNode = node.children.find((c) => c.style.position === "absolute")!;
    expect(absNode.localRect.x).toBe(2);
    expect(absNode.localRect.y).toBe(0);
  });
});

describe("structure", () => {
  it("renders thead first and tfoot last regardless of DOM order", () => {
    const art = ascii(
      `<table>
        <tfoot><tr><td>foot</td></tr></tfoot>
        <thead><tr><td>head</td></tr></thead>
        <tbody><tr><td>body</td></tr></tbody>
      </table>`,
    );
    expect(art).toBe(["head", "body", "foot"].join("\n"));
  });

  it("places a caption above (default) or below the grid", () => {
    expect(ascii(`<table><caption>cap</caption><tr><td>body</td></tr></table>`)).toBe(
      ["cap", "body"].join("\n"),
    );
    expect(
      ascii(
        `<table style="caption-side: bottom"><caption>cap</caption><tr><td>body</td></tr></table>`,
      ),
    ).toBe(["body", "cap"].join("\n"));
  });

  it("hides misparented content with a one-time warning", () => {
    // Built imperatively: the HTML parser (happy-dom's included) would
    // relocate a stray div, and happy-dom blockifies inline
    // `display: table-cell`, so tag-based roles + appendChild it is.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const table = document.createElement("table");
      const stray = document.createElement("div");
      stray.textContent = "oops";
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.textContent = "ok";
      tr.appendChild(td);
      table.append(stray, tr);
      document.body.appendChild(table);
      const node = buildTree(table, 16)!;
      layoutRoot(node, 60);
      expect(renderAscii(node)).toBe("ok");
      expect(warn).toHaveBeenCalledOnce();
      expect(node.children[0]!.tableHidden).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("skips blocked columns when placing cells after a rowspan", () => {
    const art = ascii(
      `<table style="border-collapse: collapse">
        <tr><td rowspan="2" style="${CELL_BORDER}">s</td><td style="${CELL_BORDER}">a</td></tr>
        <tr><td style="${CELL_BORDER}">b</td></tr>
      </table>`,
    );
    // The rowspan cell's content centers in its 3-row area (UA middle).
    expect(art).toBe(["┌─┬─┐", "│ │a│", "│s├─┤", "│ │b│", "└─┴─┘"].join("\n"));
  });
});
