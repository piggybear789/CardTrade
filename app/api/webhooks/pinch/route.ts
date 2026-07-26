// app/api/webhooks/pinch/route.ts
//
// The Webhook_Handler HTTP entry point (Req 10). A POST Route Handler that
// receives payment/KYC webhooks and drives the resulting Trade_State /
// Cash_Sale / KYC updates.
//
// The verify -> translate -> dedupe -> map -> dispatch -> log pipeline lives in
// `lib/webhook/pinchPipeline.ts` so it can also be invoked in-process by trusted
// server code (the test-mode compliance simulator) without a network round-trip
// to this route's own public URL. See that module for the full pipeline and
// security notes.
//
// TWO DELIVERY FORMATS, ONE PIPELINE:
//   * MockService deliveries — `x-pinch-signature`, a hex HMAC-SHA256 over the
//     raw body using `WEBHOOK_SECRET`, body already in the internal
//     `WebhookEvent` shape.
//   * Real Pinch deliveries — `pinch-signature: t=...,v2=...`, an HMAC-SHA256
//     over `{t}.{rawBody}` using `PINCH_WEBHOOK_SECRET`, with a 5-minute replay
//     window. The Pinch envelope is translated into zero or more internal
//     `WebhookEvent`s, since one `bank-results` delivery can report many
//     payments.
//
// SECURITY MODEL: intentionally UNAUTHENTICATED BY USER SESSION but
// AUTHENTICATED BY SIGNATURE — the correct model for a provider callback. The
// HMAC check runs BEFORE any state change or log write (Req 10.1).

import { handlePinchDelivery } from '@/lib/webhook/pinchPipeline';

/** Ensure Node.js runtime (needs `node:crypto` + the service-role client). */
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  // Verify over the exact raw bytes, so read the body before anything else.
  const rawBody = await request.text();
  return handlePinchDelivery(rawBody, request.headers);
}
