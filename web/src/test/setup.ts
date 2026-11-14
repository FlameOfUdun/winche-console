import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mantine relies on browser APIs jsdom doesn't implement.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// jsdom doesn't implement scrollIntoView; Mantine's Combobox calls it when
// navigating options (e.g. Select dropdown), so stub it out.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// jsdom has no layout: CodeMirror measures text ranges, so give Range the (empty) measuring methods.
if (typeof Range !== "undefined") {
  const empty = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => empty;
}

// jsdom has no object URLs (the project's thumbnail, downloads).
URL.createObjectURL ??= () => "blob:test";
URL.revokeObjectURL ??= () => {};
