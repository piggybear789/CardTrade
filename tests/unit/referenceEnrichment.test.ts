// tests/unit/referenceEnrichment.test.ts
//
// Unit tests for Reference Enrichment (0169):
//   - Input classification (handles, FB Marketplace URLs, eBay/IG URLs, full names)
//   - Messenger payment identifier classification
//   - Realness & risk assessment separation (OSINT never masquerades as ID-verified)
//   - eBay Browse & Trading API normalization
//   - Deterministic 512-dim vector embeddings

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { computeRealnessAssessment } from '@/domain/references/enrichment';
import {
  candidateHandlesFromName,
  inferPaymentIdentifierCandidates,
  parseReferenceLookupInput,
  referenceCheckHref,
} from '@/domain/references/lookup';
import {
  analyzePaymentRail,
  lookupAustralianBsbBank,
  namesShareIdentity,
} from '@/domain/references/paymentForensics';
import {
  analyzeDmScriptHeuristic,
  analyzeFacebookIdAge,
  buildProfileForensicsReport,
  scoreVisibleProfile,
} from '@/domain/references/profileForensics';
import { normalizeBrowseSellerResponse, parseTradingGetUserXml } from '@/lib/enrichment/ebay';
import {
  computeTrimmedStats,
  evaluateAskingPriceVsMarket,
  normalizePsaCertNumber,
} from '@/lib/enrichment/psaCert';
import { deterministicEmbedding512 } from '@/lib/references/vectorSearch';

describe('parseReferenceLookupInput', () => {
  it('extracts numeric Facebook Marketplace profile IDs without scraping', () => {
    const parsed = parseReferenceLookupInput(
      'https://www.facebook.com/marketplace/profile/100012345678901/?ref=permalink',
    );
    expect(parsed).toEqual({
      kind: 'handle',
      handle: '100012345678901',
      platform: 'facebook',
      sourceUrl: 'https://www.facebook.com/marketplace/profile/100012345678901/',
      isNumericFbId: true,
      fromUrl: true,
    });
  });

  it('extracts BOTH numeric ID and name from Facebook /people/ URLs', () => {
    expect(
      parseReferenceLookupInput('https://www.facebook.com/people/John-Smith/61561234567890/'),
    ).toMatchObject({
      kind: 'handle',
      handle: '61561234567890',
      platform: 'facebook',
      extractedName: 'John Smith',
      isNumericFbId: true,
      fromUrl: true,
    });
  });

  it('extracts Facebook profile.php?id= and vanity slugs', () => {
    expect(parseReferenceLookupInput('facebook.com/profile.php?id=10009876543210')).toMatchObject({
      kind: 'handle',
      handle: '10009876543210',
      platform: 'facebook',
      isNumericFbId: true,
    });
    expect(parseReferenceLookupInput('https://facebook.com/dave.cards.au')).toMatchObject({
      kind: 'handle',
      handle: 'dave.cards.au',
      platform: 'facebook',
      isNumericFbId: false,
    });
  });

  it('extracts eBay and Instagram profile URLs', () => {
    expect(parseReferenceLookupInput('https://www.ebay.com.au/usr/poke_vault_au')).toMatchObject({
      kind: 'handle',
      handle: 'poke_vault_au',
      platform: 'ebay',
    });
    expect(parseReferenceLookupInput('https://www.instagram.com/byedrifloon/')).toMatchObject({
      kind: 'handle',
      handle: 'byedrifloon',
      platform: 'instagram',
    });
  });

  it('routes multi-word Marketplace names to name lookup', () => {
    expect(parseReferenceLookupInput('John Smith')).toEqual({
      kind: 'name',
      name: 'John Smith',
    });
    expect(referenceCheckHref({ q: 'John Smith', location: 'Melbourne' })).toBe(
      '/references/check?q=John+Smith&location=Melbourne',
    );
  });
});

describe('candidateHandlesFromName & inferPaymentIdentifierCandidates', () => {
  it('derives bounded username permutations from a 2-word name', () => {
    expect(candidateHandlesFromName('David Chen')).toEqual([
      'davidchen',
      'david.chen',
      'david_chen',
    ]);
    expect(candidateHandlesFromName('Cher')).toEqual([]);
  });

  it('classifies PayID emails, AU phones, and BSB+account details', () => {
    expect(inferPaymentIdentifierCandidates('scammer@example.com').map((c) => c.kind)).toEqual([
      'PAYID_EMAIL',
      'PAYPAL_EMAIL',
    ]);
    expect(inferPaymentIdentifierCandidates('0412 345 678').map((c) => c.kind)).toEqual([
      'PAYID_PHONE',
      'PHONE',
    ]);
    expect(inferPaymentIdentifierCandidates('062-000 12345678').map((c) => c.kind)).toContain(
      'BANK_ACCOUNT',
    );
  });
});

