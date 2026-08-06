// tests/component/imageGalleryZoom.test.tsx
//
// The click-to-zoom magnifier, and specifically that it HOLDS when the pointer
// leaves the frame (eBay behaviour).
//
// WHY THIS IS WORTH A TEST. The zoom used to reset on `pointerleave`, so it died
// exactly when a buyer moved towards the edge of a slab to inspect it. The fix
// moved pan tracking to the window and clamped the point to the frame box, which
// is easy to regress in three separate ways: reinstating a leave-reset, dropping
// the clamp (so leaving the frame pans into blank space), or removing one of the
// deliberate exits the persistence now requires.
//
// The assertions read the `transform` style because that IS the zoom — the pan is
// `-(ZOOM-1) * point`, so the transform encodes both "engaged" and "where".

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { ImageGallery } from '@/components/listings/ImageGallery';

/**
 * jsdom ships no `PointerEvent`. The component only reads `pointerType` and
 * `buttons`, and `buttons` already comes from `MouseEventInit`, so a thin
 * subclass is enough to drive the real handlers.
 */
class TestPointerEvent extends MouseEvent {
  readonly pointerType: string;

  constructor(type: string, params: MouseEventInit & { pointerType?: string } = {}) {
    super(type, params);
    this.pointerType = params.pointerType ?? 'mouse';
  }
}

if (typeof globalThis.PointerEvent === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PointerEvent = TestPointerEvent;
}

/** Frame size the stubbed layout reports; keeps the expected maths readable. */
const FRAME = { width: 400, height: 400, left: 100, top: 100 };

/** ZOOM_SCALE in the component. Pan is -(SCALE-1) * point. */
const SCALE = 2.5;
const PAN = SCALE - 1; // 1.5

/**
 * jsdom performs no layout, so every `getBoundingClientRect` is zeros — and the
 * component treats a zero-size frame as "cannot map a point" and refuses to
 * engage. Stub a plausible box so the zoom maths has something to work with.
 */
function stubFrameLayout() {
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      width: FRAME.width,
      height: FRAME.height,
      left: FRAME.left,
      top: FRAME.top,
      right: FRAME.left + FRAME.width,
      bottom: FRAME.top + FRAME.height,
      x: FRAME.left,
      y: FRAME.top,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function renderGallery() {
  render(
    <ImageGallery
      images={[{ src: '/a.png', alt: 'Card front' }]}
      title="Charizard"
    />,
  );
  const image = screen.getByAltText('Card front');
  // The click-to-zoom frame is the positioned wrapper around the image.
  const frame = image.parentElement as HTMLElement;
  return { image, frame };
}

/** Click the frame at a viewport point, as the browser would. */
function clickAt(frame: HTMLElement, clientX: number, clientY: number) {
  // `fireEvent` wraps each dispatch in `act()`, so React flushes the resulting
  // state before the next assertion. A bare `dispatchEvent` does not.
  fireEvent(
    frame,
    new TestPointerEvent('pointerdown', { clientX, clientY, bubbles: true }),
  );
  fireEvent.click(frame, { clientX, clientY });
}

/** Move the mouse anywhere on the page, as the window listener would see it. */
function moveMouseTo(clientX: number, clientY: number) {
  fireEvent(
    window,
    new TestPointerEvent('pointermove', {
      clientX,
      clientY,
      bubbles: true,
      pointerType: 'mouse',
      buttons: 0,
    }),
  );
}

describe('ImageGallery click-to-zoom', () => {
  beforeEach(() => {
    stubFrameLayout();
  });

  it('is not zoomed until clicked', () => {
    const { image } = renderGallery();
    expect(image.style.transform).toBe('');
  });

  it('engages on click, anchored at the clicked point', () => {
    const { image, frame } = renderGallery();

    // Frame-local (100, 100) — the centre-ish of a 400x400 box at offset 100,100.
    clickAt(frame, FRAME.left + 100, FRAME.top + 100);

    expect(image.style.transform).toBe(
      `translate(${-PAN * 100}px, ${-PAN * 100}px) scale(${SCALE})`,
    );
  });

  it('HOLDS the zoom when the pointer leaves the frame', () => {
    const { image, frame } = renderGallery();
    clickAt(frame, FRAME.left + 100, FRAME.top + 100);
    expect(image.style.transform).not.toBe('');

    // `pointerleave` does not bubble, and React does not listen for it directly —
    // it SYNTHESISES onPointerLeave from `pointerout`. Firing the raw leave event
    // would silently exercise nothing, so drive the real path: a pointerout whose
    // relatedTarget is outside the frame.
    fireEvent.pointerOut(frame, {
      relatedTarget: document.body,
      pointerType: 'mouse',
    });

    // The old implementation reset here and the zoom vanished.
    expect(image.style.transform).toContain(`scale(${SCALE})`);
  });

  it('keeps panning outside the frame, clamped to its edges', () => {
    const { image, frame } = renderGallery();
    clickAt(frame, FRAME.left + 200, FRAME.top + 200);

    // Well past the bottom-right corner. The point clamps to (400, 400), so the
    // pan parks on the far edge rather than running into blank space.
    moveMouseTo(FRAME.left + 5_000, FRAME.top + 5_000);

    expect(image.style.transform).toBe(
      `translate(${-PAN * FRAME.width}px, ${-PAN * FRAME.height}px) scale(${SCALE})`,
    );

    // Far above and to the left clamps to (0, 0) — the opposite edge, not a
    // positive translation.
    moveMouseTo(FRAME.left - 5_000, FRAME.top - 5_000);

    expect(image.style.transform).toBe(`translate(0px, 0px) scale(${SCALE})`);
  });

  it('exits on a second click', () => {
    const { image, frame } = renderGallery();
    clickAt(frame, FRAME.left + 100, FRAME.top + 100);
    expect(image.style.transform).not.toBe('');

    clickAt(frame, FRAME.left + 100, FRAME.top + 100);

    expect(image.style.transform).toBe('');
  });

  it('exits on Escape', () => {
    const { image, frame } = renderGallery();
    clickAt(frame, FRAME.left + 100, FRAME.top + 100);
    expect(image.style.transform).not.toBe('');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(image.style.transform).toBe('');
  });

  it('exits on a press outside the frame', () => {
    const { image, frame } = renderGallery();
    clickAt(frame, FRAME.left + 100, FRAME.top + 100);
    expect(image.style.transform).not.toBe('');

    // A press on something that is not the frame — the exit the persistence
    // makes necessary, since leaving no longer disengages.
    fireEvent(
      document.body,
      new TestPointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }),
    );

    expect(image.style.transform).toBe('');
  });
});
