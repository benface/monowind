import { expect, expectTypeOf, it } from "vitest";
import type * as combobox from "@monowind/ui/combobox";
import type * as dialog from "@monowind/ui/dialog";
import type * as listbox from "@monowind/ui/listbox";
import type * as menu from "@monowind/ui/menu";
import type * as popover from "@monowind/ui/popover";
import type * as select from "@monowind/ui/select";
import type * as tooltip from "@monowind/ui/tooltip";
import { unrendered } from "../../ui/test/helpers.ts";
import { BOOLEANS } from "../src/components/part.ts";
import * as index from "../src/index.ts";

it("renders every component it exports", () => {
  const components = Object.keys(index).filter((name) => /^[A-Z]/.test(name));
  expect(components.length).toBeGreaterThan(50);
  // Handed to `h`, not merely named: an import list mentions every
  // component a test file imports, rendered or not.
  const rendered = (name: string) => new RegExp(`h\\(\\s*(?:ui\\.)?${name}\\b`);
  expect(unrendered(import.meta.dirname, components, rendered)).toBe("");
});

/** What a component takes, as a template's type-check reads it. */
type PropsOf<C> = C extends new (...args: any[]) => { $props: infer P } ? P : never;

/** The exported components. */
type Components = {
  [K in keyof typeof index]: K extends Uncapitalize<K> ? never : K;
}[keyof typeof index];

/** Those whose props take any name at all. */
type Untyped = {
  [K in Components]: string extends keyof PropsOf<(typeof index)[K]> ? K : never;
}[Components];

/** Those rendering no element: a root Zag gives no root part, and a
 * provider. */
type Elementless = "MenuRoot" | "DialogRoot" | "PopoverRoot" | "TooltipRoot" | `${string}Provider`;

/** Those rendering an element whose attributes their type turns away. */
type Attributeless = {
  [K in Components]: K extends Elementless
    ? never
    : "id" | "aria-label" | "onClick" extends keyof PropsOf<(typeof index)[K]>
      ? never
      : K;
}[Components];

it("types every component's props: its element's attributes, a part's asChild and its own, and no other name", () => {
  type ItemText = PropsOf<typeof index.ListboxItemText>;
  expectTypeOf<ItemText>().toHaveProperty("asChild").toEqualTypeOf<boolean | undefined>();
  expectTypeOf<ItemText>().toHaveProperty("class");
  expectTypeOf<ItemText>().toHaveProperty("id");
  expectTypeOf<ItemText>().toHaveProperty("aria-label");
  expectTypeOf<ItemText>().toHaveProperty("onClick");
  expectTypeOf<ItemText>().not.toHaveProperty("bogus");
  expectTypeOf<PropsOf<typeof index.MenuItem>>().toHaveProperty("value").toEqualTypeOf<string>();
  expectTypeOf<PropsOf<typeof index.MenuTrigger>>()
    .toHaveProperty("value")
    .toEqualTypeOf<string | undefined>();
  expectTypeOf<PropsOf<typeof index.ListboxRoot>>().toHaveProperty("asChild");
  expectTypeOf<Untyped>().toEqualTypeOf<never>();
  expectTypeOf<Attributeless>().toEqualTypeOf<never>();
});

/** The props a bare attribute sets: those a boolean satisfies. */
type BooleanProps<P> = P extends unknown
  ? { [K in keyof P]-?: boolean extends NonNullable<P[K]> ? K : never }[keyof P]
  : never;

it("declares every machine's boolean props as booleans, which a bare attribute sets", () => {
  type Machines =
    | combobox.Props
    | dialog.Props
    | listbox.Props
    | menu.Props
    | popover.Props
    | select.Props
    | tooltip.Props;
  expectTypeOf<Exclude<BooleanProps<Machines>, keyof typeof BOOLEANS>>().toEqualTypeOf<never>();
});

it("exports its public names", () => {
  expect(Object.keys(index).sort()).toMatchInlineSnapshot(`
    [
      "ComboboxClearTrigger",
      "ComboboxContent",
      "ComboboxControl",
      "ComboboxInput",
      "ComboboxItem",
      "ComboboxItemGroup",
      "ComboboxItemGroupLabel",
      "ComboboxItemIndicator",
      "ComboboxItemText",
      "ComboboxLabel",
      "ComboboxList",
      "ComboboxPositioner",
      "ComboboxRoot",
      "ComboboxRootProvider",
      "ComboboxTrigger",
      "DialogCloseTrigger",
      "DialogContent",
      "DialogDescription",
      "DialogPositioner",
      "DialogRoot",
      "DialogRootProvider",
      "DialogTitle",
      "DialogTrigger",
      "ListboxContent",
      "ListboxItem",
      "ListboxItemGroup",
      "ListboxItemGroupLabel",
      "ListboxItemIndicator",
      "ListboxItemText",
      "ListboxLabel",
      "ListboxRoot",
      "ListboxRootProvider",
      "MenuContent",
      "MenuItem",
      "MenuItemGroup",
      "MenuItemGroupLabel",
      "MenuPositioner",
      "MenuRoot",
      "MenuRootProvider",
      "MenuSeparator",
      "MenuTrigger",
      "MenuTriggerItem",
      "PopoverCloseTrigger",
      "PopoverContent",
      "PopoverDescription",
      "PopoverIndicator",
      "PopoverPositioner",
      "PopoverRoot",
      "PopoverRootProvider",
      "PopoverTitle",
      "PopoverTrigger",
      "SelectClearTrigger",
      "SelectContent",
      "SelectControl",
      "SelectHiddenSelect",
      "SelectIndicator",
      "SelectItem",
      "SelectItemGroup",
      "SelectItemGroupLabel",
      "SelectItemIndicator",
      "SelectItemText",
      "SelectLabel",
      "SelectList",
      "SelectPositioner",
      "SelectRoot",
      "SelectRootProvider",
      "SelectTrigger",
      "SelectValueText",
      "TooltipContent",
      "TooltipPositioner",
      "TooltipRoot",
      "TooltipRootProvider",
      "TooltipTrigger",
      "collection",
      "gridCollection",
      "useCombobox",
      "useComboboxContext",
      "useComboboxItemContext",
      "useDialog",
      "useDialogContext",
      "useListbox",
      "useListboxContext",
      "useListboxItemContext",
      "useMenu",
      "useMenuContext",
      "usePopover",
      "usePopoverContext",
      "useSelect",
      "useSelectContext",
      "useSelectItemContext",
      "useTooltip",
      "useTooltipContext",
    ]
  `);
});
