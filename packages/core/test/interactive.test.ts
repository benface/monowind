import { expect, it } from "vitest";
import { markInteractivity } from "../src/element.ts";

/** The interactive light elements and the composites' containers
 * (specs/cell-model.md "Pointer states"), as the marks the companion's
 * rules key on. */

const marks = (html: string) => {
  const box = document.createElement("div");
  box.innerHTML = html;
  const el = box.firstElementChild!;
  markInteractivity(el);
  return {
    interactive: el.hasAttribute("data-mw-interactive"),
    composite: el.hasAttribute("data-mw-composite"),
  };
};

it("marks the natively interactive, a focus target, and the ARIA widgets interactive", () => {
  for (const html of [
    "<a>link</a>",
    "<button>b</button>",
    "<input>",
    "<select></select>",
    "<textarea></textarea>",
    "<label>l</label>",
    "<summary>s</summary>",
    "<div contenteditable>e</div>",
    '<div contenteditable="plaintext-only">e</div>',
    '<div tabindex="0">t</div>',
    '<div role="button">w</div>',
    '<div role="menuitem">w</div>',
    '<div role="menuitemcheckbox">w</div>',
    '<div role="option">w</div>',
    '<div role="tab">w</div>',
    '<div role="treeitem">w</div>',
    '<div role="checkbox">w</div>',
    '<div role="radio">w</div>',
    '<div role="switch">w</div>',
    '<div role="slider">w</div>',
    '<div role="link">w</div>',
    '<div role="combobox">w</div>',
  ]) {
    expect(marks(html), html).toEqual({ interactive: true, composite: false });
  }
});

it("leaves plain elements, a focus target of -1, and an editable island unmarked", () => {
  for (const html of [
    "<div>d</div>",
    "<span>s</span>",
    '<div tabindex="-1">t</div>',
    '<div contenteditable="false">e</div>',
    '<div role="region" tabindex="-1">r</div>',
  ]) {
    expect(marks(html), html).toEqual({ interactive: false, composite: false });
  }
});

it("marks a composite's container a composite, never interactive, focusable or not", () => {
  for (const role of [
    "grid",
    "listbox",
    "menu",
    "menubar",
    "radiogroup",
    "tablist",
    "tree",
    "treegrid",
  ]) {
    for (const html of [
      `<div role="${role}" tabindex="0">c</div>`,
      `<div role="${role}">c</div>`,
    ]) {
      expect(marks(html), html).toEqual({ interactive: false, composite: true });
    }
  }
});

it("clears a mark the element no longer earns", () => {
  const el = document.createElement("div");
  el.tabIndex = 0;
  markInteractivity(el);
  expect(el.hasAttribute("data-mw-interactive")).toBe(true);
  el.setAttribute("role", "listbox");
  markInteractivity(el);
  expect(el.hasAttribute("data-mw-interactive")).toBe(false);
  expect(el.hasAttribute("data-mw-composite")).toBe(true);
  el.removeAttribute("role");
  el.tabIndex = -1;
  markInteractivity(el);
  expect(el.hasAttribute("data-mw-interactive")).toBe(false);
  expect(el.hasAttribute("data-mw-composite")).toBe(false);
});
