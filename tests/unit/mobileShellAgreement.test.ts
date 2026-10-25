// Feature: mobile-visual-parity — Property 23, and the shell half of Property 22.
//
// This is the one property in the feature that can compare two implementations of
// one rule DIRECTLY. `flutter_app/lib/router/hub_set.dart` is a hand port of
// `components/layout/marketplace-nav-config.ts`: the same five destinations, the
// same section ownership, the same guest targeting. The web side is IMPORTED and
// CALLED rather than parsed, because parsing a module you could execute is a
// second implementation of it; the Dart side is parsed, because Node cannot run it.
//
// ONE SLOT DIFFERS ON PURPOSE. The web's second hub is References; the app has no
// References screen yet, so its second hub is still the Contracts sheet. Both sides of
// that gap are named once, below (`WEB_ONLY_HUBS`, `DART_ONLY_HUBS`), and asserted to be
// exactly that, so every other disagreement still fails here.
//
// WHAT THIS FILE CAN AND CANNOT SEE, stated plainly rather than left implicit:
//
//  - It compares the OWNERSHIP TABLE — which hub claims which section — by
//    evaluating the Dart hubs' declared `ownedSections` through the web's own
//    `isMarketplaceSectionActive` and comparing the answer to the web hub's own
//    `isActive`. A hub claiming the wrong section fails here.
//  - It compares the SPECIAL-CASE SET of the Dart section predicate against the
//    branches the web helper declares, parsed out of the web source so the
//    expected set is not a hand-maintained list.
//  - It does NOT execute `isHubSectionActive` itself. That predicate's behaviour
//    over query strings, fragments, trailing slashes and unknown routes is
//    asserted in `flutter_app/test/router/hub_set_test.dart`, where it can be run.
//
// Validates: Requirements 4.5, 4.6, 4.12, 4.15, 4.16; Properties 22, 23.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CONTRACT_LINKS,
  MARKETPLACE_NAV_GROUPS,
  MOBILE_HUBS,
  isMarketplaceSectionActive,
  mobileHubDestination,
  type MobileHub as WebMobileHub,
} from '../../components/layout/marketplace-nav-config';
import {
  dartGoRoutePaths,
  dartHubSectionSpecialCases,
  dartMobileHubs,
  dartRouteConstants,
  type DartMobileHub,
} from '../../scripts/lib/mobileContract';

const NAV_CONFIG = path.join(process.cwd(), 'components', 'layout', 'marketplace-nav-config.ts');

/**
 * Dart hub id → web hub id, for the hubs both bars have.
 *
 * One entry differs: the web calls the messages hub `messages` and labels it
 * `Inbox`; the Dart enum is named for the label. Everything else is spelled the
 * same, so the map is a translation of one identifier and not a licence to rename.
 */
const HUB_ID_TO_WEB: Record<string, string> = {
  browse: 'browse',
  sell: 'sell',
  inbox: 'messages',
  account: 'account',
};

/**
 * THE ONE DELIBERATE DISAGREEMENT, until the app has a References screen.
 *
 * The web's second hub is References. The app has nothing to point a References hub
 * at, so its second hub is still Contracts, the sheet of Purchases, Sales and Trades.
 * The web files those three under Account now: they are rows on its Account screen,
 * and its Account hub owns their sections, contract rooms included.
 *
 * Closing the gap means a References hub in `hub_set.dart` and both lists emptied —
 * never another entry added to either.
 */
const WEB_ONLY_HUBS: readonly string[] = ['references'];
const DART_ONLY_HUBS: readonly string[] = ['contracts'];

/** The web hub that owns the sections a Dart-only hub claims. */
const WEB_OWNER_OF_DART_ONLY: Record<string, string> = { contracts: 'account' };

/** The web hub whose sections a Dart hub's sections are, across the gap above. */
function webOwnerFor(dartId: string): string | undefined {
  return HUB_ID_TO_WEB[dartId] ?? WEB_OWNER_OF_DART_ONLY[dartId];
}

/**
 * The Flutter route table states two paths differently from the web's.
 *
 * Both are structural, not stylistic:
 *  - the web catalog IS the site root, and a Flutter router needs a named route,
 *    so `/home` and `/` are the same screen;
 *  - `go_router` matches static segments before parameters, so the edit route is
 *    `/listings/edit/:id` rather than the web's `/listings/:id/edit`.
 *
 * Comparison therefore translates the Dart path into the web's spelling first. A
 * comparison that skipped this step would report the whole catalog and the whole
 * edit flow as drift, which is how a real disagreement gets lost in noise.
 */
