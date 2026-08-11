// app/api/mobile/listings/close/route.ts
//
// Mobile endpoint for closing a shopfront listing. Delegates to `closeShopfrontListing`.

import { NextRequest, NextResponse } from 'next/server';

import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { closeShopfrontListing } from '@/lib/actions/listings';

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

  const { itemId } = body as { itemId?: string };

  if (!itemId) {
    return NextResponse.json(
      { ok: false, error: 'VALIDATION', message: 'itemId is required.' },
      { status: 400 },
    );
  }

  const result = await closeShopfrontListing(itemId);
  return NextResponse.json(result);
}
