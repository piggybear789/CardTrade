// domain/references/enrichment.ts
//
// Pure DTO types and realness/risk assessment logic for enriched background checks.
// Strictly separates verified NoDitto references from unverified OSINT signals.

import type { PaymentForensicsReport } from '@/domain/references/paymentForensics';
import type {
  DmScamAnalysis,
  ProfileForensicsReport,
  VisibleProfileMetrics,
} from '@/domain/references/profileForensics';

export interface StolenSlabMatch {
  marketplace: 'EBAY_AU' | 'EBAY_US';
  title: string;
  sellerUsername: string;
  sellerFeedbackScore: number | null;
  priceValue: number | null;
  priceCurrency: string | null;
  itemUrl: string;
  sellerMatchesSubject: boolean;
}

export interface PsaCertCheckResult {
  certNumber: string;
  psaVerifyUrl: string;
  psaApiStatus: 'VERIFIED' | 'NOT_FOUND' | 'DEACTIVATED' | 'UNAVAILABLE';
  psaCardTitle: string | null;
  psaGrade: string | null;
  psaYear: string | null;
  psaBrand: string | null;
  ebayMatches: StolenSlabMatch[];
  riskLevel: 'LOW' | 'ELEVATED' | 'HIGH';
  riskReason: string | null;
}

export interface MarketPriceCompResult {
  cardQuery: string;
  askingPrice: number;
  currency: 'AUD' | 'USD';
  sampleCount: number;
  medianPrice: number | null;
  lowPrice: number | null;
  highPrice: number | null;
  discountPercent: number | null;
  sampleListings: Array<{
    title: string;
    priceValue: number;
    currency: string;
    itemUrl: string;
    sellerUsername: string | null;
  }>;
  riskLevel: 'LOW' | 'ELEVATED' | 'HIGH';
  riskReason: string | null;
}

export type CheckRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type SourceProgress = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface CheckSourcesStatus {
  scamHash: SourceProgress;
  graphVector: SourceProgress;
  profileForensics: SourceProgress;
  paymentRail: SourceProgress;
  psaCert: SourceProgress;
  priceComp: SourceProgress;
  ebay: SourceProgress;
  sherlock: SourceProgress;
  webSearch: SourceProgress;
}

export interface LookalikeClaimView {
  claimId: string;
  platform: string;
  handle: string;
  claimedProfileId: string | null;
  similarity: number;
  exactStrippedMatch: boolean;
  positiveRefs: number;
}

export type RealnessTier =
  | 'ID_VERIFIED'
  | 'ESTABLISHED_FOOTPRINT'
  | 'LIMITED_FOOTPRINT'
  | 'WARNING_FLAGGED';

export type CollisionRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RealnessAssessment {
  tier: RealnessTier;
  headline: string;
  guidance: string;
  collisionRisk: CollisionRisk;
  signalsSummary: string[];
}

export interface EbayListingPreview {
  title: string;
  priceText: string | null;
  itemUrl: string;
  imageUrl: string | null;
}

export interface EbayRecentSale {
  title: string;
  priceText: string | null;
  when: string | null;
  itemId: string | null;
}

/**
 * One row of an eBay member's public feedback page: one person's word about one deal.
 * Buyers are shown by eBay under a masked name (`4***e`); sellers by their username.
 */
export interface EbayFeedbackEntry {
  /** eBay's own feedback id, stable across reads. */
  id: string;
  rating: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  comment: string | null;
  itemTitle: string | null;
  itemId: string | null;
  /** Who left it: someone who bought from the member, or someone who sold to them. */
  authorRole: 'BUYER' | 'SELLER';
  authorName: string;
  /** The author's own eBay feedback score. */
  authorScore: number | null;
  priceText: string | null;
  /** eBay marks feedback tied to a paid order. */
  verifiedPurchase: boolean;
  /** eBay's own wording: `Past month`, `Past 6 months`, `More than a year ago`. */
  when: string | null;
}

