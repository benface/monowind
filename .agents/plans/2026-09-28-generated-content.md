# Generated content

Status: **implemented 2026-09-28**, the last feature of 0.3.4 (the
user).
The spec is `.agents/specs/generated-content.md`; this plan orders
the work onto the code after d77097e.

## Decisions taken

- Generated text is text of its run: highlighted by a selection over
  it and held by the copy (the user, 2026-09-28).
- One commit once the feature is whole, with its story, as lists
  landed (the user, 2026-09-28).

## Milestones

Each step's tests are seen red first.

### 0. The reads' cost (probed 2026-09-28)

Reading both pseudo-elements' `content` on every box costs nothing
measurable (prose and boxes level); on every inline element too, the
prose page's 4,800 reads cost 5–9 ms (about 4%). So the reads narrow
to the elements a `content`-setting `::before` or `::after` rule can
match (step 1).

### 1. Reads (counters.ts, style.ts, types.ts)

- The rule scan: the selectors of the rules that set `content` on a
  `::before` or `::after` in the host's root's and document's sheets —
  nested rules composed with their parents' — cached per sheet as the
  `@counter-style` scan is (one walk of a sheet's rules for both);
  each layout matches them, the pseudo-element stripped, over the host
  in one `querySelectorAll`, `q` joining them.
- `readCellStyle(el, …, pseudo)`: the pseudo-element's computed style,
  its authored lengths from its variant's classes; its `content`'s
  parts through `contentParts`, quotes included.

Done in sheets.ts and generated.ts, by pseudo-element: `readCellStyle`
takes the pseudo-element its read found (`BuildReads`).

### 2. Generated text in runs (tree.ts)

The run collector adds an inline pseudo-element's text as its
element's first and last inline content, under an inline entry of its
own (its paint, quantized padding and margins, visibility, pointer
events); a block leaf's and a container's in their runs, a
container's in an anonymous run of its own where a block child
borders it, after an inside marker's run.

### 3. Pseudo-element boxes (tree.ts)

A block, atomic, floated or out-of-flow pseudo-element builds as an
element of its kind (`buildNode` with a pseudo), its text the
generated text; layout needs nothing new.

Done as `buildGeneratedBox`, a leaf over its text. A survey of every
place that keys a node by `source`, which a pseudo box shares with its
element, found the rest: the node index, decorations and opacity
chains, the order of a run's atomic boxes, the static read, the flex
static slot, focus, the top layer, inline ownership, the character
map, and the layers — each fixed with a test. Found on the way: an
element's class scan took its `before:w-4` for its own width
(`authoredClasses`), and a pseudo box's stylesheet sizes read as auto
(`declaredLengths`, which Bootstrap's `.stretched-link::after` needs).

### 4. Counters and quotes (counters.ts, tree.ts)

`counterTree` gives each pseudo-element a record in CSS's order; the
walk tracks the quote depth; `partText` writes quotes from it — a
list marker's too. The language pairs as data.

The walk gives each writer every counter in scope; it runs once a
build where first read — held in a closure, as each run's context
copies the build's (the `labels` bench found it walking once a run:
639 ms to 163 ms). Quotes need no walk: the build writes them in tree
order from one depth (`quoteWriter`), a marker's where its item is
built. The language table is Chromium's, probed through its
accessibility tree.

### 5. Paint, hit, selection and copy (selection.ts)

Generated text paints and hits as its run's text does, boxes as
elements'. Its characters map to its element's edges (`charIndexAt`,
`positionOf`), so ranges, gestures and the copy reach them.

### 6. The light DOM (render.ts, styles.css, layout.ts)

The ink, typography and spacing locks on `::before` and `::after`;
their spacing and box geometry vars and flags; pseudo-element boxes
left out of the native flow placement (`placeFlowChildren`); the
scroll spacer's side. Probed against the engine's cells in three
engines.

A pseudo-element's own compact rules, not the element rules: the
render writes its kind on its element's flag and its variables under
its name, each kind's whole; a box draws no text natively, so it
needs its cells, margins and alignment alone — a block one in a
mixed container taking native flow as a flow child does. (Renaming
the element's variables and mapping them back onto the
pseudo-element, which reused every element rule, cost the companion
twice the CSS and the render a write proxy.)

### 7. Stories, visual, bench, docs

As the spec's Testing lists; lists.md loses deviations 6 and 8;
performance.md's numbers.

## Risks

- **Native widths**: inline generated text stays native, so its
  native advance must equal the grid's — the locks' job; a font
  without a glyph boxes it on the grid (wide-characters.md) and may
  draw it wider natively.
- **Vars on elements inherit**: a pseudo-element box's geometry vars,
  written on its element, restyle its subtree when they change.
- **State-dependent rules**: a `hover:before:content-[…]` matches only
  while its element is hovered, so its text shows from the layout the
  hover schedules — which a `hover` class does (cell-model.md
  "Pointer states").
- **Pseudo-elements with no box**: those of a `display: none` element
  build nothing; a `display: contents` one's text draws, as in CSS.

## Review (2026-09-28)

Three fresh-eyes reviews (engine, light DOM, docs and tests) found,
each fixed with a test seen failing first: stacked variants
(`md:before:`) and container queries dropped by the scan; a block
pseudo-element never splitting its inline element; an `::after` no
range to its element's end held, and a run merging a `::before` with
an `::after`; a mapped variable left unset reading invalid or an
ancestor's (the stretched link off its box), and a run's box placed
against the run, not its container (elements' too); the declared
read's `display: none` ending transitions, and the lock toggles
starting them; an image in `content` painting natively; grid mode's
pointer events. And the waste: a `q` walking every element's counters
each layout, a leaf's positioned box built twice (elements' too), a
pseudo-element or marker read twice, `::after` read where only
`::before` rules exist.
