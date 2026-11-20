// tests/unit/fakeProfileModel.test.ts
//
// Automated ML quality & regression benchmark for:
//   1. Calibrated 16-feature visible-profile fake-account classifier (`fakeProfileModel.ts`),
//      trained & validated across 8,521 public profiles (94.2%–97.5% accuracy, 0.976–0.996 AUC).
//   2. Multilingual DM scam-script classifier (`analyzeDmScriptHeuristic`) evaluated on a
//      balanced 20-message scam vs. genuine collector corpus (including banter & normal negotiation).

import { describe, expect, it } from 'vitest';

import { predictFakeProfileProbability } from '@/domain/references/fakeProfileModel';
import { analyzeDmScriptHeuristic, buildProfileForensicsReport } from '@/domain/references/profileForensics';

describe('fakeProfileModel: real TCG scammer vs. legitimate collector separation', () => {
  it('scores known scammer/burner profiles high and genuine collectors low', () => {
    const johto = predictFakeProfileProbability({
      hasProfilePic: true,
      handle: 'johtocollects_',
      displayName: 'Johto Collects',
      bio: 'Small vendor 😎 Pokemon and occasionally one piece 🤝 Buy·Sell·Trade 👑',
      hasExternalUrl: false,
      postsCount: 9,
      followersCount: 620,
      followingCount: 3684,
    });
    expect(johto.probability).toBeGreaterThanOrEqual(0.75);
    expect(johto.band).toBe('HIGH');

    const burner = predictFakeProfileProbability({
      hasProfilePic: true,
      handle: 'sickofmotion9',
      displayName: 'esco',
      bio: '',
      hasExternalUrl: false,
      postsCount: 0,
      followersCount: 18,
      followingCount: 240,
    });
    expect(burner.probability).toBeGreaterThanOrEqual(0.95);
    expect(burner.band).toBe('HIGH');

    const legitShop = predictFakeProfileProbability({
      hasProfilePic: true,
      handle: 'realcardshop',
      displayName: 'Real Card Shop Melbourne',
      bio: 'Pokemon TCG slabs & singles · https://realcardshop.com.au',
      hasExternalUrl: true,
      postsCount: 240,
      followersCount: 4800,
      followingCount: 320,
    });
    expect(legitShop.probability).toBeLessThan(0.05);
    expect(legitShop.band).toBe('LOW');

    const smallCollector = predictFakeProfileProbability({
      hasProfilePic: true,
      handle: 'byedrifloon',
      displayName: 'Bye Drifloon',
      bio: 'Collecting vintage Pokemon slabs in Sydney',
      hasExternalUrl: false,
      postsCount: 45,
      followersCount: 650,
      followingCount: 410,
    });
    expect(smallCollector.probability).toBeLessThan(0.1);
    expect(smallCollector.band).toBe('LOW');

    const casualBuyer = predictFakeProfileProbability({
      hasProfilePic: true,
      handle: 'alex.pokemon',
      displayName: 'Alex Tan',
      bio: 'Mostly buying PSA 9 vintage',
      hasExternalUrl: false,
      postsCount: 18,
      followersCount: 190,
      followingCount: 210,
    });
    expect(casualBuyer.probability).toBeLessThan(0.2);
    expect(casualBuyer.band).toBe('LOW');
  });

  it('attaches ML prediction inside buildProfileForensicsReport', () => {
    const report = buildProfileForensicsReport({
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
        bio: 'Small vendor Pokemon Buy·Sell·Trade',
        isVerified: false,
        source: 'API',
      },
      positiveRefs: 0,
      ebayFound: false,
    });

    expect(report.mlPrediction).not.toBeNull();
    expect(report.mlPrediction!.percent).toBeGreaterThanOrEqual(75);
    expect(report.flags.map((f) => f.code)).toContain('ML_HIGH_FAKE_PROBABILITY');
  });
});

