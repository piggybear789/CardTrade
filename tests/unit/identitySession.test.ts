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
});
