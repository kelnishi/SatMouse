/** Debounce so focus moving between a page and its iframes doesn't flicker */
const SETTLE_MS = 50;

/**
 * Watch whether this page has input focus: its document has focus and is
 * visible. Calls `onChange` once with the current state, then on each change.
 * Returns a function that stops watching. Outside a document (workers, Node)
 * it reports nothing.
 */
export function watchPageFocus(onChange: (focused: boolean) => void): () => void {
  const doc = (globalThis as any).document;
  const win = globalThis as any;
  if (!doc || typeof doc.hasFocus !== "function" || typeof win.addEventListener !== "function") {
    return () => {};
  }

  let last: boolean | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const check = () => {
    timer = null;
    const focused = doc.hasFocus() && doc.visibilityState !== "hidden";
    if (focused === last) return;
    last = focused;
    onChange(focused);
  };
  const schedule = () => {
    if (timer === null) timer = setTimeout(check, SETTLE_MS);
  };

  win.addEventListener("focus", schedule);
  win.addEventListener("blur", schedule);
  doc.addEventListener("visibilitychange", schedule);
  check();

  return () => {
    win.removeEventListener("focus", schedule);
    win.removeEventListener("blur", schedule);
    doc.removeEventListener("visibilitychange", schedule);
    if (timer !== null) clearTimeout(timer);
  };
}
