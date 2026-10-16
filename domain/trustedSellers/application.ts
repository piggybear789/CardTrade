// domain/trustedSellers/application.ts
//
// What a Trusted Seller application contains (0153): one free-text answer and up to a
// handful of photos. Mirrors the CHECKs on `trusted_seller_reviews` so a bad submission
// is refused with a field and a message before the database refuses it with neither.
//
// Deliberately loose. The review is done by hand, so the form asks one open question
// rather than guessing which platforms or facts matter for every seller.
//
// Pure: no Supabase, React or service imports.

export const APPLICATION_DETAILS_MIN = 20;
export const APPLICATION_DETAILS_MAX = 4000;
export const APPLICATION_PHOTOS_MAX = 10;

export interface TrustedSellerApplicationInput {
  details: string;
  photoPaths: string[];
}

export type ApplicationValidation =
  | { ok: true; value: { details: string; photoPaths: string[] } }
  | { ok: false; field: 'details' | 'photos'; message: string };

/**
 * Validate an application. `ownerPrefix` is `<profileId>/`: a photo path outside it is
 * not this applicant's upload and is refused, so nobody can attach someone else's file.
 */
export function validateTrustedSellerApplication(
  input: TrustedSellerApplicationInput,
  ownerPrefix: string,
): ApplicationValidation {
  const details = typeof input?.details === 'string' ? input.details.trim() : '';
  if (details.length < APPLICATION_DETAILS_MIN) {
    return {
      ok: false,
      field: 'details',
      message: 'Tell us a bit more: where you sell, for how long, and who can vouch for you.',
    };
  }
  if (details.length > APPLICATION_DETAILS_MAX) {
    return {
      ok: false,
      field: 'details',
      message: `Keep it under ${APPLICATION_DETAILS_MAX.toLocaleString('en-AU')} characters.`,
    };
  }

  const photoPaths = [...new Set(Array.isArray(input?.photoPaths) ? input.photoPaths : [])].filter(
    (path): path is string => typeof path === 'string' && path.length > 0,
  );
  if (photoPaths.length > APPLICATION_PHOTOS_MAX) {
    return { ok: false, field: 'photos', message: `Add up to ${APPLICATION_PHOTOS_MAX} photos.` };
  }
  if (photoPaths.some((path) => !path.startsWith(ownerPrefix) || path.includes('..'))) {
    return { ok: false, field: 'photos', message: 'One of those photos could not be attached.' };
  }

  return { ok: true, value: { details, photoPaths } };
}
