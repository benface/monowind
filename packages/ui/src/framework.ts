/**
 * What a framework package builds its components on
 * (specs/ui.md "Component layer"): the shapes and the words shared by
 * `@monowind/ui-react`, `-vue` and `-svelte`, so a rule lives once
 * rather than once per framework.
 */

/** What an item part needs of the API it is under: Zag gives a
 * listbox, a select and a combobox the same collection and five
 * getters, and the mount and every framework's item parts read
 * exactly these — a framework's from the nearest of the three roots,
 * whichever the part is named for. */
export interface ItemApi {
  collection: { find(value: string): unknown; size: number };
  getItemProps(props: { item: unknown }): object;
  getItemTextProps(props: { item: unknown }): object;
  getItemIndicatorProps(props: { item: unknown }): object;
  getItemGroupProps(props: { id: string }): object;
  getItemGroupLabelProps(props: { htmlFor: string }): object;
}

/** What a trigger takes of its own: a menu, a dialog, a popover and a
 * tooltip name one of several by value, a combobox says whether its
 * one takes focus. A component ignores what it does not read. */
export interface TriggerOptions {
  value?: string | undefined;
  focusable?: boolean | undefined;
}

/** An API whose triggers take those options. */
export interface TriggerApi {
  getTriggerProps(props?: TriggerOptions): object;
}

/** The collection's item a part names: the one it was given, else
 * the one its value finds. */
export function itemOf(
  api: Pick<ItemApi, "collection">,
  props: { item?: unknown; value?: string | undefined },
): unknown {
  return props.item !== undefined ? props.item : api.collection.find(props.value ?? "");
}

/** An item's props, `data-selected` on a selected one: Zag writes it on
 * a listbox's items alone, and one marker serves every list's styles
 * and the markup a mount reads its selection from. The selection is
 * read off the `data-state` Zag writes on all three. */
export function itemProps(api: ItemApi, item: unknown): object {
  const props = api.getItemProps({ item }) as Record<string, unknown>;
  return props["data-state"] === "checked" ? { ...props, "data-selected": "" } : props;
}

const NONE = Object.freeze({});

/** Props split in two: those `names` lists — a machine's, or a part's
 * own that its getter takes — and the rest, the element's own. */
export function splitProps<P extends object>(
  props: P,
  names: readonly string[],
): [P, Record<string, unknown>] {
  if (names.length === 0) return [NONE as P, props as Record<string, unknown>];
  const named: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    (names.includes(key) ? named : rest)[key] = value;
  }
  return [named as P, rest];
}

/** Props with their `undefined` values left out. */
export type Defined<P> = { [K in keyof P]?: Exclude<P[K], undefined> };

/** Props as a machine or a getter takes them, the `undefined` ones
 * dropped: Vue and Svelte hand `undefined` for a declared prop the
 * author left out, and Zag takes a present key over its default. */
export function defined<P extends object>(props: P): Defined<P> {
  return Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Defined<P>;
}

/** The props a framework binds both ways (a Vue `v-model`, a Svelte
 * `bind:`): each with the callback the machine changes it through,
 * and the key that callback's detail carries the new value under. */
export const BOUND = [
  { prop: "open", callback: "onOpenChange", key: "open" },
  { prop: "value", callback: "onValueChange", key: "value" },
  { prop: "highlightedValue", callback: "onHighlightChange", key: "highlightedValue" },
  { prop: "triggerValue", callback: "onTriggerValueChange", key: "value" },
  { prop: "inputValue", callback: "onInputValueChange", key: "inputValue" },
] as const;

/** The stray props each root has named. */
const warned = new WeakMap<object, Set<string>>();

/** A root per component name, for a caller that names no instance. */
const rootsByName = new Map<string, object>();

const rootNamed = (name: string): object => {
  const root = rootsByName.get(name) ?? {};
  rootsByName.set(name, root);
  return root;
};

/** What a root was given that is neither the machine's props nor its
 * element's: a menu's, a dialog's, a popover's and a tooltip's root
 * renders nothing — Zag gives those four no root part, and a wrapper
 * invented for one would put a box in the grid's layout — so there is
 * nowhere for it to go. Said once per root and props, and not in
 * production: the same word on an element (`class` on a
 * `<mono-menu>`) styles it, which is exactly the mistake worth naming.
 * `root` is an object the root instance keeps across its renders, the
 * component's name standing in for it where none is given. */
export function warnStray(name: string, stray: string[], root: object = rootNamed(name)): void {
  if (stray.length === 0) return;
  if (typeof process !== "undefined" && process.env["NODE_ENV"] === "production") return;
  // A framework calls this per render (React's body does) or per
  // change of its props (Svelte's effect does).
  const said = warned.get(root) ?? new Set<string>();
  const key = stray.join(",");
  if (said.has(key)) return;
  warned.set(root, said.add(key));
  const named = stray.map((key) => `\`${key}\``).join(", ");
  console.warn(
    `[@monowind/ui] <${name}> takes the machine's props, and ${named} ` +
      `${stray.length === 1 ? "is" : "are"} not among them. This root renders no element of ` +
      `its own — put them on a part, or on the <mono-*> element instead.`,
  );
}

/** A mount that found none of the items its collection holds: the
 * parts are read once, so markup a template fills in after handing
 * the root over is markup the mount never sees, and everything but
 * the items still works. Said once, and not in production. */
export function warnUnmarked(name: string, held: number, marked: number): void {
  if (marked > 0 || held === 0) return;
  if (typeof process !== "undefined" && process.env["NODE_ENV"] === "production") return;
  console.warn(
    `[@monowind/ui] ${name} mounted with ${held} ${held === 1 ? "item" : "items"} in its ` +
      "collection and none marked in its markup. A mount reads its parts once: mark them " +
      "before it runs, or use the <mono-*> element, which mounts again as they arrive.",
  );
}
