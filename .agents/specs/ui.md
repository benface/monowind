# Spec: `@monowind/ui` — accessible components on the grid

Status: **implemented** (2026-09-13, the framework packages and
examples 2026-09-18, the listbox and the select 2026-09-21;
`packages/ui`, one entry per component, plan `2026-09-13-ui.md`). The
engine features it needs are `top-layer.md` and
`anchor-positioning.md`; motion is `animations.md`, and a list's scroll
is `scrolling.md`.

## Motivation

A menu, a list to choose from, a dialog, a popover, a tooltip: every
application needs them, and doing them accessibly — roles and states,
roving focus, typeahead,
focus trapping and restore, dismissal, nested menus — is where most
hand-rolled components fail. monowind is a custom element that renders
whatever DOM it holds, so its components must be framework-agnostic
and must be plain light DOM. Zag.js is both: state machines per
widget, framework adapters over them (React, Vue, Solid, Svelte, and
vanilla), used by Ark UI and Chakra, covering the accessibility
patterns in depth. `@monowind/ui` is Zag's machines wired to the grid:
the engine places and layers the parts, Zag runs them.

## Shape

- **One package, a subpath per component**: `@monowind/ui/menu`,
  `@monowind/ui/listbox`, `@monowind/ui/select`, `@monowind/ui/dialog`,
  `@monowind/ui/popover`, and `@monowind/ui/tooltip`, in that order
  wherever they are listed; `combobox`, `tabs` and the rest follow the
  same shape. Versioned in lockstep with `monowind`.
- **A core that touches no DOM**: per component, `props(p)`, the
  machine's props with Zag's own positioning off, Zag's `machine`
  re-exported, `connect(service, normalizeProps, p)` — Zag's connect
  with the grid's props, so the framework path needs this package's
  entry alone — and `api(zagApi, normalizeProps, p)` for an API
  connected elsewhere, Zag's connected API with monowind's part props
  — the trigger's `anchor-name`, the positioner's `position-anchor`,
  `position-area`, `position-try-fallbacks`, and `popover="manual"`,
  the content's `hidden` dropped — written in the adapter's own shape
  through its `normalizeProps`, so any Zag adapter spreads them in
  its idiom: `@zag-js/react`'s `useMachine` and JSX spreads, Vue's,
  Solid's, Svelte's, and Ark UI's components. One effect beside it,
  `syncTopLayer(positioner, open)`, shows the positioner's popover as
  the machine opens, blurs a focused element inside it as the machine
  closes (a parent menu placing the focus next asks where it is), and
  hides it once the closed state's finite running animations under it
  have finished; a framework runs it after commit, as it runs any DOM
  effect. The package depends on Zag
  alone: it speaks the CSS and the attributes the engine reads, and
  imports nothing from `monowind`.
