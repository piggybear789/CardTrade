// lib/listings/itemFormSteps.ts
//
// The three steps of the "Sell an item" form (`components/listings/ItemForm.tsx`):
// 1 Details (kind, title, description, price), 2 Condition & location (photos below
// `lg`, game, condition, place). There is no slab-details question: Graded is one entry
// in the condition list. Which field lives on which step, and what
// each step still needs before Next lets the seller on.
//
// PURE, so the form and its tests share one copy of the rules. The checks MIRROR the
// server's validators rather than restating them: the description and condition run
// through `itemSubmissionSchema` itself, so a message shown at a step boundary is the
// message the server
// would have returned from the last step — the two cannot drift. The remaining checks
// (game picked, price parses, photo count, place chosen) are the form's own existing
// client-side guards, re-grouped by step.

import { runSchema } from '@/domain/validation/result';
import { IMAGES_MAX, IMAGES_MIN, itemSubmissionSchema } from '@/domain/validation/item';

/** A step of the listing form, 1-based. */
export type ItemFormStep = 1 | 2;

/** The steps' names, in order. Static, so the indicator never changes width. */
export const ITEM_FORM_STEP_LABELS = ['Details', 'Condition & location'] as const;

/** Every field the form can report an inline error against. */
export type ItemFormErrorField =
  | 'title'
  | 'description'
  | 'category'
  | 'condition'
  | 'grader'
  | 'grade'
  | 'certNumber'
  | 'fmvCents'
  | 'images'
  | 'location';

const FIELD_STEP: Record<ItemFormErrorField, ItemFormStep> = {
  title: 1,
  description: 1,
  category: 2,
  condition: 2,
  grader: 2,
  grade: 2,
  certNumber: 2,
  images: 2,
  fmvCents: 1,
  location: 2,
};

/**
 * The step holding `field`, or `null` for a general error or a field the form does
 * not render (e.g. a schema's `(root)`), which stays on whichever step is open.
 */
export function stepForField(field: string | null | undefined): ItemFormStep | null {
  if (!field) return null;
  return Object.prototype.hasOwnProperty.call(FIELD_STEP, field)
    ? FIELD_STEP[field as ItemFormErrorField]
    : null;
}

/**
 * Convert a dollars string (e.g. `"123.45"`) to integer AUD cents. Returns `null`
 * when the input is empty or not a finite number so the caller can show a friendly
 * validation message rather than sending garbage to the server.
 */
export function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/** What the step checks read from the form's state. */
export interface ItemFormStepInput {
  listingKind: 'SINGLE' | 'SHOPFRONT';
  description: string;
  game: string;
  condition: string;
  grader: string;
  grade: string;
  certNumber: string;
  /** Kept photos plus newly picked ones. */
  totalImages: number;
  fmvDollars: string;
  /** The chosen place's label, or `null` when none is chosen. */
  locationLabel: string | null;
}

/** One inline error: the field it sits beside and what it says. */
export interface ItemFormStepProblem {
  field: ItemFormErrorField;
  message: string;
}

const descriptionSchema = itemSubmissionSchema.pick({ description: true });
const conditionSchema = itemSubmissionSchema.pick({ condition: true });

/**
 * The first thing `step` still needs, or `null` when it is complete.
 *
 * The title is deliberately not checked: the action derives a blank title from the
 * description, so it is optional here.
 */
export function itemFormStepProblem(
  step: ItemFormStep,
  input: ItemFormStepInput,
): ItemFormStepProblem | null {
  if (step === 1) {
    const description = runSchema(descriptionSchema, { description: input.description });
    if (!description.ok) {
      return { field: 'description', message: description.message };
    }
    if (dollarsToCents(input.fmvDollars) === null) {
      return { field: 'fmvCents', message: 'Enter a price in dollars (e.g. 123.45).' };
    }
    return null;
  }

  if (step === 2) {
    // Photos first: from `lg` the panel is beside every step, and below `lg` it sits
    // above the condition fields on this one.
    if (input.totalImages < IMAGES_MIN) {
      return { field: 'images', message: 'Add at least one image of your item.' };
    }
    if (input.totalImages > IMAGES_MAX) {
      return { field: 'images', message: `You can add at most ${IMAGES_MAX} images.` };
    }
    if (!input.game) {
      return { field: 'category', message: 'Select the card game.' };
    }
    const condition = runSchema(conditionSchema, { condition: input.condition });
    if (!condition.ok) {
      return { field: 'condition', message: condition.message };
    }
    if (!input.locationLabel?.trim()) {
      return { field: 'location', message: 'Add where this listing is based (suburb or city).' };
    }
    return null;
  }

  return null;
}

/** The first step with something missing, or `null` when the whole form is complete. */
export function firstIncompleteStep(input: ItemFormStepInput): ItemFormStep | null {
  for (const step of [1, 2] as const) {
    if (itemFormStepProblem(step, input)) return step;
  }
  return null;
}
