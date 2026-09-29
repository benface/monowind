# Checkboxes and radio buttons

Status: **plan, 2026-09-29**, not started. D1 decided with the user
the same day: (a), guarded against drift. The spec is
`.agents/specs/checkboxes.md` (normative: rules, probes, decisions,
tests); this plan orders the work onto the code as it stands at v0.3.4
(`a67cb60`).

## Scope

In: everything the spec states for `<input type="checkbox">` and
`<input type="radio">`:

- the five glyph roles and their defaults;
- the reads (`checked`, `indeterminate`, `:disabled`, `appearance`,
  `accent-color`);
- sizing by the roles;
- paint in the control's color or accent, and a disabled control's dim;
- custom `appearance-none` controls as boxes;
- the state reaching the grid through `:checked` itself;
- the light DOM's locks.

Out: the spec's "Later" (switches, `range`/`color`/`file`,
`<progress>`, `<meter>`), and `@tailwindcss/forms`' background-image
check and dot (gradients.md deviation 3).

## What it builds on

- **Sizing**: tree.ts `inputWidth` sizes every input that is not a
  `LABELED_INPUTS` button by its `size` attribute (20 cells by
  default). A checkbox or radio takes its roles' width there instead.
- **The leaf**: a form control is an empty leaf (`isFormControlTag`)
  whose intrinsic width comes from `inputWidth`. The glyphs are its
  paint, not its text, as a list marker's are.
- **Glyph roles**: glyphs.ts `GlyphTable` carries the scrollbar's
  (`scrollTrack`, `scrollThumb`) and the list bullets (`disc`, …),
  with `--mw-missing-glyphs` per glyph, and `ascii` its own. The five
  control roles join them.
- **The companion**: the base rule
  `mono-wind :is(button, input, select, textarea)` gives every control
  `appearance: none`, and the next one gives inputs
  `color: var(--mw-fg)`; the placeholder's half-strength `color-mix` is
  the disabled dim's model.
- **State changes**: the host listens for `transitionrun`
  (element.ts `#onTransitionRun`), which today passes only what
  animation.ts `transitionSampling` samples; an unsampled property
  returns early.
- **Settling**: an element whose durations read non-zero under
  `measuring` (`mayTransition`) settles under `[data-mw-settling]`, so
  a lock's snap-back never starts a native transition.
- **Writes**: render.ts `setVar` and its write cache carry any
  per-element variable the lock reads.

## A gap in the spec: where the author's transitions are read

The spec's "The light DOM" has the state's 1ms transition join the
author's own, "the lock's `transition-*` lists [being] the author's,
which the engine reads under the measuring flag". That read
cannot see them. Under `[data-mw-measuring]` (and
`[data-mw-settling]`) the companion replaces every light element's
`transition-property` with the sampled list (styles.css, the
"Lock toggles must never become native animations" rule). The author's
list is readable only outside the masks, which is where animate.ts
`transitionConfigFor` reads it for the synthesized background fades.
There the control's own lock, which appends the state's entry, would
hide it too.

**D1 (decided 2026-09-29: (a))**: how the state reaches the host.

- **(a) The spec's transition, read under a flag of its own.** The
  control lock is gated off under `measuring`, `settling` and a new
  per-control `data-mw-transition-read`. At each pass's end, outside
  the masks, the engine sets that flag on every control whose
  durations read non-zero under `measuring`, reads their five lists
  (property, duration, timing function, delay, behavior) in one batch,
  and clears it: one style recalculation. It pads the lists to the
  property list's length and writes them back as variables the lock
  merges before the state's entry. `transitionConfigFor` takes a
  control's lists from the same read. Author transitions and animations
  are untouched, but the merge is two cooperating pieces, and a page
  with transitioning controls pays one style recalculation per
  layout.
- **(b) An animation keyed on the state.** The companion gives
  checkboxes and radios an empty `@keyframes` per state (`mw-off`,
  `mw-on`, `mw-mixed`, 1ms) chosen by `:checked` and `:indeterminate`.
  A change of name starts a new animation, and the host listens for
  `animationstart`. The author's transitions are untouched, so
  synthesized fades need no change. The costs:
  - an authored animation on a checkbox or radio is replaced: a new
    deviation, or the same merge as (a) for `animation-*`;
  - every control's first style starts one animation, so the load's
    events must be ignored (the elements the first layout saw) to
    keep a page load at one layout.

The user chose **(a)**, as long as the merge cannot drift. The spec's
"The light DOM" and its decision 4 record it. The read runs at every
pass, uncached: a cache cleared by the control's own `class` and
`style` (the first draft) would go stale when a rule outside the
control changes its transitions (`group-hover:`, `dark:`, a media
query). The guards:

