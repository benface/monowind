# The story sweep: visible plays only read

Status: **done 2026-09-28**, before 0.3.4's release (the user).

AGENTS.md's rule: a visible story's `play` only reads — it asserts
what the story draws and never changes it — as Storybook runs it in the
canvas too, where a play that clicks, focuses or toggles flashes and
leaves the story off its authored state. Interaction goes in a
test-only twin sharing the render.

## The shape of a split

- **The visible story** keeps its render and a `play` of the reads that
  hold in its authored state, or none.
- **Its twin** takes the rest of the play: the story's render
  (`render: Menu.render!`, the template left where it was), tagged
  `["!dev"]` — each tag list in the story's own literal (the indexer
  reads tags statically) — and named the story's name and a participle
  of what its play does (`MenuOpened`, `LayersScrolled`), its doc
  comment opening "Test-only".
- **No coverage is lost.** Every assertion moves unchanged, the reads
  staying and the rest going to the twin, which runs in the suite as
  any story does. A twin keeps a golden wherever its end state differs
  from the authored one, so the old golden carries over under its
  name, unchanged (the visual run checks it); only a twin whose play
  ends back in the authored state, which the visible story's golden
  pins, takes `!golden`.
- **A story that is a test, not a demo** — its render an empty holder
  its play fills, or its play the whole point — turns test-only under
  its own name (`["!dev"]`, its doc comment opening "Test-only"), its
  golden unchanged.
- **A play's temporary measure** — a copy appended, measured and
  removed in the same task, which never paints — is a read.
- **Goldens**: a visible story's golden moves to its authored state,
  new coverage; a twin's is the old golden.
- **Visual specs** open stories by id (`openStory`): one that relies
  on a play's end state opens the twin instead.

## Inventory

A story is visible unless its own tags or its file's (`meta.tags`)
hold `!dev`: the "Test / …" files — blend, cascade, focus, host, leaf,
pointer, qr-test, select, selection, themes and wide — are hidden
whole, their plays free to interact. A scan for writes in the visible
plays (clicks, focus, presses, drags, hovers, class, attribute, style,
text and value writes, scrolls, selections, open/close, keys) found
these, each checked by hand:

- interactive: Select, Link, Button, ClickThrough
- ui: Menu, Listbox, ListboxMultiple, Select, SelectMultiple,
  Combobox, Dialog, Popover, Tooltip, Elements
- top-layer: Popover, DialogInATallPage, Dialog
- effects: Outline, Layers (Opacity and Gradients false alarms)
- float: DropCap
- grid: GapDecorations
- overflow: Overscroll, Styled, BothAxes, Nested (Overflow a false
  alarm)
- positioning: Stacking, ContainingBlockClip, StickyHeadings,
  StickyFooter, StickyTable, StickyHeaderCells, Anchored,
  AnchorFallbacks
- responsive: HostWidth
- theming: Tokens
- root: OwnText, and typography: AnonymousRuns (false alarms)

The grid and typography stories whose play is
`expectBrowserRowsToMatchEngine` only read.

## Process

File by file: split, run the file's stories in Chromium, then in all
three engines. At the end, once: the full visual run, each changed
golden looked at (a visible story's now authored, a golden twin's
identical to the old), then `pnpm check` and `pnpm test`.

## Progress

Each file's line as it lands: its splits, and any false alarm.

- interactive: `Select` reads, `SelectPressed` picks and presses;
  `Link` draws, `LinkFocused` focuses; `Button` reads, `ButtonPressed`
  clicks; `ClickThrough` reads, `ClickThroughHovered` hovers and ends as
  it started (`!golden`).
- ui: each story keeps its role reads, and a golden twin takes its
  interaction — `MenuOpened`, `ListboxSelected`, `ListboxMultipleSelected`,
  `SelectPicked`, `SelectMultiplePicked` (the story itself reads
  nothing), `ComboboxFiltered`, `DialogOpened`, `PopoverOpened`,
  `TooltipOpened`, `ElementsWired`.
- top-layer: `Popover` and `Dialog` draw, `PopoverOpened` and
  `DialogOpened` open them; `DialogInATallPage` reads,
  `DialogInATallPageOpened` opens it (visual/top-layer.spec.ts opens and
  closes it itself). visual/pointer.spec.ts's border press opens
  `ListboxSelected`, whose play leaves the list scrolled and an item
  selected.
- effects: `Outline` reads, `OutlineFocused` focuses and blurs
  (`!golden`; keyboard.spec.ts's outline test focuses on its own);
  `Layers` reads, `LayersScrolled` scrolls. `Opacity` and `Gradients`
  were false alarms (`===` read as a write).
- overflow: `Overscroll` draws, `OverscrollWheeled` wheels; `Styled`,
  `BothAxes` and `Nested` read, `StyledOverlayHovered`,
  `BothAxesScrolled` and `NestedScrolled` hover or scroll and end as
  they started (`!golden`). `Overflow` was a false alarm ("resize" in
  a comment).
- positioning: `ContainingBlockClip`, `StickyHeadings`, `StickyFooter`,
  `StickyTable` and `AnchorFallbacks` read their resting state, and a
  golden twin scrolls or opens (`…Scrolled`, `AnchorFallbacksOpened`);
  `Stacking`, `StickyHeaderCells` and `Anchored` draw, their twins
  (`StackingScrolled`, `StickyHeaderCellsScrolled` — `!golden`, as the
  story was — and `AnchoredOpened`) taking the whole play.
- theming: `Tokens` reads both hosts' tokens, `TokensFocused` tabs
  through the invert and recolors the page. `Gallery` (themes) and
  `AnonymousRuns` (typography) were false alarms (a probe removed in
  its task; `selectNodeContents`).
- A first pass also split the hidden "Test / …" files' stories, its
  scan blind to `meta.tags`; restored, and the scan reads them now.
- responsive: `HostWidth` reads, `HostWidthNarrowed` narrows the sidebar
  and back (`!golden`). root: `OwnText` was a false alarm
  (`selectNodeContents`).
- float: `DropCap` reads, `DropCapSelected` drags in text mode and
  clears the selection, its end state `DropCap`'s own pixels
  (`!golden`). grid: `GapDecorations` removes the reference it
  measures, a read then.
- Visual specs: pointer.spec.ts's field drag opens `ComboboxFiltered`,
  whose play leaves "releas" typed with the list open, and its border
  press `ListboxSelected`; keyboard.spec.ts's outline test no longer
  cites the play. The full visual run: 25 twin goldens byte-identical
  to their stories' at the last commit, 25 stories' goldens now their
  authored state (`DropCap`'s unchanged, its twin `!golden`), every
  spec passing.
- Review: the renders stay where they were, each twin naming its
  story's (`render: Menu.render!`) — a module const per render had
  re-indented every template — and the twins take one naming rule,
  the story's name and a participle (`DetailsToggle`, from the
  last commit, is `DetailsToggled`).