describe('computeRealnessAssessment', () => {
  const cleanScam = { matchedReportCount: 0, corroborated: false, matchedKinds: [], nameMatchCount: 0 };
  const cleanForensics = buildProfileForensicsReport({
    handle: 'cardshop',
    positiveRefs: 0,
    ebayFound: true,
  });

  it('never marks an unverified Sherlock/eBay footprint as ID_VERIFIED', () => {
    const assessment = computeRealnessAssessment({
      targetKind: 'HANDLE',
      identityVerified: false,
      positiveRefs: 0,
      negativeRefs: 0,
      hasLocation: false,
      hasSecondaryHandle: false,
      scamRisk: cleanScam,
      forensics: cleanForensics,
      ebay: {
        username: 'cardshop',
        found: true,
        oauthVerified: false,
        feedbackScore: 340,
        feedbackPercentage: '99.7',
        activeListingsCount: 18,
        profileUrl: 'https://www.ebay.com/usr/cardshop',
        sampleListings: [],
        note: null,
      },
      sherlockCount: 8,
      webWarningsCount: 0,
    });
    expect(assessment.tier).toBe('ESTABLISHED_FOOTPRINT');
  });

  it('flags WARNING_FLAGGED immediately on scam-report hash match', () => {
    const assessment = computeRealnessAssessment({
      targetKind: 'PERSON_NAME',
      identityVerified: false,
      positiveRefs: 0,
      negativeRefs: 0,
      hasLocation: true,
      hasSecondaryHandle: false,
      scamRisk: {
        matchedReportCount: 2,
        corroborated: true,
        matchedKinds: ['PAYID_EMAIL'],
        nameMatchCount: 0,
      },
      forensics: cleanForensics,
      ebay: null,
      sherlockCount: 0,
      webWarningsCount: 0,
    });
    expect(assessment.tier).toBe('WARNING_FLAGGED');
  });

  it('marks bare common name with no history as LIMITED_FOOTPRINT with HIGH collision risk', () => {
    const assessment = computeRealnessAssessment({
      targetKind: 'PERSON_NAME',
      identityVerified: false,
      positiveRefs: 0,
      negativeRefs: 0,
      hasLocation: false,
      hasSecondaryHandle: false,
      scamRisk: cleanScam,
      forensics: cleanForensics,
      ebay: null,
      sherlockCount: 0,
      webWarningsCount: 0,
    });
    expect(assessment.tier).toBe('LIMITED_FOOTPRINT');
    expect(assessment.collisionRisk).toBe('HIGH');
  });

  it('catches johtocollects_ visible profile anomalies WITHOUT any prior scam stories', () => {
    const forensics = buildProfileForensicsReport({
      handle: 'johtocollects_',
      visibleProfile: {
        platform: 'instagram',
        handle: 'johtocollects_',
        displayName: 'Johto Collects',
        postsCount: 9,
        followersCount: 620,
        followingCount: 3684,
        isPrivate: true,
        category: 'Musician/band',
        bio: 'Small vendor 😎 Pokemon and occasionally one piece 🤝 Buy·Sell·Trade 👑',
        isVerified: false,
        source: 'API',
      },
      lookalikeHighRefCount: 1,
      positiveRefs: 0,
      ebayFound: false,
    });
    expect(forensics.riskLevel).toBe('HIGH');
    expect(forensics.riskScore).toBeGreaterThanOrEqual(80);
    expect(forensics.flags.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        'IMPERSONATION_PUNCTUATION',
        'EXTREME_FOLLOWING_RATIO',
        'CATEGORY_BIO_MISMATCH',
        'PRIVATE_VENDOR_ACCOUNT',
        'LOW_POSTS_VENDOR',
      ]),
    );

    const assessment = computeRealnessAssessment({
      targetKind: 'CLAIM',
      identityVerified: false,
      positiveRefs: 0,
      negativeRefs: 0,
      hasLocation: false,
      hasSecondaryHandle: false,
      scamRisk: cleanScam,
      forensics,
      ebay: null,
      sherlockCount: 0,
      webWarningsCount: 0,
    });
    expect(assessment.tier).toBe('WARNING_FLAGGED');
  });
});

