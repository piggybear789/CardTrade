import { NextRequest, NextResponse } from 'next/server';
import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { getPaymentMethodStatus } from '@/lib/actions/payments';

export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;
  const result = await getPaymentMethodStatus();
  return NextResponse.json(result);
}
