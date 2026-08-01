import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:bigtts-test") });
Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn(() => Promise.resolve()) });
Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: vi.fn() });

// jsdom ships no matchMedia. useTheme guards for that, and this stub lets tests drive it.
export interface MediaQueryStub {
  matches: boolean;
  listeners: Set<(event: MediaQueryListEvent) => void>;
  emit: (matches: boolean) => void;
}

export const mediaQueryStubs = new Map<string, MediaQueryStub>();

export function mediaQueryStub(query: string) {
  const existing = mediaQueryStubs.get(query);
  if (existing) return existing;
  const stub: MediaQueryStub = {
    matches: false,
    listeners: new Set(),
    emit(matches: boolean) {
      stub.matches = matches;
      stub.listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
    }
  };
  mediaQueryStubs.set(query, stub);
  return stub;
}

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string) => {
    const stub = mediaQueryStub(query);
    return {
      media: query,
      get matches() { return stub.matches; },
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { stub.listeners.add(listener); },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { stub.listeners.delete(listener); },
      addListener: (listener: (event: MediaQueryListEvent) => void) => { stub.listeners.add(listener); },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => { stub.listeners.delete(listener); },
      dispatchEvent: () => false
    };
  }
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mediaQueryStubs.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});
