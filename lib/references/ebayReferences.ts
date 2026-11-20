// lib/references/ebayReferences.ts
//
// eBay feedback as references. A person's references page draws the feedback left for
// their eBay account beside the references written on NoDitto: each feedback author is a
// planet and a card, eBay gets its own platform pill, and the feedback is added to the
// positive, neutral and negative counts.
//
// WHERE IT COMES FROM. The digital footprint check (`lib/references/enrichment.ts`) reads
// the eBay account's public feedback page and keeps the newest page of rows
// (`EbaySellerSummary.feedbackEntries`). This module folds that into the graph the page
// already has. It runs in the browser as well as on the server, so the planets appear the
// moment a check finishes without the shared references cache being rebuilt.
//
// WHICH ACCOUNT. The eBay account the check found for the person: one they signed in to,
// or one that simply has the same username as their handle. A username match is counted
// too. That is a product decision (a same-named account is nearly always the same trader),
// and it is why every eBay card links to the account it was read from.
//
// COUNTS. eBay shows one page of rows but reports the totals itself, so the counts are
// eBay's own and only the rows on that page are drawn:
//   * positive: the account's feedback score, eBay's count of members who left positive
//     feedback (less those who left negative), never fewer than the positive rows read;
//   * neutral, negative: eBay's twelve-month figures, never fewer than the rows read.
// The rest are counted without a planet, exactly like NoDitto references past the cap.
//
// ONLY ON THE REFERENCES PAGE. Search results, a storefront's network and the graph a
// walk loads still count NoDitto references alone (`peopleTallies`).
//
// Pure: no I/O, no server-only imports.

import { ISSUE_CAP, PLANET_CAP } from '@/domain/references/orbits';
import type { EbayFeedbackEntry, EbaySellerSummary } from '@/domain/references/enrichment';
import { platformLabel, roleLabel } from '@/domain/references/reference';
import type { ReferenceGraphData, ReferenceGraphNode } from '@/lib/references/graph';

const EBAY = 'ebay';
/** Planets kept for eBay feedback when NoDitto references alone would fill the drawing. */
const EBAY_PLANET_SLOTS = 12;
const EBAY_ISSUE_SLOTS = 2;

export interface EbayReferenceCounts {
  positive: number;
  neutral: number;
  negative: number;
}

/** One feedback author with every row they left of one rating: one planet. */
interface AuthorGroup {
  first: EbayFeedbackEntry;
  deals: number;
}

function groupByAuthor(entries: readonly EbayFeedbackEntry[]): AuthorGroup[] {
  const groups = new Map<string, AuthorGroup>();
  for (const entry of entries) {
    // eBay masks a buyer's name (`4***e`), so the mask and their score together are the
    // nearest thing to one person. A rating of each kind stays its own planet, as it
    // does for NoDitto references: a bad experience never nets off a good one.
    const key = [entry.authorRole, entry.authorName.toLowerCase(), entry.authorScore ?? '', entry.rating].join('|');
    const group = groups.get(key);
    if (group) group.deals += 1;
    else groups.set(key, { first: entry, deals: 1 });
  }
  return [...groups.values()];
}

function initialsOf(name: string): string {
  const letters = name.replace(/[^\p{L}\p{N}]/gu, '');
  return (letters.slice(0, 2) || '?').toUpperCase();
}

export function ebayFeedbackUrl(username: string): string {
  return `https://www.ebay.com.au/fdbk/feedback_profile/${encodeURIComponent(username)}`;
}

function nodeOf({ first, deals }: AuthorGroup, account: string): ReferenceGraphNode {
  const role = first.authorRole === 'SELLER' ? 'SOLD' : 'BOUGHT';
  const id = `${EBAY}:${first.id}`;
  return {
    id,
    profileId: id,
    handle: first.authorName,
    address: null,
    name: first.authorName,
    initials: initialsOf(first.authorName),
    avatarPath: null,
    identityVerified: false,
    refs: 0,
    platform: EBAY,
    platforms: [EBAY],
    kind: 'ebay',
    sentiment: first.rating,
    categoryLabel: null,
    comment: first.comment,
    role,
    roleLabel: roleLabel(role),
    dateLabel: first.when,
    deals,
    referenceId: null,
    occurredMonth: '',
    category: null,
    edited: false,
    imported: false,
    sourceUrl: ebayFeedbackUrl(account),
    children: [],
    external: {
      source: 'ebay',
      account,
      authorScore: first.authorScore,
      itemTitle: first.itemTitle,
      priceText: first.priceText,
      verifiedPurchase: first.verifiedPurchase,
    },
  };
}

