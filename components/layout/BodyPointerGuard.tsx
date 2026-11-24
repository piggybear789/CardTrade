'use client';

// components/layout/BodyPointerGuard.tsx
//
// Keeps `<body>` clickable once no modal layer is open (F88).
//
// Radix's DismissableLayer locks the page while a modal is open: it sets
// `body.style.pointerEvents = 'none'` and, when the last layer closes, writes back the
// value it saw before the lock. Stripe.js's modal backdrop (shown while a PayTo or 3-D
// Secure confirmation runs inside a dialog) keeps the page out of reach a different way.
// It saves the whole `body.style.cssText` when it shows and writes that string back when
// it hides. When the backdrop is still up as the dialog closes, the saved string already
// contains `pointer-events: none`, so the late restore puts the lock back after Radix has
// released it. Nothing else clears it, and every click on the page is refused until a
// reload.
//
// Stripe.js is not ours to change, so this guard enforces the invariant Radix depends on:
// `pointer-events: none` on the body belongs only to an open modal layer. It acts only
// when no such layer is open, so a dialog that is open keeps exactly the lock it had.

import { useEffect } from 'react';

/**
 * The modal layers that lock outside pointer events while open. Dialog, AlertDialog and
 * Popover content is `role="dialog"` or `alertdialog`, DropdownMenu content is `menu`,
 * and Select content is `listbox`. Each sets `data-state="open"` while it is shown.
 */
const OPEN_MODAL_LAYER = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(', ');

/**
 * Clears a `pointer-events: none` on the body that no open modal layer accounts for.
 * Returns true when it cleared the value.
 */
export function releaseStaleBodyPointerLock(doc: Document = document): boolean {
  const body = doc.body;
  if (body.style.pointerEvents !== 'none') return false;
  if (doc.querySelector(OPEN_MODAL_LAYER) !== null) return false;
  body.style.pointerEvents = '';
  return true;
}

/**
 * Mounted once in the root layout. It checks after every change to the body's style
 * and every change to its direct children (portalled layers), so a late restore is
 * undone in the same task it lands in.
 */
export function BodyPointerGuard(): null {
  useEffect(() => {
    releaseStaleBodyPointerLock();
    const observer = new MutationObserver(() => {
      releaseStaleBodyPointerLock();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style'],
      childList: true,
    });
    return () => observer.disconnect();
  }, []);
  return null;
}
