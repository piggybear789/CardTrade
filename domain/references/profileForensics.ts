// domain/references/profileForensics.ts
//
// Pure, zero-cost visible-profile anomaly scoring, Facebook numeric ID era analysis,
// handle impersonation heuristics, and multilingual DM scam-script detection.
//
// Inspired by visible-feature fake-profile detection (`LeadingIndiaAI/Detecting-Fake-Profiles-On-Social-Media`)
// adapted specifically for trading-card marketplaces (Instagram, Facebook Marketplace, eBay, Discord).
// Works even when ZERO prior scam reports or warning stories exist.

import {
  facebookIndexFlags,
  type FacebookIndexReport,
} from '@/domain/references/facebookIndex';
import {
  predictFakeProfileProbability,
  type FakeProfilePrediction,
} from '@/domain/references/fakeProfileModel';

export type AnomalySeverity = 'INFO' | 'CAUTION' | 'HIGH';

export interface ForensicsFlag {
  code: string;
  label: string;
  detail: string;
  severity: AnomalySeverity;
  points: number;
}

export interface VisibleProfileMetrics {
  platform: string;
  handle: string | null;
  displayName: string | null;
  postsCount: number | null;
  followersCount: number | null;
  followingCount: number | null;
  isPrivate: boolean | null;
  category: string | null;
  bio: string | null;
  isVerified: boolean | null;
  hasProfilePic?: boolean | null;
  hasExternalUrl?: boolean | null;
  source: 'API' | 'SCREENSHOT';
}

export interface ProfileForensicsReport {
  riskScore: number; // 0..100
  riskLevel: 'LOW' | 'ELEVATED' | 'HIGH';
  flags: ForensicsFlag[];
  mlPrediction: FakeProfilePrediction | null;
  fbIdEra: {
    id: string;
    eraLabel: string;
    isRecent: boolean;
  } | null;
  waybackFirstSeen: string | null;
  visibleProfile: VisibleProfileMetrics | null;
  /**
   * What search engines hold about a Facebook profile (name, intro facts, same-name
   * accounts). Absent on checks stored before it existed, and for non-Facebook targets.
   */
  facebookIndex?: FacebookIndexReport | null;
}

export interface DmScamAnalysis {
  riskScore: number; // 0..100
  riskLevel: 'LOW' | 'ELEVATED' | 'HIGH';
  flags: ForensicsFlag[];
  extractedHandles: string[];
  extractedPaymentHints: string[];
  summary: string | null;
  usedAiVision: boolean;
}

// Only match explicit commercial seller phrasing — not generic hobby tags like `#pokemon` or `#tcg`.
const VENDOR_BIO_RE =
  /\b(vendor|shop|store|buy\s*[·•|/&-]\s*sell|buy\s+sell\s+trade|bst|cards?\s+for\s+sale|for\s+sale|dm\s+to\s+buy|wts|wtb|breaks?|claim\s+sales?)\b/i;

const UNRELATED_CATEGORIES = new Set([
  'musician/band',
  'musician',
  'band',
  'athlete',
  'actor',
  'comedian',
  'dancer',
  'model',
  'chef',
  'politician',
  'public figure',
  'digital creator',
  'video creator',
  'health/beauty',
  'restaurant',
  'real estate',
  'motivational speaker',
  'religious organization',
]);

const HIGH_MISMATCH_CATEGORIES = new Set([
  'musician/band',
  'musician',
  'band',
  'athlete',
  'actor',
  'comedian',
  'dancer',
  'model',
  'chef',
  'politician',
  'health/beauty',
  'restaurant',
  'real estate',
  'religious organization',
]);

/**
 * Estimates Facebook account era purely from its numeric profile ID (zero scraping).
 * Meta began assigning 14-digit `6155...`–`6158...` IDs in 2023–2026.
 */
