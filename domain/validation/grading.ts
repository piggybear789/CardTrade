// domain/validation/grading.ts
//
// A graded listing's slab details: grader, grade and cert number (0129).
//
// Kept beside `itemSubmissionSchema` rather than inside it because it applies to one
// condition only and is optional for callers that predate it: the Flutter app and the
// mobile API send no grading, and a graded listing from them is stored without the
// details rather than refused. The web form always sends it, and for it a graded
// listing must name its grader and grade.

import {
  CERT_NUMBER_PATTERN,
  GRADE_MAX_LENGTH,
  isGrader,
} from '@/lib/catalog/graders';

/** The slab details as stored. All null for a raw card. */
export interface ItemGrading {
  grader: string | null;
  grade: string | null;
  certNumber: string | null;
}

/** What a caller sends. Every field optional; see the module note. */
export interface ItemGradingInput {
  grader?: string | null;
  grade?: string | null;
  certNumber?: string | null;
}

export const NO_GRADING: ItemGrading = { grader: null, grade: null, certNumber: null };

export type GradingResult =
  | { ok: true; value: ItemGrading }
  | { ok: false; field: 'grader' | 'grade' | 'certNumber'; message: string };

/**
 * Normalise slab details against the listing's condition.
 *
 * A raw (non-Graded) listing stores none, whatever was sent — so switching a listing
 * from Graded to Near Mint clears them. A Graded listing with `input` undefined (an
 * older client) stores none too. Otherwise grader and grade are required and the cert,
 * when given, must look like one.
 */
export function normalizeGrading(
  condition: string,
  input: ItemGradingInput | undefined,
): GradingResult {
  if (condition !== 'Graded' || input === undefined) return { ok: true, value: NO_GRADING };

  const grader = input.grader?.trim() ?? '';
  if (!isGrader(grader)) {
    return { ok: false, field: 'grader', message: 'Choose who graded the card.' };
  }
  const grade = input.grade?.trim() ?? '';
  if (!grade) return { ok: false, field: 'grade', message: 'Enter the grade on the label.' };
  if (grade.length > GRADE_MAX_LENGTH) {
    return { ok: false, field: 'grade', message: `Keep the grade under ${GRADE_MAX_LENGTH} characters.` };
  }
  const cert = input.certNumber?.trim() ?? '';
  if (cert && !CERT_NUMBER_PATTERN.test(cert)) {
    return {
      ok: false,
      field: 'certNumber',
      message: 'A cert number is 4 to 20 letters, digits or dashes.',
    };
  }
  return { ok: true, value: { grader, grade, certNumber: cert || null } };
}
