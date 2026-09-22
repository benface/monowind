import { collection, Dialog, Menu, Select } from "@monowind/ui-react";
import { useState } from "react";

/**
 * React owns the light DOM (state, events, reconciliation); monowind reads
 * it and lays it out on the character grid. The counter proves the whole
 * loop: click → React re-renders the text → monowind observes the mutation
 * → relayout, without React ever noticing the engine.
 */
export function App() {
  const [count, setCount] = useState(0);
  const [picked, setPicked] = useState("nothing yet");

  return (
    <mono-wind>
      <div className="flex min-h-5 items-center justify-between border border-emerald-400 px-1">
        <div>
          count is <b className="text-yellow-400">{count}</b>
        </div>
        <button className="cursor-pointer" onClick={() => setCount((n) => n + 1)}>
          increment
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <FileMenu onSelect={setPicked} />
        <DeleteDialog />
        <BranchSelect />
        <span>
          picked <b className="text-yellow-400">{picked}</b>
        </span>
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <p key={i}>Line {i + 1} of the page, under the menu.</p>
      ))}
    </mono-wind>
  );
}

const ITEM =
  "px-1 data-highlighted:bg-(--mw-fg) data-highlighted:text-(--mw-bg) data-disabled:text-neutral-500";

const branches = collection({ items: ["main", "next", "release"] });

/** A select: a listbox on a trigger, its own root element in the flow
 * and its list in the top layer, with a native control for a form. */
function BranchSelect() {
  return (
    <Select.Root collection={branches} name="branch">
      <Select.Control>
        <Select.Trigger className="border px-1">
          <Select.ValueText>branch…</Select.ValueText>
          <Select.Indicator className="ml-1">▼</Select.Indicator>
        </Select.Trigger>
      </Select.Control>
      <Select.Positioner>
        <Select.Content className="border bg-clear">
          {branches.items.map((value: string) => (
            <Select.Item key={value} value={value} className={ITEM}>
              <Select.ItemText>{value}</Select.ItemText>
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
      <Select.HiddenSelect />
    </Select.Root>
  );
}

/** A menu from `@monowind/ui-react`: Zag's machine behind a compound
 * component, the grid's props in the parts, the positioner kept in the
 * top layer. A nested `Menu.Root` is the submenu of the menu around
 * it, opening beside the item that carries it. */
function FileMenu({ onSelect }: { onSelect: (value: string) => void }) {
  return (
    <Menu.Root
      positioning={{ placement: "bottom-start" }}
      onSelect={({ value }) => onSelect(value)}
    >
      <Menu.Trigger className="border px-1">File</Menu.Trigger>
      <Menu.Positioner>
        <Menu.Content className="border bg-clear">
          <Menu.Item value="new" className={ITEM}>
            New
          </Menu.Item>
          <Menu.Item value="open" className={ITEM}>
            Open…
          </Menu.Item>
          <Menu.Item value="save" disabled className={ITEM}>
            Save
          </Menu.Item>
          <Menu.Root>
            <Menu.TriggerItem className={ITEM}>Share ›</Menu.TriggerItem>
            <Menu.Positioner>
              <Menu.Content className="border bg-clear">
                <Menu.Item value="mail" className={ITEM}>
                  Mail
                </Menu.Item>
                <Menu.Item value="link" className={ITEM}>
                  Copy link
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}

/** A dialog the same way: its positioner the top-layer element, its
 * backdrop the engine's to draw. `asChild` puts a part's props on an
 * element of your own, here a second button that closes it. */
function DeleteDialog() {
  return (
    <Dialog.Root>
      <Dialog.Trigger className="border px-1">Delete</Dialog.Trigger>
      <Dialog.Positioner className="backdrop:bg-black/50">
        <Dialog.Content className="border px-1">
          <Dialog.Title className="font-bold">Delete the file?</Dialog.Title>
          <Dialog.Description>This cannot be undone.</Dialog.Description>
          <p className="mt-1 flex gap-2">
            <Dialog.CloseTrigger className="border px-1">Cancel</Dialog.CloseTrigger>
            <Dialog.CloseTrigger asChild>
              <button className="border px-1">Delete</button>
            </Dialog.CloseTrigger>
          </p>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
