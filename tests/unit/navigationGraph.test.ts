// tests/unit/navigationGraph.test.ts
//
// Navigation integrity guard. A fast, browser-free audit that builds the app's
// link graph from source and asserts two properties that keep the product free
// of dead ends and 404s:
//
//   1. Link resolution — every internal navigation target (Link href, redirect,
//      router.push/replace) resolves to a real App Router route. Catches typos
//      and links to routes that were renamed or removed.
//   2. Reachability — every navigable route is linked from somewhere, so no page
//      becomes an orphan reachable only by typing the URL. A small allowlist
//      covers legitimate entry points (home, auth, share-link, OAuth, webhook).
//
// This is static analysis, not E2E: it proves the wiring, not runtime behaviour
// behind data/state. It runs in the Node `domain` project (filesystem only).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appDir = path.join(repoRoot, 'app');
const scanDirs = [appDir, path.join(repoRoot, 'components'), path.join(repoRoot, 'lib')];

/** Routes that need not be linked from within the app (external entry points). */
const REACHABILITY_ALLOWLIST = new Set<string>([
  '/', // home / marketing entry
  '/sign-in', // auth entry (also linked, but guaranteed reachable)
  '/sign-up',
  '/auth/callback', // OAuth provider redirect target
  '/api/webhooks/stripe', // server-to-server webhook, never navigated
]);

/** Recursively collect files under `dir` whose extension is in `exts`. */
function walk(dir: string, exts: string[], acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, exts, acc);
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Convert an `app/**` page/route file path into its App Router URL pattern.
 * Drops route groups `(auth)`; keeps dynamic `[id]` / catch-all `[...x]`.
 */
function fileToRoutePattern(file: string): string {
  const rel = path.relative(appDir, path.dirname(file));
  if (rel === '' || rel === '.') return '/';
  const segments = rel
    .split(path.sep)
    .filter((seg) => !/^\(.*\)$/.test(seg)); // drop route groups
  const route = '/' + segments.join('/');
  return route === '/' ? '/' : route.replace(/\/$/, '');
}

/** Build a matcher regex for a route pattern (dynamic segments match one path part). */
function routeToRegex(route: string): RegExp {
  const body = route
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      if (/^\[\.\.\..+\]$/.test(seg)) return '.+'; // catch-all
      if (/^\[.+\]$/.test(seg)) return '[^/]+'; // dynamic
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // literal
    })
    .join('/');
  return new RegExp(`^/${body}$`);
}

/** Number of static (non-dynamic) segments — used to pick the most specific route. */
function specificity(route: string): number {
  return route
    .split('/')
    .filter(Boolean)
    .filter((seg) => !seg.startsWith('[')).length;
}

interface FoundLink {
  target: string; // normalized, e.g. /listings/:id
  raw: string; // as written in source
  file: string; // repo-relative source file
}

// Anchors a string/template literal that starts with "/" to a navigation site:
// a Link href (attribute or object property), a redirect(), or router push/replace.
const NAV_PREFIX =
  '(?:href\\s*=\\s*\\{?|href\\s*:\\s*|redirect\\(\\s*|(?:router|Router)\\.(?:push|replace)\\(\\s*)';

// Two patterns rather than one, because the delimiter decides what may appear
// INSIDE the target.
//
// A single regex with `(['"`])(\/[^'"`]*)\1` looks tidier but silently misses any
// template literal containing a quote — and interpolations routinely do, e.g.
//   href={`/trades/new?counterpartItemId=${x?.id ?? ''}&counter=${y}`}
// The class stops at that `'`, the closing backtick then fails to match, and the
// link vanishes from the graph. That made `/trades/new` look like an orphan route
// when the trade proposal inbox links to it directly.
const QUOTED_LINK_RE = new RegExp(`${NAV_PREFIX}(['"])(\\/[^'"]*)\\1`, 'g');
const TEMPLATE_LINK_RE = new RegExp(`${NAV_PREFIX}\`(\\/[^\`]*)\``, 'g');

/** Normalize a raw target: strip query/hash and collapse `${...}` into a wildcard. */
function normalizeTarget(raw: string): string {
  const withoutQuery = raw.split(/[?#]/)[0];
  return withoutQuery.replace(/\$\{[^}]*\}/g, ':dyn');
}

/** Extract every internal navigation target from the scanned source files. */
function collectLinks(): FoundLink[] {
  const links: FoundLink[] = [];
  for (const dir of scanDirs) {
    for (const file of walk(dir, ['.ts', '.tsx'])) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const source = readFileSync(file, 'utf8');
      // Quoted targets capture the path in group 2 (group 1 is the quote char);
      // template targets capture it in group 1, since the delimiter is fixed.
      for (const [re, group] of [
        [QUOTED_LINK_RE, 2],
        [TEMPLATE_LINK_RE, 1],
      ] as const) {
        for (const match of source.matchAll(re)) {
          const raw = match[group];
          links.push({
            target: normalizeTarget(raw),
            raw,
            file: path.relative(repoRoot, file),
          });
        }
      }
    }
  }
  return links;
}

const routes = walk(appDir, ['page.tsx', 'route.ts']).map(fileToRoutePattern);
const uniqueRoutes = [...new Set(routes)];
// Most specific first, so a concrete /listings/new wins over dynamic /listings/[id].
const rankedRoutes = [...uniqueRoutes].sort((a, b) => specificity(b) - specificity(a));
const links = collectLinks();

/** The best (most specific) route a normalized target resolves to, or null. */
function resolveRoute(target: string): string | null {
  // A `:dyn` placeholder occupies a full path segment, so it matches `[^/]+`.
  const probe = target.replace(/:dyn/g, 'x');
  for (const route of rankedRoutes) {
    if (routeToRegex(route).test(probe)) return route;
  }
  return null;
}

describe('navigation graph', () => {
  it('discovers the expected route table', () => {
    // Sanity: the scanner found the app. Guards against a silently-empty audit.
    expect(uniqueRoutes.length).toBeGreaterThan(20);
    expect(uniqueRoutes).toContain('/listings/[id]');
    expect(links.length).toBeGreaterThan(20);
  });

  it('every internal link resolves to a real route (no broken links / 404s)', () => {
    const broken = links
      .filter((link) => resolveRoute(link.target) === null)
      .map((link) => `${link.raw}  (in ${link.file})`);

    expect(broken, `Unresolved internal links:\n${broken.join('\n')}`).toEqual([]);
  });

  it('has no orphan routes (every navigable page is linked)', () => {
    const reached = new Set<string>();
    for (const link of links) {
      const route = resolveRoute(link.target);
      if (route) reached.add(route);
    }

    const orphans = uniqueRoutes.filter(
      (route) =>
        !reached.has(route) &&
        !REACHABILITY_ALLOWLIST.has(route) &&
        !route.startsWith('/api/'),
    );

    expect(orphans, `Orphan routes (reachable only by typing the URL):\n${orphans.join('\n')}`).toEqual(
      [],
    );
  });
});
