# Spec: checkboxes and radio buttons

Status: **implemented 2026-09-29**; its decisions taken with the user
on 2026-09-28 and 2026-09-29 ("Decisions"). The plan is
`.agents/plans/2026-09-29-checkboxes.md`.

`<input type="checkbox">` and `<input type="radio">` on the grid: the
engine draws each control's state as a glyph string from its glyph
set, sized in whole cells, and the light DOM keeps the native control
under those cells, where it takes the pointer, the keyboard and
assistive technology as authored. Probed 2026-09-28 in Chromium,
Firefox and WebKit (Playwright 1.63 on macOS, Menlo at 16px; the grid
through the 0.3.3 CDN bundle).

## Why

A checkbox or a radio draws nothing on the grid today: the companion's
base rule gives every control `appearance: none`, and the tree builder
sizes a checkbox or a radio as a text field, by its `size` attribute,
20 cells by default. A checked box is 20 blank cells, like an
unchecked one (probed).

## Tailwind's utilities (4.3.3)

| Utility                            | CSS                             |
| ---------------------------------- | ------------------------------- |
| `accent-*`                         | `accent-color`                  |
| `appearance-none`                  | `appearance: none`              |
| `appearance-auto`                  | `appearance: auto`              |
| `checked:`, `indeterminate:`       | `:checked`, `:indeterminate`    |
| `disabled:`, `enabled:`            | `:disabled`, `:enabled`         |
| `peer-checked:`, `has-checked:`, … | a neighbor's or a child's state |
| `size-*`, `w-*`, `h-*`             | the control's box               |

`@tailwindcss/forms` gives checkboxes and radios `appearance: none`,
a border, and a checkmark or dot as an SVG `background-image` under
`:checked`.

## What the engine reads

- **The control**: an `<input>` whose `type` is `checkbox` or `radio`;
  its `checked` and `indeterminate` properties (`indeterminate` has no
  attribute; `:indeterminate` matches it, probed) and `:disabled`.
- **Its computed `appearance`**, the UA's `auto` in all three engines
  or the author's `none` ("Custom controls"), read under a flag of its
  own (see "The light DOM").
- **Its `color` and `accent-color`** (`auto` unless an `accent-*`
  utility sets it).
- **The `switch` attribute** (WebKit's native switch) and
  `role="switch"` are not read: such a control draws as a checkbox
  ("Later").

## The glyphs

- **Glyph roles** in the solid table, as the scrollbar's and the list
  markers' are (theming.md): `checkboxOff`, `checkboxOn`,
  `checkboxMixed` (indeterminate, whatever `checked` is, as the native
  widget draws it), `radioOff` and `radioOn`. A role is a string of
  one or more cells, honoring `--mw-missing-glyphs` per glyph as the
  other roles do.
- **The defaults**: `[ ]`, `[x]`, `[-]`, `( )` and `(•)`;
  `ascii` draws the radio's dot as `*`. All but `•` are ASCII; `•` is
  the list bullet's default too, and a font without it (WenQuanYi Zen
  Hei Mono, `monospace` in the Playwright Linux image, probed
  2026-09-29) draws it in a fallback font, boxed onto its cell
  (wide-characters.md).
- **A control's width is its widest role**, over the roles of its
  type, so toggling never reflows the line: three cells under the
  defaults.

## Sizing

- **An auto-sized control is its glyphs' cells wide and one row
  tall**, and the engine sizes the native box to it.
- **A set size** (`size-*`, `w-*`, `h-*`) sizes the box; the glyphs
  start at its content-box origin, on its first row, and cells past
  them stay the box's.
- **Border, padding and background do not draw** on a control whose
  `appearance` is `auto`, as no engine draws them around its widget
  (probed): the grid draws the glyphs alone.
- **While the engine reads, the native box is the cells its last
  layout gave it** (three before any), so a host whose width is its
  content's (`w-fit`, `inline-block`) measures them: an intrinsic
  width (`contain: inline-size` and `contain-intrinsic-inline-size`,
  in the grid's cell, never under the text's advance), which an
  authored width overrides and the engine's read of the author's width
  leaves `auto`. Probed 2026-09-29: a `width` there reads as the
  author's through Typed OM; containment sizes a native widget in
  Chromium alone, a widget-less box in all three, which the lock
  keeps it; and a width in the text's advance (`1ch`), which WebKit
  rounds down to its layout unit, measured a line a cell short.

## Paint

