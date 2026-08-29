/** One-time developer warnings for silent deviations (cell-model,
 * table specs): each element warns once per distinct message, however
 * many layout passes run. */
const warned = new WeakMap<Element, Set<string>>();

export function warnOnce(el: Element, message: string): void {
  let messages = warned.get(el);
  if (!messages) warned.set(el, (messages = new Set()));
  if (messages.has(message)) return;
  messages.add(message);
  console.warn(`[monowind] ${message}`, el);
}
