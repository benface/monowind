# A component nested in another's markup

Status: **implemented 2026-09-30**; D1 and D2 decided with the user
the same day as recommended, D3 reversed with them after: the rule
made `partsOutside` redundant for elements, and a vanilla nested
disclosure is marked `data-part="root"` like any other component, so
it is gone. One refinement of D1 (a) on the way: every element
`defineElement` makes is a root, `<mono-submenu>` included (it was
already one by its `data-part="submenu"`), so the rule has no
exception: a static `ROOT` on `MonoElement`, read through
`customElements.get`.

## The bug

A component's mount finds its parts once, with `parts(root, name)` and
`part(root, name)` (`packages/ui/src/vanilla.ts`): every element under
the root marked `data-part="…"`, less those under a `submenu` root. A
component nested in another's markup is none of those, so its parts
are the outer one's too:

- **Triggers are claimed twice.** An anchored component takes every
  `trigger` under its root (`mountAnchored`). A `<mono-select>` in a
  `<mono-dialog>`'s form gets the dialog's trigger props: probed in
  happy-dom, its button carries `aria-haspopup="dialog"` and
  `aria-controls="dialog:d:content"`, and a click on it opens the
  dialog. A tooltip on a button in a dialog, a menu in a popover, a
  combobox in a dialog: the same.
- **A single part goes to the first in document order.** `part()` takes
  the first `positioner`, `content`, `title`, `label`, … under the root.
  The outer's own comes first where the nested component sits inside
  the outer's content, but a tooltip on a button placed before the
  dialog's own positioner hands the dialog the tooltip's.
- **The elements count a nested one's parts as their own.** An
  element's observer mounts it again when its `[data-part]`
  descendants change (`#keepsParts`), a nested element's included:
  items a framework adds to a `<mono-listbox>` in a `<mono-dialog>`
  remount the dialog too.

The disclosures are safe inside their content: `partsOutside` skips a
part inside a `content` of their own (`a2cd74f`). The item markers are
safe since the same commit (`element.ts` `#owns`, the nearest mounting
element above a part). The framework packages build their parts from
their component tree and never query markup.

## The rule

A part belongs to its nearest root: walking up from the part, the first
root met is its component's. A root is the mount's own element, and
under it:

- a `submenu` root (`data-part="submenu"`), as today;
- a nested component's root, recognised as D1 decides.

`parts()` keeps the parts whose walk reaches the mount's root before
any other root; `part()` is the first of those. Both run once per
mount, so the walk costs nothing per render.

## Decisions for the user

- **D1 — how a nested root is recognised.**
  - (a) _(recommended)_ By markup alone, whatever the mount order:
    - an element made by `defineElement` that mounts its own markup
      (`customElements.get(tag)` whose class's `definition` has a
      `mount`: every `<mono-*>` but `<mono-submenu>`, and an
      author's own), so the elements need nothing from the author;
    - `data-part="root"` on markup a vanilla mount nests, the anatomy's
      name for a component's root. Zag already writes it on a listbox's,
      a select's, a combobox's, a collapsible's and an accordion's root
      once mounted; an author nesting components by script writes it
      in the markup, as a submenu's root is written `data-part="submenu"`.
  - (b) By mount order: each mount registers its root, and parts under
    a registered root are another's. Nothing to write in the markup,
    but a vanilla page must mount the inner component first, and an
    element must defer its mount a microtask, since the parser and
    `innerHTML` connect the outer element before the inner one
    upgrades.
- **D2 — the elements follow the same rule.** `#hasParts`,
  `#keepsParts`, `#parts` and `#owns` (`element.ts`) take a part as
  theirs by it, so an inner element's markup changes no longer mount
  the outer one again. _(Recommended: yes; `#owns` becomes the rule.)_
- **D3 — `partsOutside` stays.** A disclosure nested in another's
  content needs no mark today, and dropping that would ask vanilla
  authors for one. _(Recommended: keep it beside the rule.)_

## Milestones

Each step's tests are seen failing first.

1. **The rule** (`vanilla.ts`): a `rootAbove(part, root)` walk; `parts()`
   and `part()` on it. Tests (`test/vanilla.test.ts`, one per case):
   - a select element in a dialog element keeps its trigger, and a click
     on it opens the select alone (the probe);
   - a tooltip element on a button in a dialog's content keeps its
     trigger;
   - a tooltip element placed before a dialog's own parts leaves the
     dialog its own positioner;
   - by script, a dialog root holding a select root marked
     `data-part="root"`, the dialog mounted first (D1 a);
   - a menu's submenus as today (the menu tests unchanged).
2. **The elements** (D2): `element.ts` on the same rule. Test
   (`elements.test.ts`): items added to a listbox element in a dialog
   element remount the listbox alone.
3. **A story**: `ElementsNested`, test-only (`["!dev", "!golden"]`
   unless its paint earns a golden): a dialog holding a form with a
   select and a button that carries a tooltip — the dialog opened, the
   select opened and chosen from with the dialog staying open, the
   tooltip shown on hover. The first story with a floating part opened
   from inside another's, both in the top layer.
4. **Docs**: ui.md's "The mount follows the markup" and the parts'
   ownership; `packages/ui/README.md`'s parts (the `data-part="root"`
   mark for components nested by script; elements need none).
5. **Verification**: `packages/ui` unit tests; the UI story file in
   three engines; `pnpm check` (its log read) and `pnpm test`; the
   visual goldens scoped to `packages-ui--` (none should change).

## Found on the way

- **The story's host was too small, not the layering.** A first
  `ElementsNested` had the dialog and the select's list painted past
  its 90px host: a floating part lives in its host, so the story gives
  the page lines to open over, as `Dialog` does. The nested top layer
  paints right.

## Risks

- **A floating part opened from inside another's.** The select's
  positioner opens in the top layer while the dialog's is there, which
  no story does yet; the engine's layering (`specs/layers.md`,
  `specs/top-layer.md`) may show something the story then has to
  answer. Probe it first, before step 3's assertions.
- **An author's own custom element around parts.** Only a mounting
  element (one whose class `defineElement` made) is a root; a
  framework's wrapper element around a trigger stays transparent.
- **Vanilla nesting without the mark** keeps today's behaviour; a
  development warning (a trigger already scoped to another component
  when the mount first spreads it) could say so — left out unless the
  user wants it.