- **One reader.** A single function (animate.ts) returns an element's
  own transition lists: from its computed style for any element, from
  the flagged read for a control. The variables' writer and
  `transitionConfigFor` both take its result, and nothing parses the
  variables back.
- **One set of names.** The variables' names and the state's property
  are that module's constants. A unit test reads styles.css and holds
  the lock to exactly those names, and `--mw-checked`'s `@property`
  and values to the TypeScript's.
- **Behavior in three engines.** `CheckboxesToggled` flips a custom
  control with `transition-colors` by script, and asserts both the
  relayout and the fill's fade.

## Milestones

Each step's tests are seen failing first, against the tree before the
change or a scratch copy.

### 0. Probes

Recorded in the spec as they land (Chromium, Firefox and WebKit).
Probes 1, 2 and 5 ran on 2026-09-29 (`cb/probe*.mjs` in the session's
scratchpad): the mask hides the author's list, the read flag returns
all five lists without starting a transition, merged lists parse and
fire, duplicates take their last entry, and `•` falls back on the
Linux image. They also found that a flip beside a pending layout may
fire nothing in Firefox and WebKit, that layout reading the state
itself (spec, "State changes"). Probes 3, 4 and 6 need the lock and
run as story assertions in milestones 5 to 7.

1. `transition-property` read under the measuring flag returns the
   sampled lock, confirming the gap above.
2. Flipping `data-mw-transition-read` in and out returns the author's
   lists and starts no transition. A merged
   `var(--mw-tp, --mw-checked), --mw-checked` parses, including an
   author's `all`.
3. A custom control with `transition-colors` and `checked:bg-*` shows
   no native background fade across the passes.
4. Three hundred controls flipped in one task (a "select all") lay out
   once.
5. `•` in `(•)`: the default monospace of Linux CI (DejaVu Sans Mono)
   and Windows (Consolas, Cascadia) draw it.
6. A shrink-to-fit host (`w-fit`) holding a checkbox and its label: the
   measuring pass lifts the geometry lock, so the host measures the
   native widget (about 13px and its margins), not three cells. Does
   the host still hold the line? If not, the measuring pass gives an
   unsized checkbox or radio its roles' width, at a specificity the
   author's `size-*`, `w-*` and `h-*` beat (`:where()`), from a
   variable the engine writes.

### 1. Glyph roles (glyphs.ts) — done 2026-09-29

- `checkboxOff`, `checkboxOn`, `checkboxMixed`, `radioOff`, `radioOn`
  on `GlyphTable`'s solid table, defaulting to `[ ]`, `[x]`, `[-]`,
  `( )` and `(•)`. `ascii` sets `radioOn` to `(*)`.
- `controlGlyphs(set, type)`: a type's glyphs by state, the set's
  roles over the defaults.
- `--mw-missing-glyphs` drops a set's role holding any glyph it names,
  whole (`withoutGlyphs` compared a role's whole string, which a
  multi-cell role never matched).
- Tests: glyphs.test.ts (defaults, `ascii`, a registered set's own
  roles, a missing glyph's fallback).
- theming.md: the roles' table gains the five.

### 2–4. The control's leaf (tree.ts) — done 2026-09-29

Reads, sizing and paint collapsed into one step: a checkbox or radio
under `appearance: auto` is built as a leaf whose text is its state's
glyphs (`buildToggleLeaf`, beside `buildRendererLeaf`), so the leaf
machinery sizes, paints, copies and hits it with no new node fields and
no new paint path.

- The build reads `appearance` and `accent-color` off the control's
  computed style (under `measuring`, where the lock is off) and
  `checked` and `indeterminate` off the element. `:disabled` needs no
  read: its dim is the companion's color.
- The text is the state's role padded to the type's widest, one row;
  the color the accent where checked or indeterminate and not `auto`;
  border, padding and background cleared, `text-align: start`, and an
  auto width `max-content`, as a widget's.
- Under `appearance: none` the control stays an empty leaf, 0 by 0
  unless sized (`inputWidth`, the form-control height floor).
- Tests: plain-text.test.ts "checkboxes and radios" (each state, a
  radio group's `:indeterminate`, the widest role's width, no chrome,
  the accent, a set size at the origin, `appearance: none`), seen
  failing first.

### 5–7. The companion, the state, the stories — done 2026-09-29

As planned, with what the stories found:

- **The appearance read has a flag of its own**
  (`data-mw-appearance-read`), set on every checkbox and radio at once
  before the pass's first geometry read. Lifting the appearance lock
  under `measuring`, as first planned, let the widget reach the
  measuring pass: WebKit's Typed OM reads a widget's width as a length
  (an authored width to the engine), and the host measured the
  widget's 13px, not the glyphs' three cells.
- **The measuring pass's width is intrinsic**: `contain: inline-size`
  with `contain-intrinsic-inline-size` in the grid's cell, from the
  cells the last layout gave the control (`--mw-tc`, render.ts). A
  `width` there reads as the author's through Typed OM; containment
  sizes a widget-less box in all three engines; `1ch`, the text's
  advance, which WebKit rounds down, measured a line a cell short.
- **One read, one flag** (the review after milestone 7): the
  appearance and the transitions read together at the pass's start,
  under `data-mw-control-read`, which is outside the masks too; the
  pass's-end batch over the settling controls, its own flag and the
  element's record of written controls are gone.
- **The focus invert stays on a focused control** (the same review):
  clearing the widget's background and drawing the accent had left a
  keyboard-focused checkbox white on white, and a checked one in its
  accent with no focus shown.
- **`runningUnder` needed no change**: `transitionSampling` already
  passes over `--mw-checked`.
- **A load's color transition** on a `transition-colors` control runs
  a layout a frame, as any element's does, and a step's own layouts can
  still be pending: the "select all" story counts from a host at rest
  (`layoutsQuiet`), which the Linux image showed it needs.

The steps as first planned:

### 5. The companion and the light DOM (styles.css, render.ts)

- The base rule's `appearance: none` leaves out
  `[type=checkbox], [type=radio]`. A theme-layer lock gives them
  `appearance: none` off the measuring flag, so the widget never
  paints and the read sees the UA's `auto` or the author's `none`.
- A disabled control dims in the base layer: `var(--mw-fg)` at half
  strength, as the placeholder's color is. Being a base style, any
  color utility on the control overrides it, `disabled:` or not.
- The state's signal: `@property --mw-checked` (`<integer>`, not
  inherited, initial 0), `1` under `:checked` and `2` under
  `:indeterminate`, and the lock's merged lists with the state's 1ms
  entry last, gated off under the measuring, settling and read flags.
