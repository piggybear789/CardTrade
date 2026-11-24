// tests/component/bodyPointerGuard.test.tsx
//
// F88: a `pointer-events: none` on <body> must not outlive every open modal layer. Stripe's
// modal backdrop restores a saved `body.style.cssText` after Radix has released its lock,
// so the guard has to clear the value that the late restore writes back.

import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BodyPointerGuard, releaseStaleBodyPointerLock } from '@/components/layout/BodyPointerGuard';

function resetBody(): void {
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
}

function openDialog(): HTMLElement {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('data-state', 'open');
  document.body.appendChild(dialog);
  return dialog;
}

afterEach(resetBody);

describe('releaseStaleBodyPointerLock', () => {
  it('clears a body lock when no modal layer is open', () => {
    document.body.style.pointerEvents = 'none';
    expect(releaseStaleBodyPointerLock()).toBe(true);
    expect(document.body.style.pointerEvents).toBe('');
  });

  it('keeps the lock while a dialog that owns it is open', () => {
    openDialog();
    document.body.style.pointerEvents = 'none';
    expect(releaseStaleBodyPointerLock()).toBe(false);
    expect(document.body.style.pointerEvents).toBe('none');
  });

  it('keeps the lock while a select, menu or alert dialog is open', () => {
    for (const role of ['listbox', 'menu', 'alertdialog']) {
      resetBody();
      const layer = document.createElement('div');
      layer.setAttribute('role', role);
      layer.setAttribute('data-state', 'open');
      document.body.appendChild(layer);
      document.body.style.pointerEvents = 'none';
      expect(releaseStaleBodyPointerLock(), role).toBe(false);
    }
  });

  it('leaves a body that is not locked alone', () => {
    document.body.style.pointerEvents = 'auto';
    expect(releaseStaleBodyPointerLock()).toBe(false);
    expect(document.body.style.pointerEvents).toBe('auto');
  });

  it('ignores a closed dialog that is still mounted during its exit animation', () => {
    const dialog = openDialog();
    dialog.setAttribute('data-state', 'closed');
    document.body.style.pointerEvents = 'none';
    expect(releaseStaleBodyPointerLock()).toBe(true);
    expect(document.body.style.pointerEvents).toBe('');
  });
});

describe('BodyPointerGuard', () => {
  it('clears a stale lock on mount', () => {
    document.body.style.pointerEvents = 'none';
    render(<BodyPointerGuard />);
    expect(document.body.style.pointerEvents).toBe('');
  });

  it('clears a lock that is restored after the dialog that held it has closed', async () => {
    const dialog = openDialog();
    render(<BodyPointerGuard />);
    document.body.style.pointerEvents = 'none';
    expect(document.body.style.pointerEvents).toBe('none');

    // Radix releases its lock and the dialog leaves the DOM; a late restore follows.
    dialog.remove();
    document.body.style.pointerEvents = '';
    document.body.style.cssText = 'pointer-events: none;';

    await waitFor(() => expect(document.body.style.pointerEvents).toBe(''));
  });
});