- **A package per framework over the core**: `@monowind/ui-react`,
  `@monowind/ui-vue`, and `@monowind/ui-svelte` (Solid's once
  `@zag-js/solid` runs on Solid 2; Preact's on demand) fold the
  adapter's `useMachine` and `normalizeProps` — the framework-specific
  half of Zag, which the core cannot carry without depending on the
  framework — into one function per component in the framework's
  idiom: React's `useMenu(props)` returns the grid's API with the
  positioner's ref in its props; Vue's returns the API as a computed
  and the positioner as a template ref; Svelte's `createMenu(props)`
  returns the API as a getter and the positioner as an action; Vue's
  takes a ref or a getter of the props as well and Svelte's a getter,
  so controlled props flow as Zag's do; the top layer follows the
  machine inside each. The core stays the path for any other framework.
- **Headless.** A component is behavior, not looks: the library owns
  the functionality, the keyboard and pointer usability, and the
  accessibility of every part, and ships no classes and no
  stylesheet; the author styles each part with Tailwind and monowind
  classes. The parts are Zag's anatomy — `trigger`, `positioner`,
  `content`, `item`, `item-group`, `separator`, and so on per
  component — marked `data-part` on ordinary elements.
- **A vanilla path for markup without a framework**: `menu(root,
props)` is the core plus `VanillaMachine` and `spreadProps`: parts
  found by `data-part` under the root, items and groups by their
  `data-value`, attributes and handlers applied a microtask after the
  mount — once the sends a mount makes (a submenu's link to its
  parent) have landed — and re-applied on every state change, a
  submenu's included. A submenu is a menu of its own on the parent's
  behavior props — `onSelect`, `closeOnSelect`, `loopFocus`,
  `typeahead`, `composite`, `navigate`, `dir`, `getRootNode` — since
  Zag calls a menu's `onSelect` for its own items; its open state,
  highlight, and ids are its own. It returns the API and a `destroy`
  that stops the machine and takes its handlers off the parts, after
  which a mount on the same markup wires it again.
- **A component with no floating part stands in the flow.** A listbox
  is roles, selection, and keyboard alone, so the engine lays its parts
  out as it lays out any box and the entry adds no props to Zag's. It
  takes the mount the anchored components build on, without the
  trigger, positioner, and content that one spreads, and the framework
  packages return its API alone. Its scroll is the engine's
  (scrolling.md): `overflow-y-auto` with a `max-h-*` on the content
  scrolls natively, a select's list the same, and Zag scrolling the
  highlighted item into view repaints the grid on the cells it moved
  to. That scroll targets the content box, not the scrollport
  (`scrollToIndexFn` in the machine's props, an author's own over it):
  the engine reserves a box's border cells as padding, so a scroll into
  the scrollport would stop with the item under the border.
- **A list's focus starts at its selection.** The content taking focus
  highlights the selected item, or the first where nothing is selected,
  as ARIA's listbox pattern has it, and brings that row into view. A
  composite's own cells stay plain and the grid draws no focus ring to
  fall back on (cell-model.md), so the highlight is the whole of the
  indication and a stale one misplaces it: Zag leaves the highlight
  empty on focus wherever a value is selected, and a pointer passing
  over an unfocused list leaves its own, which nothing shows until the
  next focus. The scroll skips a focus the pointer caused, as the
  machine's own does, so a press on a visible item never jumps the list
  out from under it.
- **The markup is a listbox's collection.** Zag takes its items as a
  `collection` the author builds; for markup that names none, the
  marked items make one — the `data-value` each carries, the words of
  its `item-text`, and `data-disabled` — so a list of static items is
  markup alone, and an item the author's own collection leaves out
  stays plain markup. The mount's own element is the `root`, its id the
  markup's so the page still finds it, and `data-highlight-on-hover` on
  it passes Zag's `highlightOnHover` for every item: it moves the
  highlight, Zag keeping `data-highlighted` for the keyboard's focus
  and leaving the pointer's feedback to `hover:`.
- **A select is a listbox on a trigger.** Zag's select is the anchored
  one — the same collection, items, and keyboard, its content in the
  top layer — so it takes the anchored mount and the placement mapping
  unchanged, and shares the items and the scroll with the listbox. Two
  parts are the mount's to fill, a markup author having nothing else to
  render them with: the `value-text`, whose markup text is its
  placeholder and whose content the mount writes from the API; and an
  optional `hidden-select`, the native control a form posts under the
  machine's `name`, filled with an option per item and set to
  `display: none`, which the layout skips while a form still submits
  it; where the select takes several values, the options carry the
  selection, the adapter's one assignment of `value` being a single
  control's.
- **States are attributes**: `data-state`, `data-highlighted`,
  `data-disabled`, `data-placement`, as Zag sets them, so an author
  styles them with Tailwind's data variants
  (`data-[highlighted]:bg-neutral-700`) and the engine reads the
  computed result.

## Locked decisions

- **The engine positions, Zag does not.** Every floating part is an
  anchored box (anchor-positioning.md): the trigger gets an
  `anchor-name`, the positioner a `position-anchor`, a
  `position-area` mapped from Zag's placement (`bottom-start` is
  `bottom span-right`, `bottom-end` `bottom span-left`, `right-start`
  `right span-bottom`, and so on), and `position-try-fallbacks:
flip-block, flip-inline, flip-block flip-inline`; the gutter
  (`offset.mainAxis` over it, as Zag reads them) and the shift along
  the anchor (`offset.crossAxis`) are margins in cells on the anchor's
  side and the aligned edge's, which the engine mirrors with a flip
  (anchor-positioning.md). Zag's positioning runs with `applyStyles`, `flip`,
  and `listeners` off, its pixel result unused and its `data-placement`
  the placement asked for; the engine's flip shows as `data-mw-area`
  (anchor-positioning.md).
