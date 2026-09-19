import { act } from "react";
import { expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { useDialog, useMenu } from "../src/index.ts";

/** The hooks (specs/ui.md): the grid's props in the DOM React renders,
 * the positioner's ref in its props. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let menuRef: { current: HTMLDivElement | null } | undefined;

function App() {
  const menu = useMenu({ id: "file", positioning: { placement: "top-end" } });
  const dialog = useDialog({ id: "confirm" });
  menuRef = menu.getPositionerProps().ref;
  return (
    <div>
      <button {...menu.getTriggerProps()}>File</button>
      <div {...menu.getPositionerProps()}>
        <div {...menu.getContentProps()}>
          <div {...menu.getItemProps({ value: "new" })}>New</div>
        </div>
      </div>
      <button {...dialog.getTriggerProps()}>Delete</button>
      <div {...dialog.getPositionerProps()}>
        <div {...dialog.getContentProps()}>Delete?</div>
      </div>
    </div>
  );
}

it("renders the grid's props and hands the positioner its ref", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  const [menuTrigger, dialogTrigger] = Array.from(
    container.querySelectorAll<HTMLElement>("button"),
  );
  const [menuPositioner, dialogPositioner] = Array.from(
    container.querySelectorAll<HTMLElement>("[data-part='positioner']"),
  );
  expect(menuTrigger!.style.getPropertyValue("anchor-name")).toBe("--mw-ui-file");
  expect(menuPositioner!.getAttribute("popover")).toBe("manual");
  expect(menuPositioner!.style.getPropertyValue("position-area")).toBe("top span-left");
  expect(dialogTrigger!.getAttribute("aria-haspopup")).toBe("dialog");
  expect(dialogPositioner!.getAttribute("popover")).toBe("manual");
  expect(container.querySelector("[role='menu']")).not.toBeNull();
  expect(menuRef?.current).toBe(menuPositioner);
  await act(async () => {
    root.unmount();
  });
  container.remove();
});