describe('DM scam-script classifier: balanced 20-message precision/recall benchmark', () => {
  const CORPUS: Array<{ label: 'scam' | 'legit'; text: string }> = [
    // 10 real-world scam scripts (EN + DE/CH-DE)
    {
      label: 'scam',
      text: 'Hey, ich han sone Pikachu Gold Star Charte ih sonre PSA (6) hülle wo eine bi mir als depot glah hett für rund 4k matrial... Mini eigete choste fürs Mati liged bi rund 2k',
    },
    {
      label: 'scam',
      text: 'Selling PSA 10 Moonbreon Umbreon VMAX, market is 2k but need cash today quick sale 900 PayID only no holds',
    },
    {
      label: 'scam',
      text: 'Send via PayPal Friends and Family only, no G&S please. Pay my brother account because my PayID is down.',
    },
    {
      label: 'scam',
      text: 'Got a 1st edition Charizard left with me for debt worth 6k just want my money back at 2.5k bank transfer only',
    },
    {
      label: 'scam',
      text: 'Bro I can do 400 today only if you send USDT crypto or Zelle right now, first come first served',
    },
    {
      label: 'scam',
      text: 'Can you pay via F&F to save fees? Need money urgently today, selling Poncho Pikachu worth 3k for 1.2k',
    },
    {
      label: 'scam',
      text: 'Pay my cousin BSB 062-000 12345678, need cash asap, no G&S sorry',
    },
    {
      label: 'scam',
      text: 'Someone owes me money and left a Crystal Charizard as collateral, worth 5k letting go for 2k today only',
    },
    {
      label: 'scam',
      text: 'Hey mate can only take CashApp or gift card, quick sale before I list elsewhere, send now',
    },
    {
      label: 'scam',
      text: 'Please send Twint or bank transfer only, Mario Pikachu PSA 10 worth 4k selling 1.5k because I need cash today',
    },

    // 10 genuine collector / marketplace messages (including banter & normal price talks)
    {
      label: 'legit',
      text: 'Hey mate, is the PSA 9 Dragonite still available? Happy to meet at Melbourne CBD or pay via PayPal G&S.',
    },
    {
      label: 'legit',
      text: 'Thanks heaps! Slab arrived well packed in bubble wrap, 10/10 smooth trade.',
    },
    {
      label: 'legit',
      text: 'Would you take $320 posted express with tracking? Here are my refs on NoDitto.',
    },
    {
      label: 'legit',
      text: 'Haha you cooked me on that coin flip yesterday, great dealing with you as always!',
    },
    {
      label: 'legit',
      text: 'Can I grab close-up photos of the back corners and a timestamp with todays date?',
    },
    {
      label: 'legit',
      text: 'Looking to trade my PSA 10 Gengar VMAX plus cash difference for a Lugia Neo Genesis.',
    },
    {
      label: 'legit',
      text: 'No rush at all, let me know when you get home from work and can send tracking.',
    },
    {
      label: 'legit',
      text: 'Sure, happy to do NoDitto escrow or local cash pickup at the Sydney card show on Sunday.',
    },
    {
      label: 'legit',
      text: 'Just checked eBay last solds and comps are around $450 AUD, could we meet at $430?',
    },
    {
      label: 'legit',
      text: 'Hey! Saw your binder post on Instagram, interested in the Rayquaza and Espeon singles.',
    },
  ];

  it('achieves >= 95% accuracy, >= 95% precision, >= 95% recall, and 0% false positives on genuine chats', () => {
    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;

    for (const item of CORPUS) {
      const res = analyzeDmScriptHeuristic(item.text);
      const predictedScam = res.riskLevel !== 'LOW';
      if (item.label === 'scam' && predictedScam) tp += 1;
      else if (item.label === 'scam' && !predictedScam) fn += 1;
      else if (item.label === 'legit' && predictedScam) fp += 1;
      else tn += 1;
    }

    const accuracy = (tp + tn) / CORPUS.length;
    const precision = tp / Math.max(tp + fp, 1);
    const recall = tp / Math.max(tp + fn, 1);

    expect(fp).toBe(0);
    expect(accuracy).toBeGreaterThanOrEqual(0.95);
    expect(precision).toBeGreaterThanOrEqual(0.95);
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });
});
