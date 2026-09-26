import { act, useState, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { createRoot, hydrateRoot } from "react-dom/client";
import { collection } from "@monowind/ui/listbox";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { by, posted, resetByClick as resetFormByClick } from "../../ui/test/helpers.ts";
import {
  Combobox,
  Dialog,
  Listbox,
  Menu,
  Select,
  useDialog,
  useListbox,
  useMenu,
  useSelect,
} from "../src/index.ts";

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
    by: (part: string, value?: string) => by(container, part, value),
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
  expect(() =>
    renderToStaticMarkup(
      <Menu.Root>
        <Menu.TriggerItem>Share</Menu.TriggerItem>
      </Menu.Root>,
    ),
  ).toThrow("a Menu.TriggerItem must be inside a nested <Menu.Root>");
});

it("tells an item part where it belongs, outside a list root or its item", () => {
  expect(() => renderToStaticMarkup(<Listbox.Item value="main">main</Listbox.Item>)).toThrow(
    "an item part must be inside <Listbox.Root>, <Select.Root> or <Combobox.Root>",
  );
  expect(() =>
    renderToStaticMarkup(
      <Listbox.Root collection={collection({ items: ["main"] })}>
        <Listbox.ItemText>main</Listbox.ItemText>
      </Listbox.Root>,
    ),
  ).toThrow("an item's text and indicator must be inside its Item");
});

