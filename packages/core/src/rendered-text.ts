/** Another host's part of a copy, as it copies it; null for an element
 * that is none. */
export type HostPart = (other: Element) => string | null;

/** CSS's white space, which collapses: a no-break space is none. */
const SPACES = /[ \t\n\r\f]+/g;

/** The text a range holds under `root` as the page renders it, line by
 * line: the text nodes the page shows and selects, white space collapsed
 * as their `white-space` says, a block's text on lines of its own, a
 * `<br>` a break, a field its value, and a host `part` gives text for on
 * lines of its own. */
export function renderedLines(range: Range, root: Node, part: HostPart = () => null): string[] {
  const lines: string[] = [];
  let line = "";
  let block: Element | null = null;
  // Spaces and breaks kept, breaks alone (`pre-line`), or neither.
  let kept: "all" | "breaks" | "none" = "none";
  const flush = (): void => {
    if (kept === "none") {
      const text = line.replace(SPACES, " ").replace(/^ | $/g, "");
      if (text) lines.push(text);
    } else {
      const text =
        kept === "breaks" ? line.replace(/[ \t\r\f]+/g, " ").replace(/ ?\n ?/g, "\n") : line;
      lines.push(...text.replace(/\n$/, "").split("\n"));
    }
    line = "";
  };
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (element: Element): CSSStyleDeclaration => {
    let style = styles.get(element);
    if (!style) styles.set(element, (style = getComputedStyle(element)));
    return style;
  };
  const showing = new Map<Element, boolean>();
  const shows = (element: Element): boolean => {
    let shown = showing.get(element);
    if (shown === undefined) {
      shown =
        element.checkVisibility?.({ visibilityProperty: true }) !== false &&
        styleOf(element).userSelect !== "none";
      showing.set(element, shown);
    }
    return shown;
  };
  const blockOf = (element: Element | null): Element | null => {
    while (element && styleOf(element).display.startsWith("inline"))
      element = element.parentElement;
    return element;
  };
  const walker = root.ownerDocument!.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  /** The node after the current one's subtree. */
  const past = (): Node | null => {
    for (;;) {
      const next = walker.nextSibling();
      if (next || !walker.parentNode()) return next;
    }
  };
  let node = walker.nextNode();
  while (node) {
    // Out of the range, its subtree with it.
    if (!range.intersectsNode(node)) {
      node = past();
      continue;
    }
    const element = node instanceof Element ? node : node.parentElement;
    const stand =
      node instanceof Element
        ? (part(node) ?? (node instanceof HTMLTextAreaElement && shows(node) ? node.value : null))
        : null;
    if (stand !== null) {
      flush();
      block = null;
      kept = "none";
      if (stand) lines.push(stand);
      node = past();
      continue;
    }
    const shown = element && shows(element);
    if (shown && node instanceof Element) {
      if (node.localName === "br") flush();
    } else if (shown) {
      const text = node as Text;
      const start = text === range.startContainer ? range.startOffset : 0;
      const end = text === range.endContainer ? range.endOffset : text.data.length;
      const own = blockOf(element);
      if (own !== block) {
        flush();
        block = own;
        const { whiteSpace } = styleOf(element);
        kept = whiteSpace.startsWith("pre-line")
          ? "breaks"
          : /^(pre|break-spaces)/.test(whiteSpace)
            ? "all"
            : "none";
      }
      line += text.data.slice(start, end);
    }
    node = walker.nextNode();
  }
  flush();
  return lines;
}
