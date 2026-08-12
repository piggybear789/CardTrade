// app/api/webhooks/ship24/route.ts
//
// Receives Ship24 webhook notifications when tracking status changes.
// The critical event is `delivered` — that starts the inspection clock.
//
// Ship24 does NOT sign webhooks with HMAC. Authentication is by:
//   1. The webhook URL being secret (only configured in Ship24 dashboard)
//   2. Verifying the tracking number exists in our system before acting
//
// Safe to replay: the downstream sync functions are idempotent (they use
// monotonic writes — a delivery timestamp once set is never unset).

import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

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
