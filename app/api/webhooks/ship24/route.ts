// app/api/webhooks/ship24/route.ts
//
// Receives Ship24 webhook notifications when tracking status changes.
// The critical event is `delivered` — that starts the inspection clock.
//
// WHY THIS ENDPOINT IS AUTHENTICATED, AND WHY URL SECRECY WAS NOT ENOUGH.
// A forged `delivered` event is a MONEY path, not just bad data: it sets
// `carrier_delivered_at`, which starts the buyer's inspection window, and when that
// window lapses the sweep auto-completes the sale and pays the seller. So an
// attacker able to POST here could start the clock on goods that never shipped and
// have the platform pay out when the buyer misses a deadline they never knew began.
//
// This route previously relied on the URL being secret plus the tracking number
// existing in our system. Neither is a credential: the path is a fixed, guessable
// string, and tracking numbers are disclosed to the counterparty in the contract
// room and are frequently sequential per carrier.
//
// Ship24 does not sign its webhooks (no HMAC), so the credential is a shared secret
// carried on the request — set `SHIP24_WEBHOOK_SECRET` and append `?token=<secret>`
// to the webhook URL configured in the Ship24 dashboard. A `x-webhook-token` header
// is accepted too, for providers or proxies that strip query strings.
//
// FAILS CLOSED when the secret is unset, matching the money-moving job routes
// (`JOBS_SECRET`) rather than the signature-verified Stripe route. An
// unauthenticated endpoint that can trigger a payout is worse than tracking that
// does not update: the manual "not received" path still protects the buyer, and a
// silently-open door does not.
//
// Safe to replay: the downstream writes are monotonic (a delivery timestamp once
// set is never unset), so a duplicate authentic delivery is a no-op.

import { timingSafeEqual } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Compare two secrets without leaking length or content through timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself be a leak.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Pull the presented secret from either the query string or a header.
 *
 * Query string first because that is what a provider with no header support can
 * configure; the header is the tidier option where it is available.
 */
function presentedToken(request: Request): string | null {
  const fromHeader = request.headers.get('x-webhook-token')?.trim();
  if (fromHeader) return fromHeader;
  try {
    const token = new URL(request.url).searchParams.get('token')?.trim();
    return token || null;
  } catch {
    return null;
  }
}

interface Ship24WebhookEvent {
  trackings: Array<{
    tracker: {
      trackerId: string;
      trackingNumber: string;
    };
    shipment: {
      trackingNumber: string;
      statusMilestone: string | null;
    } | null;
    events: Array<{
      occurrenceDatetime: string;
      statusMilestone: string | null;
    }>;
  }>;
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.SHIP24_WEBHOOK_SECRET?.trim();
  if (!expected) {
    // Fail closed. Never accept an unauthenticated event that can start a payout
    // clock. Logged as an error because this is a misconfiguration, not traffic.
    console.error(
      '[ship24-webhook] SHIP24_WEBHOOK_SECRET is not configured; refusing delivery events.',
    );
    return Response.json(
      { ok: false, error: 'Webhook secret is not configured' },
      { status: 503 },
    );
  }

  const token = presentedToken(request);
  if (!token || !secretMatches(token, expected)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Ship24WebhookEvent;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!payload.trackings || !Array.isArray(payload.trackings)) {
    return Response.json({ ok: true, processed: 0 });
  }

  const admin = createAdminClient();
  let processed = 0;

  for (const tracking of payload.trackings) {
    const trackingNumber = tracking.tracker?.trackingNumber ?? tracking.shipment?.trackingNumber;
    const milestone = tracking.shipment?.statusMilestone;
    if (!trackingNumber || !milestone) continue;

    // Only act on delivery — that's what starts the inspection clock.
    if (milestone !== 'delivered') {
      processed += 1;
      continue;
    }

    const deliveredAt = tracking.events?.[0]?.occurrenceDatetime
      ? new Date(tracking.events[0].occurrenceDatetime).toISOString()
      : new Date().toISOString();

    // Find matching cash sales (by tracking_number column).
    const { data: sales } = await admin
      .from('cash_sales')
      .select('id')
      .eq('tracking_number', trackingNumber)
      .in('status', ['IN_TRANSIT', 'ESCROW_HELD'])
      .limit(5);

    for (const sale of sales ?? []) {
      try {
        await admin.rpc('apply_cash_sale_tracking', {
          p_cash_sale_id: sale.id,
          p_tracking_status: 'DELIVERED',
          p_carrier_delivered_at: deliveredAt,
        });
      } catch (err: unknown) {
        console.error(`[ship24-webhook] apply_cash_sale_tracking failed for ${sale.id}:`, err);
      }
    }

    // Find matching trades (both initiator and counterpart tracking).
    const { data: tradesInit } = await admin
      .from('trades')
      .select('id')
      .eq('initiator_tracking_number', trackingNumber)
      .in('state', ['COLLATERAL_LOCKED', 'IN_TRANSIT'])
      .limit(5);

    for (const trade of tradesInit ?? []) {
      try {
        await admin
          .from('trades')
          .update({ initiator_carrier_delivered_at: deliveredAt })
          .eq('id', trade.id)
          .is('initiator_carrier_delivered_at', null);
      } catch (err: unknown) {
        console.error(`[ship24-webhook] trade initiator delivery failed for ${trade.id}:`, err);
      }
    }

    const { data: tradesCounter } = await admin
      .from('trades')
      .select('id')
      .eq('counterpart_tracking_number', trackingNumber)
      .in('state', ['COLLATERAL_LOCKED', 'IN_TRANSIT'])
      .limit(5);

    for (const trade of tradesCounter ?? []) {
      try {
        await admin
          .from('trades')
          .update({ counterpart_carrier_delivered_at: deliveredAt })
          .eq('id', trade.id)
          .is('counterpart_carrier_delivered_at', null);
      } catch (err: unknown) {
        console.error(`[ship24-webhook] trade counterpart delivery failed for ${trade.id}:`, err);
      }
    }

    processed += 1;
  }

  return Response.json({ ok: true, processed });
}
