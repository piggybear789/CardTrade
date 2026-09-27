// URL / cookie sentinels for browse region. Safe for client components —
// `lib/location/resolveRegion.ts` is `server-only` because it reads headers.

/**
 * `?region=` value meaning "do not scope at all".
 *
 * A real sentinel rather than an omitted param, because omitting the param falls
 * through to the profile / cookie / IP chain — so there would otherwise be no way
 * to ASK for the worldwide catalog once any of those resolved. It is not a region
 * code and never reaches `profiles.region_code`.
 */
export const ALL_REGIONS = 'all';

/**
 * `setBrowseRegion` value meaning "forget my choice and use the inferred region".
 * Never written to the cookie or the URL; it clears the cookie.
 */
export const AUTOMATIC_REGION = 'auto';
