import { describe, expect, it } from 'vitest';

import {
  identitySessionCreateParams,
  identitySessionIdempotencyKey,
} from '@/domain/services/stripe/identitySession';

describe('identitySessionCreateParams', () => {
  it('creates a document session scoped to the profile', () => {
    const body = identitySessionCreateParams({
      profileId: 'profile-1',
      returnUrl: 'http://localhost:3000/onboarding?identity=complete',
    });

    expect(body.type).toBe('document');
    expect(body.related_person).toBeUndefined();
    expect(body.options).toEqual({
      document: {
        require_matching_selfie: true,
        require_id_number: true,
        require_live_capture: false,
      },
    });
    expect(body.metadata).toEqual({ cardtrade_profile_id: 'profile-1' });
  });

  it('uses the dashboard flow when one is configured', () => {
    const body = identitySessionCreateParams({
      profileId: 'profile-1',
      returnUrl: 'http://localhost:3000/onboarding?identity=complete',
      verificationFlow: 'vf_abc',
    });

    expect(body.verification_flow).toBe('vf_abc');
    expect(body.type).toBeUndefined();
  });
});

describe('identitySessionIdempotencyKey', () => {
  it('is stable for the same profile and return URL', () => {
    const key = identitySessionIdempotencyKey({
      profileId: 'profile-1',
      returnUrl: 'http://localhost/x',
    });

    expect(key).toBe('identity:profile-1:http://localhost/x');
  });

  it('escapes the replay when a dead session has to be replaced', () => {
    // WITHOUT THIS THERE IS NO WAY TO OPEN A NEW SESSION AT ALL. Once a session is
    // cancelled or redacted the provider accepts nothing more against it, and a create
    // under the base key just replays that corpse — so the member is handed a session
    // they can never complete, forever.
    const base = identitySessionIdempotencyKey({
      profileId: 'profile-1',
      returnUrl: 'http://localhost/x',
    });
    const superseding = identitySessionIdempotencyKey({
      profileId: 'profile-1',
      returnUrl: 'http://localhost/x',
      supersedes: 'vs_dead',
    });

    expect(superseding).not.toBe(base);
    expect(superseding).toBe('identity:profile-1:http://localhost/x:after:vs_dead');
  });

  it('stays deterministic, so a double-clicked retry opens one session and not two', () => {
    // It is a SCOPE, not a nonce. Two clicks naming the same dead session must collide.
    const once = identitySessionIdempotencyKey({
      profileId: 'profile-1',
      returnUrl: 'http://localhost/x',
      supersedes: 'vs_dead',
    });
    const twice = identitySessionIdempotencyKey({
      profileId: 'profile-1',
      returnUrl: 'http://localhost/x',
      supersedes: 'vs_dead',
    });

    expect(twice).toBe(once);
  });

  it('treats an absent supersedes as the plain key, so nothing existing shifts', () => {
    expect(
      identitySessionIdempotencyKey({
        profileId: 'profile-1',
        returnUrl: 'http://localhost/x',
        supersedes: null,
      }),
    ).toBe('identity:profile-1:http://localhost/x');
  });
});
