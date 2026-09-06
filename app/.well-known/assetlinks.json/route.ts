// app/.well-known/assetlinks.json/route.ts
//
// Digital Asset Links statement for Android App Links (Req 4.9, design decision D10).
//
// THE PATH IS THE CONTRACT. Android fetches the literal
// `https://noditto.app/.well-known/assetlinks.json` over https from the host declared
// in the `android:autoVerify="true"` intent filter (task 4.3, path-scoped to `/t/`,
// `/profile`, `/onboarding` and `/listings/`). Anything else — a redirect, a different
// path, a non-JSON content type — makes verification fail silently.
//
// THE FINGERPRINT MUST BE THE **PLAY APP SIGNING KEY**'s SHA-256, which is what the
// Play Console shows under Setup → App integrity AFTER the first upload. It is NOT the
// upload key's own fingerprint: Play App Signing re-signs the bundle, so the certificate
// on the installed app is the app signing key's. Getting those two the wrong way round is
// the standard reason App Links do not verify, and it looks correctly configured while
// doing nothing.
//
// Set `ANDROID_APP_SIGNING_SHA256` (comma- or whitespace-separated for a rotation).
// Unset, this serves `[]` — see `buildAssetLinks`. A certificate fingerprint is public
// by design; nothing else is read from the environment here.

import { NextResponse } from 'next/server';

import { buildAssetLinks } from '@/lib/deeplinks/assetLinks';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(buildAssetLinks(), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Short and revalidating, deliberately. Android re-fetches this document, and a
      // long immutable cache would keep a stale statement list alive well past a
      // fingerprint change — so a key rotation would leave every install unverified for
      // as long as the cache lived, with the served document looking correct at origin.
      // Five minutes is enough to absorb a verification retry storm and short enough
      // that a corrected fingerprint takes effect while someone is still watching.
      'Cache-Control': 'public, max-age=300, must-revalidate',
    },
  });
}
