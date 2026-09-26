import { Comment, cloneVNode, computed, defineComponent, h, inject, provide, useId } from "vue";
import type {
  ComponentObjectPropsOptions,
  ComputedRef,
  DefineSetupFnComponent,
  InjectionKey,
  IntrinsicElementAttributes,
  Prop,
  Ref,
  VNode,
} from "vue";
import { mergeProps } from "@zag-js/vue";
import { BOUND, defined, warnStray, type Defined, type TriggerApi } from "@monowind/ui/framework";

/**
 * What every part of a compound component is (specs/ui.md "Component
 * layer"): its element with the API's props under the author's —
 * merged by Zag's own `mergeProps` — or, with `asChild`, those props
 * on the one element the default slot gives.
 */

type Props = Record<string, unknown>;

/** An element a part renders. */
export type Tag = keyof IntrinsicElementAttributes;

/** What a part takes: its own props, and its element's attributes,
 * which Vue leaves in `attrs` for the part to merge onto that element
 * — but `class` and `style`, which Vue types for every component. */
export type PartProps<T extends Tag, Own = {}> = Omit<
  IntrinsicElementAttributes[T],
  keyof Own | "class" | "style"
> &
  Own;

/** A part as a template's type-check reads it. */
export type Part<T extends Tag, Own = {}> = DefineSetupFnComponent<
  PartProps<T, Own & { asChild?: boolean }>,
  {},
  {}
>;

/** A boolean prop's declaration: a bare attribute sets it, as in HTML,
 * and an absent one stays `undefined`, the machine's default. */
export const BOOLEAN = { type: Boolean, default: undefined } as const;

/** The machines' boolean props, which the coverage test holds to their
 * types; `openOnChange` takes a function as well. */
export const BOOLEANS = {
  allowCustomValue: BOOLEAN,
  alwaysSubmitOnEnter: BOOLEAN,
  autoFocus: BOOLEAN,
  closeOnClick: BOOLEAN,
  closeOnEscape: BOOLEAN,
  closeOnInteractOutside: BOOLEAN,
  closeOnPointerDown: BOOLEAN,
  closeOnScroll: BOOLEAN,
  closeOnSelect: BOOLEAN,
  composite: BOOLEAN,
  defaultOpen: BOOLEAN,
  deselectable: BOOLEAN,
  disableLayer: BOOLEAN,
  disabled: BOOLEAN,
  disallowSelectAll: BOOLEAN,
  interactive: BOOLEAN,
  invalid: BOOLEAN,
  loopFocus: BOOLEAN,
  modal: BOOLEAN,
  multiple: BOOLEAN,
  open: BOOLEAN,
  openOnChange: { type: [Boolean, Function], default: undefined },
  openOnClick: BOOLEAN,
  openOnKeyPress: BOOLEAN,
  portalled: BOOLEAN,
  preventScroll: BOOLEAN,
  readOnly: BOOLEAN,
  required: BOOLEAN,
  restoreFocus: BOOLEAN,
  selectOnHighlight: BOOLEAN,
  trapFocus: BOOLEAN,
  typeahead: BOOLEAN,
} satisfies Record<string, Prop<unknown>>;

/** A machine's props as Vue declares them: each boolean one typed, so
 * a bare attribute sets it. */
export const declarationsOf = (names: readonly string[]): ComponentObjectPropsOptions =>
  Object.fromEntries(
    names.map((prop) => [prop, (BOOLEANS as Record<string, Prop<unknown>>)[prop] ?? null]),
  );

/** The `update:…` events a component's own props allow, which Vue
 * wants declared. */
export const updatesOf = (names: readonly string[]): string[] =>
  BOUND.filter(({ prop }) => names.includes(prop)).map(({ prop }) => `update:${prop}`);

/** Props with each bound callback emitting its `update:…` first, so
 * `v-model:open` follows the machine while the author's own callback
 * still runs. */
export function withUpdates(
  props: Props,
  names: readonly string[],
  emit: (event: string, value: unknown) => void,
): Props {
  const merged = { ...props };
  for (const { prop, callback, key } of BOUND) {
    if (!names.includes(prop)) continue;
    const authored = merged[callback] as ((detail: Props) => void) | undefined;
    merged[callback] = (detail: Props) => {
      emit(`update:${prop}`, detail[key]);
      authored?.(detail);
    };
  }
  return merged;
}

/** A component's context: what its parts inject, and the reader that
 * fails loudly outside a root rather than on an undefined API. */
export function defineContext<V>(
  name: string,
  outside = `a ${name} part must be inside <${name}Root>`,
): {
  provide: (value: V) => void;
  use: () => V;
  useOptional: () => V | undefined;
} {
  const key = Symbol(name) as InjectionKey<V>;
  return {
    provide: (value) => provide(key, value),
    use: () => {
      const value = inject(key, undefined);
      if (value === undefined) throw new Error(outside);
      return value;
    },
    useOptional: () => inject(key, undefined),
  };
}

/** The one element a part renders in place of its own. */
function only(children: VNode[] | undefined, name: string): VNode {
  const nodes = (children ?? []).filter((node) => node.type !== Comment);
  if (nodes.length !== 1) throw new Error(`<${name} as-child> takes exactly one element`);
  return nodes[0]!;
}

/** A part's element, or the element the slot gave with the part's
 * props on it. Cloning merges the child's own props over these, which
 * runs its handlers first and its class after — the order Zag's own
 * merge gives, so the two paths behave alike. */
export function renderPart(
  tag: string,
  apiProps: object,
  attrs: Props,
  asChild: boolean,
  children: VNode[] | undefined,
  name: string,
): VNode {
  const props = mergeProps(apiProps as Props, attrs) as Props;
  if (!asChild) return h(tag, props, children);
  // The refs of both sides are kept: the positioner's is the top
  // layer's, and the author may want one of their own.
  return cloneVNode(only(children, name), props, true);
}

