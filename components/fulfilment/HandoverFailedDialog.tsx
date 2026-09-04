'use client';

// components/fulfilment/HandoverFailedDialog.tsx
//
// "The exchange did not happen." Shared by the Cash_Sale and 2-way Trade rooms.
//
// This was a sales-only component. A trade had no equivalent at all, which meant a
// no-show at a meeting point, a refusal to hand over, or a parcel that never arrived
// left the trade with nowhere to go: it sat in COLLATERAL_LOCKED or IN_TRANSIT until
// the card authorisation lapsed of its own accord, silently removing the guarantee
// both traders were promised.
//
// The submit action is injected, because the two flows freeze differently. A cash
// sale raises a dispute over money the platform already holds. A trade dispatches
// HANDOVER_FAILED, which captures NOTHING — a lost parcel is nobody's fault, and the
// Friction_Tax path would settle $20 against a trader who may have done nothing
// wrong.

import { useRef, useState, useTransition, type ChangeEvent, type FormEvent } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { ImagePlusIcon, LoaderCircleIcon, TriangleAlertIcon, XIcon } from '@hugeicons/core-free-icons';

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { uploadDisputeEvidence } from '@/lib/storage/uploadDisputeEvidence';
import { submitDisputeEvidence, type DisputeCaseKind } from '@/lib/actions/disputeEvidence';

/** Bounds the reason text, matching the server-side guard. */
const REASON_MAX = 1000;
const REASON_MIN = 10;
const MAX_EVIDENCE_FILES = 5;

/** What the caller's action reports back. */
export type HandoverFailedSubmitResult =
  | { ok: true }
  | { ok: false; message: string };

export interface HandoverFailedDialogProps {
  /**
   * Freeze the contract. Receives the reason with any evidence filenames appended.
   * Must not throw for expected failures — return a message instead.
   */
  onSubmit: (reason: string) => Promise<HandoverFailedSubmitResult>;
  /** Trigger copy. Defaults suit both rooms. */
  triggerLabel?: string;
  title?: string;
  /**
   * What actually happens next. Stated per flow, because the outcomes genuinely
   * differ and overstating either one is how a room ends up promising a refund it
   * cannot deliver.
   */
  outcomeDescription: string;
  /** Placeholder for the description field. */
  reasonPlaceholder?: string;
  /**
   * Trigger button variant.
   *
   * Defaults to `destructive`, which suits the never-arrived and fraud reports. A
   * condition dispute passes `outline` — the three claims carry very different
   * consequences and the buttons should not look identical.
   */
  triggerVariant?: 'outline' | 'destructive' | 'default' | 'secondary' | 'ghost';
  /**
   * When provided, evidence files are uploaded to Supabase Storage and formally
   * attached to the dispute case via `submitDisputeEvidence` after `onSubmit`
   * transitions the contract into DISPUTED state.
   *
   * Optional for backwards compatibility — when absent, filenames are still noted in
   * the reason text as a fallback record.
   */
  evidenceContext?: { caseKind: DisputeCaseKind; caseRef: string };
}