- **Floating parts live in the top layer.** The positioner carries
  `popover="manual"`; `syncTopLayer` shows it as the machine opens
  and hides it once the exit completes, so it paints last and unclipped
  (top-layer.md) and escapes any scroller it was opened from; the
  `hidden` Zag puts on the closed content is dropped, a closed
  popover being the UA's to hide. Zag keeps its own dismissal, focus,
  and inertness (`manual` gives the popover none of the UA's).
- **A dialog's backdrop is the `::backdrop`.** The dialog's positioner
  is the top-layer element and styles its backdrop with Tailwind's
  `backdrop:` variant; the engine tints the page under it
  (top-layer.md), and Zag's `backdrop` part goes unused. Zag's dialog
  machine keeps the focus trap, scroll lock, `aria-hidden` on the
  rest, Escape, and outside click.
- **Enter and exit are transitions on `data-state`.** An author
  gives the content `transition-*` classes with its closed look under
  `data-[state=closed]:` (`opacity-0`, `scale-95`) and its entering
  look under `starting:` (Tailwind's `@starting-style` variant), so
  the platform runs the enter as the state turns open and the exit as
  it turns closed, and the engine samples both as it samples any
  transition — a scaling dialog on its layer, a fading menu repainted.
  The positioner stays in the top layer until the exit has finished
  (`syncTopLayer`), so no discrete `display` transition is needed
  (top-layer.md deviation 4) and no keyframes: an author who wants a
  keyframe enter or exit instead animates the same states, and Zag's
  presence, which waits on `animation-name`, serves a framework that
  unmounts closed parts.
- **Accessibility is Zag's, verified on the grid.** Roles, ARIA
  states, keyboard maps, typeahead, managed focus, nested menus,
  and focus management come from the machines unchanged; the stories
  assert them through the light DOM, where assistive technology reads
  them.
- **The examples wear the host's colors.** A floating part is a
  surface in the host's `--mw-fg`/`--mw-bg` by the engine's own rule
  (top-layer.md), so the stories and the docs style each component
  with no color of its own — `bg-clear` on a menu's, popover's, or
  tooltip's content to show what lies behind the host, a dialog's
  content left opaque — palette colors for emphasis, which a theme
  quantizes, and borders in `currentColor`, so a component wears
  whatever theme its host does, shipped or custom, and draws its
  borders in the host's glyph set.
- **State flows as Zag's does.** Every component takes Zag's
  controlled and uncontrolled props unchanged — `open` and
  `defaultOpen` with `onOpenChange`, `highlightedValue`, `ids` for
  composition, an `id` per instance (`useId()` in React) that also
  names the anchor — and adds no state of its own: the monowind props
  derive from the placement asked for and the API's `open`. The
  framework packages follow a changed prop as Zag's adapters do; the
  vanilla mount reads its props once.

## Component layer (built 2026-09-21; plan `2026-09-19-ui-components.md`)

The functions above are the floor: the author writes every part's
markup and spreads its props. Two layers above them give the parts
names and props, one for markup and one per framework, both built on
the functions; the functions change only where the elements need them
to, and additively.

- **Elements for markup**: `<mono-menu>`, `<mono-submenu>`,
  `<mono-listbox>`, `<mono-select>`, `<mono-dialog>`,
  `<mono-popover>`, `<mono-tooltip>`, from
  `@monowind/ui/elements`, registered by `defineMonoUi()` as core's
  are by `defineMonoWind()` — the entry registers nothing on import,
  so the package's `sideEffects: false` holds; the CDN bundle calls it.
  An element is the vanilla mount's root and nothing more: no shadow
  root, its parts the `data-part` descendants the mount finds, all of
  them light DOM the engine lays out. It has no display of its own, so
  a `<mono-tooltip>` is inline and sits inside a paragraph's sentence,
  and one that wraps blocks needs none either — the engine splits an
  inline box around a block inside it (`cell-model.md`), so those
  blocks lay out as the parent's own. It exposes its `api` and
  `destroy()`.
- **The mount follows the markup.** The element mounts when its parts
  are there: at connection when they are (`innerHTML`, `append`, a
  framework's render, an upgrade after parsing), else — a document
  still parsing, the parser having connected the element before its
  children — at `DOMContentLoaded`; a `MutationObserver` on its
  subtree mounts again, a microtask after, when the marked parts come
  or go — the parts the mount was given, by identity, so a mount that
  writes into its own markup (a select filling the hidden control a
  form posts) changes none of them and starts no loop; a
  disconnection destroys the mount (hiding the popover), a
  reconnection mounts again. As the README asks of any vanilla
  positioner, `popover="manual"` in the markup keeps a page parsed
  before the script from showing the content in flow.
- **Attributes are the props, by type.** Each element lists its props
  with their types; each is the kebab-cased attribute (`close-on-select`,
  `loop-focus`, `open-delay`), the positioning flattened (`placement`,
  `gutter`, `offset-cross-axis`, `offset-main-axis`, in cells), and
  the dialog's `role` prop `content-role`, the element's own `role`
  being its own. A boolean is true by presence and false as `"false"`
  (React 19 removes an attribute it sets to `false`; `"false"` comes
  from string templating alone, and reads as it means); a number
  parses, a string stays a string (so a `highlighted-value` matches
  its item's `data-value` as written). Props without an attribute form
  — `ids`, `translations`, a menu's `navigate`, a listbox's and a
  select's `collection`, a dialog's `initialFocusEl` — are accessors
  on the class, so a framework that sets a property it finds (React
  does) hands the value over whole; setting the same value again does
  nothing, React setting one on every render. A name the DOM already
  carries is left alone and takes `setProp` instead — `getRootNode`
  is a method on every node, and an accessor would shadow it. `id`
  is the element's own, generated when it has none, and bound at the
  mount: a change to it mounts again. An attribute changed after the
  mount reaches the running machine (Zag's `updateProps`, through a
  `Mounted.updateProps` the vanilla mount gains) and the grid's props
  alike, the mount reading its props per render rather than once; a
  menu hands the behavior props it shares down to its submenus.
- **`open` is the state, reflected.** The machine stays uncontrolled:
  the attribute at the mount is the initial state, a later change
  opens or closes through `api.setOpen`, and the element writes the
  attribute from `onOpenChange` only when its presence differs from
  the state, so neither direction loops.
- **Events are the callbacks.** Every callback prop dispatches a
  bubbling `CustomEvent` on the element, named by the callback without
  its `on`, lower-cased as one run — `onOpenChange` is `openchange`,
  `onHighlightChange` `highlightchange`, and `onSelect` `itemselect`,
  since the native `select` event bubbles from inputs — its `detail`
  the callback's argument; where the argument carries a
  `preventDefault` (`onEscapeKeyDown`), cancelling the event calls it.
  One run, since React 19 attaches an `onitemselect` function prop on
  a custom element as a listener by that name; Vue's emits on the
  components below spell the same events Vue's way (`open-change`),
  both intended.
- **A submenu is an element of its own, mounted by its parent.**
  `<mono-submenu value="…">` sits where the `submenu` root sits, after
  its trigger item, with its own placement attributes. It marks its
  own `data-part` and `data-value` and publishes the props its
  attributes carry, which the menu's mount takes through
  `MountProps.submenus`, a record keyed by value that spans the whole
  tree — so nothing about attributes reaches `menu.ts`. Its own
  callbacks dispatch on it and bubble, and it reflects its `open`; a
  change to one of its attributes has the mount above it read the
  markup again.
- **Framework components over the functions**: each of
  `@monowind/ui-react`, `-vue`, `-svelte` exports from its one entry,
  beside its functions and tree-shaken like them (`sideEffects:
false`), the menu, dialog, popover and tooltip with Ark UI's
  anatomy — `Root`, `Trigger`, `Positioner`, `Content`, and per
  component `Item`, `ItemGroup`, `ItemGroupLabel`, `Separator`,
  `TriggerItem`; `Title`, `Description`, `CloseTrigger`; the popover's
  `Indicator`; the listbox's and the select's `Label`, `ItemText`,
  `ItemIndicator`, and the select's `Control`, `ValueText`,
  `Indicator`, `ClearTrigger`, `List` and `HiddenSelect`. React groups
  them as namespaces (`Menu.Root`), Vue and Svelte name them flat
  (`MenuRoot`), each framework's idiom. Ark's other parts (arrows, a
  backdrop, checkbox and radio items) are left for a later need.
  `Root` takes the machine's props, `id` optional and generated
  (`useId`, Vue's `useId`, Svelte's `$props.id()`), and hands the API
  down through context; `RootProvider` takes an author's own API from
  the functions instead. A menu's, a dialog's, a popover's and a
  tooltip's `Root` renders nothing — Zag gives those four no root
  part, and a wrapper invented for one would put a box in the grid's
  layout. Such a root takes no attributes, and says so twice: its type
  omits them, and a development build warns and names what it was
  given. The element layer is why that is worth saying — a
  class on `<mono-menu>` styles the element, while
  `<Menu.Root className>` can only go nowhere, so the same-looking
  line means opposite things one layer apart. A
  listbox's and a select's `Root` renders its root part, and takes
  attributes as any part does: a root's own props are the ones Zag's `propNames` lists, and
  the rest are its element's. An `Item` names one of the collection's
  items, by `item` or by the `value` that finds it there, and holds it
  for the `ItemText` and `ItemIndicator` inside; the select's
  `HiddenSelect` carries `display: none` over Zag's visually-hidden
  style, as the mount does and for the same reason: Zag's arrives with
  the first spread, a microtask late, and an in-flow `<select>` is a
  box as wide as its longest option, so the grid would jump. Either
  hiding suits the grid — measured in Chromium 2026-09-22, an
  absolutely positioned clipped control takes no cells, which is why
  `sr-only` content needs nothing of the engine. Every other
  part renders one element (a `button` for a trigger, an `h2` for a
  title, an `hr` for a separator, a `span` for a tooltip's, a `div`
  else) with the API's props for it merged (Zag's `mergeProps`) under
  the author's own — `class`, handlers, anything — and its children,
  or with `asChild` renders its one child element with those props
  merged onto it; `Positioner` owns the top layer as the function
  does. A `Menu.Root` inside another's content is a submenu, linked to
  its parent through context, its `TriggerItem` the parent's item, and
  `asSubmenuOf` gives it the same side and inherited behavior a marked
  `submenu` root gets. Callbacks are props in React and Svelte and
  listeners in Vue (`@select`), each framework's idiom, and a
  controlled prop follows that idiom too: a React part takes the props
  of the element it renders, a Vue root emits `update:open` and its
  kin for `v-model`, and a Svelte root's are `$bindable()` for
  `bind:`. A Svelte
  snippet renders DOM rather than describing it, so Svelte's stand-in
  for `asChild` is a `child` snippet the part hands those props to,
  and its positioner renders its own element, which carries the
  action. The Svelte parts are `.svelte` files shipped as source under
  the package's `svelte` condition, as its `.svelte.ts` module is; the
  peers (Vue 3.5, Svelte 5.20) already carry the id generators.
- **Nothing else moves.** The functions stay public and are what the
  components call; the elements work as markup in any framework (Solid
  included, until `@zag-js/solid` runs on Solid 2) and are the whole
  answer for a markup-first stack — htmx, Turbo, Alpine, a server's
  views — which swaps them in and out and listens to their events
  (`hx-trigger="itemselect from:closest mono-menu"`); the playground's
  sample and its `data-component` mounting give way to the elements.

## Testing

- Node: the placement mapping to `position-area`; the vanilla path's
  parts found and wired, a list's collection read from its markup and a
  select's hidden control among them; the show and hide of the
  positioner around the exit's transitions; the React hooks and Vue
  composables rendered through their frameworks (`hooks.test.tsx`,
  `composables.test.ts`), a component with no floating part included.
- Storybook, per component, in every engine: the listbox's roles, its
  value selected by press and by Enter with the indicator following it
  on the grid, the pointer highlight its root asks for, and the list
  scrolled to the item the keyboard highlights; the select's list
  anchored under its trigger, the value it puts on the trigger and in
  its form control, and that control left out of the layout; per
  anchored component, open and close by pointer and keyboard; the
  floating part's cells directly under (or beside, above) the trigger
  and the light element's box on them, over
  the page's later text; Escape and focus restore (an outside press
  dismisses through Zag's document listener on a deferred animation
  frame, which WebKit suspends in a backgrounded window, so the
  stories leave it unasserted); the highlight moved by the arrows,
  typeahead, and a submenu for the menu; the focus trap
  and the tinted page for the dialog; an exit transition on
  `data-state` holding the positioner in the top layer to its end; a
  grid drag over the popover's text selecting it. The
  flip at the host's edge and the escape from a scroller are the
  engine's, tested in the positioning stories, one of them on a box the
  browser would have flipped itself.
- Visual: a golden of each component open.
- Proposed with the component layer: node tests of an element's
  attributes read as props, a change reaching the machine, `open`
  reflected both ways, an event per callback, a submenu's own
  attributes; the React and Vue components rendered in node, the
  Svelte ones through the Svelte example; a story per element.

## Touch points on implementation

- The engine, first: ARIA widget roles among the elements that take
  pointer events in grid mode (cell-model.md), a handled arrow key
  left to its widget under `focus="arrows"` (focus-navigation.md), and
  anchor names scoped to their subtree while the engine reads
  (anchor-positioning.md), so a menu's items highlight under the
  pointer, its arrows move the highlight, and the browser's own
  fallback never reaches the values read.
- `packages/ui-react`, `packages/ui-vue`, `packages/ui-svelte`: one
  entry each, a function per component over `@monowind/ui` and the
  adapter; the React and Vue ones tested in node through their
  renderers, the Svelte one through the Svelte example's smoke test
  (its runes compile in the consumer's Svelte plugin; the package
  ships `.svelte.ts` source, as Svelte libraries do).
- `packages/ui`: `anchor.ts` (the placement table, the anchor name,
  the props and their merge, `anchoredApi`), `top-layer.ts`
  (`syncTopLayer`, its own `./top-layer` subpath for the framework
  packages), `vanilla.ts` (the parts, the mount, and the anchored mount
  over it), `items.ts` (the markup's collection and the item parts a
  listbox and a select share), `scroll.ts` (the highlight scrolled into
  the content box), and `menu.ts`, `listbox.ts`, `select.ts`,
  `dialog.ts`, `popover.ts`, `tooltip.ts` (each `props`, `api`, the
  mount); `@zag-js/vanilla` and the machines as dependencies;
  `dist/cdn.js` for classic scripts, `monowind.ui`.
- storybook: `ui.stories.ts` under `Packages / ui`, beside
  the other packages' elements, a story per component, the vanilla
  path wired from each story's render.
- examples: the React, Vue, and Svelte ones carry a menu and a dialog
  through their packages; the playground's sample carries a menu and a
  dialog, mounted on roots marked `data-component`.
- README: the components section; the package's own README.
- Proposed: `packages/ui/src/elements/` (a base element over the
  vanilla mount: attribute parsing, `open` reflection, events, the
  lifecycle; one subclass per component; `defineMonoUi`), the
  `./elements` subpath and the CDN bundle; `components/` in each
  framework package, exported beside the functions.
