import { describe, expect, it } from "vitest";
import { renderPlainText } from "../src/plain-text.ts";
import { layoutRoot } from "../src/layout.ts";
import { buildTree } from "../src/tree.ts";

/**
 * Gap decorations (specs/gap-decorations.md), DOM → plain text: rules are
 * authored through the --mw-rule-* mirrors (what the utilities set),
 * floor the gap, and paint centered runs with junctions and border tees.
 */

function plainText(html: string, availableWidth = 60): string {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  const node = buildTree(host.firstElementChild!, 16)!;
  layoutRoot(node, availableWidth);
  return renderPlainText(node);
}

describe("gap rules", () => {
  it("floors the gap and paints a centered column rule in a flex row", () => {
    const art = plainText(
      `<div style="display: flex; --mw-rule-x-width: 1px"><div>aa</div><div>bb</div></div>`,
    );
    expect(art).toBe("aa│bb");
  });

  it("tees a full-height rule into the container's border ring", () => {
    const art = plainText(
      `<div style="display: flex; width: 28px; border: 1px solid; --mw-rule-x-width: 1px"><div>aa</div><div>bb</div></div>`,
    );
    expect(art).toBe(["┌──┬──┐", "│aa│bb│", "└──┴──┘"].join("\n"));
  });

  it("crosses column and row rules with a junction in a grid", () => {
    const art = plainText(
      `<div style="display: grid; grid-template-columns: 8px 8px; column-gap: 4px; row-gap: 4px; --mw-rule-x-width: 1px; --mw-rule-y-width: 1px">
        <div>a</div><div>b</div><div>c</div><div>d</div>
      </div>`,
    );
    expect(art).toBe(["a │b", "──┼──", "c │d"].join("\n"));
  });

  it("draws row rules across a flex column at full width", () => {
    const art = plainText(
      `<div style="display: flex; flex-direction: column; --mw-rule-y-width: 1px; width: 20px"><div>one</div><div>two</div></div>`,
    );
    expect(art).toBe(["one", "─────", "two"].join("\n"));
  });

  it("honors rule style (dashed) via the style mirror", () => {
    const art = plainText(
      `<div style="display: flex; --mw-rule-x-width: 1px; --mw-rule-x-style: dashed"><div>aa</div><div>bb</div></div>`,
    );
    expect(art).toBe("aa╎bb");
  });

  it("tees row rules into the left/right border ring of a column", () => {
    const art = plainText(
      `<div style="display: flex; flex-direction: column; width: 28px; border: 1px solid; --mw-rule-y-width: 1px"><div>one</div><div>two</div></div>`,
    );
    expect(art).toBe(["┌─────┐", "│one  │", "├─────┤", "│two  │", "└─────┘"].join("\n"));
  });

  it("draws row rules between wrapped flex lines", () => {
    const art = plainText(
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

  it("breaks the column rule at a spanning item and its T intersections", () => {
    const art = plainText(
      `<div style="display: grid; grid-template-columns: 8px 8px; column-gap: 4px; row-gap: 4px; --mw-rule-x-width: 1px">
        <div>a</div><div>b</div>
        <div style="grid-column-start: 1; grid-column-end: 3">cc</div>
      </div>`,
    );
    expect(art).toBe(["a │b", "", "cc"].join("\n"));
  });

  it("runs through the crossing gap up to the spanning item with rule-break none", () => {
    const art = plainText(
      `<div style="display: grid; grid-template-columns: 8px 8px; column-gap: 4px; row-gap: 4px; --mw-rule-x-width: 1px; --mw-rule-break: none">
        <div>a</div><div>b</div>
        <div style="grid-column-start: 1; grid-column-end: 3">cc</div>
      </div>`,
    );
    expect(art).toBe(["a │b", "  │", "cc"].join("\n"));
  });

  it("splits rules into per-cell segments with rule-break intersection", () => {
    const art = plainText(
      `<div style="display: grid; grid-template-columns: 8px 8px; column-gap: 4px; row-gap: 4px; --mw-rule-x-width: 1px; --mw-rule-y-width: 1px; --mw-rule-break: intersection">
        <div>a</div><div>b</div><div>c</div><div>d</div>
      </div>`,
    );
    expect(art).toBe(["a │b", "── ──", "c │d"].join("\n"));
  });

  it("retracts segment endpoints by rule-inset", () => {
    const art = plainText(
      `<div style="display: grid; grid-template-columns: 8px 8px; column-gap: 4px; row-gap: 4px; --mw-rule-x-width: 1px; --mw-rule-inset: 1px">
        <div>a</div><div>b</div><div>c</div><div>d</div>
      </div>`,
    );
    expect(art).toBe(["a  b", "  │", "c  d"].join("\n"));
  });

  it("drops segments beside empty cells with rule-visibility between", () => {
    const art = plainText(
      `<div style="display: grid; grid-template-columns: 8px 8px; column-gap: 4px; row-gap: 4px; --mw-rule-x-width: 1px; --mw-rule-visibility-items: between">
        <div>a</div><div>b</div><div>c</div>
      </div>`,
    );
    expect(art).toBe(["a │b", "", "c"].join("\n"));
  });

  it("keeps segments with one occupied side under rule-visibility around", () => {
    const art = plainText(
      `<div style="display: grid; grid-template-columns: 8px 8px; column-gap: 4px; row-gap: 4px; --mw-rule-x-width: 1px; --mw-rule-visibility-items: around">
        <div>a</div><div>b</div><div>c</div>
      </div>`,
    );
    expect(art).toBe(["a │b", "  │", "c │"].join("\n"));
  });

  it("breaks a wrapped flex row rule at the lines' column-gap intersections", () => {
    const art = plainText(
      `<div style="display: flex; flex-wrap: wrap; width: 20px; --mw-rule-x-width: 1px; --mw-rule-y-width: 1px; --mw-rule-break: intersection"><div>aa</div><div>bb</div><div>cccc</div></div>`,
    );
    expect(art).toBe(["aa│bb", "── ──", "cccc"].join("\n"));
  });

  it("distinguishes all from around across a fully empty row", () => {
    const markup = (visibility: string) =>
      `<div style="display: grid; grid-template-columns: 4px 4px; grid-auto-rows: 4px; column-gap: 4px; row-gap: 4px; --mw-rule-x-width: 1px; --mw-rule-visibility-items: ${visibility}">
        <div>a</div><div>b</div>
        <div style="grid-row-start: 3">c</div>
      </div>`;
    // `all` paints through the empty row 2; `around` needs an occupied
    // side, so the rule holes there and returns beside the lone item.
    expect(plainText(markup("all"))).toBe(["a│b", " │", " │", " │", "c│"].join("\n"));
    expect(plainText(markup("around"))).toBe(["a│b", "", "", "", "c│"].join("\n"));
  });

  it("retracts flex rule bands by rule-inset", () => {
    const art = plainText(
      `<div style="display: flex; flex-direction: column; width: 20px; --mw-rule-y-width: 1px; --mw-rule-inset: 1px"><div>one</div><div>two</div></div>`,
    );
    expect(art).toBe(["one", " ───", "two"].join("\n"));
  });

  it("widens the gap for a rule wider than the authored gap", () => {
    const art = plainText(
      `<div style="display: flex; column-gap: 4px; --mw-rule-x-width: 2px"><div>aa</div><div>bb</div></div>`,
    );
    expect(art).toBe("aa││bb");
  });
});