export interface EbaySellerSummary {
  username: string;
  found: boolean;
  oauthVerified: boolean;
  feedbackScore: number | null;
  feedbackPercentage: string | null;
  activeListingsCount: number;
  profileUrl: string;
  sampleListings: EbayListingPreview[];
  note: string | null;
  /** Optional rich feedback-profile metadata when available. */
  avatarUrl?: string | null;
  memberSince?: string | null;
  positive12m?: number | null;
  neutral12m?: number | null;
  negative12m?: number | null;
  totalFeedback?: number | null;
  recentSales?: EbayRecentSale[];
  /**
   * The newest page of feedback rows, read with the profile. Present (possibly empty) on
   * every lookup since eBay feedback became references; absent on older stored lookups.
   */
  feedbackEntries?: EbayFeedbackEntry[];
}

export interface FootprintJudgeWarning {
  severity: 'HIGH' | 'CAUTION';
  title: string;
  detail: string;
}

export interface FootprintJudgeVerdict {
  source: 'llm' | 'fallback';
  model: string | null;
  tier: RealnessTier;
  summary: string;
  warnings: FootprintJudgeWarning[];
  highlights: string[];
}

export interface SherlockMatchView {
  site: string;
  category: 'social' | 'marketplace' | 'forum' | 'other';
  url: string;
  handle: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface WebMentionView {
  id: string;
  title: string;
  snippet: string;
  url: string;
  sourceLabel: string;
  riskFlag: 'NONE' | 'CAUTION' | 'WARNING';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  observedAt: string;
}

export interface VectorMatchView {
  id: string;
  subjectKey: string;
  subjectKind: string;
  platform: string | null;
  handleOrName: string;
  locationHint: string | null;
  sourceUrl: string | null;
  snippet: string;
  score: number;
}

export interface ScamRiskSummary {
  /** Number of distinct scam reports whose fingerprinted identifiers matched (never reveals PII). */
  matchedReportCount: number;
  corroborated: boolean;
  matchedKinds: string[];
  nameMatchCount: number;
}

export interface MatchedMemberSummary {
  id: string;
  displayName: string;
  handle: string | null;
  platform: string | null;
  regionCode: string | null;
  identityVerified: boolean;
  positiveRefs: number;
  negativeRefs: number;
}

export interface BackgroundCheckDossier {
  runId: string | null;
  status: CheckRunStatus;
  targetKind: 'PROFILE' | 'CLAIM' | 'HANDLE' | 'PERSON_NAME';
  targetKey: string;
  queryLabel: string;
  locationHint: string | null;
  checkedAt: string | null;
  expiresAt: string | null;
  sources: CheckSourcesStatus;
  assessment: RealnessAssessment;
  scamRisk: ScamRiskSummary;
  forensics: ProfileForensicsReport;
  paymentForensics: PaymentForensicsReport | null;
  psaCert: PsaCertCheckResult | null;
  priceComp: MarketPriceCompResult | null;
  lookalikes: LookalikeClaimView[];
  dmAnalysis: DmScamAnalysis | null;
  matchedMembers: MatchedMemberSummary[];
  ebay: EbaySellerSummary | null;
  sherlock: SherlockMatchView[];
  webMentions: WebMentionView[];
  vectorMatches: VectorMatchView[];
  /** Holistic LLM judge verdict (or clean deterministic fallback when no LLM key is set). */
  judge?: FootprintJudgeVerdict | null;
}

/**
 * The parts of a check a reader watches finish, in the order the footprint card lists
 * them. The first five run while the check is being started; `sites` is the slower scan
 * of other public sites that carries on afterwards and is read by polling the run.
 */
export const CHECK_STEPS = ['ebay', 'instagram', 'web', 'scam', 'summary', 'sites'] as const;
export type CheckStep = (typeof CHECK_STEPS)[number];

/** What one part of a check came back with. */
export interface CheckStepResult {
  step: CheckStep;
  /** `skipped`: this part does not apply to what was looked up, so it was not run. */
  state: 'done' | 'skipped';
  found: boolean;
  /** The figure the part is summed up by: feedback, followers, mentions, matches or sites. */
  count: number | null;
}

/** `POST /api/references/check` answers with one of these per line when asked for a stream. */
export const CHECK_STREAM_CONTENT_TYPE = 'application/x-ndjson';

export type CheckStreamEvent =
  | { type: 'step'; result: CheckStepResult }
  | { type: 'dossier'; dossier: BackgroundCheckDossier }
  | { type: 'error'; error: string };

export type {
  DmScamAnalysis,
  PaymentForensicsReport,
  ProfileForensicsReport,
  VisibleProfileMetrics,
};

/**
 * Computes an honest, non-defamatory realness & risk summary from verified and OSINT signals.
 * Never counts unverified OSINT matches as verified references.
 */
export function computeRealnessAssessment(input: {
  targetKind: 'PROFILE' | 'CLAIM' | 'HANDLE' | 'PERSON_NAME';
  identityVerified: boolean;
  positiveRefs: number;
  negativeRefs: number;
  hasLocation: boolean;
  hasSecondaryHandle: boolean;
  scamRisk: ScamRiskSummary;
  forensics: ProfileForensicsReport;
  paymentForensics?: PaymentForensicsReport | null;
  psaCert?: PsaCertCheckResult | null;
  priceComp?: MarketPriceCompResult | null;
  dmAnalysis?: DmScamAnalysis | null;
  ebay: EbaySellerSummary | null;
  sherlockCount: number;
  webWarningsCount: number;
}): RealnessAssessment {
  const signalsSummary: string[] = [];

  if (input.scamRisk.matchedReportCount > 0) {
    signalsSummary.push(
      input.scamRisk.corroborated
        ? `Payment/handle details match ${input.scamRisk.matchedReportCount} corroborated scam reports`
        : `Payment/handle details appear in ${input.scamRisk.matchedReportCount} scam report(s) under review`,
    );
  }
  if (input.psaCert?.riskLevel === 'HIGH') {
    signalsSummary.push(`PSA cert #${input.psaCert.certNumber} flagged (${input.psaCert.ebayMatches.length > 0 ? 'listed by another eBay seller' : input.psaCert.psaApiStatus.toLowerCase()})`);
  }
  if (input.priceComp?.riskLevel === 'HIGH' && input.priceComp.discountPercent !== null) {
    signalsSummary.push(`Asking price ~${input.priceComp.discountPercent}% below live eBay median`);
  }
  if (input.paymentForensics && input.paymentForensics.riskLevel !== 'LOW') {
    signalsSummary.push(`Payment-rail risk ${input.paymentForensics.riskScore}/100 (${input.paymentForensics.flags.length} flag${input.paymentForensics.flags.length === 1 ? '' : 's'})`);
  }
  if (input.forensics.riskLevel === 'HIGH') {
    signalsSummary.push(`Profile anomaly score ${input.forensics.riskScore}/100 (${input.forensics.flags.length} red flags)`);
  } else if (input.forensics.riskLevel === 'ELEVATED') {
    signalsSummary.push(`Elevated profile anomalies (${input.forensics.riskScore}/100)`);
  }
  if (input.dmAnalysis && input.dmAnalysis.riskLevel !== 'LOW') {
    signalsSummary.push(`DM scam-script score ${input.dmAnalysis.riskScore}/100`);
  }
  if (input.negativeRefs > 0) {
    signalsSummary.push(`${input.negativeRefs} negative community reference(s)`);
  }
  if (input.webWarningsCount > 0) {
    signalsSummary.push(`${input.webWarningsCount} public web/forum scam warning(s) found`);
  }
  if (input.identityVerified) {
    signalsSummary.push('Government ID verified on NoDitto');
  }
  if (input.positiveRefs > 0) {
    signalsSummary.push(`${input.positiveRefs} positive trader reference(s)`);
  }
  if (input.ebay?.found) {
    const scoreText =
      input.ebay.feedbackScore !== null
        ? `${input.ebay.feedbackScore.toLocaleString('en-US')} feedback (${input.ebay.feedbackPercentage ?? '—'}%)`
        : input.ebay.activeListingsCount > 0
          ? `${input.ebay.activeListingsCount} active listings`
          : `account verified (@${input.ebay.username})`;
    signalsSummary.push(`eBay: ${scoreText}`);
  }
  if (input.forensics.waybackFirstSeen) {
    signalsSummary.push(`Archived on Wayback Machine since ${input.forensics.waybackFirstSeen}`);
  }
  if (input.sherlockCount > 0) {
    signalsSummary.push(`${input.sherlockCount} matching public username(s) across platforms`);
  }

  const collisionRisk: CollisionRisk =
    input.targetKind === 'PERSON_NAME'
      ? input.hasLocation || input.hasSecondaryHandle
        ? 'MEDIUM'
        : 'HIGH'
      : input.targetKind === 'HANDLE'
        ? 'MEDIUM'
        : 'LOW';

  const hasHighForensics = input.forensics.riskLevel === 'HIGH';
  const hasHighDmRisk = input.dmAnalysis?.riskLevel === 'HIGH';
  const hasHighPaymentRisk = input.paymentForensics?.riskLevel === 'HIGH';
  const hasHighPsaRisk = input.psaCert?.riskLevel === 'HIGH';
  const hasHighPriceRisk = input.priceComp?.riskLevel === 'HIGH';

  if (
    input.scamRisk.corroborated ||
    input.scamRisk.matchedReportCount > 0 ||
    input.negativeRefs >= 2 ||
    input.webWarningsCount > 0 ||
    hasHighForensics ||
    hasHighDmRisk ||
    hasHighPaymentRisk ||
    hasHighPsaRisk ||
    hasHighPriceRisk
  ) {
    return {
      tier: 'WARNING_FLAGGED',
      headline: 'High-risk warning signals detected — pause before paying',
      guidance:
        input.scamRisk.matchedReportCount > 0
          ? 'The payment detail or handle provided matches an internal scam report. Do not send unprotected bank/PayID/F&F transfers.'
          : hasHighPsaRisk
            ? input.psaCert!.riskReason ?? 'The PSA cert check triggered a high-risk stolen-photo or invalid-cert warning.'
            : hasHighPaymentRisk
              ? 'Payment details triggered a major warning (e.g. PayID/bank name mismatch, disposable email, or location mismatch). Pause before sending money.'
              : hasHighPriceRisk
                ? input.priceComp!.riskReason ?? 'Asking price is suspiciously far below live eBay comps. Pause before sending money.'
                : hasHighDmRisk
                  ? 'The DM text matches known trading-card scam scripts (e.g. steep below-market backstory or unprotected payment pressure). Do not send money without escrow or verified proof.'
                  : hasHighForensics
                    ? 'Visible profile metrics show multiple classic fake/burner vendor anomalies (e.g. follow-farming ratio, private vendor, or category mismatch). Verify ownership before sending money.'
                    : 'Public scam warnings or negative references were found. Review the sources below and verify ownership before sending money.',
      collisionRisk,
      signalsSummary,
    };
  }

  if (input.identityVerified) {
    return {
      tier: 'ID_VERIFIED',
      headline: 'ID-verified trader on NoDitto',
      guidance:
        'This person has completed government ID verification and holds linked accountability on NoDitto.',
      collisionRisk: 'LOW',
      signalsSummary,
    };
  }

  const hasStrongEbay = Boolean(input.ebay?.found && (input.ebay.feedbackScore ?? 0) >= 10);
  const hasEstablishedFootprint =
    input.positiveRefs >= 2 || hasStrongEbay || input.sherlockCount >= 4;

  if (hasEstablishedFootprint) {
    return {
      tier: 'ESTABLISHED_FOOTPRINT',
      headline: 'Established public footprint found',
      guidance:
        input.targetKind === 'PERSON_NAME'
          ? 'Public signals exist, but common names can belong to multiple people. Confirm they actually control the linked Instagram or eBay account (e.g. ask them to DM or claim it here).'
          : 'This handle has an active footprint across platforms. Before sending money, confirm the person messaging you actually controls this account.',
      collisionRisk,
      signalsSummary,
    };
  }

  return {
    tier: 'LIMITED_FOOTPRINT',
    headline:
      input.forensics.riskLevel === 'ELEVATED'
        ? 'Suspicious or limited footprint — verify before paying'
        : 'Limited verifiable footprint — verify before paying',
    guidance:
      input.targetKind === 'PERSON_NAME'
        ? 'Facebook Marketplace cannot be scraped directly, and a name alone is not proof of identity. Drop a screenshot of their profile or DM, paste their PayID/phone/BSB, or ask them to verify on NoDitto.'
        : 'We found very little public history for this handle. Drop a screenshot of their profile or DM chat to run full anomaly scoring, or ask them to verify on NoDitto.',
    collisionRisk,
    signalsSummary,
  };
}
