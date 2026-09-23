import { Comment, cloneVNode, computed, defineComponent, h, inject, provide, useId } from "vue";
import type { ComputedRef, DefineSetupFnComponent, InjectionKey, VNode } from "vue";
import { mergeProps } from "@zag-js/vue";
import { BOUND, defined, warnStray, type TriggerApi } from "@monowind/ui/framework";

/**
 * What every part of a compound component is (specs/ui.md "Component
 * layer"): its element with the API's props under the author's —
 * merged by Zag's own `mergeProps` — or, with `asChild`, those props
 * on the one element the default slot gives.
 */

type Props = Record<string, unknown>;

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
export function defineContext<V>(name: string): {
  key: InjectionKey<V>;
  provide: (value: V) => void;
  use: () => V;
  useOptional: () => V | undefined;
} {
  const key = Symbol(name) as InjectionKey<V>;
  return {
    key,
    provide: (value) => provide(key, value),
    use: () => {
      const value = inject(key, undefined);
      if (value === undefined) throw new Error(`a ${name} part must be inside <${name}Root>`);
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
 * declared props handed to the getter instead. */
export function definePart<V>(
  name: string,
  context: { use: () => V },
  propsOf: (value: V, own: Props) => object,
  tag = "div",
  own: readonly string[] = [],
) {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: ["asChild", ...own] as string[],
    setup(props: Props, { slots, attrs }) {
      const value = context.use();
      return () => {
        const { asChild, ...mine } = props;
        return renderPart(
          tag,
          propsOf(value, defined(mine)),
          attrs as Props,
          Boolean(asChild),
          slots["default"]?.(),
          name,
        );
      };
    },
  });
}

/** The parts of one component, each over the API its context holds
 * and named for it (`DialogTrigger`). */
export function partsOf<A, V extends { api: ComputedRef<A> }>(
  prefix: string,
  context: { use: () => V },
) {
  return (
    name: string,
    propsOf: (api: A, own: Props) => object,
    tag?: string,
    own?: readonly string[],
  ) =>
    definePart<V>(
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
  return partsOf<A, V>(prefix, context)(
    "Trigger",
    (api, own) => api.getTriggerProps(own),
    "button",
    ["value"],
  );
}

/** The element a root renders, where its component has a root part.
 * A menu, a dialog, a popover and a tooltip have none in Zag, so
 * their root is the provider alone: it renders nothing, and a
 * wrapper invented for it would put a box in the grid's layout. */
export interface RootPart<V> {
  propsOf: (value: V) => object;
  tag?: string;
}

/** A root over its own machine: the composable on its props, an id
 * generated where none is given, provided to the parts under it.
 * Vue's own overloads do not see through the generic props, so the
 * component is typed here rather than inferred. */
export function defineRoot<P extends { id: string }, V extends object>(
  name: string,
  names: readonly string[],
  context: { provide: (value: V) => void },
  create: (props: () => P) => V,
  root?: RootPart<V>,
): DefineSetupFnComponent<Omit<P, "id"> & { id?: string }> {
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
      if (!root) warnStray(name, Object.keys(attrs), value);
      // A declared prop is the machine's; everything else Vue leaves
      // in `attrs`, which is exactly the element's own.
      return () =>
        root
          ? renderPart(
              root.tag ?? "div",
              root.propsOf(value),
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
      props: root ? [...names, "asChild"] : [...names],
      emits: updatesOf(names),
    },
  );
  return component as unknown as DefineSetupFnComponent<Omit<P, "id"> & { id?: string }>;
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
