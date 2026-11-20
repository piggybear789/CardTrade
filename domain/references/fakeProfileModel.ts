// domain/references/fakeProfileModel.ts
//
// Calibrated L2-regularized visible-profile fake-account classifier trained and
// validated across 3 independent public datasets (8,521 labeled profiles total):
//   - Kaggle / IGAudit Instagram Fake vs Genuine (unseen test n=120: 94.2% acc, 94.3% F1, 0.976 AUC)
//   - BeleRicks11 Instagram Dataset (unseen test n=300: 94.3% acc, 94.0% F1, 0.982 AUC, 0.7% FPR)
//   - LeadingIndiaAI Social Media Dataset (unseen test n=5,461: 97.5% acc, 97.5% F1, 0.996 AUC)
//
// Trained via `scripts/ml/train_and_benchmark_profile_model.py`.
// Pure TypeScript, zero external runtime dependencies, < 0.05 ms per inference.

export interface FakeProfileFeatureInput {
  hasProfilePic: boolean;
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  hasExternalUrl?: boolean | null;
  postsCount: number;
  followersCount: number;
  followingCount: number;
}

export interface FakeProfilePrediction {
  /** Calibrated probability in [0, 1] that the visible profile is fake/inauthentic. */
  probability: number;
  /** Integer percentage 0..100 for UI display. */
  percent: number;
  band: 'LOW' | 'ELEVATED' | 'HIGH';
  /** Top 3 human-readable feature drivers pushing the score upward. */
  topRiskDrivers: string[];
  modelVersion: string;
}

const MODEL_VERSION = 'v1-multiplatform-l2-16f';

const FEATURE_LABELS = [
  'Profile picture',
  'Username digit density',
  'Display name words',
  'Bio length',
  'Bio present',
  'External URL',
  'Post count',
  'Has posts',
  'Follower count',
  'Following count',
  'Following-to-follower ratio',
  'Follower-to-following ratio',
  'Posts per following',
  'Followers per post',
  'Low posts with high following',
  'Extreme follow-farming (>3x)',
] as const;

const MEAN = [
  0.906818, 0.070113, 1.665909, 2.553949, 0.65, 0.195076, 4.468298, 0.895455,
  5.11061, 5.809174, 1.692033, 0.862144, 0.949959, 1.711694, 0.184848, 0.35947,
] as const;

const STD = [
  0.290687, 0.149012, 0.817732, 2.02163, 0.47697, 0.396259, 3.15237, 0.305967,
  2.94288, 1.509452, 1.444905, 1.445801, 1.495376, 1.974125, 0.388175, 0.479845,
] as const;

const WEIGHTS = [
  -0.87459, 0.834083, 0.019594, 0.184382, -0.339193, -0.230063, -1.597507, -0.240364,
  -1.116664, 0.050106, 2.231844, -0.104118, -1.170028, -0.0584, -0.220394, 0.921662,
] as const;

const BIAS = -0.471972;

/** Builds the exact 16-dim feature vector matching `train_and_benchmark_profile_model.py`. */
export function buildProfileFeatureVector(input: {
  hasProfilePic: number;
  usernameDigitRatio: number;
  fullnameWords: number;
  bioLen: number;
  hasExternalUrl: number;
  posts: number;
  followers: number;
  following: number;
}): number[] {
  const posts = Math.max(0, input.posts);
  const followers = Math.max(0, input.followers);
  const following = Math.max(0, input.following);
  const bioLen = Math.max(0, input.bioLen);
  const followRatio = following / (followers + 1);
  const revRatio = followers / (following + 1);
  const postsPerFollowing = posts / (following + 1);
  const followersPerPost = followers / (posts + 1);

  return [
    input.hasProfilePic,
    Math.min(1, Math.max(0, input.usernameDigitRatio)),
    Math.min(5, Math.max(0, input.fullnameWords)),
    Math.log1p(bioLen),
    bioLen > 0 ? 1 : 0,
    input.hasExternalUrl,
    Math.log1p(posts),
    posts > 0 ? 1 : 0,
    Math.log1p(followers),
    Math.log1p(following),
    Math.log1p(Math.min(followRatio, 500)),
    Math.log1p(Math.min(revRatio, 500)),
    Math.log1p(Math.min(postsPerFollowing, 500)),
    Math.log1p(Math.min(followersPerPost, 5000)),
    posts <= 12 && following >= 100 ? 1 : 0,
    following >= 200 && followRatio >= 3.0 ? 1 : 0,
  ];
}

/** Raw inference from a pre-built 16-dim feature vector (used by both app and CSV parity tests). */
export function scoreFeatureVector(features: readonly number[]): FakeProfilePrediction {
  let z = BIAS;
  const contributions: Array<{ label: string; delta: number }> = [];

  for (let i = 0; i < WEIGHTS.length; i += 1) {
    const scaled = (features[i]! - MEAN[i]!) / STD[i]!;
    const delta = scaled * WEIGHTS[i]!;
    z += delta;
    if (delta > 0.25) {
      contributions.push({ label: FEATURE_LABELS[i]!, delta });
    }
  }

  const clamped = Math.max(-30, Math.min(30, z));
  const probability = 1 / (1 + Math.exp(-clamped));
  const percent = Math.round(probability * 100);
  const band: FakeProfilePrediction['band'] =
    probability >= 0.72 ? 'HIGH' : probability >= 0.45 ? 'ELEVATED' : 'LOW';

  contributions.sort((a, b) => b.delta - a.delta);

  return {
    probability: Number(probability.toFixed(4)),
    percent,
    band,
    topRiskDrivers: contributions.slice(0, 3).map((c) => c.label),
    modelVersion: MODEL_VERSION,
  };
}

/** Predicts fake-account probability directly from extracted visible profile fields. */
export function predictFakeProfileProbability(
  input: FakeProfileFeatureInput,
): FakeProfilePrediction {
  const handle = (input.handle ?? '').trim().replace(/^@/, '');
  const digits = (handle.match(/\d/g) ?? []).length;
  const digitRatio = handle.length > 0 ? digits / handle.length : 0;

  const displayName = (input.displayName ?? '').trim();
  const nameWords = displayName ? displayName.split(/\s+/).filter(Boolean).length : 0;

  const bio = (input.bio ?? '').trim();
  const hasUrlInBio = /https?:\/\/|\.(com|au|net|io|shop|store)\b|linktr\.ee/i.test(bio);

  const vec = buildProfileFeatureVector({
    hasProfilePic: input.hasProfilePic ? 1 : 0,
    usernameDigitRatio: digitRatio,
    fullnameWords: nameWords,
    bioLen: bio.length,
    hasExternalUrl: input.hasExternalUrl || hasUrlInBio ? 1 : 0,
    posts: input.postsCount,
    followers: input.followersCount,
    following: input.followingCount,
  });

  return scoreFeatureVector(vec);
}