- **The glyphs draw in the control's `color`**; a checked or
  indeterminate control's in its `accent-color` where that is not
  `auto`.
- **A disabled control** draws its glyphs in its `color`, which a
  base-layer rule of the companion sets to the controls' color
  (`--mw-fg`) at half strength, as the placeholder's is (cell-model.md
  "Form controls"). Any color utility on the control overrides it,
  `disabled:` or not, as it overrides any base style.
- **Focus, hover and press** are any control's: the focus invert over
  its cells, its ink and ground drawn over the accent and the cleared
  background, `hover:` and `active:` through the synthesized states,
  `focus-visible:outline-*` natively ("Outlines").
- **Paint order and clips** are an atomic inline box's, or a block's
  where the control is block-level.

## State changes

- **`:checked` and `:indeterminate` tell the host.** The companion
  gives each control a registered custom property (`--mw-checked`)
  whose value follows the two pseudo-classes, and a 1ms transition on
  it: whatever flips the state, the browser fires `transitionrun` on
  the control, and the host, which already listens for it (element.ts
  `#onTransitionRun`), lays out. In all three engines (probed): a
  script setting `checked` or `indeterminate`, the radio it unchecks,
  and a user's toggle each fire it; two flips in one task, which
  change nothing, fire nothing; a control in a `display: none`
  subtree fires nothing, and draws nothing either. WebKit starts a
  transition only on an element painted once, as every control is by
  the host's first layout, which reads its state.
- **A flip under a layout already under way starts no transition, and
  needs none.** The lock is off while the engine reads, so a flip whose
  style is first computed inside a layout pass commits without the
  state's entry; that pass reads `checked` itself. Probed 2026-09-29,
  40 flips beside a pending layout in each engine: Chromium fired all
  40, Firefox 27 and WebKit 33, and a layout followed every flip that
  fired nothing.
- **A user's toggle** — a click, a click on its `<label>`, Space, an
  arrow key in a radio group, `.click()` — also fires `input` and
  `change` (probed), which lay the host out already; a form reset
  fires `reset` alone, and resets the controls after it, each flip
  starting its transition.
- **A `:checked` style** elsewhere (`peer-checked:`, `has-checked:`)
  follows with the same layout.

## Custom controls

- **`appearance: none`** draws no glyph: the control is a box like any
  other — its border, fill and padding drawn, `checked:bg-*` read at
  each layout — sized as authored, 0 by 0 where nothing sizes it, as
  in all three engines (probed).
- **`@tailwindcss/forms`**'s check and dot are background images,
  which the grid does not draw (gradients.md deviation 3): its
  controls draw their border and, checked, their fill.

## The light DOM

- **The base rule's `appearance: none` leaves checkboxes and radios
  out**; the lock gives them `appearance: none`, so the native widget
  never paints nor sizes the box. A widget's own box would otherwise
  reach the measuring pass (WebKit's Typed OM reads its width as a
  length, probed), and an author's `appearance-none`, a utility or
  `@tailwindcss/forms`' rule, could not be told from the lock's.
- **The engine reads a control's own styles under a flag of its own**
  (`data-mw-control-read`), which lifts its locks: set on every
  checkbox and radio at once, at a layout's start, before its masks
  and its first geometry read. The read sees the UA's `auto` or the
  author's `none`, and the author's transitions (below), uncached, as
  a rule outside the control (`group-hover:`, `dark:`) can change
  either.
- **The state's transition joins the author's own**: the lock appends
  the state's entry to the author's `transition-*` lists, which the
  engine writes back in variables where a duration or delay is not
  zero. The measuring mask gives every light element the sampled
  `transition-property` list, so only the control's own read sees the
  author's. Each of the five lists (property, duration, timing
  function, delay, behavior) is padded to the property list's length,
  as CSS pairs them: unpadded, CSS repeats a shorter list, and the
  state's entry takes one of the author's durations (probed: a 0.3s
  state transition, which a second flip within it reversed without a
  `transitionrun` in Chromium and Firefox). The synthesized background
  fades take a control's lists from the same read, so a
  `transition-colors` on a custom control still runs.
- **The native box is the control's cells**, positioned and sized by
  the engine as every control's, so a press on the glyphs is the
  control's, and a `<label>`'s text toggles it natively.
- **The copy**: text mode copies no control, as `innerText` holds none
  (probed); grid mode copies the glyphs it shows.
- **Assistive technology** reads the native control, its state
  included.

## Decisions (2026-09-28, with the user)

