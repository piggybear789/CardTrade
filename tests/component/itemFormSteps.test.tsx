// tests/component/itemFormSteps.test.tsx
//
// The "Sell an item" form as three steps: Next is gated on the open step, Back keeps
// what was typed, the listing action fires only from the last step and with the same
// payload the one-page form sent, and a server field error opens that field's step.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { createItem, updateItem } = vi.hoisted(() => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/listings/new',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

vi.mock('@/lib/actions/listings', () => ({ createItem, updateItem }));

vi.mock('@/lib/actions/listingDrafts', () => ({
  saveListingDraft: vi.fn(),
  deleteListingDraft: vi.fn(),
}));

vi.mock('@/lib/storage/uploadItemImages', () => ({
  uploadItemImages: vi.fn(async () => ({ ok: true, paths: ['u/new.jpg'], dims: [null] })),
}));

vi.mock('@/lib/motion/navigate', () => ({ navigateWithType: vi.fn() }));

vi.mock('@/lib/analytics/track', () => ({
  trackActionFailure: vi.fn(),
  trackFormAbandoned: vi.fn(),
  UX_NAMES: { itemForm: 'item-form', createItem: 'create-item', updateItem: 'update-item' },
}));

// The real picker runs a Places search; a stub shows the chosen place and its error.
vi.mock('@/components/location', () => ({
  PlacePicker: ({
    label,
    value,
    error,
  }: {
    label: string;
    value: { label: string } | null;
    error?: string;
  }) => (
    <div>
      <span>{label}</span>
      <span>{value?.label ?? ''}</span>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  ),
}));

import { ItemForm } from '@/components/listings/ItemForm';
import type { ItemRow } from '@/lib/actions/listings';
import { ITEM_FORM_ID } from '@/lib/listings/itemFormChrome';
import type { ItemFormDraftFields } from '@/lib/listings/useItemFormDraft';
import type { PlaceValue } from '@/lib/location/types';

const place: PlaceValue = {
  label: 'Newtown NSW',
  placeId: 'place-1',
  lat: -33.89,
  lng: 151.18,
  countryCode: 'AU',
  precision: 'suburb',
};

const item = {
  id: 'item-1',
  title: 'Charizard Base Set Holo',
  description: 'Light whitening on the back corners.',
  category: 'Pokémon',
  condition: 'Graded',
  grader: 'PSA',
  grade: '9',
  cert_number: '12345678',
  listing_kind: 'SINGLE',
  fmv_cents: 12_345,
  currency: 'aud',
  image_paths: ['seller/a.jpg', 'seller/b.jpg'],
  location_label: place.label,
  location_place_id: place.placeId,
  location_lat: place.lat,
  location_lng: place.lng,
  location_country_code: 'AU',
  location_precision: 'suburb',
} as unknown as ItemRow;

const draftFields: ItemFormDraftFields = {
  title: 'Pikachu promo',
  description: 'Near mint, from a sealed tin.',
  game: 'pokemon',
  condition: 'Near Mint',
  listingKind: 'SINGLE',
  fmvDollars: '80.00',
  location: place,
  grader: '',
  grade: '',
  certNumber: '',
};

const locationPayload = {
  label: place.label,
  placeId: place.placeId,
  lat: place.lat,
  lng: place.lng,
  countryCode: 'AU',
  precision: 'suburb',
};

function stepButton(name: RegExp) {
  return screen.getByRole('button', { name });
}

/**
 * The form's own primary (`type="submit"`) control, asserted to be showing `label`.
 * Found by its live label rather than its accessible name: the button also holds an
 * `invisible` width sizer, and jsdom applies no Tailwind, so the sizer's text would
 * leak into the computed name here although a browser leaves it out.
 */
function primary(label: string): HTMLButtonElement {
  // Next is a plain button and publish the submit; both carry the width sizer.
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(`#${ITEM_FORM_ID} button`),
  ).find((b) => b.querySelector(':scope > span.grid > span.invisible'));
  if (!button) throw new Error('No primary button in the form');
  expect(button).toHaveAttribute('type', label === 'Next' ? 'button' : 'submit');
  expect(button.querySelector('span.grid > span:last-child')).toHaveTextContent(label);
  return button;
}

function next() {
  fireEvent.click(primary('Next'));
}

/** Wait out the form's guard against a publish right after a step change (400ms). */
function pastStepGuard() {
  return new Promise((resolve) => setTimeout(resolve, 450));
}

beforeAll(() => {
  // jsdom has no object URLs; the photo previews mint one per picked file.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  createItem.mockReset();
  updateItem.mockReset();
  window.sessionStorage.clear();
});

afterEach(() => cleanup());

