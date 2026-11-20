import { NextRequest, NextResponse } from 'next/server';

import {
  runAiTraderCheck,
  type AttachedScreenshot,
  type ChatHistoryTurn,
} from '@/lib/enrichment/aiTraderCheck';
import { rateLimitIdentifier } from '@/lib/rateLimit';
import { referenceCheckLimiter } from '@/lib/rateLimiters';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

// app/api/references/ai-check/route.ts
//
// Chat-first multimodal trader check endpoint.
// Accepts multipart/form-data (message + up to 3 screenshots + chat history) or JSON,
// runs our cheap AI model + live eBay/NoDitto/forensics/OSINT checks in one round-trip.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function parseHistory(raw: unknown): ChatHistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatHistoryTurn[] = [];
  for (const item of raw.slice(-6)) {
    if (
      item &&
      typeof item === 'object' &&
      ('role' in item) &&
      (item.role === 'user' || item.role === 'assistant') &&
      'text' in item &&
      typeof item.text === 'string'
    ) {
      out.push({ role: item.role, text: item.text.slice(0, 800) });
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  const user = await getCachedAuthUser().catch(() => null);
  const identifier = await rateLimitIdentifier(user?.id ?? null);
  if (!(await referenceCheckLimiter.check(identifier)).allowed) {
    return NextResponse.json(
      { error: 'Too many checks — please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const contentType = request.headers.get('content-type') ?? '';
  let message = '';
  let currentTarget: string | null = null;
  let forceRefresh = false;
  let history: ChatHistoryTurn[] = [];
  const screenshots: AttachedScreenshot[] = [];

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: 'Invalid upload payload.' }, { status: 400 });
    }
    message = typeof form.get('message') === 'string' ? (form.get('message') as string) : '';
    currentTarget =
      typeof form.get('currentTarget') === 'string'
        ? (form.get('currentTarget') as string).trim() || null
        : null;
    forceRefresh = form.get('forceRefresh') === '1' || form.get('forceRefresh') === 'true';

    const rawHistory = form.get('history');
    if (typeof rawHistory === 'string') {
      try {
        history = parseHistory(JSON.parse(rawHistory));
      } catch {
        history = [];
      }
    }

    const files = form.getAll('files').slice(0, 3);
    for (const entry of files) {
      if (!(entry instanceof File) || entry.size === 0) continue;
      if (!ALLOWED_TYPES.has(entry.type)) {
        return NextResponse.json({ error: 'Please upload JPG, PNG, or WebP screenshots.' }, { status: 400 });
      }
      if (entry.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: 'Each screenshot must be under 8 MB.' }, { status: 400 });
      }
      screenshots.push({
        buffer: Buffer.from(await entry.arrayBuffer()),
        mimeType: entry.type,
      });
    }
  } else {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    message = typeof body.message === 'string' ? body.message : '';
    currentTarget =
      typeof body.currentTarget === 'string' ? body.currentTarget.trim() || null : null;
    forceRefresh = body.forceRefresh === true;
    history = parseHistory(body.history);
  }

  if (!message.trim() && screenshots.length === 0) {
    return NextResponse.json(
      { error: 'Type a handle/link/message or drop a screenshot.' },
      { status: 400 },
    );
  }

  const result = await runAiTraderCheck({
    message,
    screenshots,
    history,
    currentTarget,
    forceRefresh,
  });

  return NextResponse.json(result, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
