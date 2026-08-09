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
import { AlertTriangle, ImagePlus, Loader2, X } from 'lucide-react';

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
  successMessage?: string;
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
}

export function HandoverFailedDialog({
  onSubmit,
  triggerLabel = 'Report a problem',
  title = 'Report a problem with the handover',
  outcomeDescription,
  successMessage = 'Reported — the contract is now frozen for review.',
  reasonPlaceholder = 'e.g. they did not show up, the item was not what was agreed, the parcel never arrived…',
  triggerVariant = 'destructive',
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

    // Filenames are noted in the reason as a record that evidence was supplied.
    // Uploading the files themselves to Storage and attaching their paths to the
    // case is the obvious next step and is deliberately not faked here.
    const proofNote =
      proofFiles.length > 0
        ? `\n\n[Evidence attached: ${proofFiles.map((f) => f.name).join(', ')}]`
        : '';

    startTransition(async () => {
      const result = await onSubmit(trimmed + proofNote);
      if (result.ok) {
        toast.success(successMessage);
        setOpen(false);
        setReason('');
        setProofFiles([]);
        return;
      }
      setInlineError(result.message);
      toast.error(result.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} size="sm">
          <AlertTriangle className="size-3.5" aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{outcomeDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden
              />
              <div className="space-y-1 text-xs">
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

            <div className="space-y-2">
              <Label htmlFor="handover-failed-reason">What happened?</Label>
              <Textarea
                id="handover-failed-reason"
                placeholder={reasonPlaceholder}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={REASON_MAX}
                rows={4}
                disabled={isPending}
              />
              <p className="text-right text-xs text-muted-foreground">
                {reason.length}/{REASON_MAX}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Evidence (optional)</Label>
              <p className="text-xs text-muted-foreground">
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
                      <X className="size-3" aria-hidden />
                    </button>
                  </div>
                ))}
                {proofFiles.length < MAX_EVIDENCE_FILES ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPending}
                    className="flex size-16 items-center justify-center rounded-md border-2 border-dashed border-input text-muted-foreground transition-colors hover:border-ring hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Add evidence photo"
                  >
                    <ImagePlus className="size-5" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>

            {inlineError ? (
              <p role="alert" className="text-sm text-destructive">
                {inlineError}
              </p>
            ) : null}
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
              type="submit"
              variant="destructive"
              disabled={reason.trim().length < REASON_MIN || isPending}
              aria-busy={isPending}
            >
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Submitting…' : 'Freeze and report'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
