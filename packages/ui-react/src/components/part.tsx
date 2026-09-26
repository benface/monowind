import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  useRef,
  type ComponentPropsWithRef,
  type ElementType,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { mergeProps } from "@zag-js/react";
import { splitProps, warnStray, type TriggerApi } from "@monowind/ui/framework";

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

/** A component named for React's devtools and error boundaries. */
export type Named<P> = ((props: P) => ReactNode) & { displayName: string };

function named<F extends object>(name: string, component: F): F & { displayName: string } {
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
): Named<PartProps<T> & Own> {
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
  ): Named<PartProps<T> & Own> =>
    definePart<A, T, Own>(`${prefix}.${name}`, useApi, propsOf, tag, own);
}

/** The `Trigger` of a component whose root can open from one of several
 * — a menu, a dialog, a popover and a tooltip — a button whose `value`
 * tells the root which trigger it opened from. */
export function triggerPart<A extends TriggerApi>(
  prefix: string,
  useApi: () => A,
): Named<PartProps<"button"> & { value?: string | undefined }> {
  return definePart<A, "button", { value?: string | undefined }>(
    `${prefix}.Trigger`,
    useApi,
    (api, own) => api.getTriggerProps(own),
    "button",
    ["value"],
  );
}

/** A root over its own machine: the hook on its props, an id
 * generated where none is given, held for the parts under it — inside
 * the element `rootProps` gives the props of where Zag names a root
 * part, around the parts alone elsewhere (`warnStray`). */
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
  rootProps?: (value: V) => object,
): Named<Omit<P, "id"> & { id?: string } & Extra> {
  return named(name, function Root(given: Props) {
    const { children, ...props } = given as { children?: ReactNode } & Props;
    const generated = useId();
    // One object across this root's renders: the warning is said once per root.
    const instance = useRef(null);
    const [machine, rest] = splitProps(props, propNames);
    if (!rootProps) warnStray(name, Object.keys(rest), instance);
    const value = use({ ...machine, id: machine["id"] ?? generated } as unknown as P);
    const inside = <context.Provider value={value}>{children}</context.Provider>;
    if (!rootProps) return inside;
    return renderPart(name, "div", rootProps(value), { ...rest, children: inside });
  });
}

/** A root over an API the caller holds, for reaching it from outside
 * the tree: run the hook yourself and hand over what it returns. */
export function defineRootProvider<V>(
  name: string,
  context: { Provider: (props: { value: V; children?: ReactNode }) => ReactNode },
): Named<{ value: V; children?: ReactNode }> {
  return named(name, function RootProvider({ value, children }) {
    return <context.Provider value={value}>{children}</context.Provider>;
  });
}

/** A component's context: what its parts read, and the hook that
 * fails loudly outside a root rather than on an undefined API. */
export function defineContext<V>(
  name: string,
  outside = `a ${name} part must be inside <${name}.Root>`,
): {
  Provider: (props: { value: V; children?: ReactNode }) => ReactNode;
  use: () => V;
  useOptional: () => V | null;
} {
  const Context = createContext<V | null>(null);
  return {
    Provider: ({ value, children }) => <Context value={value}>{children}</Context>,
    use: () => {
      const value = useContext(Context);
      if (value === null) throw new Error(outside);
      return value;
    },
    useOptional: () => useContext(Context),
  };
}