function webPathFor(dartPath: string): string {
  if (dartPath === '/home') return '/';
  if (dartPath.startsWith('/home/')) return dartPath.slice('/home'.length);
  const edit = /^\/listings\/edit\/([^/]+)$/.exec(dartPath);
  if (edit) return `/listings/${edit[1]}/edit`;
  return dartPath;
}

/** The same translation for a section root a hub claims. */
function webSectionFor(dartSection: string): string {
  return dartSection === '/home' ? '/' : dartSection;
}

/** Hubs whose declared sections claim `dartPath`, under the WEB's section rule. */
function dartOwningHubs(dartPath: string, hubs: readonly DartMobileHub[]): DartMobileHub[] {
  const webPath = webPathFor(dartPath);
  return hubs.filter((hub) =>
    hub.ownedSections.some((section) => isMarketplaceSectionActive(webPath, webSectionFor(section))),
  );
}

/** Hubs the web itself marks current for `webPath`. */
function webActiveHubs(webPath: string): WebMobileHub[] {
  return MOBILE_HUBS.filter((hub) => hub.isActive(webPath));
}

/**
 * Every `href === '…'` branch `isMarketplaceSectionActive` declares.
 *
 * Parsed rather than transcribed: the expected set is the whole subject of the
 * assertion, and a transcribed copy drifts as silently as the code would.
 */
function webSectionSpecialCases(): string[] {
  const source = readFileSync(NAV_CONFIG, 'utf8');
  const opening = source.indexOf('export function isMarketplaceSectionActive');
  if (opening === -1) throw new Error('marketplace-nav-config.ts declares no isMarketplaceSectionActive');
  const closing = source.indexOf('\n}', opening);
  if (closing === -1) throw new Error('isMarketplaceSectionActive has no closing brace');
  const body = source.slice(opening, closing);
  const cases = [...body.matchAll(/href\s*===\s*'([^']+)'/g)].map((match) => match[1]);
  if (cases.length === 0) throw new Error('isMarketplaceSectionActive special-cases no href');
  return [...new Set(cases)];
}

/**
 * Concrete routes, from the Flutter route table, with every `:param` filled in.
 *
 * Bare PATHS only — no query string and no fragment. `usePathname()` never hands
 * the web helper either of those, so the web side has no defined behaviour for
 * them and comparing against it would be comparing against an accident. The Dart
 * predicate does strip both, and that is asserted Dart-side.
 */
function concreteRoutes(id: string): string[] {
  return dartGoRoutePaths()
    .map((route) => route.path.replace(/:[A-Za-z]+/g, id))
    // A parameter is never empty in a matched route, and `/listings/` is not a
    // route either side serves.
    .filter((route) => !route.includes('//'));
}

const temporaryDirectories: string[] = [];

/** Writes a throwaway Dart pair so a parser's failure path can be asserted. */
function parseFixture(router: string, hub: string): () => unknown {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'noditto-hub-set-'));
  temporaryDirectories.push(directory);
  const routerFile = path.join(directory, 'router.dart');
  const hubFile = path.join(directory, 'hub_set.dart');
  writeFileSync(routerFile, router, 'utf8');
  writeFileSync(hubFile, hub, 'utf8');
  return () => dartMobileHubs(hubFile, routerFile);
}

const VALID_ROUTER = `
abstract final class AppRoutes {
  static const home = '/home';
  static const sellers = '/sellers';
}
`;