describe('ItemForm steps', () => {
  it('blocks Next on step 1 until its fields are valid, and cannot skip ahead', async () => {
    render(<ItemForm mode="create" />);

    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(stepButton(/Step 1: Details/)).toHaveAttribute('aria-current', 'step');
    expect(stepButton(/Step 2: Photos/)).toBeDisabled();
    expect(stepButton(/Step 3: Price & location/)).toBeDisabled();

    next();

    // The server's own message, from `itemSubmissionSchema`.
    expect(
      await screen.findByText('Description must be at least 1 character'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(stepButton(/Step 1: Details/)).toHaveAttribute('aria-current', 'step');
    expect(createItem).not.toHaveBeenCalled();
  });

  it('keeps step 1 input after going forward and Back', async () => {
    render(<ItemForm mode="edit" item={item} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed title' } });
    next();

    const heading = screen.getByRole('heading', { name: 'Condition' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to Details' }));

    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Details' })).toHaveFocus());
    expect(screen.getByLabelText('Title')).toHaveValue('Changed title');
  });

  it('saves an edit only from step 3, with the unchanged payload', async () => {
    updateItem.mockResolvedValue({ ok: true, data: { id: 'item-1' } });
    render(<ItemForm mode="edit" item={item} />);

    next();
    next();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    expect(updateItem).not.toHaveBeenCalled();

    await pastStepGuard();
    fireEvent.click(primary('Save changes'));

    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1));
    expect(updateItem).toHaveBeenCalledWith('item-1', {
      title: 'Charizard Base Set Holo',
      description: 'Light whitening on the back corners.',
      category: 'Pokémon',
      condition: 'Graded',
      grading: { grader: 'PSA', grade: '9', certNumber: '12345678' },
      fmvCents: 12_345,
      images: ['seller/a.jpg', 'seller/b.jpg'],
      imageDims: [null, null],
      location: locationPayload,
    });
  });

  it('creates only from step 3, with the unchanged payload', async () => {
    createItem.mockResolvedValue({ ok: true, data: { id: 'item-2' } });
    render(<ItemForm mode="create" serverDraft={{ id: 'd1', fields: draftFields }} />);

    next();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    // Step 2 refuses to move on with no photo.
    next();
    expect(await screen.findByText('Add at least one image of your item.')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();

    const file = new File(['x'], 'front.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.getElementById('images') as HTMLInputElement, {
      target: { files: [file] },
    });
    next();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    expect(createItem).not.toHaveBeenCalled();

    await pastStepGuard();
    fireEvent.click(primary('Create listing'));

    await waitFor(() => expect(createItem).toHaveBeenCalledTimes(1));
    expect(createItem).toHaveBeenCalledWith({
      title: 'Pikachu promo',
      description: 'Near mint, from a sealed tin.',
      category: 'Pokémon',
      condition: 'Near Mint',
      grading: { grader: '', grade: '', certNumber: '' },
      fmvCents: 8_000,
      images: ['u/new.jpg'],
      imageDims: [null],
      location: locationPayload,
      listingKind: 'SINGLE',
    });
  });

  it('opens the step holding a field the server refused', async () => {
    updateItem.mockResolvedValue({
      ok: false,
      error: 'validation-error',
      field: 'title',
      message: 'Title must be at most 120 characters',
    });
    render(<ItemForm mode="edit" item={item} />);

    fireEvent.click(stepButton(/Step 3: Price & location/));
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    await pastStepGuard();
    fireEvent.click(primary('Save changes'));

    await waitFor(() =>
      expect(stepButton(/Step 1: Details/)).toHaveAttribute('aria-current', 'step'),
    );
    expect(screen.getByText('Title must be at most 120 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveFocus());
  });

  it('lets an edit jump straight to any step from the indicator', () => {
    render(<ItemForm mode="edit" item={item} />);

    expect(stepButton(/Step 3: Price & location/)).toBeEnabled();
    fireEvent.click(stepButton(/Step 3: Price & location/));

    expect(stepButton(/Step 3: Price & location/)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { name: 'Price & location' })).toBeInTheDocument();
  });

  it('does not publish when Next on step 2 is double-clicked', async () => {
    updateItem.mockResolvedValue({ ok: true, data: { id: 'item-1' } });
    render(<ItemForm mode="edit" item={item} />);

    next();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();

    // Both clicks of a double-click, the second landing where Next was.
    next();
    fireEvent.click(primary('Save changes'));
    // The form's own submit (Enter, or the phone header's button) is refused too.
    fireEvent.submit(document.getElementById(ITEM_FORM_ID) as HTMLFormElement);

    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateItem).not.toHaveBeenCalled();

    // A deliberate click once step 3 has been seen still saves.
    await pastStepGuard();
    fireEvent.click(primary('Save changes'));
    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1));
  });

  it('leaves no focus request behind when the open step is clicked', async () => {
    updateItem.mockResolvedValue({
      ok: false,
      error: 'not-verified',
      message: 'Verify your identity to publish.',
    });
    render(<ItemForm mode="edit" item={item} />);

    fireEvent.click(stepButton(/Step 3: Price & location/));
    const heading = screen.getByRole('heading', { name: 'Price & location' });
    await waitFor(() => expect(heading).toHaveFocus());

    // The open step: nothing should change, and nothing should be queued.
    fireEvent.click(stepButton(/Step 3: Price & location/));
    const save = primary('Save changes');
    save.focus();

    // A general error re-runs the focus effect; a stale request would pull focus here.
    await pastStepGuard();
    fireEvent.click(save);
    expect(await screen.findAllByText('Verify your identity to publish.')).not.toHaveLength(0);
    expect(heading).not.toHaveFocus();

    // A later step change focuses its own heading.
    fireEvent.click(screen.getByRole('button', { name: 'Back to Condition' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Condition' })).toHaveFocus());
  });
});
