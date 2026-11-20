// domain/references/externalSeller.ts
//
// References (0155, 0170): a seller's track record on ANOTHER platform. eBay first.
//
// A handle with no reference post can still be a known quantity: years of eBay feedback
// say a lot. This module is the pure half of showing it: which eBay usernames a handle
// could be, how closely a username matches it, what eBay's seller object means, what a
// staff decision must contain, and how the numbers read. The calls to eBay and the
// database are in `lib/references/ebaySeller.ts` and `lib/references/trackRecord.ts`.
//
// A NAME MATCH IS A LEAD, NEVER A LINK. Anyone can register `serialcollect_` on eBay, and
// a scammer can copy a known seller's handle to borrow their record. `nameRelation` says
// how alike two names are and nothing more; a link exists only because a member signed in
// to both accounts or an admin checked and wrote down what they saw.
//
// ONE DELIBERATE EXCEPTION, outside this module: the references page draws and counts the
// feedback of the eBay account its footprint check found by username, linked or not
// (`lib/references/ebayReferences.ts`). That is a product decision; every such card names
// the eBay account it came from so a reader can check it is the same person.
//
// Pure: no Supabase, React or service imports.

import { isValidClaimHandle } from '@/domain/references/reference';

/** Platforms whose public record can be shown beside a handle's references. */
export const EXTERNAL_PLATFORMS = ['ebay'] as const;
export type ExternalPlatform = (typeof EXTERNAL_PLATFORMS)[number];

export function isExternalPlatform(value: unknown): value is ExternalPlatform {
  return typeof value === 'string' && (EXTERNAL_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Why a record is shown on a handle's page.
 * - `OWNER_CLAIMED`: the member signed in to the eBay account themselves (the 0155 claim
 *   flow), so the account is theirs and no staff step is involved.
 * - `STAFF_CHECKED`: an admin checked both accounts and wrote down what they saw (0170).
 */
export type ExternalLinkProof = 'OWNER_CLAIMED' | 'STAFF_CHECKED';

export function externalProofLabel(proof: ExternalLinkProof): string {
  return proof === 'OWNER_CLAIMED' ? 'The member signed in to this account' : 'Checked by NoDitto staff';
}

/** eBay's seller figures, as eBay reports them. Both are null when eBay omits one. */
export interface EbayFeedback {
  /** Share of feedback that is positive, 0 to 100. */
  feedbackPercentage: number | null;
  /** eBay's net feedback score. */
  feedbackScore: number | null;
  accountType: 'BUSINESS' | 'INDIVIDUAL' | null;
}

/**
 * What reading an account's public record returned, as of a moment.
 * - `FOUND`: eBay returned the account's figures.
 * - `NO_LISTINGS`: eBay shows a seller's feedback only through their live listings, and
 *   none were found. That says nothing about the seller's record: it is never "no feedback".
 * - `UNAVAILABLE`: eBay did not answer, or is not configured here.
 */
export type ExternalRecordState =
  | { state: 'FOUND'; stats: EbayFeedback; asOf: string }
  | { state: 'NO_LISTINGS'; asOf: string }
  | { state: 'UNAVAILABLE' };

/** One linked account on a handle's page: public fields only, never the staff note. */
export interface ExternalTrackRecord {
  platform: ExternalPlatform;
  username: string;
  profileUrl: string;
  proof: ExternalLinkProof;
  record: ExternalRecordState;
}

// ---------------------------------------------------------------------------
// Usernames
// ---------------------------------------------------------------------------

/** Whether `value` could be an eBay user ID (the same rule a claimed eBay handle follows). */
export function isValidEbayUsername(value: string): boolean {
  return isValidClaimHandle('ebay', value);
}

/** An eBay username without `@` and surrounding space, or null when it could not be one. */
export function normalizeEbayUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/^@/, '');
  return isValidEbayUsername(value) ? value : null;
}

/** A seller's public eBay page. `.com` serves every country's sellers. */
export function ebayProfileUrl(username: string): string {
  return `https://www.ebay.com/usr/${encodeURIComponent(username)}`;
}