export function analyzeFacebookIdAge(
  rawId: string | null | undefined,
): { id: string; eraLabel: string; isRecent: boolean; flag: ForensicsFlag | null } | null {
  const id = (rawId ?? '').trim();
  if (!/^\d{5,20}$/.test(id)) return null;

  if (/^615[89]\d{10}$/.test(id)) {
    return {
      id,
      eraLabel: 'Brand-new Facebook ID (6158–6159 series, ~2025–2026)',
      isRecent: true,
      flag: {
        code: 'FB_RECENT_615_ID',
        label: 'Brand-new Facebook ID (6158–6159 series)',
        detail:
          'Facebook IDs starting 6158 or 6159 are accounts made in 2025 or 2026. With no references, that is a major red flag.',
        severity: 'HIGH',
        points: 35,
      },
    };
  }

  if (/^615[5-7]\d{10}$/.test(id)) {
    return {
      id,
      eraLabel: 'Recent Facebook ID (6155–6157 series, ~2023–2025)',
      isRecent: true,
      flag: {
        code: 'FB_RECENT_615_ID',
        label: 'Recently created Facebook ID (615x series)',
        detail:
          'Facebook numeric IDs starting with 6155–6157 correspond to newer accounts (~2023–2025), commonly seen on Marketplace burner accounts.',
        severity: 'CAUTION',
        points: 22,
      },
    };
  }

  if (/^1000[89]\d{10}$/.test(id)) {
    return {
      id,
      eraLabel: 'Newer Facebook ID (10008/10009 series, ~2022–2023)',
      isRecent: false,
      flag: null,
    };
  }

  if (/^1000[0-7]\d{10}$/.test(id)) {
    return {
      id,
      eraLabel: 'Established Facebook ID (10000–10007 series)',
      isRecent: false,
      flag: null,
    };
  }

  if (id.length <= 10) {
    return {
      id,
      eraLabel: 'Legacy Facebook ID (early account)',
      isRecent: false,
      flag: null,
    };
  }

  return {
    id,
    eraLabel: 'Numeric Facebook ID',
    isRecent: false,
    flag: null,
  };
}

/** Structural username patterns commonly used by impersonators and throwaway burners. */
export function analyzeHandlePattern(handle: string | null | undefined): ForensicsFlag[] {
  const clean = (handle ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!clean || /^\d+$/.test(clean)) return [];

  const flags: ForensicsFlag[] = [];

  if (/[._]$/.test(clean) || /^[._]/.test(clean) || /[._]{2,}/.test(clean)) {
    flags.push({
      code: 'IMPERSONATION_PUNCTUATION',
      label: 'Trailing or doubled underscore/dot in handle',
      detail: `Handles like "@${clean}" with trailing or repeated underscores/dots are frequently used to mimic established accounts or recreate banned handles.`,
      severity: 'CAUTION',
      points: 15,
    });
  }

  if (/\d{4,}$/.test(clean)) {
    flags.push({
      code: 'BURNER_DIGIT_SUFFIX',
      label: 'Long numeric suffix in handle',
      detail: `Handle "@${clean}" ends with 4+ digits, a common pattern on auto-generated or burner accounts.`,
      severity: 'CAUTION',
      points: 12,
    });
  } else if (/[a-z]\d$/.test(clean) && !/(151|25|99|00|64)$/.test(clean)) {
    flags.push({
      code: 'TRAILING_DIGIT_VARIANT',
      label: 'Single trailing digit in handle',
      detail: `Handle "@${clean}" ends in a number. Check it isn't a second or throwaway account.`,
      severity: 'INFO',
      points: 5,
    });
  }

  return flags;
}

/**
 * Visible-profile anomaly scorer inspired by LeadingIndiaAI's visible-feature fake
 * profile classifier, tailored to Instagram & Marketplace TCG accounts.
 */
