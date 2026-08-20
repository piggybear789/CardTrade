import { z } from 'zod';
import { isDeliverableEmail } from './registration';
import { runSchema, type ValidationResult } from './result';

/** Maximum length for any profile text field (Req 1.4, 1.5). */
export const PROFILE_TEXT_MAX_LENGTH = 255;

/** A required profile text field: non-empty and at most 255 characters. */
const profileTextField = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .min(1, `${label} must not be empty`)
    .max(PROFILE_TEXT_MAX_LENGTH, `${label} must be at most ${PROFILE_TEXT_MAX_LENGTH} characters`);

/**
 * Zod schema for a profile update. Exported for direct testing.
 *
 * `contactEmail` uses {@link isDeliverableEmail} — the SAME rule sign-up enforces —
 * rather than a second definition of its own. It was validated as GENERIC TEXT (any
 * non-empty string up to 255 chars) until this change, which is how `phil@gm` and even
 * `notanemail` reached the column. That matters because the value is passed verbatim as
 * the connected account's `contact_email` during payout onboarding, and Stripe refuses
 * a malformed one with `email_invalid` — leaving no `merchant_ref`, so the member
 * retried forever against the same stored value.
 *
 * Editing remains the RECOVERY path for an address that predates the sign-up rule, so
 * this must reject the bad value while still being reachable by the member holding it.
 */
export const profileUpdateSchema = z.object({
  displayName: profileTextField('Display name'),
  contactEmail: profileTextField('Contact email').refine(isDeliverableEmail, {
    error: 'Enter a complete email address, including the domain — like you@example.com',
  }),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/**
 * Validates a profile update, returning a discriminated result.
 * On failure the invalid field is identified; callers retain the previously
 * stored profile values when the result is a failure (Req 1.5).
 */
export function validateProfileUpdate(input: unknown): ValidationResult<ProfileUpdate> {
  return runSchema(profileUpdateSchema, input);
}