const VALID_HUBS = `
const List<MobileHub> kMobileHubs = <MobileHub>[
  MobileHub(
    id: MobileHubId.browse,
    label: 'Browse',
    icon: Icons.grid_view_outlined,
    kind: MobileHubKind.link,
    requiresAuth: false,
    sheetDescription: 'Commas, inside a label, are not separators.',
    destinations: <HubDestination>[
      HubDestination(path: AppRoutes.home, label: 'Browse All', icon: Icons.grid_view_outlined),
    ],
    ownedSections: <String>[AppRoutes.home, AppRoutes.sellers],
  ),
];
`;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe('Hub_Set parsers read the Dart shell without guessing', () => {
  it('reads every AppRoutes path constant and every GoRoute path', () => {
    const constants = dartRouteConstants();
    const routes = dartGoRoutePaths();

    // P12's rule applied to two more parsers: an empty set is a failure, because
    // every assertion below it would then pass over nothing.
    expect(constants.length).toBeGreaterThan(0);
    expect(routes.length).toBeGreaterThan(0);
    for (const entry of constants) expect(entry.path.startsWith('/')).toBe(true);
    expect(routes.map((route) => route.path)).toContain('/home');
  });

  it('reads a hub table whose labels survive a comma inside a string', () => {
    const hubs = parseFixture(VALID_ROUTER, VALID_HUBS)() as DartMobileHub[];
    expect(hubs).toHaveLength(1);
    expect(hubs[0].label).toBe('Browse');
    expect(hubs[0].sheetDescription).toBe('Commas, inside a label, are not separators.');
    expect(hubs[0].destinations).toEqual([{ path: '/home', label: 'Browse All' }]);
    expect(hubs[0].ownedSections).toEqual(['/home', '/sellers']);
  });

  it('throws rather than returning a partial hub table', () => {
    expect(parseFixture(VALID_ROUTER, '// no hub table here\n')).toThrow(/kMobileHubs/);
    expect(parseFixture(VALID_ROUTER, VALID_HUBS.replace('id: MobileHubId.browse,', ''))).toThrow(/MobileHubId/);
    expect(parseFixture(VALID_ROUTER, VALID_HUBS.replace('AppRoutes.sellers', 'AppRoutes.nowhere'))).toThrow(
      /cannot resolve route reference/,
    );
    expect(parseFixture(VALID_ROUTER, VALID_HUBS.replace("requiresAuth: false,", 'requiresAuth: maybe,'))).toThrow(
      /requiresAuth/,
    );
    expect(parseFixture(VALID_ROUTER.replace("'/home'", 'homePath'), VALID_HUBS)).toThrow(/not a literal path/);
  });
});

