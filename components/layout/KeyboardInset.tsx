'use client';

import { useEffect } from 'react';

/**
 * Publishes `--keyboard-inset`: how much of the layout viewport the software
 * keyboard (or any visual-viewport occlusion) currently covers.
 *
 * `interactiveWidget: resizes-content` shrinks `dvh` when the OS resizes the
 * layout viewport — then this value is 0 and bottom-docked sheets are already
 * clear. Android Chrome and Samsung often overlay the keyboard instead, so
 * `100dvh` / `bottom: 0` still sit behind the keys. VisualViewport supplies
 * overlay occlusion; the layout-viewport baseline detects resize-content mode.
 */
export function KeyboardInset() {
  useEffect(() => {
    const root = document.documentElement;
    let layoutViewportBaseline = window.innerHeight;

    function hasEditableFocus() {
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement) return true;
      if (active instanceof HTMLElement && active.isContentEditable) return true;
      if (!(active instanceof HTMLInputElement)) return false;
      return ![
        'button',
        'checkbox',
        'color',
        'file',
        'hidden',
        'image',
        'radio',
        'range',
        'reset',
        'submit',
      ].includes(active.type);
    }

    function sync() {
      const vv = window.visualViewport;
      const editableFocus = hasEditableFocus();
      if (!editableFocus) layoutViewportBaseline = window.innerHeight;

      // A reduced visual viewport is not necessarily a keyboard: pinch zoom and
      // iOS focus zoom produce the same geometry. Overlay-mode browsers expose an
      // occluded visual viewport; resize-content browsers instead shrink innerHeight.
      const naturalScale = !vv || Math.abs(vv.scale - 1) < 0.01;
      const occluded = vv && editableFocus && naturalScale
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0;
      const layoutReduction = editableFocus
        ? Math.max(0, layoutViewportBaseline - window.innerHeight)
        : 0;
      const keyboardOpen = editableFocus && (occluded > 80 || layoutReduction > 120);

      root.style.setProperty('--keyboard-inset', `${Math.round(occluded)}px`);
      if (keyboardOpen) {
        root.dataset.keyboardOpen = 'true';
      } else {
        delete root.dataset.keyboardOpen;
      }
    }

    function syncAfterFocusChange() {
      // Focus changes before the keyboard animation updates visualViewport.
      requestAnimationFrame(sync);
    }

    sync();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    document.addEventListener('focusin', syncAfterFocusChange);
    document.addEventListener('focusout', syncAfterFocusChange);
    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      document.removeEventListener('focusin', syncAfterFocusChange);
      document.removeEventListener('focusout', syncAfterFocusChange);
      root.style.removeProperty('--keyboard-inset');
      delete root.dataset.keyboardOpen;
    };
  }, []);

  return null;
}
