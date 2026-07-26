import { z } from 'zod';
import { runSchema, type ValidationResult } from './result';

/** Item title length bounds, inclusive (Req 3.1, 3.3). */
export const TITLE_MIN_LENGTH = 1;
export const TITLE_MAX_LENGTH = 120;

/** Item description length bounds, inclusive (Req 3.1, 3.3). */
export const DESCRIPTION_MIN_LENGTH = 1;
export const DESCRIPTION_MAX_LENGTH = 2000;

/**
 * Fair Market Value bounds as integer AUD cents, inclusive.
 * 1 cent (0.01 AUD) .. 99,999,999,999 cents (999,999,999.99 AUD) (Req 3.1, 3.2).
 */
export const FMV_MIN_CENTS = 1;
export const FMV_MAX_CENTS = 99_999_999_999;

/** Image count bounds, inclusive (Req 3.1, 3.3). */
export const IMAGES_MIN = 1;
export const IMAGES_MAX = 10;

/** Zod schema for an item submission. Exported for direct testing. */
export const itemSubmissionSchema = z.object({
  title: z
    .string({ error: 'Title is required' })
    .min(TITLE_MIN_LENGTH, `Title must be at least ${TITLE_MIN_LENGTH} character`)
    .max(TITLE_MAX_LENGTH, `Title must be at most ${TITLE_MAX_LENGTH} characters`),
  description: z
    .string({ error: 'Description is required' })
    .min(DESCRIPTION_MIN_LENGTH, `Description must be at least ${DESCRIPTION_MIN_LENGTH} character`)
    .max(DESCRIPTION_MAX_LENGTH, `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`),
  category: z
    .string({ error: 'Category is required' })
    .min(1, 'Category is required'),
  condition: z
    .string({ error: 'Condition is required' })
    .min(1, 'Condition is required'),
  fmvCents: z
    .number({ error: 'Fair market value is required' })
    .int('Fair market value must be an integer number of cents')
    .min(FMV_MIN_CENTS, `Fair market value must be at least ${FMV_MIN_CENTS} cent`)
    .max(FMV_MAX_CENTS, `Fair market value must be at most ${FMV_MAX_CENTS} cents`),
  images: z
    .array(z.string().min(1, 'Image reference must not be empty'), {
      error: 'Images are required',
    })
    .min(IMAGES_MIN, `At least ${IMAGES_MIN} image is required`)
    .max(IMAGES_MAX, `At most ${IMAGES_MAX} images are allowed`),
});

export type ItemSubmission = z.infer<typeof itemSubmissionSchema>;

/**
 * Validates an item submission, returning a discriminated result.
 * On failure the first invalid field (title, description, category, condition,
 * fmvCents, or images) is identified (Req 3.2, 3.3).
 */
export function validateItemSubmission(input: unknown): ValidationResult<ItemSubmission> {
  return runSchema(itemSubmissionSchema, input);
}
