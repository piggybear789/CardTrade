// lib/location/publicLocation.ts
//
// What a listing shows of where the goods are: the suburb and state, never a street.
//
// Listings are suburb-level by design (product.md, "Location is suburb-level"), and the
// form's place picker asks for a suburb. But the stored label is whatever was picked or
// typed, and a seller (or the e2e place stub) can land a full street address there:
// "12 Test Street, Sydney NSW 2000, Australia". Anything shown to other people goes
// through this, so a street number never reaches a listing, a preview or a tile.

/**
 * "12 Test Street, Sydney NSW 2000, Australia" -> "Sydney NSW".
 * "Sydney NSW, Australia" -> "Sydney NSW". "Berlin, Germany" -> "Berlin".
 *
 * Drops a leading part that starts with a street number, the trailing country, and a
 * postcode. Returns null for nothing usable, so callers omit the line rather than
 * print an empty one.
 */
export function publicLocationLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const parts = label
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  // A street line starts with a number or a unit ("12 Test Street", "3/14 King St").
  while (parts.length > 1 && /^\d/.test(parts[0])) parts.shift();
  // The country is the last part whenever there is more than one.
  if (parts.length > 1) parts.pop();
  const place = parts[0]
    ?.replace(/\b\d{3,}\b/g, '') // postcodes: 2000, 10115, 90210
    .replace(/\s{2,}/g, ' ')
    .trim();
  return place || null;
}
