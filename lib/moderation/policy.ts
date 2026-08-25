// lib/moderation/policy.ts
//
// Pure allow/reject rules for Amazon Rekognition DetectModerationLabels.
// Tuned for a trading-card marketplace: sword-and-sorcery art, sports swimwear,
// and "playing cards" gambling labels must not block a listing. The only hard
// stop is high-confidence photographic explicit content, plus illustrated
// genitalia / sexual activity (that is not a TCG photo).
//
// Rekognition does not detect CSAM; this policy does not claim to.

export const IMAGE_REJECTED_USER_MESSAGE =
  'That photo could not be used. Please upload a clear photo of the card or item.';

/** Labels that mean real sexual content, including on illustrated frames. */
const EXPLICIT_ALWAYS_BLOCK = new Set([
  'Explicit Sexual Activity',
  'Sex Toys',
  'Exposed Male Genitalia',
  'Exposed Female Genitalia',
]);

/**
 * Minimum Rekognition confidence before a label can reject an upload.
 * AWS recommends ≥50 to limit false positives; we sit higher because card art
 * otherwise trips Weapons, Violence, and Swimwear constantly.
 */
export const MODERATION_MIN_CONFIDENCE = 80;

export interface ModerationLabelInput {
  Name?: string;
  Confidence?: number;
  ParentName?: string;
}

export interface ModerationDecisionInput {
  labels: ModerationLabelInput[];
  contentTypes?: unknown;
}

function contentTypeName(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && 'Name' in entry) {
    const name = (entry as { Name?: unknown }).Name;
    return typeof name === 'string' ? name : '';
  }
  return '';
}

/** True when Rekognition classified the frame as drawing, anime, manga, or similar. */
export function isIllustratedContent(contentTypes: unknown): boolean {
  if (!Array.isArray(contentTypes)) return false;
  for (const entry of contentTypes) {
    const name = contentTypeName(entry);
    if (name === 'Illustrated' || name === 'Animated') return true;
  }
  return false;
}

function isExplicitFamily(name: string, parent: string): boolean {
  if (name === 'Explicit' || parent === 'Explicit') return true;
  if (name === 'Explicit Nudity' || parent === 'Explicit Nudity') return true;
  if (EXPLICIT_ALWAYS_BLOCK.has(name)) return true;
  return name === 'Exposed Female Nipple' || name === 'Exposed Buttocks or Anus';
}

/**
 * Decide whether a Rekognition response should reject the upload.
 *
 * Weapons, Violence, Visually Disturbing, Swimwear, Gambling, Alcohol, Drugs,
 * Tobacco, Rude Gestures, Hate Symbols, and Non-Explicit Nudity are ignored —
 * those are the labels that fire on Magic, Pokémon, Flesh and Blood, and sports
 * cards. Suggestive illustrated art (nipples, implied nudity) is also allowed.
 */
export function decideImageModeration(
  input: ModerationDecisionInput,
): 'allow' | 'reject' {
  const illustrated = isIllustratedContent(input.contentTypes);

  for (const label of input.labels) {
    const name = label.Name ?? '';
    const parent = label.ParentName ?? '';
    const confidence = label.Confidence ?? 0;
    if (confidence < MODERATION_MIN_CONFIDENCE) continue;
    if (!isExplicitFamily(name, parent)) continue;

    if (EXPLICIT_ALWAYS_BLOCK.has(name)) return 'reject';

    // Illustrated / anime card art often lands on Explicit or Exposed Female
    // Nipple. Photographic frames with those labels are the thing we block.
    if (illustrated) continue;

    return 'reject';
  }

  return 'allow';
}

export class ImageRejectedError extends Error {
  readonly code = 'image-rejected' as const;

  constructor() {
    super(IMAGE_REJECTED_USER_MESSAGE);
    this.name = 'ImageRejectedError';
  }
}
