'use client';

// lib/hooks/useErrorToast.ts
//
// Shows a failure as a toast instead of a paragraph in the layout.
//
// WHY. Dialogs and contract panels rendered a server refusal as `<p role="alert">`
// between their fields and their footer. The request comes back a second or more
// after the press, so the paragraph arrived late, grew a centred dialog in both
// directions and moved the footer button out from under the pointer — data arriving
// moving the layout, which is exactly what these surfaces must not do. A toast says
// the same thing, is announced by Sonner's live region, and moves nothing.
//
// Field-level validation that appears beside the field it is about stays inline; this
// is for the message that is about the request, not about a field.

import { useEffect } from 'react';
import { toast } from 'sonner';

/** Toast `message` whenever it becomes a new non-empty value. */
export function useErrorToast(message: string | null | undefined): void {
  useEffect(() => {
    if (message) toast.error(message);
  }, [message]);
}
