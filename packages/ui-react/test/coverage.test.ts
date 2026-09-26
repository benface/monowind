import { expect, expectTypeOf, it } from "vitest";
import { unrendered } from "../../ui/test/helpers.ts";
import * as index from "../src/index.ts";

it("renders every component it exports", () => {
  const components = Object.entries(index).flatMap(([namespace, parts]) =>
    /^[A-Z]/.test(namespace) && typeof parts === "object" && parts !== null
      ? Object.keys(parts)
          .filter((part) => !part.startsWith("use"))
          .map((part) => `${namespace}.${part}`)
      : [],
  );
  expect(components.length).toBeGreaterThan(50);
  // Written as an element, not merely named.
  const rendered = (name: string) => new RegExp(`<${name.replace(".", "\\.")}[\\s/>]`);
  expect(unrendered(import.meta.dirname, components, rendered)).toBe("");
});

/** A namespace's parts: its members but the hooks. */
type Parts<N> = { [K in keyof N as K extends `use${string}` ? never : K]: N[K] };
type Named = Record<string, { displayName: string }>;

it("names every part for React's devtools, in its type as well", () => {
  expectTypeOf<Parts<typeof index.Combobox>>().toExtend<Named>();
  expectTypeOf<Parts<typeof index.Dialog>>().toExtend<Named>();
  expectTypeOf<Parts<typeof index.Listbox>>().toExtend<Named>();
  expectTypeOf<Parts<typeof index.Menu>>().toExtend<Named>();
  expectTypeOf<Parts<typeof index.Popover>>().toExtend<Named>();
  expectTypeOf<Parts<typeof index.Select>>().toExtend<Named>();
  expectTypeOf<Parts<typeof index.Tooltip>>().toExtend<Named>();
  const misnamed = Object.entries(index).flatMap(([namespace, parts]) =>
    /^[A-Z]/.test(namespace)
      ? Object.entries(parts as Record<string, { displayName?: string }>)
          .filter(
            ([name, part]) =>
              !name.startsWith("use") && part.displayName !== `${namespace}.${name}`,
          )
          .map(([name]) => `${namespace}.${name}`)
      : [],
  );
  expect(misnamed).toEqual([]);
});

it("exports its public names, each namespace's parts among them", () => {
  const names = Object.entries(index).flatMap(([name, value]) =>
    /^[A-Z]/.test(name) ? Object.keys(value).map((part) => `${name}.${part}`) : [name],
  );
  expect(names.sort()).toMatchInlineSnapshot(`
    [
      "Combobox.ClearTrigger",
      "Combobox.Content",
      "Combobox.Control",
      "Combobox.Input",
      "Combobox.Item",
      "Combobox.ItemGroup",
      "Combobox.ItemGroupLabel",
      "Combobox.ItemIndicator",
      "Combobox.ItemText",
      "Combobox.Label",
      "Combobox.List",
      "Combobox.Positioner",
      "Combobox.Root",
      "Combobox.RootProvider",
      "Combobox.Trigger",
      "Combobox.useComboboxContext",
      "Combobox.useComboboxItemContext",
      "Dialog.CloseTrigger",
      "Dialog.Content",
      "Dialog.Description",
      "Dialog.Positioner",
      "Dialog.Root",
      "Dialog.RootProvider",
      "Dialog.Title",
      "Dialog.Trigger",
      "Dialog.useDialogContext",
      "Listbox.Content",
      "Listbox.Item",
      "Listbox.ItemGroup",
      "Listbox.ItemGroupLabel",
      "Listbox.ItemIndicator",
      "Listbox.ItemText",
      "Listbox.Label",
      "Listbox.Root",
      "Listbox.RootProvider",
      "Listbox.useListboxContext",
      "Listbox.useListboxItemContext",
      "Menu.Content",
      "Menu.Item",
      "Menu.ItemGroup",
      "Menu.ItemGroupLabel",
      "Menu.Positioner",
      "Menu.Root",
      "Menu.RootProvider",
      "Menu.Separator",
      "Menu.Trigger",
      "Menu.TriggerItem",
      "Menu.useMenuContext",
      "Popover.CloseTrigger",
      "Popover.Content",
      "Popover.Description",
      "Popover.Indicator",
      "Popover.Positioner",
      "Popover.Root",
      "Popover.RootProvider",
      "Popover.Title",
      "Popover.Trigger",
      "Popover.usePopoverContext",
      "Select.ClearTrigger",
      "Select.Content",
      "Select.Control",
      "Select.HiddenSelect",
      "Select.Indicator",
      "Select.Item",
      "Select.ItemGroup",
      "Select.ItemGroupLabel",
      "Select.ItemIndicator",
      "Select.ItemText",
      "Select.Label",
      "Select.List",
      "Select.Positioner",
      "Select.Root",
      "Select.RootProvider",
      "Select.Trigger",
      "Select.ValueText",
      "Select.useSelectContext",
      "Select.useSelectItemContext",
      "Tooltip.Content",
      "Tooltip.Positioner",
      "Tooltip.Root",
      "Tooltip.RootProvider",
      "Tooltip.Trigger",
      "Tooltip.useTooltipContext",
      "collection",
      "gridCollection",
      "useCombobox",
      "useDialog",
      "useListbox",
      "useMenu",
      "usePopover",
      "useSelect",
      "useTooltip",
    ]
  `);
});
