/**
 * monowind play: live HTML editing rendered through <mono-wind>, with
 * the document shareable as a URL. The engine's own MutationObserver
 * relayouts on every innerHTML swap, and the CDN bundle's Tailwind
 * browser compiler picks up new classes the same way — the editor only
 * has to move text around.
 */

const source = document.getElementById("source");
const previewFrame = document.getElementById("preview");
const selectText = document.getElementById("select-text");
const themeSelect = document.getElementById("theme");
const selectTextLabel = document.getElementById("select-text-label");
const themeLabel = document.getElementById("theme-label");
const desktopSlot = document.getElementById("toggle-slot-desktop");
const mobileSlot = document.getElementById("toggle-slot-mobile");
const tidyButton = document.getElementById("tidy");
const copy = document.getElementById("copy");
const divider = document.getElementById("divider");
const editor = document.getElementById("editor");
const highlightLayer = document.querySelector("#highlight code");
const main = document.querySelector("main");

const versionLabel = document.getElementById("version");
if (globalThis.monowind?.version) versionLabel.textContent = `v${globalThis.monowind.version}`;

const SAMPLE = `<div class="mx-auto flex max-h-[96vh] max-w-120 flex-col border border-emerald-400 rule-emerald-400 rule-y">
  <mono-ascii font="small" effect="metal" class="mx-auto max-w-full shrink-0 overflow-clip py-1">monowind</mono-ascii>
  <div class="flex shrink-0 items-center justify-between bg-emerald-400 px-2 py-1 text-black">
    <div class="font-bold">§ MONOWIND DAILY</div>
    <div>issue 001</div>
  </div>
  <div class="overflow-y-auto">
    <div class="columns-1 gap-5 px-3 py-1 rule-neutral-500 rule-dashed rule-x sm:columns-2 lg:columns-3">
      <h1 class="mb-1 text-center font-bold text-yellow-300 [column-span:all]">· A polite theft on Maple Street ·</h1>
      <p>A raccoon walked into the corner bakery at <span class="text-sky-300">6:47 AM</span> this Tuesday, took one long look at the display case, and left without paying for a sourdough loaf clutched under its left arm.</p>
      <p class="mt-1">The proprietor, Mrs. Henshaw, described the incident as <em>unusually polite</em>: the animal reportedly closed the door behind itself and made brief eye contact on the way out. Officer J. Kimball is investigating but concedes the bread was probably day-old anyway. The bakery's security camera, pointed at a wall for reasons Mrs. Henshaw could not remember, offered no leads.</p>
      <p class="mt-1">In related news, the bakery's Wednesday special is a new <code class="text-lime-300">olive-and-rosemary focaccia</code> that Mrs. Henshaw insists no raccoon would touch. She is, she added, prepared to be proven wrong.</p>
      <p class="mt-1">Regulars are asked to keep their eyes open, their bread bags zipped, and their expectations reasonable.</p>
    </div>
  </div>
  <div class="flex shrink-0 items-center justify-between px-2 py-1 text-neutral-400">
    <div class="flex gap-3">
      <button class="cursor-pointer not-focus-visible:text-sky-300 not-focus-visible:hover:text-sky-200">* star</button>
      <button class="cursor-pointer not-focus-visible:text-sky-300 not-focus-visible:hover:text-sky-200">» share</button>
    </div>
    <button class="cursor-pointer not-focus-visible:text-sky-300 not-focus-visible:hover:text-sky-200">¶ edit me</button>
  </div>
</div>`;

// --- Shareable hash: deflate + URL-safe base64 (a "1." prefix marks the
// --- compressed format; "." is not in the base64url alphabet, so plain
// --- legacy hashes stay decodable).