describe('profileForensics: Facebook ID era & multilingual DM scam scripts', () => {
  it('flags recent 615x Facebook numeric IDs as recently created', () => {
    const recent = analyzeFacebookIdAge('61561234567890');
    expect(recent?.isRecent).toBe(true);
    expect(recent?.flag?.code).toBe('FB_RECENT_615_ID');

    const established = analyzeFacebookIdAge('100001234567890');
    expect(established?.isRecent).toBe(false);
    expect(established?.flag).toBeNull();
  });

  it('catches Swiss-German collateral/50%-off grail DM script without any prior reports', () => {
    const dm = analyzeDmScriptHeuristic(
      'Hey, ich han sone Pikachu Gold Star Charte ih sonre PSA (6) hülle wo eine bi mir als depot glah hett für rund 4k matrial... Mini eigete choste fürs Mati liged bi rund 2k und ich wer froh wenni die wider dusse ha',
    );
    expect(dm.riskLevel).toBe('HIGH');
    expect(dm.flags.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        'DM_COLLATERAL_BACKSTORY',
        'DM_STEEP_BELOW_MARKET',
        'DM_HIGH_FRAUD_GRAIL',
      ]),
    );
  });

  it('scores clean established vendor profiles with zero high-severity anomalies', () => {
    const flags = scoreVisibleProfile({
      platform: 'instagram',
      handle: 'realcardshop',
      displayName: 'Real Card Shop',
      postsCount: 240,
      followersCount: 4800,
      followingCount: 320,
      isPrivate: false,
      category: 'Collectibles Store',
      bio: 'Pokemon TCG slabs & singles · Buy·Sell·Trade',
      isVerified: false,
      source: 'API',
    });
    expect(flags).toEqual([]);
  });
});

describe('eBay API normalization', () => {
  it('parses Browse API seller summaries and listings', () => {
    const summary = normalizeBrowseSellerResponse('poke_seller', false, {
      total: 12,
      itemSummaries: [
        {
          title: 'Charizard ex PSA 10',
          itemWebUrl: 'https://www.ebay.com.au/itm/12345',
          price: { value: '450.00', currency: 'AUD' },
          seller: {
            username: 'poke_seller',
            feedbackScore: 512,
            feedbackPercentage: '99.8',
          },
        },
      ],
    });
    expect(summary).toMatchObject({
      username: 'poke_seller',
      found: true,
      feedbackScore: 512,
      feedbackPercentage: '99.8',
      activeListingsCount: 12,
    });
    expect(summary?.sampleListings).toHaveLength(1);
  });

  it('rejects Browse API responses when eBay ignores sellers filter and returns another seller', () => {
    const summary = normalizeBrowseSellerResponse('johtocollects_', false, {
      total: 38878974,
      itemSummaries: [
        {
          title: 'Random listing from another seller',
          itemWebUrl: 'https://www.ebay.com.au/itm/999',
          seller: {
            username: 'the_gaming_citadel',
            feedbackScore: 1932,
            feedbackPercentage: '100.0',
          },
        },
      ],
    });
    expect(summary).toBeNull();
  });

  it('parses eBay Trading API GetUser XML and rejects failures', () => {
    expect(
      parseTradingGetUserXml(
        '<GetUserResponse><Ack>Success</Ack><User><UserID>card_king</UserID><FeedbackScore>89</FeedbackScore><PositiveFeedbackPercent>100.0</PositiveFeedbackPercent><RegistrationDate>2019-04-12T00:00:00.000Z</RegistrationDate></User></GetUserResponse>',
      ),
    ).toEqual({
      found: true,
      feedbackScore: 89,
      feedbackPercentage: '100.0',
      registrationDate: '2019-04-12',
    });

    expect(parseTradingGetUserXml('<GetUserResponse><Ack>Failure</Ack></GetUserResponse>')).toEqual({
      found: false,
      feedbackScore: null,
      feedbackPercentage: null,
      registrationDate: null,
    });
  });
});

