# Components implementation plan (0.3.0)

Status: **proposed** (2026-09-13). Specs: `top-layer.md`,
`anchor-positioning.md`, `ui.md` — normative; this plan sequences
them. The release is 0.3.0, a minor bump by decision, every package
in lockstep.

## What the probe found (2026-09-13, every engine)

A popover, a modal dialog, anchor positioning, and discrete
transitions inside a host, in the three engines:

- `toggle` and `beforetoggle` reach the host in the capture phase for
  popovers and dialogs alike. A popover's opening changes no attribute,
  so today the grid never shows it; a dialog's `open` attribute does
  schedule a layout, and the dialog paints at the host's top-left in
  DOM order, over the button before it and under the text after it.
- `@starting-style` enters run everywhere (the opacity was mid-flight
  100 ms in). A `display`/`overlay` exit transition runs in Chromium
  alone outside a host; inside one, the measuring passes' transition
  mask cancels it within a frame.
- The Typed OM reads `top: anchor(bottom)` as `auto`; `position-area`,
  `position-anchor`, and `anchor-name` read as computed strings in
  every engine; Firefox positions nothing by them. The browsers'
  anchored placement lands off the grid (one cell off in Chromium and
  WebKit), so the engine resolves anchors itself.
- `getComputedStyle(el, "::backdrop")` gives the backdrop's background
  in every engine.
- Zag 1.44: `@zag-js/vanilla` exports `VanillaMachine`, `spreadProps`,
  `normalizeProps`; `PositioningOptions.applyStyles: false` leaves the
  positioner's styles to the consumer; the presence machine waits for
  `animationend` of the part's `animation-name`.

## Phases (each ends green: `pnpm check` + the visual sweep)

### 1. Top layer — implemented 2026-09-13

Spec `top-layer.md`, plan `2026-09-13-top-layer.md`.

### 2. Anchor positioning — implemented 2026-09-13

Spec `anchor-positioning.md`, plan `2026-09-13-anchor-positioning.md`.

### 3. `@monowind/ui`

Spec `ui.md`; its plan follows phase 2. `packages/ui` takes the build
and publish setup of the other packages (a new package needs a manual
first publish); `menu`, `dialog`, `popover`, `tooltip` first, the
React smoke test before the components grow.

### 4. Docs and release

- README components paragraph; the playground sample with a menu and
  a dialog; `cell-model.md` pointers to the two engine specs;
  `core-architecture.md` on the top layer.
- Versions to 0.3.0 in the final substantive commit; release notes
  covering v0.2.14..HEAD.
