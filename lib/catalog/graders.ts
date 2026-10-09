// lib/catalog/graders.ts
//
// The grading companies a slab can come from, and where a buyer can check a cert.
//
// A graded listing used to carry only "Graded" as its condition: the grader, the grade
// and the cert number lived in the title or the photo, so a buyer could not filter on
// them or check the slab against the grader's registry without retyping the number.

export const GRADERS = ['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'Other'] as const;

export type Grader = (typeof GRADERS)[number];

export function isGrader(value: unknown): value is Grader {
  return typeof value === 'string' && (GRADERS as readonly string[]).includes(value);
}

/** Longest grade label accepted, e.g. "Black Label 10" or "9.5". */
export const GRADE_MAX_LENGTH = 20;

/** A cert number: letters, digits and dashes, as the graders print them. */
export const CERT_NUMBER_PATTERN = /^[A-Za-z0-9-]{4,20}$/;

/**
 * The grader's own cert lookup for this slab, or null where we do not know a stable
 * deep link. PSA's is a documented, public URL shape; the others are left out rather
 * than guessed, and the listing shows the number for the buyer to check.
 */
export function certVerifyUrl(grader: string | null, certNumber: string | null): string | null {
  if (!grader || !certNumber) return null;
  if (grader === 'PSA') return `https://www.psacard.com/cert/${encodeURIComponent(certNumber)}`;
  return null;
}
