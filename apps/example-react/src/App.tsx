import { useDialog, useMenu } from "@monowind/ui-react";
import { useId, useState } from "react";

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

/** A menu from `@monowind/ui-react`: Zag's machine as a hook, the grid's
 * props in the parts, the positioner kept in the top layer. */
function FileMenu({ onSelect }: { onSelect: (value: string) => void }) {
  const menu = useMenu({
    id: useId(),
    positioning: { placement: "bottom-start" },
    onSelect: ({ value }) => onSelect(value),
  });
  return (
    <>
      <button {...menu.getTriggerProps()} className="border px-1">
        File
      </button>
      <div {...menu.getPositionerProps()}>
        <div {...menu.getContentProps()} className="border bg-clear">
          <div {...menu.getItemProps({ value: "new" })} className={ITEM}>
            New
          </div>
          <div {...menu.getItemProps({ value: "open" })} className={ITEM}>
            Open…
          </div>
          <div {...menu.getItemProps({ value: "save", disabled: true })} className={ITEM}>
            Save
          </div>
        </div>
      </div>
    </>
  );
}

/** A dialog the same way: its positioner the top-layer element, its
 * backdrop the engine's to draw. */
function DeleteDialog() {
  const dialog = useDialog({ id: useId() });
  return (
    <>
      <button {...dialog.getTriggerProps()} className="border px-1">
        Delete
      </button>
      <div {...dialog.getPositionerProps()} className="backdrop:bg-black/50">
        <div {...dialog.getContentProps()} className="border px-1">
          <p {...dialog.getTitleProps()} className="font-bold">
            Delete the file?
          </p>
          <p {...dialog.getDescriptionProps()}>This cannot be undone.</p>
          <p className="mt-1 flex gap-2">
            <button {...dialog.getCloseTriggerProps()} className="border px-1">
              Cancel
            </button>
            <button className="border px-1" onClick={() => dialog.setOpen(false)}>
              Delete
            </button>
          </p>
        </div>
      </div>
    </>
  );
}