- The one reader (animate.ts) and its names; the pass's end reads a
  transitioning control's lists under `data-mw-transition-read`, and
  render.ts writes them as variables through `setVar`.
  `transitionConfigFor` takes its lists from the reader.
- The native box is the control's cells, positioned and sized as
  every control's: a press on the glyphs and a click on its `<label>`
  toggle it natively.
- Tests: the names' test against styles.css; element.test.ts where
  happy-dom reaches (the variables written, padded as CSS pairs the
  lists); the rest in stories.

### 6. State changes (element.ts, animation.ts)

- The state's transition lays the host out, in `#onTransitionRun`
  before `transitionSampling`.
- `runningUnder` leaves the state's transition out, so it starts no
  sampling loop.
- `input`, `change` and `reset` already lay out; the form reset's own
  flips follow through the state's event.
- Tests: element.test.ts where happy-dom dispatches the event; the
  engines in stories.

### 7. Stories and visual

- `interactive.stories.ts` "Checkboxes", visible, with a golden. It
  shows:
  - checkboxes and a radio group: checked, indeterminate, disabled,
    `accent-*`;
  - a custom `appearance-none` control with `transition-colors`;
  - a `peer-checked:` label.

  Its play only reads: the glyph cells and the native box under them.

- `CheckboxesToggled`, a test-only twin (`["!dev"]`, a golden, as its
  end state differs). It toggles:
  - by click, `<label>`, Space and arrow keys;
  - by script (`checked`, `indeterminate`, a "select all" of many);
  - by a form reset.

  After each it asserts the glyph cells, and the custom control's fill
  transitioning.

- `visual/pointer.spec.ts`: a trusted press on the glyph cells toggles
  the control.

### 8. Docs, verification, benches

- The spec: status, the D1 rewrite, and "Touch points on
  implementation" in the present tense. cell-model.md "Form controls"
  points to it. README's feature list.
- Unit tests per package; the story file in three engines; the visual
  goldens scoped, then whole; `pnpm check` (its log read for
  warnings); `pnpm test`.
- **The stories on Linux** (the Playwright image, as CI), before the
  commit.
- Benches: the change adds reads and a transition per control, and a
  style recalculation per layout where controls transition. A
  `pnpm bench --shape checkboxes` (300 labeled checkboxes) loads and
  relays out against v0.3.4, plain and with `transition-colors`, and
  a "select all" flips them in one task. Pages without controls should
  load level with v0.3.4. performance.md records it.

## Risks

- **Settling**: the lock is off under `measuring`, so
  `mayTransition` reads the author's durations alone. A plain
  checkbox then never settles; a transitioning custom control settles
  as any element does.
- **WebKit** starts a transition only on an element painted once
  (spec). Every control is painted by the host's first layout, which
  reads its state, so a script's first flip before that is read
  directly.
- **Label clicks and `peer-checked:`** relay out through the same
  event: no separate path.
- **The measuring pass sees the native widget** (probe 6): a
  shrink-to-fit host's columns come from the light DOM's natural width,
  where an unsized checkbox is narrower than its three cells.
