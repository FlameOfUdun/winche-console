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
