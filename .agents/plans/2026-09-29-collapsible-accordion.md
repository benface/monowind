# Collapsible and accordion

Status: **implemented 2026-09-29**. The spec is
`.agents/specs/ui.md` (normative: "A disclosure stands in the flow",
"A collapsible's size variables are dropped", "An accordion's markup
marks its open items", and the component layer's lists); this plan
orders the work onto the packages as they stand at `f1393d9`.

## Scope

In: `@monowind/ui/collapsible` and `@monowind/ui/accordion` — each
one's `props`, `machine`, `connect`, `api` and vanilla mount; the
`<mono-collapsible>` and `<mono-accordion>` elements; each framework
package's function (React's `useCollapsible` and `useAccordion`, Vue's,
Svelte's `createCollapsible` and `createAccordion`) and components
(Ark UI's anatomy); the CDN bundle; stories, goldens and docs.

Out: motion beyond what the spec states (a TUI's disclosure opens at
once; a keyframe exit is the author's), a `hidden="until-found"`
content (Zag writes a boolean `hidden`), and the examples apps, which
show a menu and a dialog.

## What it builds on

- **The listbox's flow mount** (`listbox.ts`): `liveProps`, `start`,
  `mount` and `part` from `vanilla.ts`, the root's own `id` kept
  (`omit(root props, "id")`), no positioner and no `syncTopLayer`.
- **Markup read at the mount**: `items.ts`' `withMarkupItems` reads a
  list's `data-selected` items where the props name no value; the
  accordion reads its `data-state="open"` items the same way.
- **The elements** (`elements/element.ts` `defineElement`): attribute
  kinds, `properties`, `callbacks` and `open` reflection; the test
  holding each element's props to Zag's `props` (`elements.test.ts`).
- **The framework packages**: React's `hook()` (`hooks.ts`) and its
  components (`components/*.tsx`, `part.tsx`'s one-element parts);
  Vue's composables and components (`components/*.ts`); Svelte's
  functions (`index.svelte.ts`) and `.svelte` parts with a `child`
  snippet; each package's `coverage.test.ts`, which holds every
  component to its anatomy; `framework.ts`' `BOUND`, which already binds
  `open` and `value` both ways (`update:open`, `bind:value`).
- **The engine**: `hidden` content leaves the grid (`visibility.md`);
  an arrow key a widget handled is left to it under `focus="arrows"`
  (`focus-navigation.md`); buttons take the focus invert.

## Milestones

Each step's tests are seen failing first.

### 0. Probes — done 2026-09-29

On Zag's stock machines beside the engine (`ca/probe.mjs` in the
session's scratchpad), in Chromium, Firefox and WebKit:

1. **Zag's measure costs no layout**: a toggle lays the host out once
   with its `computeSize` and once with a no-op, the read's flips
   folded into the toggle's own layout. The spec's no-op machine is
   dropped; the machine is Zag's, the size variables still dropped
   from the API (the spec, corrected).
2. **A keyframe exit holds**: a 400ms exit on `data-state=closed` kept
   the content, and its text on the grid, 410–435ms, then hid it; a
   transition's content hid the next frame.
3. **The accordion keeps its keys** under `focus="arrows"`:
   `ArrowDown`, `ArrowUp`, `Home` and `End` walked the triggers.
4. **The bundle**: each machine is 5.5 KB (1.9 KB gzipped) past the
   Zag core the package already carries.

### 1. The core entries (`packages/ui`) — done

- `@zag-js/collapsible` and `@zag-js/accordion` as dependencies at the
  version the other machines take (1.44.0, the registry's latest
  2026-09-29); two subpaths in `package.json`'s `exports`.
- `collapsible.ts`: `props`, `machine` (Zag's), `propNames`,
  `connect`, `api` (the content's
  style without `--height` and `--width`), and `collapsible(root,
  props)` — `trigger`, `content`, `indicator` under the root.
- `accordion.ts`: `props`, `machine`, `propNames`, `connect`, `api`
  (Zag's as it is), and `accordion(root, props)` — per `item` its `data-value` and
  `data-disabled`, its `item-trigger`, `item-content` and
  `item-indicator`; `defaultValue` from the `data-state="open"` items
  where the props name none, the first alone unless `multiple`.
- `cdn.ts`: both mounts on `monowind.ui`.
- Tests (`collapsible.test.ts`, `accordion.test.ts`): the parts wired;
  the content's style free of size variables; the markup's open items at the mount, `multiple`'s all and a
  single's first; a disabled item's trigger disabled.

### 2. The elements — done

- `MonoCollapsible`: `dir`, `disabled`, `collapsed-height` and
  `collapsed-width` (numbers), `open` reflected; `onOpenChange` and
  `onExitComplete` as `openchange` and `exitcomplete`.
- `MonoAccordion`: `dir`, `disabled`, `multiple`, `collapsible`,
  `orientation`; `value` and `defaultValue` as properties;
  `onValueChange` and `onFocusChange` as `valuechange` and
  `focuschange`.
- Both registered by `defineMonoUi()`.
- Tests (`elements.test.ts`): attributes read and changed, `open`
  both ways, the events, and each element's props against Zag's.

### 3. The framework packages — done

- React: `useCollapsible` and `useAccordion`; `Collapsible` (`Root`,
  `RootProvider`, `Trigger`, `Content`, `Indicator`) and `Accordion`
  (`Root`, `RootProvider`, `Item`, `ItemTrigger`, `ItemContent`,
  `ItemIndicator`), each part one element with `asChild`; the `Item`'s
  context holding its `value` and `disabled`.
- Vue: the composables and the flat components (`CollapsibleRoot`, …,
  `AccordionItemIndicator`), `v-model:open` and `v-model:value` on the
  roots.
- Svelte: `createCollapsible` and `createAccordion`, the `.svelte`
  parts with `child` snippets, `bind:open` and `bind:value`.
- Tests: each package's coverage test and its render tests
  (`hooks.test.tsx`, `every.test.tsx`; `composables.test.ts`,
  `components.test.ts`; Svelte's harness components).

### 4. Stories and visual — done

- `ui.stories.ts`: `Collapsible` (visible, a golden — one closed, one
  open, an indicator drawn with generated content under
  `data-[state=open]:`) and `CollapsibleToggled` (test-only: the
  trigger, `open` set, the keyframe exit held to its end, the content
  out of the grid, no size variable on it); `Accordion` (visible, a
  golden — a single one with an open item) and `AccordionToggled`
  (test-only: the arrows, `Home` and `End` under `focus="arrows"`, a
  single one's close, `multiple`, `collapsible` off keeping its last,
  the markup's open items at the mount). A twin's tags per AGENTS.md.
- The goldens, scoped, then the whole visual run.

### 5. Docs and verification — done

- The spec's status and touch points in the present tense; README's
  "Components" and `packages/ui/README.md`.
- Unit tests per package; the story file in three engines; the
  stories on Linux (the Playwright image, as CI) before the commit;
  the visual goldens scoped, then whole; `pnpm check` (its log read);
  `pnpm test`. No engine change: no bench, the CDN bundle's size
  reported.

## Risks

- **A collapsible's size is the author's to animate.** With the
  variables dropped, a height animation has no measured target; the
  stories show the keyframe exit the spec names, not a height tween.
- **`value` against the markup.** An accordion's `value` property set
  before the element connects is the instance's own until the upgrade
  hands it over (the element layer's accessor idiom); a property then
  wins over the markup's `data-state`, as a list's does.
- **Svelte parts shipped as source** follow the existing components;
  a new rune idiom would need the Svelte example's smoke test run too.
