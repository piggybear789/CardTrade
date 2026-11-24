// tests/e2e/audit/core/dialogStability.ts
//
// THE DIALOG STABILITY RULE for the e2e UX audit suite. Pure: no Playwright, no DOM, no
// I/O. The DSL's `refusal(..., { toastIn: dialog })` reads the dialog's bounding box
// before the failing request and again once the toast has appeared, and hands both here.
//
// The rule comes from structure.md: request failures are reported as toasts
// (`lib/hooks/useErrorToast.ts`) rather than paragraphs that resize a dialog. A dialog
// whose box changed by more than a sub-pixel rounding margin grew an inline error.
//
// Requirements:
//   30.7  a request failure reported to a member appears as a toast and does not resize
//         the surrounding dialog
//
// The check defaults to blocking (`uxPolicy.ts`).

/** How much a dialog's width or height may change, in CSS px, before it counts as resized. */
export const DIALOG_RESIZE_TOLERANCE_PX = 2;

/** A bounding box, as `locator.boundingBox()` returns it. Only width and height matter. */
export interface Box {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

/** One dialog-resize problem. The caller adds member, URL and severity. */
export interface DialogObservation {
  check: 'toast';
  message: string;
  detail?: Record<string, string | number>;
}

function assertBox(box: Box, which: string): void {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) {
    throw new RangeError(`${which} box must have a finite width and height`);
  }
}

/**
 * True exactly when the width or the height differs by more than `tolerance` (default
 * 2 px) between the two boxes (Req 30.7). Position is ignored: a centred dialog moves
 * when it resizes, but moving alone is not a resize. Symmetric in its arguments.
 * Throws on a non-finite dimension.
 */
export function dialogResized(
  before: Box,
  after: Box,
  tolerance: number = DIALOG_RESIZE_TOLERANCE_PX,
): boolean {
  assertBox(before, 'before');
  assertBox(after, 'after');
  return (
    Math.abs(before.width - after.width) > tolerance ||
    Math.abs(before.height - after.height) > tolerance
  );
}

/**
 * The observation for a failure that resized its dialog, or null when the dialog kept
 * its size. `toastShown` false is a separate failure: the error reached the member some
 * other way (or not at all), and the observation says so.
 */
export function dialogStabilityFinding(
  before: Box,
  after: Box,
  toastShown: boolean,
  tolerance: number = DIALOG_RESIZE_TOLERANCE_PX,
): DialogObservation | null {
  const resized = dialogResized(before, after, tolerance);
  if (!resized && toastShown) return null;
  const size = (box: Box): string => `${Math.round(box.width)}×${Math.round(box.height)}`;
  const parts: string[] = [];
  if (!toastShown) parts.push('the failure was not shown as a toast');
  if (resized) parts.push(`the dialog resized from ${size(before)} to ${size(after)} px`);
  return {
    check: 'toast',
    message: `Request failure: ${parts.join(', and ')}.`,
    detail: {
      beforeWidth: before.width,
      beforeHeight: before.height,
      afterWidth: after.width,
      afterHeight: after.height,
      toast: toastShown ? 'shown' : 'missing',
    },
  };
}
