import { z } from 'zod';
import { runSchema, type ValidationResult } from './result';

/**
 * Password length bounds for registration credentials (Req 1.1, 1.3).
 * Both bounds are inclusive.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * SHAPE ONLY: a non-empty local part, a single `@`, a non-empty domain — no
 * whitespace anywhere (Req 1.1, 1.3).
 *
 * DELIBERATELY PERMISSIVE, AND IT MUST STAY THAT WAY, because this is the rule
 * SIGN-IN uses. It accepts `phil@gm`, which is not a deliverable address — and that
 * is the point: accounts already exist with addresses like that (nothing stopped
 * them being created), and sign-in validation exists only to turn an empty or
 * obviously malformed submission into a field-level error instead of a generic auth
 * failure. Tightening it here would lock those members out of the very screen they
 * need in order to correct their address, which is strictly worse than letting them
 * in and asking them to fix it.
 *
 * For anything that has to be REACHABLE — sign-up, the profile contact email, the
 * address put on a Stripe account — use {@link isDeliverableEmail}.
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+$/;

/**
 * A DELIVERABLE address: `local@label(.label)*.tld`, with a dotted domain and an
 * alphabetic TLD of at least two characters.
 *
 * WHY THIS IS SEPARATE FROM {@link EMAIL_REGEX}. The two answer different questions.
 * That one asks "is this shaped like an email", which is all sign-in needs. This one
 * asks "could a message actually reach this, and will the payment provider accept
 * it" — and it is the rule for every path that CREATES or CHANGES a stored address.
 *
 * It rejects `phil@gm`, which is the concrete failure this exists for: that value
 * passed sign-up, became `profiles.contact_email`, and was then sent verbatim as a
 * connected account's `contact_email`, where Stripe refused it with `email_invalid`.
 * Because account creation failed, no `merchant_ref` was ever stored, so the member
 * retried forever against the same bad value.
 *
 * It cannot prove deliverability — `phil@gmailll.com` passes — so it is a floor, not
 * a guarantee. The actual proof is the confirmation email Supabase sends at sign-up.
 */
export const DELIVERABLE_EMAIL_REGEX =
  /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[A-Za-z]{2,}$/;

/** Whether `value` is a deliverable address. Trims first; storage should too. */
export function isDeliverableEmail(value: string): boolean {
  return DELIVERABLE_EMAIL_REGEX.test(value.trim());
}

const passwordField = z
  .string({ error: 'Password is required' })
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

/**
 * Zod schema for SIGN-IN credentials — shape only. Exported for direct testing.
 *
 * Keeps {@link EMAIL_REGEX} so a member whose stored address predates
 * {@link signUpCredentialsSchema} can still authenticate and go fix it.
 */
export const registrationCredentialsSchema = z.object({
  email: z
    .string({ error: 'Email is required' })
    .regex(EMAIL_REGEX, 'Email must be in local-part@domain format'),
  password: passwordField,
});

export type RegistrationCredentials = z.infer<typeof registrationCredentialsSchema>;

/**
 * Zod schema for SIGN-UP credentials — requires a deliverable address.
 *
 * This is the gate that stops an unreachable address entering the system at all.
 * `profiles.contact_email` is seeded from this value and later becomes the connected
 * account's contact email, so every downstream check is a backstop to this one.
 */
export const signUpCredentialsSchema = z.object({
  email: z
    .string({ error: 'Email is required' })
    .trim()
    .regex(
      DELIVERABLE_EMAIL_REGEX,
      'Enter a complete email address, including the domain — like you@example.com',
    ),
  password: passwordField,
});

export type SignUpCredentials = z.infer<typeof signUpCredentialsSchema>;

/**
 * Validates SIGN-IN credentials, returning a discriminated result.
 * On failure the invalid field (`email` or `password`) is identified.
 */
export function validateRegistrationCredentials(
  input: unknown,
): ValidationResult<RegistrationCredentials> {
  return runSchema(registrationCredentialsSchema, input);
}

/** Validates SIGN-UP credentials, requiring a deliverable email address. */
export function validateSignUpCredentials(
  input: unknown,
): ValidationResult<SignUpCredentials> {
  return runSchema(signUpCredentialsSchema, input);
}
