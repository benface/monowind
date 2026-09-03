/** One-time developer warnings for silent deviations (cell-model,
 * table specs): each element warns once per distinct message, however
 * many layout passes run. */
const warned = new WeakMap<Element, Set<string>>();

export function warnOnce(el: Element, message: string): void {
  let messages = warned.get(el);
  if (!messages) warned.set(el, (messages = new Set()));
  if (messages.has(message)) return;
  messages.add(message);
  console.warn(`[monowind] ${message}`, warnSubject(el));
}

/** The element for a warning: the reference itself in a browser (an
 * inspectable link in DevTools), a one-line description under Node
 * (tests), whose console would print the whole object graph. */
export function warnSubject(el: Element): Element | string {
  const node = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions
    ?.node;
  if (!node) return el;
  const id = el.id ? `#${el.id}` : "";
  const classes = el.classList.length ? `.${Array.from(el.classList).join(".")}` : "";
  return `<${el.tagName.toLowerCase()}${id}${classes}>`;
}
