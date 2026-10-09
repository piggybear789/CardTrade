// Shares the listing the browser is on: the system share sheet where there is one,
// otherwise a copy to the clipboard. Client-only; reads `window.location`.

import { toast } from 'sonner';

export async function shareListingUrl(): Promise<void> {
  const url = window.location.href;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ url, title: document.title });
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    // A menu item has no label of its own to swap to "Copied", so this is the only
    // sign the copy happened.
    toast.success('Link copied');
  } catch {
    toast.error('Could not share this listing');
  }
}
