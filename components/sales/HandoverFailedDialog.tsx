'use client';

// components/sales/HandoverFailedDialog.tsx
//
// Dialog for reporting a failed handover or delivery issue. Opens a modal
// where the user describes the problem and optionally attaches proof images,
// then raises a dispute via the `disputeCashSale` server action. This triggers
// the DISPUTED status, which in a cash sale leads to the buyer being refunded.

import { useState, useRef, useTransition } from 'react';
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
import { disputeCashSale } from '@/lib/actions/cashSale';

const REASON_MAX = 1000;

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Please sign in again.',
  'not-participant': 'You are not part of this contract.',
  'invalid-state': 'This contract cannot be disputed in its current state.',
  'invalid-terms': 'Please provide a description of the issue.',
};

export interface HandoverFailedDialogProps {
  cashSaleId: string;
  /** Contextual label for the trigger button. */
  triggerLabel?: string;
}

export function HandoverFailedDialog({
  cashSaleId,
  triggerLabel = 'Report handover failed',
}: HandoverFailedDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length > 0) {
      setProofFiles((prev) => [...prev, ...picked].slice(0, 5));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setProofFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setInlineError(null);

    const trimmed = reason.trim();
    if (!trimmed) {
      setInlineError('Please describe what went wrong.');
      return;
    }
    if (trimmed.length > REASON_MAX) {
      setInlineError(`Description must be ${REASON_MAX} characters or fewer.`);
      return;
    }

    // Build the dispute reason including proof file names as a reference. In a
    // full production build the files would be uploaded to Storage and their
    // paths attached to the dispute record. For the hackathon MVP, we note the
    // filenames in the reason text as evidence that proof was supplied.
    const proofNote =
      proofFiles.length > 0
        ? `\n\n[Evidence attached: ${proofFiles.map((f) => f.name).join(', ')}]`
        : '';

    startTransition(async () => {
      const result = await disputeCashSale(cashSaleId, trimmed + proofNote);
      if (result.ok) {
        toast.success('Dispute raised — the contract is now under review.');
        setOpen(false);
        setReason('');
        setProofFiles([]);
      } else {
        const msg =
          ERROR_MESSAGES[result.error] ?? result.message ?? 'Could not raise the dispute.';
        setInlineError(msg);
        toast.error(msg);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          <AlertTriangle className="size-3.5" aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Report handover failed</DialogTitle>
            <DialogDescription>
              Describe what went wrong. This will raise a dispute — for a cash
              sale the buyer is refunded; for a trade, collateral resolution
              begins.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Fraud deterrence warning */}
            <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-destructive">Fraudulent disputes have consequences</p>
                <p className="text-muted-foreground">
                  Filing a false dispute is a permanent mark on your account and may
                  result in criminal fraud charges. Verified users are given
                  preference in arbitration due to identity liability. All evidence
                  is retained.
                </p>
              </div>
            </div>
            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="dispute-reason">What happened?</Label>
              <Textarea
                id="dispute-reason"
                placeholder="e.g. Item not as described, seller didn't show up, package arrived damaged…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={REASON_MAX}
                rows={4}
                disabled={isPending}
              />
              <p className="text-right text-xs text-muted-foreground">
                {reason.length}/{REASON_MAX}
              </p>
            </div>

            {/* Proof images */}
            <div className="space-y-2">
              <Label>Evidence (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Attach up to 5 photos as proof — damaged packaging, screenshots,
                etc.
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
                {proofFiles.length < 5 ? (
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
              disabled={!reason.trim() || isPending}
              aria-busy={isPending}
            >
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Submitting…' : 'Raise dispute'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