const SEPARATORS = ['_', '.', '-'] as const;

/**
 * The eBay usernames a handle could be. Instagram, TikTok and eBay all allow different
 * punctuation, so `serialcollect` on one is often `serial_collect` on another. Candidates
 * are the handle, the handle with its punctuation removed, that with each separator
 * between every pair of letters, and the handle's own separators swapped. They are tested
 * against eBay in one request (it takes 250 names), so the list stays well under that.
 *
 * Lower case: eBay user IDs are not case sensitive.
 */
export function ebayUsernameVariants(handle: string, limit = 120): string[] {
  const base = handle.trim().replace(/^@/, '').toLowerCase();
  const squashed = base.replace(/[^a-z0-9]/g, '');
  const found = new Set<string>();
  const add = (value: string) => {
    if (found.size < limit && isValidEbayUsername(value)) found.add(value);
  };

  add(base);
  add(squashed);
  if (/[._-]/.test(base)) {
    for (const separator of ['_', '.', '-', '']) add(base.replace(/[._-]/g, separator));
  }
  // Every split of the squashed name with each separator, keeping two letters either side.
  if (squashed.length >= 4 && squashed.length <= 30) {
    for (const separator of SEPARATORS) {
      for (let at = 2; at <= squashed.length - 2; at++) {
        add(`${squashed.slice(0, at)}${separator}${squashed.slice(at)}`);
      }
    }
  }
  return Array.from(found);
}

/** How alike a handle and an eBay username are. Nothing more than that. */
export type NameRelation = 'EXACT' | 'SEPARATORS' | 'OTHER';

export function nameRelation(handle: string, username: string): NameRelation {
  const a = handle.trim().replace(/^@/, '').toLowerCase();
  const b = username.trim().toLowerCase();
  if (a === b) return 'EXACT';
  const squash = (value: string) => value.replace(/[^a-z0-9]/g, '');
  return squash(a) === squash(b) && squash(a).length > 0 ? 'SEPARATORS' : 'OTHER';
}

export function nameRelationLabel(relation: NameRelation): string {
  if (relation === 'EXACT') return 'Same spelling';
  if (relation === 'SEPARATORS') return 'Same letters, different punctuation';
  return 'Different name';
}

// ---------------------------------------------------------------------------
// eBay's seller object
// ---------------------------------------------------------------------------

/**
 * A seller as the Browse API returns it on a listing, or null when it is not one. eBay
 * sends the percentage as a string ("99.8") and the score as a number; anything outside
 * its range is read as missing rather than shown.
 */
export function parseEbaySeller(raw: unknown): (EbayFeedback & { username: string }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const seller = raw as Record<string, unknown>;
  const username = typeof seller.username === 'string' ? seller.username.trim() : '';
  if (!isValidEbayUsername(username)) return null;

  const percent =
    typeof seller.feedbackPercentage === 'string' || typeof seller.feedbackPercentage === 'number'
      ? Number(seller.feedbackPercentage)
      : Number.NaN;
  const score = typeof seller.feedbackScore === 'number' ? seller.feedbackScore : Number.NaN;
  const type = seller.sellerAccountType;

  return {
    username,
    feedbackPercentage: Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null,
    feedbackScore: Number.isInteger(score) && score >= 0 ? score : null,
    accountType: type === 'BUSINESS' || type === 'INDIVIDUAL' ? type : null,
  };
}

/** What a seller lists, for a staff member deciding whether this is the same person. */
export interface EbayListingContext {
  /** Up to three listing titles. */
  sampleTitles: string[];
  /** Countries the listings are located in. */
  countries: string[];
  /** The listings' category names, most common first. */
  categories: string[];
  /** Whether the listings are trading cards (the world a card handle lives in). */
  sellsCards: boolean;
}

const CARD_CATEGORY = /collectible card|trading card|ccg|sports (trading )?cards?|tcg/i;
const CARD_TITLE =
  /pok[eé]mon|\btcg\b|\bpsa ?\d|\bcgc\b|\bbgs\b|\bslab\b|one piece|yu-?gi-?oh|\bmtg\b|magic the gathering|lorcana|booster|topps|panini|prizm/i;

