// Test setup for the jsdom (component) project.
// Registers jest-dom matchers (e.g. toBeInTheDocument) and cleans up the
// React Testing Library DOM between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