/** A part over a context's API: the getter's props on the element, the
 * declared props (`Own`, typed by the caller) handed to the getter
 * instead. */
export function definePart<V, T extends Tag = "div", Own extends Props = {}>(
  name: string,
  context: { use: () => V },
  propsOf: (value: V, own: Defined<Own>) => object,
  tag: T = "div" as T,
  own?: ComponentObjectPropsOptions<Own>,
): Part<T, Own> {
  const component = defineComponent(
    (props: Props, { slots, attrs }) => {
      const value = context.use();
      return () => {
        const { asChild, ...mine } = props;
        return renderPart(
          tag,
          propsOf(value, defined(mine) as Defined<Own>),
          attrs as Props,
          Boolean(asChild),
          slots["default"]?.(),
          name,
        );
      };
    },
    { name, inheritAttrs: false, props: { asChild: BOOLEAN, ...own } },
  );
  return component as unknown as Part<T, Own>;
}

/** The parts of one component, each over the API its context holds
 * and named for it (`DialogTrigger`). */
export function partsOf<A, V extends { api: ComputedRef<A> }>(
  prefix: string,
  context: { use: () => V },
) {
  return <T extends Tag = "div", Own extends Props = {}>(
    name: string,
    propsOf: (api: A, own: Defined<Own>) => object,
    tag?: T,
    own?: ComponentObjectPropsOptions<Own>,
  ) =>
    definePart<V, T, Own>(
      `${prefix}${name}`,
      context,
      (value, given) => propsOf(value.api.value, given),
      tag,
      own,
    );
}

/** The `Trigger` of a component whose root can open from one of several
 * — a menu, a dialog, a popover and a tooltip — a button whose `value`
 * tells the root which trigger it opened from. */
export function triggerPart<A extends TriggerApi, V extends { api: ComputedRef<A> }>(
  prefix: string,
  context: { use: () => V },
) {
  return partsOf<A, V>(prefix, context)<"button", { value?: string }>(
    "Trigger",
    (api, own) => api.getTriggerProps(own),
    "button",
    { value: null },
  );
}

/** The floating part, carrying the ref that keeps it in the top layer
 * with the machine. */
export function positionerPart<
  V extends {
    api: ComputedRef<{ getPositionerProps(): object }>;
    positioner: Ref<HTMLElement | null>;
  },
  T extends Tag = "div",
>(prefix: string, context: { use: () => V }, tag?: T) {
  return definePart<V, T>(
    `${prefix}Positioner`,
    context,
    (value) => ({ ...value.api.value.getPositionerProps(), ref: value.positioner }),
    tag,
  );
}

/** A root's props: its machine's, the id optional. */
export type RootProps<P> = Omit<P, "id"> & { id?: string };

/** A root over its own machine: the composable on its props, an id
 * generated where none is given, provided to the parts under it —
 * inside the element `rootProps` gives the props of where Zag names a
 * root part, and taking its attributes, around the parts alone
 * elsewhere (`warnStray`). Vue's own overloads do not see through the
 * generic props, so the component is typed here rather than inferred. */
export function defineRoot<P extends { id: string }, V extends object>(
  name: string,
  names: readonly string[],
  context: { provide: (value: V) => void },
  create: (props: () => P) => V,
): DefineSetupFnComponent<RootProps<P>>;
export function defineRoot<P extends { id: string }, V extends object>(
  name: string,
  names: readonly string[],
  context: { provide: (value: V) => void },
  create: (props: () => P) => V,
  rootProps: (value: V) => object,
): Part<"div", RootProps<P>>;
export function defineRoot<P extends { id: string }, V extends object>(
  name: string,
  names: readonly string[],
  context: { provide: (value: V) => void },
  create: (props: () => P) => V,
  rootProps?: (value: V) => object,
): DefineSetupFnComponent<RootProps<P>> | Part<"div", RootProps<P>> {
  const declared = declarationsOf(names);
  const component = defineComponent(
    (props: Record<string, unknown>, { slots, attrs, emit }) => {
      const generated = useId();
      const machineProps = computed(() => {
        const { asChild: _, ...given } = props;
        const own = { ...defined(given), id: (props["id"] as string | undefined) ?? generated };
        return withUpdates(own, names, emit) as P;
      });
      const value = create(() => machineProps.value);
      context.provide(value);
      // Vue leaves every prop the component did not declare in
      // `attrs`, which is exactly what a root with no element of its
      // own has nowhere to put.
      if (!rootProps) warnStray(name, Object.keys(attrs), value);
      // A declared prop is the machine's; everything else Vue leaves
      // in `attrs`, which is exactly the element's own.
      return () =>
        rootProps
          ? renderPart(
              "div",
              rootProps(value),
              attrs as Props,
              Boolean(props["asChild"]),
              slots["default"]?.(),
              name,
            )
          : slots["default"]?.();
    },
    {
      name,
      inheritAttrs: false,
      props: rootProps ? { ...declared, asChild: BOOLEAN } : declared,
      emits: updatesOf(names),
    },
  );
  return component as unknown as DefineSetupFnComponent<RootProps<P>>;
}

/** A root over an API the caller holds, for reaching it from outside
 * the tree: run the composable yourself and provide what it returns. */
export function defineRootProvider<V>(name: string, context: { provide: (value: V) => void }) {
  return defineComponent(
    (props: { value: V }, { slots }) => {
      context.provide(props.value);
      return () => slots["default"]?.();
    },
    { name, inheritAttrs: false, props: ["value"] },
  );
}
