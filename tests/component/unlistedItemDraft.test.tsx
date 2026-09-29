// tests/component/unlistedItemDraft.test.tsx
//
// An unlisted card's draft can hold photos already in Storage (`keptPaths`, when a
// private deal is edited) as well as newly picked Files. Both count toward the
// same one-to-ten rule, and removing a kept photo takes it off the draft and
// nothing else.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  EMPTY_UNLISTED_DRAFT,
  UNLISTED_IMAGES_MAX,
  UnlistedPhotoField,
  unlistedDraftGap,
  unlistedPhotoCount,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemFields';

const described: UnlistedItemDraft = {
  ...EMPTY_UNLISTED_DRAFT,
  description: 'Charizard ex 199/165 SIR, PSA 10',
  category: 'Pokémon',
  condition: 'Graded',
};

function photo(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('the unlisted card draft', () => {
  it('counts kept and new photos together', () => {
    const draft = { ...described, keptPaths: ['u/1/0.jpg', 'u/1/1.jpg'], images: [photo('a.jpg')] };
    expect(unlistedPhotoCount(draft)).toBe(3);
  });

  it('is complete with only kept photos', () => {
    expect(unlistedDraftGap({ ...described, keptPaths: ['u/1/0.jpg'] })).toBeNull();
  });

  it('still needs a photo when every kept one is removed', () => {
    expect(unlistedDraftGap({ ...described, keptPaths: [] })).toBe('Add at least one photo.');
  });

  it('applies the cap across kept and new photos', () => {
    const keptPaths = Array.from({ length: UNLISTED_IMAGES_MAX }, (_, i) => `u/1/${i}.jpg`);
    expect(unlistedDraftGap({ ...described, keptPaths, images: [photo('extra.jpg')] })).toBe(
      `Keep it to ${UNLISTED_IMAGES_MAX} photos.`,
    );
  });
});

describe('the photo field with kept photos', () => {
  it('shows kept photos in the count and removes only the one chosen', async () => {
    const onChange = vi.fn();
    const draft = { ...described, keptPaths: ['u/1/0.jpg', 'u/1/1.jpg'] };
    render(<UnlistedPhotoField draft={draft} onChange={onChange} />);

    expect(screen.getByText(`2 of ${UNLISTED_IMAGES_MAX}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, keptPaths: ['u/1/1.jpg'] });
  });
});