export function scoreVisibleProfile(profile: VisibleProfileMetrics): ForensicsFlag[] {
  const flags: ForensicsFlag[] = [];
  const bio = (profile.bio ?? '').trim();
  const category = (profile.category ?? '').trim().toLowerCase();
  const claimsVendor = VENDOR_BIO_RE.test(bio);

  // 1. Extreme following-to-follower ratio (follow-for-follow farming)
  if (
    typeof profile.followingCount === 'number' &&
    typeof profile.followersCount === 'number' &&
    profile.followingCount >= 200
  ) {
    const ratio = profile.followingCount / Math.max(profile.followersCount, 1);
    if (ratio >= 4.0) {
      flags.push({
        code: 'EXTREME_FOLLOWING_RATIO',
        label: `Follow-farming ratio (${profile.followingCount.toLocaleString('en-US')} following vs ${profile.followersCount.toLocaleString('en-US')} followers)`,
        detail: `Following ${ratio.toFixed(1)}x more accounts than follow back. Scammers mass-follow thousands of collectors to manufacture mutual-follower credibility.`,
        severity: 'HIGH',
        points: 35,
      });
    } else if (ratio >= 2.2) {
      flags.push({
        code: 'HIGH_FOLLOWING_RATIO',
        label: `Elevated following-to-follower ratio (${ratio.toFixed(1)}x)`,
        detail: `Following ${profile.followingCount.toLocaleString('en-US')} accounts vs ${profile.followersCount.toLocaleString('en-US')} followers.`,
        severity: 'CAUTION',
        points: 18,
      });
    }
  }

  // 2. Category vs. TCG vendor bio mismatch (bought / hijacked aged account)
  if (category && claimsVendor && HIGH_MISMATCH_CATEGORIES.has(category)) {
    flags.push({
      code: 'CATEGORY_BIO_MISMATCH',
      label: `Category mismatch ("${profile.category}" on a TCG vendor bio)`,
      detail: `The account category is "${profile.category}" but the bio sells trading cards. The account may have been bought or hijacked.`,
      severity: 'HIGH',
      points: 30,
    });
  } else if (category && claimsVendor && UNRELATED_CATEGORIES.has(category)) {
    flags.push({
      code: 'CATEGORY_UNUSUAL',
      label: `Unusual category ("${profile.category}") for a card seller`,
      detail: 'Profile category does not match a typical retail/collectibles shop.',
      severity: 'INFO',
      points: 8,
    });
  }

  // 3. Private account claiming to be a public vendor / Buy·Sell·Trade
  if (profile.isPrivate === true && claimsVendor) {
    flags.push({
      code: 'PRIVATE_VENDOR_ACCOUNT',
      label: 'Private account advertising Buy·Sell·Trade',
      detail: 'Legitimate card vendors keep profiles public so buyers can inspect posts and public reference threads. Scammers go private to hide victim comments.',
      severity: 'HIGH',
      points: 28,
    });
  } else if (profile.isPrivate === true) {
    flags.push({
      code: 'PRIVATE_ACCOUNT',
      label: 'Private account',
      detail: 'Posts and comment history cannot be publicly verified.',
      severity: 'CAUTION',
      points: 12,
    });
  }

  // 4. Very few posts despite explicit commercial vendor claims and small following
  // (Skip accounts with 500+ followers — many established collectors curate/archive older posts.)
  if (typeof profile.postsCount === 'number') {
    const followers = profile.followersCount ?? 0;
    if (profile.postsCount <= 10 && claimsVendor && followers < 500) {
      flags.push({
        code: 'LOW_POSTS_VENDOR',
        label: `Only ${profile.postsCount} post${profile.postsCount === 1 ? '' : 's'} on a vendor account`,
        detail: 'Very little visible posting history for an account claiming to actively buy, sell, or trade.',
        severity: 'CAUTION',
        points: 18,
      });
    } else if (profile.postsCount === 0 && (profile.followingCount ?? 0) > 50) {
      flags.push({
        code: 'ZERO_POSTS_ACCOUNT',
        label: 'Zero posts',
        detail: 'Account has no visible posts.',
        severity: 'CAUTION',
        points: 18,
      });
    }
  }

  // 5. Unprotected payment / scammy bio phrasing
  if (/\b(f&f\s*only|friends\s*(?:&|and)\s*family\s*only|no\s+g&s|cashapp\s*only|zelle\s*only|crypto\s*only)\b/i.test(bio)) {
    flags.push({
      code: 'UNPROTECTED_PAYMENT_BIO',
      label: 'Bio demands unprotected payment methods',
      detail: 'Refusing Goods & Services or escrow in bio is a classic scammer tell.',
      severity: 'HIGH',
      points: 30,
    });
  }

  return flags;
}

/**
 * Multilingual ($0) DM scam-script analyzer covering English & German/Swiss-German
 * social engineering patterns (e.g., collateral/debt backstory, 50% below market grail,
 * unprotected payment pressure, urgency).
 */
