import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest is split into three projects so the pure domain/property tests run in a
 * fast Node environment while React component tests run under jsdom.
 *
 * - `domain`  -> Node env; covers tests/unit + tests/property (state machine,
 *                validators, orchestrators, fast-check property tests).
 * - `component` -> jsdom env with React Testing Library + jest-dom matchers;
 *                covers tests/component.
 * - `database` -> Node env; covers tests/database — grants, RLS and policy assertions
 *                read from the LIVE catalog over the Management API. These are the only
 *                tests that touch a network, and the only ones that can see a permission
 *                regression: everything in `domain` runs against fakes, so a grant change
 *                is invisible to it. They SKIP without `SUPABASE_PAT`, so a machine with
 *                no token still gets a green run rather than a red one.
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
      // `server-only` is a marker package whose default entry THROWS on import, so any
      // module guarded by it — the job sweeps, the trade lifecycle store, the repositories
      // — was untestable: importing it failed before a single assertion ran. Next resolves
      // the package's `react-server` condition to an empty module; vitest does not, so it
      // is aliased to that same empty entry here. Nothing is stubbed out but the throw.
      'server-only': path.resolve(rootDir, 'node_modules/server-only/empty.js'),
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
      {
        extends: true,
        test: {
          name: 'database',
          environment: 'node',
          include: ['tests/database/**/*.{test,spec}.ts'],
          // One network round trip per assertion group, against a remote API.
          testTimeout: 30_000,
        },
      },
    ],
  },
});
