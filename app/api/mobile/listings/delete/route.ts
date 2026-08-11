// app/api/mobile/listings/delete/route.ts
//
// Mobile endpoint for listing deletion. Delegates to `deleteItem`.

import { NextRequest, NextResponse } from 'next/server';

import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { deleteItem } from '@/lib/actions/listings';

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

  const result = await deleteItem(itemId);
  return NextResponse.json(result);
}
