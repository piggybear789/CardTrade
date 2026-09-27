// tests/unit/errorLog.test.ts
//
// The pure rules behind `cardtrade.error_logs` (0123): grouping, the expected/unexpected
// split, and what may be stored. Grouping is the one that matters most — an unstable
// fingerprint turns every recurrence into a "new" error and the queue stops shrinking.

import { describe, expect, it } from 'vitest';

import {
  buildErrorLogRecord,
  computeErrorFingerprint,
  extractIdContext,
  isExpectedFailureCode,
  isIgnorableClientError,
  normalizeErrorMessage,
  sanitizeErrorPath,
} from '@/domain/errors/errorLog';

const SALE_A = '3f1c2b1a-9d7e-4c1a-8b2f-1a2b3c4d5e6f';
const SALE_B = '9a8b7c6d-5e4f-4a3b-9c2d-0e1f2a3b4c5d';

describe('computeErrorFingerprint', () => {
  it('groups the same failure regardless of which contract it hit', () => {
    const a = computeErrorFingerprint({
      source: 'SERVER',
      routePath: '/app/sales/[id]/page',
      message: `Cash sale ${SALE_A} not found after 3 attempts`,
    });
    const b = computeErrorFingerprint({
      source: 'SERVER',
      routePath: '/app/sales/[id]/page',
      message: `Cash sale ${SALE_B} not found after 7 attempts`,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-z]{1,32}$/);
  });

  it('groups an action failure by action and code, not by message', () => {
    const a = computeErrorFingerprint({
      source: 'ACTION',
      name: 'cashSale.acceptCashSaleTerms',
      errorCode: 'STALE_TERMS',
      message: 'The contract changed.',
    });
    const b = computeErrorFingerprint({
      source: 'ACTION',
      name: 'cashSale.acceptCashSaleTerms',
      errorCode: 'STALE_TERMS',
      message: 'Something else entirely.',
    });
    const other = computeErrorFingerprint({
      source: 'ACTION',
      name: 'cashSale.acceptCashSaleTerms',
      errorCode: 'REGION_MISMATCH',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(other);
  });

  it('templates concrete paths so one bug on many listings is one group', () => {
    const a = computeErrorFingerprint({ source: 'CLIENT', path: `/listings/${SALE_A}`, message: 'x is undefined' });
    const b = computeErrorFingerprint({ source: 'CLIENT', path: `/listings/${SALE_B}`, message: 'x is undefined' });
    expect(a).toBe(b);
  });
});

describe('normalizeErrorMessage', () => {
  it('keeps the first line and strips ids, numbers and quoted values', () => {
    expect(
      normalizeErrorMessage(`Cannot read properties of undefined (reading 'price')\n    at Foo`),
    ).toBe('Cannot read properties of undefined (reading …)');
    expect(normalizeErrorMessage(`sale ${SALE_A} failed 12 times`)).toBe('sale :id failed N times');
  });
});

describe('isExpectedFailureCode', () => {
  it('treats guards as expected, in either spelling', () => {
    for (const code of [
      'not-authenticated',
      'NOT_AUTHENTICATED',
      'validation-error',
      'VALIDATION',
      'STALE_TERMS',
      'REGION_MISMATCH',
      'SELLER_IDENTITY_UNVERIFIED',
      'BUYER_CONFIRMATION_REQUIRED',
      'rate-limited',
      'item-unavailable',
      'SELF_PURCHASE',
      'not-found',
    ]) {
      expect(isExpectedFailureCode(code), code).toBe(true);
    }
  });

  it('treats breakages as unexpected', () => {
    for (const code of [
      'persistence-error',
      'PROVIDER_ERROR',
      'UPDATE_FAILED',
      'PAYOUT_FAILED',
      'TRANSFER_FAILED',
      'hold-failed',
      'SIGN_OUT_INCOMPLETE',
      'ELIGIBILITY_UNREADABLE',
    ]) {
      expect(isExpectedFailureCode(code), code).toBe(false);
    }
  });

  it('surfaces a code it has never seen rather than filing it away', () => {
    expect(isExpectedFailureCode('rejected')).toBe(false);
    expect(isExpectedFailureCode('something-new')).toBe(false);
    expect(isExpectedFailureCode(null)).toBe(false);
  });
});

describe('sanitizeErrorPath', () => {
  it('drops the query string and keeps ids', () => {
    expect(sanitizeErrorPath(`/sales/${SALE_A}?tab=payment#top`)).toBe(`/sales/${SALE_A}`);
  });

  it('redacts an invite token, which is a capability', () => {
    expect(sanitizeErrorPath('/t/abcDEF123secret')).toBe('/t/[token]');
  });

  it('reduces a referer URL to its path and refuses non-paths', () => {
    expect(sanitizeErrorPath('https://noditto.app/listings/mine?x=1')).toBe('/listings/mine');
    expect(sanitizeErrorPath('javascript:alert(1)')).toBeNull();
    expect(sanitizeErrorPath(42)).toBeNull();
  });
});

describe('extractIdContext', () => {
  it('keeps uuid-valued id fields and version numbers, nothing else', () => {
    expect(
      extractIdContext([
        {
          cashSaleId: SALE_A,
          termsVersion: 4,
          note: 'my address is 1 Example St',
          priceCents: 12_000,
          itemId: 'not-a-uuid',
        },
      ]),
    ).toEqual({ cashSaleId: SALE_A, termsVersion: 4 });
  });

  it('accepts a bare uuid argument and FormData', () => {
    const form = new FormData();
    form.set('tradeId', SALE_B);
    form.set('message', 'hello');
    expect(extractIdContext([SALE_A, form])).toEqual({ arg0: SALE_A, tradeId: SALE_B });
  });

  it('returns null when there is nothing identifying', () => {
    expect(extractIdContext([{ message: 'hi' }, 'plain text', 3])).toBeNull();
  });
});

describe('isIgnorableClientError', () => {
  it('drops well-known browser noise', () => {
    expect(isIgnorableClientError({ message: 'ResizeObserver loop completed with undelivered notifications.' })).toBe(true);
    expect(isIgnorableClientError({ message: 'Script error.' })).toBe(true);
    expect(isIgnorableClientError({ message: 'x', stack: 'at chrome-extension://abc/content.js:1:1' })).toBe(true);
    expect(isIgnorableClientError({ message: 'NEXT_REDIRECT;replace;/sign-in' })).toBe(true);
  });

  it('keeps a real error from the app', () => {
    expect(
      isIgnorableClientError({
        message: "TypeError: Cannot read properties of undefined (reading 'id')",
        stack: 'at onClick (https://noditto.app/_next/static/chunks/app.js:1:2)',
      }),
    ).toBe(false);
  });
});

describe('buildErrorLogRecord', () => {
  it('produces a row every constraint in 0123 accepts', () => {
    const record = buildErrorLogRecord({
      source: 'ACTION',
      name: 'cashSale.acceptCashSaleTerms',
      errorCode: 'STALE_TERMS',
      message: '  The contract changed.  ',
      path: `/sales/${SALE_A}?tab=terms`,
      context: { cashSaleId: SALE_A },
    });
    expect(record).toMatchObject({
      source: 'ACTION',
      expected: true,
      message: 'The contract changed.',
      path: `/sales/${SALE_A}`,
      context: { cashSaleId: SALE_A },
    });
  });

  it('never marks a thrown or background failure as expected', () => {
    expect(buildErrorLogRecord({ source: 'SERVER', message: 'boom', errorCode: 'not-found' }).expected).toBe(false);
    expect(buildErrorLogRecord({ source: 'BACKGROUND', name: 'payout.seller', errorCode: 'SELLER_NOT_PAYABLE', message: 'x' }).expected).toBe(false);
  });

  it('fills the fields a source must carry instead of dropping the row', () => {
    const action = buildErrorLogRecord({ source: 'ACTION' });
    expect(action.name).toBe('unknown-action');
    expect(action.errorCode).toBe('unknown');
    expect(action.message).toBe('(no message)');
    expect(buildErrorLogRecord({ source: 'BACKGROUND', message: 'x' }).name).toBe('unknown-job');
  });

  it('bounds oversized fields rather than rejecting them', () => {
    const record = buildErrorLogRecord({ source: 'SERVER', message: 'm'.repeat(5000), stack: 's'.repeat(20_000) });
    expect(record.message).toHaveLength(2000);
    expect(record.stack).toHaveLength(8000);
  });

  it('copies a supplied fingerprint so a report joins its error', () => {
    const record = buildErrorLogRecord({ source: 'REPORT', reference: 'c-abc123', fingerprint: 'k2x9' });
    expect(record.fingerprint).toBe('k2x9');
    expect(record.message).toBeNull();
  });
});
