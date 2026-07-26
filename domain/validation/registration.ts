import { z } from 'zod';
import { runSchema, type ValidationResult } from './result';

/**
 * Password length bounds for registration credentials (Req 1.1, 1.3).
 * Both bounds are inclusive.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Matches a syntactically valid `local-part@domain` email form: a non-empty
 * local part with no whitespace or `@`, a single `@`, then a non-empty domain
 * with no whitespace or `@` (Req 1.1, 1.3).
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+$/;

/** Zod schema for registration credentials. Exported for direct testing. */
export const registrationCredentialsSchema = z.object({
  email: z
    .string({ error: 'Email is required' })
    .regex(EMAIL_REGEX, 'Email must be in local-part@domain format'),
  password: z
    .string({ error: 'Password is required' })
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`),
});

export type RegistrationCredentials = z.infer<typeof registrationCredentialsSchema>;

/**
 * Validates registration credentials, returning a discriminated result.
 * On failure the invalid field (`email` or `password`) is identified.
 */
export function validateRegistrationCredentials(
  input: unknown,
): ValidationResult<RegistrationCredentials> {
  return runSchema(registrationCredentialsSchema, input);
}
