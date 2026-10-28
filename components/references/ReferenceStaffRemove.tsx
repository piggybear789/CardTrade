'use client';

// components/references/ReferenceStaffRemove.tsx
//
// "Remove" on a reference card, for admins only (0164/0165). Experiences publish without
// review, so this is the takedown: it asks why, the reason is recorded with who removed
// it, and the reference leaves every page at once (`admin.removeReference`). The server
// re-checks that the caller is an admin; showing the control is not permission.

import { useState, useTransition, type SyntheticEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { removeReference } from '@/lib/actions/admin';
import { focusReferenceList } from '@/components/references/referenceListFocus';

/** Keeps clicks and keys inside the control (and its dialog) from selecting the card. */
function contain(event: SyntheticEvent) {
  event.stopPropagation();
}

export function ReferenceStaffRemove({ referenceId, subject }: { referenceId: string; subject: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const fieldId = `remove-reason-${referenceId}`;

  const remove = () => {
    startTransition(async () => {
      const result = await removeReference(referenceId, reason);
      if (!result.ok) {
        toast.error(result.message ?? "Couldn't remove that reference.");
        return;
      }
      setOpen(false);
      toast.success('Reference removed');
      router.refresh();
      focusReferenceList();
    });
  };

  return (
    <div onClick={contain} onKeyDown={contain}>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Remove
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this reference?</DialogTitle>
            <DialogDescription>
              It comes off {subject}&rsquo;s page straight away. The reason is kept with your name for
              the record and is not shown to members.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-snug">
            <Label htmlFor={fieldId}>Why</Label>
            <Textarea
              id={fieldId}
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Shares someone's phone number"
            />
          </div>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || reason.trim().length < 3}
              onClick={remove}
            >
              {pending ? 'Removing…' : 'Remove reference'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
