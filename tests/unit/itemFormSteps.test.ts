// tests/unit/itemFormSteps.test.ts
//
// The listing form's step rules: which step each field lives on, and what each step
// still needs before Next lets the seller on.

import { describe, expect, it } from 'vitest';

import {
  dollarsToCents,
  firstIncompleteStep,
  itemFormStepProblem,
  stepForField,
  type ItemFormStepInput,
} from '@/lib/listings/itemFormSteps';

const valid: ItemFormStepInput = {
  listingKind: 'SINGLE',
  description: 'Charizard, base set holo',
  game: 'pokemon',
  condition: 'Near Mint',
  grader: '',
  grade: '',
  certNumber: '',
  totalImages: 1,
  fmvDollars: '80.00',
  locationLabel: 'Newtown NSW',
};

describe('stepForField', () => {
  it.each([
    ['title', 1],
    ['description', 1],
    ['category', 1],
    ['condition', 1],
    ['grader', 1],
    ['grade', 1],
    ['certNumber', 1],
    ['images', 2],
    ['fmvCents', 3],
    ['location', 3],
  ] as const)('%s is on step %i', (field, step) => {
    expect(stepForField(field)).toBe(step);
  });

  it('maps a general or unknown field to no step', () => {
    expect(stepForField(null)).toBeNull();
    expect(stepForField(undefined)).toBeNull();
    expect(stepForField('(root)')).toBeNull();
    expect(stepForField('toString')).toBeNull();
  });
});

describe('itemFormStepProblem, step 1', () => {
  it('passes a complete single listing, with a blank title', () => {
    expect(itemFormStepProblem(1, valid)).toBeNull();
  });

  it('reports problems in field order', () => {
    const graded = { ...valid, condition: 'Graded', grader: 'PSA', grade: '10' };
    expect(itemFormStepProblem(1, { ...valid, description: '   ', game: '' })?.field).toBe(
      'description',
    );
    expect(itemFormStepProblem(1, { ...valid, game: '', condition: '' })).toEqual({
      field: 'category',
      message: 'Select the card game.',
    });
    expect(itemFormStepProblem(1, { ...valid, condition: '' })?.field).toBe('condition');
    expect(itemFormStepProblem(1, { ...graded, grader: '', grade: '' })).toEqual({
      field: 'grader',
      message: 'Choose who graded the card.',
    });
    expect(itemFormStepProblem(1, { ...graded, grade: '' })).toEqual({
      field: 'grade',
      message: 'Enter the grade on the label.',
    });
    expect(itemFormStepProblem(1, { ...graded, certNumber: '!!' })?.field).toBe('certNumber');
    expect(itemFormStepProblem(1, graded)).toBeNull();
  });

  it('asks a binder or bulk listing for no slab details', () => {
    expect(
      itemFormStepProblem(1, { ...valid, listingKind: 'SHOPFRONT', condition: 'Graded' }),
    ).toBeNull();
  });
});

describe('itemFormStepProblem, step 2', () => {
  it.each([
    [0, 'Add at least one image of your item.'],
    [1, null],
    [10, null],
    [11, 'You can add at most 10 images.'],
  ] as const)('%i photos', (totalImages, message) => {
    const problem = itemFormStepProblem(2, { ...valid, totalImages });
    expect(problem?.message ?? null).toBe(message);
    if (problem) expect(problem.field).toBe('images');
  });
});

describe('itemFormStepProblem, step 3', () => {
  it('needs a price that parses', () => {
    expect(itemFormStepProblem(3, { ...valid, fmvDollars: '' })?.field).toBe('fmvCents');
    expect(itemFormStepProblem(3, { ...valid, fmvDollars: 'abc' })?.field).toBe('fmvCents');
  });

  it('needs a place', () => {
    expect(itemFormStepProblem(3, { ...valid, locationLabel: null })?.field).toBe('location');
    expect(itemFormStepProblem(3, { ...valid, locationLabel: '  ' })?.field).toBe('location');
  });
});

describe('firstIncompleteStep', () => {
  it('is null for a complete form', () => {
    expect(firstIncompleteStep(valid)).toBeNull();
  });

  it('names the first broken step', () => {
    expect(firstIncompleteStep({ ...valid, totalImages: 0 })).toBe(2);
    expect(firstIncompleteStep({ ...valid, totalImages: 0, game: '' })).toBe(1);
  });
});

describe('dollarsToCents', () => {
  it('rounds dollars to integer cents', () => {
    expect(dollarsToCents('123.45')).toBe(12345);
    expect(dollarsToCents(' ')).toBeNull();
    expect(dollarsToCents('x')).toBeNull();
  });
});
