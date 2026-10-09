// Test setup for the jsdom (component) project.
// Registers jest-dom matchers (e.g. toBeInTheDocument) and cleans up the
// React Testing Library DOM between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom implements no `matchMedia`, and components query it at runtime — the dialog
// asks `(pointer: coarse)` when it opens to decide where focus lands. A stub that
// matches nothing is the desktop, fine-pointer environment these tests assume.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

afterEach(() => {
  cleanup();
});
