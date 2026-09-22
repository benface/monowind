import { act } from "react";
import { expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { collection } from "@monowind/ui/listbox";
import {
  Combobox,
  Dialog,
  Listbox,
  Menu,
  Popover,
  Select,
  Tooltip,
  useCombobox,
  useDialog,
  useListbox,
  useMenu,
  usePopover,
  useSelect,
  useTooltip,
} from "../src/index.ts";

/** Every part the package ships, rendered once, which
 * `coverage.test.ts` holds this to. The assertions are light — each
 * component's own behavior is `hooks.test.tsx`'s — so what this
 * catches is a part that throws or renders nothing at all. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items = collection({ items: ["main", "next"] });

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function All() {
  return (
    <div>
      <Menu.Root id="m">
        <Menu.Trigger>File</Menu.Trigger>
        <Menu.Positioner>
          <Menu.Content>
            <Menu.ItemGroup id="g">
              <Menu.ItemGroupLabel htmlFor="g">Group</Menu.ItemGroupLabel>
              <Menu.Item value="cut">Cut</Menu.Item>
            </Menu.ItemGroup>
            <Menu.Separator />
          </Menu.Content>
        </Menu.Positioner>
      </Menu.Root>

      <Dialog.Root id="d">
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Title>Title</Dialog.Title>
            <Dialog.Description>Description</Dialog.Description>
            <Dialog.CloseTrigger>×</Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      <Popover.Root id="p">
        <Popover.Trigger>Note</Popover.Trigger>
        <Popover.Positioner>
          <Popover.Content>
            <Popover.Indicator>▾</Popover.Indicator>
            <Popover.Title>Title</Popover.Title>
            <Popover.Description>Description</Popover.Description>
            <Popover.CloseTrigger>×</Popover.CloseTrigger>
          </Popover.Content>
        </Popover.Positioner>
      </Popover.Root>

      <Tooltip.Root id="t">
        <Tooltip.Trigger>Hover</Tooltip.Trigger>
        <Tooltip.Positioner>
          <Tooltip.Content>Tip</Tooltip.Content>
        </Tooltip.Positioner>
      </Tooltip.Root>

      <Listbox.Root id="l" collection={items}>
        <Listbox.Label>Branch</Listbox.Label>
        <Listbox.Content>
          <Listbox.ItemGroup id="lg">
            <Listbox.ItemGroupLabel htmlFor="lg">Group</Listbox.ItemGroupLabel>
            <Listbox.Item value="main">
              <Listbox.ItemText>main</Listbox.ItemText>
              <Listbox.ItemIndicator>*</Listbox.ItemIndicator>
            </Listbox.Item>
          </Listbox.ItemGroup>
        </Listbox.Content>
      </Listbox.Root>

      <Select.Root id="s" collection={items}>
        <Select.Label>Branch</Select.Label>
        <Select.Control>
          <Select.Trigger>
            <Select.ValueText>branch…</Select.ValueText>
            <Select.Indicator>▾</Select.Indicator>
          </Select.Trigger>
          <Select.ClearTrigger>×</Select.ClearTrigger>
        </Select.Control>
        <Select.Positioner>
          <Select.Content>
            <Select.List>
              <Select.ItemGroup id="sg">
                <Select.ItemGroupLabel htmlFor="sg">Group</Select.ItemGroupLabel>
                <Select.Item value="main">
                  <Select.ItemText>main</Select.ItemText>
                  <Select.ItemIndicator>*</Select.ItemIndicator>
                </Select.Item>
              </Select.ItemGroup>
            </Select.List>
          </Select.Content>
        </Select.Positioner>
        <Select.HiddenSelect />
      </Select.Root>

      <Combobox.Root id="c" collection={items}>
        <Combobox.Label>Find</Combobox.Label>
        <Combobox.Control>
          <Combobox.Input />
          <Combobox.Trigger>▾</Combobox.Trigger>
          <Combobox.ClearTrigger>×</Combobox.ClearTrigger>
        </Combobox.Control>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.List>
              <Combobox.ItemGroup id="cg">
                <Combobox.ItemGroupLabel htmlFor="cg">Group</Combobox.ItemGroupLabel>
                <Combobox.Item value="main">
                  <Combobox.ItemText>main</Combobox.ItemText>
                  <Combobox.ItemIndicator>*</Combobox.ItemIndicator>
                </Combobox.Item>
              </Combobox.ItemGroup>
            </Combobox.List>
          </Combobox.Content>
        </Combobox.Positioner>
      </Combobox.Root>
    </div>
  );
}

/** A `RootProvider` takes an API the caller holds, so each is rendered
 * over a hook run outside the tree. */
function AllProvided() {
  return (
    <div>
      <Menu.RootProvider value={useMenu({ id: "pm" })}>
        <Menu.Positioner>
          <Menu.Content />
        </Menu.Positioner>
      </Menu.RootProvider>
      <Dialog.RootProvider value={useDialog({ id: "pd" })}>
        <Dialog.Positioner>
          <Dialog.Content />
        </Dialog.Positioner>
      </Dialog.RootProvider>
      <Popover.RootProvider value={usePopover({ id: "pp" })}>
        <Popover.Positioner>
          <Popover.Content />
        </Popover.Positioner>
      </Popover.RootProvider>
      <Tooltip.RootProvider value={useTooltip({ id: "pt" })}>
        <Tooltip.Positioner>
          <Tooltip.Content />
        </Tooltip.Positioner>
      </Tooltip.RootProvider>
      <Listbox.RootProvider value={useListbox({ id: "pl", collection: items })}>
        <Listbox.Content />
      </Listbox.RootProvider>
      <Select.RootProvider value={useSelect({ id: "ps", collection: items })}>
        <Select.Positioner>
          <Select.Content />
        </Select.Positioner>
      </Select.RootProvider>
      <Combobox.RootProvider value={useCombobox({ id: "pc", collection: items })}>
        <Combobox.Positioner>
          <Combobox.Content />
        </Combobox.Positioner>
      </Combobox.RootProvider>
    </div>
  );
}

it("renders every part of every component", async () => {
  const tree = await render(<All />);
  expect(tree.container.querySelectorAll("[data-part='content']")).toHaveLength(7);
  expect(tree.container.querySelectorAll("[data-part='item']")).toHaveLength(4);
  await tree.unmount();
});

it("renders every component over an API held outside the tree", async () => {
  const tree = await render(<AllProvided />);
  expect(tree.container.querySelectorAll("[data-part='content']")).toHaveLength(7);
  await tree.unmount();
});