export function HandoverFailedDialog({
  onSubmit,
  triggerLabel = 'Report a problem',
  title = 'Report a problem with the handover',
  outcomeDescription,
  reasonPlaceholder = 'e.g. they did not show up, the item was not what was agreed, the parcel never arrived…',
  triggerVariant = 'destructive',
  evidenceContext,
}: HandoverFailedDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length > 0) {
      setProofFiles((prev) => [...prev, ...picked].slice(0, MAX_EVIDENCE_FILES));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setProofFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setInlineError(null);

    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) {
      setInlineError('Please describe what went wrong in at least a sentence.');
      return;
    }
    if (trimmed.length > REASON_MAX) {
      setInlineError(`Description must be ${REASON_MAX} characters or fewer.`);
      return;
    }

    // Filenames are noted in the reason as a fallback record regardless of whether the
    // real upload succeeds — arbitration always has something to reference.
    const proofNote =
      proofFiles.length > 0
        ? `\n\n[Evidence attached: ${proofFiles.map((f) => f.name).join(', ')}]`
        : '';

    startTransition(async () => {
      // Step 1: Upload files to Storage BEFORE onSubmit so the bytes are in the bucket
      // even if the subsequent attach call fails. This only puts objects into the bucket
      // under the caller's prefix — no state check is needed at this point.
      let uploadedPaths: string[] = [];
      if (proofFiles.length > 0 && evidenceContext) {
        const uploadResult = await uploadDisputeEvidence(proofFiles);
        if (!uploadResult.ok) {
          setInlineError(uploadResult.message);
          toast.error(uploadResult.message);
          return;
        }
        uploadedPaths = uploadResult.paths;
      }

      // Step 2: Freeze/dispute the contract via the injected action.
      const result = await onSubmit(trimmed + proofNote);
      if (!result.ok) {
        setInlineError(result.message);
        toast.error(result.message);
        return;
      }

      // Step 3: Formally attach the evidence to the now-disputed contract. This call
      // requires DISPUTED state, which onSubmit just established. If it fails, the
      // dispute is already raised and the files are already in the bucket — warn rather
      // than fail the whole flow.
      if (uploadedPaths.length > 0 && evidenceContext) {
        const attachResult = await submitDisputeEvidence({
          caseKind: evidenceContext.caseKind,
          caseRef: evidenceContext.caseRef,
          statement: trimmed,
          mediaPaths: uploadedPaths,
        });
        if (!attachResult.ok) {
          toast.warning(
            'The dispute was raised, but the evidence could not be attached. ' +
              'You can add it from the contract room.',
          );
        }
      }

      setOpen(false);
      setReason('');
      setProofFiles([]);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} size="sm">
          <HugeiconsIcon icon={TriangleAlertIcon} className="size-3.5" aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {/* The form is DialogContent's only child, so its flex gap cannot reach
            header, body and footer. Repeating it here spaces them the same way
            every other dialog does, instead of a one-off `py-4` on the body. */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{outcomeDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-group">
            {/* Tinted but not bordered. The border made this a card inside a card
                directly under the description, which is a lot of chrome for what
                is one paragraph of warning — the red still carries the weight. */}
            <div className="flex items-center gap-cozy rounded-lg bg-destructive/5 p-cozy">
              <HugeiconsIcon icon={TriangleAlertIcon}
                className="size-4 shrink-0 text-destructive"
                aria-hidden
              />
              <div className="space-y-tight text-body">
                <p className="font-semibold text-destructive">
                  False reports have consequences
                </p>
                <p className="text-muted-foreground">
                  Filing a false report is a permanent mark on your account and may
                  result in criminal fraud charges. All evidence is retained and the
                  other party will see what you have said.
                </p>
              </div>
            </div>

            <div className="space-y-snug">
              <Label htmlFor="handover-failed-reason">What happened?</Label>
              <Textarea
                id="handover-failed-reason"
                placeholder={reasonPlaceholder}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={REASON_MAX}
                rows={4}
                disabled={isPending}
                className="resize-none"
              />
              <p className="text-right text-meta text-muted-foreground">
                {reason.length}/{REASON_MAX}
              </p>
            </div>

            <div className="space-y-snug">
              <Label>Evidence (optional)</Label>
              <p className="text-body text-muted-foreground">
                Attach up to {MAX_EVIDENCE_FILES} photos — damaged packaging,
                screenshots, the item you received.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilesSelected}
                className="sr-only"
                aria-label="Upload evidence photos"
                disabled={isPending}
              />

              <div className="flex flex-wrap gap-2">
                {proofFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="group relative size-16 overflow-hidden rounded-md border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      className="h-full w-full object-cover"
                      onLoad={(e) =>
                        URL.revokeObjectURL((e.target as HTMLImageElement).src)
                      }
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      disabled={isPending}
                      className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 text-foreground shadow-sm hover:bg-background"
                      aria-label={`Remove ${file.name}`}
                    >
                      <HugeiconsIcon icon={XIcon} className="size-3" aria-hidden />
                    </button>
                  </div>
                ))}
                {proofFiles.length < MAX_EVIDENCE_FILES ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPending}
                    className="flex size-16 items-center justify-center rounded-md border-2 border-dashed border-input text-muted-foreground transition-colors hover:border-iris/50 hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground"
                    aria-label="Add evidence photo"
                  >
                    <HugeiconsIcon icon={ImagePlusIcon} className="size-5" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>

            {inlineError ? (
              <p role="alert" className="text-body text-destructive">
                {inlineError}
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
              type="submit"
              variant="destructive"
              disabled={reason.trim().length < REASON_MIN || isPending}
              aria-busy={isPending}
            >
              {isPending ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Submitting…' : 'Freeze and report'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
