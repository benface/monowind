/**
 * What a framework package builds its components on
 * (specs/ui.md "Component layer"): the shapes and the words shared by
 * `@monowind/ui-react`, `-vue` and `-svelte`, so a rule lives once
 * rather than once per framework.
 */

/** What an item part needs of the API it is under: Zag gives a
 * listbox and a select the same five getters, and the mount and every
 * framework's item parts read exactly these. */
export interface ItemApi {
  collection: { find(value: string): unknown; size: number };
  getItemProps(props: { item: unknown }): object;
  getItemTextProps(props: { item: unknown }): object;
  getItemIndicatorProps(props: { item: unknown }): object;
  getItemGroupProps(props: { id: string }): object;
  getItemGroupLabelProps(props: { htmlFor: string }): object;
}

/** What a root was given that is neither the machine's props nor its
 * element's: a menu's, a dialog's, a popover's and a tooltip's root
 * renders nothing — Zag gives those four no root part — so there is
 * nowhere for it to go. Said once, and not in production: the same
 * word on an element (`class` on a `<mono-menu>`) styles it, which is
 * exactly the mistake worth naming. */
export function warnStray(name: string, stray: string[]): void {
  if (stray.length === 0) return;
  if (typeof process !== "undefined" && process.env["NODE_ENV"] === "production") return;
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
