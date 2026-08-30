import { describe, expect, it } from "vitest";
import { renderAscii } from "../src/ascii.ts";
import { layoutRoot } from "../src/layout.ts";
import { buildTree } from "../src/tree.ts";

/**
 * Gap decorations (specs/gap-decorations.md), DOM → ASCII: rules are
 * authored through the --mw-rule-* mirrors (what the utilities set),
 * floor the gap, and paint centered runs with junctions and border tees.
 */

function ascii(html: string, availableWidth = 60): string {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  const node = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(node, availableWidth);
  return renderAscii(node);
}

describe("gap rules", () => {
  it("floors the gap and paints a centered column rule in a flex row", () => {
    const art = ascii(
      `<div style="display: flex; --mw-rule-x-width: 1px"><div>aa</div><div>bb</div></div>`,
    );
    expect(art).toBe("aa│bb");
  });

  it("tees a full-height rule into the container's border ring", () => {
    const art = ascii(
      `<div style="display: flex; width: 28px; border: 1px solid; --mw-rule-x-width: 1px"><div>aa</div><div>bb</div></div>`,
    );
    expect(art).toBe(["┌──┬──┐", "│aa│bb│", "└──┴──┘"].join("\n"));
  });

  it("crosses column and row rules with a junction in a grid", () => {
    const art = ascii(
      `<div style="display: grid; grid-template-columns: 8px 8px; gap: 4px; --mw-rule-x-width: 1px; --mw-rule-y-width: 1px">
        <div>a</div><div>b</div><div>c</div><div>d</div>
      </div>`,
    );
    expect(art).toBe(["a │b", "──┼──", "c │d"].join("\n"));
  });

  it("draws row rules across a flex column at full width", () => {
    const art = ascii(
      `<div style="display: flex; flex-direction: column; --mw-rule-y-width: 1px; width: 20px"><div>one</div><div>two</div></div>`,
    );
    expect(art).toBe(["one", "─────", "two"].join("\n"));
  });

  it("honors rule style (dashed) via the style mirror", () => {
    const art = ascii(
      `<div style="display: flex; --mw-rule-x-width: 1px; --mw-rule-x-style: dashed"><div>aa</div><div>bb</div></div>`,
    );
    expect(art).toBe("aa╎bb");
  });

  it("tees row rules into the left/right border ring of a column", () => {
    const art = ascii(
      `<div style="display: flex; flex-direction: column; width: 28px; border: 1px solid; --mw-rule-y-width: 1px"><div>one</div><div>two</div></div>`,
    );
    expect(art).toBe(["┌─────┐", "│one  │", "├─────┤", "│two  │", "└─────┘"].join("\n"));
  });

  it("draws row rules between wrapped flex lines", () => {
    const art = ascii(
      `<div style="display: flex; flex-wrap: wrap; width: 20px; --mw-rule-x-width: 1px; --mw-rule-y-width: 1px"><div>aa</div><div>bb</div><div>cccc</div></div>`,
    );
    // The line-1 vertical rule junctions into the row rule below.
    expect(art).toBe(["aa│bb", "──┴──", "cccc"].join("\n"));
  });

  it("defaults the rule color to the container's currentColor", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div style="display: flex; color: red; --mw-rule-x-width: 1px"><div>aa</div><div>bb</div></div>`;
    document.body.appendChild(host);
    const node = buildTree(host.firstElementChild!, 16)!;
    layoutRoot(node, 60);
    expect(node.decorationRuns![0]!.color).toBe("red");
  });

  it("widens the gap for a rule wider than the authored gap", () => {
    const art = ascii(
      `<div style="display: flex; column-gap: 4px; --mw-rule-x-width: 2px"><div>aa</div><div>bb</div></div>`,
    );
    expect(art).toBe("aa││bb");
  });
});
