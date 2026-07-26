import type { ZodType } from 'zod';

/**
 * Discriminated validation result used across the domain validation layer.
 *
 * On success the parsed/typed value is returned; on failure the first invalid
 * field is identified along with a human-readable message so the UI can surface
 * the error inline (Req 1.3, 1.5, 3.2, 3.3).
 */
export type ValidationSuccess<T> = { ok: true; value: T };
export type ValidationFailure = { ok: false; field: string; message: string };
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/** Field name reported when a validation issue has no associated path. */
export const ROOT_FIELD = '(root)';

/**
 * Runs a zod schema over an input and maps the first issue to a discriminated
 * `{ ok: false, field, message }` failure. On success returns `{ ok: true, value }`.
 *
 * The first issue is used because callers surface one field error at a time and
 * the acceptance criteria only require that *an* invalid field be identified.
 */
export function runSchema<T>(schema: ZodType<T>, input: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  const [issue] = parsed.error.issues;
  const field =
    issue && issue.path.length > 0
      ? issue.path.map((segment) => String(segment)).join('.')
      : ROOT_FIELD;
  const message = issue?.message ?? 'Invalid input';

  return { ok: false, field, message };
}
