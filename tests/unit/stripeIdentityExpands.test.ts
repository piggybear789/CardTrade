// tests/unit/stripeIdentityExpands.test.ts
//
// ESC-15: the person keys behind the fraud blocklist were always empty, because the
// session was read with the ordinary secret key and only `verified_outputs` expanded,
// so neither the document number nor the date of birth ever came back. With the
// restricted Identity key the binding asks for EXACTLY the sensitive fields, and the
// keys are built from the synthetic session fixture below.

import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

import { IDENTITY_SENSITIVE_EXPANDS, StripeService } from '@/domain/services/stripe/StripeService';
import type { StripeConfig } from '@/domain/services/stripe/config';
import { identityFingerprints } from '@/domain/identity/identityFingerprint';
import session from '../fixtures/stripeIdentitySession.json';

const config = {
  secretKey: 'sk_test_x',
  currency: 'aud',
  identityFingerprintSecret: 'secret',
} as unknown as StripeConfig;

function clientReturning(value: unknown) {
  const retrieve = vi.fn(async () => value);
  return { retrieve, client: { identity: { verificationSessions: { retrieve } } } as unknown as Stripe };
}

function service(main: Stripe, identityClient?: Stripe) {
  return new StripeService({ client: main, config, ...(identityClient ? { identityClient } : {}) } as unknown as ConstructorParameters<typeof StripeService>[0]);
}

describe('readIdentityCheck expands (ESC-15)', () => {
  it('uses the restricted client with exactly the sensitive expand list', async () => {
    const main = clientReturning(session);
    const restricted = clientReturning(session);
    const check = await service(main.client, restricted.client).readIdentityCheck('vs_test');
    expect(main.retrieve).not.toHaveBeenCalled();
    expect(restricted.retrieve).toHaveBeenCalledWith('vs_test', { expand: [...IDENTITY_SENSITIVE_EXPANDS] });
    expect(IDENTITY_SENSITIVE_EXPANDS).toContain('last_verification_report.document.number');
    expect(IDENTITY_SENSITIVE_EXPANDS).toContain('last_verification_report.document.dob');
    expect(check.identityFingerprints?.map((f) => f.kind)).toEqual(['document-id', 'name-dob']);
    expect(check.personKeysUnavailable).toBeUndefined();
  });

  it('without the restricted key it still verifies but reports the keys unavailable', async () => {
    const withoutNumber = {
      ...session,
      last_verification_report: null,
      verified_outputs: { ...session.verified_outputs, id_number: null, dob: null },
    };
    const main = clientReturning(withoutNumber);
    const check = await service(main.client).readIdentityCheck('vs_test');
    expect(main.retrieve).toHaveBeenCalledWith('vs_test', { expand: ['verified_outputs'] });
    expect(check.outcome).toBe('VERIFIED');
    expect(check.personKeysUnavailable).toBe(true);
  });

  it('the same fixture without document.number yields the namedob key only', async () => {
    const noNumber = {
      ...session,
      last_verification_report: {
        ...session.last_verification_report,
        document: { ...session.last_verification_report.document, number: null },
      },
      verified_outputs: { ...session.verified_outputs, id_number: null },
    };
    const restricted = clientReturning(noNumber);
    const check = await service(clientReturning(null).client, restricted.client).readIdentityCheck('vs_test');
    expect(check.identityFingerprints?.map((f) => f.kind)).toEqual(['name-dob']);
  });
});

describe('identityFingerprints keys (ESC-15)', () => {
  const dob = { day: 1, month: 2, year: 1990 };

  it('a passport and a licence for one person share the namedob key', () => {
    const passport = identityFingerprints(
      { idNumber: 'PA123', issuingCountry: 'AU', firstName: 'Mary Jane', lastName: "O'Neil", dob },
      'secret',
    );
    const licence = identityFingerprints(
      { idNumber: 'DL987', issuingCountry: 'AU', firstName: 'Mary', lastName: "O'Neil", dob },
      'secret',
    );
    const namedob = (keys: typeof passport) => keys.find((k) => k.kind === 'name-dob')?.hash;
    expect(namedob(passport)).toBeDefined();
    expect(namedob(passport)).toBe(namedob(licence));
  });

  it('the address country never changes a key', () => {
    const here = identityFingerprints({ idNumber: 'X1', issuingCountry: 'AU', firstName: 'A', lastName: 'B', dob, country: 'AU' }, 's');
    const moved = identityFingerprints({ idNumber: 'X1', issuingCountry: 'AU', firstName: 'A', lastName: 'B', dob, country: 'NZ' }, 's');
    expect(moved).toEqual(here);
  });

  it('the document key is scoped by issuing country', () => {
    const au = identityFingerprints({ idNumber: 'X1', issuingCountry: 'AU' }, 's');
    const nz = identityFingerprints({ idNumber: 'X1', issuingCountry: 'NZ' }, 's');
    expect(au[0]?.hash).not.toBe(nz[0]?.hash);
  });
});
