'use client';

// components/trade/UnlistedItemDialog.tsx
//
// Describe an Item you hold but have never listed, so you can put it up in a
// Trade offer (Req 5.2 — the goods on either side need not be catalog listings).
//
// This is a detour from composing an offer, not part of it: five fields that used
// to expand inside the offer card and push the running total off screen. Holding
// them in a dialog keeps the card's height constant whichever path you take, and
// the saved draft comes back as one row in the "what I'm putting up" list.
//
// THE FIELDS THEMSELVES LIVE IN `UnlistedItemFields`. The private-deal composer
// renders the same four fields inline — one screen, no second modal — so the
// dialog is now only the frame: open/close, seed, save.
//
// Nothing is persisted here. The draft is handed back to the caller and only
// becomes a real (hidden) Item when the offer is submitted, so abandoning the
// offer leaves nothing behind.

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  EMPTY_UNLISTED_DRAFT,
  UnlistedItemFields,
  isUnlistedDraftComplete,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemFields';

export {
  UNLISTED_IMAGES_MAX,
  UNLISTED_IMAGES_MIN,
  isUnlistedDraftComplete,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemFields';

export interface UnlistedItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seeds the fields when editing a draft already added to the offer. */
  initial?: UnlistedItemDraft | null;
  onSave: (draft: UnlistedItemDraft) => void;
  /** Defaults to the trade-offer wording. */
  title?: string;
  /** Optional. Hidden from the dialog when omitted. */
  description?: string;
  saveLabel?: string;
}

export function UnlistedItemDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  // "Offer Terms" described the surface this is reached FROM, not this form —
  // which asks for a photo, a game and a condition. Every caller that passed a
  // title already said "card"; the default now matches what is on screen.
  title = 'Describe your item',
  description,
  saveLabel,
}: UnlistedItemDialogProps) {
  const [draft, setDraft] = useState<UnlistedItemDraft>(initial ?? EMPTY_UNLISTED_DRAFT);

  // Re-seed each time the dialog opens: the same instance serves both adding a
  // draft and editing the one already on the offer.
  useEffect(() => {
    if (open) setDraft(initial ?? EMPTY_UNLISTED_DRAFT);
  }, [open, initial]);

  const complete = isUnlistedDraftComplete(draft);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>

        <UnlistedItemFields draft={draft} onChange={setDraft} idPrefix="unlisted" />

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!complete}
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            {saveLabel ?? (initial ? 'Save item' : 'Add to offer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