describe('deterministicEmbedding512', () => {
  it('produces unit-normalized 512-dim vectors with higher similarity for related names/cities', () => {
    const cosine = (a: number[], b: number[]) =>
      a.reduce((sum, val, i) => sum + val * b[i]!, 0);

    const a = deterministicEmbedding512('David Chen Melbourne pokemon cards');
    const b = deterministicEmbedding512('Dave Chen Melb pokemon tcg');
    const c = deterministicEmbedding512('completely unrelated bakery shop perth');

    expect(a).toHaveLength(512);
    expect(cosine(a, a)).toBeCloseTo(1, 3);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
});

describe('proactive pre-scam checks: PSA cert, price comp, and payment-rail forensics', () => {
  it('validates PSA cert numbers and rejects malformed inputs', () => {
    expect(normalizePsaCertNumber('172722881')).toBe('172722881');
    expect(normalizePsaCertNumber('PSA #8415-2150')).toBe('84152150');
    expect(normalizePsaCertNumber('12345')).toBeNull();
  });

  it('computes trimmed median prices and flags suspicious steep discounts', () => {
    const stats = computeTrimmedStats([15, 280, 300, 310, 320, 350, 9999]);
    expect(stats).toEqual({ median: 310, low: 280, high: 350 });

    expect(evaluateAskingPriceVsMarket(140, 310, 7)).toMatchObject({
      discountPercent: 55,
      riskLevel: 'HIGH',
    });
    expect(evaluateAskingPriceVsMarket(205, 310, 7)).toMatchObject({
      discountPercent: 34,
      riskLevel: 'ELEVATED',
    });
    expect(evaluateAskingPriceVsMarket(295, 310, 7)).toMatchObject({
      riskLevel: 'LOW',
    });
  });

  it('resolves Australian BSB banks and catches hijacked-account payee name mismatches', () => {
    expect(lookupAustralianBsbBank('062-000 12345678')?.bankName).toContain('Commonwealth Bank');
    expect(lookupAustralianBsbBank('802-985 12345678')?.bankName).toContain('Neobank');
    expect(namesShareIdentity('David Chen', 'Dave Chen')).toBe(true);
    expect(namesShareIdentity('Lynton Miller', 'Sarah Nguyen')).toBe(false);

    const mismatch = analyzePaymentRail({
      profileName: 'Lynton Miller',
      payeeName: 'Sarah Nguyen',
      paymentDetail: '062-000 12345678',
      locationHint: 'Melbourne',
    });
    expect(mismatch.riskLevel).toBe('HIGH');
    expect(mismatch.flags.map((f) => f.code)).toContain('PAYEE_NAME_MISMATCH');
    expect(mismatch.bsbBankName).toContain('Commonwealth Bank');
  });

  it('flags disposable emails and non-Australian phone numbers on AU listings', () => {
    const disposable = analyzePaymentRail({
      paymentDetail: 'seller999@mailinator.com',
    });
    expect(disposable.riskLevel).toBe('HIGH');
    expect(disposable.flags.map((f) => f.code)).toContain('DISPOSABLE_PAYMENT_EMAIL');

    const foreignPhone = analyzePaymentRail({
      paymentDetail: '+44 7700 900077',
      locationHint: 'Sydney, Australia',
    });
    expect(foreignPhone.riskLevel).toBe('HIGH');
    expect(foreignPhone.flags.map((f) => f.code)).toContain('PHONE_LOCATION_MISMATCH');
  });

  it('escalates RealnessAssessment to WARNING_FLAGGED on stolen eBay PSA cert collision', () => {
    const assessment = computeRealnessAssessment({
      targetKind: 'HANDLE',
      identityVerified: false,
      positiveRefs: 0,
      negativeRefs: 0,
      hasLocation: false,
      hasSecondaryHandle: false,
      scamRisk: { matchedReportCount: 0, corroborated: false, matchedKinds: [], nameMatchCount: 0 },
      forensics: buildProfileForensicsReport({ handle: 'lynton.miller.94', positiveRefs: 0, ebayFound: false }),
      psaCert: {
        certNumber: '172722881',
        psaVerifyUrl: 'https://www.psacard.com/cert/172722881/psa',
        psaApiStatus: 'UNAVAILABLE',
        psaCardTitle: null,
        psaGrade: null,
        psaYear: null,
        psaBrand: null,
        ebayMatches: [
          {
            marketplace: 'EBAY_US',
            title: 'PSA 10 Mega Lucario ex Cert 172722881',
            sellerUsername: 'rr_shop10',
            sellerFeedbackScore: 500,
            priceValue: 294.99,
            priceCurrency: 'USD',
            itemUrl: 'https://www.ebay.com/itm/123',
            sellerMatchesSubject: false,
          },
        ],
        riskLevel: 'HIGH',
        riskReason: 'Possible stolen photo: exact PSA cert #172722881 is listed on eBay by rr_shop10.',
      },
      ebay: null,
      sherlockCount: 0,
      webWarningsCount: 0,
    });
    expect(assessment.tier).toBe('WARNING_FLAGGED');
  });
});
