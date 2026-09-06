// tests/unit/assetLinks.test.ts
//
// Digital Asset Links statement list (Req 4.9, design decision D10).
//
// A malformed statement fails App Link verification SILENTLY — the app simply keeps
// opening links in the browser, with nothing anywhere saying why. So the exact JSON
// shape is asserted here rather than eyeballed, and so is the empty-list behaviour,
// which is the state the deployment ships in until someone reads the app signing key
// fingerprint out of the Play Console.

import { describe, expect, it } from 'vitest';

import {
  ANDROID_PACKAGE_NAME,
  HANDLE_ALL_URLS,
  buildAssetLinks,
  readAndroidSigningFingerprints,
} from '@/lib/deeplinks/assetLinks';

// SYNTHETIC FIXTURES. A certificate fingerprint is public by design, but there is no
// real one to use: it does not exist until the first Play upload. Any 32 colon-separated
// hex pairs exercise the same code.
const APP_SIGNING = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const UPLOAD = '11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF';

describe('readAndroidSigningFingerprints', () => {
  it('returns nothing when unset or blank', () => {
    expect(readAndroidSigningFingerprints({})).toEqual([]);
    expect(readAndroidSigningFingerprints({ ANDROID_APP_SIGNING_SHA256: '   ' })).toEqual([]);
  });

  it('reads a single fingerprint', () => {
    expect(
      readAndroidSigningFingerprints({ ANDROID_APP_SIGNING_SHA256: APP_SIGNING }),
    ).toEqual([APP_SIGNING]);
  });

  it('reads several from one comma- or whitespace-separated variable', () => {
    // Both keys are legitimately relevant during a Play App Signing rotation.
    expect(
      readAndroidSigningFingerprints({
        ANDROID_APP_SIGNING_SHA256: `${APP_SIGNING},${UPLOAD}`,
      }),
    ).toEqual([APP_SIGNING, UPLOAD]);
    expect(
      readAndroidSigningFingerprints({
        ANDROID_APP_SIGNING_SHA256: `  ${APP_SIGNING}   ${UPLOAD} `,
      }),
    ).toEqual([APP_SIGNING, UPLOAD]);
  });

  it('normalises case rather than dropping a correctly shaped lower-case value', () => {
    expect(
      readAndroidSigningFingerprints({
        ANDROID_APP_SIGNING_SHA256: APP_SIGNING.toLowerCase(),
      }),
    ).toEqual([APP_SIGNING]);
  });

  it('de-duplicates', () => {
    expect(
      readAndroidSigningFingerprints({
        ANDROID_APP_SIGNING_SHA256: `${APP_SIGNING} ${APP_SIGNING.toLowerCase()}`,
      }),
    ).toEqual([APP_SIGNING]);
  });

  it('drops malformed values instead of serving them', () => {
    const tooShort = APP_SIGNING.split(':').slice(0, 20).join(':');
    const notHex = APP_SIGNING.replace('AA', 'ZZ');
    const noColons = APP_SIGNING.replaceAll(':', '');

    for (const bad of [tooShort, notHex, noColons, 'sha256', ':::']) {
      expect(readAndroidSigningFingerprints({ ANDROID_APP_SIGNING_SHA256: bad })).toEqual([]);
    }
  });

  it('drops only the malformed entry, keeping a valid sibling', () => {
    // A typo must not take a correct fingerprint down with it.
    expect(
      readAndroidSigningFingerprints({
        ANDROID_APP_SIGNING_SHA256: `${APP_SIGNING},not-a-fingerprint`,
      }),
    ).toEqual([APP_SIGNING]);
  });
});

describe('buildAssetLinks', () => {
  it('serves an empty statement list when nothing is configured', () => {
    // Verification then does not complete and the custom scheme carries the load.
    // Degraded, but honest — unlike a placeholder fingerprint (D10).
    expect(buildAssetLinks({})).toEqual([]);
  });

  it('emits one well-formed statement naming app.noditto', () => {
    expect(buildAssetLinks({ ANDROID_APP_SIGNING_SHA256: APP_SIGNING })).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'app.noditto',
          sha256_cert_fingerprints: [APP_SIGNING],
        },
      },
    ]);
    expect(ANDROID_PACKAGE_NAME).toBe('app.noditto');
    expect(HANDLE_ALL_URLS).toBe('delegate_permission/common.handle_all_urls');
  });

  it('emits one statement per fingerprint', () => {
    const statements = buildAssetLinks({
      ANDROID_APP_SIGNING_SHA256: `${APP_SIGNING} ${UPLOAD}`,
    });

    expect(statements).toHaveLength(2);
    expect(statements.map((s) => s.target.sha256_cert_fingerprints)).toEqual([
      [APP_SIGNING],
      [UPLOAD],
    ]);
    expect(statements.every((s) => s.target.package_name === 'app.noditto')).toBe(true);
    expect(statements.every((s) => s.target.namespace === 'android_app')).toBe(true);
  });

  it('emits no statement for a dropped fingerprint', () => {
    expect(buildAssetLinks({ ANDROID_APP_SIGNING_SHA256: 'DE:AD:BE:EF' })).toEqual([]);
    expect(
      buildAssetLinks({ ANDROID_APP_SIGNING_SHA256: `bogus,${UPLOAD}` }),
    ).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'app.noditto',
          sha256_cert_fingerprints: [UPLOAD],
        },
      },
    ]);
  });

  it('serialises to the JSON array Android parses', () => {
    const body = JSON.parse(JSON.stringify(buildAssetLinks({ ANDROID_APP_SIGNING_SHA256: APP_SIGNING })));
    expect(Array.isArray(body)).toBe(true);
    expect(Object.keys(body[0])).toEqual(['relation', 'target']);
  });
});
