// lib/deeplinks/assetLinks.ts
//
// The Digital Asset Links statement list Android fetches to verify NoDitto's
// App Links (Req 4.9, design decision D10).
//
// Pure: takes the environment rather than reading `process.env`, so the whole
// shape of the served document is testable without a request. The route handler
// at `app/.well-known/assetlinks.json/route.ts` is the only caller.

/** The Android `applicationId` declared in the Flutter manifest. */
export const ANDROID_PACKAGE_NAME = 'app.noditto';

/** The only relation an App Link statement asserts. */
export const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls';

/**
 * A SHA-256 certificate fingerprint: 32 colon-separated hex pairs.
 *
 * Case-insensitive on input and normalised to upper case on output. `keytool`
 * prints upper case and the Play Console shows upper case, but a value pasted
 * from elsewhere may not be, and dropping a correct fingerprint over its casing
 * would be indistinguishable from having configured none at all.
 */
const SHA256_FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

/** Minimal environment shape, mirroring `EnvLike` in the Stripe config module. */
export type EnvLike = Record<string, string | undefined>;

/** One entry of the statement list Android parses. */
export interface AssetLinkStatement {
  relation: readonly string[];
  target: {
    namespace: 'android_app';
    package_name: string;
    sha256_cert_fingerprints: readonly string[];
  };
}

/**
 * Every configured app signing fingerprint, de-duplicated, malformed values dropped.
 *
 * MORE THAN ONE is expected, not exceptional. Play App Signing means the app signing
 * key and the upload key can both be relevant — during a key rotation, or when an
 * internal build signed with the upload key is being tested against the same host — so
 * `ANDROID_APP_SIGNING_SHA256` accepts a comma- or whitespace-separated list.
 *
 * Values that do not look like a SHA-256 fingerprint are DROPPED rather than served,
 * the same discipline `readWebhookSecrets()` applies to `whsec_` values: a statement
 * carrying one bad fingerprint fails verification silently, so a typo must not be able
 * to take a correct sibling down with it.
 */
export function readAndroidSigningFingerprints(env: EnvLike = process.env): string[] {
  const raw = env.ANDROID_APP_SIGNING_SHA256;
  if (!raw?.trim()) return [];

  const fingerprints = raw
    .split(/[\s,]+/)
    .map((value) => value.trim().toUpperCase())
    .filter((value) => SHA256_FINGERPRINT.test(value));

  return [...new Set(fingerprints)];
}

/**
 * The statement list to serve at `/.well-known/assetlinks.json`.
 *
 * One statement per fingerprint rather than one statement carrying all of them.
 * Both forms are legal, but one-per-fingerprint means an operator reading the served
 * document can see exactly which keys are trusted, and a rotation is an entry added
 * and later removed rather than an array edited in place.
 *
 * An EMPTY list when nothing is configured, never a placeholder. An empty list means
 * App Link verification does not complete and the custom scheme carries the load —
 * degraded, but honest about being degraded. A fabricated fingerprint would verify
 * nothing while looking configured, which is the silent failure D10 exists to avoid.
 */
export function buildAssetLinks(env: EnvLike = process.env): AssetLinkStatement[] {
  return readAndroidSigningFingerprints(env).map((fingerprint) => ({
    relation: [HANDLE_ALL_URLS],
    target: {
      namespace: 'android_app',
      package_name: ANDROID_PACKAGE_NAME,
      sha256_cert_fingerprints: [fingerprint],
    },
  }));
}
