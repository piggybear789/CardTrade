'use client';

// components/profile/EditProfileDialog.tsx
//
// The Profile card as a summary plus a modal editor. Account settings are read
// far more often than they are changed, so the page shows what is set and keeps
// the inputs behind a deliberate action.

import { cloneElement, isValidElement, useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { PencilIcon } from '@hugeicons/core-free-icons';

import { ProfileForm } from './ProfileForm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function EditProfileDialog({
  displayName,
  contactEmail,
  avatarPath = null,
  trigger,
}: {
  displayName: string;
  contactEmail: string;
  /** Current avatar object path, or null. */
  avatarPath?: string | null;
  /**
   * What opens the dialog. The Settings tab passes a list row so name and email are
   * edited from the same row vocabulary as everything else; the default standalone
   * pencil remains for any surface that is not a settings list.
   */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {trigger ? (
        isValidElement<{ onClick?: () => void }>(trigger) ? (
          cloneElement(trigger, {
            onClick: () => setOpen(true),
          })
        ) : (
          <div onClick={() => setOpen(true)}>{trigger}</div>
        )
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-body font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline border border-transparent focus:outline-none focus-visible:border-iris"
        >
          <HugeiconsIcon icon={PencilIcon} className="size-3" aria-hidden />
          Edit
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit your details</DialogTitle>
          <DialogDescription>
            Your display name is what other traders see.
          </DialogDescription>
        </DialogHeader>
        <ProfileForm
          initialDisplayName={displayName}
          initialContactEmail={contactEmail}
          initialAvatarPath={avatarPath}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
    </>
  );
}
