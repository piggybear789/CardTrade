// app/api/references/check/route.ts
//
// Public, rate-limited API for running and polling "Is this person real?" background
// checks across eBay, Sherlock OSINT, pgvector/graph similarity, and anonymized
// scam-report fingerprints.

import { NextResponse, type NextRequest } from 'next/server';

import { CHECK_STREAM_CONTENT_TYPE, type CheckStreamEvent } from '@/domain/references/enrichment';
import type { VisibleProfileMetrics } from '@/domain/references/profileForensics';
import { rateLimitIdentifier } from '@/lib/rateLimit';
import { referenceCheckLimiter, referenceCheckPollLimiter } from '@/lib/rateLimiters';
import {
  loadBackgroundCheckRun,
  startOrLoadBackgroundCheck,
  type StartCheckInput,
} from '@/lib/references/enrichment';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

const INVALID_QUERY_MESSAGE = 'Enter a valid handle, profile link, or full name (at least 2 characters).';
const UNAVAILABLE_MESSAGE = 'Background check is temporarily unavailable. Please try again.';

export async function POST(request: NextRequest) {
  const user = await getCachedAuthUser().catch(() => null);
  const identifier = await rateLimitIdentifier(user?.id ?? null);
  if (!(await referenceCheckLimiter.check(identifier)).allowed) {
    return NextResponse.json(
      { error: 'Too many background checks. Please wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        query?: string;
        platform?: string | null;
        location?: string | null;
        facebookUrl?: string | null;
        secondaryHandle?: string | null;
        paymentDetail?: string | null;
        payeeName?: string | null;
        psaCertNumber?: string | null;
        cardQuery?: string | null;
        askingPrice?: number | string | null;
        askingCurrency?: 'AUD' | 'USD' | null;
        dmText?: string | null;
        visibleProfile?: VisibleProfileMetrics | null;
        forceRefresh?: boolean;
      }
    | null;

  if (!body || typeof body.query !== 'string') {
    return NextResponse.json({ error: 'Enter a handle, profile URL, or name to check.' }, { status: 400 });
  }

  const parsedPrice =
    typeof body.askingPrice === 'number'
      ? body.askingPrice
      : typeof body.askingPrice === 'string' && body.askingPrice.trim()
        ? Number.parseFloat(body.askingPrice.replace(/[^0-9.]/g, ''))
        : null;

  const input: StartCheckInput = {
    query: body.query,
    platform: body.platform ?? null,
    location: body.location ?? null,
    facebookUrl: body.facebookUrl ?? null,
    secondaryHandle: body.secondaryHandle ?? null,
    paymentDetail: body.paymentDetail ?? null,
    payeeName: typeof body.payeeName === 'string' ? body.payeeName.slice(0, 120) : null,
    psaCertNumber: typeof body.psaCertNumber === 'string' ? body.psaCertNumber.slice(0, 20) : null,
    cardQuery: typeof body.cardQuery === 'string' ? body.cardQuery.slice(0, 120) : null,
    askingPrice: parsedPrice !== null && Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null,
    askingCurrency: body.askingCurrency === 'USD' ? 'USD' : 'AUD',
    dmText: typeof body.dmText === 'string' ? body.dmText.slice(0, 3000) : null,
    visibleProfile: body.visibleProfile ?? null,
    forceRefresh: Boolean(body.forceRefresh),
    requestedBy: user?.id ?? null,
  };

  if (request.headers.get('accept')?.includes(CHECK_STREAM_CONTENT_TYPE)) {
    return streamCheck(input);
  }

  try {
    const dossier = await startOrLoadBackgroundCheck(input);

    if (!dossier) {
      return NextResponse.json({ error: INVALID_QUERY_MESSAGE }, { status: 400 });
    }

    return NextResponse.json(dossier, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/references/check] POST failed:', error);
    return NextResponse.json(
      { error: UNAVAILABLE_MESSAGE },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

/**
 * The same check, answered as it runs: one JSON event per line (`CheckStreamEvent`). A
 * `step` line as each part finishes, then the `dossier`, or an `error` in its place.
 * Asked for with `Accept: application/x-ndjson`, by a reader who is watching it run.
 *
 * The status is 200 before the check has started, so a failure is an `error` line, not
 * a status code. A reader who leaves mid-check does not stop it: the run is still
 * stored, and is there when they come back.
 */
function streamCheck(input: StartCheckInput): Response {
  const encoder = new TextEncoder();
  let listening = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: CheckStreamEvent) => {
        if (!listening) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          listening = false;
        }
      };

      try {
        const dossier = await startOrLoadBackgroundCheck(input, {
          onStep: (result) => send({ type: 'step', result }),
        });
        send(dossier ? { type: 'dossier', dossier } : { type: 'error', error: INVALID_QUERY_MESSAGE });
      } catch (error) {
        console.error('[api/references/check] POST (stream) failed:', error);
        send({ type: 'error', error: UNAVAILABLE_MESSAGE });
      } finally {
        if (listening) {
          try {
            controller.close();
          } catch {
            // Already closed by the reader.
          }
        }
      }
    },
    cancel() {
      listening = false;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': `${CHECK_STREAM_CONTENT_TYPE}; charset=utf-8`,
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
      // A reverse proxy that buffers would hold every line until the last one.
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function GET(request: NextRequest) {
  const user = await getCachedAuthUser().catch(() => null);
  const identifier = await rateLimitIdentifier(user?.id ?? null);
  if (!(await referenceCheckPollLimiter.check(identifier)).allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': '30' } },
    );
  }

  const runId = request.nextUrl.searchParams.get('runId')?.trim() ?? '';
  if (!runId) {
    return NextResponse.json({ error: 'Missing runId.' }, { status: 400 });
  }

  const dossier = await loadBackgroundCheckRun(runId).catch(() => undefined);
  if (dossier === undefined) {
    return NextResponse.json({ error: 'Could not load check status.' }, { status: 503 });
  }
  if (!dossier) {
    return NextResponse.json({ error: 'Background check not found.' }, { status: 404 });
  }

  return NextResponse.json(dossier, { headers: { 'Cache-Control': 'no-store' } });
}
