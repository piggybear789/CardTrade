// tests/e2e/audit/backend/ship24.ts
//
// SHIP24-SHAPED CARRIER EVENTS posted to the main App_Server's Ship24 webhook.
//
// Requirements:
//   14.x, 26.8  carrier delivery (outbound and return) reaches the real route, which
//               authenticates with `Authorization: Bearer <SHIP24_WEBHOOK_SECRET>`
//               (ESC-39), and the refusals for a missing or wrong secret are drivable
//   4.7         callers wrap every post in `simulated()` (enforced by a source scan)
//
// Ship24 does not sign its webhooks, so the route's credential is the shared secret.
// The body mirrors the subset `app/api/webhooks/ship24/route.ts` reads: one
// `trackings[]` entry per number with `tracker`, `shipment.statusMilestone` and
// `events[]`. The secret is read with `envValue` and only ever placed in the header;
// it is never returned, logged or put in an error message.
//
// Not covered here: the "already delivered" and "scan predates payment" refusals are
// decided when the seller RECORDS the number (a live Ship24 lookup), not by this
// webhook. Those Pathways use their own mechanism.

import { randomBytes } from 'node:crypto';

import { envValue } from '../../support/db';

/** Where the main App_Server listens (design: Main, port 3100). */
export const MAIN_SERVER_URL = 'http://localhost:3100';

const SHIP24_WEBHOOK_PATH = '/api/webhooks/ship24';

/** Ship24 `statusMilestone` values the app maps (`ship24Tracking.ts`). */
export type Ship24Milestone =
  | 'info_received'
  | 'in_transit'
  | 'out_for_delivery'
  | 'available_for_pickup'
  | 'delivered'
  | 'failed_attempt'
  | 'exception';

/** One carrier event on a tracking. */
export interface Ship24FixtureEvent {
  occurrenceDatetime: string;
  statusMilestone: Ship24Milestone;
}

/** The webhook body the route reads. */
export interface Ship24WebhookBody {
  trackings: Array<{
    tracker: { trackerId: string; trackingNumber: string };
    shipment: { trackingNumber: string; statusMilestone: Ship24Milestone };
    events: Array<Ship24FixtureEvent & { eventId: string; status: string }>;
  }>;
}

/** How the request authenticates: the configured secret, none, or a wrong one. */
export type Ship24Auth = 'correct' | 'missing' | 'wrong';

/**
 * Build a Ship24-shaped body for one tracking number. `milestone` is the shipment's
 * current milestone; `events` defaults to a single event at that milestone, now.
 * Pure apart from the random ids.
 */
export function ship24Body(params: {
  trackingNumber: string;
  milestone: Ship24Milestone;
  events?: Ship24FixtureEvent[];
  now?: Date;
}): Ship24WebhookBody {
  const trackingNumber = params.trackingNumber.trim();
  if (!trackingNumber) throw new Error('a Ship24 fixture needs a tracking number');
  const events = params.events ?? [
    { occurrenceDatetime: (params.now ?? new Date()).toISOString(), statusMilestone: params.milestone },
  ];
  return {
    trackings: [
      {
        tracker: { trackerId: `e2e-${randomBytes(6).toString('hex')}`, trackingNumber },
        shipment: { trackingNumber, statusMilestone: params.milestone },
        events: events.map((event) => ({
          ...event,
          eventId: `e2e-${randomBytes(6).toString('hex')}`,
          status: event.statusMilestone,
        })),
      },
    ],
  };
}

/** The Authorization header for a mode. The secret never leaves this function otherwise. */
function authorization(auth: Ship24Auth): Record<string, string> {
  if (auth === 'missing') return {};
  if (auth === 'wrong') return { authorization: `Bearer e2e-wrong-${randomBytes(12).toString('hex')}` };
  const secret = envValue('SHIP24_WEBHOOK_SECRET')?.trim();
  if (!secret) throw new Error('refusing Ship24 fixture: SHIP24_WEBHOOK_SECRET is not set');
  return { authorization: `Bearer ${secret}` };
}

/**
 * POST a Ship24-shaped body to an App_Server. `auth` defaults to the configured
 * secret; `missing` and `wrong` drive the route's 401. Call it only inside
 * `simulated()`.
 */
export async function postShip24Event(
  body: Ship24WebhookBody,
  opts: { baseUrl?: string; auth?: Ship24Auth } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${opts.baseUrl ?? MAIN_SERVER_URL}${SHIP24_WEBHOOK_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authorization(opts.auth ?? 'correct') },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep the text
  }
  return { status: response.status, body: parsed };
}

/**
 * The carrier reports `trackingNumber` delivered (outbound or return leg; the route
 * decides which by the sale's columns). Throws unless the route accepted it, so a
 * Pathway never carries on past a delivery that did not land.
 */
export async function ship24Delivered(
  trackingNumber: string,
  opts: { deliveredAt?: Date; baseUrl?: string } = {},
): Promise<{ processed: number }> {
  const deliveredAt = opts.deliveredAt ?? new Date();
  const body = ship24Body({
    trackingNumber,
    milestone: 'delivered',
    events: [
      { occurrenceDatetime: new Date(deliveredAt.getTime() - 60 * 60 * 1000).toISOString(), statusMilestone: 'in_transit' },
      { occurrenceDatetime: deliveredAt.toISOString(), statusMilestone: 'delivered' },
    ],
  });
  const result = await postShip24Event(body, { baseUrl: opts.baseUrl });
  const reply = result.body as { ok?: boolean; processed?: number } | string;
  if (result.status !== 200 || typeof reply !== 'object' || reply.ok !== true) {
    throw new Error(`Ship24 delivery for ${trackingNumber} was not accepted (HTTP ${result.status})`);
  }
  return { processed: reply.processed ?? 0 };
}