/** How many people's eBay feedback a lookup stands for. All zero when there is none. */
export function ebayReferenceCounts(ebay: EbaySellerSummary | null | undefined): EbayReferenceCounts {
  if (!ebay?.found) return { positive: 0, neutral: 0, negative: 0 };
  const read = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 };
  for (const group of groupByAuthor(ebay.feedbackEntries ?? [])) read[group.first.rating] += 1;
  return {
    positive: Math.max(ebay.feedbackScore ?? 0, read.POSITIVE),
    neutral: Math.max(ebay.neutral12m ?? 0, read.NEUTRAL),
    negative: Math.max(ebay.negative12m ?? 0, read.NEGATIVE),
  };
}

/**
 * What of a lookup reaches the graph, as one string: two lookups with the same signature
 * draw the same thing, so a re-read that changed nothing need not redraw the network.
 */
export function ebayReferenceSignature(ebay: EbaySellerSummary | null | undefined): string {
  if (!ebay?.found) return '';
  const counts = ebayReferenceCounts(ebay);
  return [
    ebay.username.toLowerCase(),
    counts.positive,
    counts.neutral,
    counts.negative,
    (ebay.feedbackEntries ?? []).map((entry) => entry.id).join(','),
  ].join('|');
}

/**
 * `graph` with the eBay feedback in `ebay` added as references the person received.
 * Returns `graph` itself when there is nothing to add, so callers can compare by identity.
 */
export function withEbayReferences(
  graph: ReferenceGraphData,
  ebay: EbaySellerSummary | null | undefined,
): ReferenceGraphData {
  const counts = ebayReferenceCounts(ebay);
  const total = counts.positive + counts.neutral + counts.negative;
  if (!ebay?.found || total === 0) return graph;

  const ebayNodes = groupByAuthor(ebay.feedbackEntries ?? []).map((group) => nodeOf(group, ebay.username));
  const ebayPlanets = ebayNodes.filter((node) => node.sentiment !== 'NEGATIVE');
  const ebayIssues = ebayNodes.filter((node) => node.sentiment === 'NEGATIVE');
  // `graph.nodes` is already ranked: the best-vouched people first, then the issues.
  const ownPlanets = graph.nodes.filter((node) => node.sentiment !== 'NEGATIVE');
  const ownIssues = graph.nodes.filter((node) => node.sentiment === 'NEGATIVE');

  // eBay authors have no standing here, so ranked with everyone else they would never be
  // drawn for someone whose NoDitto references already fill the drawing. They get the
  // room NoDitto references leave, and never fewer than their reserved slots.
  const drawnEbayPlanets = ebayPlanets.slice(0, Math.max(EBAY_PLANET_SLOTS, PLANET_CAP - ownPlanets.length));
  const drawnOwnPlanets = ownPlanets.slice(0, PLANET_CAP - drawnEbayPlanets.length);
  const drawnEbayIssues = ebayIssues.slice(0, Math.max(EBAY_ISSUE_SLOTS, ISSUE_CAP - ownIssues.length));
  const drawnOwnIssues = ownIssues.slice(0, ISSUE_CAP - drawnEbayIssues.length);

  const drawnOwn = new Set([...drawnOwnPlanets, ...drawnOwnIssues].map((node) => node.profileId));
  const platforms = graph.centre.platforms.filter((p) => p.slug !== EBAY);
  const ownEbayCount = graph.centre.platforms.find((p) => p.slug === EBAY)?.count ?? 0;
  platforms.push({ slug: EBAY, label: platformLabel(EBAY), count: ownEbayCount + total });
  platforms.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    ...graph,
    centre: {
      ...graph.centre,
      peopleCount: graph.centre.peopleCount + counts.positive,
      neutralCount: graph.centre.neutralCount + counts.neutral,
      negativeCount: graph.centre.negativeCount + counts.negative,
      platforms,
    },
    nodes: [...drawnOwnPlanets, ...drawnEbayPlanets, ...drawnOwnIssues, ...drawnEbayIssues],
    links: graph.links.filter(([a, b]) => drawnOwn.has(a) && drawnOwn.has(b)),
    hidden: {
      people:
        graph.hidden.people +
        (ownPlanets.length - drawnOwnPlanets.length) +
        Math.max(0, counts.positive + counts.neutral - drawnEbayPlanets.length),
      issues:
        graph.hidden.issues +
        (ownIssues.length - drawnOwnIssues.length) +
        Math.max(0, counts.negative - drawnEbayIssues.length),
    },
  };
}