describe('Property 23: the route-to-hub mapping agrees with the web', () => {
  const hubs = dartMobileHubs();

  it('differs only in the second slot: References on the web, Contracts in the app', () => {
    expect(hubs).toHaveLength(MOBILE_HUBS.length);

    const shared = new Set(Object.values(HUB_ID_TO_WEB));
    expect(hubs.filter((dart) => HUB_ID_TO_WEB[dart.id] === undefined).map((dart) => dart.id)).toEqual(
      DART_ONLY_HUBS,
    );
    expect(MOBILE_HUBS.filter((web) => !shared.has(web.id)).map((web) => web.id)).toEqual(WEB_ONLY_HUBS);
    // The same slot on both sides, which is what keeps the four shared hubs in place.
    expect(hubs.findIndex((dart) => dart.id === DART_ONLY_HUBS[0])).toBe(
      MOBILE_HUBS.findIndex((web) => web.id === WEB_ONLY_HUBS[0]),
    );
  });

  it('declares the same shared hubs, in order, with the same kinds and audiences', () => {
    const dartShared = hubs.filter((dart) => HUB_ID_TO_WEB[dart.id] !== undefined);
    const webShared = MOBILE_HUBS.filter((web) => !WEB_ONLY_HUBS.includes(web.id));
    expect(dartShared).toHaveLength(webShared.length);

    dartShared.forEach((dart, index) => {
      const web = webShared[index];
      expect(HUB_ID_TO_WEB[dart.id]).toBe(web.id);
      expect(dart.label).toBe(web.label);
      // Every web hub is a single tap.
      expect(dart.kind).toBe('link');
      // Which of the five a signed-out visitor can use is one product decision,
      // and a client that disagreed would either gate the catalog or bounce a
      // guest off a hub the other client lets them use (Req 4.11).
      expect(dart.requiresAuth).toBe(web.requiresAuth);
    });
  });

  it("lists the web's contract rows in its Contracts sheet, minus the private-deal entry", () => {
    const sheets = hubs.filter((hub) => hub.kind === 'sheet');
    // The web has no sheet hub left, so the app's only sheet is the Dart-only one.
    expect(sheets.map((hub) => hub.id)).toEqual(DART_ONLY_HUBS);
    const contractsGroup = MARKETPLACE_NAV_GROUPS.find((group) => group.links === CONTRACT_LINKS);
    if (!contractsGroup) throw new Error('CONTRACT_LINKS is not a group of MARKETPLACE_NAV_GROUPS');

    for (const dart of sheets) {
      // The rows the web's Account screen lists, which are the rail's Contracts group.
      expect(dart.destinations.map((row) => webPathFor(row.path))).toEqual(CONTRACT_LINKS.map((link) => link.href));
      expect(dart.destinations.map((row) => row.label)).toEqual(CONTRACT_LINKS.map((link) => link.label));
      expect(dart.sheetTitle).toBe(contractsGroup.label);
      // Req 4.6 omits the web's private-deal entry rather than presenting it
      // inert, so the sheet's supporting line must not promise it either.
      expect(dart.sheetDescription?.toLowerCase()).not.toContain('private deal');
    }
  });

  it('sends a guest to the same post-sign-in destination the web would', () => {
    for (const dart of hubs) {
      const webId = HUB_ID_TO_WEB[dart.id];
      // The Dart-only sheet carries its first row, the web's first contract row.
      const expected = webId
        ? mobileHubDestination(MOBILE_HUBS.find((hub) => hub.id === webId)!)
        : CONTRACT_LINKS[0].href;
      expect(webPathFor(dart.destinations[0].path)).toBe(expected);
    }
  });

  it('special-cases the same sections the web helper does', () => {
    // The web helper carries four branches. Three are hub concerns and the Dart
    // port has all three. The fourth, `/admin`, exists to stop the two STAFF RAIL
    // links lighting up together; the Account hub does not use it — the web hub
    // tests `pathname.startsWith('/admin')` directly — so a Dart port of it would
    // be a rule with no caller.
    const web = webSectionSpecialCases();
    expect(web).toEqual(expect.arrayContaining(['/', '/admin', '/listings/new', '/listings/mine']));

    const hubRelevant = web.filter((href) => href !== '/admin').map((href) => (href === '/' ? '/home' : href));
    expect([...dartHubSectionSpecialCases()].sort()).toEqual([...hubRelevant].sort());
  });

  it('claims the same sections the web hub claims, for every route in the table', () => {
    fc.assert(
      fc.property(
        // A route parameter is an opaque identifier. It is generated rather than
        // fixed because the boundaries this property exists to catch are where a
        // segment happens to read like a static route — `/listings/new`,
        // `/listings/edit` and `/listings/mine` are all reachable this way.
        fc.oneof(
          fc.stringMatching(/^[a-z0-9-]{1,12}$/),
          fc.constantFrom('new', 'mine', 'edit', 'abc123', 'UPPER', '00000000-0000-4000-8000-000000000000'),
        ),
        (id) => {
          for (const route of concreteRoutes(id)) {
            const webPath = webPathFor(route);
            const dartOwners = dartOwningHubs(route, hubs);
            const webOwners = webActiveHubs(webPath);

            // At most one, on both sides. Two hubs current is the failure the
            // web's special cases exist to prevent.
            expect(dartOwners.length, `${route}: ${dartOwners.map((hub) => hub.id).join()}`).toBeLessThanOrEqual(1);
            expect(webOwners.length, `${webPath}: ${webOwners.map((hub) => hub.id).join()}`).toBeLessThanOrEqual(1);

            // Across the deliberate gap: what the app's Contracts owns, the web's
            // Account owns.
            const dartId = dartOwners[0] ? webOwnerFor(dartOwners[0].id) : null;
            expect(dartId, `${route} → web ${webPath}`).toBe(webOwners[0]?.id ?? null);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the every-route corpus is not empty and covers all five hubs', () => {
    // Without this the property above could pass by comparing null to null.
    const covered = new Set(
      concreteRoutes('abc')
        .flatMap((route) => dartOwningHubs(route, hubs))
        .map((hub) => hub.id),
    );
    expect([...covered].sort()).toEqual(['account', 'browse', 'contracts', 'inbox', 'sell']);
  });
});

describe('Property 22 (shell half): an unowned route marks no destination current', () => {
  const hubs = dartMobileHubs();
  const claimedFirstSegments = new Set([
    'home',
    'sellers',
    'purchases',
    'sales',
    'trades',
    'listings',
    'messages',
    'profile',
    'notifications',
    'saved',
    'admin',
    // Claimed by the web's References hub. The app serves no route there, so the
    // generator could otherwise produce one the web owns and the app does not.
    'references',
  ]);

  it('leaves every hub not-current for a route no hub owns', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/), { minLength: 1, maxLength: 3 })
          .filter((segments) => !claimedFirstSegments.has(segments[0])),
        (segments) => {
          const route = `/${segments.join('/')}`;
          expect(dartOwningHubs(route, hubs), route).toHaveLength(0);
          expect(webActiveHubs(route), route).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('names the routes the Flutter app serves that no hub owns', () => {
    // Auth screens sit outside the shell entirely, so "no hub current" is the
    // correct answer for them rather than an oversight. Naming them here is what
    // stops a later hub quietly claiming one.
    //
    // `/t/{token}` joins them for the same reason and not by omission: a private
    // invite is reached from a link and never from the shell, the web hub set
    // deliberately omits its entry rather than showing it inert, and marking a
    // hub current for it would tell the member they are somewhere they cannot
    // navigate back to.
    const unowned = concreteRoutes('abc').filter((route) => dartOwningHubs(route, hubs).length === 0);
    expect(unowned.sort()).toEqual(['/auth/forgot-password', '/auth/sign-in', '/auth/sign-up', '/t/abc']);
  });
});
