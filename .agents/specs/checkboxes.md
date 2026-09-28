# Spec: checkboxes and radio buttons

Status: **spec, 2026-09-28** — not implemented; its decisions taken
with the user the same day ("Decisions").

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
  or the author's `none` ("Custom controls"), read under the measuring
  flag (see "The light DOM").
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
  `ascii` draws the radio's dot as `*`. Every monospace font draws
  them.
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

## Paint

- **The glyphs draw in the control's `color`**; a checked or
  indeterminate control's in its `accent-color` where that is not
  `auto`.
- **A disabled control** draws its glyphs in its `color`, which a
  base-layer rule of the companion sets to half the inherited color's
  strength, as the placeholder's is (cell-model.md "Form controls"):
  a `disabled:` utility overrides it, as it overrides any base style.
- **Focus, hover and press** are any control's: the focus invert over
  its cells, `hover:` and `active:` through the synthesized states,
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
  out**; the lock gives them `appearance: none` gated on the
  measuring flag, so the read sees the UA's `auto` or the author's
  `none`, and the native widget never paints.
- **The state's transition joins the author's own**: the lock's
  `transition-*` lists are the author's, which the engine reads under
  the measuring flag (each padded to the property list's length, as
  CSS pairs them) and writes back in variables, with the state's entry
  after them, so a `transition-colors` on a custom control still runs.
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

## Deviations from CSS

All cell-model deviations apply; background images are gradients.md
deviation 3.

## Later

- **Switches**: WebKit's `<input type="checkbox" switch>` and
  `role="switch"`, with roles of their own (`[ ●]`, `[● ]`).
- **The other input types**: `range`, `color` and `file` draw nothing.
- `<progress>` and `<meter>`.

## Testing

- **Node**: tree.test.ts, a control's cells under each glyph set and
  a set size; style.test.ts, the reads (`appearance`, `accent-color`,
  `indeterminate`); plain-text.test.ts, each state's glyphs, accent,
  disabled, a custom control's box and `checked:` fill;
  glyphs.test.ts, the roles, their fallbacks and `--mw-missing-glyphs`.
- **Storybook**, `interactive.stories.ts` "Checkboxes" (visible, a
  golden): checkboxes and a radio group, checked, indeterminate,
  disabled, `accent-*`, a custom `appearance-none` one with
  `transition-colors`, and a `peer-checked:` label. The play toggles
  by click, label, Space and arrow keys, by script (`checked`,
  `indeterminate`), and resets the form, asserting the glyph cells
  after each; the native box under the glyph cells in three engines;
  the custom control's fill transitioning.
- **Visual**: the golden, and a press on the glyph cells toggling the
  control (`visual/pointer.spec.ts`, a trusted click).

## Touch points on implementation

- types.ts: will hold the control's state on its node (type, checked,
  indeterminate, disabled, appearance, accent).
- style.ts: will read `appearance` and `accent-color`, and the state
  properties.
- tree.ts: will size a checkbox or radio by its roles, not `size`.
- glyphs.ts: will carry the five roles and their defaults.
- plain-text.ts: will paint the glyphs in the control's leaf.
- element.ts: `#onTransitionRun` will lay the host out for the state's
  property.
- render.ts: will write a control's own transition lists back as
  variables for the lock.
- styles.css: will register `--mw-checked`, set it by `:checked` and
  `:indeterminate`, lock `appearance: none` and the merged transition
  on checkboxes and radios, gated, and dim a disabled one in the base
  layer.
