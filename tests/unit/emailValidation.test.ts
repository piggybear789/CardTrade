// tests/unit/emailValidation.test.ts
//
// The two email rules and the line between them.
//
// THE REGRESSION THIS PINS. `phil@gm` used to pass sign-up. It then became
// `profiles.contact_email`, and payout onboarding sends that verbatim as the connected
// account's `contact_email`, where Stripe refuses it with `email_invalid`. Because
// account creation failed, no `merchant_ref` was ever stored — so the member retried
// forever against the same stored value with only a raw provider string to go on.
//
// THE ASYMMETRY IS DELIBERATE AND IS THE MOST IMPORTANT THING HERE. Sign-UP requires a
// deliverable address so the bad value cannot enter. Sign-IN keeps the permissive shape
// check, because accounts ALREADY hold addresses like `phil@gm` and tightening sign-in
// would lock them out of the one screen that can fix it. If someone "simplifies" these
// to a single rule, the sign-in case below is what should stop them.

import { describe, expect, it } from 'vitest';

import {
  isDeliverableEmail,
  registrationCredentialsSchema,
  signUpCredentialsSchema,
} from '@/domain/validation/registration';
import { profileUpdateSchema } from '@/domain/validation/profile';

const PASSWORD = 'correct-horse-battery';

describe('isDeliverableEmail', () => {
  it('rejects a domain with no dot — the reported failure', () => {
    expect(isDeliverableEmail('phil@gm')).toBe(false);
  });

  it.each([
    'phil@gmail.com',
    'phil.young@example.co.uk',
    'phil+tag@example.io',
    'a@b.co',
  ])('accepts %s', (email) => {
    expect(isDeliverableEmail(email)).toBe(true);
  });

  it.each([
    ['no @ at all', 'notanemail'],
    ['empty local part', '@example.com'],
    ['empty domain', 'phil@'],
    ['bare dot domain', 'phil@.com'],
    ['trailing dot', 'phil@example.'],
    ['consecutive dots', 'phil@example..com'],
    ['single-character TLD', 'phil@example.c'],
    ['numeric TLD', 'phil@192.168.0.1'],
    ['whitespace inside', 'phil young@example.com'],
    ['two @', 'phil@@example.com'],
  ])('rejects %s', (_label, email) => {
    expect(isDeliverableEmail(email)).toBe(false);
  });

  it('trims surrounding whitespace before judging', () => {
    expect(isDeliverableEmail('  phil@gmail.com  ')).toBe(true);
  });
});

describe('sign-up requires a deliverable address', () => {
  it('refuses phil@gm so it never reaches contact_email', () => {
    const result = signUpCredentialsSchema.safeParse({
      email: 'phil@gm',
      password: PASSWORD,
    });
    expect(result.success).toBe(false);
  });

  it('names the email field and says what a complete address looks like', () => {
    const result = signUpCredentialsSchema.safeParse({
      email: 'phil@gm',
      password: PASSWORD,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0];
    expect(issue.path).toEqual(['email']);
    // Actionable, and shows the shape rather than naming a regex.
    expect(issue.message).toMatch(/you@example\.com/);
  });

  it('stores a trimmed address', () => {
    const result = signUpCredentialsSchema.safeParse({
      email: '  phil@gmail.com ',
      password: PASSWORD,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.email).toBe('phil@gmail.com');
  });
});

describe('sign-in stays permissive so legacy accounts are not locked out', () => {
  // THE LOCKOUT GUARD. A member who registered `phil@gm` before the sign-up rule must
  // still be able to authenticate — otherwise they cannot reach the profile screen that
  // corrects it, and the dead end this whole change removes simply moves to the door.
  it('still accepts an address that sign-up would now refuse', () => {
    expect(
      registrationCredentialsSchema.safeParse({ email: 'phil@gm', password: PASSWORD })
        .success,
    ).toBe(true);
  });

  it('still rejects something that is not an email at all', () => {
    expect(
      registrationCredentialsSchema.safeParse({ email: 'notanemail', password: PASSWORD })
        .success,
    ).toBe(false);
  });
});

describe('profile contact email uses the same rule as sign-up', () => {
  it('refuses phil@gm', () => {
    const result = profileUpdateSchema.safeParse({
      displayName: 'Phil',
      contactEmail: 'phil@gm',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path).toEqual(['contactEmail']);
  });

  it('refuses the generic text that used to pass', () => {
    // This field was validated as any non-empty string up to 255 chars, which is how
    // unusable values reached the column in the first place.
    expect(
      profileUpdateSchema.safeParse({ displayName: 'Phil', contactEmail: 'notanemail' })
        .success,
    ).toBe(false);
  });

  it('accepts a deliverable address, so the recovery path works', () => {
    expect(
      profileUpdateSchema.safeParse({
        displayName: 'Phil',
        contactEmail: 'phil@gmail.com',
      }).success,
    ).toBe(true);
  });
});