const toBase64url = (bytes) => {
  // Chunked: spreading a whole large document would overflow the call stack.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
const fromBase64url = (text) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

const encodeHash = async (text) => {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return `1.${toBase64url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
};
const decodeHash = async (hash) => {
  if (hash.startsWith("1.")) {
    const stream = new Blob([fromBase64url(hash.slice(2))])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(fromBase64url(hash));
};

// --- Syntax highlighting: a colored copy of the source rendered in the
// --- <pre> behind the transparent textarea. Only `&` and `<` need
// --- escaping; the token spans wrap comments, then tags with their
// --- attribute names and quoted values.

const escapeHtml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

const highlightTag = (open, name, attrs, close) => {
  // One pass, so the replacement never rescans its own injected markup.
  const coloredAttrs = attrs.replace(/("[^"]*"|'[^']*')|([\w-]+)(?==)/g, (match, str, attr) =>
    str !== undefined
      ? `<span class="tok-str">${str}</span>`
      : `<span class="tok-attr">${attr}</span>`,
  );
  return (
    `<span class="tok-punc">${open}</span><span class="tok-tag">${name}</span>` +
    `${coloredAttrs}<span class="tok-punc">${close}</span>`
  );
};

const highlight = (text) => {
  return escapeHtml(text).replace(
    /(&lt;!--[\s\S]*?(?:--&gt;|$))|(&lt;\/?)([\w-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?>)/g,
    (match, comment, open, name, attrs, close) =>
      comment !== undefined
        ? `<span class="tok-com">${comment}</span>`
        : highlightTag(open, name, attrs, close),
  );
};

// --- Preview iframe: a fresh document with its own copy of the CDN
// --- bundle (so <mono-wind> is defined, Tailwind's browser compiler
// --- runs, and the sample gets no inherited styles from the app). The
// --- shell has a <base> pointing at the parent's directory so cdn.js
// --- resolves; content is poked into #root on every render.

const previewShell = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<base href="${new URL("./", location.href).href}">
<script src="cdn.js"></script>
<script src="ascii-cdn.js"></script>
<link rel="stylesheet" href="themes/index.css">
<style>
  html { color-scheme: dark; background: #171717; }
  body { margin: 0; padding: 1rem; color: #e5e5e5; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; }
</style>
</head>
<body><mono-wind id="root"></mono-wind></body>
</html>`;
previewFrame.srcdoc = previewShell;

let previewRoot = null;
const previewReady = new Promise((resolve) => {
  previewFrame.addEventListener(
    "load",
    async () => {
      // customElements.whenDefined resolves after cdn.js has run and
      // registered the element; mono-wind's connectedCallback then wires
      // itself up before we swap innerHTML in.
      await previewFrame.contentWindow.customElements.whenDefined("mono-wind");
      previewRoot = previewFrame.contentDocument.getElementById("root");
      resolve();
    },
    { once: true },
  );
});

// --- Theme switcher: class-scoped themes (all css preloaded in the
// --- iframe; fonts download on first use). State rides the same query
// --- string as the select toggle.

const applyTheme = (theme) => {
  if (!previewRoot) return;
  previewRoot.className = theme ? `theme-${theme}` : "";
};
themeSelect.addEventListener("change", () => {
  applyTheme(themeSelect.value);
  const url = new URL(location.href);
  if (themeSelect.value) url.searchParams.set("theme", themeSelect.value);
  else url.searchParams.delete("theme");
  history.replaceState(null, "", url);
});
{
  const initial = new URLSearchParams(location.search).get("theme") ?? "";
  if ([...themeSelect.options].some((option) => option.value === initial)) {
    themeSelect.value = initial;
  }
  previewReady.then(() => applyTheme(themeSelect.value));
}

const render = () => {
  if (previewRoot) previewRoot.innerHTML = source.value;
  // A trailing guard space keeps the last line's height matched to the
  // textarea's (an empty final line otherwise measures as zero).
  highlightLayer.innerHTML = highlight(source.value) + (source.value.endsWith("\n") ? " " : "");
  autosize();
};

// The outer #editor is the only scroll container (nested textarea
// scroll doesn't rubber-band on macOS); the textarea grows to its own
// content so it never scrolls internally, and the absolute highlight
// layer follows because it inset:0's the same inner wrapper.
const autosize = () => {
  source.style.height = "auto";
  source.style.height = `${source.scrollHeight}px`;
};

let hashTimer;
const onInput = () => {
  render();
  clearTimeout(hashTimer);
  hashTimer = setTimeout(async () => {
    history.replaceState(null, "", `#${await encodeHash(source.value)}`);
  }, 300);
};

// --- Tidy: re-indent through the browser's own parser. Normalizations
// --- (attribute quoting, tag case, entity forms) come with the parser.

const VOID_TAGS = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(" "),
);
const PRESERVED_TAGS = new Set(["pre", "textarea", "script", "style"]);
// HTML phrasing elements — kept inline with their surrounding text so a
// flowing paragraph doesn't get broken up across lines just because it
// contains a <span> or <code>.
const INLINE_TAGS = new Set(
  "a abbr b bdi bdo br cite code data dfn em i kbd mark q s samp small span strong sub sup time u var wbr".split(
    " ",
  ),
);

const escapeAttr = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

const openTag = (node) => {
  const attrs = [...node.attributes]
    .map((a) => {
      // Tidy also sorts Tailwind classes, through the canonical order
      // the sort.js companion bundle exposes.
      const value =
        a.name === "class" ? (globalThis.monowind?.sortClasses(a.value) ?? a.value) : a.value;
      return value === "" ? a.name : `${a.name}="${escapeAttr(value)}"`;
    })
    .join(" ");
  const tag = node.tagName.toLowerCase();
  return attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
};

const isInline = (node) =>
  node.nodeType === Node.TEXT_NODE ||
  node.nodeType === Node.COMMENT_NODE ||
  (node.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.has(node.tagName.toLowerCase()));

const serializeInline = (node) => {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.data);
  if (node.nodeType === Node.COMMENT_NODE) return `<!--${node.data}-->`;
  const tag = node.tagName.toLowerCase();
  const open = openTag(node);
  if (VOID_TAGS.has(tag)) return open;
  let inner = "";
  for (const child of node.childNodes) inner += serializeInline(child);
  return `${open}${inner}</${tag}>`;
};

