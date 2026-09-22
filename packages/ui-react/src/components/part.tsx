import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  type ComponentPropsWithRef,
  type ElementType,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { mergeProps } from "@zag-js/react";
import { warnStray } from "@monowind/ui/framework";

/**
 * What every part of a compound component is (specs/ui.md "Component
 * layer"): its element with the API's props under the author's —
 * merged by Zag's own `mergeProps`, so the class reads API-first and
 * the handlers run author-first in every framework alike — or, with
 * `asChild`, those props cloned onto the one child the author gave.
 */

type Props = Record<string, unknown>;

/** What a part takes: the props of the element it renders, so a
 * `Trigger` autocompletes a button's and a typo is an error, plus
 * `asChild`. */
export type PartProps<T extends ElementType = "div"> = Omit<
  ComponentPropsWithRef<T>,
  "children"
> & {
  /** Render the one child instead of the part's own element, with the
   * part's props merged onto it. */
  asChild?: boolean | undefined;
  children?: ReactNode | undefined;
};

/** One ref set to a node, giving back the cleanup React will run —
 * its own where the ref returned one, else the undo React would do. */
function attach<T>(ref: Ref<T>, node: T | null): () => void {
  if (typeof ref === "function") {
    return (ref(node) as (() => void) | void) ?? (() => attach(ref, null));
  }
  (ref as { current: T | null }).current = node;
  return () => {
    (ref as { current: T | null }).current = null;
  };
}

/** Several refs on one node, a ref being a prop in React 19: each is
 * set in turn, and every cleanup runs at the unmount. */
function chain<T>(refs: Ref<T>[]): Ref<T> {
  if (refs.length === 1) return refs[0]!;
  return (node: T | null) => {
    const cleanups = refs.map((ref) => attach(ref, node));
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  };
}

/** Zag's merge, with the refs of both sides kept rather than the
 * later one winning. */
function merge(...sides: Props[]): Props {
  const merged = mergeProps(...sides) as Props;
  const refs = sides
    .map((side) => side["ref"] as Ref<unknown> | undefined)
    .filter((ref) => ref != null);
  if (refs.length > 1) merged["ref"] = chain(refs);
  return merged;
}

/** A part's element, or the child it renders instead. */
export function renderPart(
  name: string,
  tag: ElementType,
  apiProps: object,
  part: PartProps<ElementType>,
): ReactNode {
  const { asChild, children, ...authored } = part as { children?: ReactNode } & Props;
  const props = merge(apiProps as Props, authored);
  if (!asChild) {
    const Tag = tag;
    return <Tag {...props}>{children}</Tag>;
  }
  // Counted here rather than through `Children.only`, whose own
  // error names React instead of the part.
  const [child, ...rest] = Children.toArray(children);
  if (rest.length > 0 || !isValidElement(child)) {
    throw new Error(`<${name} asChild> takes exactly one element`);
  }
  const element = child as ReactElement<Props>;
  return cloneElement(element, merge(props, element.props));
}

const NONE: Props = Object.freeze({});

/** The props a part hands the API rather than the element — an item's
 * `value`, say — split off from the element's own. */
export function splitProps(props: Props, own: readonly string[]): [Props, Props] {
  if (own.length === 0) return [NONE, props];
  const mine: Props = {};
  const rest: Props = {};
  for (const [key, value] of Object.entries(props)) {
    (own.includes(key) ? mine : rest)[key] = value;
  }
  return [mine, rest];
}

/** The name React's devtools and error boundaries show. */
function named<F extends object>(name: string, component: F): F {
  return Object.assign(component, { displayName: name });
}

/** A part over a context's API: the getter's props on the element, the
 * named props handed to the getter instead. */
export function definePart<A, T extends ElementType = "div", Own = unknown>(
  name: string,
  useApi: () => A,
  propsOf: (api: A, own: Props) => object,
  tag: T = "div" as T,
  own: readonly string[] = [],
): (props: PartProps<T> & Own) => ReactNode {
  return named(name, function Part(props: PartProps<T> & Own) {
    const api = useApi();
    const [mine, rest] = splitProps(props as Props, own);
    return renderPart(name, tag, propsOf(api, mine), rest);
  });
}

/** The parts of one component, each over the API its context holds
 * and named for the devtools (`Menu.Item`). */
export function partsOf<A>(prefix: string, useApi: () => A) {
  return <T extends ElementType = "div", Own = unknown>(
    name: string,
    propsOf: (api: A, own: Props) => object,
    tag?: T,
    own?: readonly string[],
  ): ((props: PartProps<T> & Own) => ReactNode) =>
    definePart<A, T, Own>(`${prefix}.${name}`, useApi, propsOf, tag, own);
}

/** The element a root renders, where its component has a root part.
 * A menu, a dialog, a popover and a tooltip have none in Zag, so
 * their root is the provider alone: it renders nothing, and a
 * wrapper invented for it would put a box in the grid's layout. */
export interface RootPart<V> {
  propsOf: (value: V) => object;
  tag?: ElementType;
}

/** A root over its own machine: the hook on its props, an id
 * generated where none is given, held for the parts under it. */
export function defineRoot<
  P extends { id: string },
  V,
  /** What the root takes past the machine's props: the element's own
   * where it renders one, and children alone where it does not — a
   * class on such a root would go nowhere, so the type says so. */
  Extra = { children?: ReactNode },
>(
  name: string,
  use: (props: P) => V,
  context: { Provider: (props: { value: V; children?: ReactNode }) => ReactNode },
  propNames: readonly string[],
  root?: RootPart<V>,
): (props: Omit<P, "id"> & { id?: string } & Extra) => ReactNode {
  return named(name, function Root(given: Props) {
    const { children, ...props } = given as { children?: ReactNode } & Props;
    const generated = useId();
    const [machine, rest] = splitProps(props, propNames);
    if (!root) warnStray(name, Object.keys(rest));
    const value = use({ ...machine, id: machine["id"] ?? generated } as unknown as P);
    const inside = <context.Provider value={value}>{children}</context.Provider>;
    if (!root) return inside;
    return renderPart(name, root.tag ?? "div", root.propsOf(value), {
      ...rest,
      children: inside,
    });
  });
}

/** A root over an API the caller holds, for reaching it from outside
 * the tree: run the hook yourself and hand over what it returns. */
export function defineRootProvider<V>(
  name: string,
  context: { Provider: (props: { value: V; children?: ReactNode }) => ReactNode },
): (props: { value: V; children?: ReactNode }) => ReactNode {
  return named(name, function RootProvider({ value, children }) {
    return <context.Provider value={value}>{children}</context.Provider>;
  });
}

/** A component's context: what its parts read, and the hook that
 * fails loudly outside a root rather than on an undefined API. */
export function defineContext<V>(name: string): {
  Provider: (props: { value: V; children?: ReactNode }) => ReactNode;
  use: () => V;
  useOptional: () => V | null;
} {
  const Context = createContext<V | null>(null);
  return {
    Provider: ({ value, children }) => <Context value={value}>{children}</Context>,
    use: () => {
      const value = useContext(Context);
      if (value === null) throw new Error(`a ${name} part must be inside <${name}.Root>`);
      return value;
    },
    useOptional: () => useContext(Context),
  };
}
