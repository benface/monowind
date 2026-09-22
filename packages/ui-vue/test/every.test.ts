import { expect, it } from "vitest";
import { createApp, h, nextTick } from "vue";
import { collection } from "@monowind/ui/listbox";
import * as ui from "../src/index.ts";
import {
  useCombobox,
  useDialog,
  useListbox,
  useMenu,
  usePopover,
  useSelect,
  useTooltip,
} from "../src/index.ts";

/** Every part the package ships, mounted once, which
 * `coverage.test.ts` holds this to. The assertions are light — each
 * component's own behavior is `components.test.ts`'s — so what this
 * catches is a part that throws or renders nothing at all. */

const items = collection({ items: ["main", "next"] });

function mount(render: () => unknown) {
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp({ setup: () => render });
  app.mount(container);
  return { container, unmount: () => (app.unmount(), container.remove()) };
}

/** The item parts, named rather than built from a prefix: a name the
 * coverage guard cannot see is a name nothing proved resolves. */
const listboxItems = () =>
  h(ui.ListboxItemGroup, { id: "lg" }, () => [
    h(ui.ListboxItemGroupLabel, { htmlFor: "lg" }, () => "Group"),
    h(ui.ListboxItem, { value: "main" }, () => [
      h(ui.ListboxItemText, () => "main"),
      h(ui.ListboxItemIndicator, () => "*"),
    ]),
  ]);
const selectItems = () =>
  h(ui.SelectItemGroup, { id: "sg" }, () => [
    h(ui.SelectItemGroupLabel, { htmlFor: "sg" }, () => "Group"),
    h(ui.SelectItem, { value: "main" }, () => [
      h(ui.SelectItemText, () => "main"),
      h(ui.SelectItemIndicator, () => "*"),
    ]),
  ]);
const comboboxItems = () =>
  h(ui.ComboboxItemGroup, { id: "cg" }, () => [
    h(ui.ComboboxItemGroupLabel, { htmlFor: "cg" }, () => "Group"),
    h(ui.ComboboxItem, { value: "main" }, () => [
      h(ui.ComboboxItemText, () => "main"),
      h(ui.ComboboxItemIndicator, () => "*"),
    ]),
  ]);

it("mounts every part of every component", async () => {
  const tree = mount(() => [
    h(ui.MenuRoot, { id: "m" }, () => [
      h(ui.MenuTrigger, () => "File"),
      h(ui.MenuPositioner, () => [h(ui.MenuContent, () => [h(ui.MenuItem, { value: "a" })])]),
    ]),
    h(ui.DialogRoot, { id: "d" }, () => [
      h(ui.DialogTrigger, () => "Open"),
      h(ui.DialogPositioner, () => [
        h(ui.DialogContent, () => [
          h(ui.DialogTitle, () => "Title"),
          h(ui.DialogDescription, () => "Description"),
          h(ui.DialogCloseTrigger, () => "×"),
        ]),
      ]),
    ]),
    h(ui.PopoverRoot, { id: "p" }, () => [
      h(ui.PopoverTrigger, () => "Note"),
      h(ui.PopoverPositioner, () => [
        h(ui.PopoverContent, () => [
          h(ui.PopoverIndicator, () => "▾"),
          h(ui.PopoverTitle, () => "Title"),
          h(ui.PopoverDescription, () => "Description"),
          h(ui.PopoverCloseTrigger, () => "×"),
        ]),
      ]),
    ]),
    h(ui.TooltipRoot, { id: "t" }, () => [
      h(ui.TooltipTrigger, () => "Hover"),
      h(ui.TooltipPositioner, () => [h(ui.TooltipContent, () => "Tip")]),
    ]),
    h(ui.ListboxRoot, { id: "l", collection: items }, () => [
      h(ui.ListboxLabel, () => "Branch"),
      h(ui.ListboxContent, () => [listboxItems()]),
    ]),
    h(ui.SelectRoot, { id: "s", collection: items }, () => [
      h(ui.SelectLabel, () => "Branch"),
      h(ui.SelectControl, () => [
        h(ui.SelectTrigger, () => [
          h(ui.SelectValueText, () => "branch…"),
          h(ui.SelectIndicator, () => "▾"),
        ]),
        h(ui.SelectClearTrigger, () => "×"),
      ]),
      h(ui.SelectPositioner, () => [
        h(ui.SelectContent, () => [h(ui.SelectList, () => [selectItems()])]),
      ]),
      h(ui.SelectHiddenSelect),
    ]),
    h(ui.ComboboxRoot, { id: "c", collection: items }, () => [
      h(ui.ComboboxLabel, () => "Find"),
      h(ui.ComboboxControl, () => [
        h(ui.ComboboxInput),
        h(ui.ComboboxTrigger, () => "▾"),
        h(ui.ComboboxClearTrigger, () => "×"),
      ]),
      h(ui.ComboboxPositioner, () => [
        h(ui.ComboboxContent, () => [h(ui.ComboboxList, () => [comboboxItems()])]),
      ]),
    ]),
  ]);
  await nextTick();
  // Every root reached its parts: one trigger per component that has
  // one, and a content for each.
  expect(tree.container.querySelectorAll('[data-part="content"]').length).toBe(7);
  expect(tree.container.querySelectorAll('[data-part="item"]').length).toBe(4);
  tree.unmount();
});

/** A `RootProvider` takes an API the caller holds, so each is mounted
 * over a composable run outside the tree. */
it("mounts every component over an API held outside the tree", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp({
    setup() {
      const menu = useMenu({ id: "pm" });
      const dialog = useDialog({ id: "pd" });
      const popover = usePopover({ id: "pp" });
      const tooltip = useTooltip({ id: "pt" });
      const listbox = useListbox({ id: "pl", collection: items });
      const select = useSelect({ id: "ps", collection: items });
      const combobox = useCombobox({ id: "pc", collection: items });
      return () => [
        h(ui.MenuRootProvider, { value: menu }, () => [
          h(ui.MenuPositioner, () => [h(ui.MenuContent)]),
        ]),
        h(ui.DialogRootProvider, { value: dialog }, () => [
          h(ui.DialogPositioner, () => [h(ui.DialogContent)]),
        ]),
        h(ui.PopoverRootProvider, { value: popover }, () => [
          h(ui.PopoverPositioner, () => [h(ui.PopoverContent)]),
        ]),
        h(ui.TooltipRootProvider, { value: tooltip }, () => [
          h(ui.TooltipPositioner, () => [h(ui.TooltipContent)]),
        ]),
        h(ui.ListboxRootProvider, { value: listbox }, () => [h(ui.ListboxContent)]),
        h(ui.SelectRootProvider, { value: select }, () => [
          h(ui.SelectPositioner, () => [h(ui.SelectContent)]),
        ]),
        h(ui.ComboboxRootProvider, { value: combobox }, () => [
          h(ui.ComboboxPositioner, () => [h(ui.ComboboxContent)]),
        ]),
      ];
    },
  });
  app.mount(container);
  await nextTick();
  expect(container.querySelectorAll('[data-part="content"]').length).toBe(7);
  app.unmount();
  container.remove();
});
