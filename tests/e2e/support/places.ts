// tests/e2e/support/places.ts
//
// A deterministic, offline stand-in for Google Places, so a contract that needs a
// RESOLVED address can be agreed in a test.
//
// WHY THIS EXISTS. `domain/fulfilment/terms.ts` refuses an unresolved place — a
// `text:` id — for a delivery address or a meeting point, and it is right to: a parcel
// destination and a place to meet a stranger have to be real locations, not strings
// someone typed. `PlacePicker` can only produce a resolved place by way of Google
// Places Autocomplete.
//
// That left the suite with two bad options and no good one:
//
//   * NO Maps key. `PlacePicker` falls back to a plain text input, listing creation
//     works, and NO CONTRACT CAN EVER BE AGREED. Six cash-sale steps and the entire
//     trade lifecycle — escrow settlement, shipping, receipt, acceptance, release,
//     disputes, fraud — were unreachable behind this one field.
//   * A REAL Maps key. Every listing and terms test then depends on a live Google
//     response. An early attempt hung for the full test timeout clicking a
//     provider-rendered option, and it bills per keystroke.
//
// Intercepting is the third option and strictly better than both: the app's own
// autocomplete → details → PlaceValue path runs exactly as in production, the
// resolved place satisfies the domain rule, and nothing leaves the machine.
//
// WHAT IS AND IS NOT COVERED. The client code under test is real: `searchPlaces`
// builds the request, parses the response, calls Place Details per prediction, and
// assembles the `PlaceValue`. What is faked is Google's answer. So this proves the
// integration and the fulfilment rules; it does NOT prove that Google returns what we
// think for a given query. That difference is only checkable against the live API.

import type { BrowserContext, Page, Route } from '@playwright/test';

/**
 * Any non-empty key will do, because the request never leaves the browser — but
 * `searchPlaces` returns `[]` without one, so the value must be present.
 *
 * Must match the value baked into the build (scripts/e2e/build-for-e2e.mjs) and set
 * for the dev server (playwright.config.ts). It is not a credential.
 */
export const TEST_MAPS_KEY = 'e2e-intercepted-not-a-real-key';

/** Google's autocomplete endpoint, called by `searchPlaces`. */
const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';

/** Google's Place Details endpoint, called once per prediction by `resolvePlace`. */
const DETAILS_PATTERN = 'https://places.googleapis.com/v1/places/*';

/** Everything else Google: the Embed iframe and the Static Maps image. */
const OTHER_GOOGLE_PATTERNS = [
  'https://www.google.com/maps/embed/**',
  'https://maps.googleapis.com/maps/api/staticmap**',
];

/**
 * A suggestion the stub can return.
 *
 * `placeId` must NOT start with `text:` or `legacy:` — those are the prefixes
 * `domain/fulfilment/terms.ts` treats as unresolved, and returning one would defeat
 * the entire point of intercepting.
 */
export interface StubbedPlace {
  placeId: string;
  mainText: string;
  secondaryText: string;
  lat: number;
  lng: number;
  /** ISO 3166-1 alpha-2. Must be a trading region for a contract to be agreed. */
  countryCode: string;
}

/**
 * Australian addresses, because AU is the only `tradingEnabled` region.
 *
 * A GB entry is included on purpose: it is what a region-mismatch test needs, and
 * having it here means such a test does not have to reach for a second mechanism.
 */
export const STUB_PLACES: Record<string, StubbedPlace> = {
  sydney: {
    placeId: 'ChIJ_e2e_sydney_test_place_id',
    mainText: '12 Test Street',
    secondaryText: 'Sydney NSW 2000, Australia',
    lat: -33.8688,
    lng: 151.2093,
    countryCode: 'AU',
  },
  melbourne: {
    placeId: 'ChIJ_e2e_melbourne_test_place_id',
    mainText: '40 Example Road',
    secondaryText: 'Melbourne VIC 3000, Australia',
    lat: -37.8136,
    lng: 144.9631,
    countryCode: 'AU',
  },
  brisbane: {
    placeId: 'ChIJ_e2e_brisbane_test_place_id',
    mainText: 'Queen Street Mall',
    secondaryText: 'Brisbane QLD 4000, Australia',
    lat: -27.4698,
    lng: 153.0251,
    countryCode: 'AU',
  },
  london: {
    placeId: 'ChIJ_e2e_london_test_place_id',
    mainText: '10 Downing Street',
    secondaryText: 'London SW1A 2AA, United Kingdom',
    lat: 51.5034,
    lng: -0.1276,
    countryCode: 'GB',
  },
};