export function analyzeDmScriptHeuristic(rawText: string): DmScamAnalysis {
  const text = (rawText ?? '').trim();
  const flags: ForensicsFlag[] = [];

  if (!text) {
    return {
      riskScore: 0,
      riskLevel: 'LOW',
      flags: [],
      extractedHandles: [],
      extractedPaymentHints: [],
      summary: null,
      usedAiVision: false,
    };
  }

  // 1. "Collateral / debt / friend left it with me" backstory (EN + DE/CH-DE)
  if (
    /\b(collateral|depot|pfand|als\s+depot|debt|schulden|owes\s+me|left\s+with\s+me|glah\s+hett|my\s+own\s+cost|eigete\s+choste|eigene\s+kosten|just\s+want\s+my\s+money\s+back|wider\s+dusse|loswerden)\b/i.test(
      text,
    )
  ) {
    flags.push({
      code: 'DM_COLLATERAL_BACKSTORY',
      label: 'Classic "left as collateral" or "only covering my cost" story',
      detail:
        'Scammers routinely claim someone left a high-value card as collateral/depot or debt to justify selling far below market value.',
      severity: 'HIGH',
      points: 38,
    });
  }

  // 2. Steep below-market price ratio mentioned in message (e.g. "4k ... 2k", "$4000 ... $2000")
  const moneyMentions = Array.from(
    text.matchAll(/(?:\$|€|£|chf|aud|usd)?\s*(\d+(?:[.,]\d+)?)\s*(k)\b/gi),
    (m) => Number.parseFloat(m[1]!.replace(',', '.')) * 1000,
  ).filter((n) => Number.isFinite(n) && n >= 200);
  if (moneyMentions.length >= 2) {
    const maxAmt = Math.max(...moneyMentions);
    const minAmt = Math.min(...moneyMentions);
    if (maxAmt >= 500 && minAmt / maxAmt <= 0.65) {
      flags.push({
        code: 'DM_STEEP_BELOW_MARKET',
        label: `Too-good-to-be-true discount (${Math.round((1 - minAmt / maxAmt) * 100)}% below stated value)`,
        detail: `Message cites ~$${maxAmt.toLocaleString('en-US')} value while offering around ~$${minAmt.toLocaleString('en-US')}. A card that sells easily doesn't need a half-price cold DM.`,
        severity: 'HIGH',
        points: 35,
      });
    }
  }

  // 3. Grail / high-fraud card targets pitched unsolicited
  if (
    /\b(gold\s*star|pikachu\s*gold\s*star|1st\s*ed(?:ition)?\s*charizard|umbreon\s*vmax|moonbreon|poncho\s*pikachu|mario\s*pikachu|luigi\s*pikachu|crystal\s*charizard|shining\s*charizard)\b/i.test(
      text,
    )
  ) {
    flags.push({
      code: 'DM_HIGH_FRAUD_GRAIL',
      label: 'High-value grail card pitched in DM',
      detail: 'Ultra-liquid grails (Gold Stars, 1st Ed Charizards, Ponchos) are the #1 bait used in off-platform scams.',
      severity: 'CAUTION',
      points: 18,
    });
  }

  // 4. Unprotected payment / off-platform pressure
  if (
    /\b(f&f|friends\s*(?:&|and)\s*family|no\s+g&s|payid\s+only|bank\s+transfer\s+only|twint|zelle|cashapp|venmo|crypto|usdt|btc|gift\s*card|pay\s+my\s+(?:brother|cousin|partner|friend))\b/i.test(
      text,
    )
  ) {
    flags.push({
      code: 'DM_UNPROTECTED_PAYMENT',
      label: 'Unprotected payment method requested',
      detail: 'Asking for irreversible transfers (F&F, PayID/bank transfer, Twint, Zelle, CashApp, crypto, or a third party’s account) removes all buyer recourse.',
      severity: 'HIGH',
      points: 32,
    });
  }

  // 5. Urgency / quick flip pressure
  if (
    /\b(need\s+(?:cash|money)\s+(?:today|asap|urgently|fast)|quick\s+sale|first\s+come|holding\s+for\s+nobody|send\s+now|today\s+only)\b/i.test(
      text,
    )
  ) {
    flags.push({
      code: 'DM_URGENCY_PRESSURE',
      label: 'Artificial urgency / quick-sale pressure',
      detail: 'Urgency tactics are used to stop buyers from checking references or requesting escrow.',
      severity: 'CAUTION',
      points: 15,
    });
  }

  // 6. Explicit scam warning overlay inside a shared screenshot
  if (/\b(be\s+careful\s+scam|scammer\s+be\s+careful|scam\s+alert|do\s+not\s+buy|scammed\s+me)\b/i.test(text)) {
    flags.push({
      code: 'SCREENSHOT_WARNING_TEXT',
      label: 'Warning text detected in screenshot',
      detail: 'The uploaded screenshot itself contains explicit scam-warning text.',
      severity: 'HIGH',
      points: 45,
    });
  }

  // Extract handles & emails/phones for chaining into the main check
  const extractedHandles = Array.from(
    new Set(
      Array.from(text.matchAll(/@([A-Za-z0-9._]{3,30})/g), (m) => m[1]!.toLowerCase().replace(/\.$/, '')),
    ),
  ).slice(0, 6);

  const extractedPaymentHints = Array.from(
    new Set([
      ...Array.from(text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g), (m) => m[0]!),
      ...Array.from(text.matchAll(/\b\d{3}[-\s]?\d{3}\s+\d{6,10}\b/g), (m) => m[0]!),
    ]),
  ).slice(0, 4);

  const riskScore = Math.min(
    100,
    flags.reduce((sum, f) => sum + f.points, 0),
  );
  const riskLevel = riskScore >= 50 ? 'HIGH' : riskScore >= 22 ? 'ELEVATED' : 'LOW';

  return {
    riskScore,
    riskLevel,
    flags,
    extractedHandles,
    extractedPaymentHints,
    summary:
      flags.length > 0
        ? `Detected ${flags.length} scam-script indicator${flags.length === 1 ? '' : 's'} (${flags.map((f) => f.label).join('; ')}).`
        : null,
    usedAiVision: false,
  };
}