const tidy = (html) => {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const lines = [];
  const write = (node, depth) => {
    const pad = "  ".repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      // Re-escape: the parser decoded entities, so raw text like an
      // authored `&lt;div&gt;` would otherwise re-parse as markup.
      const text = escapeHtml(node.data.replace(/\s+/g, " ").trim());
      if (text) lines.push(pad + text);
      return;
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      lines.push(pad + `<!--${node.data}-->`);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    const open = openTag(node);
    if (VOID_TAGS.has(tag)) {
      lines.push(pad + open);
      return;
    }
    if (PRESERVED_TAGS.has(tag)) {
      lines.push(pad + open + node.innerHTML + `</${tag}>`);
      return;
    }
    const kids = [...node.childNodes].filter(
      (c) => c.nodeType !== Node.TEXT_NODE || c.data.trim() !== "",
    );
    if (kids.length === 0) {
      lines.push(pad + open + `</${tag}>`);
      return;
    }
    if (kids.every(isInline)) {
      // Phrasing content stays on one line (with the whitespace between
      // its children collapsed to a single space).
      const inner = [...node.childNodes].map(serializeInline).join("").replace(/\s+/g, " ").trim();
      lines.push(pad + open + inner + `</${tag}>`);
      return;
    }
    lines.push(pad + open);
    for (const child of kids) write(child, depth + 1);
    lines.push(pad + `</${tag}>`);
  };
  for (const child of body.childNodes) write(child, 0);
  return lines.join("\n") + "\n";
};

// --- Layout: stacked (the mobile breakpoint) vs. side-by-side. The
// --- theme select and select-mode toggle also move between the header
// --- and a bar beside the preview depending on which, since the
// --- header has no room on a narrow viewport.

const stackedQuery = matchMedia("(max-width: 767.98px)");
const placeHeaderControls = () => {
  const target = stackedQuery.matches ? mobileSlot : desktopSlot;
  if (themeLabel.parentNode !== target) target.appendChild(themeLabel);
  if (selectTextLabel.parentNode !== target) target.appendChild(selectTextLabel);
};
stackedQuery.addEventListener("change", placeHeaderControls);
placeHeaderControls();

// --- Draggable split: the divider sets the editor pane's share of the
// --- main axis (width, or height in the stacked mobile layout).

const setEditorShare = (size, total) => {
  const ratio = Math.min(0.9, Math.max(0.1, size / total));
  editor.style.flex = `0 0 ${(ratio * 100).toFixed(2)}%`;
  divider.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
};

let drag = null;
divider.addEventListener("pointerdown", (event) => {
  const stacked = stackedQuery.matches;
  // Delta-based, from the grab point — snapping the pane edge to the
  // raw cursor would make it jump by wherever on the divider you grabbed.
  drag = {
    stacked,
    start: stacked ? event.clientY : event.clientX,
    size: stacked ? editor.offsetHeight : editor.offsetWidth,
  };
  divider.setPointerCapture(event.pointerId);
});
divider.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const total = drag.stacked ? main.clientHeight : main.clientWidth;
  const size = drag.size + ((drag.stacked ? event.clientY : event.clientX) - drag.start);
  setEditorShare(size, total);
  // Width change → text re-wraps → different content height.
  autosize();
});
// Fires on release AND on a cancelled pointer, so a drag never sticks.
divider.addEventListener("lostpointercapture", () => {
  drag = null;
});

