# `@monowind/ui` component layer implementation plan

Status: **built 2026-09-21**; the release notes are the release's. Spec: `ui.md` "Component layer" — normative; this plan sequences
it. Follows the 0.3.0 release; ships as a patch release, everything in
it additive.

## Shape

Two layers over the functions `@monowind/ui` and the framework
packages already ship: custom elements for markup (`<mono-menu>` and
its kin, attributes for props by type, events for callbacks, the
vanilla mount inside, reading its props per render), and compound
components per framework (`Menu.Root`, `Menu.Trigger`, …, the
functions inside, `asChild` and `RootProvider` as Ark UI has them).
The elements also serve any framework as plain markup.

## Phases (each ends green: `pnpm check`, `pnpm test`, the visual sweep)

### 0. Probe — DONE

- ~~A parser-created custom element's children at `connectedCallback`~~
  **MEASURED 2026-09-21**, Chromium, Firefox and WebKit agreeing
  exactly. Children at `connectedCallback`: none for an element the
  parser made (its own `connectedCallback` runs at the START tag),
  none for one appended empty and filled after; all of them for one
  built and filled before it was inserted, or arriving in an
  `innerHTML` swap. A microtask does NOT rescue the parsed case — it
  still reads none, a 4000-child element included — so the rule takes
  four branches, not two:

  ```
  children at connectedCallback   → mount now
  else readyState === "loading"   → mount at DOMContentLoaded
  else                            → mount after a microtask
           still none             → childList observer, one shot
  ```

  The last two are what an enhancer library needs: a framework that
  appends the element and fills it in the same tick is caught by the
  microtask, and one that fills it in a later task only by the
  observer. Measured with a throwaway Playwright page per case: an
  element the parser makes, one appended empty then filled, one built
  and filled before insertion, and one filled a task later.

- ~~Zag's `VanillaMachine.updateProps` mid-life~~ **MEASURED
  2026-09-21** against Zag 1.44. The constructor already takes a
  getter, so a mount reading its props per render needs nothing new: a
  `placement` change reaches `getPositionerProps` on the next read
  (`bottom span-left` becomes `top span-right`). `updateProps` DEEP
  MERGES a partial, so `{ positioning: { placement } }` alone keeps
  the grid's `applyStyles: false`, `flip: false` and `listeners:
false` — the mount may hand it a partial and need not re-run
  `props()`. `api.setOpen` works after an update, one tick later:
  Zag defers its sends, so a caller reads `open` after a microtask.
  `mergeMachineProps` is NOT public — `@zag-js/vanilla` exports
  `VanillaMachine`, `mergeProps`, `normalizeProps`, `spreadProps` and
  `toStyleString`, and the merge above makes it unnecessary.
- ~~An inline custom element wrapping a trigger and a top-layer
  positioner~~ **MEASURED 2026-09-21**, the three engines agreeing.
  The flow half works: an unknown element is `display: inline`, mounts
  over its children, and a paragraph wraps around the trigger inside
  it, the text resuming on the row below the trigger's box.

  The top-layer half does NOT, and the wrapper's display is why — a
  positioner is placed only where its parent generates a box:

  | wrapper `display`                     | painted | `data-mw-area`    |
  | ------------------------------------- | ------- | ----------------- |
  | `inline` (a custom element's DEFAULT) | no      | none              |
  | `inline-block`                        | yes     | `span-all bottom` |
  | `block`                               | yes     | `span-all bottom` |
  | `contents`                            | no      | none              |

  **FIXED in the engine rather than worked around**: the table above
  was a bug, not a deviation. `tree.ts` says out-of-flow children "hang
  off the leaf as layout nodes for the positioning pass", and the
  collection loop only ever read the root's DIRECT children, while the
  run walker skipped a nested one without building it — the same
  nesting that atomic inline boxes already handled through
  `nestedBoxes`. A run now keeps what it meets at any depth, and all
  four displays place and paint. So an element needs no display of its
  own, and `display: contents` works.

  A `<span>` positioner is fine too — the first failure was the
  wrapper, not the part — which matters for the tooltip case, since a
  `<div>` inside a `<p>` closes the paragraph at parse time. Probes in
  a throwaway page per wrapper — `<div>`, `<span>` and
  `display: contents` — each holding a positioner inside a sentence.
  The guard that keeps it true is `anonymous-runs.test.ts` "keeps an
  out-of-flow element the run met below a direct child".

- ~~React 19 on a custom element~~ **MEASURED 2026-09-21** against
  React 19.3. Every branch the elements need is the one they want:

  | prop                | what React does                 |
  | ------------------- | ------------------------------- |
  | `open={true}`       | attribute `open=""`             |
  | `open={false}`      | attribute REMOVED               |
  | `count={3}`         | attribute `count="3"`           |
  | `items={[…]}`       | set as a PROPERTY, no attribute |
  | `onitemselect={fn}` | listener for `itemselect`       |

  So a boolean reads as an HTML boolean, a number as its string, and a
  lowercase `on*` prop needs no wrapper — the callback fires with the
  `CustomEvent` and reads its `detail`. React finds a property with
  `in`, so anything the class declares a setter for takes the value
  whole rather than stringified, which is how a collection reaches the
  element without an attribute.

  One thing to design around: React re-sets a discoverable property on
  EVERY render when the value is a fresh reference (`items` above is
  set again on a render that changed only `count`), so a setter must
  compare before it does work.

- ~~Vue slots and Svelte 5 snippets carrying Zag's props down through
  context~~ **MEASURED 2026-09-21**, Vue 3.5 and Svelte 5.57 agreeing.
  Context follows the RUNTIME tree, not the template's lexical scope,
  so the compound shape works in both without a workaround: an item in
  the Root's default slot (Vue `provide`/`inject`) or its children
  snippet (Svelte `setContext`/`getContext`) reads that Root, one
  nested inside a plain wrapper element reads it too, and a Root inside
  a Root shadows it for its own items.

- ~~`asChild` merging onto a child element in each framework~~
  **MEASURED 2026-09-21**. It is one pattern in React and Vue and a
  different one in Svelte, and the two that share it disagree on
  precedence:

  - **React 19** — `cloneElement` carries everything, `ref` included
    (a ref is a prop now, and two chained by hand both fire). The merge
    is ours to write, so the precedence is ours to choose: Ark's, which
    is the author's class after the API's and the API's handler first.
  - **Vue 3.5** — `cloneVNode(vnode, apiProps)` merges by itself, and
    the OPPOSITE way round: the extra props go on top of the vnode's,
    so the class comes out `author-class api-class` and the author's
    handler runs first. To match Ark, merge explicitly with
    `mergeProps(apiProps, vnode.props)` rather than lean on
    `cloneVNode`'s own order.
  - **Svelte 5** — a snippet renders DOM, not a description of it, so
    there is nothing to clone and `asChild` cannot work as it does
    elsewhere. The equivalent is a `child` snippet the part renders
    with its props: `{#snippet child(props)}<button {...props}
…>{/snippet}`. The author spreads and chains, so the merge is
    explicit and theirs — no surprise, but no automatic precedence
    either, and the docs have to say so.

- ~~Ark UI's part list, `asChild`, `RootProvider`, and `mergeProps`
  order~~ **READ 2026-09-21** from Ark's menu package and the installed
  Zag 1.44.

  The menu's parts, to name ours after: `Root`, `Trigger`,
  `TriggerItem`, `ContextTrigger`, `Positioner`, `Content`, `Arrow`,
  `ArrowTip`, `Item`, `ItemText`, `ItemIndicator`, `ItemGroup`,
  `ItemGroupLabel`, `CheckboxItem`, `RadioItem`, `RadioItemGroup`,
  `Indicator`, `Separator` — plus `RootProvider`, and `useMenu`,
  `useMenuContext`, `useMenuItemContext`, `menuAnatomy` beside the
  namespace. `RootProvider` takes the whole hook return on a prop named
  `value` and hands its `api` and `service` down, so a caller that
  needs the api outside the tree runs `useMenu()` itself and provides
  it rather than reaching into `Root`.

  `mergeProps(a, b)` in Zag, read from source, does NOT do one thing
  consistently, and neither framework's own merging matches it:

  | key       | `mergeProps(api, author)` gives |
  | --------- | ------------------------------- |
  | `class`   | `"api-class author-class"`      |
  | `on*`     | the AUTHOR's handler first      |
  | `style`   | the author's wins per property  |
  | any other | the author's wins               |

  So the class reads API-first while the handler runs author-first.
  React's `cloneElement` leaves the order to us, and Vue's `cloneVNode`
  picks its own (author's class first, author's handler first) — which
  is why every part in every framework should merge with Zag's own
  `mergeProps` rather than lean on the framework, and why `asChild`
  must not hand-roll the chaining.

### 1. The functions' additions — DONE

- ~~`vanilla.ts`: `mount()` takes the props as a getter read per
  render~~ **DONE**: `liveProps(authored, derive)` holds the authored
  props and re-derives the machine's on every change, `mount()` takes
  it and `Mounted.updateProps(partial)` merges a level deep (Zag's own
  `updateProps` semantics) before spreading again. A menu's
  `updateProps` hands the `SHARED` behavior props down to its
  submenus, never its id or placement. Guarded by two tests in
  `menu.test.ts`.

### 2. The elements — DONE

- ~~`element.ts`: a base class over the vanilla mount~~ **DONE**, as
  planned, with two shapes the plan did not foresee:
  - The four positioning attributes are read TOGETHER, not merged one
    by one: they are a single `positioning` prop, and a partial that
    carried only `offset.crossAxis` would drop `offset.mainAxis`
    through Zag's one-level merge.
  - A prop no attribute can carry is an ACCESSOR on the class, not
    just `setProp`: React sets a property it finds with `in`, so a
    `collection` reaches the element whole rather than stringified,
    and a set to the same value does nothing, React setting one on
    every render. A name the DOM already carries is left alone —
    defining `getRootNode` shadowed the method every node has, which
    broke the engine's own reads until the guard went in.
  - A `<mono-submenu>` has no mount of its own, so the base gained
    `Definition.part`: such an element marks its `data-part`, names
    itself `data-value` from `value`, and `publish()` returns the
    props it carries. `remount()` lets an attribute change on one
    reach the mount above it, which `#owner()` walks up to find.
- ~~One subclass per component~~ **DONE** in `elements/index.ts`, all
  seven. The menu mount takes per-submenu props through its own
  `MountProps.submenus`, a record keyed by value that spans the whole
  tree — an element layer fills it, and nothing about attributes
  leaks into `menu.ts`.
- ~~`defineMonoUi()`, the `./elements` subpath, `cdn.ts`~~ **DONE**;
  the subpath registers nothing on import, the CDN bundle calls it.
- ~~Tests~~ **DONE**: `elements.test.ts`, 14 in happy-dom, covering
  every kind of attribute, the positioning fold, the generated and
  changed id, a property set as one and set again unchanged, the
  events and the
  cancellation relay, `open` both ways without a loop, the submenu's
  marking and placement, the remount as parts arrive, and the
  end-of-parse branch with `readyState` held at `loading`. The
  browser's own parser behavior is the phase 0 probe's; a standing
  Playwright page for it would need a static page in the visual
  suite's served build, which nothing else there needs yet.
- ~~Stories, playground, README~~ **DONE**: an `Elements` story in
  `ui.stories.ts` (menu with a submenu, a dialog opened by the
  selection event and closing itself back onto the attribute, a
  tooltip in a sentence), green in all three engines; the playground's
  sample on `<mono-menu>` and `<mono-dialog>` with `data-component`
  and its mounting gone; the README's "Elements" section.
  - An element has NO display of its own, which is right for a
    tooltip in a sentence. One wrapping blocks first needed a block
    display, the engine skipping a block inside a text run — the
    phase 0 probe measured `contents` for placing a positioner, which
    is inline content, so it did not see that. The engine now splits
    an inline box around a block, as CSS does (`cell-model.md`), so
    an element needs no display at all; the stories and the examples
    give none.

### The three framework layers — DONE

Each is the same shape over that framework's own hook, composable, or
`create…`, never over the machine: one module holds the whole
mechanism (the merge, `asChild`, the context, the root and
root-provider factories) and a component file is then only its list of
parts. Six each — menu, dialog, popover, tooltip, listbox, select —
and a second shared module for the item parts, Zag giving a listbox
and a select the same five getters.

Two rules came out of building them and live in `@monowind/ui` so all
four paths share them:

- `asSubmenuOf(parent, own)` in `menu.ts` — the side a submenu opens
  on and the behavior its parent shares. The mount applies it to a
  marked `submenu` root and every framework's nested root applies it
  too, so a submenu behaves the same however it is written. The
  README's old note that a framework submenu must name its own
  placement is gone with it.
- `propNames` re-exported from each entry (Zag's own list). Vue
  declares its components' props from it rather than a hand-written
  copy, and all three tell a listbox's or a select's own props from
  the attributes its root element takes.

Each framework package also re-exports `collection` and
`gridCollection`, so an app takes one dependency rather than two.

A root with no part of its own takes no attributes, and says so
twice: the type omits them, and a development build warns and names
them. The element layer makes that worth doing — a class on
`<mono-menu>` styles the element, while `<Menu.Root className>` can
only go nowhere, so the same-looking line means opposite things one
layer apart.

Each layer follows its own framework's idiom for a controlled prop,
which is what the components are for: React parts take the props of
the element they render (`Menu.Trigger` autocompletes a button's, a
typo is an error, a `ref` reaches the node), a Vue root emits
`update:open`, `update:value`, `update:highlighted-value` and
`update:trigger-value` so `v-model` binds, and a Svelte root declares
those same four `$bindable()` so `bind:` does. Each is covered by a
test that drives the machine and reads the bound state back.

Each hook, composable and `create…` now returns the machine's
`service` beside the API: Zag links a submenu to its parent by
service, and nothing else could reach it.

### 3. The React components — DONE

- `packages/ui-react/src/components/`: `Menu`, `Dialog`, `Popover`,
  `Tooltip`, `Listbox` and `Select` namespaces, exported from the
  package's one entry beside
  the hooks (which moved to `hooks.ts`, the entry now a barrel, so
  nothing imports in a circle). `part.tsx` holds `renderPart`,
  `definePart`, `defineContext`, `defineRoot` and
  `defineRootProvider`; a ref is a prop in React 19, so the merge
  chains the two sides' refs rather than letting the later win.
- `hooks.test.tsx` gained three: the parts rendered with a nested root
  anchored to its trigger item, `asChild` merging onto the one child
  with both refs reaching the node and both handlers running in Zag's
  order, and a part outside its root throwing.
- `apps/example-react` is on the components, submenu, select and
  `asChild` included.

### 4. The Vue components — DONE

- `defineComponent` with render functions, so nothing new compiles:
  `provide`/`inject`, a callback bound as a listener (`@select`,
  `@open-change`), `as-child` through the default slot's one element,
  the positioner's ref inside the part. Vue fills a declared prop that
  was not passed with an explicit `undefined`, which would beat a
  default of Zag's, so a root drops those before handing them over.
  `cloneVNode` merges the child's own props over the part's, which
  gives Zag's own handler order; only the class string's order
  differs, which nothing can observe.
- `components.test.ts` mirrors the React tests; `apps/example-vue` is
  on the components.

### 5. The Svelte components — DONE

- One `.svelte` file per part over `Part.svelte` (or
  `Positioner.svelte`, which carries the action), context through
  `setContext`/`getContext`. A snippet renders DOM rather than
  describing it, so `asChild` is a `child` snippet the part hands its
  props to. A `…RootProvider` holds the API it is given through
  getters — a prop read outside a closure captures only its first
  value.
- `components.test.ts` mounts every component the package ships
  through one `Harness.svelte`, under `@sveltejs/vite-plugin-svelte`
  and happy-dom (vitest needs `resolve.conditions: ["browser"]`, or
  Svelte resolves to its server build and `mount` throws). That, and
  the example app's build, are what compile and check the components.
- **`svelte-package` and `svelte-check` are blocked on TypeScript 7**:
  `svelte2tsx` refuses it outright ("emitDts is not compatible with
  TypeScript 7.0.2"), and `svelte-check` wants TypeScript 6 and 7
  installed side by side plus `--tsgo`. Until the Svelte language
  tools support TypeScript 7, the package keeps shipping its source
  under the `svelte` condition — which is what a Svelte consumer
  resolves, and their own tooling types it from source. Revisit for
  full published types; the ambient `*.svelte` declaration Svelte
  ships is what `tsc` uses meanwhile.
- `apps/example-svelte` is on the components, and
  `scripts/framework-smoke.mjs` gained a submenu assertion, so all
  three examples now prove the nesting in a real browser, and the
  select — chosen from its list, written into its trigger, carried by
  the native control a form would post.

Each framework package re-exports `collection` and `gridCollection`,
so an example takes one dependency rather than two. Building the
examples' selects is what showed that `ValueText` rendered only what
it was given: it now shows the selection, with its children the
placeholder, as the vanilla mount writes it.

### Solid — the elements are its path, and the example proves it

`@zag-js/solid` reaches `solid-js/web` through
`@solid-primitives/keyed`, which Solid 2.0 RC no longer exports, so
there is no adapter to build bindings on: Zag's own issue for it
(chakra-ui/zag#3211, closed 2026-07-20) has the maintainer waiting on
Solid 2 to land, with a `@zag-js/solid-v2` package as a maybe. The
`<mono-*>` elements need no adapter — they carry the vanilla mount —
so they are the answer for Solid, and `apps/example-solid` is on
them: a menu with a submenu, a dialog and a select, driven by the
same shared smoke as the other three.

Two things came out of putting it there, neither of them Solid's:

- **`<mono-select>` mounted itself forever.** The mount fills the
  hidden control with an option per item, which is a childList change
  inside the element, which the subtree observer read as new markup,
  which mounted again. It pinned the renderer, so the page never
  even fired `DOMContentLoaded` — the failure looked like a dev-server
  problem for a while. A mount now records the marked parts it was
  given, by identity, and the observer remounts only where they
  differ: a mount writing into its own markup changes no part.
  Guarded by an `elements.test.ts` case over a `<mono-select>`.
- **Solid 2.0 RC's `on:` namespace leaks its colon**: `on:itemselect`
  compiles to `addEventListener(":itemselect", …)`, so the example
  puts the listener on through a ref, which is what every framework
  can do anyway.

The shared smoke navigates with `domcontentloaded` and a minute's
grace, the host's own ready flag being the real signal: a dev server
holds the first navigation while it pre-bundles, and reloads the page
when it finds a dependency mid-load, which aborts a `load` wait.

### What a review of the whole thing turned up

- **`@monowind/ui/framework`**, a new subpath: `ItemApi` had been
  declared four times over (the mount and each framework) and
  `warnStray` three, a user-facing sentence copied per package. Both
  live there now, and the packages import them.
- **A select's label must be a `<label>`.** Zag normalizes a listbox's
  through `normalize.element` and a select's through `normalize.label`,
  with `htmlFor` for the hidden control; rendering the select's as a
  span dropped the association a click needs. Fixed in all three, with
  a test on the tag and the `htmlFor`.
- React's `asChild` error came from `Children.only`, naming React
  rather than the part, where Vue and Svelte both name it. It counts
  the children itself now and says the same sentence.
- **Every component is rendered by a test, and a guard holds it
  there.** Svelte compiles a `.svelte` file only where something
  instantiates it, so a part no test mounts is a part nothing
  compiles — 34 of 73 were in that state. React and Vue turned out to
  have the same hole for the same reason (36 and 38 uncovered, all of
  Dialog, Popover and Tooltip in React among them), reached only
  through the example apps, which carry a menu, a dialog and a select
  and nothing else. Each package now has an `every.test` that mounts
  every part and a `coverage.test` that reads its own index and fails
  naming any export no test file instantiates. The guards are
  negative-tested: take a component out of the harness and the guard
  names it.
- **`check-workspace-deps.mjs` gained the same kind of rule.**
  `pnpm -r typecheck` runs the script where a workspace has one and
  skips the workspace where it does not, which is how four styling
  examples shipped unchecked. A workspace with TypeScript sources and
  no `typecheck` script now fails `pnpm check`.
- **Every element's props, checked against Zag's.** The frameworks
  take `propNames` from Zag and are complete by construction; the
  elements list theirs by hand, and eight were missing — a select's
  four dismissal callbacks, a listbox's `orientation` and
  `selectionMode`, a combobox's `disableLayer` and
  `alwaysSubmitOnEnter`, a menu's `anchorPoint`, a popover's
  `finalFocusEl`, `onRequestDismiss` on the three that have it, and
  `aria-label` on the three that name their content. A test in
  `elements.test.ts` now compares each element's declared props with
  its machine's `props` BOTH ways, so a Zag upgrade cannot reopen the
  gap. The reverse direction found the mirror bug the `trigger-value`
  split had: a select and a combobox were handed an `onEscapeKeyDown`
  their machines do not have (the dismissal callbacks are now
  `OUTSIDE`, the three every list closes on, and `DISMISSABLE`, those
  plus Escape and `onRequestDismiss`), `translations` reached all seven
  elements where three machines take it, and a dialog's `restoreFocus` was both an
  attribute and a property. `value`/`defaultValue` stay out, listed in
  the test: Zag types them `string[]` and markup has no agreed way to
  spell a list.

### The engine gained block-in-inline

Putting the elements in a page found a real deviation from CSS, now
closed: a block under an `inline`/`contents` element was SKIPPED and
warned about, where CSS splits the inline box around it (CSS 2.1
§9.2.1.1). A custom element is inline, so every `<mono-*>` wrapping
paragraphs met it, and a block display was the workaround.

`tree.ts` now splits: `hidesBlock` finds a block below a run-inline
child, which makes the parent a CONTAINER rather than a leaf
(`buildTree`, `buildRootLeaf`), and `buildChildren` flattens that
child into its own children so the block reaches the container's loop
and the inline content each side of it falls into the runs around it.
An atomic inline box is its own formatting context and keeps its
blocks. Flattening put elements among a leaf's `elementChildren` that
are not its DOM children, which the out-of-flow dedupe had keyed on:
it now keys on what the placing loop actually holds, or the positioner
inside a split inline is built twice. Cost: `hidesBlock` answers before reading a style where an
inline element has no element children, which is nearly all of them —
`pnpm bench` reads 226 ms against the 231 ms before it, inside the
±5 ms noise floor.

The elements need no display at all now: the stories, the examples
and the READMEs give none, and the `Elements` golden is unchanged
without it.

### The combobox, added 2026-09-22

`@monowind/ui/combobox`, its element and its components in all three
frameworks, the shape `select.ts` set. Two things are its own:

- **It anchors to the `control`**, the box around the input and the
  trigger, not to the trigger alone, so the list lines up under what
  the reader types. Zag's combobox trigger takes different props from
  the others, so it does not fit `anchoredApi`; the anchoring math it
  shares moved out as `anchoringOf`.
- **Filtering hides what it drops.** A combobox filters by narrowing
  its collection, and an item outside it used to stand in the list as
  plain markup — `itemParts` gained `hideUnlisted`, which only the
  combobox asks for, a listbox or a select keeping an item its
  collection leaves out.

**A partial must not reach into a class.** `withProps`, the mount's
merge, called anything that was not an array a plain object and
merged it a level deep — so a narrowed `collection` arrived as
`{ ...previous, ...next }`, an object literal carrying the items and
none of the accessors (`firstValue`, `find`) the machine navigates
by. The list narrowed on screen and the keyboard stopped moving:
`highlightFirstOrSelectedItem` read `prop("collection").firstValue`
and got `undefined`. `isPlain` now asks the prototype, as Zag's own
`mergeMachineProps` does, and the same merge had been mangling every
other class a partial can carry — the `initialFocusEl` and
`finalFocusEl` elements among them, and an element's `collection`
property, which a framework sets on every render.

Zag's `machine.updateProps` had been hiding it, its merge being
prototype-aware: the machine read a whole collection through its own
wrapper while ours read a broken one. It cannot stay, though — it
wraps the props source per call, and a combobox filtering per
keystroke pays for every keystroke before it (100 calls 671 ms, the
sixth hundred 6022 ms). The machine reads its props from the getter
it was started on, so all it is owed is the re-run of its watchers
that `notify` is, with `updateProps` behind it as the slow fallback.
A test holds the cost flat. Either way the machine publishes and the
mount renders from the subscription it took out, so the render the
mount used to make itself was a second spread of every part per
keystroke; it is gone.

Building its story found a bug in the mount: `updateProps` also handed
the props to `machine.updateProps`, which the machine never needed —
it was started on a GETTER and reads them itself — and which LOST them
when called from inside a machine callback, the transition re-applying
what it started with. That is exactly how a combobox filters, from
`onInputValueChange`, so filtering never worked. Pinned by a test that
narrows from inside the callback.

Also scoped along the way: the elements' `COMMON` gave a listbox and a
select two `trigger-value` attributes their machines do not have, now
split into `DIRECTION` and `TRIGGERS`; and `WithMarkupItems` required
a required `collection`, where a combobox's is optional.

### Eight more examples, added 2026-09-22

Two claims the README makes had no app behind them, and each now has
four.

**The engine reads computed styles, so any CSS tool works.**
`example-unocss`, `example-panda`, `example-vanilla-extract` and
`example-stylex` each style the same page with a different tool —
atomic classes, a build-time recipe, a `.css.ts` file, a compiled
`props()` call — and `scripts/styling-smoke.mjs` asserts the same five
things of all four: a box the engine measured, a border drawn as
glyphs, `--mw-border-glyphs` set as a plain custom property (the escape
hatch a non-Tailwind tool needs, since `borders-rounded` is a Tailwind
name), a color that reached the paint, and the text on the grid.

**`<mono-*>` elements are the path for anything that is not React, Vue
or Svelte.** `example-htmx`, `example-alpine`, `example-turbo` and
`example-datastar` each drive a `<mono-menu>` with attributes alone,
no page JavaScript: the element mounts itself, so its trigger carries
Zag's roles before the enhancer has run a line, and its `itemselect`
event is what the enhancer binds to. `scripts/enhancer-smoke.mjs`
holds the shared body — up to and including opening the menu and
picking an item, which is the same in all four — and each app passes a
`drive` that asserts what its own idiom did with the event: htmx
swapping a fragment in, Alpine writing to `x-data`, Turbo navigating a
frame from the anchor inside the item, Datastar setting a signal. The
enhancers load from a copied vendor file rather than a CDN, so the
tests are offline; `scripts/copy-vendor.mjs` is the one copier, and an
app's own `copy-vendor.mjs` is the eight lines that name its bundles
and `import.meta.resolve` its extras.

### 6. Docs and release

- ~~`ui.md` status; root README's components section; the four
  READMEs~~ **DONE**. `ui.md` records what was built, including where
  it differs from what was proposed: Vue and Svelte name their parts
  flat, a
  submenu element publishes its props rather than having its parent
  read its attributes, and the listbox's and select's long anatomies
  stay the hook, the composable, the `create…` and the elements.
- Release notes over the tag range, with the release.