/** Whether a seller's categories or titles say trading cards. */
export function sellsTradingCards(categories: readonly string[], titles: readonly string[]): boolean {
  return categories.some((c) => CARD_CATEGORY.test(c)) || titles.some((t) => CARD_TITLE.test(t));
}

// ---------------------------------------------------------------------------
// A staff decision
// ---------------------------------------------------------------------------

export type LinkDecision = 'CONFIRM' | 'REJECT';

export function isLinkDecision(value: unknown): value is LinkDecision {
  return value === 'CONFIRM' || value === 'REJECT';
}

/** Mirrors the table's CHECKs: 10 characters to confirm, 3 to reject, 1000 at most. */
export const LINK_NOTE_CONFIRM_MIN = 10;
export const LINK_NOTE_REJECT_MIN = 3;
export const LINK_NOTE_MAX = 1000;

export type LinkDecisionProblem = { field: 'decision' | 'username' | 'note'; message: string };

/**
 * What is wrong with a staff decision, or null when it can be saved. A confirmation must
 * say what was checked, because that sentence is the only record of why a seller's eBay
 * history is shown on someone else's page.
 */
export function linkDecisionProblem(input: {
  decision: unknown;
  username: unknown;
  note: unknown;
}): LinkDecisionProblem | null {
  if (!isLinkDecision(input.decision)) {
    return { field: 'decision', message: 'Choose to confirm or reject the link.' };
  }
  if (normalizeEbayUsername(input.username) === null) {
    return { field: 'username', message: 'Enter a valid eBay username.' };
  }
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const min = input.decision === 'CONFIRM' ? LINK_NOTE_CONFIRM_MIN : LINK_NOTE_REJECT_MIN;
  if (note.length < min) {
    return {
      field: 'note',
      message:
        input.decision === 'CONFIRM'
          ? `Say what you checked, in at least ${LINK_NOTE_CONFIRM_MIN} characters. For example: the eBay About page names this Instagram.`
          : `Say why it is not them, in at least ${LINK_NOTE_REJECT_MIN} characters.`,
    };
  }
  if (note.length > LINK_NOTE_MAX) {
    return { field: 'note', message: `Keep the note to ${LINK_NOTE_MAX} characters or fewer.` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The finder's result, as a staff member reads it
// ---------------------------------------------------------------------------

/**
 * Where a candidate stands for THIS handle.
 * - `NEW`: not decided yet.
 * - `CONFIRMED_HERE`, `REJECTED_HERE`: already decided for this handle.
 * - `CONFIRMED_ELSEWHERE`: confirmed for a different handle, so it cannot attach here.
 */
export type CandidateState = 'NEW' | 'CONFIRMED_HERE' | 'REJECTED_HERE' | 'CONFIRMED_ELSEWHERE';

export interface EbayLinkCandidate {
  username: string;
  profileUrl: string;
  relation: NameRelation;
  stats: EbayFeedback;
  context: EbayListingContext;
  state: CandidateState;
}

/** Exact spelling first, then punctuation-only differences, then the rest; busiest account first. */
export function compareCandidates(a: EbayLinkCandidate, b: EbayLinkCandidate): number {
  const rank = (c: EbayLinkCandidate) => (c.relation === 'EXACT' ? 0 : c.relation === 'SEPARATORS' ? 1 : 2);
  return rank(a) - rank(b) || (b.stats.feedbackScore ?? 0) - (a.stats.feedbackScore ?? 0) || a.username.localeCompare(b.username);
}

// ---------------------------------------------------------------------------
// Reading the numbers
// ---------------------------------------------------------------------------

/** `100` as "100%", `99.8` as "99.8%". eBay reports one decimal. */
export function formatFeedbackPercentage(percent: number): string {
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

/** A feedback count with thousands separators, in a fixed locale so the server and browser agree. */
export function formatFeedbackCount(count: number): string {
  return count.toLocaleString('en-US');
}

/** The day a figure was read ("18 Nov"), in UTC so the server and browser agree. */
export function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
