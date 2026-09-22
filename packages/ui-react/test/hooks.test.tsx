import { act, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { collection } from "@monowind/ui/listbox";
import { renderToStaticMarkup } from "react-dom/server";
import { Listbox, Menu, Select, useDialog, useListbox, useMenu, useSelect } from "../src/index.ts";

/** The hooks (specs/ui.md): the grid's props in the DOM React renders,
 * the positioner's ref in an anchored component's props, and a
 * component with none rendering its parts in the flow. */

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

function Branches() {
  const listbox = useListbox({ id: "branch", collection: collection({ items: ["main", "next"] }) });
  return (
    <div {...listbox.getRootProps()}>
      <span {...listbox.getLabelProps()}>Branch</span>
      <div {...listbox.getContentProps()}>
        {listbox.collection.items.map((item: string) => (
          <div key={item} {...listbox.getItemProps({ item })}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

it("renders a component with no floating part in the flow", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Branches />);
  });
  const content = container.querySelector<HTMLElement>("[role='listbox']");
  expect(content).not.toBeNull();
  expect(content!.getAttribute("aria-labelledby")).toBe("listbox:branch:label");
  expect(container.querySelectorAll("[role='option']")).toHaveLength(2);
  expect(container.querySelector("[popover]"), "nothing in the top layer").toBeNull();
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

/** The compound components (specs/ui.md "Component layer"): the parts
 * over the same hooks, `asChild` merging onto the author's element,
 * and a nested `Menu.Root` the submenu of the menu around it. */

/** A tree rendered into the document, and a way to take it down. */
async function mount(element: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    by: (part: string, value?: string) =>
      container.querySelector<HTMLElement>(
        value ? `[data-part="${part}"][data-value="${value}"]` : `[data-part="${part}"]`,
      )!,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

it("renders a menu's parts, a nested root its submenu anchored to its trigger item", async () => {
  const tree = await mount(
    <Menu.Root id="file">
      <Menu.Trigger>File</Menu.Trigger>
      <Menu.Positioner>
        <Menu.Content>
          <Menu.ItemGroup id="edit">
            <Menu.ItemGroupLabel htmlFor="edit">Edit</Menu.ItemGroupLabel>
            <Menu.Item value="cut">Cut</Menu.Item>
            <Menu.Item value="copy" disabled>
              Copy
            </Menu.Item>
          </Menu.ItemGroup>
          <Menu.Separator />
          <Menu.Root id="share">
            <Menu.TriggerItem>Share</Menu.TriggerItem>
            <Menu.Positioner>
              <Menu.Content>
                <Menu.Item value="mail">Mail</Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>,
  );
  expect(tree.by("trigger").getAttribute("aria-haspopup")).toBe("menu");
  expect(tree.by("trigger").style.getPropertyValue("anchor-name")).toBe("--mw-ui-file");
  expect(tree.by("content").getAttribute("role")).toBe("menu");
  expect(tree.by("item", "cut").getAttribute("role")).toBe("menuitem");
  expect(tree.by("item", "copy").getAttribute("aria-disabled")).toBe("true");
  expect(tree.by("item-group").getAttribute("role")).toBe("group");
  expect(tree.by("separator").getAttribute("role")).toBe("separator");
  // The submenu's trigger item is the parent's, and its positioner
  // points at it.
  const triggerItem = tree.by("trigger-item");
  expect(triggerItem.getAttribute("aria-haspopup")).toBe("menu");
  expect(triggerItem.style.getPropertyValue("anchor-name")).toBe("--mw-ui-share");
  const positioners = tree.container.querySelectorAll<HTMLElement>("[data-part='positioner']");
  expect(positioners[1]!.style.getPropertyValue("position-anchor")).toBe("--mw-ui-share");
  expect(positioners[1]!.style.getPropertyValue("position-area")).toBe("right span-bottom");
  await tree.unmount();
});

it("merges a part's props onto the one child with asChild, and keeps both refs", async () => {
  const order: string[] = [];
  let api: ReturnType<typeof useMenu> | undefined;
  let authorRef: HTMLElement | null = null;
  function App() {
    api = useMenu({ id: "as-child" });
    return (
      <Menu.RootProvider value={api}>
        <Menu.Trigger asChild className="from-part" onClick={() => order.push("part")}>
          <button className="from-child" onClick={() => order.push("child")}>
            File
          </button>
        </Menu.Trigger>
        <Menu.Positioner asChild>
          <div
            ref={(node: HTMLElement | null) => {
              authorRef = node;
            }}
          >
            <Menu.Content>
              <Menu.Item value="cut">Cut</Menu.Item>
            </Menu.Content>
          </div>
        </Menu.Positioner>
      </Menu.RootProvider>
    );
  }
  const tree = await mount(<App />);
  const trigger = tree.by("trigger");
  // The part's class first, the author's after (Zag's own merge), and
  // one element, not a wrapper.
  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger.className).toBe("from-part from-child");
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  await act(async () => {
    trigger.click();
  });
  // Both handlers ran, the author's own first, and Zag's behind them.
  expect(order).toEqual(["child", "part"]);
  expect(api!.open).toBe(true);
  // A ref on the child and the positioner's own both reach the node.
  expect(authorRef).toBe(tree.by("positioner"));
  expect(api!.getPositionerProps().ref.current).toBe(tree.by("positioner"));
  await tree.unmount();
});

it("tells a part it is outside its root", () => {
  expect(() => renderToStaticMarkup(<Menu.Item value="lost">Cut</Menu.Item>)).toThrow(
    /inside <Menu.Root>/,
  );
});

it("renders a listbox's parts on its own root element, attributes and all", async () => {
  const items = collection({ items: ["main", "next"] });
  const tree = await mount(
    <Listbox.Root collection={items} className="border" data-test="listbox">
      <Listbox.Label>Branch</Listbox.Label>
      <Listbox.Content>
        {items.items.map((value) => (
          <Listbox.Item key={value} value={value}>
            <Listbox.ItemIndicator>*</Listbox.ItemIndicator>
            <Listbox.ItemText>{value}</Listbox.ItemText>
          </Listbox.Item>
        ))}
      </Listbox.Content>
    </Listbox.Root>,
  );
  // The root is a real element — Zag gives a listbox a root part — so
  // it takes the author's own attributes.
  const root = tree.container.querySelector<HTMLElement>("[data-test='listbox']")!;
  expect(root.className).toBe("border");
  expect(tree.by("content").getAttribute("role")).toBe("listbox");
  const options = tree.container.querySelectorAll("[role='option']");
  expect(options).toHaveLength(2);
  // The text and the indicator find their item through the item they
  // are inside, not through a value of their own.
  expect(options[0]!.querySelector("[data-part='item-text']")?.textContent).toBe("main");
  expect(options[0]!.querySelector("[data-part='item-indicator']")).not.toBeNull();
  expect(tree.container.querySelector("[popover]"), "nothing in the top layer").toBeNull();
  await tree.unmount();
});

it("renders a select's parts, the hidden control out of the grid", async () => {
  const items = collection({ items: ["main", "next"] });
  const tree = await mount(
    <Select.Root collection={items} name="branch">
      <Select.Label>Branch</Select.Label>
      <Select.Control>
        <Select.Trigger>
          <Select.ValueText />
          <Select.Indicator>▾</Select.Indicator>
        </Select.Trigger>
      </Select.Control>
      <Select.Positioner>
        <Select.Content>
          {items.items.map((value) => (
            <Select.Item key={value} value={value}>
              <Select.ItemText>{value}</Select.ItemText>
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
      <Select.HiddenSelect />
    </Select.Root>,
  );
  expect(tree.by("trigger").getAttribute("aria-haspopup")).toBe("listbox");
  expect(tree.by("positioner").getAttribute("popover")).toBe("manual");
  const hidden = tree.container.querySelector<HTMLSelectElement>("select")!;
  expect(hidden.name).toBe("branch");
  // Hidden by display, not by Zag's visually-hidden box, which would
  // take cells on the grid.
  expect(hidden.style.display).toBe("none");
  expect(hidden.querySelectorAll("option")).toHaveLength(2);
  await tree.unmount();
});

it("selects through a listbox's parts, the choice reaching the page", async () => {
  const items = collection({ items: ["main", "next"] });
  const chosen: string[][] = [];
  const tree = await mount(
    <Listbox.Root collection={items} onValueChange={({ value }) => chosen.push(value)}>
      <Listbox.Content>
        {items.items.map((value) => (
          <Listbox.Item key={value} value={value}>
            <Listbox.ItemIndicator>*</Listbox.ItemIndicator>
            <Listbox.ItemText>{value}</Listbox.ItemText>
          </Listbox.Item>
        ))}
      </Listbox.Content>
    </Listbox.Root>,
  );
  await act(async () => {
    tree.by("item", "next").click();
  });
  expect(chosen).toEqual([["next"]]);
  // The state Tailwind styles, and the indicator that shows it.
  expect(tree.by("item", "next").getAttribute("data-state")).toBe("checked");
  expect(tree.by("item", "main").getAttribute("data-state")).toBe("unchecked");
  const indicator = tree.by("item", "next").querySelector("[data-part='item-indicator']")!;
  expect(indicator.getAttribute("data-state")).toBe("checked");
  await tree.unmount();
});

it("opens a select from its trigger and writes the choice into it", async () => {
  const items = collection({ items: ["main", "next"] });
  let api: ReturnType<typeof useSelect> | undefined;
  function App() {
    api = useSelect({ id: "branch", collection: items });
    return (
      <Select.RootProvider value={api}>
        <Select.Control>
          <Select.Trigger>
            <Select.ValueText>branch…</Select.ValueText>
          </Select.Trigger>
        </Select.Control>
        <Select.Positioner>
          <Select.Content>
            {items.items.map((value) => (
              <Select.Item key={value} value={value}>
                <Select.ItemText>{value}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
        <Select.HiddenSelect />
      </Select.RootProvider>
    );
  }
  const tree = await mount(<App />);
  // The placeholder until something is chosen, as the mount writes it.
  expect(tree.by("value-text").textContent).toBe("branch…");
  await act(async () => {
    api!.setOpen(true);
  });
  expect(tree.by("content").getAttribute("data-state")).toBe("open");
  await act(async () => {
    tree.by("item", "next").click();
  });
  expect(api!.value).toEqual(["next"]);
  expect(tree.by("value-text").textContent).toBe("next");
  expect(tree.container.querySelector<HTMLSelectElement>("select")!.value).toBe("next");
  await tree.unmount();
});

it("says so when a root is given a prop that goes nowhere", async () => {
  const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  // A menu's root renders no element — Zag gives it no root part — so
  // a class on it would vanish, where one on <mono-menu> is required.
  // The type says so; the warning is for the JavaScript that does not
  // read types, and for a spread that hides one.
  const tree = await mount(
    // @ts-expect-error a root that renders no element takes no class
    <Menu.Root className="border">
      <Menu.Trigger>File</Menu.Trigger>
      <Menu.Positioner>
        <Menu.Content />
      </Menu.Positioner>
    </Menu.Root>,
  );
  expect(warned).toHaveBeenCalledTimes(1);
  expect(warned.mock.calls[0]![0]).toContain("`className`");
  expect(warned.mock.calls[0]![0]).toContain("renders no element");
  // A listbox's root is an element, so its own attributes are welcome.
  warned.mockClear();
  const listbox = await mount(
    <Listbox.Root collection={collection({ items: ["main"] })} className="border">
      <Listbox.Content />
    </Listbox.Root>,
  );
  expect(warned).not.toHaveBeenCalled();
  await tree.unmount();
  await listbox.unmount();
  warned.mockRestore();
});

it("nests a submenu under an API the caller holds, and refuses a bad asChild", async () => {
  // A RootProvider knows the API, not the props behind it, so a
  // submenu under one takes the side it opens on and nothing else —
  // an id built from the provider's would name the wrong machine.
  let api: ReturnType<typeof useMenu> | undefined;
  function App() {
    api = useMenu({ id: "held", closeOnSelect: false });
    return (
      <Menu.RootProvider value={api}>
        <Menu.Positioner>
          <Menu.Content>
            <Menu.Root id="share">
              <Menu.TriggerItem>Share</Menu.TriggerItem>
              <Menu.Positioner>
                <Menu.Content>
                  <Menu.Item value="mail">Mail</Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Menu.Root>
          </Menu.Content>
        </Menu.Positioner>
      </Menu.RootProvider>
    );
  }
  const tree = await mount(<App />);
  const positioners = tree.container.querySelectorAll<HTMLElement>("[data-part='positioner']");
  expect(positioners[1]!.style.getPropertyValue("position-anchor")).toBe("--mw-ui-share");
  expect(positioners[1]!.style.getPropertyValue("position-area")).toBe("right span-bottom");
  await tree.unmount();

  // `asChild` takes one element, and says so rather than rendering
  // nothing at all.
  expect(() =>
    renderToStaticMarkup(
      <Menu.RootProvider value={api!}>
        <Menu.Trigger asChild>File</Menu.Trigger>
      </Menu.RootProvider>,
    ),
  ).toThrow(/takes exactly one element/);
});

it("gives a select's label the element the association needs", async () => {
  const items = collection({ items: ["main"] });
  const tree = await mount(
    <Select.Root collection={items} name="branch">
      <Select.Label>Branch</Select.Label>
      <Select.HiddenSelect />
    </Select.Root>,
  );
  // Zag normalizes it as a <label> with `htmlFor` for the hidden
  // control; on a span that association would be lost.
  const label = tree.by("label");
  expect(label.tagName).toBe("LABEL");
  expect((label as HTMLLabelElement).htmlFor).toBe(
    tree.container.querySelector<HTMLSelectElement>("select")!.id,
  );
  await tree.unmount();
});
