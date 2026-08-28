'use client';

// components/contract/AcceptWithPhotoDialog.tsx
//
// Prompts the user to photograph or film what they received before confirming
// acceptance. The capture becomes baseline evidence: if a dispute arises later, the
// arbitrator can see what the item looked like at the moment the recipient said yes.
//
// Recommended, not required — a user can skip and accept without one. The value is in
// having it, not in blocking people who don't.
//
// Video is accepted because an unboxing clip is the single most useful artefact in a
// condition dispute. Limits and MIME list come from `disputeEvidenceShared` so this
// dialog cannot drift from what Storage will actually take.

import { useRef, useState, useTransition, type ChangeEvent } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Camera01Icon, LoaderCircleIcon, XIcon } from '@hugeicons/core-free-icons';

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
import {
  EVIDENCE_ACCEPT,
  EVIDENCE_FILE_MAX_BYTES,
} from '@/lib/storage/disputeEvidenceShared';

const EVIDENCE_MAX_MB = Math.round(EVIDENCE_FILE_MAX_BYTES / (1024 * 1024));

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
  /** Confirm button when a photo or video is attached. Trades keep the Accept default. */
  confirmWithPhotoLabel?: string;
  /** Confirm button with nothing attached. Trades keep the Accept default. */
  confirmWithoutPhotoLabel?: string;
}

export function AcceptWithPhotoDialog({
  onAccept,
  evidenceContext,
  triggerLabel = 'Accept the item',
  title = 'Accept and complete',
  description = 'We recommend photographing or filming what you received. This becomes your evidence if a dispute arises later.',
  confirmWithPhotoLabel = 'Accept with evidence',
  confirmWithoutPhotoLabel = 'Accept without evidence',
}: AcceptWithPhotoDialogProps) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const isVideo = photo?.type.startsWith('video/') ?? false;

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;

    // Fail here rather than after a long upload Storage would reject at the end.
    if (file.size > EVIDENCE_FILE_MAX_BYTES) {
      setError(`That file is larger than ${EVIDENCE_MAX_MB} MB. Try a shorter clip.`);
      return;
    }

    clearPhoto();
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(null);
    setPreview(null);
    setError(null);
  }

  function handleAccept() {
    startTransition(async () => {
      // Upload the capture first if one was taken.
      if (photo) {
        const uploaded = await uploadDisputeEvidence([photo]);
        if (!uploaded.ok) {
          // Don't accept silently without the evidence the user chose to attach —
          // acceptance is one-way, so they'd have no second chance to record it.
          setError(uploaded.message);
          return;
        }
        if (uploaded.paths.length > 0) {
          // Attach as a receipt evidence submission. This uses the existing
          // dispute evidence system — the file lives in the same bucket and is
          // visible to both parties and staff.
          await submitDisputeEvidence({
            caseKind: evidenceContext.caseKind,
            caseRef: evidenceContext.caseRef,
            statement: isVideo
              ? 'Video taken at acceptance — record of item condition when received.'
              : 'Photo taken at acceptance — record of item condition when received.',
            mediaPaths: uploaded.paths,
          }).catch(() => {
            // Best-effort: if attaching fails, still accept. The file is in the
            // bucket either way.
          });
        }
      }

      const result = await onAccept();
      if (result.ok) {
        
        setOpen(false);
        clearPhoto();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="action">

          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div>
          {preview ? (
            <div className="relative mx-auto w-fit">
              {isVideo ? (
                <video
                  src={preview}
                  controls
                  playsInline
                  className="max-h-48 rounded-lg border object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Photo of received item"
                  className="max-h-48 rounded-lg border object-contain"
                />
              )}
              <button
                type="button"
                onClick={clearPhoto}
                disabled={isPending}
                className="absolute -right-2 -top-2 rounded-full bg-background p-1 shadow-sm border hover:bg-muted"
                aria-label={isVideo ? 'Remove video' : 'Remove photo'}
              >
                <HugeiconsIcon icon={XIcon} className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isPending}
              // A row, not a tall dashed panel. `p-section` on an OPTIONAL step
              // made the thing you are allowed to skip the largest object in the
              // dialog — a void the eye has to cross to reach Accept.
              className="flex w-full items-center gap-cozy rounded-lg border border-dashed border-input p-cozy text-left text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted"
            >
              <HugeiconsIcon icon={Camera01Icon} className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 space-y-tight">
                <span className="block text-body font-medium text-foreground">
                  Add a photo or video
                </span>
                <span className="block text-body">
                  Recommended — it is your evidence if there is a dispute later.
                </span>
              </span>
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept={EVIDENCE_ACCEPT}
            onChange={handleFile}
            className="sr-only"
            aria-label="Photograph or film the item"
            disabled={isPending}
          />

          {error ? (
            <p role="alert" className="mt-cozy text-body text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="action"
            onClick={handleAccept}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? <HugeiconsIcon icon={LoaderCircleIcon} className="size-4 animate-spin" aria-hidden /> : null}
            {isPending
              ? 'Confirming…'
              : photo
                ? confirmWithPhotoLabel
                : confirmWithoutPhotoLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