it("reads the nearest list root in an item part, whichever of the three it is named for", () => {
  const markup = renderToStaticMarkup(
    <Listbox.Root id="mixed" collection={collection({ items: ["main"] })}>
      <Select.Item value="main">
        <Combobox.ItemText>main</Combobox.ItemText>
      </Select.Item>
    </Listbox.Root>,
  );
  const container = document.createElement("div");
  container.innerHTML = markup;
  expect(by(container, "item").getAttribute("data-scope")).toBe("listbox");
  expect(by(container, "item").getAttribute("role")).toBe("option");
  expect(by(container, "item-text").getAttribute("data-scope")).toBe("listbox");
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

/** A select with only its hidden control, the items and the name a
 * test changes through `change`. */
function Hidden(props: {
  initial: string[];
  multiple?: boolean;
  defaultValue: string[];
  change: (to: { items(next: string[]): void; name(next: string): void }) => void;
}) {
  const [items, setItems] = useState(() => collection({ items: props.initial }));
  const [name, setName] = useState("branches");
  props.change({ items: (next) => setItems(collection({ items: next })), name: setName });
  return (
    <form>
      <Select.Root
        id="hidden"
        collection={items}
        multiple={props.multiple}
        defaultValue={props.defaultValue}
        name={name}
      >
        <Select.HiddenSelect />
      </Select.Root>
    </form>
  );
}

/** A form's reset from a reader's click, React's render inside `act`. */
const resetByClick = (form: HTMLFormElement) => resetFormByClick(form, (work) => act(work));

/** A select over a hook the test drives, its hidden control in a form. */
function Reset(props: {
  id: string;
  defaultValue?: string[];
  ready: (api: ReturnType<typeof useSelect>) => void;
}) {
  const api = useSelect({
    id: props.id,
    collection: collection({ items: ["main", "next"] }),
    name: "branch",
    ...(props.defaultValue ? { defaultValue: props.defaultValue } : {}),
  });
  props.ready(api);
  return (
    <form>
      <Select.RootProvider value={api}>
        <Select.HiddenSelect />
      </Select.RootProvider>
    </form>
  );
}

it("goes back to its default at a reset the reader clicks, or to no option", async () => {
  let api!: ReturnType<typeof useSelect>;
  const tree = await mount(
    <Reset id="clicked" defaultValue={["next"]} ready={(held) => (api = held)} />,
  );
  const hidden = tree.container.querySelector("select")!;
  await resetByClick(hidden.form!);
  expect(posted(hidden)).toEqual(["next"]);
  await tree.unmount();
  const empty = await mount(<Reset id="clicked-empty" ready={(held) => (api = held)} />);
  const control = empty.container.querySelector("select")!;
  await act(async () => api.setValue(["main"]));
  await resetByClick(control.form!);
  expect(api.value).toEqual([]);
  expect(posted(control), "no option chosen in its place").toEqual([]);
  await empty.unmount();
});

it("posts no option for a value the collection lacks, and the value once it arrives", async () => {
  let change!: { items(next: string[]): void; name(next: string): void };
  const tree = await mount(
    <Hidden initial={["main"]} defaultValue={["release"]} change={(to) => (change = to)} />,
  );
  const hidden = tree.container.querySelector("select")!;
  expect(posted(hidden), "no option chosen in its place").toEqual([]);
  await act(async () => change.items(["main", "release"]));
  expect(posted(hidden)).toEqual(["release"]);
  await tree.unmount();
});

it("goes back to its default at a form's reset, the machine and the form alike", async () => {
  let api!: ReturnType<typeof useSelect>;
  const tree = await mount(
    <Reset id="reset" defaultValue={["next"]} ready={(held) => (api = held)} />,
  );
  const hidden = tree.container.querySelector("select")!;
  // A reset the machine sees as no change: the form's own reset alone
  // puts the default back.
  await act(async () => hidden.form!.reset());
  expect(posted(hidden)).toEqual(["next"]);
  await act(async () => api.setValue(["main"]));
  expect(posted(hidden)).toEqual(["main"]);
  await act(async () => hidden.form!.reset());
  expect(api.value).toEqual(["next"]);
  expect(posted(hidden)).toEqual(["next"]);
  await tree.unmount();
});

it("selects every option a multiple select's value holds, through a render that keeps it", async () => {
  let change!: { items(next: string[]): void; name(next: string): void };
  const tree = await mount(
    <Hidden
      initial={["main", "next", "old"]}
      multiple
      defaultValue={["main", "old"]}
      change={(to) => (change = to)}
    />,
  );
  const hidden = tree.container.querySelector("select")!;
  const selected = () => [...hidden.selectedOptions].map((option) => option.value);
  expect(selected()).toEqual(["main", "old"]);
  await act(async () => change.name("targets"));
  expect(hidden.name).toBe("targets");
  expect(selected()).toEqual(["main", "old"]);
  await tree.unmount();
});

it("selects the hidden option of a value that arrived before it", async () => {
  let change!: { items(next: string[]): void; name(next: string): void };
  const tree = await mount(
    <Hidden initial={["main"]} defaultValue={["release"]} change={(to) => (change = to)} />,
  );
  await act(async () => change.items(["main", "release"]));
  expect(tree.container.querySelector("select")!.value).toBe("release");
  await tree.unmount();
});

it("follows a change on the hidden select, as a form autofill makes it", async () => {
  let api!: ReturnType<typeof useSelect>;
  const tree = await mount(
    <Reset id="autofill" defaultValue={["main"]} ready={(held) => (api = held)} />,
  );
  const hidden = tree.container.querySelector("select")!;
  await act(async () => {
    hidden.value = "next";
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(api.value).toEqual(["next"]);
  expect(hidden.value, "not put back").toBe("next");
  await tree.unmount();
});

it("server-renders its hidden control's options, a form posting the default before hydration", async () => {
  const items = collection({ items: ["main", "next"] });
  const page = (defaultValue?: string[]) => (
    <form>
      <Select.Root
        id="served"
        collection={items}
        name="branch"
        {...(defaultValue ? { defaultValue } : {})}
      >
        <Select.HiddenSelect />
      </Select.Root>
    </form>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(page(["next"]));
  document.body.append(container);
  const hidden = container.querySelector("select")!;
  expect(posted(hidden), "before the script runs").toEqual(["next"]);
  expect(hidden.getAttribute("size"), "no first option picked in the default's absence").toBe("2");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, page(["next"]));
  });
  expect(errors, "a clean hydration").not.toHaveBeenCalled();
  errors.mockRestore();
  expect(container.querySelector("select")).toBe(hidden);
  expect(posted(hidden)).toEqual(["next"]);
  await act(async () => root.unmount());
  container.remove();
  expect(renderToString(page())).not.toContain("selected");
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
  // The selection marked as a listbox's items and the mount's are.
  expect(tree.by("item", "next").hasAttribute("data-selected")).toBe(true);
  expect(tree.by("item", "main").hasAttribute("data-selected")).toBe(false);
  await tree.unmount();
});

it("says so when a root is given a prop that goes nowhere", async () => {
  const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  // A menu's root renders no element — Zag gives it no root part — so
  // a class on it would vanish, where one on <mono-menu> is required.
  // The type says so; the warning is for the JavaScript that does not
  // read types, and for a spread that hides one.
  let rerender!: () => void;
  function Stray() {
    const [count, setCount] = useState(0);
    rerender = () => setCount(count + 1);
    return (
      // @ts-expect-error a root that renders no element takes no class
      <Menu.Root className="border">
        <Menu.Trigger>File {count}</Menu.Trigger>
        <Menu.Positioner>
          <Menu.Content />
        </Menu.Positioner>
      </Menu.Root>
    );
  }
  const tree = await mount(<Stray />);
  // Said once, however often React renders the root.
  await act(async () => rerender());
  await act(async () => rerender());
  expect(warned).toHaveBeenCalledTimes(1);
  expect(warned.mock.calls[0]![0]).toContain("`className`");
  expect(warned.mock.calls[0]![0]).toContain("renders no element");
  // Once per root: another given the same prop says so too.
  const another = await mount(
    // @ts-expect-error a root that renders no element takes no class
    <Dialog.Root className="border">
      <Dialog.Trigger>Open</Dialog.Trigger>
    </Dialog.Root>,
  );
  const again = await mount(
    // @ts-expect-error a root that renders no element takes no class
    <Dialog.Root className="border">
      <Dialog.Trigger>Open</Dialog.Trigger>
    </Dialog.Root>,
  );
  expect(warned).toHaveBeenCalledTimes(3);
  await another.unmount();
  await again.unmount();
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

it("tells a dialog opened from one of its triggers which, by its value", async () => {
  const opened: (string | null)[] = [];
  const tree = await mount(
    <Dialog.Root id="shared" onTriggerValueChange={({ value }) => opened.push(value)}>
      <Dialog.Trigger value="a">A</Dialog.Trigger>
      <Dialog.Trigger value="b">B</Dialog.Trigger>
      <Dialog.Positioner>
        <Dialog.Content>Shared</Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>,
  );
  await act(async () => tree.container.querySelectorAll("button")[1]!.click());
  expect(opened).toEqual(["b"]);
  await tree.unmount();
});

it("links a submenu to its menu once, not on every render", async () => {
  const setChild = vi.fn();
  let rerender!: () => void;
  function Tree() {
    const [count, setCount] = useState(0);
    rerender = () => setCount(count + 1);
    const api = useMenu({ id: "file" });
    const counted = {
      ...api,
      setChild: (child: Parameters<typeof api.setChild>[0]) => {
        setChild();
        api.setChild(child);
      },
    };
    return (
      <Menu.RootProvider value={counted}>
        <Menu.Trigger>File {count}</Menu.Trigger>
        <Menu.Positioner>
          <Menu.Content>
            <Menu.Root id="share">
              <Menu.TriggerItem>Share</Menu.TriggerItem>
            </Menu.Root>
          </Menu.Content>
        </Menu.Positioner>
      </Menu.RootProvider>
    );
  }
  const tree = await mount(<Tree />);
  await act(async () => rerender());
  await act(async () => rerender());
  await act(async () => rerender());
  expect(setChild).toHaveBeenCalledTimes(1);
  await tree.unmount();
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

it("renders a combobox, its list anchored under the control it types into", async () => {
  const items = collection({ items: ["main", "next"] });
  const tree = await mount(
    <Combobox.Root collection={items} placeholder="branch…">
      <Combobox.Label>Find</Combobox.Label>
      <Combobox.Control>
        <Combobox.Input />
        <Combobox.Trigger>▼</Combobox.Trigger>
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content>
          {items.items.map((value) => (
            <Combobox.Item key={value} value={value}>
              <Combobox.ItemText>{value}</Combobox.ItemText>
            </Combobox.Item>
          ))}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>,
  );
  const input = tree.by("input") as HTMLInputElement;
  expect(input.getAttribute("role")).toBe("combobox");
  expect(input.placeholder).toBe("branch…");
  // The list lines up under the control, not the button beside it.
  const anchor = tree.by("control").style.getPropertyValue("anchor-name");
  expect(anchor).toMatch(/^--mw-ui-/);
  expect(tree.by("positioner").style.getPropertyValue("position-anchor")).toBe(anchor);
  expect(tree.by("trigger").style.getPropertyValue("anchor-name")).toBe("");
  await tree.unmount();
});

it("keeps the reader's caret when a keystroke opens a combobox whose open state it controls", async () => {
  const items = collection({ items: ["main", "next"] });
  function Controlled() {
    const [open, setOpen] = useState(false);
    return (
      <Combobox.Root
        id="controlled"
        collection={items}
        open={open}
        onOpenChange={(details) => setOpen(details.open)}
      >
        <Combobox.Control>
          <Combobox.Input />
        </Combobox.Control>
        <Combobox.Positioner>
          <Combobox.Content />
        </Combobox.Positioner>
      </Combobox.Root>
    );
  }
  const tree = await mount(<Controlled />);
  const input = tree.by("input") as HTMLInputElement;
  await act(async () => input.focus());
  // A backspace in the middle of "main", the list closed until then;
  // through the prototype's setter, as typing writes it, since React
  // reads a value set on the element as no change.
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "man");
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(tree.by("content").getAttribute("data-state")).toBe("open");
  expect(input.selectionStart).toBe(2);
  await tree.unmount();
});