/** Combine individual forensics flags into a single bounded 0..100 risk report. */
export function buildProfileForensicsReport(input: {
  handle: string | null;
  fbNumericId?: string | null;
  visibleProfile?: VisibleProfileMetrics | null;
  waybackFirstSeen?: string | null;
  lookalikeHighRefCount?: number;
  positiveRefs: number;
  ebayFound: boolean;
  facebookIndex?: FacebookIndexReport | null;
}): ProfileForensicsReport {
  const flags: ForensicsFlag[] = [];

  const fbAge = analyzeFacebookIdAge(input.fbNumericId);
  if (fbAge?.flag) flags.push(fbAge.flag);

  flags.push(...facebookIndexFlags(input.facebookIndex));

  flags.push(...analyzeHandlePattern(input.handle));

  if (input.visibleProfile) {
    flags.push(...scoreVisibleProfile(input.visibleProfile));
  }

  let mlPrediction: FakeProfilePrediction | null = null;
  if (
    input.visibleProfile &&
    typeof input.visibleProfile.postsCount === 'number' &&
    typeof input.visibleProfile.followersCount === 'number' &&
    typeof input.visibleProfile.followingCount === 'number'
  ) {
    mlPrediction = predictFakeProfileProbability({
      hasProfilePic: input.visibleProfile.hasProfilePic !== false,
      handle: input.visibleProfile.handle ?? input.handle,
      displayName: input.visibleProfile.displayName,
      bio: input.visibleProfile.bio,
      hasExternalUrl: input.visibleProfile.hasExternalUrl ?? false,
      postsCount: input.visibleProfile.postsCount,
      followersCount: input.visibleProfile.followersCount,
      followingCount: input.visibleProfile.followingCount,
    });

    if (mlPrediction.band === 'HIGH') {
      flags.push({
        code: 'ML_HIGH_FAKE_PROBABILITY',
        label: `ML fake-profile model: ${mlPrediction.percent}% inauthentic likelihood`,
        detail: `Trained on 8,500+ real/fake social profiles (94–97% accuracy). Key drivers: ${mlPrediction.topRiskDrivers.join(', ') || 'follower/post distribution'}.`,
        severity: 'HIGH',
        points: 35,
      });
    } else if (mlPrediction.band === 'ELEVATED') {
      flags.push({
        code: 'ML_ELEVATED_FAKE_PROBABILITY',
        label: `ML fake-profile model: ${mlPrediction.percent}% elevated risk`,
        detail: `Key drivers: ${mlPrediction.topRiskDrivers.join(', ') || 'follower/post distribution'}.`,
        severity: 'CAUTION',
        points: 18,
      });
    }
  }

  if ((input.lookalikeHighRefCount ?? 0) > 0 && input.positiveRefs === 0 && !input.ebayFound) {
    flags.push({
      code: 'LOOKALIKE_OF_ESTABLISHED',
      label: 'Handle closely resembles an established trader with references',
      detail:
        'This account has 0 references and no eBay presence, while a similarly spelled handle in our trust graph has established positive references. Double-check exact spelling.',
      severity: 'CAUTION',
      points: 20,
    });
  }

  // High TCG following with zero references anywhere
  if (
    input.visibleProfile &&
    (input.visibleProfile.followingCount ?? 0) >= 500 &&
    input.positiveRefs === 0 &&
    !input.ebayFound
  ) {
    flags.push({
      code: 'HIGH_EXPOSURE_ZERO_REFS',
      label: 'Large following footprint with zero verifiable references',
      detail: 'Account follows hundreds/thousands of profiles yet has 0 references in our TCG graph and no eBay seller history.',
      severity: 'CAUTION',
      points: 18,
    });
  }

  const riskScore = Math.min(
    100,
    flags.reduce((sum, f) => sum + f.points, 0),
  );
  const riskLevel = riskScore >= 50 ? 'HIGH' : riskScore >= 22 ? 'ELEVATED' : 'LOW';

  return {
    riskScore,
    riskLevel,
    flags,
    mlPrediction,
    fbIdEra: fbAge
      ? { id: fbAge.id, eraLabel: fbAge.eraLabel, isRecent: fbAge.isRecent }
      : null,
    waybackFirstSeen: input.waybackFirstSeen ?? null,
    visibleProfile: input.visibleProfile ?? null,
    facebookIndex: input.facebookIndex ?? null,
  };
}
