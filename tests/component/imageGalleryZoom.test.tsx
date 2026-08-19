// tests/component/imageGalleryZoom.test.tsx
//
// Clicking a gallery photo opens the lightbox modal (not an in-place zoom).

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ImageGallery } from '@/components/listings/ImageGallery';

function renderGallery() {
  render(
    <ImageGallery
      images={[{ src: '/a.png', alt: 'Card front' }]}
      title="Charizard"
    />,
  );
}

describe('ImageGallery lightbox', () => {
  it('does not open a dialog until the photo is clicked', () => {
    renderGallery();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /enlarge photo 1 of 1/i })).toBeTruthy();
  });

  it('opens a popout modal on click', () => {
    renderGallery();
    fireEvent.click(screen.getByRole('button', { name: /enlarge photo 1 of 1/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByAltText('Charizard — photo 1 of 1')).toBeTruthy();
  });
});
