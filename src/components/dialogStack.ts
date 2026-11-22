import { useEffect, useState, useSyncExternalStore } from "react";

// The open dialogs that take part, in the order they opened: only the last one closes on Escape. Mantine listens for
// Escape on the window, so without this a confirm's Escape also closes the dialog under it.
let stack: number[] = [];
let next = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/**
 * Whether this dialog is the top one while [opened]: pass it as closeOnEscape. Both the dialog underneath and the one
 * opened over it use it.
 */
export function useOnTop(opened: boolean): boolean {
  const [id] = useState(() => ++next);
  useEffect(() => {
    if (!opened) return;
    stack = [...stack, id];
    changed();
    return () => { stack = stack.filter((x) => x !== id); changed(); };
  }, [opened, id]);
  return useSyncExternalStore(subscribe, () => !opened || stack.length === 0 || stack[stack.length - 1] === id);
}