divider.addEventListener("keydown", (event) => {
  const stacked = stackedQuery.matches;
  const step = {
    [stacked ? "ArrowUp" : "ArrowLeft"]: -1,
    [stacked ? "ArrowDown" : "ArrowRight"]: 1,
  }[event.key];
  if (!step) return;
  event.preventDefault();
  const total = stacked ? main.clientHeight : main.clientWidth;
  const size = stacked ? editor.offsetHeight : editor.offsetWidth;
  setEditorShare(size + step * total * 0.05, total);
});

// --- Wiring.

// Select mode lives in the URL query (`?select=text`) — separate from
// the content-carrying hash so a re-shared link picks it up on load.
const applySelectMode = () => {
  const next = selectText.checked ? "text" : "grid";
  // Guard: setAttribute schedules a relayout even when the value is
  // unchanged, and this runs on every load (grid = default).
  if (previewRoot && previewRoot.getAttribute("select") !== next) {
    previewRoot.setAttribute("select", next);
  }
};
const writeSelectQuery = () => {
  const params = new URLSearchParams(location.search);
  if (selectText.checked) params.set("select", "text");
  else params.delete("select");
  const search = params.toString();
  history.replaceState(
    null,
    "",
    `${location.pathname}${search ? `?${search}` : ""}${location.hash}`,
  );
};

const start = async () => {
  let initial = SAMPLE;
  if (location.hash.length > 1) {
    try {
      initial = await decodeHash(location.hash.slice(1));
    } catch {
      // Malformed hash: fall back to the sample.
    }
  }
  if (new URLSearchParams(location.search).get("select") === "text") selectText.checked = true;
  source.value = initial;
  await previewReady;
  applySelectMode();
  render();
};
start();

source.addEventListener("input", onInput);

selectText.addEventListener("change", () => {
  applySelectMode();
  writeSelectQuery();
});

const runTidy = () => {
  const caret = source.selectionStart;
  source.value = tidy(source.value);
  source.setSelectionRange(
    Math.min(caret, source.value.length),
    Math.min(caret, source.value.length),
  );
  onInput();
};
tidyButton.addEventListener("click", runTidy);

// Editor keys. Tab indents (two spaces, the sample's unit) instead of
// leaving the editor, Shift+Tab outdents; a multi-line selection shifts
// every line it touches. execCommand keeps the native undo stack
// (setRangeText doesn't). Escape releases focus so keyboard users can
// still tab past the editor. Cmd/Ctrl+S tidies instead of invoking the
// browser's save dialog — the muscle-memory "format on save".
const INDENT = "  ";
const insertText = (text) => {
  if (!document.execCommand("insertText", false, text)) {
    source.setRangeText(text, source.selectionStart, source.selectionEnd, "end");
    onInput();
  }
};
const shiftIndent = (outdent) => {
  const { value, selectionStart: start, selectionEnd: end } = source;
  if (!outdent && start === end) {
    insertText(INDENT);
    return;
  }
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lastLineBreak = value.indexOf("\n", Math.max(start, end - 1));
  const blockEnd = lastLineBreak === -1 ? value.length : lastLineBreak;
  const shifted = value
    .slice(lineStart, blockEnd)
    .split("\n")
    .map((line) => (outdent ? line.replace(/^ {1,2}/, "") : INDENT + line))
    .join("\n");
  const block = value.slice(lineStart, blockEnd);
  source.setSelectionRange(lineStart, blockEnd);
  insertText(shifted);
  // A selection stays selected (for repeated shifts); a bare caret
  // keeps its place, less what the outdent removed before it.
  if (start === end) {
    const caret = Math.max(lineStart, start - (block.length - shifted.length));
    source.setSelectionRange(caret, caret);
  } else source.setSelectionRange(lineStart, lineStart + shifted.length);
};
source.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    shiftIndent(event.shiftKey);
  } else if (event.key === "Escape") {
    source.blur();
  } else if ((event.metaKey || event.ctrlKey) && event.key === "s") {
    event.preventDefault();
    runTidy();
  }
});

copy.addEventListener("click", async () => {
  history.replaceState(null, "", `#${await encodeHash(source.value)}`);
  try {
    await navigator.clipboard.writeText(location.href);
    copy.textContent = "copied!";
  } catch {
    // Clipboard unavailable (file://, denied permission) — the hash is
    // still in the address bar to copy by hand.
    copy.textContent = "failed";
  }
  setTimeout(() => {
    copy.textContent = "copy link";
  }, 1200);
});
