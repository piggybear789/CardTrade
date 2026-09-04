// tests/unit/imageModerationPolicy.test.ts
//
// The Rekognition allow/reject table is the whole product decision: too tight
// and real card photos never list; too loose and we might as well not scan.
// These cases are the contract with DetectModerationLabels.

import { describe, expect, it } from 'vitest';

import {
  decideImageModeration,
  isIllustratedContent,
} from '@/lib/moderation/policy';

describe('isIllustratedContent', () => {
  it('treats Illustrated and Animated as card-art frames', () => {
    expect(isIllustratedContent([{ Name: 'Illustrated' }])).toBe(true);
    expect(isIllustratedContent([{ Name: 'Animated' }])).toBe(true);
    expect(isIllustratedContent(['Illustrated'])).toBe(true);
  });

  it('is false for photographs and empty responses', () => {
    expect(isIllustratedContent(undefined)).toBe(false);
    expect(isIllustratedContent([])).toBe(false);
    expect(isIllustratedContent([{ Name: 'Photograph' }])).toBe(false);
  });
});

describe('decideImageModeration', () => {
  it('allows a clean card photo with no labels', () => {
    expect(decideImageModeration({ labels: [] })).toBe('allow');
  });

  it('allows the labels that fire on TCG and sports cards', () => {
    const cardFalsePositives = [
      { Name: 'Weapons', ParentName: 'Violence', Confidence: 99 },
      { Name: 'Violence', ParentName: '', Confidence: 99 },
      { Name: 'Graphic Violence', ParentName: 'Violence', Confidence: 92 },
      { Name: 'Blood & Gore', ParentName: 'Violence', Confidence: 91 },
      { Name: 'Visually Disturbing', ParentName: '', Confidence: 88 },
      { Name: 'Corpses', ParentName: 'Death and Emaciation', Confidence: 85 },
      { Name: 'Female Swimwear or Underwear', ParentName: 'Swimwear or Underwear', Confidence: 94 },
      { Name: 'Gambling', ParentName: '', Confidence: 99 },
      { Name: 'Alcoholic Beverages', ParentName: 'Alcohol', Confidence: 90 },
      { Name: 'Smoking', ParentName: 'Drugs & Tobacco Paraphernalia & Use', Confidence: 87 },
      { Name: 'Middle Finger', ParentName: 'Rude Gestures', Confidence: 96 },
      { Name: 'Kissing on the Lips', ParentName: 'Non-Explicit Nudity of Intimate parts and Kissing', Confidence: 84 },
    ];
    expect(decideImageModeration({ labels: cardFalsePositives })).toBe('allow');
  });

  it('rejects photographic explicit content', () => {
    expect(
      decideImageModeration({
        labels: [{ Name: 'Explicit Nudity', ParentName: 'Explicit', Confidence: 92 }],
      }),
    ).toBe('reject');
    expect(
      decideImageModeration({
        labels: [{ Name: 'Explicit', ParentName: '', Confidence: 88 }],
      }),
    ).toBe('reject');
    expect(
      decideImageModeration({
        labels: [{ Name: 'Exposed Female Nipple', ParentName: 'Explicit Nudity', Confidence: 81 }],
      }),
    ).toBe('reject');
  });

  it('allows suggestive illustrated card art', () => {
    expect(
      decideImageModeration({
        labels: [
          { Name: 'Explicit', ParentName: '', Confidence: 86 },
          { Name: 'Exposed Female Nipple', ParentName: 'Explicit Nudity', Confidence: 83 },
        ],
        contentTypes: [{ Name: 'Illustrated' }],
      }),
    ).toBe('allow');
  });

  it('still rejects illustrated sexual activity and genitalia', () => {
    expect(
      decideImageModeration({
        labels: [{ Name: 'Explicit Sexual Activity', ParentName: 'Explicit', Confidence: 90 }],
        contentTypes: [{ Name: 'Illustrated' }],
      }),
    ).toBe('reject');
    expect(
      decideImageModeration({
        labels: [{ Name: 'Exposed Male Genitalia', ParentName: 'Explicit Nudity', Confidence: 85 }],
        contentTypes: [{ Name: 'Animated' }],
      }),
    ).toBe('reject');
  });

  it('ignores labels below the confidence floor', () => {
    expect(
      decideImageModeration({
        labels: [{ Name: 'Explicit Nudity', ParentName: 'Explicit', Confidence: 40 }],
      }),
    ).toBe('allow');
  });
});
