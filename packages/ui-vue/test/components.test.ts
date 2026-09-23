import { expect, it, vi } from "vitest";
import { createApp, createSSRApp, h, nextTick, reactive, shallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import { collection } from "@monowind/ui/listbox";
import { posted, resetByClick } from "../../ui/test/helpers.ts";
import {
  ComboboxContent,
  ComboboxControl,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemText,
  ComboboxLabel,
  ComboboxPositioner,
  ComboboxRoot,
  ComboboxTrigger,
  DialogContent,
  DialogPositioner,
  DialogRoot,
  DialogTrigger,
  ListboxContent,
  ListboxItem,
  ListboxItemIndicator,
  ListboxItemText,
  ListboxLabel,
  ListboxRoot,
  MenuContent,
  MenuItem,
  MenuItemGroup,
  MenuItemGroupLabel,
  MenuPositioner,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  MenuTriggerItem,
  SelectContent,
  SelectControl,
  SelectHiddenSelect,
  SelectIndicator,
  SelectItem,
  SelectItemText,
  SelectPositioner,
  SelectRoot,
  SelectRootProvider,
  SelectTrigger,
  SelectValueText,
  useSelect,
} from "../src/index.ts";

/** The compound components (specs/ui.md "Component layer"): the parts
 * over the same composables, `as-child` merging onto the element the
 * slot gives, and a nested `MenuRoot` the submenu of the menu around
 * it. */

/** A tree mounted in the document, and a way to take it down. */
const mount = (render: () => unknown) => mountSetup(() => render);

/** The same, for a test that runs a composable of its own first. */
function mountSetup(setup: () => () => unknown) {
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp({ setup });
  app.mount(container);
  return {
    container,
    by: (part: string, value?: string) =>
      container.querySelector<HTMLElement>(
        value ? `[data-part="${part}"][data-value="${value}"]` : `[data-part="${part}"]`,
      )!,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

it("renders a menu's parts, a nested root its submenu anchored to its trigger item", async () => {
  const tree = mount(() =>
    h(MenuRoot, { id: "file" }, () => [
      h(MenuTrigger, () => "File"),
      h(MenuPositioner, () => [
        h(MenuContent, () => [
          h(MenuItemGroup, { id: "edit" }, () => [
            h(MenuItemGroupLabel, { htmlFor: "edit" }, () => "Edit"),
            h(MenuItem, { value: "cut" }, () => "Cut"),
            h(MenuItem, { value: "copy", disabled: true }, () => "Copy"),
          ]),
          h(MenuSeparator),
          h(MenuRoot, { id: "share" }, () => [
            h(MenuTriggerItem, () => "Share"),
            h(MenuPositioner, () => [
              h(MenuContent, () => [h(MenuItem, { value: "mail" }, () => "Mail")]),
            ]),
          ]),
        ]),
      ]),
    ]),
  );
  await nextTick();
  expect(tree.by("trigger").getAttribute("aria-haspopup")).toBe("menu");
  expect(tree.by("trigger").style.getPropertyValue("anchor-name")).toBe("--mw-ui-file");
  expect(tree.by("content").getAttribute("role")).toBe("menu");
  expect(tree.by("item", "cut").getAttribute("role")).toBe("menuitem");
  expect(tree.by("item", "copy").getAttribute("aria-disabled")).toBe("true");
  expect(tree.by("item-group").getAttribute("role")).toBe("group");
  expect(tree.by("separator").getAttribute("role")).toBe("separator");
  const triggerItem = tree.by("trigger-item");
  expect(triggerItem.getAttribute("aria-haspopup")).toBe("menu");
  expect(triggerItem.style.getPropertyValue("anchor-name")).toBe("--mw-ui-share");
  const positioners = tree.container.querySelectorAll<HTMLElement>("[data-part='positioner']");
  // The submenu takes the side it opens on from the menu above it.
  expect(positioners[1]!.style.getPropertyValue("position-anchor")).toBe("--mw-ui-share");
  expect(positioners[1]!.style.getPropertyValue("position-area")).toBe("right span-bottom");
  tree.unmount();
});

it("merges a part's props onto the one element the slot gives with as-child", async () => {
  const order: string[] = [];
  const tree = mount(() =>
    h(MenuRoot, { id: "as-child" }, () => [
      h(
        MenuTrigger,
        { asChild: true, class: "from-part", onClick: () => order.push("part") },
        () => [h("button", { class: "from-child", onClick: () => order.push("child") }, "File")],
      ),
      h(MenuPositioner, () => [h(MenuContent, () => [h(MenuItem, { value: "cut" }, () => "Cut")])]),
    ]),
  );
  await nextTick();
  const trigger = tree.by("trigger");
  // One element, not a wrapper, carrying both classes and the API's
  // own props.
  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger.className.split(" ").sort()).toEqual(["from-child", "from-part"]);
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  trigger.click();
  await nextTick();
  // Both handlers ran, the author's own first, and Zag's behind them.
  expect(order).toEqual(["child", "part"]);
  expect(tree.by("content").getAttribute("data-state")).toBe("open");
  tree.unmount();
});

it("tells a part it is outside its root", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const container = document.createElement("div");
  const app = createApp({ setup: () => () => h(MenuItem, { value: "lost" }) });
  expect(() => app.mount(container)).toThrow(/inside <MenuRoot>/);
  warn.mockRestore();
});

it("renders a listbox's parts on its own root element, attributes and all", async () => {
  const items = collection({ items: ["main", "next"] });
  const tree = mount(() =>
    h(ListboxRoot, { collection: items, class: "border", "data-test": "listbox" }, () => [
      h(ListboxLabel, () => "Branch"),
      h(ListboxContent, () =>
        items.items.map((value) =>
          h(ListboxItem, { value, key: value }, () => [
            h(ListboxItemIndicator, () => "*"),
            h(ListboxItemText, () => value),
          ]),
        ),
      ),
    ]),
  );
  await nextTick();
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
  tree.unmount();
});

it("renders a select's parts, the hidden control out of the grid", async () => {
  const items = collection({ items: ["main", "next"] });
  const tree = mount(() =>
    h(SelectRoot, { collection: items, name: "branch" }, () => [
      h(SelectControl, () => [
        h(SelectTrigger, () => [h(SelectValueText), h(SelectIndicator, () => "▾")]),
      ]),
      h(SelectPositioner, () => [
        h(SelectContent, () =>
          items.items.map((value) =>
            h(SelectItem, { value, key: value }, () => [h(SelectItemText, () => value)]),
          ),
        ),
      ]),
      h(SelectHiddenSelect),
    ]),
  );
  await nextTick();
  expect(tree.by("trigger").getAttribute("aria-haspopup")).toBe("listbox");
  expect(tree.by("positioner").getAttribute("popover")).toBe("manual");
  const hidden = tree.container.querySelector<HTMLSelectElement>("select")!;
  expect(hidden.name).toBe("branch");
  // Hidden by display, not by Zag's visually-hidden box, which would
  // take cells on the grid.
  expect(hidden.style.display).toBe("none");
  expect(hidden.querySelectorAll("option")).toHaveLength(2);
  tree.unmount();
});

it("selects every option a multiple select's value holds in its hidden control", async () => {
  const items = collection({ items: ["main", "next", "old"] });
  const state = reactive({ name: "branches" });
  const tree = mount(() =>
    h(
      SelectRoot,
      { collection: items, multiple: true, defaultValue: ["main", "old"], name: state.name },
      () => [h(SelectHiddenSelect)],
    ),
  );
  await nextTick();
  const hidden = tree.container.querySelector<HTMLSelectElement>("select")!;
  expect([...hidden.selectedOptions].map((option) => option.value)).toEqual(["main", "old"]);
  // A render that leaves the value alone leaves the selection alone.
  state.name = "targets";
  await nextTick();
  await nextTick();
  expect(hidden.name).toBe("targets");
  expect([...hidden.selectedOptions].map((option) => option.value)).toEqual(["main", "old"]);
  tree.unmount();
});

it("selects the hidden option of a value that arrived before it, and none until then", async () => {
  const items = shallowRef(collection({ items: ["main"] }));
  const tree = mount(() =>
    h(SelectRoot, { collection: items.value, defaultValue: ["release"] }, () => [
      h(SelectHiddenSelect),
    ]),
  );
  await nextTick();
  const hidden = tree.container.querySelector<HTMLSelectElement>("select")!;
  expect(posted(hidden), "no option chosen in its place").toEqual([]);
  items.value = collection({ items: ["main", "release"] });
  await nextTick();
  await nextTick();
  expect(posted(hidden)).toEqual(["release"]);
  tree.unmount();
});

/** A select over a composable the test drives, its hidden control in a
 * form. */
function mountReset(id: string, defaultValue?: string[]) {
  let api!: ReturnType<typeof useSelect>;
  const tree = mountSetup(() => {
    api = useSelect({
      id,
      collection: collection({ items: ["main", "next"] }),
      name: "branch",
      ...(defaultValue ? { defaultValue } : {}),
    });
    return () => h("form", [h(SelectRootProvider, { value: api }, () => [h(SelectHiddenSelect)])]);
  });
  return { tree, api };
}

it("server-renders its hidden control's options, a form posting the default before hydration", async () => {
  const items = collection({ items: ["main", "next"] });
  const page = (defaultValue?: string[]) =>
    createSSRApp({
      render: () =>
        h("form", [
          h(
            SelectRoot,
            {
              id: "served",
              collection: items,
              name: "branch",
              ...(defaultValue ? { defaultValue } : {}),
            },
            () => [h(SelectHiddenSelect)],
          ),
        ]),
    });
  const container = document.createElement("div");
  container.innerHTML = await renderToString(page(["next"]));
  document.body.append(container);
  const hidden = container.querySelector("select")!;
  expect(posted(hidden), "before the script runs").toEqual(["next"]);
  expect(hidden.getAttribute("size"), "no first option picked in the default's absence").toBe("2");
  const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = page(["next"]);
  app.mount(container);
  await nextTick();
  expect(warned, "a clean hydration").not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
  warned.mockRestore();
  errors.mockRestore();
  expect(container.querySelector("select")).toBe(hidden);
  expect(posted(hidden)).toEqual(["next"]);
  app.unmount();
  container.remove();
  expect(await renderToString(page())).not.toContain("selected");
});

it("goes back to its default at a reset the reader clicks, or to no option", async () => {
  const withDefault = mountReset("clicked", ["next"]);
  await nextTick();
  const hidden = withDefault.tree.container.querySelector<HTMLSelectElement>("select")!;
  await resetByClick(hidden.form!);
  expect(posted(hidden)).toEqual(["next"]);
  withDefault.tree.unmount();
  const { tree, api } = mountReset("clicked-empty");
  await nextTick();
  const control = tree.container.querySelector<HTMLSelectElement>("select")!;
  api.api.value.setValue(["main"]);
  await nextTick();
  await nextTick();
  await resetByClick(control.form!);
  expect(api.api.value.value).toEqual([]);
  expect(posted(control), "no option chosen in its place").toEqual([]);
  tree.unmount();
});

it("goes back to its default at a form's reset, the machine and the form alike", async () => {
  const { tree, api } = mountReset("reset", ["next"]);
  await nextTick();
  const hidden = tree.container.querySelector<HTMLSelectElement>("select")!;
  // A reset the machine sees as no change: the form's own reset alone
  // puts the default back.
  hidden.form!.reset();
  await nextTick();
  expect(posted(hidden)).toEqual(["next"]);
  api.api.value.setValue(["main"]);
  await nextTick();
  await nextTick();
  expect(posted(hidden)).toEqual(["main"]);
  hidden.form!.reset();
  await nextTick();
  await nextTick();
  expect(api.api.value.value).toEqual(["next"]);
  expect(posted(hidden)).toEqual(["next"]);
  tree.unmount();
});

it("selects through a listbox's parts, the choice reaching the page", async () => {
  const items = collection({ items: ["main", "next"] });
  const chosen: string[][] = [];
  const tree = mount(() =>
    h(
      ListboxRoot,
      { collection: items, onValueChange: ({ value }: { value: string[] }) => chosen.push(value) },
      () => [
        h(ListboxContent, () =>
          items.items.map((value) =>
            h(ListboxItem, { value, key: value }, () => [
              h(ListboxItemIndicator, () => "*"),
              h(ListboxItemText, () => value),
            ]),
          ),
        ),
      ],
    ),
  );
  await nextTick();
  tree.by("item", "next").click();
  await nextTick();
  expect(chosen).toEqual([["next"]]);
  // The state Tailwind styles, and the indicator that shows it.
  expect(tree.by("item", "next").getAttribute("data-state")).toBe("checked");
  expect(tree.by("item", "main").getAttribute("data-state")).toBe("unchecked");
  const indicator = tree.by("item", "next").querySelector("[data-part='item-indicator']")!;
  expect(indicator.getAttribute("data-state")).toBe("checked");
  tree.unmount();
});

it("opens a select from an API the caller holds and writes the choice into it", async () => {
  const items = collection({ items: ["main", "next"] });
  let api!: ReturnType<typeof useSelect>;
  const tree = mountSetup(() => {
    api = useSelect({ id: "branch", collection: items });
    return () =>
      h(SelectRootProvider, { value: api }, () => [
        h(SelectControl, () => [h(SelectTrigger, () => [h(SelectValueText, () => "branch…")])]),
        h(SelectPositioner, () => [
          h(SelectContent, () =>
            items.items.map((value) =>
              h(SelectItem, { value, key: value }, () => [h(SelectItemText, () => value)]),
            ),
          ),
        ]),
        h(SelectHiddenSelect),
      ]);
  });
  await nextTick();
  // The placeholder until something is chosen, as the mount writes it.
  expect(tree.by("value-text").textContent).toBe("branch…");
  api.api.value.setOpen(true);
  await nextTick();
  expect(tree.by("content").getAttribute("data-state")).toBe("open");
  tree.by("item", "next").click();
  await nextTick();
  expect(api.api.value.value).toEqual(["next"]);
  expect(tree.by("value-text").textContent).toBe("next");
  expect(tree.container.querySelector<HTMLSelectElement>("select")!.value).toBe("next");
  tree.unmount();
});

it("follows a v-model through the update events a root emits", async () => {
  const items = collection({ items: ["main", "next"] });
  const state = reactive({ open: false, value: [] as string[] });
  const tree = mount(() =>
    h(
      SelectRoot,
      {
        collection: items,
        open: state.open,
        value: state.value,
        // What `v-model:open` and `v-model:value` compile to.
        "onUpdate:open": (open: boolean) => (state.open = open),
        "onUpdate:value": (value: string[]) => (state.value = value),
      },
      () => [
        h(SelectControl, () => [h(SelectTrigger, () => [h(SelectValueText, () => "branch…")])]),
        h(SelectPositioner, () => [
          h(SelectContent, () =>
            items.items.map((value) =>
              h(SelectItem, { value, key: value }, () => [h(SelectItemText, () => value)]),
            ),
          ),
        ]),
      ],
    ),
  );
  await nextTick();
  tree.by("trigger").click();
  await nextTick();
  expect(state.open).toBe(true);
  tree.by("item", "next").click();
  await nextTick();
  expect(state.value).toEqual(["next"]);
  expect(state.open).toBe(false);
  // The selection marked as a listbox's items and the mount's are.
  expect(tree.by("item", "next").hasAttribute("data-selected")).toBe(true);
  expect(tree.by("item", "main").hasAttribute("data-selected")).toBe(false);
  tree.unmount();
});

it("follows a v-model on a bound prop the callback's detail names otherwise", async () => {
  // `v-model:triggerValue`: the trigger callbacks carry it as `value`.
  const menu = reactive({ triggerValue: undefined as string | undefined });
  const menuTree = mount(() =>
    h(
      MenuRoot,
      {
        triggerValue: menu.triggerValue,
        "onUpdate:triggerValue": (value: string) => (menu.triggerValue = value),
      },
      () => [
        h(MenuTrigger, { value: "a" }, () => "a"),
        h(MenuTrigger, { value: "b" }, () => "b"),
        h(MenuPositioner, () => [h(MenuContent, () => [h(MenuItem, { value: "x" }, () => "x")])]),
      ],
    ),
  );
  await nextTick();
  menuTree.container.querySelectorAll<HTMLElement>("[data-part='trigger']")[1]!.click();
  await nextTick();
  expect(menu.triggerValue).toBe("b");
  menuTree.unmount();
  // A dialog's triggers carry values as a menu's do.
  const dialog = reactive({ triggerValue: undefined as string | undefined });
  const dialogTree = mount(() =>
    h(
      DialogRoot,
      {
        triggerValue: dialog.triggerValue,
        "onUpdate:triggerValue": (value: string) => (dialog.triggerValue = value),
      },
      () => [
        h(DialogTrigger, { value: "a" }, () => "a"),
        h(DialogTrigger, { value: "b" }, () => "b"),
        h(DialogPositioner, () => [h(DialogContent, () => "shared")]),
      ],
    ),
  );
  await nextTick();
  dialogTree.container.querySelectorAll<HTMLElement>("[data-part='trigger']")[1]!.click();
  await nextTick();
  expect(dialog.triggerValue).toBe("b");
  dialogTree.unmount();
  // `v-model:inputValue`: what the reader types.
  const items = collection({ items: ["main", "next"] });
  const combobox = reactive({ inputValue: "" });
  const tree = mount(() =>
    h(
      ComboboxRoot,
      {
        collection: items,
        inputValue: combobox.inputValue,
        "onUpdate:inputValue": (value: string) => (combobox.inputValue = value),
      },
      () => [h(ComboboxControl, () => [h(ComboboxInput)])],
    ),
  );
  await nextTick();
  const input = tree.by("input") as HTMLInputElement;
  // An idle combobox takes typing only once its input has focus.
  input.focus();
  input.value = "ne";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
  expect(combobox.inputValue).toBe("ne");
  tree.unmount();
});

it("renders a combobox, its list anchored under the control it types into", async () => {
  const items = collection({ items: ["main", "next"] });
  const tree = mount(() =>
    h(ComboboxRoot, { collection: items, placeholder: "branch…" }, () => [
      h(ComboboxLabel, () => "Find"),
      h(ComboboxControl, () => [h(ComboboxInput), h(ComboboxTrigger, () => "▼")]),
      h(ComboboxPositioner, () => [
        h(ComboboxContent, () =>
          items.items.map((value) =>
            h(ComboboxItem, { value, key: value }, () => [h(ComboboxItemText, () => value)]),
          ),
        ),
      ]),
    ]),
  );
  await nextTick();
  const input = tree.by("input") as HTMLInputElement;
  expect(input.getAttribute("role")).toBe("combobox");
  expect(input.placeholder).toBe("branch…");
  // The list lines up under the control, not the button beside it.
  const anchor = tree.by("control").style.getPropertyValue("anchor-name");
  expect(anchor).toMatch(/^--mw-ui-/);
  expect(tree.by("positioner").style.getPropertyValue("position-anchor")).toBe(anchor);
  expect(tree.by("trigger").style.getPropertyValue("anchor-name")).toBe("");
  tree.unmount();
});
