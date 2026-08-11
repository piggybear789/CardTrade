import { NextRequest, NextResponse } from 'next/server';
import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { beginCardSetup } from '@/lib/actions/payments';

export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;
  const result = await beginCardSetup();
  return NextResponse.json(result);
}
