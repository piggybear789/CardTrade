import { z } from 'zod';
import { runSchema, type ValidationResult } from './result';

/** Maximum length for any profile text field (Req 1.4, 1.5). */
export const PROFILE_TEXT_MAX_LENGTH = 255;

/** A required profile text field: non-empty and at most 255 characters. */
const profileTextField = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .min(1, `${label} must not be empty`)
    .max(PROFILE_TEXT_MAX_LENGTH, `${label} must be at most ${PROFILE_TEXT_MAX_LENGTH} characters`);

/** Zod schema for a profile update. Exported for direct testing. */
export const profileUpdateSchema = z.object({
  displayName: profileTextField('Display name'),
  contactEmail: profileTextField('Contact email'),
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
