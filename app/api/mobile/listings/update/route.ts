// app/api/mobile/listings/update/route.ts
//
// Mobile endpoint for listing updates. Delegates to `updateItem`.

import { NextRequest, NextResponse } from 'next/server';

import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { updateItem } from '@/lib/actions/listings';

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
  const itemId = String(input.itemId ?? '');

  if (!itemId) {
    return NextResponse.json(
      { ok: false, error: 'VALIDATION', message: 'itemId is required.' },
      { status: 400 },
    );
  }

  const result = await updateItem(itemId, {
    title: String(input.title ?? ''),
    description: String(input.description ?? ''),
    category: String(input.category ?? ''),
    condition: String(input.condition ?? ''),
    fmvCents: Number(input.fmvCents ?? 0),
    images: Array.isArray(input.images) ? input.images : [],
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
