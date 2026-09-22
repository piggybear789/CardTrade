// app/og/route.tsx
//
// The default social card, at a STABLE path we own.
//
// WHY A ROUTE HANDLER AND NOT `app/opengraph-image.tsx`. The file convention is
// the obvious choice and it does not work here, for a reason worth writing down
// because it is invisible until you read Next's merge code:
// `mergeMetadata` handles `openGraph` by REPLACING the resolved parent value
// (`newResolvedMetadata.openGraph = resolveOpenGraph(metadata.openGraph, …)`),
// not by deep-merging it. And `resolveStaticMetadata` only sees image files
// belonging to the segment being resolved.
//
// So the moment a route sets `openGraph` at all — which the listing, seller and
// catalog routes must, to carry their own title, description and url — the root
// `opengraph-image` is dropped from that route and there is no file in its own
// segment to replace it. Those routes would have ended up with NO social image,
// which is the bug the card was added to fix. (There is a second, subtler trap in
// the same function: the fallback is skipped when the route's `openGraph` merely
// HAS an `images` key, so `images: undefined` suppresses it just as effectively as
// a real value.)
//
// A named route sidesteps all of it: `DEFAULT_OG_IMAGE` in `lib/seo/site.ts` is a
// literal path, so any route can name it explicitly as its own fallback.
//
// Generated rather than checked in as a PNG: the two brand assets in the tree are
// 128px and 512px SQUARES, and a square asset in a 1.91:1 slot gets letterboxed by
// the client with padding we do not control.

import { ImageResponse } from 'next/og';

import { OG_IMAGE_SIZE } from '@/lib/seo/site';

// Literal hex rather than the `--obsidian` / `--iris` / `--mist` HSL tokens:
// Satori resolves no CSS custom properties, and `globals.css` is not in scope
// here. These are the same values `app/layout.tsx` already hardcodes for
// `themeColor`, for the same reason.
const OBSIDIAN = '#120f15';
const IRIS = '#9e67c1';
const MIST = '#efe7f3';

export async function GET() {
  try {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            background: OBSIDIAN,
            // Satori supports radial gradients, so the iris wash the page
            // background carries is reproduced rather than approximated.
            backgroundImage: `radial-gradient(circle at 12% 0%, ${IRIS}33, transparent 60%)`,
            padding: '72px 80px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: IRIS,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: OBSIDIAN,
                fontSize: 34,
                fontWeight: 700,
              }}
            >
              N
            </div>
            <div
              style={{ color: MIST, fontSize: 38, fontWeight: 600, letterSpacing: -0.5 }}
            >
              NoDitto
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div
              style={{
                color: '#ffffff',
                fontSize: 68,
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: -2,
                maxWidth: 900,
              }}
            >
              Buy, sell and swap trading cards without trusting a stranger.
            </div>
            <div style={{ color: MIST, fontSize: 30, opacity: 0.75, maxWidth: 860 }}>
              Sellers pass a Stripe Identity check. Swaps are backed by collateral
              from both traders.
            </div>
          </div>
        </div>
      ),
      {
        ...OG_IMAGE_SIZE,
        headers: {
          // A static card with no request input, so it is safe to cache hard.
          // Social scrapers refetch aggressively and each miss costs a Satori
          // render plus a PNG encode.
          'Cache-Control': 'public, immutable, no-transform, max-age=31536000',
        },
      },
    );
  } catch {
    // A social card is decoration. Failing the request is correct — a scraper
    // drops the image and shows the text card — but it must never surface as an
    // unhandled error on a page render.
    return new Response('Failed to generate the social card', { status: 500 });
  }
}
