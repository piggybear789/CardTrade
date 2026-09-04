// app/api/mobile/listings/create/route.ts
//
// Mobile endpoint for listing creation. Delegates to `createItem` in
// `lib/actions/listings.ts`, which evaluates the Identity_Gate, the seller
// identity disclosure, validates the submission, and inserts via the
// cookie-bound client. No business logic lives here.
//
// Requirement 1.1: the Flutter app calls this instead of writing `items` directly.

import { NextRequest, NextResponse } from 'next/server';

import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { createItem } from '@/lib/actions/listings';
import type { ImageDim } from '@/lib/images/dimensions';

export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_BODY', message: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const input = body as Record<string, unknown>;

  // Images arrive as already-uploaded Storage paths from the mobile client.
  // `createItem` handles both raw uploads and path strings; paths are the mobile case.
  const result = await createItem({
    title: typeof input.title === 'string' ? input.title : undefined,
    description: String(input.description ?? ''),
    category: String(input.category ?? ''),
    condition: String(input.condition ?? ''),
    fmvCents: Number(input.fmvCents ?? 0),
    images: Array.isArray(input.images) ? input.images : [],
    // Optional, and index-aligned with `images`. The mobile client uploads
    // straight to Storage too, so it is the only party that sees those bytes —
    // same position the browser uploader is in. Omitting it is fine: the tiles
    // fall back to square. Sanitized inside `createItem`, so nothing is trusted
    // here beyond the array shape.
    imageDims: Array.isArray(input.imageDims)
      ? (input.imageDims as (ImageDim | null)[])
      : undefined,
    listingKind: input.listingKind === 'SHOPFRONT' ? 'SHOPFRONT' : 'SINGLE',
    location: input.location
      ? {
          label: String((input.location as Record<string, unknown>).label ?? ''),
          placeId: String((input.location as Record<string, unknown>).placeId ?? ''),
          lat: Number((input.location as Record<string, unknown>).lat ?? 0),
          lng: Number((input.location as Record<string, unknown>).lng ?? 0),
          precision: ((input.location as Record<string, unknown>).precision as 'suburb' | 'exact') || 'suburb',
          countryCode: ((input.location as Record<string, unknown>).countryCode as string) || null,
        }
      : null,
  });

  return NextResponse.json(result);
}
