// tests/unit/offPlatformSignals.test.ts
//
// ESC-27: conservative detection. Lures match; card talk does not.

import { describe, expect, it } from 'vitest';

import { offPlatformSignals } from '@/domain/messages/offPlatformSignals';

describe('offPlatformSignals', () => {
  it.each([
    ['Just PayID me and I will post today', 'PAYMENT_RAIL'],
    ['paypal friends and family is cheaper', 'PAYMENT_RAIL'],
    ['text me on 0412 345 678', 'PHONE_NUMBER'],
    ['call +61 412 345 678', 'PHONE_NUMBER'],
    ['email me seller@example.com', 'EMAIL_ADDRESS'],
    ['hit me up on WhatsApp', 'MESSAGING_APP'],
    ['BSB 062-000 account number 12345678', 'BANK_DETAILS'],
  ])('flags %s', (body, signal) => {
    expect(offPlatformSignals(body)).toContain(signal);
  });

  it.each([
    'Is SV01-123 still available?',
    'Card number 4/102, holo, near mint',
    'PSA 10, cert 81234567',
    'Would you take $120 for the pair?',
    'I can post it tomorrow with tracking',
    '',
  ])('does not flag %s', (body) => {
    expect(offPlatformSignals(body)).toEqual([]);
  });
});
