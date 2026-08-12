'use client';

// components/contract/AcceptWithPhotoDialog.tsx
//
// Prompts the user to optionally photograph what they received before confirming
// acceptance. The photo becomes baseline evidence: if a dispute arises later, the
// arbitrator can see what the item looked like at the moment the recipient said yes.
//
// The photo is OPTIONAL — a user can skip and accept without one. The value is in
// having it, not in blocking people who don't.

import { useRef, useState, useTransition, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Camera, Check, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { uploadDisputeEvidence } from '@/lib/storage/uploadDisputeEvidence';
import { submitDisputeEvidence } from '@/lib/actions/disputeEvidence';

export interface AcceptWithPhotoDialogProps {
  /** Fire the acceptance action. */
  onAccept: () => Promise<{ ok: boolean }>;
  /** Contract identifiers for attaching the photo as evidence. */
  evidenceContext: {
    caseKind: 'CASH_SALE' | 'TRADE';
    caseRef: string;
  };
  /** Button label. */
  triggerLabel?: string;
  /** Shown in the dialog header. */
  title?: string;
  description?: string;
  /** Toast on success. */
  successMessage?: string;
}

export function AcceptWithPhotoDialog({
  onAccept,
  evidenceContext,
  triggerLabel = 'Accept the item',
  title = 'Accept and complete',
  description = 'Optionally photograph what you received. This becomes your evidence if a dispute arises later.',
  successMessage = 'Accepted.',
}: AcceptWithPhotoDialogProps) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    if (fileRef.current) fileRef.current.value = '';
  }

  function clearPhoto() {
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(null);
    setPreview(null);
  }

  function handleAccept() {
    startTransition(async () => {
      // Upload photo first if one was taken.
      if (photo) {
        const uploaded = await uploadDisputeEvidence([photo]);
        if (uploaded.ok && uploaded.paths.length > 0) {
          // Attach as a "receipt photo" evidence submission. This uses the
          // existing dispute evidence system — the photo lives in the same
          // bucket and is visible to both parties and staff.
          await submitDisputeEvidence({
            caseKind: evidenceContext.caseKind,
            caseRef: evidenceContext.caseRef,
            statement: 'Photo taken at acceptance — record of item condition when received.',
            mediaPaths: uploaded.paths,
          }).catch(() => {
            // Best-effort: if attaching fails, still accept. The photo is in
            // the bucket either way.
          });
        }
      }

      const result = await onAccept();
      if (result.ok) {
        toast.success(successMessage);
        setOpen(false);
        clearPhoto();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <Check className="size-4" aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {preview ? (
            <div className="relative mx-auto w-fit">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Photo of received item"
                className="max-h-48 rounded-lg border object-contain"
              />
              <button
                type="button"
                onClick={clearPhoto}
                disabled={isPending}
                className="absolute -right-2 -top-2 rounded-full bg-background p-1 shadow-sm border hover:bg-muted"
                aria-label="Remove photo"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isPending}
              className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input p-6 text-muted-foreground transition-colors hover:border-ring hover:bg-muted/30"
            >
              <Camera className="size-8" aria-hidden />
              <span className="text-sm font-medium">Take or upload a photo</span>
              <span className="text-xs">Optional — helps if there's a dispute later</span>
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFile}
            className="sr-only"
            aria-label="Photograph the item"
            disabled={isPending}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleAccept}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            {isPending ? 'Confirming…' : photo ? 'Accept with photo' : 'Accept without photo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
