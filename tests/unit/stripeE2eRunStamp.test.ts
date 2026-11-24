// tests/unit/stripeE2eRunStamp.test.ts
//
// Req 2.7 (e2e-ux-audit-suite task 1.10): Stripe objects are stamped with the audit
// run ONLY on the dev sandbox schema. On the production schema `e2eRunId` is never
// read, so no metadata map, idempotency key or config gains a field.

import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type Stripe from 'stripe';

import { readE2eRunId, readStripeConfig } from '@/domain/services/stripe/config';
import {
  E2E_RUN_METADATA_KEY,
  SANDBOX_METADATA_KEY,
  decodeMetadata,
  metadataFor,
  withRunStamp,
} from '@/domain/services/stripe/metadata';
import { identitySessionCreateParams } from '@/domain/services/stripe/identitySession';
import { StripeService } from '@/domain/services/stripe/StripeService';
import type { StripeConfig } from '@/domain/services/stripe/config';

const DEV = { NEXT_PUBLIC_SUPABASE_SCHEMA: 'cardtrade_dev' };

describe('readE2eRunId', () => {
  it('reads the run id on the dev sandbox schema', () => {
    expect(readE2eRunId({ ...DEV, E2E_RUN_ID: 'run-2026-11-24T01.02' })).toBe('run-2026-11-24T01.02');
  });

  it('never reads it on the production schema or with the schema unset', () => {
    expect(readE2eRunId({ NEXT_PUBLIC_SUPABASE_SCHEMA: 'cardtrade', E2E_RUN_ID: 'run-1' })).toBeUndefined();
    expect(readE2eRunId({ E2E_RUN_ID: 'run-1' })).toBeUndefined();
  });

  it('ignores a blank or malformed id rather than stamping it', () => {
    expect(readE2eRunId({ ...DEV, E2E_RUN_ID: '   ' })).toBeUndefined();
    expect(readE2eRunId({ ...DEV, E2E_RUN_ID: 'has space' })).toBeUndefined();
    expect(readE2eRunId({ ...DEV, E2E_RUN_ID: 'x'.repeat(101) })).toBeUndefined();
  });

  it('readStripeConfig carries it on the sandbox and has no key at all in production', () => {
    const sandbox = readStripeConfig({ ...DEV, STRIPE_SECRET_KEY: 'sk_test_a', E2E_RUN_ID: 'run-1' });
    expect(sandbox.e2eRunId).toBe('run-1');
    const prod = readStripeConfig({ STRIPE_SECRET_KEY: 'sk_test_a', E2E_RUN_ID: 'run-1' });
    expect('e2eRunId' in prod).toBe(false);
  });
});

describe('withRunStamp', () => {
  it('adds the sandbox and run keys without touching routing', () => {
    const stamped = withRunStamp(metadataFor('HOLD', 'hold:t1:u1'), 'run-1');
    expect(stamped[SANDBOX_METADATA_KEY]).toBe('true');
    expect(stamped[E2E_RUN_METADATA_KEY]).toBe('run-1');
    expect(decodeMetadata(stamped)).toEqual(decodeMetadata(metadataFor('HOLD', 'hold:t1:u1')));
  });

  it('identity session metadata is stamped only when a run id is given', () => {
    const base = { profileId: 'p1', returnUrl: 'https://x/y' };
    expect(identitySessionCreateParams(base).metadata).not.toHaveProperty(E2E_RUN_METADATA_KEY);
    expect(identitySessionCreateParams({ ...base, e2eRunId: 'run-1' }).metadata).toMatchObject({
      [SANDBOX_METADATA_KEY]: 'true',
      [E2E_RUN_METADATA_KEY]: 'run-1',
    });
  });

  /** **Validates: Requirements 2.7** */
  it('property: on the production schema the stamp is the identity, whatever E2E_RUN_ID holds', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ maxLength: 20 })),
        fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
        fc.constantFrom(undefined, 'cardtrade', ' cardtrade '),
        (metadata, runId, schema) => {
          const env = { E2E_RUN_ID: runId, NEXT_PUBLIC_SUPABASE_SCHEMA: schema };
          expect(withRunStamp(metadata, readE2eRunId(env))).toEqual(metadata);
        },
      ),
    );
  });
});

describe('StripeService stamping', () => {
  function service(e2eRunId?: string) {
    const create = vi.fn(async () => ({ id: 'cus_1' }));
    const config = { secretKey: 'sk_test_x', ...(e2eRunId ? { e2eRunId } : {}) } as unknown as StripeConfig;
    const svc = new StripeService({
      client: { customers: { create } } as unknown as Stripe,
      config,
    } as unknown as ConstructorParameters<typeof StripeService>[0]);
    return { svc, create };
  }

  it('production config: metadata and idempotency key are unchanged', async () => {
    const { svc, create } = service();
    await svc.createPayer('p1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { cardtrade_profile_id: 'p1' } }),
      { idempotencyKey: 'payer:p1' },
    );
  });

  it('sandbox run: metadata is stamped and the profile key is scoped to the run', async () => {
    const { svc, create } = service('run-1');
    await svc.createPayer('p1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          cardtrade_profile_id: 'p1',
          [SANDBOX_METADATA_KEY]: 'true',
          [E2E_RUN_METADATA_KEY]: 'run-1',
        },
      }),
      { idempotencyKey: 'payer:p1:e2e:run-1' },
    );
  });
});
