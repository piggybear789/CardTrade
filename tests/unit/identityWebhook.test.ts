// tests/unit/identityWebhook.test.ts
//
// Translation and routing of Stripe Identity events — the Identity_Gate (0069).
//
// WHY THIS NEEDS ITS OWN TEST. `identity.verification_session.*` was translated
// once before, removed with the retired payer gate, and is now back as the SINGLE
// verification signal. Three things must hold or the gate is either unreachable or
// wrong:
//
//   * `verified` opens the gate and `requires_input` does not. Getting that
//     backwards would either strand every member or verify everyone.
//   * The disclosed name comes ONLY from `verified_outputs` — the provider's own
//     reading of the document — never from anything a member typed.
//   * An unattributable session is a NO_OP, not a guess. Writing a verification to
//     the wrong Profile is the worst outcome available on this path.

import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { translateStripeEvent } from '@/domain/services/stripe/webhook';
import { mapEventToAction } from '@/domain/webhook/mapEventToAction';
import type { WebhookEvent } from '@/domain/services/types';

/** A Stripe event envelope wrapping `object`. */
function event(type: string, object: unknown, id = 'evt_identity_1'): Stripe.Event {
  return {
    id,
    object: 'event',
    api_version: null,
    created: 1_800_000_000,
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

/** A verification session object as Stripe delivers it. */
function session(
  overrides: Partial<{
    id: string;
    status: string;
    metadata: Record<string, string> | null;
    verified_outputs: { first_name?: string; last_name?: string } | null;
    last_error: { code: string; reason: string } | null;
  }> = {},
) {
  return {
    id: 'vs_123',
    object: 'identity.verification_session',
    status: 'verified',
    metadata: { cardtrade_profile_id: 'profile-1' },
    verified_outputs: null,
    last_error: null,
    ...overrides,
  };
}

describe('identity.verification_session translation', () => {
  it('translates a verified session into identity.verified', () => {
    const [translated] = translateStripeEvent(
      event('identity.verification_session.verified', session()),
    );

    expect(translated.type).toBe('identity.verified');
    expect(translated.payload.profileId).toBe('profile-1');
    expect(translated.payload.identitySessionId).toBe('vs_123');
  });

  it('takes the disclosed name ONLY from verified_outputs', () => {
    const [translated] = translateStripeEvent(
      event(
        'identity.verification_session.verified',
        session({ verified_outputs: { first_name: 'Ada', last_name: 'Lovelace' } }),
      ),
    );

    expect(translated.payload.identityVerifiedName).toBe('Ada Lovelace');
  });

  it('reports a null name when the provider expanded no outputs', () => {
    // Normal, not an error: `verified_outputs` is not expanded on every webhook
    // payload. The read-back fills it in, and the pipeline writes the name
    // monotonically so this null cannot blank one already stored.
    const [translated] = translateStripeEvent(
      event('identity.verification_session.verified', session({ verified_outputs: null })),
    );

    expect(translated.payload.identityVerifiedName).toBeNull();
  });

  it('translates requires_input into a RETRYABLE failure, carrying the reason', () => {
    const [translated] = translateStripeEvent(
      event(
        'identity.verification_session.requires_input',
        session({
          status: 'requires_input',
          last_error: { code: 'document_unverified_other', reason: 'The document was blurry' },
        }),
      ),
    );

    expect(translated.type).toBe('identity.failed');
    expect(translated.payload.reason).toBe('The document was blurry');
  });

  it('ignores processing and created, which carry no decision', () => {
    // Writing PENDING on these would add nothing: the column is already PENDING
    // from the moment the session was created.
    for (const type of [
      'identity.verification_session.created',
      'identity.verification_session.processing',
    ]) {
      expect(translateStripeEvent(event(type, session({ status: 'processing' })))).toEqual([]);
    }
  });

  it('still carries the session id when metadata is missing', () => {
    // A session created outside our own call path has no metadata. The session id
    // is the fallback the pipeline resolves through the indexed column.
    const [translated] = translateStripeEvent(
      event('identity.verification_session.verified', session({ metadata: null })),
    );

    expect(translated.payload.profileId).toBeUndefined();
    expect(translated.payload.identitySessionId).toBe('vs_123');
  });
});

describe('identity event routing', () => {
  function internal(
    type: WebhookEvent['type'],
    payload: WebhookEvent['payload'] = {},
  ): WebhookEvent {
    return { eventId: 'evt_1', type, occurredAt: '2026-08-06T00:00:00.000Z', payload };
  }

  it('routes a verified session to an IDENTITY_DECISION that opens the gate', () => {
    expect(
      mapEventToAction(internal('identity.verified', { profileId: 'profile-1' })),
    ).toEqual({ kind: 'IDENTITY_DECISION', verified: true });
  });

  it('routes a failed session to an IDENTITY_DECISION that does NOT open the gate', () => {
    expect(
      mapEventToAction(internal('identity.failed', { profileId: 'profile-1' })),
    ).toEqual({ kind: 'IDENTITY_DECISION', verified: false });
  });

  it('routes on the session id alone when no profile id is present', () => {
    expect(
      mapEventToAction(internal('identity.verified', { identitySessionId: 'vs_123' })),
    ).toEqual({ kind: 'IDENTITY_DECISION', verified: true });
  });

  it('is a NO_OP when the decision cannot be attributed to anyone', () => {
    // Never a guess. Applying a verification to the wrong Profile would badge a
    // member who never presented a document.
    expect(mapEventToAction(internal('identity.verified', {}))).toEqual({ kind: 'NO_OP' });
    expect(mapEventToAction(internal('identity.failed', {}))).toEqual({ kind: 'NO_OP' });
  });

  it('does not route Connect compliance to an identity decision', () => {
    // The 0069 separation: `merchant.compliance.updated` decides PAYABILITY only.
    // If it ever routed to IDENTITY_DECISION we would be back to two competing
    // answers for "is this member verified".
    expect(
      mapEventToAction(internal('merchant.compliance.updated', { merchantRef: 'acct_1' })),
    ).toEqual({ kind: 'MERCHANT_COMPLIANCE' });
  });
});