/** The label `PlaceSearch` renders and `PlaceValue.label` ends up holding. */
export function stubbedPlaceLabel(place: StubbedPlace): string {
  return `${place.mainText}, ${place.secondaryText}`;
}

/** Default suggestion order. Sydney first so `.first()` is stable and meaningful. */
const DEFAULT_ORDER: StubbedPlace[] = [
  STUB_PLACES.sydney,
  STUB_PLACES.melbourne,
  STUB_PLACES.brisbane,
];

/**
 * Choose suggestions for a query.
 *
 * Matched on the query text so a spec can steer the result by what it types —
 * "London" to get a GB place for a region-mismatch test, anything else to get the AU
 * default set. Deliberately simple: the point is determinism, not emulating Google's
 * ranking.
 */
function suggestionsFor(input: string): StubbedPlace[] {
  const q = input.trim().toLowerCase();
  const direct = Object.entries(STUB_PLACES).find(([key]) => q.includes(key));
  if (direct) return [direct[1]];
  return DEFAULT_ORDER;
}

/** Google's autocomplete response shape, as `searchPlaces` parses it. */
function autocompleteBody(places: StubbedPlace[]) {
  return {
    suggestions: places.map((place) => ({
      placePrediction: {
        placeId: place.placeId,
        text: { text: stubbedPlaceLabel(place) },
        structuredFormat: {
          mainText: { text: place.mainText },
          secondaryText: { text: place.secondaryText },
        },
        types: ['street_address'],
      },
    })),
  };
}

/** Google's Place Details response shape, as `resolvePlace` parses it. */
function detailsBody(place: StubbedPlace) {
  return {
    location: { latitude: place.lat, longitude: place.lng },
    addressComponents: [
      { longText: place.mainText, shortText: place.mainText, types: ['street_address'] },
      {
        longText: place.countryCode === 'GB' ? 'United Kingdom' : 'Australia',
        shortText: place.countryCode,
        types: ['country', 'political'],
      },
    ],
  };
}

/** Find the stub a details request is asking about. */
function placeById(placeId: string): StubbedPlace | undefined {
  return Object.values(STUB_PLACES).find((p) => p.placeId === placeId);
}

/**
 * Install the Places stub on a context, so every page in it is covered.
 *
 * Context-level rather than page-level because specs open pages through several
 * routes — `test.use({ storageState })`, `browser.newContext()`, and secondary pages
 * inside a single test — and a page-level route silently misses the ones it was not
 * attached to. A missed intercept does not fail loudly; it makes a real network call
 * that returns 403 for the fake key, so the field just yields no suggestions and the
 * test fails somewhere unrelated.
 */
export async function stubGooglePlaces(target: BrowserContext | Page): Promise<void> {
  await target.route(AUTOCOMPLETE_URL, async (route: Route) => {
    let input = '';
    try {
      const body = route.request().postDataJSON() as { input?: string } | null;
      input = body?.input ?? '';
    } catch {
      // A malformed body is not this stub's problem; fall through to the defaults.
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(autocompleteBody(suggestionsFor(input))),
    });
  });

  await target.route(DETAILS_PATTERN, async (route: Route) => {
    const placeId = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    const place = placeById(decodeURIComponent(placeId));
    if (!place) {
      // Unknown id: answer the way Google would rather than hanging, so a spec that
      // somehow asks for a place this stub does not know fails on the assertion it
      // was making instead of on a timeout.
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detailsBody(place)),
    });
  });

  // The Embed iframe and Static Maps image are presentation only. Stubbed so runs stay
  // offline and the console stays free of failed third-party requests that would
  // otherwise be mistaken for application errors.
  for (const pattern of OTHER_GOOGLE_PATTERNS) {
    await target.route(pattern, (route: Route) =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: '' }),
    );
  }
}
