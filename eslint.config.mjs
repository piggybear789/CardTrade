// eslint.config.mjs
//
// Flat config, wired to the plugins directly rather than through
// `eslint-config-next`.
//
// WHY NOT `eslint-config-next`. Its root entry (`index.js`) is still an eslintrc-style
// config and loads `@rushstack/eslint-patch/modern-module-resolution`, which THROWS
// under ESLint 9: "Failed to patch ESLint because the calling module was not
// recognized." `eslint-config-next@15.5.21` ships no flat entry point, so there is
// nothing to import instead.
//
// The consequence was worse than a broken command. `next build` swallows that throw as
// a warning and silently skips linting, so the build reported success while nothing was
// checking unused imports, hook rules, or accessibility. `tsc` was doing all the work,
// and `tsc` does not flag an unused import or a conditional hook call.
//
// `@next/eslint-plugin-next` DOES expose a real flat config (`flatConfig.coreWebVitals`)
// and does not pull in the patch, so the fix is to assemble the same set of plugins the
// preset would have given us. Everything referenced here is already a transitive
// dependency of `eslint-config-next`, so this adds no packages.

import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      // Every build output, not two named ones. `distDir` is configurable via
      // `NEXT_BUILD_DIR` (see next.config.ts), and the e2e suite uses
      // `.next-e2e` so it never shares `.next` with a dev server — which lint
      // then walked, reporting 200+ rules-of-hooks errors against minified
      // vendor chunks. `.gitignore` already takes the same wildcard approach.
      '.next*/**',
      // Playwright's own artifacts. The HTML report embeds its bundled viewer,
      // so linting it reports hundreds of rules-of-hooks errors against minified
      // vendor code. Both are gitignored; lint only saw them because it does not
      // read .gitignore. Latent until now — it needed an e2e run followed by a
      // lint in the same tree.
      'playwright-report/**',
      'test-results/**',
      'node_modules/**',
      'next-env.d.ts',
      'supabase/**',
      '.agents/**',
      '.kiro/**',
      '.roo/**',
      '.kilocode/**',
    ],
  },

  // Next.js: the App Router correctness rules plus Core Web Vitals.
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...Object.fromEntries(
        Object.entries(nextPlugin.configs?.['core-web-vitals']?.rules ?? nextPlugin.configs?.recommended?.rules ?? {}).map(
          ([key, value]) => [key.startsWith('@next/next/') ? key : `@next/next/${key}`, value]
        )
      ),
    },
  },

  // React Hooks: rules-of-hooks and exhaustive-deps.
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // The rule that actually earns its place here: `tsc` does not report an unused
      // import, so a removed badge or a deleted helper leaves a dangling import behind
      // and nothing complains. Underscore-prefixed names are the opt-out.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      // Errors are values in this codebase (`ActionResult`, `ValidationResult`), so an
      // un-awaited promise is a silently dropped failure rather than a crash.
      '@typescript-eslint/no-floating-promises': 'off', // needs type info; see note below
      '@typescript-eslint/no-explicit-any': 'warn',

      // The old config downgraded `react-hooks/set-state-in-effect`, `refs` and
      // `purity` to warnings. Those three rules do not exist in
      // eslint-plugin-react-hooks@5 — they are React Compiler rules from v6 — so
      // referencing them made ESLint throw "Could not find rule". Removed rather than
      // renamed: the plugin installed here only ships `rules-of-hooks` and
      // `exhaustive-deps`, both already set by `recommended-latest` above. Their
      // presence is a second sign lint has not actually run for some time.
      //
      // `exhaustive-deps` stays a warning (the plugin's own default) because this
      // codebase has deliberate partial dep arrays in the realtime hooks.
    },
  },

  // Config and script files are Node-side and not part of the app graph.
  {
    files: ['*.mjs', '*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];

// NOTE on `no-floating-promises`: it requires type-aware linting
// (`parserOptions.project`), which roughly triples lint time on this codebase. Left off
// deliberately rather than enabled and ignored.
