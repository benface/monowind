# Storybook controls for the UI components

Status: **implemented 2026-09-29**; D1–D3 decided with the user the
same day, each as recommended: (a), (a), yes. Builds on `a2cd74f`.

## Goal

Each `Packages / ui` story's component options are Storybook
controls: `<mono-accordion>`'s `multiple` and `collapsible`, a
popover's `placement`, a tooltip's delays, a listbox's
`selection-mode`, and so on, toggled live in the canvas. The goldens,
the plays and the twins stay as they are: every control's default is
what the story's markup says today.

## What it builds on

- **The elements' attribute tables**: every `MonoX.table` (the class
  `defineElement` returns) lists its attributes with their kinds,
  `boolean`, `number` or `string`, the positioning four included on
  an anchored one (`placement`, `gutter`, `offset-main-axis`,
  `offset-cross-axis`). The controls come from there, so a prop an
  element gains reaches its story with no edit.
- **Live attributes**: a changed attribute reaches the running
  machine through `updateProps`, and a removed one drops its prop
  (`element.ts` `attributeChangedCallback`), so a control takes effect
  without a remount.
- **Storybook 10**: the controls panel is built in; an arg change
  re-renders the story's template (Lit diffs it in place) and does not
  rerun `play` (the preview runs it on a remount only), so the visible
  stories' read-only plays are untouched.

## Design

- **`stories/controls.ts`**:
  - `controlsOf(Element, defaults)` returns `{ args, argTypes }`
    for a story and its twins to share. Each attribute in the
    element's table is a control by kind: a boolean a toggle, a
    number a number field, a string a text field, or a select where
    its values are a known set (`placement`'s twelve, `orientation`,
    `selection-mode`, `input-behavior`, `selection-behavior`,
    `content-role`). `defaults` are the story's markup's attributes;
    every other control starts unset, the machine's default.
  - `controlled(args)`, a Lit element directive that writes the args
    onto the element it sits on, by the kinds its class's table gives:
    a boolean by presence, or `"false"` to turn off one whose machine
    default is on; a number or a string as written; an unset one
    removed. Lit runs it before the element connects, so the mount
    reads the first render's attributes as it reads the markup's
    today. A story's template holds
    `<mono-accordion id="faq" ${controlled(args)}>`, its option
    attributes gone from the literal markup.
- **What is left out** (D2), the same list for every element:
  - **State the reader drives:** `open`, and the `*-value` and
    `default-*` attributes. A controlled value would freeze the
    component, and a default is read once, at the mount.
  - **`dir`:** the engine has no right-to-left layout yet (cell-model
    deviations 18 and 29).
  - **What the canvas cannot show:** the form plumbing (`name`,
    `form`, `auto-complete`) and the accessible names
    (`aria-label`).
- **The stories**: Listbox, ListboxMultiple, Select, SelectMultiple,
  Combobox, Dialog, Popover, Tooltip, Collapsible (its options on
  both sections) and Accordion, each with `...controlsOf(…)` and its
  twins spreading the same. `ListboxHighlightOnHover` (markup of its
  own) and `Elements` (four components wired together) take none.
  The Menu story is D1.
- **Events** (D3): each element's callbacks are bubbling events, which
  the directive logs to the Actions panel (`action()`, from
  `storybook/actions`; the `withActions` decorator is deprecated), each
  named by the element's own `eventNameOf`. `propsOf` gives the vanilla
  Menu story the same controls as props, through the element's own
  `propOf` (both exported from `element.ts`, not from the package's
  entry), its callbacks the same actions.

## Decisions for the user

- **D1 — the Menu story**, which mounts by script
  (`menu(root, props)`) to cover the vanilla path in a browser:
  - (a) _(recommended)_ its controls are the same table's,
    camel-cased and with the positioning four folded into
    `positioning`, handed to the mount's `updateProps` from
    `mountedOn`. The story then shows the vanilla API's live props
    too.
  - (b) no controls on it.
- **D2 — which attributes**:
  - (a) _(recommended)_ every attribute in the table past the list
    above.
  - (b) a hand-picked few per story. That's less to scroll, but it's
    a second list to keep in step with the elements.
- **D3 — events in the Actions panel**: yes _(recommended)_ or not
  now.

## Milestones

Each step's tests are seen failing first where it has behavior.

1. **The helper.** `controls.ts`: `controlsOf` and `controlled`. A
   test-only story (`ControlsApplied`, tagged `["!dev", "!golden"]`)
   renders an element through the directive twice with other args —
   a boolean set, turned off, then unset; a number; a select's
   string — and reads the attributes and what the machine made of
   them.
2. **The stories.** Each story and its twins on `controlsOf`, the
   literal option attributes moved into `defaults`; the Menu story
   per D1; the Actions panel per D3.
3. **Verification.** The UI story file in three engines; the visual
   goldens scoped to `packages-ui--`, then the whole run: no golden
   changes, the defaults being today's markup. `pnpm check` (its log
   read). No engine change, so no bench, and the stories on Linux are
   left to CI unless a story's markup moves.
4. **Docs.** AGENTS.md's story conventions gain the rule: a UI
   story's options are controls from its element's table, its twins
   sharing them. ui.md's testing section names the controls story.

## Found in use

- **The Code panel took over the Menu story's mount.** Every render
  also renders the story into a detached copy for the Code panel,
  and Lit hands its element to the same ref callback, so `mountedOn`
  moved the mount there and back: the live one restarted at the
  story's first args, Zag's cleanup leaving the last one's inline
  styles behind (an offset set to 0 kept its old gutter).
  `mountedOn` now mounts the element in the document alone;
  `visual/controls.spec.ts` holds it.
- **A vanilla mount's `destroy()` left what it wrote.** Zag's cleanup
  takes the handlers off and keeps the attributes, so a mount again on
  other props kept the last one's (a list's stale
  `aria-activedescendant`). The destroy now puts the markup back but
  for the reader's choices and the page's own later changes
  (specs/ui.md; `test/vanilla.test.ts`).

- **A dialog took the positioning four, which it ignores.** Its controls
  showed `placement`, `gutter` and the offsets: `<mono-dialog>` was
  declared `anchored`, though the UA centers its positioner and Zag's
  dialog has no `positioning`. The element no longer takes them, and
  the test holding each element to its machine's props now excuses
  them only where the machine places a floating part.

## Risks

- **An arg that changes a twin's markup would change its golden.**
  The defaults are read off the markup the story has today, so the
  full visual run proves them.
- **A select's options for `placement` are hand-listed**, the
  elements' table knowing only `string`. They're the twelve Zag
  placements, typed against the public menu props' own
  (`menu.Props["positioning"]["placement"]`, from
  `@monowind/ui/menu`), so a change there fails the type check.
