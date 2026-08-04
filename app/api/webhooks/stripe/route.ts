// app/api/webhooks/stripe/route.ts
//
// The Webhook_Handler HTTP entry point (Req 10). A POST Route Handler that
// receives payment/KYC webhooks and drives the resulting Trade_State /
// Cash_Sale / KYC updates.
//
// The verify -> translate -> dedupe -> map -> dispatch -> log pipeline lives in
// `lib/webhook/webhookPipeline.ts` so it can also be invoked in-process by
// trusted server code without a network round-trip to this route's own public
// URL. See that module for the full pipeline and security notes.
//
// TWO DELIVERY FORMATS, ONE PIPELINE:
//   * Real Stripe deliveries — `stripe-signature: t=...,v1=...`, an HMAC-SHA256
//     over `{t}.{rawBody}` using `STRIPE_WEBHOOK_SECRET`, with a 5-minute replay
//     window. The Stripe event is translated into zero or more internal
//     `WebhookEvent`s; a delivery that maps to nothing is logged as a NO_OP.
//   * MockService deliveries — `x-mock-signature`, a hex HMAC-SHA256 over the raw
//     body using `WEBHOOK_SECRET`, body already in the internal `WebhookEvent`
//     shape. Rejected outright whenever a real provider is active, so demo
//     buttons can never advance a real trade.
//
// SECURITY MODEL: intentionally UNAUTHENTICATED BY USER SESSION but
// AUTHENTICATED BY SIGNATURE — the correct model for a provider callback. The
// HMAC check runs BEFORE any state change or log write (Req 10.1).
//
// Register the endpoint locally with:
//   stripe listen --forward-to localhost:3000/api/webhooks/stripe

import { handleWebhookDelivery } from '@/lib/webhook/webhookPipeline';

/** Ensure Node.js runtime (needs `node:crypto` + the service-role client). */
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  // Verify over the exact raw bytes, so read the body before anything else.
  const rawBody = await request.text();
  return handleWebhookDelivery(rawBody, request.headers);
}