1. **The default glyphs** are three cells, `[ ]` `[x]` `[-]` and
   `( )` `(•)`, the TUI convention every font draws. One-cell glyphs
   (`☐ ☒ ⊟`, `○ ◉`) are a glyph set's to register: Menlo has them,
   SF Mono (`ui-monospace` in Safari) lacks `☐ ☑ ☒ ◉` (fontTools),
   which then draw in a fallback font, boxed onto their cells
   (wide-characters.md).
2. **A state change reaches the grid through `:checked` itself** (the
   transition above), not through events alone, which miss a script,
   nor a patch of `HTMLInputElement.prototype`, which would touch
   every input on the page.
3. **A disabled control dims by default**, by a base-layer rule a
   `disabled:` utility overrides.
4. **The author's transitions are read under a flag of the control's
   own** (2026-09-29), as above, with its appearance. The alternative,
   an animation keyed on the state (`animationstart`), would replace an
   author's animation on the control and start one on every control's
   first style.

## Deviations from CSS

All cell-model deviations apply; background images are gradients.md
deviation 3.

## Later

- **Switches**: WebKit's `<input type="checkbox" switch>` and
  `role="switch"`, with roles of their own (`[ ●]`, `[● ]`).
- **The other input types**: `range`, `color` and `file` draw nothing.
- `<progress>` and `<meter>`.

## Testing

- **Node**: plain-text.test.ts, each state's glyphs, a radio group's
  `:indeterminate`, the widest role's width, the chrome left undrawn,
  the accent (none where disabled), a set size and an
  `appearance: none` box; glyphs.test.ts, the roles, their fallbacks
  and `--mw-missing-glyphs`; element.test.ts, the appearance read
  under its flag, the state's transition laying the host out, and a
  transitioning control's lists, read under the flag, written into its
  lock and taken back; animation.test.ts, the lists padded, and a
  control's fade armed from them; render.test.ts, the cells a control
  takes while the engine reads; cascade.test.ts, the lock's names and
  `--mw-checked` held to the engine's constants, and the appearance
  lock to its flag.
- **Storybook**, `interactive.stories.ts` "Checkboxes" (visible, a
  golden): checkboxes and a radio group, checked, indeterminate,
  disabled, `accent-*`, a custom `appearance-none` one with
  `transition-colors`, and a `peer-checked:` label. Its play reads the
  glyph cells and the native box under each, in three engines. A
  test-only twin (`CheckboxesToggled`, a golden) toggles by click,
  label, Space and an arrow key, by script (`checked`,
  `indeterminate`, a "select all" laid out once), and resets the form,
  asserting the glyph cells after each and, flipped by script, the
  custom control's fill fading on the grid, its native background
  locked. `CheckboxFit` (test-only): a `w-fit` and an `inline-block`
  host hold a control and its label on one row.
- **Visual**: the goldens; a trusted press on the glyph cells
  toggling the control, the grid following (`visual/pointer.spec.ts`);
  and a real Tab's focus inverting a control's glyphs, checked in its
  accent or not (`visual/keyboard.spec.ts`).

## Touch points on implementation

- tree.ts: `readControls` reads each checkbox's and radio's own
  appearance and transitions under its flag; `buildToggleLeaf` builds an
  `appearance: auto` one as a leaf whose text is its state's glyphs,
  padded to its type's widest, in its accent where checked and
  enabled, its chrome cleared; `inputWidth` and the form-control
  height floor leave an `appearance: none` one 0 by 0.
- types.ts: `isToggle` and `CONTROL_READ_FLAG`.
- glyphs.ts: `GlyphTable` carries the five roles, `controlGlyphs`
  resolves a type's glyphs by state, and `withoutGlyphs` drops a role
  holding any glyph a font lacks.
- animate.ts: `CONTROL_STATE` and `OWN_TRANSITION_VARS` name the
  lock's parts; `ownTransitionLists` is the one reader of a control's
  own lists, which the lock's variables and `resolvePendingTransitions`
  both take.
- element.ts: the pass's start reads the controls and writes a
  transitioning one's lists with `setVar`, and its end arms the fades
  from them; `#onTransitionRun` lays the host out for the state's
  property.
- render.ts: `--mw-tc`, a control's cells, with a box's names.
- styles.css: `@property --mw-checked`, set by `:checked` and
  `:indeterminate`; the appearance lock, off under
  `data-mw-control-read`; the merged transition lock, off under the
  measuring, settling and read flags; the measuring pass's intrinsic
  width; and a disabled control's dim, in the base layer.
