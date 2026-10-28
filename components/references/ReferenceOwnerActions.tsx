'use client';

// components/references/ReferenceOwnerActions.tsx
//
// Edit and Withdraw, on a reference its author is looking at. A reference is the
// author's own words about someone, so they can change them or take them back at any
// time; an edit is marked as one for readers (0163).
//
// Editing reuses the share dialog's two steps and fields (`Composer`), prefilled, so a
// changed reference is held to the same rules as a new one.

import { useState, useTransition, type SyntheticEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Composer, useReferenceEditor, type EditableReference } from '@/components/references/ReferenceComposer';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { withdrawReference } from '@/lib/actions/references';
import type { ReferenceGraphNode } from '@/lib/references/graph';
import { focusReferenceList } from '@/components/references/referenceListFocus';

/** Keeps clicks and keys inside the actions (and their dialogs) from selecting the card. */
function contain(event: SyntheticEvent) {
  event.stopPropagation();
}

export function ReferenceOwnerActions({
  node,
  subject,
}: {
  node: ReferenceGraphNode;
  /** Who the reference is about, e.g. `@piggybear789`. */
  subject: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [pending, startTransition] = useTransition();
  const referenceId = node.referenceId;
  if (!referenceId) return null;

  const withdraw = () => {
    startTransition(async () => {
      const result = await withdrawReference(referenceId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setWithdrawing(false);
      toast.success('Reference withdrawn');
      router.refresh();
      focusReferenceList();
    });
  };

  return (
    <div className="flex items-center gap-1" onClick={contain} onKeyDown={contain}>
      <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => setWithdrawing(true)}
      >
        Withdraw
      </Button>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="md:max-w-md">
          {editing ? (
            <EditReferenceForm
              reference={{
                id: referenceId,
                subject,
                platform: node.platform,
                role: node.role,
                month: node.occurredMonth,
                rating: node.rating ?? (node.sentiment === 'NEGATIVE' ? 1 : node.sentiment === 'NEUTRAL' ? 3 : 5),
                category: node.category,
                comment: node.comment,
              }}
              onClose={() => setEditing(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={withdrawing}
        onOpenChange={setWithdrawing}
        title={`Withdraw your reference for ${subject}?`}
        description="It comes off their profile straight away. You can leave a new one later."
        confirmLabel="Withdraw reference"
        confirmVariant="destructive"
        cancelLabel="Keep it"
        onConfirm={withdraw}
        pending={pending}
      />
    </div>
  );
}

type Step = 1 | 2;

/** Mounted only while the dialog is open, so each opening starts from the saved reference. */
function EditReferenceForm({ reference, onClose }: { reference: EditableReference; onClose: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const draft = useReferenceEditor(reference, () => {
    toast.success('Reference updated');
    onClose();
  });

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-snug">
          <DialogTitle className="min-w-0 flex-1 truncate">Edit your reference</DialogTitle>
          <span className="shrink-0 text-meta tabular-nums text-muted-foreground">Step {step} of 2</span>
        </div>
        <DialogDescription>
          For {reference.subject}. Readers will see that you edited it.
        </DialogDescription>
      </DialogHeader>

      <Composer.Provider draft={draft}>
        {/* Keyed by step so each step mounts fresh (star hover state and the like). */}
        <div key={step} className="space-y-group">
          {step === 1 ? (
            <>
              <Composer.Platform />
              <Composer.Role />
              <Composer.Month />
            </>
          ) : (
            <>
              <Composer.Outcome />
              <Composer.Category />
              <Composer.Comment id={`edit-reference-${reference.id}`} rows={4} />
            </>
          )}
          <Composer.Error />
        </div>

        <DialogFooter className="sm:justify-between">
          {step === 1 ? (
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="ghost" disabled={draft.pending} onClick={() => setStep(1)}>
              Back
            </Button>
          )}
          {step === 1 ? (
            <Button
              type="button"
              onClick={() => {
                if (draft.requirePlatform()) setStep(2);
              }}
            >
              Next
            </Button>
          ) : (
            <Composer.Publish pendingLabel="Saving…">Save changes</Composer.Publish>
          )}
        </DialogFooter>
      </Composer.Provider>
    </>
  );
}
