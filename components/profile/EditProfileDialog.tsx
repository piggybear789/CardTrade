'use client';

// components/profile/EditProfileDialog.tsx
//
// The Profile card as a summary plus a modal editor. Account settings are read
// far more often than they are changed, so the page shows what is set and keeps
// the inputs behind a deliberate action.

import { useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { PencilIcon } from '@hugeicons/core-free-icons';

import { ProfileForm } from './ProfileForm';
import { withRowOpenHandler } from '@/components/account/SettingsPrimitives';
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
      {/* `withRowOpenHandler` RATHER THAN AN INLINE `isValidElement` BRANCH. The branch
          that used to be here fell back to `<div onClick=…>{trigger}</div>`, and those
          two arms emit different TAGS — so a trigger whose element identity differed
          between the SSR pass and the browser produced a hydration mismatch.
          
          It also relies on the trigger being built by a CLIENT caller: this helper
          returns the element untouched when it cannot clone, which keeps hydration
          correct but attaches no handler. `SettingsDialogRows` is what guarantees the
          caller is client-side; see its header for the three failures that established
          this. */}
      {trigger ? (
        withRowOpenHandler(trigger, () => setOpen(true))
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
