// tests/unit/identityServiceFake.test.ts
//
// The InMemory binding of `IdentityService` (0069).
//
// WHY THIS IS WORTH TESTING RATHER THAN TRUSTING. The fake is what every future unit
// test will reach for when it needs a verified member, so a mistake here propagates
// as false confidence everywhere else. Two properties matter most:
//
//   * IT DEFAULTS TO PENDING, NEVER VERIFIED. A fake that verified on creation would
//     let a test walk through the Identity_Gate without saying it meant to — the same
//     class of mistake as migration 0060, where a single account-creation call was
//     treated as the verification milestone.
//   * A NAME EXISTS ONLY WHEN VERIFIED. The disclosure is the one piece of member
//     identity the platform holds, and a fake that leaked a name in a pending state
//     would let a test assert a disclosure that production would refuse.

import { describe, expect, it } from 'vitest';

import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { satisfiesIdentityGate } from '@/domain/identity/identityGate';

describe('InMemoryService identity binding', () => {
  it('lands PENDING on creation, not VERIFIED', async () => {
    const service = new InMemoryService();

    const check = await service.createIdentityCheck({
      profileId: 'profile-1',
      returnUrl: 'http://localhost:3000/profile/payouts',
    });

    expect(check.outcome).toBe('PENDING');
    // And that state does NOT open the gate.
    expect(satisfiesIdentityGate({ identityCheckStatus: 'PENDING' })).toBe(false);
  });

  it('is idempotent per profile — a second call reuses the session', async () => {
    const service = new InMemoryService();
    const params = { profileId: 'profile-1', returnUrl: 'http://localhost:3000/x' };

    const first = await service.createIdentityCheck(params);
    const second = await service.createIdentityCheck(params);

    // Matches the real binding's idempotency key, so a retry cannot orphan the
    // session id already persisted against the Profile.
    expect(second.sessionId).toBe(first.sessionId);
  });

  it('returns the caller return URL as the hosted URL', async () => {
    const service = new InMemoryService();

    const check = await service.createIdentityCheck({
      profileId: 'profile-1',
      returnUrl: 'http://localhost:3000/profile/payouts?identity=complete',
    });

    // There is no provider page to host locally, and sending a member somewhere
    // that does not exist would break the flow rather than simulate it.
    expect(check.hostedUrl).toBe('http://localhost:3000/profile/payouts?identity=complete');
  });

  it('reports no name while PENDING', async () => {
    const service = new InMemoryService();
    const created = await service.createIdentityCheck({
      profileId: 'profile-1',
      returnUrl: 'http://localhost:3000/x',
    });

    const read = await service.readIdentityCheck(created.sessionId);

    expect(read.outcome).toBe('PENDING');
    expect(read.verifiedName).toBeNull();
    expect(read.verifiedAt).toBeNull();
  });

  it('reports a name and timestamp once driven to VERIFIED', async () => {
    const service = new InMemoryService();
    const created = await service.createIdentityCheck({
      profileId: 'profile-1',
      returnUrl: 'http://localhost:3000/x',
    });

    service.setIdentityOutcome(created.sessionId, 'VERIFIED');
    const read = await service.readIdentityCheck(created.sessionId);

    expect(read.outcome).toBe('VERIFIED');
    expect(read.verifiedName).toBeTruthy();
    expect(read.verifiedAt).toBeTruthy();
    expect(satisfiesIdentityGate({ identityCheckStatus: 'VERIFIED' })).toBe(true);
  });

  it('reports a retryable failure with a reason, and no name', async () => {
    const service = new InMemoryService();
    const created = await service.createIdentityCheck({
      profileId: 'profile-1',
      returnUrl: 'http://localhost:3000/x',
    });

    service.setIdentityOutcome(created.sessionId, 'FAILED');
    const read = await service.readIdentityCheck(created.sessionId);

    expect(read.outcome).toBe('FAILED');
    expect(read.failureReason).toBeTruthy();
    // A failed check must never yield a disclosable name.
    expect(read.verifiedName).toBeNull();
  });

  it('verifyIdentityFor is a shortcut that does not skip the session', async () => {
    const service = new InMemoryService();

    const sessionId = service.verifyIdentityFor('profile-1');
    const read = await service.readIdentityCheck(sessionId);

    expect(read.outcome).toBe('VERIFIED');
    // The session is registered both ways, so a webhook fake resolving by session id
    // finds the Profile — exactly the fallback the real pipeline relies on.
    expect(service.profileByIdentity.get(sessionId)).toBe('profile-1');
    expect(service.identityByProfile.get('profile-1')).toBe(sessionId);
  });

  it('never verifies a profile that was not asked about', async () => {
    const service = new InMemoryService();
    service.verifyIdentityFor('profile-1');

    const other = await service.createIdentityCheck({
      profileId: 'profile-2',
      returnUrl: 'http://localhost:3000/x',
    });

    // Verification is per Profile. Cross-contamination in the fake would let a test
    // assert an isolation property the production path does not actually hold.
    expect(other.outcome).toBe('PENDING');
  });
});
