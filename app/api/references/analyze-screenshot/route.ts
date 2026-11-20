// app/api/references/analyze-screenshot/route.ts
//
// Public, rate-limited endpoint that accepts a dropped profile or DM screenshot
// (Instagram, Facebook Marketplace, eBay, Messenger) and extracts visible-profile
// anomaly metrics + multilingual DM scam-script indicators.

import { NextResponse, type NextRequest } from 'next/server';

import { analyzeUploadedScreenshot } from '@/lib/enrichment/screenshotAnalyzer';
import { rateLimitIdentifier } from '@/lib/rateLimit';
import { referenceCheckLimiter } from '@/lib/rateLimiters';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export async function POST(request: NextRequest) {
  const user = await getCachedAuthUser().catch(() => null);
  const identifier = await rateLimitIdentifier(user?.id ?? null);
  if (!(await referenceCheckLimiter.check(identifier)).allowed) {
    return NextResponse.json(
      { error: 'Too many checks. Please wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Attach a profile or DM screenshot (JPG, PNG, or WebP).' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type.toLowerCase())) {
    return NextResponse.json({ error: 'Only JPG, PNG, or WebP screenshots are supported.' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_SCREENSHOT_BYTES) {
    return NextResponse.json({ error: 'Screenshot must be under 5 MB.' }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await analyzeUploadedScreenshot(bytes);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/references/analyze-screenshot] failed:', error);
    return NextResponse.json(
      { error: 'Could not read that screenshot. Try a clearer JPG or PNG.' },
      { status: 422, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
