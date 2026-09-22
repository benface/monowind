# `@monowind/ui` component layer implementation plan

Status: **proposed** (2026-09-19). Spec: `ui.md` "Component layer" —
normative; this plan sequences it. Follows the 0.3.0 release; ships as
a patch release, everything in it additive.

## Shape

Two layers over the functions `@monowind/ui` and the framework
packages already ship: custom elements for markup (`<mono-menu>` and
its kin, attributes for props by type, events for callbacks, the
vanilla mount inside, reading its props per render), and compound
components per framework (`Menu.Root`, `Menu.Trigger`, …, the
functions inside, `asChild` and `RootProvider` as Ark UI has them).
The elements also serve any framework as plain markup.

## Phases (each ends green: `pnpm check`, `pnpm test`, the visual sweep)

### 0. Probe

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

- React 19 on a custom element: a boolean attribute from `false`
  (removed), a number, a function prop `onitemselect` attached as a
  listener.
- Vue slots and Svelte 5 snippets carrying Zag's props down through
  context: a `Menu.Item` inside a `#default` slot reads the Root's
  context; a nested `Menu.Root` sees its parent; `asChild` merging
  onto a child element in each framework.
- Ark UI's part list, `asChild`, `RootProvider`, and `mergeProps`
  order, to match its names and precedence (the author's class after
  the API's).

### 1. The functions' additions

- `vanilla.ts`: `mount()` takes the props as a getter read per render;
  `Mounted.updateProps(partial)` merges into the machine's and the
  grid's props; a menu's `updateProps` hands the shared behavior props
  to its submenus. Tests in `menu.test.ts`: a placement change moving
  the positioner's props, a shared prop reaching a submenu.

### 2. The elements

- `packages/ui/src/elements/element.ts`: a base class over the vanilla
  mount — a typed attribute table per element (booleans, numbers,
  strings; the positioning attributes folded into `positioning`;
  `content-role` for the dialog's `role`), `observedAttributes` from
  it, `id` from the element or generated and a change to it mounting
  again, the mount at connection or `DOMContentLoaded` with the
  subtree observer mounting again as parts come or go, `open` as the
  initial state and `api.setOpen` after with the reflection guarded on
  presence, one `CustomEvent` per callback (`itemselect` for
  `onSelect`) with the argument as `detail` and `preventDefault`
  relayed, `api` and `destroy()` exposed, `attributeChangedCallback`
  into `updateProps`, `disconnectedCallback` destroying.
- `menu.ts`, `submenu.ts`, `listbox.ts`, `select.ts`, `dialog.ts`,
  `popover.ts`, `tooltip.ts`: one subclass each with its table and
  callbacks; the menu mount takes
  `<mono-submenu>` roots as it takes `[data-part=submenu]` today,
  reading their attributes for the submenu's positioning and
  reflecting their `open`.
- `index.ts` with `defineMonoUi()`; the `./elements` subpath in
  package.json (registering nothing on import); `cdn.ts` calls it.
- Tests (`elements.test.ts`, happy-dom): attributes to props by type,
  a change reaching the machine and the positioner, `open` reflected
  both ways without a loop, an event per callback, a submenu's
  attributes, a remount on parts added; a Playwright page for the
  parse-time mount.
- Stories: an `Elements` story in `ui.stories.ts` with a `<mono-menu>`
  and a `<mono-dialog>` driven by attributes and events, a
  `<mono-tooltip>` inside a sentence; the playground's sample on the
  elements, `data-component` and its mounting removed; README.

### 3. The React components

- `packages/ui-react/src/components/`: `Menu`, `Dialog`, `Popover`,
  `Tooltip` namespaces over `useMenu` and the others — `Root` with a
  context and `RootProvider` over an author's API, parts rendering
  their element with the API's props merged under the author's
  (`mergeProps`) or, with `asChild`, cloned onto the one child,
  `Positioner` carrying the hook's ref, a nested `Menu.Root` linking to
  its parent; exported from the package's one entry beside the hooks,
  tree-shaken like them.
- `hooks.test.tsx` gains the components rendered; `apps/example-react`
  moves to them; README.

### 4. The Vue components

- `defineComponent` per part with `provide`/`inject`, callbacks as
  emits (`open-change`), `asChild` through the default slot's one
  element, the positioner's template ref inside `Positioner`; test,
  example, README.

### 5. The Svelte components

- `.svelte` files per part on `createMenu` and the others, context
  through `setContext`/`getContext`, `children` snippets and `asChild`
  through a snippet receiving the props, the positioner's action
  inside `Positioner`; the example smoke test covers them; README.

### 6. Docs and release

- `ui.md` status; root README's components section; the four
  READMEs; release notes over the tag range.
