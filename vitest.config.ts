import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest is split into two projects so the pure domain/property tests run in a
 * fast Node environment while React component tests run under jsdom.
 *
 * - `domain`  -> Node env; covers tests/unit + tests/property (state machine,
 *                validators, orchestrators, fast-check property tests).
 * - `component` -> jsdom env with React Testing Library + jest-dom matchers;
 *                covers tests/component.
 */
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@/domain': path.resolve(rootDir, 'domain'),
      '@/lib': path.resolve(rootDir, 'lib'),
      '@/components': path.resolve(rootDir, 'components'),
      '@': rootDir,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'domain',
          environment: 'node',
          include: ['tests/unit/**/*.{test,spec}.{ts,tsx}', 'tests/property/**/*.{test,spec}.{ts,tsx}'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'component',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./tests/setup.ts'],
          include: ['tests/component/**/*.{test,spec}.{ts,tsx}'],
        },
      },
    ],
  },
});
